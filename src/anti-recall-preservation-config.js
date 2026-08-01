'use strict';

const BYTE_UNITS = Object.freeze({
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024
});

const WINDOW_UNITS = Object.freeze({
    MINUTE: 60 * 1000,
    HOUR: 60 * 60 * 1000,
    DAY: 24 * 60 * 60 * 1000
});

const FILE_SIZE_UNITS = Object.freeze(Object.keys(BYTE_UNITS));
const CAPACITY_UNITS = Object.freeze(['MB', 'GB']);
const WINDOW_UNIT_NAMES = Object.freeze(Object.keys(WINDOW_UNITS));
const MAX_FILTER_GROUPS = 256;
const MIN_FILE_BYTES = 1;
const MAX_FILE_BYTES = 600 * BYTE_UNITS.MB;
const MIN_WINDOW_MS = 5 * WINDOW_UNITS.MINUTE;
const MAX_WINDOW_MS = 30 * WINDOW_UNITS.DAY;

const DEFAULT_STAGING_WINDOW = Object.freeze({ value: 24, unit: 'HOUR' });
const DEFAULT_STAGING_CAPACITY = Object.freeze({ value: '5', unit: 'GB' });
const DEFAULT_FILE_SIZE_RANGE = Object.freeze({
    min: Object.freeze({ value: '0.5', unit: 'KB' }),
    max: Object.freeze({ value: '600', unit: 'MB' })
});

function normalizeText(value) {
    return String(value ?? '').trim();
}

function parseExactBytes(setting, options = {}) {
    const units = Array.isArray(options.units) && options.units.length
        ? options.units
        : FILE_SIZE_UNITS;
    const unit = normalizeText(setting?.unit).toUpperCase();
    const value = normalizeText(setting?.value);
    if (!units.includes(unit) || !Object.hasOwn(BYTE_UNITS, unit)) {
        return { ok: false, reason: 'invalid-unit', value, unit, bytes: 0 };
    }
    const match = value.match(/^(0|[1-9]\d*)(?:\.(\d{1,3}))?$/);
    if (!match) {
        return { ok: false, reason: 'invalid-decimal', value, unit, bytes: 0 };
    }
    const fraction = match[2] || '';
    const scale = 10n ** BigInt(fraction.length);
    const numerator = BigInt(match[1]) * scale + BigInt(fraction || '0');
    const byteNumerator = numerator * BigInt(BYTE_UNITS[unit]);
    if (byteNumerator % scale !== 0n) {
        return { ok: false, reason: 'partial-byte', value, unit, bytes: 0 };
    }
    const bytesBigInt = byteNumerator / scale;
    if (bytesBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
        return { ok: false, reason: 'too-large', value, unit, bytes: 0 };
    }
    const bytes = Number(bytesBigInt);
    if (Number.isFinite(options.minBytes) && bytes < options.minBytes) {
        return { ok: false, reason: 'below-minimum', value, unit, bytes };
    }
    if (Number.isFinite(options.maxBytes) && bytes > options.maxBytes) {
        return { ok: false, reason: 'above-maximum', value, unit, bytes };
    }
    return { ok: true, reason: '', value, unit, bytes };
}

function parseStagingWindow(setting) {
    const unit = normalizeText(setting?.unit).toUpperCase();
    const value = Number(setting?.value);
    if (!WINDOW_UNIT_NAMES.includes(unit) || !Number.isSafeInteger(value) || value <= 0) {
        return { ok: false, reason: 'invalid-window', value: 0, unit, milliseconds: 0 };
    }
    const milliseconds = value * WINDOW_UNITS[unit];
    if (milliseconds < MIN_WINDOW_MS || milliseconds > MAX_WINDOW_MS) {
        return { ok: false, reason: 'window-out-of-range', value, unit, milliseconds };
    }
    return { ok: true, reason: '', value, unit, milliseconds };
}

function normalizeGroupWhitelist(values) {
    const groups = new Map();
    for (const source of Array.isArray(values) ? values : []) {
        const chatType = Number(source?.chatType || source?.peer?.chatType || 0);
        const peerUid = normalizeText(
            source?.peerUid || source?.peerUin || source?.peer?.peerUid || source?.peer?.peerUin
        );
        if (chatType !== 2 || !peerUid || groups.has(peerUid)) {
            continue;
        }
        groups.set(peerUid, {
            key: `2:${peerUid}`,
            chatType: 2,
            peerUid,
            label: normalizeText(source?.label).slice(0, 80)
        });
        if (groups.size >= MAX_FILTER_GROUPS) {
            break;
        }
    }
    return Array.from(groups.values());
}

