'use strict';

function isQqThumbnailPath(value) {
    return /[\\/]Thumb[\\/][^\\/]+_\d+\.[^\\/]+$/i.test(String(value || '').trim());
}

function getQqOriginalImagePath(value) {
    const source = String(value || '').trim();
    const match = /^(.*[\\/])Thumb([\\/])([^\\/]+)_\d+(\.[^\\/.]+)$/i.exec(source);
    return match ? `${match[1]}Ori${match[2]}${match[3]}${match[4]}` : '';
}

function expandQrScanPathCandidates(values) {
    const candidates = [];
    const seen = new Set();
    const add = value => {
        const filePath = String(value || '').trim();
        const key = /^[a-z]:[\\/]/i.test(filePath) ? filePath.toLowerCase() : filePath;
        if (filePath && !seen.has(key)) {
            seen.add(key);
            candidates.push(filePath);
        }
    };
    for (const value of Array.isArray(values) ? values : []) {
        add(getQqOriginalImagePath(value));
        add(value);
    }
    return candidates.sort((left, right) => {
        const rank = value => /[\\/]Ori[\\/]/i.test(value)
            ? 0
            : isQqThumbnailPath(value) ? 2 : 1;
        return rank(left) - rank(right);
    });
}

function migrateQrScanConfig(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }
    const interfaceTweaks = value.interfaceTweaks;
    if (!interfaceTweaks || typeof interfaceTweaks !== 'object' || Array.isArray(interfaceTweaks)) {
        return value;
    }
    const migratedTweaks = { ...interfaceTweaks };
    if (typeof migratedTweaks.activeQrScan !== 'boolean' &&
        typeof migratedTweaks.disableImageQrScan === 'boolean') {
        migratedTweaks.activeQrScan = migratedTweaks.disableImageQrScan;
    }
    delete migratedTweaks.disableImageQrScan;
    return { ...value, interfaceTweaks: migratedTweaks };
}

function normalizeQrScanInfos(value) {
    const candidates = [];
    const visited = new WeakSet();
    let visitedCount = 0;
    const visit = (current, depth = 0) => {
        if (!current || depth > 7 || candidates.length >= 64 || visitedCount >= 256) {
            return;
        }
        if (typeof current !== 'object') {
            return;
        }
        if (visited.has(current)) {
            return;
        }
        visited.add(current);
        visitedCount++;
        if (Array.isArray(current)) {
            for (const item of current) {
                visit(item, depth + 1);
            }
            return;
        }
        if (current instanceof Map) {
            if (current.has('text')) {
                candidates.push({
                    text: current.get('text'),
                    format: current.get('format'),
                    charset: current.get('charset')
                });
                return;
            }
            if (current.has('infos')) {
                visit(current.get('infos'), depth + 1);
            }
            for (const item of current.values()) {
                visit(item, depth + 1);
            }
            return;
        }
        if (current.text !== undefined) {
            candidates.push(current);
            return;
        }
        for (const key of ['infos', 'payload', 'result', 'data', 'value']) {
            visit(current[key], depth + 1);
        }
    };
    visit(value);
    const seen = new Set();
    const result = [];
    for (const item of candidates) {
        const text = String(item?.text ?? '').trim();
        if (!text || seen.has(text)) {
            continue;
        }
        seen.add(text);
        result.push({
            text,
            format: String(item?.format || ''),
            charset: String(item?.charset || '')
        });
        if (result.length >= 16) {
            break;
        }
    }
    return result;
}

function summarizeQrScanValue(value) {
    const nodes = [];
    const visited = new WeakSet();
    const visit = (current, location = '$', depth = 0) => {
        if (nodes.length >= 40 || depth > 6) {
            return;
        }
        if (current === null) {
            nodes.push({ location, type: 'null' });
            return;
        }
        if (current === undefined || typeof current !== 'object') {
            nodes.push({ location, type: typeof current });
            return;
        }
        if (visited.has(current)) {
            nodes.push({ location, type: 'circular' });
            return;
        }
        visited.add(current);
        if (Array.isArray(current)) {
            nodes.push({ location, type: 'array', length: current.length });
            current.slice(0, 6).forEach((item, index) => visit(item, `${location}[${index}]`, depth + 1));
            return;
        }
        if (current instanceof Map) {
            nodes.push({
                location,
                type: 'map',
                size: current.size,
                keyTypes: Array.from(current.keys()).slice(0, 12).map(key => typeof key)
            });
            Array.from(current.values()).slice(0, 6)
                .forEach((item, index) => visit(item, `${location}<${index}>`, depth + 1));
            return;
        }
        if (current instanceof Uint8Array) {
            nodes.push({ location, type: current.constructor.name, length: current.length });
            return;
        }
        const keys = Object.keys(current).sort().slice(0, 16);
        nodes.push({
            location,
            type: current.constructor?.name || 'object',
            keys
        });
        for (const key of ['infos', 'payload', 'result', 'data', 'value']) {
            if (Object.prototype.hasOwnProperty.call(current, key)) {
                visit(current[key], `${location}.${key}`, depth + 1);
            }
        }
    };
    visit(value);
    return nodes;
}

function getOpenableQrUrl(value) {
    const text = String(value ?? '').trim();
    try {
        const url = new URL(text);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
        return '';
    }
}

module.exports = {
    expandQrScanPathCandidates,
    getOpenableQrUrl,
    isQqThumbnailPath,
    migrateQrScanConfig,
    normalizeQrScanInfos,
    summarizeQrScanValue
};
