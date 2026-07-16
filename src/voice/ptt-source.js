'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_INDEX_TTL_MS = 10 * 1000;
const PTT_MONTH_PATTERN = /^\d{4}-\d{2}$/;

function normalizeText(value) {
    const text = String(value ?? '').trim();
    return text && text !== 'undefined' && text !== 'null' && text !== '0' ? text : '';
}

function normalizeDurationSeconds(value) {
    const duration = Number(value);
    if (!Number.isFinite(duration) || duration <= 0) {
        return 0;
    }
    return Math.max(1, Math.ceil(duration > 1000 ? duration / 1000 : duration));
}

function sanitizePttInfo(value) {
    const pttElement = value?.pttElement || value;
    if (!pttElement || typeof pttElement !== 'object') {
        return null;
    }
    const ptt = {
        filePath: normalizeText(pttElement.filePath),
        sourcePath: normalizeText(pttElement.sourcePath),
        fileName: normalizeText(pttElement.fileName),
        md5HexStr: normalizeText(pttElement.md5HexStr).toLowerCase(),
        duration: normalizeDurationSeconds(pttElement.duration),
        fileUuid: normalizeText(pttElement.fileUuid),
        fileSubId: normalizeText(pttElement.fileSubId),
        fileId: normalizeText(pttElement.fileId)
    };
    return ptt.filePath || ptt.sourcePath || ptt.fileName || ptt.md5HexStr ||
        ptt.fileUuid || ptt.fileSubId || ptt.fileId
        ? ptt
        : null;
}

function getExistingDirectPath(ptt) {
    for (const value of [ptt?.filePath, ptt?.sourcePath]) {
        const filePath = normalizeText(value).replace(/\//g, path.sep);
        if (filePath && path.isAbsolute(filePath) && fs.existsSync(filePath)) {
            return filePath;
        }
    }
    return '';
}

function addCandidate(candidates, value, reliable = false) {
    const fileName = path.basename(normalizeText(value));
    if (!fileName || fileName === '.' || candidates.some(candidate => candidate.name.toLowerCase() === fileName.toLowerCase())) {
        return;
    }
    candidates.push({ name: fileName, reliable });
}

function hasHashFileName(value, md5 = '') {
    const stem = path.parse(normalizeText(value)).name.toLowerCase();
    return /^[a-f0-9]{32}$/.test(stem) && (!md5 || stem === md5);
}

function getPttFileCandidates(ptt) {
    const candidates = [];
    const md5 = /^[a-f0-9]{32}$/i.test(ptt?.md5HexStr || '')
        ? ptt.md5HexStr.toLowerCase()
        : '';
    if (md5) {
        addCandidate(candidates, `${md5}.amr`, true);
    }
    addCandidate(candidates, ptt?.fileName, hasHashFileName(ptt?.fileName, md5));
    for (const value of [ptt?.filePath, ptt?.sourcePath]) {
        addCandidate(candidates, value, hasHashFileName(value, md5));
    }
    const initialCandidates = candidates.slice();
    for (const candidate of initialCandidates) {
        if (!path.extname(candidate.name) && /^[a-z0-9_-]{8,}$/i.test(candidate.name)) {
            addCandidate(candidates, `${candidate.name}.amr`, candidate.reliable || candidate.name.toLowerCase() === md5);
        }
    }
    return candidates;
}

function getPttOriDirectories(baseDir) {
    let entries;
    try {
        entries = fs.readdirSync(baseDir, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter(entry => entry.isDirectory() && PTT_MONTH_PATTERN.test(entry.name))
        .sort((left, right) => right.name.localeCompare(left.name))
        .map(entry => path.join(baseDir, entry.name, 'Ori'))
        .filter(oriDir => {
            try {
                return fs.statSync(oriDir).isDirectory();
            } catch {
                return false;
            }
        });
}

function buildPttFileIndex(baseDirs) {
    const index = new Map();
    for (const baseDir of baseDirs) {
        for (const oriDir of getPttOriDirectories(baseDir)) {
            let entries;
            try {
                entries = fs.readdirSync(oriDir, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const entry of entries) {
                if (!entry.isFile()) {
                    continue;
                }
                const key = entry.name.toLowerCase();
                const paths = index.get(key) || [];
                paths.push(path.join(oriDir, entry.name));
                index.set(key, paths);
            }
        }
    }
    return index;
}

function findIndexedPttPath(index, candidates) {
    for (const candidate of candidates) {
        const paths = (index.get(candidate.name.toLowerCase()) || []).filter(filePath => fs.existsSync(filePath));
        if (paths.length === 1 || (paths.length > 1 && candidate.reliable)) {
            return paths[0];
        }
    }
    return '';
}

function createPttSourceResolver(getBaseDirs, options = {}) {
    const configuredTtlMs = Number(options.cacheTtlMs);
    const cacheTtlMs = Number.isFinite(configuredTtlMs) && configuredTtlMs >= 0
        ? configuredTtlMs
        : DEFAULT_INDEX_TTL_MS;
    const now = typeof options.now === 'function' ? options.now : Date.now;
    let index = null;
    let indexExpiresAt = 0;

    function getIndex() {
        const currentTime = now();
        if (!index || currentTime >= indexExpiresAt) {
            const baseDirs = Array.from(new Set((getBaseDirs?.() || []).filter(Boolean)));
            index = buildPttFileIndex(baseDirs);
            indexExpiresAt = currentTime + cacheTtlMs;
        }
        return index;
    }

    return {
        resolve(value) {
            const ptt = sanitizePttInfo(value);
            if (!ptt) {
                return '';
            }
            return getExistingDirectPath(ptt) || findIndexedPttPath(getIndex(), getPttFileCandidates(ptt));
        },
        remember(filePath) {
            const normalizedPath = normalizeText(filePath).replace(/\//g, path.sep);
            if (!normalizedPath || !path.isAbsolute(normalizedPath) || !fs.existsSync(normalizedPath)) {
                return;
            }
            if (!index) {
                return;
            }
            const key = path.basename(normalizedPath).toLowerCase();
            const paths = index.get(key) || [];
            if (!paths.some(candidate => candidate.toLowerCase() === normalizedPath.toLowerCase())) {
                paths.unshift(normalizedPath);
                index.set(key, paths);
            }
        },
        invalidate() {
            index = null;
            indexExpiresAt = 0;
        }
    };
}

module.exports = {
    buildPttFileIndex,
    createPttSourceResolver,
    getPttFileCandidates,
    sanitizePttInfo
};