function normalizeFileSizeRange(value) {
    const min = parseExactBytes(value?.min, {
        units: FILE_SIZE_UNITS,
        minBytes: MIN_FILE_BYTES,
        maxBytes: MAX_FILE_BYTES
    });
    const max = parseExactBytes(value?.max, {
        units: FILE_SIZE_UNITS,
        minBytes: MIN_FILE_BYTES,
        maxBytes: MAX_FILE_BYTES
    });
    if (!min.ok || !max.ok || min.bytes > max.bytes) {
        return {
            ok: false,
            reason: !min.ok ? `min-${min.reason}` : !max.ok ? `max-${max.reason}` : 'inverted-range',
            min,
            max
        };
    }
    return { ok: true, reason: '', min, max };
}

function normalizeAntiRecallPreservationConfig(value = {}) {
    const windowResult = parseStagingWindow(value?.stagingWindow);
    const capacityResult = parseExactBytes(value?.stagingCapacity, {
        units: CAPACITY_UNITS,
        minBytes: 1
    });
    return {
        stagingWindow: windowResult.ok
            ? { value: windowResult.value, unit: windowResult.unit }
            : { ...DEFAULT_STAGING_WINDOW },
        stagingCapacity: capacityResult.ok
            ? { value: capacityResult.value, unit: capacityResult.unit }
            : { ...DEFAULT_STAGING_CAPACITY },
        closedLidEnabled: value?.closedLidEnabled === true
    };
}

function normalizeReceivedFileAutoDownloadConfig(value = {}) {
    const range = normalizeFileSizeRange(value?.sizeRange);
    return {
        enabled: value?.enabled === true && range.ok,
        groups: normalizeGroupWhitelist(value?.groups),
        sizeRange: range.ok
            ? {
                min: { value: range.min.value, unit: range.min.unit },
                max: { value: range.max.value, unit: range.max.unit }
            }
            : {
                min: { ...DEFAULT_FILE_SIZE_RANGE.min },
                max: { ...DEFAULT_FILE_SIZE_RANGE.max }
            }
    };
}

function getRecordGroupId(record) {
    if (Number(record?.chatType || record?.peer?.chatType || 0) !== 2) {
        return '';
    }
    return normalizeText(
        record?.peerUid || record?.peerUin || record?.peer?.peerUid || record?.peer?.peerUin
    );
}

function getFileElementIdentity(record, element, index) {
    const msgId = normalizeText(record?.msgId);
    const elementId = normalizeText(element?.elementId);
    if (!msgId) {
        return '';
    }
    return `${msgId}:${elementId || index}`;
}

function collectReceivedFileTargets(config, record) {
    const normalized = normalizeReceivedFileAutoDownloadConfig(config);
    if (!normalized.enabled) {
        return [];
    }
    const groupId = getRecordGroupId(record);
    if (!groupId || !normalized.groups.some(group => group.peerUid === groupId)) {
        return [];
    }
    const range = normalizeFileSizeRange(normalized.sizeRange);
    if (!range.ok) {
        return [];
    }
    const targets = [];
    for (const [index, element] of (Array.isArray(record?.elements) ? record.elements : []).entries()) {
        const fileElement = element?.fileElement;
        const fileSize = Number(fileElement?.fileSize);
        if (!fileElement || !Number.isSafeInteger(fileSize) || fileSize <= 0 ||
            fileSize < range.min.bytes || fileSize > range.max.bytes) {
            continue;
        }
        const identity = getFileElementIdentity(record, element, index);
        if (!identity) {
            continue;
        }
        targets.push({
            identity,
            index,
            element,
            fileElement,
            fileName: normalizeText(fileElement.fileName) || '文件',
            fileSize
        });
    }
    return targets;
}

function getRuntimePreservationSettings(config = {}) {
    const preservation = normalizeAntiRecallPreservationConfig(config.antiRecallPreservation);
    const files = normalizeReceivedFileAutoDownloadConfig(config.receivedFileAutoDownload);
    return {
        preservation,
        files,
        windowMs: parseStagingWindow(preservation.stagingWindow).milliseconds,
        capacityBytes: parseExactBytes(preservation.stagingCapacity, {
            units: CAPACITY_UNITS,
            minBytes: 1
        }).bytes
    };
}

module.exports = {
    BYTE_UNITS,
    WINDOW_UNITS,
    FILE_SIZE_UNITS,
    CAPACITY_UNITS,
    MAX_FILTER_GROUPS,
    MIN_FILE_BYTES,
    MAX_FILE_BYTES,
    MIN_WINDOW_MS,
    MAX_WINDOW_MS,
    DEFAULT_STAGING_WINDOW,
    DEFAULT_STAGING_CAPACITY,
    DEFAULT_FILE_SIZE_RANGE,
    parseExactBytes,
    parseStagingWindow,
    normalizeGroupWhitelist,
    normalizeFileSizeRange,
    normalizeAntiRecallPreservationConfig,
    normalizeReceivedFileAutoDownloadConfig,
    getRecordGroupId,
    getFileElementIdentity,
    collectReceivedFileTargets,
    getRuntimePreservationSettings
};
