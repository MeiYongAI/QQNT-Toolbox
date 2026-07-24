'use strict';

// Sticker pack conventions are adapted from xiyuesaves/lite-tools (AGPL-3.0-only).

const fs = require('fs').promises;
const path = require('path');

const SUPPORTED_STICKER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const LOCAL_STICKER_ENTRY_MODES = new Set(['contextmenu', 'replace', 'separate']);
const RECENT_STICKERS_FILE = 'recentStickers.json';
const DEFAULT_LOCAL_STICKER_CONFIG = Object.freeze({
    enabled: false,
    path: '',
    entryMode: 'contextmenu',
    iconOnLeft: false,
    stickersPerRow: 6,
    panelWidth: 350,
    panelHeight: 420,
    sendAsImage: false,
    recentEnabled: true,
    recentRows: 2,
    telegramBotToken: '',
    ffmpegPath: '',
    tgsToGifPath: '',
    httpProxy: ''
});
const DEFAULT_SCAN_LIMITS = Object.freeze({
    maxDepth: 8,
    maxDirectories: 1024,
    maxPacks: 128,
    maxStickers: 5000,
    maxMetadataBytes: 64 * 1024
});

function clampInteger(value, minimum, maximum, fallback) {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number)
        ? Math.min(maximum, Math.max(minimum, number))
        : fallback;
}

function normalizeLocalStickerConfig(value, options = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const configuredPath = String(source.path || '').trim();
    return {
        enabled: source.enabled === true,
        path: (configuredPath || String(options.defaultPath || '').trim()).slice(0, 4096),
        entryMode: LOCAL_STICKER_ENTRY_MODES.has(source.entryMode)
            ? source.entryMode
            : DEFAULT_LOCAL_STICKER_CONFIG.entryMode,
        iconOnLeft: source.iconOnLeft === true,
        stickersPerRow: clampInteger(source.stickersPerRow, 3, 10, DEFAULT_LOCAL_STICKER_CONFIG.stickersPerRow),
        panelWidth: clampInteger(source.panelWidth, 280, 520, DEFAULT_LOCAL_STICKER_CONFIG.panelWidth),
        panelHeight: clampInteger(source.panelHeight, 260, 640, DEFAULT_LOCAL_STICKER_CONFIG.panelHeight),
        sendAsImage: source.sendAsImage === true,
        recentEnabled: source.recentEnabled !== false,
        recentRows: clampInteger(source.recentRows, 1, 6, DEFAULT_LOCAL_STICKER_CONFIG.recentRows),
        telegramBotToken: String(source.telegramBotToken || '').trim().slice(0, 256),
        ffmpegPath: String(source.ffmpegPath || '').trim().slice(0, 4096),
        tgsToGifPath: String(source.tgsToGifPath || '').trim().slice(0, 4096),
        httpProxy: String(source.httpProxy || '').trim().slice(0, 512)
    };
}

function isPathInside(rootPath, candidatePath) {
    const root = path.resolve(String(rootPath || ''));
    const candidate = path.resolve(String(candidatePath || ''));
    const relative = path.relative(root, candidate);
    return relative === '' || (
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
    );
}

function normalizePathKey(filePath) {
    const normalized = path.normalize(String(filePath || ''));
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isSupportedStickerPath(filePath) {
    return SUPPORTED_STICKER_EXTENSIONS.has(path.extname(String(filePath || '')).toLowerCase());
}

async function readBoundedJson(filePath, maxBytes) {
    try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) {
            return null;
        }
        return JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function normalizePackMetadata(value, fallbackLabel) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const label = String(source.label || '').trim().slice(0, 80) || fallbackLabel;
    return {
        label,
        index: clampInteger(source.index, -10000, 10000, 0),
        icon: String(source.icon || '').trim().slice(0, 260)
    };
}

function compareLabels(left, right) {
    return String(left || '').localeCompare(String(right || ''), 'zh-CN', {
        numeric: true,
        sensitivity: 'base'
    });
}

