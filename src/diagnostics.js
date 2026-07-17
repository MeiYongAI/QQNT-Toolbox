'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_ENTRY_LIMIT = 250;
const DEFAULT_FILE_LIMIT = 1024 * 1024;
const DEFAULT_STRING_LIMIT = 1000;
const SENSITIVE_KEY_PATTERN = /password|passphrase|secret|token|cookie|authorization|authdata|skey|pskey|rkey|ticket|session/i;
const IDENTIFIER_KEY_PATTERN = /uin|uid|peer|group|target|sender|account|msgid|msg_id/i;
const CONTENT_KEY_PATTERN = /^(?:content|text|body|raw|elements|msgRecord|record|payload)$/i;
const PATH_KEY_PATTERN = /(?:path|file|directory|dir)$/i;
const VERSION_KEY_PATTERN = /(?:version|build)$/i;
const WINDOWS_PATH_PATTERN = /(?:file:\/{2,3})?[a-z]:[\\/][^\r\n"'<>|?*]+/gi;
const LONG_IDENTIFIER_PATTERN = /\b\d{5,20}\b/g;

function normalizeEventName(value) {
    const event = String(value || 'unknown')
        .trim()
        .replace(/[^a-z0-9_.:-]+/gi, '-')
        .replace(/^-+|-+$/g, '');
    return (event || 'unknown').slice(0, 96);
}

function maskIdentifier(value) {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
        return '';
    }
    return normalized.length <= 4
        ? '<redacted-id>'
        : `<redacted-id:${normalized.slice(-4)}>`;
}

function sanitizePath(value) {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
        return '';
    }
    if (!path.isAbsolute(normalized)) {
        return sanitizeString(normalized, DEFAULT_STRING_LIMIT);
    }
    return `<path>/${sanitizeString(path.basename(normalized), DEFAULT_STRING_LIMIT)}`;
}

function sanitizeString(value, maxStringLength = DEFAULT_STRING_LIMIT, options = {}) {
    let sanitized = String(value ?? '')
        .replace(WINDOWS_PATH_PATTERN, match => {
            const normalized = match.replace(/^file:\/{2,3}/i, '');
            const segments = normalized.split(/[\\/]/).filter(Boolean);
            return `<path>/${segments.at(-1) || 'unknown'}`;
        });
    if (options.redactIdentifiers !== false) {
        sanitized = sanitized.replace(LONG_IDENTIFIER_PATTERN, matchIdentifier);
    }
    return sanitized.length > maxStringLength
        ? `${sanitized.slice(0, maxStringLength)}...<truncated>`
        : sanitized;
}

function matchIdentifier(value) {
    return maskIdentifier(value);
}

function sanitizeDiagnosticValue(value, options = {}, key = '', depth = 0, seen = new WeakSet()) {
    const maxDepth = Number(options.maxDepth) || 5;
    const maxArrayLength = Number(options.maxArrayLength) || 30;
    const maxObjectKeys = Number(options.maxObjectKeys) || 50;
    const maxStringLength = Number(options.maxStringLength) || DEFAULT_STRING_LIMIT;

    if (SENSITIVE_KEY_PATTERN.test(key) || CONTENT_KEY_PATTERN.test(key)) {
        return '<redacted>';
    }
    if (IDENTIFIER_KEY_PATTERN.test(key)) {
        return maskIdentifier(value);
    }
    if (PATH_KEY_PATTERN.test(key) && typeof value === 'string') {
        return sanitizePath(value);
    }
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
        return value ?? null;
    }
    if (typeof value === 'bigint') {
        return value.toString();
    }
    if (typeof value === 'string') {
        return sanitizeString(value, maxStringLength, {
            redactIdentifiers: !VERSION_KEY_PATTERN.test(key)
        });
    }
    if (typeof value === 'function' || typeof value === 'symbol') {
        return `<${typeof value}>`;
    }
    if (value instanceof Error) {
        return {
            name: String(value.name || 'Error'),
            message: sanitizeDiagnosticValue(String(value.message || value), options, '', depth + 1, seen),
            code: sanitizeDiagnosticValue(value.code, options, '', depth + 1, seen)
        };
    }
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
        return { type: value.constructor.name, length: value.length };
    }
    if (depth >= maxDepth) {
        return '<max-depth>';
    }
    if (seen.has(value)) {
        return '<circular>';
    }
    seen.add(value);
    if (Array.isArray(value)) {
        const result = value.slice(0, maxArrayLength)
            .map(item => sanitizeDiagnosticValue(item, options, '', depth + 1, seen));
        if (value.length > maxArrayLength) {
            result.push(`<${value.length - maxArrayLength} more>`);
        }
        return result;
    }
    if (value instanceof Map) {
        return sanitizeDiagnosticValue(Object.fromEntries(value), options, key, depth + 1, seen);
    }
    const result = {};
    let entries = [];
    try {
        entries = Object.entries(value).slice(0, maxObjectKeys);
    } catch {
        return `<${value?.constructor?.name || 'object'}>`;
    }
    for (const [itemKey, item] of entries) {
        result[itemKey] = sanitizeDiagnosticValue(item, options, itemKey, depth + 1, seen);
    }
    const keyCount = (() => {
        try {
            return Object.keys(value).length;
        } catch {
            return entries.length;
        }
    })();
    if (keyCount > entries.length) {
        result.__truncatedKeys = keyCount - entries.length;
    }
    return result;
}