async function scanLocalStickerPacks(rootPath, options = {}) {
    const limits = {
        ...DEFAULT_SCAN_LIMITS,
        ...(options && typeof options === 'object' ? options : {})
    };
    const configuredRoot = String(rootPath || '').trim();
    if (!configuredRoot) {
        return { status: 'failed', msg: '请选择本地贴纸目录' };
    }

    let root;
    try {
        root = await fs.realpath(path.resolve(configuredRoot));
        const stat = await fs.stat(root);
        if (!stat.isDirectory()) {
            return { status: 'failed', msg: '本地贴纸目录无效' };
        }
    } catch {
        return { status: 'failed', msg: '本地贴纸目录不存在或无法访问' };
    }

    const queue = [{ directory: root, depth: 0 }];
    const packs = [];
    let visitedDirectories = 0;
    let stickerCount = 0;

    while (queue.length && visitedDirectories < limits.maxDirectories && stickerCount < limits.maxStickers) {
        const current = queue.shift();
        visitedDirectories += 1;
        let entries;
        try {
            entries = await fs.readdir(current.directory, { withFileTypes: true });
        } catch {
            continue;
        }
        entries.sort((left, right) => compareLabels(left.name, right.name));

        if (current.depth < limits.maxDepth) {
            for (const entry of entries) {
                if (entry.isDirectory() && queue.length + visitedDirectories < limits.maxDirectories) {
                    queue.push({
                        directory: path.join(current.directory, entry.name),
                        depth: current.depth + 1
                    });
                }
            }
        }

        if (packs.length >= limits.maxPacks) {
            continue;
        }
        const stickerEntries = entries.filter(entry =>
            entry.isFile() && isSupportedStickerPath(entry.name)
        );
        if (!stickerEntries.length) {
            continue;
        }

        const remaining = Math.max(0, limits.maxStickers - stickerCount);
        const stickers = stickerEntries.slice(0, remaining).map(entry => {
            const filePath = path.join(current.directory, entry.name);
            return {
                label: path.basename(entry.name, path.extname(entry.name)).slice(0, 160),
                path: filePath
            };
        });
        if (!stickers.length) {
            break;
        }
        stickerCount += stickers.length;

        const relativeName = path.relative(root, current.directory);
        const fallbackLabel = relativeName || path.basename(root) || '本地贴纸';
        const metadata = normalizePackMetadata(
            await readBoundedJson(path.join(current.directory, 'sticker.json'), limits.maxMetadataBytes),
            fallbackLabel
        );
        let icon = stickers[0].path;
        if (metadata.icon) {
            const iconPath = path.resolve(current.directory, metadata.icon);
            const stickerByPath = new Map(stickers.map(sticker => [normalizePathKey(sticker.path), sticker.path]));
            icon = stickerByPath.get(normalizePathKey(iconPath)) || icon;
        }
        packs.push({
            label: metadata.label,
            icon,
            index: metadata.index,
            dirPath: current.directory,
            stickers
        });
    }

    packs.sort((left, right) =>
        left.index - right.index || compareLabels(left.label, right.label)
    );
    return packs.length
        ? { status: 'success', rootPath: root, stickerPacks: packs }
        : { status: 'failed', rootPath: root, msg: '目录中没有可用贴纸' };
}

function getRecentStickerFilePath(rootPath) {
    return path.join(path.resolve(String(rootPath || '')), RECENT_STICKERS_FILE);
}

async function readRecentStickerPaths(rootPath, limit = 256) {
    const data = await readBoundedJson(getRecentStickerFilePath(rootPath), 512 * 1024);
    if (!Array.isArray(data)) {
        return [];
    }
    const paths = [];
    const seen = new Set();
    for (const item of data) {
        const filePath = String(typeof item === 'string' ? item : item?.path || '').trim();
        const key = normalizePathKey(filePath);
        if (!filePath || seen.has(key)) {
            continue;
        }
        seen.add(key);
        paths.push(filePath);
        if (paths.length >= limit) {
            break;
        }
    }
    return paths;
}

function getStickerMap(packs) {
    const result = new Map();
    for (const pack of Array.isArray(packs) ? packs : []) {
        for (const sticker of Array.isArray(pack?.stickers) ? pack.stickers : []) {
            if (sticker?.path) {
                result.set(normalizePathKey(sticker.path), sticker);
            }
        }
    }
    return result;
}

function buildLocalStickerStore(scanResult, recentPaths, configValue) {
    if (scanResult?.status !== 'success') {
        return {
            status: 'failed',
            msg: String(scanResult?.msg || '本地贴纸加载失败')
        };
    }
    const config = normalizeLocalStickerConfig(configValue);
    const stickerPacks = scanResult.stickerPacks.map(pack => ({
        ...pack,
        stickers: pack.stickers.map(sticker => ({ ...sticker }))
    }));
    if (config.recentEnabled) {
        const stickerMap = getStickerMap(stickerPacks);
        const recent = [];
        const seen = new Set();
        const maximum = config.stickersPerRow * config.recentRows;
        for (const filePath of Array.isArray(recentPaths) ? recentPaths : []) {
            const key = normalizePathKey(filePath);
            const sticker = stickerMap.get(key);
            if (!sticker || seen.has(key)) {
                continue;
            }
            seen.add(key);
            recent.push({ ...sticker });
            if (recent.length >= maximum) {
                break;
            }
        }
        if (recent.length) {
            stickerPacks.unshift({
                label: '最近使用',
                icon: recent[0].path,
                index: -1,
                dirPath: '',
                recent: true,
                stickers: recent
            });
        }
    }
    return {
        status: 'success',
        rootPath: scanResult.rootPath,
        stickerPacks
    };
}