function readJsonLines(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8')
            .split(/\r?\n/)
            .filter(Boolean)
            .map(line => {
                try {
                    return JSON.parse(line);
                } catch {
                    return null;
                }
            })
            .filter(Boolean);
    } catch {
        return [];
    }
}

function createDiagnosticExportName(date = new Date()) {
    return `qqnt-toolbox-diagnostics-${date.toISOString().replace(/[:.]/g, '-')}.json`;
}

function createDiagnosticLogger(options = {}) {
    const entryLimit = Math.max(10, Number(options.entryLimit) || DEFAULT_ENTRY_LIMIT);
    const fileLimit = Math.max(1024, Number(options.fileLimit) || DEFAULT_FILE_LIMIT);
    const sessionId = `${Date.now().toString(36)}-${process.pid}`;
    const memoryEntries = [];

    function isEnabled() {
        return options.isEnabled?.() === true;
    }

    function getDirectory() {
        return path.resolve(String(options.getDirectory?.() || '.'));
    }

    function getPaths() {
        const directory = getDirectory();
        return {
            directory,
            current: path.join(directory, 'toolbox.log'),
            previous: path.join(directory, 'toolbox.previous.log')
        };
    }

    function rotateIfNeeded(paths, additionalBytes) {
        let currentSize = 0;
        try {
            currentSize = fs.statSync(paths.current).size;
        } catch {}
        if (currentSize + additionalBytes <= fileLimit) {
            return;
        }
        fs.rmSync(paths.previous, { force: true });
        if (fs.existsSync(paths.current)) {
            fs.renameSync(paths.current, paths.previous);
        }
    }

    function record(level, event, details = {}) {
        if (!isEnabled()) {
            return null;
        }
        const entry = {
            timestamp: new Date().toISOString(),
            sessionId,
            level: ['warn', 'error'].includes(level) ? level : 'info',
            event: normalizeEventName(event),
            details: sanitizeDiagnosticValue(details, options.sanitizeOptions)
        };
        memoryEntries.push(entry);
        if (memoryEntries.length > entryLimit) {
            memoryEntries.splice(0, memoryEntries.length - entryLimit);
        }
        try {
            const paths = getPaths();
            fs.mkdirSync(paths.directory, { recursive: true });
            const line = `${JSON.stringify(entry)}\n`;
            rotateIfNeeded(paths, Buffer.byteLength(line));
            fs.appendFileSync(paths.current, line, 'utf8');
        } catch {}
        return entry;
    }

    function getStoredEntries() {
        const paths = getPaths();
        const stored = [
            ...readJsonLines(paths.previous),
            ...readJsonLines(paths.current)
        ];
        return (stored.length ? stored : memoryEntries).slice(-entryLimit);
    }

    function getStats() {
        const paths = getPaths();
        const getSize = filePath => {
            try {
                return fs.statSync(filePath).size;
            } catch {
                return 0;
            }
        };
        return {
            enabled: isEnabled(),
            entryCount: getStoredEntries().length,
            currentBytes: getSize(paths.current),
            previousBytes: getSize(paths.previous),
            directory: paths.directory
        };
    }

    function createReport() {
        return {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            environment: sanitizeDiagnosticValue(options.getEnvironment?.() || {}, options.sanitizeOptions),
            stats: sanitizeDiagnosticValue(getStats(), options.sanitizeOptions),
            entries: getStoredEntries()
        };
    }

    function formatReport() {
        return JSON.stringify(createReport(), null, 2);
    }

    function clear() {
        memoryEntries.length = 0;
        const paths = getPaths();
        fs.rmSync(paths.current, { force: true });
        fs.rmSync(paths.previous, { force: true });
        return getStats();
    }

    return Object.freeze({
        clear,
        createReport,
        formatReport,
        getDirectory,
        getStats,
        record
    });
}

function createDiagnosticActionRunner(options = {}) {
    const logger = options.logger;
    if (!logger?.createReport || !logger?.getDirectory || !logger?.clear) {
        throw new TypeError('A diagnostic logger is required.');
    }

    async function run(action) {
        if (action === 'copy-report') {
            const report = logger.createReport();
            options.copyText?.(JSON.stringify(report, null, 2));
            logger.record('info', 'diagnostics.report-copied', { entryCount: report.entries.length });
            return { ok: true, action, entryCount: report.entries.length };
        }
        if (action === 'export-report') {
            const report = logger.createReport();
            const directory = logger.getDirectory();
            const filePath = path.join(directory, createDiagnosticExportName());
            await fs.promises.mkdir(directory, { recursive: true });
            await fs.promises.writeFile(filePath, JSON.stringify(report, null, 2), 'utf8');
            options.showItemInFolder?.(filePath);
            logger.record('info', 'diagnostics.report-exported', {
                entryCount: report.entries.length,
                filePath
            });
            return { ok: true, action, entryCount: report.entries.length, fileName: path.basename(filePath) };
        }
        if (action === 'open-directory') {
            const directory = logger.getDirectory();
            await fs.promises.mkdir(directory, { recursive: true });
            const error = await options.openPath?.(directory);
            return error ? { ok: false, action, reason: String(error) } : { ok: true, action };
        }
        if (action === 'clear') {
            logger.clear();
            return { ok: true, action, entryCount: 0 };
        }
        return { ok: false, action: String(action || ''), reason: 'unknown-action' };
    }

    return Object.freeze({ run });
}

module.exports = {
    createDiagnosticActionRunner,
    createDiagnosticExportName,
    createDiagnosticLogger,
    maskIdentifier,
    normalizeEventName,
    sanitizeString,
    sanitizeDiagnosticValue
};