async function resolveLocalStickerPath(rootPath, candidatePath) {
    const root = String(rootPath || '').trim();
    const candidate = String(candidatePath || '').trim();
    if (!root || !candidate || !isSupportedStickerPath(candidate)) {
        return '';
    }
    try {
        const [realRoot, realCandidate] = await Promise.all([
            fs.realpath(path.resolve(root)),
            fs.realpath(path.resolve(candidate))
        ]);
        if (!isPathInside(realRoot, realCandidate)) {
            return '';
        }
        const stat = await fs.stat(realCandidate);
        return stat.isFile() ? realCandidate : '';
    } catch {
        return '';
    }
}

async function writeRecentStickerPaths(rootPath, stickerPaths) {
    const targetPath = getRecentStickerFilePath(rootPath);
    const temporaryPath = path.join(
        path.dirname(targetPath),
        `.qqnt-toolbox-recent-${process.pid}-${Date.now()}.tmp`
    );
    const payload = stickerPaths.map(filePath => ({
        label: path.basename(filePath, path.extname(filePath)),
        path: filePath
    }));
    try {
        await fs.writeFile(temporaryPath, JSON.stringify(payload, null, 2), 'utf8');
        try {
            await fs.rename(temporaryPath, targetPath);
        } catch {
            await fs.unlink(targetPath).catch(() => {});
            await fs.rename(temporaryPath, targetPath);
        }
        return true;
    } catch {
        await fs.unlink(temporaryPath).catch(() => {});
        return false;
    }
}

async function rememberRecentSticker(rootPath, candidatePath, maximum = 60) {
    const stickerPath = await resolveLocalStickerPath(rootPath, candidatePath);
    if (!stickerPath) {
        return { ok: false, reason: 'invalid-sticker-path' };
    }
    const current = await readRecentStickerPaths(rootPath);
    const stickerKey = normalizePathKey(stickerPath);
    const next = [
        stickerPath,
        ...current.filter(filePath => normalizePathKey(filePath) !== stickerKey)
    ].slice(0, clampInteger(maximum, 1, 256, 60));
    return await writeRecentStickerPaths(rootPath, next)
        ? { ok: true, paths: next }
        : { ok: false, reason: 'recent-history-write-failed', paths: next };
}

async function writeJsonAtomic(filePath, value) {
    const temporaryPath = path.join(
        path.dirname(filePath),
        `.qqnt-toolbox-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`
    );
    try {
        await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
        try {
            await fs.rename(temporaryPath, filePath);
        } catch {
            await fs.unlink(filePath).catch(() => {});
            await fs.rename(temporaryPath, filePath);
        }
    } catch (error) {
        await fs.unlink(temporaryPath).catch(() => {});
        throw error;
    }
}

async function updateLocalStickerPackOrder(rootPath, orderedPackPaths, options = {}) {
    const scanResult = await scanLocalStickerPacks(rootPath, options);
    if (scanResult.status !== 'success') {
        return { ok: false, reason: 'no-sticker-packs', msg: scanResult.msg };
    }

    const knownPacks = new Map(scanResult.stickerPacks.map(pack => [
        normalizePathKey(pack.dirPath),
        pack
    ]));
    const requested = [];
    const seen = new Set();
    for (const value of Array.isArray(orderedPackPaths) ? orderedPackPaths : []) {
        const key = normalizePathKey(value);
        if (!key || seen.has(key)) {
            continue;
        }
        const pack = knownPacks.get(key);
        if (!pack) {
            return { ok: false, reason: 'unknown-sticker-pack' };
        }
        seen.add(key);
        requested.push(pack);
    }
    for (const pack of scanResult.stickerPacks) {
        const key = normalizePathKey(pack.dirPath);
        if (!seen.has(key)) {
            seen.add(key);
            requested.push(pack);
        }
    }

    let updated = 0;
    for (let index = 0; index < requested.length; index += 1) {
        const pack = requested[index];
        if (pack.index === index) {
            continue;
        }
        const metadataPath = path.join(pack.dirPath, 'sticker.json');
        const current = await readBoundedJson(metadataPath, DEFAULT_SCAN_LIMITS.maxMetadataBytes);
        const metadata = current && typeof current === 'object' && !Array.isArray(current)
            ? current
            : {};
        await writeJsonAtomic(metadataPath, {
            ...metadata,
            label: String(metadata.label || pack.label).slice(0, 80),
            index
        });
        updated += 1;
    }
    return {
        ok: true,
        updated,
        order: requested.map(pack => pack.dirPath)
    };
}

module.exports = {
    DEFAULT_LOCAL_STICKER_CONFIG,
    DEFAULT_SCAN_LIMITS,
    LOCAL_STICKER_ENTRY_MODES,
    RECENT_STICKERS_FILE,
    SUPPORTED_STICKER_EXTENSIONS,
    buildLocalStickerStore,
    isPathInside,
    isSupportedStickerPath,
    normalizeLocalStickerConfig,
    normalizePathKey,
    readRecentStickerPaths,
    rememberRecentSticker,
    resolveLocalStickerPath,
    scanLocalStickerPacks,
    updateLocalStickerPackOrder
};
