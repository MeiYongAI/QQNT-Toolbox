const { app, BrowserWindow, clipboard, ipcMain, nativeImage, shell } = require('electron');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { serialize, deserialize } = require('v8');
const { deflateSync, inflateSync } = require('zlib');

const PLUGIN_SLUG = 'qqnt_toolbox';
const PLUGIN_NAME = 'QQNT Toolbox';
const MSG_UPDATE_CMD = 'nodeIKernelMsgListener/onMsgInfoListUpdate';
const SEND_STATUS_FAILED = 0;
const SEND_STATUS_SUCCESS_NO_SEQ = 3;
const MAX_RETRY_PER_RECORD = 1;
const RETRY_DELAY_MS = 800;
const REPAIR_FILE_TTL_MS = 24 * 60 * 60 * 1000;
const CHANNEL_GET_CONFIG = 'qqnt-toolbox:get-config';
const CHANNEL_SET_CONFIG = 'qqnt-toolbox:set-config';
const CHANNEL_CONFIG_CHANGED = 'qqnt-toolbox:config-changed';
const CHANNEL_REPEAT_MESSAGE = 'qqnt-toolbox:repeat-message';
const CHANNEL_CLEAR_RECALL_CACHE = 'qqnt-toolbox:clear-recall-cache';
const CHANNEL_OPEN_RECALL_DIR = 'qqnt-toolbox:open-recall-dir';
const CHANNEL_OPEN_RECALL_IMAGE_DIR = 'qqnt-toolbox:open-recall-image-dir';
const CHANNEL_VIEW_RECALL_MESSAGES = 'qqnt-toolbox:view-recall-messages';
const CHANNEL_GET_RECALL_VIEWER_DATA = 'qqnt-toolbox:get-recall-viewer-data';
const CHANNEL_GET_RECALL_AUDIO_PREVIEW = 'qqnt-toolbox:get-recall-audio-preview';
const CHANNEL_JUMP_RECALL_MESSAGE = 'qqnt-toolbox:jump-recall-message';
const CHANNEL_COPY_RECALL_TEXT = 'qqnt-toolbox:copy-recall-text';
const MAX_RECALL_CACHE_SIZE = 100000;
const IMAGE_EXTENSIONS = new Set([
    '.apng', '.bmp', '.gif', '.jfif', '.jpeg', '.jpg', '.png', '.webp'
]);
let voiceFileSender = null;
try {
    voiceFileSender = require('./voice-file-sender');
} catch {
    voiceFileSender = null;
}
const DEFAULT_CONFIG = {
    imageRetryFixer: {
        enabled: true
    },
    repeatMessage: {
        enabled: true,
        doubleClick: false,
        showInContextMenu: true
    },
    voiceMessage: {
        enabled: true,
        saveInContextMenu: true
    },
    messageTweaks: {
        removeReplyAt: false
    },
    preventRecall: {
        enabled: false,
        preventSelfMsg: false,
        persistedFiles: true,
        redirectPicPath: true,
        customColor: false,
        customTextColor: {
            light: '#ff6666',
            dark: '#c70000'
        }
    },
    interfaceTweaks: {
        imageViewerOptimization: false,
        goBackMainList: false,
        preventMessageDrag: false,
        deleteBubbleSkin: false,
        hiddenWeatherBtn: false,
        hiddenClassicBtn: false,
        hiddenLockBtn: false,
        hiddenLogoutBtn: false,
        hiddenUpdateBtnAndNotice: false,
        removeVipColor: false
    },
    sideBar: {
        top: [],
        bottom: []
    },
    topFuncBar: [],
    chatFuncBar: [],
    debug: {
        enabled: false
    }
};

const windowStates = new WeakMap();
const cleanupState = {
    lastRunAt: 0
};
const recallState = {
    liveMessages: new Map(),
    recalledMessages: new Map(),
    persistedIds: new Set(),
    loaded: false
};
let configCache = null;
let recallViewerWindow = null;
const recallViewerRecordIndex = new Map();

function isDebugEnabled() {
    return process.env.QQNT_TOOLBOX_DEBUG === '1' || configCache?.debug?.enabled === true;
}

function debug(...args) {
    if (isDebugEnabled()) {
        console.log(`[${PLUGIN_NAME}]`, ...args);
    }
}

function warn(...args) {
    if (isDebugEnabled()) {
        console.warn(`[${PLUGIN_NAME}]`, ...args);
    }
}

function safeJson(value) {
    try {
        return JSON.stringify(value, (key, item) => {
            if (item instanceof Map) {
                return Object.fromEntries(item);
            }
            if (Buffer.isBuffer(item) || item instanceof Uint8Array) {
                return {
                    type: item.constructor.name,
                    length: item.length
                };
            }
            return item;
        });
    } catch (error) {
        return String(value);
    }
}

function getLiteLoaderPluginDataDir() {
    const plugins = globalThis.LiteLoader?.plugins || global.LiteLoader?.plugins;
    if (!plugins) {
        return '';
    }
    for (const key of [PLUGIN_SLUG, PLUGIN_NAME]) {
        if (plugins[key]?.path?.data) {
            return plugins[key].path.data;
        }
    }
    for (const plugin of Object.values(plugins)) {
        if (plugin?.manifest?.slug === PLUGIN_SLUG || plugin?.manifest?.name === PLUGIN_NAME) {
            return plugin?.path?.data || '';
        }
    }
    return '';
}

function getPluginDataDir() {
    return getLiteLoaderPluginDataDir() || path.join(os.homedir(), 'Documents', 'LiteLoaderQQNT', 'data', PLUGIN_SLUG);
}

function getRepairDir() {
    return path.join(getPluginDataDir(), 'image-retry');
}

function getPreventRecallDir() {
    return path.join(getPluginDataDir(), 'prevent-recall');
}

function getPreventRecallLogPath() {
    return path.join(getPreventRecallDir(), 'recalled-messages.jsonl');
}

function getPreventRecallCachePath() {
    return path.join(getPreventRecallDir(), 'active-recall-cache.bin');
}

function getPreventRecallImageDir() {
    return path.join(getPreventRecallDir(), 'images');
}

function getConfigPath() {
    return path.join(getPluginDataDir(), 'config.json');
}

function clonePlain(value) {
    return JSON.parse(JSON.stringify(value));
}

function mergeConfig(value, defaults = DEFAULT_CONFIG) {
    const source = value && typeof value === 'object' ? value : {};
    const result = Array.isArray(defaults) ? [] : {};
    for (const [key, defaultValue] of Object.entries(defaults)) {
        const sourceValue = source[key];
        if (defaultValue && typeof defaultValue === 'object' && !Array.isArray(defaultValue)) {
            result[key] = mergeConfig(sourceValue, defaultValue);
        } else {
            result[key] = typeof sourceValue === typeof defaultValue ? sourceValue : defaultValue;
        }
    }
    return result;
}

function loadConfig() {
    if (configCache) {
        return clonePlain(configCache);
    }
    const configPath = getConfigPath();
    try {
        fsSync.mkdirSync(path.dirname(configPath), { recursive: true });
        if (!fsSync.existsSync(configPath)) {
            configCache = clonePlain(DEFAULT_CONFIG);
            fsSync.writeFileSync(configPath, JSON.stringify(configCache, null, 2), 'utf8');
            return clonePlain(configCache);
        }
        configCache = mergeConfig(JSON.parse(fsSync.readFileSync(configPath, 'utf8')));
        fsSync.writeFileSync(configPath, JSON.stringify(configCache, null, 2), 'utf8');
        return clonePlain(configCache);
    } catch (error) {
        warn('config load failed:', error?.message || error);
        configCache = clonePlain(DEFAULT_CONFIG);
        return clonePlain(configCache);
    }
}

async function saveConfig(nextConfig) {
    const configPath = getConfigPath();
    configCache = mergeConfig(nextConfig);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(configCache, null, 2), 'utf8');
    applyVoiceMessageConfig();
    broadcastConfigChanged();
    return clonePlain(configCache);
}

function getConfig() {
    return loadConfig();
}

function isImageRetryEnabled() {
    return getConfig().imageRetryFixer.enabled !== false;
}

function isRepeatMessageEnabled() {
    return getConfig().repeatMessage.enabled !== false;
}

function isVoiceMessageEnabled() {
    return getConfig().voiceMessage.enabled !== false;
}

function isVoiceSaveInContextMenuEnabled() {
    return getConfig().voiceMessage.saveInContextMenu !== false;
}

function getPreventRecallConfig() {
    return getConfig().preventRecall;
}

function isPreventRecallEnabled() {
    return getPreventRecallConfig().enabled === true;
}

function applyVoiceMessageConfig() {
    voiceFileSender?.setEnabled?.(isVoiceMessageEnabled());
    voiceFileSender?.setSaveInContextMenuEnabled?.(isVoiceSaveInContextMenuEnabled());
}

function broadcastConfigChanged() {
    const config = clonePlain(configCache || DEFAULT_CONFIG);
    for (const browserWindow of BrowserWindow.getAllWindows()) {
        if (!browserWindow.isDestroyed()) {
            browserWindow.webContents.send(CHANNEL_CONFIG_CHANGED, config);
        }
    }
}

function installConfigIpc() {
    if (globalThis.__qqntToolboxConfigIpcInstalled) {
        return;
    }
    globalThis.__qqntToolboxConfigIpcInstalled = true;
    ipcMain.handle(CHANNEL_GET_CONFIG, () => getConfig());
    ipcMain.handle(CHANNEL_SET_CONFIG, (_event, nextConfig) => saveConfig(nextConfig));
    ipcMain.handle(CHANNEL_REPEAT_MESSAGE, async (event, payload) => {
        const browserWindow = BrowserWindow.fromWebContents(event.sender);
        if (!browserWindow) {
            throw new Error('BrowserWindow was not found.');
        }
        return await repeatMessageFromRenderer(browserWindow, payload);
    });
    ipcMain.handle(CHANNEL_CLEAR_RECALL_CACHE, async () => clearPreventRecallCache());
    ipcMain.handle(CHANNEL_OPEN_RECALL_DIR, async () => openPreventRecallDir());
    ipcMain.handle(CHANNEL_OPEN_RECALL_IMAGE_DIR, async () => openPreventRecallImageDir());
    ipcMain.handle(CHANNEL_VIEW_RECALL_MESSAGES, async () => openPreventRecallMessages());
    ipcMain.handle(CHANNEL_GET_RECALL_VIEWER_DATA, async () => getRecallViewerData());
    ipcMain.handle(CHANNEL_GET_RECALL_AUDIO_PREVIEW, (_event, payload) => getRecallAudioPreview(payload));
    ipcMain.handle(CHANNEL_JUMP_RECALL_MESSAGE, (_event, payload) => jumpToRecallMessage(payload));
    ipcMain.handle(CHANNEL_COPY_RECALL_TEXT, (_event, value) => {
        const text = String(value ?? '');
        clipboard.writeText(text);
        return Boolean(text);
    });
}

function normalizeText(value) {
    const text = String(value ?? '').trim();
    return text && text !== 'undefined' && text !== 'null' && text !== '0' ? text : '';
}

function normalizePathText(value) {
    const text = normalizeText(value);
    return text ? path.normalize(text) : '';
}

function normalizeComparablePath(filePath) {
    return String(filePath || '').replace(/\//g, '\\').toLowerCase();
}

function isPlainEmptyObject(value) {
    return Boolean(value) &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !(value instanceof Map) &&
        !(value instanceof Uint8Array) &&
        Object.keys(value).length === 0;
}

function isNativeFailure(value) {
    return value?.promiseStatue === 'fail' ||
        value?.promiseStatus === 'fail' ||
        value?.result === false ||
        Number(value?.result) < 0 ||
        Number(value?.retCode) < 0 ||
        Number(value?.errCode) < 0;
}

function unwrapNativeValue(value) {
    if (!value || typeof value !== 'object' || value instanceof Map || value instanceof Uint8Array) {
        return value;
    }
    for (const key of ['result', 'data', 'value', 'id']) {
        if (value[key] !== undefined && !isPlainEmptyObject(value[key])) {
            return value[key];
        }
    }
    return value;
}

function extractNativeResult(response, result) {
    if (isNativeFailure(response)) {
        return response;
    }
    if (result !== undefined && !isPlainEmptyObject(result)) {
        return result;
    }
    for (const item of [result, response]) {
        if (!item || typeof item !== 'object') {
            continue;
        }
        for (const key of ['payload', 'result', 'data', 'value', 'path', 'filePath', 'newPath']) {
            if (item[key] !== undefined && !isPlainEmptyObject(item[key])) {
                return item[key];
            }
        }
    }
    return result;
}

function getWindowState(browserWindow) {
    let state = windowStates.get(browserWindow);
    if (!state) {
        state = {
            nativeSendPatched: false,
            originalSend: null,
            nativeWaiters: new Set(),
            peerUidByUin: new Map(),
            retriedRecords: new Map(),
            inFlightRecords: new Set(),
            pluginAttrIds: new Map()
        };
        windowStates.set(browserWindow, state);
    }
    return state;
}

function collectNativePeerAliases(value, results = [], depth = 0, seen = new WeakSet()) {
    if (!value || depth > 7 || results.length > 100) {
        return results;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectNativePeerAliases(item, results, depth + 1, seen);
        }
        return results;
    }
    if (typeof value !== 'object' || value instanceof Uint8Array || value instanceof Map) {
        return results;
    }
    if (seen.has(value)) {
        return results;
    }
    seen.add(value);

    const chatType = Number(value.chatType || value.type || value.aioType || value.peer?.chatType || value.header?.chatType) || 0;
    const addAlias = (peerUid, peerUin) => {
        peerUid = normalizeText(peerUid);
        peerUin = normalizeText(peerUin);
        if ((chatType === 1 || chatType === 100 || !chatType) && peerUid.startsWith('u_') && /^\d+$/.test(peerUin)) {
            results.push({ peerUin, peerUid });
        }
    };
    addAlias(value.peerUid || value.peer?.peerUid || value.header?.peerUid, value.peerUin || value.peer?.peerUin || value.header?.peerUin);
    addAlias(value.senderUid || value.sender?.uid || value.sender?.peerUid, value.senderUin || value.sender?.uin || value.sender?.peerUin);
    addAlias(value.uid || value.peer?.uid || value.header?.uid, value.uin || value.chatUin || value.peer?.uin || value.header?.uin);

    for (const key of ['payload', 'msgList', 'elements', 'records', 'data', 'result', 'msgElements', 'peer', 'header', 'sender', 'sendMember']) {
        collectNativePeerAliases(value[key], results, depth + 1, seen);
    }
    return results;
}

function rememberNativePeerAliases(browserWindow, args) {
    const state = getWindowState(browserWindow);
    for (const arg of args) {
        for (const alias of collectNativePeerAliases(arg)) {
            state.peerUidByUin.set(alias.peerUin, alias.peerUid);
        }
    }
}

function getMsgAttrId(msgRecord) {
    const attrs = msgRecord?.msgAttrs;
    if (!attrs) {
        return undefined;
    }
    if (attrs instanceof Map) {
        return attrs.get(0)?.attrId;
    }
    return attrs[0]?.attrId || attrs['0']?.attrId;
}

function collectMsgRecords(value, records = [], depth = 0, seen = new WeakSet()) {
    if (!value || depth > 7 || records.length > 200) {
        return records;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectMsgRecords(item, records, depth + 1, seen);
        }
        return records;
    }
    if (typeof value !== 'object' || value instanceof Uint8Array || value instanceof Map) {
        return records;
    }
    if (seen.has(value)) {
        return records;
    }
    seen.add(value);

    if ((value.msgId !== undefined || value.msgSeq !== undefined) && Array.isArray(value.elements)) {
        records.push(value);
        return records;
    }
    for (const key of ['payload', 'msgList', 'records', 'data', 'result', 'msgRecords', 'msgRecord']) {
        collectMsgRecords(value[key], records, depth + 1, seen);
    }
    return records;
}

function isMsgRecord(value) {
    return Boolean(value && typeof value === 'object' && (value.msgId !== undefined || value.msgSeq !== undefined) && Array.isArray(value.elements));
}

function processDeleteBubbleSkin(args) {
    if (!getConfig().interfaceTweaks.deleteBubbleSkin) {
        return;
    }
    const records = [];
    for (const arg of args) {
        collectMsgRecords(arg, records);
    }
    for (const record of new Set(records)) {
        const attributes = record?.msgAttrs;
        const attribute = attributes instanceof Map ? attributes.get(0) : attributes?.[0] || attributes?.['0'];
        if (!attribute?.vasMsgInfo?.bubbleInfo) {
            continue;
        }
        attribute.vasMsgInfo.bubbleInfo = {
            bubbleId: 0,
            bubbleDiyTextId: null,
            subBubbleId: null,
            canConvertToText: null
        };
    }
}

function containsUnitedConfigGroup(value, depth = 0, seen = new WeakSet()) {
    if (!value || depth > 7) {
        return false;
    }
    if (Array.isArray(value)) {
        return value.some(item => containsUnitedConfigGroup(item, depth + 1, seen));
    }
    if (typeof value !== 'object' || value instanceof Uint8Array || value instanceof Map) {
        return false;
    }
    if (seen.has(value)) {
        return false;
    }
    seen.add(value);
    if (['100084', '100243'].includes(String(value?.configData?.group || value?.group || ''))) {
        return true;
    }
    return Object.values(value).some(item => containsUnitedConfigGroup(item, depth + 1, seen));
}

function shouldBlockUpdateNotice(args) {
    return getConfig().interfaceTweaks.hiddenUpdateBtnAndNotice === true &&
        args.some(arg => containsUnitedConfigGroup(arg));
}

function getRecallInfo(record) {
    if (!record || !Array.isArray(record.elements) || record.elements.length !== 1) {
        return null;
    }
    const grayTip = record.elements[0]?.grayTipElement;
    return grayTip?.subElementType === 1 ? grayTip.revokeElement || null : null;
}

function createRecallMark(record) {
    const recallInfo = getRecallInfo(record) || {};
    return {
        operatorNick: normalizeText(recallInfo.operatorNick),
        operatorRemark: normalizeText(recallInfo.operatorRemark),
        operatorMemRemark: normalizeText(recallInfo.operatorMemRemark),
        origMsgSenderNick: normalizeText(recallInfo.origMsgSenderNick),
        origMsgSenderRemark: normalizeText(recallInfo.origMsgSenderRemark),
        origMsgSenderMemRemark: normalizeText(recallInfo.origMsgSenderMemRemark),
        recallTime: normalizeText(record?.recallTime)
    };
}

function getRecallKey(record) {
    return normalizeText(record?.msgId);
}

function pruneRecallCache() {
    while (recallState.liveMessages.size > MAX_RECALL_CACHE_SIZE) {
        recallState.liveMessages.delete(recallState.liveMessages.keys().next().value);
    }
    while (recallState.recalledMessages.size > MAX_RECALL_CACHE_SIZE) {
        recallState.recalledMessages.delete(recallState.recalledMessages.keys().next().value);
    }
}

function cloneRecallRecord(record) {
    const clone = deepCloneForSend(record);
    clone.lt_recall = record.lt_recall || record.qqnt_toolbox_recall;
    clone.qqnt_toolbox_recall = clone.lt_recall;
    return clone;
}

function localizeRecallImages(record) {
    if (!getPreventRecallConfig().redirectPicPath) {
        return;
    }
    for (const element of getRecordElements(record)) {
        const pic = element?.picElement;
        if (!pic) {
            continue;
        }
        const sourcePath = getPicSourcePath(pic);
        if (!sourcePath) {
            continue;
        }
        try {
            fsSync.mkdirSync(getPreventRecallImageDir(), { recursive: true });
            const targetPath = path.join(getPreventRecallImageDir(), path.basename(sourcePath));
            if (!fsSync.existsSync(targetPath)) {
                fsSync.copyFileSync(sourcePath, targetPath);
            }
            pic.sourcePath = targetPath;
            pic.filePath = targetPath;
            pic.originPath = targetPath;
            if (pic.thumbPath instanceof Map) {
                for (const key of pic.thumbPath.keys()) {
                    pic.thumbPath.set(key, targetPath);
                }
            }
        } catch (error) {
            warn('recall image localize failed:', error?.message || error);
        }
    }
}

function persistRecallRecord(record) {
    if (!getPreventRecallConfig().persistedFiles) {
        return;
    }
    const msgId = getRecallKey(record);
    if (!msgId || recallState.persistedIds.has(msgId)) {
        return;
    }
    try {
        fsSync.mkdirSync(getPreventRecallDir(), { recursive: true });
        const payload = deflateSync(serialize(record));
        const length = Buffer.allocUnsafe(4);
        length.writeUInt32BE(payload.length);
        fsSync.appendFileSync(getPreventRecallCachePath(), Buffer.concat([length, payload]));
        recallState.persistedIds.add(msgId);
    } catch (error) {
        warn('recall persist failed:', error?.message || error);
    }
}

function loadPersistedRecallCache() {
    if (recallState.loaded) {
        return;
    }
    recallState.loaded = true;
    const cachePath = getPreventRecallCachePath();
    try {
        fsSync.mkdirSync(getPreventRecallDir(), { recursive: true });
        if (!fsSync.existsSync(cachePath)) {
            fsSync.writeFileSync(cachePath, Buffer.alloc(0));
            return;
        }
        const data = fsSync.readFileSync(cachePath);
        let offset = 0;
        while (offset + 4 <= data.length) {
            const length = data.readUInt32BE(offset);
            offset += 4;
            if (!length || offset + length > data.length) {
                break;
            }
            const record = deserialize(inflateSync(data.subarray(offset, offset + length)));
            offset += length;
            const msgId = getRecallKey(record);
            if (!msgId || !(record?.qqnt_toolbox_recall || record?.lt_recall)) {
                continue;
            }
            recallState.recalledMessages.set(msgId, record);
            recallState.persistedIds.add(msgId);
        }
        pruneRecallCache();
    } catch (error) {
        warn('recall cache load failed:', error?.message || error);
    }
}

function cacheRecallCandidate(record) {
    const msgId = getRecallKey(record);
    if (!msgId || !getRecordElements(record).length || getRecallInfo(record) || record?.lt_recall || record?.qqnt_toolbox_recall) {
        return;
    }
    recallState.liveMessages.set(msgId, deepCloneForSend(record));
    pruneRecallCache();
}

function getRecoveredRecallRecord(record) {
    const recallInfo = getRecallInfo(record);
    if (!recallInfo) {
        return null;
    }
    const config = getPreventRecallConfig();
    if (recallInfo.isSelfOperate && !config.preventSelfMsg) {
        return null;
    }
    const msgId = getRecallKey(record);
    const cached = recallState.liveMessages.get(msgId) || recallState.recalledMessages.get(msgId);
    if (!cached) {
        return null;
    }
    const recovered = cloneRecallRecord(cached);
    recovered.lt_recall = createRecallMark(record);
    recovered.qqnt_toolbox_recall = recovered.lt_recall;
    localizeRecallImages(recovered);
    recallState.liveMessages.delete(msgId);
    recallState.recalledMessages.set(msgId, deepCloneForSend(recovered));
    persistRecallRecord(recovered);
    pruneRecallCache();
    return recovered;
}

function processPreventRecallInValue(value, depth = 0, seen = new WeakSet()) {
    if (!isPreventRecallEnabled() || !value || depth > 7) {
        return false;
    }
    if (Array.isArray(value)) {
        let changed = false;
        for (let index = 0; index < value.length; index++) {
            const item = value[index];
            if (isMsgRecord(item)) {
                const recovered = getRecoveredRecallRecord(item);
                if (recovered) {
                    value[index] = recovered;
                    changed = true;
                } else {
                    cacheRecallCandidate(item);
                }
            } else if (processPreventRecallInValue(item, depth + 1, seen)) {
                changed = true;
            }
        }
        return changed;
    }
    if (typeof value !== 'object' || value instanceof Uint8Array || value instanceof Map) {
        return false;
    }
    if (seen.has(value)) {
        return false;
    }
    seen.add(value);
    if (isMsgRecord(value)) {
        const recovered = getRecoveredRecallRecord(value);
        if (recovered) {
            Object.keys(value).forEach(key => delete value[key]);
            Object.assign(value, recovered);
            return true;
        }
        cacheRecallCandidate(value);
        return false;
    }
    let changed = false;
    for (const key of ['payload', 'msgList', 'records', 'data', 'result', 'msgRecords', 'msgRecord']) {
        if (processPreventRecallInValue(value[key], depth + 1, seen)) {
            changed = true;
        }
    }
    return changed;
}

function processPreventRecall(args) {
    if (!isPreventRecallEnabled()) {
        return;
    }
    for (const arg of args) {
        processPreventRecallInValue(arg);
    }
}

async function clearPreventRecallCache() {
    recallState.liveMessages.clear();
    recallState.recalledMessages.clear();
    recallState.persistedIds.clear();
    await fs.rm(getPreventRecallDir(), { recursive: true, force: true });
    await fs.mkdir(getPreventRecallDir(), { recursive: true });
    await fs.writeFile(getPreventRecallCachePath(), Buffer.alloc(0));
    return { success: true };
}

async function openPreventRecallDir() {
    await fs.mkdir(getPreventRecallDir(), { recursive: true });
    return await shell.openPath(getPreventRecallDir());
}

async function openPreventRecallImageDir() {
    await fs.mkdir(getPreventRecallImageDir(), { recursive: true });
    return await shell.openPath(getPreventRecallImageDir());
}

function getRecallDisplayName(record) {
    const mark = record?.qqnt_toolbox_recall || record?.lt_recall || {};
    return normalizeText(mark.origMsgSenderRemark) ||
        normalizeText(mark.origMsgSenderMemRemark) ||
        normalizeText(mark.origMsgSenderNick) ||
        normalizeText(record?.sendRemarkName) ||
        normalizeText(record?.sendMemberName) ||
        normalizeText(record?.sendNickName) ||
        normalizeText(record?.senderNick) ||
        normalizeText(record?.senderUid) ||
        normalizeText(record?.senderUin) ||
        '未知发送者';
}

async function readPersistedRecallRecords() {
    const logPath = getPreventRecallLogPath();
    if (!fsSync.existsSync(logPath)) {
        return [];
    }
    const textContent = await fs.readFile(logPath, 'utf8');
    return textContent
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            try {
                return JSON.parse(line);
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

async function getAllPreventRecallRecords() {
    const recordsByKey = new Map();
    const addRecord = record => {
        if (!record || typeof record !== 'object') {
            return;
        }
        const key = normalizeText(record.msgId) ||
            `${normalizeText(record.peerUid || record.peer?.peerUid)}:${normalizeText(record.msgSeq)}:${recordsByKey.size}`;
        recordsByKey.set(key || String(recordsByKey.size), record);
    };
    for (const record of await readPersistedRecallRecords()) {
        addRecord(record);
    }
    for (const record of recallState.recalledMessages.values()) {
        addRecord(record);
    }
    return Array.from(recordsByKey.values());
}

function getRecallOperatorName(record) {
    const mark = record?.qqnt_toolbox_recall || record?.lt_recall || {};
    return normalizeText(mark.operatorRemark) ||
        normalizeText(mark.operatorMemRemark) ||
        normalizeText(mark.operatorNick) ||
        '未知用户';
}

function getRecallPeerName(record) {
    const chatType = Number(record?.chatType);
    if (chatType === 2) {
        return normalizeText(record?.peerName) || normalizeText(record?.peerUin) || normalizeText(record?.peerUid) || '未知群聊';
    }
    return normalizeText(record?.peerName) ||
        normalizeText(record?.sendRemarkName) ||
        normalizeText(record?.sendNickName) ||
        normalizeText(record?.peerUin) ||
        normalizeText(record?.peerUid) ||
        '未知会话';
}

function getQqNumber(...values) {
    for (const value of values) {
        const number = normalizeText(value);
        if (/^[1-9]\d+$/.test(number)) {
            return number;
        }
    }
    return '';
}

function getUserAvatarUrl(...values) {
    const uin = getQqNumber(...values);
    return uin ? `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=100` : '';
}

function getRecallPeerAvatarUrl(record) {
    const peerUin = getQqNumber(record?.peerUin, record?.peer?.peerUin, record?.peerUid);
    if (!peerUin) {
        return '';
    }
    if (Number(record?.chatType) === 2) {
        return `https://p.qlogo.cn/gh/${peerUin}/${peerUin}/100/`;
    }
    return getUserAvatarUrl(peerUin);
}

function getViewerFileUrl(...values) {
    const candidates = [];
    const seen = new WeakSet();
    const collect = (value, depth = 0) => {
        if (value === undefined || value === null || depth > 2) {
            return;
        }
        if (typeof value === 'string') {
            candidates.push(value);
            return;
        }
        if (ArrayBuffer.isView(value)) {
            return;
        }
        if (typeof value === 'object') {
            if (seen.has(value)) {
                return;
            }
            seen.add(value);
        }
        if (Array.isArray(value)) {
            value.forEach(item => collect(item, depth + 1));
            return;
        }
        if (value instanceof Map) {
            value.forEach(item => collect(item, depth + 1));
            return;
        }
        if (typeof value === 'object') {
            Object.values(value).forEach(item => collect(item, depth + 1));
        }
    };
    values.forEach(value => collect(value));
    for (const candidate of candidates) {
        if (/^https?:\/\//i.test(candidate)) {
            continue;
        }
        const filePath = normalizePathText(candidate);
        try {
            if (filePath && fsSync.existsSync(filePath) && fsSync.statSync(filePath).isFile()) {
                return pathToFileURL(filePath).href;
            }
        } catch {
        }
    }
    return '';
}

function getViewerRemoteUrl(...values) {
    const queue = [...values];
    const seen = new WeakSet();
    while (queue.length) {
        const value = queue.shift();
        if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
            return value;
        }
        if (ArrayBuffer.isView(value)) {
            continue;
        }
        if (value && typeof value === 'object') {
            if (seen.has(value)) {
                continue;
            }
            seen.add(value);
        }
        if (Array.isArray(value)) {
            queue.push(...value);
        } else if (value instanceof Map) {
            queue.push(...value.values());
        } else if (value && typeof value === 'object') {
            queue.push(...Object.values(value));
        }
    }
    return '';
}

function getMessageContentText(value) {
    if (value === undefined || value === null) {
        return '';
    }
    const content = String(value);
    return content === 'undefined' || content === 'null' ? '' : content;
}

function getReplyPreview(reply) {
    const direct = getMessageContentText(reply?.sourceMsgText);
    if (direct.trim()) {
        return direct;
    }
    return (Array.isArray(reply?.sourceMsgTextElems) ? reply.sourceMsgTextElems : [])
        .map(item => getMessageContentText(item?.textElemContent) || (item?.picElem ? '[图片]' : ''))
        .filter(Boolean)
        .join(' ');
}

function getRecallViewerContent(record) {
    const parts = [];
    for (const [elementIndex, element] of getRecordElements(record).entries()) {
        const textContent = getMessageContentText(element?.textElement?.content);
        if (textContent) {
            const atType = Number(element?.textElement?.atType) || 0;
            parts.push({
                type: atType ? 'mention' : 'text',
                text: textContent,
                atType,
                atUid: normalizeText(element.textElement.atUid),
                atNtUid: normalizeText(element.textElement.atNtUid)
            });
            continue;
        }
        if (element?.picElement) {
            const imagePath = getPicSourcePath(element.picElement);
            parts.push({
                type: 'image',
                src: imagePath ? pathToFileURL(imagePath).href : getViewerRemoteUrl(
                    element.picElement.emojiWebUrl,
                    element.picElement.originImageUrl,
                    element.picElement.thumbPath
                ),
                name: normalizeText(element.picElement.summary) || normalizeText(element.picElement.fileName) || '图片',
                width: Number(element.picElement.picWidth) || 0,
                height: Number(element.picElement.picHeight) || 0
            });
            continue;
        }
        if (element?.pttElement) {
            parts.push({
                type: 'voice',
                elementIndex,
                name: normalizeText(element.pttElement.fileName) || '语音消息',
                duration: Number(element.pttElement.duration) || 0,
                transcript: getMessageContentText(element.pttElement.text),
                waves: (Array.isArray(element.pttElement.waveAmplitudes) ? element.pttElement.waveAmplitudes : [])
                    .slice(0, 36)
                    .map(value => Math.abs(Number(value) || 0))
            });
            continue;
        }
        if (element?.fileElement) {
            parts.push({
                type: 'file',
                name: normalizeText(element.fileElement.fileName) || '文件',
                size: Number(element.fileElement.fileSize) || 0,
                path: getViewerFileUrl(element.fileElement.filePath, element.fileElement.sourcePath)
            });
            continue;
        }
        if (element?.videoElement) {
            parts.push({
                type: 'video',
                name: normalizeText(element.videoElement.fileName) || '视频',
                size: Number(element.videoElement.fileSize) || 0,
                duration: Number(element.videoElement.duration) || 0,
                src: getViewerFileUrl(element.videoElement.filePath, element.videoElement.sourcePath),
                poster: getViewerFileUrl(element.videoElement.thumbPath, element.videoElement.coverPath)
            });
            continue;
        }
        if (element?.replyElement) {
            parts.push({
                type: 'reply',
                text: getReplyPreview(element.replyElement) || '[消息]',
                sender: normalizeText(element.replyElement.senderUid) || normalizeText(element.replyElement.anonymousNickName)
            });
            continue;
        }
        if (element?.marketFaceElement) {
            parts.push({
                type: 'face',
                name: normalizeText(element.marketFaceElement.faceName) || '表情',
                src: getViewerFileUrl(
                    element.marketFaceElement.staticFacePath,
                    element.marketFaceElement.dynamicFacePath
                ) || getViewerRemoteUrl(element.marketFaceElement)
            });
            continue;
        }
        if (element?.faceElement) {
            parts.push({
                type: 'face',
                name: normalizeText(element.faceElement.faceName) || normalizeText(element.faceElement.faceText) || 'QQ 表情',
                src: ''
            });
            continue;
        }
        if (element?.arkElement) {
            parts.push({
                type: 'card',
                title: normalizeText(element.arkElement.prompt) || '卡片消息',
                subtitle: normalizeText(element.arkElement.appName) || normalizeText(element.arkElement.appView)
            });
            continue;
        }
        if (element?.markdownElement) {
            const flash = element.markdownElement.mdExtInfo?.flashTransferInfo;
            parts.push({
                type: 'card',
                title: normalizeText(flash?.name) || normalizeText(element.markdownElement.mdSummary) || 'Markdown 消息',
                subtitle: flash?.fileSize ? `${Number(flash.fileSize) || 0}` : '',
                image: getViewerRemoteUrl(flash?.thnumbnail, flash?.thumbnail)
            });
            continue;
        }
        if (element?.multiForwardMsgElement) {
            parts.push({
                type: 'forward',
                xml: normalizeText(element.multiForwardMsgElement.xmlContent),
                name: normalizeText(element.multiForwardMsgElement.fileName)
            });
            continue;
        }
        if (element?.grayTipElement) {
            parts.push({ type: 'notice', text: getMessageContentText(element.grayTipElement.content) || '系统消息' });
            continue;
        }
        parts.push({
            type: 'unsupported',
            text: `暂不支持的消息类型 (${Number(element?.elementType) || 0})`
        });
    }
    return { parts };
}

async function getRecallViewerData() {
    const records = await getAllPreventRecallRecords();
    const chats = new Map();
    recallViewerRecordIndex.clear();
    for (const record of records) {
        const peerUid = normalizeText(record?.peerUid || record?.peer?.peerUid);
        if (!peerUid) {
            continue;
        }
        const chatType = Number(record?.chatType) || 0;
        const key = `${chatType}:${peerUid}`;
        const mark = record?.qqnt_toolbox_recall || record?.lt_recall || {};
        const msgId = normalizeText(record?.msgId);
        if (msgId) {
            recallViewerRecordIndex.set(msgId, record);
        }
        const message = {
            msgId,
            peerUid,
            peerUin: normalizeText(record?.peerUin),
            chatType,
            sender: getRecallDisplayName(record),
            senderUin: getQqNumber(record?.senderUin),
            senderUid: normalizeText(record?.senderUid),
            avatarUrl: getUserAvatarUrl(record?.senderUin),
            operator: getRecallOperatorName(record),
            msgTime: Number(record?.msgTime) || 0,
            recallTime: Number(mark.recallTime || record?.recallTime) || 0,
            ...getRecallViewerContent(record)
        };
        let chat = chats.get(key);
        if (!chat) {
            chat = {
                key,
                peerUid,
                peerUin: message.peerUin,
                peerName: getRecallPeerName(record),
                avatarUrl: getRecallPeerAvatarUrl(record),
                chatType,
                latestTime: 0,
                messages: []
            };
            chats.set(key, chat);
        }
        chat.latestTime = Math.max(chat.latestTime, message.recallTime || message.msgTime);
        chat.messages.push(message);
    }
    for (const chat of chats.values()) {
        chat.messages.sort((left, right) => (right.recallTime || right.msgTime) - (left.recallTime || left.msgTime));
    }
    return Array.from(chats.values()).sort((left, right) => right.latestTime - left.latestTime);
}

async function getRecallAudioPreview(payload = {}) {
    const msgId = normalizeText(payload.msgId);
    const elementIndex = Number(payload.elementIndex);
    const record = recallViewerRecordIndex.get(msgId);
    const element = record?.elements?.[elementIndex];
    if (!record || !element?.pttElement || !voiceFileSender?.createPttPreviewItem) {
        throw new Error('Voice message is unavailable.');
    }
    const preview = await voiceFileSender.createPttPreviewItem(element);
    return {
        url: pathToFileURL(preview.previewPath).href,
        title: preview.title,
        duration: preview.duration
    };
}

function getRecallJumpWindowScore(browserWindow) {
    let url = '';
    try {
        url = browserWindow.webContents.getURL();
    } catch {
    }
    const routeScore = url.includes('#/main/message') ? 3 : url.includes('#/chat') ? 2 : url.includes('#/main') ? 1 : 0;
    const bounds = browserWindow.getBounds();
    return routeScore * 1e12 + (browserWindow.isVisible() ? 1e11 : 0) + bounds.width * bounds.height;
}

function getRecallJumpWindow() {
    return BrowserWindow.getAllWindows()
        .filter(browserWindow => !browserWindow.isDestroyed() && browserWindow !== recallViewerWindow && !browserWindow.webContents.isDestroyed())
        .sort((left, right) => getRecallJumpWindowScore(right) - getRecallJumpWindowScore(left))[0] || null;
}

async function jumpToRecallMessage(payload = {}) {
    const peerUid = normalizeText(payload.peerUid);
    const msgId = normalizeText(payload.msgId);
    const chatType = Number(payload.chatType);
    if (!peerUid || !msgId || !chatType) {
        throw new Error('Invalid recall message target.');
    }
    const command = {
        promiseId: crypto.randomUUID(),
        sender: 'MsgRecordWindow',
        type: 'req',
        postMessageType: 'invoke',
        eventName: 'invoke',
        params: {
            moduleName: 'mainPage',
            cmdName: 'jumpNewAio',
            args: [{
                peerUid,
                chatType,
                type: 1,
                params: { msgId }
            }]
        }
    };
    const browserWindow = getRecallJumpWindow();
    if (!browserWindow) {
        throw new Error('QQ main window was not found.');
    }
    if (browserWindow.isMinimized()) {
        browserWindow.restore();
    }
    browserWindow.show();
    browserWindow.focus();
    browserWindow.webContents.focus();
    const source = `(() => { const channel = new BroadcastChannel('MainWindow'); channel.postMessage(${JSON.stringify(command)}); channel.close(); return true; })()`;
    await browserWindow.webContents.executeJavaScript(source, true);
    return { success: true };
}

async function openPreventRecallMessages() {
    const viewerPath = path.join(__dirname, 'recall-viewer.html');
    if (recallViewerWindow && !recallViewerWindow.isDestroyed()) {
        recallViewerWindow.loadFile(viewerPath);
        recallViewerWindow.focus();
        return { success: true };
    }
    recallViewerWindow = new BrowserWindow({
        width: 800,
        height: 600,
        minWidth: 650,
        minHeight: 440,
        autoHideMenuBar: true,
        title: `${PLUGIN_NAME} - 撤回消息`,
        webPreferences: {
            preload: path.join(__dirname, 'recall-viewer-preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    recallViewerWindow.setMenuBarVisibility(false);
    recallViewerWindow.loadFile(viewerPath);
    recallViewerWindow.webContents.on('before-input-event', (_event, input) => {
        if (input.key === 'F5' && input.type === 'keyUp') {
            openPreventRecallMessages();
        }
    });
    recallViewerWindow.on('closed', () => {
        recallViewerWindow = null;
    });
    return { success: true };
}

function eventHasMessageAttr(response, result, attrId, sendStatus) {
    const records = [
        ...collectMsgRecords(response?.payload),
        ...collectMsgRecords(result?.payload),
        ...collectMsgRecords(result)
    ];
    return records.some(record => {
        const recordAttrId = getMsgAttrId(record);
        if (recordAttrId === undefined || String(recordAttrId) !== String(attrId)) {
            return false;
        }
        return sendStatus === undefined || Number(record.sendStatus) === Number(sendStatus);
    });
}

function valueContainsPath(value, filePath, depth = 0) {
    if (!filePath || value === undefined || value === null || depth > 8) {
        return false;
    }
    const target = normalizeComparablePath(filePath);
    if (typeof value === 'string') {
        return normalizeComparablePath(value) === target;
    }
    if (Array.isArray(value)) {
        return value.some(item => valueContainsPath(item, filePath, depth + 1));
    }
    if (typeof value !== 'object' || value instanceof Uint8Array) {
        return false;
    }
    return Object.values(value).some(item => valueContainsPath(item, filePath, depth + 1));
}

function matchesNativeResponse(waitResponse, callbackId, response, result) {
    if (waitResponse === true) {
        return response?.callbackId === callbackId;
    }
    if (typeof waitResponse === 'object' && waitResponse) {
        const cmdName = waitResponse.cmdName;
        const cmdMatched = !cmdName || response?.cmdName === cmdName || result?.cmdName === cmdName;
        if (!cmdMatched) {
            return false;
        }
        if (waitResponse.attrId !== undefined) {
            return eventHasMessageAttr(response, result, waitResponse.attrId, waitResponse.sendStatus);
        }
        if (waitResponse.filePath !== undefined) {
            return valueContainsPath(response, waitResponse.filePath) || valueContainsPath(result, waitResponse.filePath);
        }
        return true;
    }
    if (Array.isArray(waitResponse)) {
        return waitResponse.includes(response?.cmdName) || waitResponse.includes(result?.cmdName);
    }
    return response?.cmdName === waitResponse || result?.cmdName === waitResponse;
}

function notifyNativeWaiters(browserWindow, channel, args) {
    const state = getWindowState(browserWindow);
    for (const waiter of Array.from(state.nativeWaiters)) {
        if (waiter.channel !== channel) {
            continue;
        }
        const [response, result] = args;
        if (!matchesNativeResponse(waiter.waitResponse, waiter.callbackId, response, result)) {
            continue;
        }
        clearTimeout(waiter.timer);
        state.nativeWaiters.delete(waiter);
        waiter.resolve(extractNativeResult(response, result));
    }
}

function createNativeEventWaiter(browserWindow, waitResponse, timeoutMs = 10000) {
    installNativeSendInterceptor(browserWindow);
    const webContentId = browserWindow.webContents.id;
    const responseChannel = `RM_IPCFROM_MAIN${webContentId}`;
    const state = getWindowState(browserWindow);
    let waiter;
    const promise = new Promise((resolve, reject) => {
        waiter = {
            channel: responseChannel,
            callbackId: null,
            cmdName: waitResponse?.cmdName || 'nativeEvent',
            waitResponse,
            resolve,
            reject,
            timer: setTimeout(() => {
                state.nativeWaiters.delete(waiter);
                reject(new Error(`Timed out waiting for native event: ${safeJson(waitResponse)}`));
            }, timeoutMs)
        };
        state.nativeWaiters.add(waiter);
    });
    return {
        promise,
        cancel: () => {
            if (!waiter) {
                return;
            }
            clearTimeout(waiter.timer);
            state.nativeWaiters.delete(waiter);
        }
    };
}

async function nativeInvoke(browserWindow, eventName, cmdName, payload = [], waitResponse = true, timeoutMs = 10000, cmdType = 'invoke') {
    installNativeSendInterceptor(browserWindow);
    const webContentId = browserWindow.webContents.id;
    const callbackId = crypto.randomUUID();
    const requestChannel = `RM_IPCFROM_RENDERER${webContentId}`;
    const responseChannel = `RM_IPCFROM_MAIN${webContentId}`;
    const request = {
        peerId: webContentId,
        callbackId,
        type: 'request',
        eventName
    };
    const command = {
        cmdName,
        cmdType,
        payload
    };
    const listeners = ipcMain.listeners(requestChannel);
    if (listeners.length === 0) {
        throw new Error(`No QQNT native IPC listener was found for ${requestChannel}.`);
    }

    return await new Promise((resolve, reject) => {
        const state = getWindowState(browserWindow);
        let waiter;
        if (waitResponse) {
            waiter = {
                channel: responseChannel,
                callbackId,
                cmdName,
                waitResponse,
                resolve,
                reject,
                timer: setTimeout(() => {
                    state.nativeWaiters.delete(waiter);
                    reject(new Error(`Timed out waiting for native response: ${cmdName}`));
                }, timeoutMs)
            };
            state.nativeWaiters.add(waiter);
        }

        const fakeEvent = {
            sender: browserWindow.webContents,
            reply: (channel, ...args) => browserWindow.webContents.send(channel, ...args)
        };

        try {
            for (const listener of listeners) {
                listener(fakeEvent, request, command);
            }
            if (!waitResponse) {
                resolve(null);
            }
        } catch (error) {
            if (waiter) {
                clearTimeout(waiter.timer);
                state.nativeWaiters.delete(waiter);
            }
            reject(error);
        }
    });
}

async function qqNativeInvoke(browserWindow, eventName, cmdName, payload = [], waitResponse = true, timeoutMs = 10000) {
    return await nativeInvoke(browserWindow, eventName, cmdName, payload, waitResponse, timeoutMs);
}

function isMsgInfoListUpdate(args) {
    return args.some(arg => arg?.cmdName === MSG_UPDATE_CMD || arg?.payload?.cmdName === MSG_UPDATE_CMD);
}

function getRecordElements(record) {
    return Array.isArray(record?.elements) ? record.elements : [];
}

function isImageElement(element) {
    return Number(element?.elementType) === 2 || Boolean(element?.picElement);
}

function getImageElements(record) {
    return getRecordElements(record).filter(isImageElement);
}

function isImageOnlyRecord(record) {
    const elements = getRecordElements(record);
    return elements.length > 0 && elements.every(isImageElement);
}

function getRecordRetryKey(record) {
    const msgId = normalizeText(record?.msgId);
    if (msgId && msgId !== '0') {
        return `msg:${msgId}`;
    }
    const attrId = getMsgAttrId(record);
    const md5s = getImageElements(record)
        .map(element => normalizeText(element?.picElement?.md5HexStr || element?.picElement?.md5))
        .filter(Boolean)
        .join(',');
    return [
        'record',
        normalizeText(record?.chatType),
        normalizeText(record?.peerUid || record?.peer?.peerUid),
        normalizeText(record?.msgSeq),
        normalizeText(record?.msgRandom),
        normalizeText(attrId),
        md5s
    ].join(':');
}

function pruneRetryState(state) {
    const now = Date.now();
    for (const [key, item] of state.retriedRecords) {
        if (now - item.timestamp > 60 * 60 * 1000) {
            state.retriedRecords.delete(key);
        }
    }
    for (const [key, timestamp] of state.pluginAttrIds) {
        if (now - timestamp > 60 * 60 * 1000) {
            state.pluginAttrIds.delete(key);
        }
    }
}

function extractPeerFromRecord(browserWindow, record) {
    const state = getWindowState(browserWindow);
    const chatType = Number(record?.chatType || record?.peer?.chatType || record?.contact?.chatType || 0);
    let peerUid = normalizeText(
        record?.peerUid ||
        record?.peer?.peerUid ||
        record?.contact?.peerUid ||
        record?.header?.peerUid
    );
    const peerUin = normalizeText(
        record?.peerUin ||
        record?.peer?.peerUin ||
        record?.contact?.peerUin ||
        record?.header?.peerUin
    );
    if ((chatType === 1 || chatType === 100) && !peerUid.startsWith('u_')) {
        const mappedUid = state.peerUidByUin.get(peerUid) || state.peerUidByUin.get(peerUin);
        if (mappedUid) {
            peerUid = mappedUid;
        }
    }
    if (chatType === 2 && !peerUid && peerUin) {
        peerUid = peerUin;
    }
    if (!chatType || !peerUid) {
        return null;
    }
    return {
        chatType,
        peerUid,
        guildId: normalizeText(record?.guildId || record?.peer?.guildId || record?.contact?.guildId)
    };
}

function getThumbPathCandidate(thumbPath) {
    if (!thumbPath) {
        return '';
    }
    if (typeof thumbPath === 'string') {
        return thumbPath;
    }
    if (thumbPath instanceof Map) {
        return normalizePathText(thumbPath.get(0) || thumbPath.get(1) || Array.from(thumbPath.values())[0]);
    }
    if (typeof thumbPath === 'object') {
        return normalizePathText(thumbPath[0] || thumbPath[1] || Object.values(thumbPath)[0]);
    }
    return '';
}

function getPicSourcePath(picElement) {
    const candidates = [
        picElement?.sourcePath,
        picElement?.filePath,
        picElement?.originPath,
        picElement?.localPath,
        picElement?.path,
        getThumbPathCandidate(picElement?.thumbPath)
    ];
    for (const candidate of candidates) {
        const filePath = normalizePathText(candidate);
        if (filePath && fsSync.existsSync(filePath) && fsSync.statSync(filePath).isFile()) {
            return filePath;
        }
    }
    return '';
}

function isGeneratedRepairPath(filePath) {
    const repairDir = normalizeComparablePath(getRepairDir());
    return normalizeComparablePath(filePath).startsWith(repairDir);
}

function isSupportedImagePath(filePath) {
    return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function shouldRepairRecord(record) {
    const sendStatus = Number(record?.sendStatus);
    if (sendStatus !== SEND_STATUS_FAILED && sendStatus !== SEND_STATUS_SUCCESS_NO_SEQ) {
        return false;
    }
    if (!isImageOnlyRecord(record)) {
        return false;
    }
    const pics = getImageElements(record);
    if (!pics.length) {
        return false;
    }
    return pics.every(element => {
        const sourcePath = getPicSourcePath(element.picElement || element);
        return sourcePath && isSupportedImagePath(sourcePath) && !isGeneratedRepairPath(sourcePath);
    });
}

function queueImageRetry(browserWindow, record) {
    if (browserWindow.isDestroyed()) {
        return;
    }
    const state = getWindowState(browserWindow);
    pruneRetryState(state);
    const key = getRecordRetryKey(record);
    const existing = state.retriedRecords.get(key);
    if (existing?.count >= MAX_RETRY_PER_RECORD || state.inFlightRecords.has(key)) {
        return;
    }
    state.retriedRecords.set(key, {
        timestamp: Date.now(),
        count: (existing?.count || 0) + 1
    });
    state.inFlightRecords.add(key);
    setTimeout(() => {
        retryImageRecord(browserWindow, record, key)
            .catch(error => warn('image retry failed:', error?.message || error))
            .finally(() => state.inFlightRecords.delete(key));
    }, RETRY_DELAY_MS);
}

function processMessageUpdates(browserWindow, args) {
    if (!isMsgInfoListUpdate(args)) {
        return;
    }
    if (!isImageRetryEnabled()) {
        return;
    }
    const state = getWindowState(browserWindow);
    pruneRetryState(state);
    const records = [];
    for (const arg of args) {
        collectMsgRecords(arg, records);
        collectMsgRecords(arg?.payload, records);
    }
    const seen = new Set();
    for (const record of records) {
        const key = getRecordRetryKey(record);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        const attrId = getMsgAttrId(record);
        if (attrId !== undefined && state.pluginAttrIds.has(String(attrId))) {
            continue;
        }
        if (shouldRepairRecord(record)) {
            queueImageRetry(browserWindow, record);
        }
    }
}

async function ensureRepairDir() {
    const repairDir = getRepairDir();
    await fs.mkdir(repairDir, { recursive: true });
    return repairDir;
}

async function cleanupOldRepairFiles(force = false) {
    const now = Date.now();
    if (!force && now - cleanupState.lastRunAt < 30 * 60 * 1000) {
        return;
    }
    cleanupState.lastRunAt = now;
    const repairDir = await ensureRepairDir();
    let entries = [];
    try {
        entries = await fs.readdir(repairDir, { withFileTypes: true });
    } catch {
        return;
    }
    await Promise.all(entries
        .filter(entry => entry.isFile())
        .map(async entry => {
            const filePath = path.join(repairDir, entry.name);
            try {
                const stat = await fs.stat(filePath);
                if (now - stat.mtimeMs > REPAIR_FILE_TTL_MS) {
                    await fs.unlink(filePath);
                }
            } catch {
            }
        }));
}

function safeFileStem(value) {
    return String(value || 'image')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'image';
}

async function createOnePixelVariant(sourcePath) {
    if (!nativeImage) {
        throw new Error('Electron nativeImage is not available.');
    }
    const image = nativeImage.createFromPath(sourcePath);
    if (image.isEmpty()) {
        throw new Error(`Cannot decode image: ${sourcePath}`);
    }
    const size = image.getSize();
    if (!size.width || !size.height) {
        throw new Error(`Invalid image size: ${sourcePath}`);
    }
    const bitmap = Buffer.from(image.toBitmap({ scaleFactor: 1 }));
    const expectedLength = size.width * size.height * 4;
    if (bitmap.length !== expectedLength) {
        throw new Error(`Unexpected bitmap size: ${bitmap.length}, expected ${expectedLength}.`);
    }
    const pixelOffset = bitmap.length - 4;
    bitmap[pixelOffset] = bitmap[pixelOffset] >= 255 ? 254 : bitmap[pixelOffset] + 1;

    const repairedImage = nativeImage.createFromBitmap(bitmap, {
        width: size.width,
        height: size.height,
        scaleFactor: 1
    });
    const png = repairedImage.toPNG();
    const repairDir = await ensureRepairDir();
    const stem = safeFileStem(path.basename(sourcePath, path.extname(sourcePath)));
    const fileName = `${stem}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.qqnt-toolbox.png`;
    const outPath = path.join(repairDir, fileName);
    await fs.writeFile(outPath, png);
    cleanupOldRepairFiles().catch(() => {});
    return outPath;
}

async function getFileMd5(filePath) {
    const hash = crypto.createHash('md5');
    const stream = fsSync.createReadStream(filePath);
    return await new Promise((resolve, reject) => {
        stream.on('data', chunk => hash.update(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

function findFirstByKey(value, keys, depth = 0, seen = new WeakSet()) {
    if (!value || depth > 5) {
        return undefined;
    }
    if (typeof value !== 'object' || value instanceof Uint8Array || value instanceof Map) {
        return undefined;
    }
    if (seen.has(value)) {
        return undefined;
    }
    seen.add(value);
    for (const key of keys) {
        const item = value[key];
        if (item !== undefined && item !== null && typeof item !== 'object') {
            return item;
        }
    }
    for (const item of Object.values(value)) {
        const found = findFirstByKey(item, keys, depth + 1, seen);
        if (found !== undefined) {
            return found;
        }
    }
    return undefined;
}

function normalizeFileTypeExt(typeResult) {
    const value = unwrapNativeValue(typeResult);
    const ext = normalizeText(value?.ext || value?.fileExt || value?.type || value);
    return ext.replace(/^\./, '').toLowerCase();
}

async function nativeFileType(browserWindow, filePath) {
    try {
        return normalizeFileTypeExt(await qqNativeInvoke(browserWindow, 'FileApi', 'getFileType', [filePath], true, 10000));
    } catch {
        return path.extname(filePath).replace(/^\./, '').toLowerCase();
    }
}

async function nativeImageSize(browserWindow, filePath) {
    try {
        const result = unwrapNativeValue(await qqNativeInvoke(browserWindow, 'FileApi', 'getImageSizeFromPath', [filePath], true, 10000));
        const width = Number(result?.width || result?.picWidth);
        const height = Number(result?.height || result?.picHeight);
        if (width > 0 && height > 0) {
            return { width, height };
        }
    } catch {
    }
    const image = nativeImage.createFromPath(filePath);
    const size = image.getSize();
    return {
        width: size.width,
        height: size.height
    };
}

async function nativeFileSize(browserWindow, filePath) {
    try {
        const result = unwrapNativeValue(await qqNativeInvoke(browserWindow, 'FileApi', 'getFileSize', [filePath], true, 10000));
        const size = Number(result);
        if (Number.isFinite(size) && size > 0) {
            return size;
        }
    } catch {
    }
    return (await fs.stat(filePath)).size;
}

async function copyImageToQqCache(browserWindow, filePath, picSubType) {
    const result = await qqNativeInvoke(
        browserWindow,
        'ntApi',
        'nodeIKernelMsgService/copyFileWithDelExifInfo',
        [{
            sourcePath: filePath,
            elementSubType: Number(picSubType) || 0
        }, null],
        true,
        15000
    );
    if (isNativeFailure(result)) {
        throw new Error(`copyFileWithDelExifInfo failed: ${safeJson(result)}`);
    }
    const newPath = normalizePathText(
        findFirstByKey(result, ['newPath', 'filePath', 'path', 'sourcePath']) ||
        result?.newPath ||
        result?.path
    );
    if (!newPath) {
        throw new Error(`copyFileWithDelExifInfo returned no path: ${safeJson(result)}`);
    }
    const md5 = normalizeText(
        findFirstByKey(result, ['md5', 'md5HexStr', 'fileMd5']) ||
        result?.md5
    );
    return {
        newPath,
        md5: md5 || await getFileMd5(newPath)
    };
}

async function createPicElement(browserWindow, filePath, originalPicElement = {}) {
    const picSubType = Number(originalPicElement?.picSubType) || 0;
    const copied = await copyImageToQqCache(browserWindow, filePath, picSubType);
    const sourcePath = fsSync.existsSync(copied.newPath) ? copied.newPath : filePath;
    const [fileType, imageSize, fileSize] = await Promise.all([
        nativeFileType(browserWindow, sourcePath),
        nativeImageSize(browserWindow, sourcePath),
        nativeFileSize(browserWindow, sourcePath)
    ]);
    const fileName = path.basename(sourcePath);
    return {
        elementType: 2,
        elementId: '',
        picElement: {
            md5HexStr: copied.md5,
            picWidth: imageSize.width,
            picHeight: imageSize.height,
            fileName,
            fileSize: String(fileSize),
            original: true,
            picSubType,
            sourcePath,
            thumbPath: null,
            picType: fileType === 'gif' ? 2000 : 1000,
            fileUuid: '',
            fileSubId: '',
            thumbFileSize: 0,
            summary: normalizeText(originalPicElement?.summary)
        },
        extBufForUI: new Uint8Array()
    };
}

function makeSendAttributeInfos(attrId) {
    const msgAttributeInfos = new Map();
    msgAttributeInfos.set(0, {
        attrType: 0,
        attrId,
        vasMsgInfo: {
            msgNamePlateInfo: {},
            bubbleInfo: {},
            avatarPendantInfo: {},
            vasFont: {},
            iceBreakInfo: {}
        }
    });
    return msgAttributeInfos;
}

async function generateMsgUniqueId(browserWindow, chatType) {
    const serverTimeResult = await qqNativeInvoke(browserWindow, 'ntApi', 'nodeIKernelMSFService/getServerTime', [], true, 10000);
    const serverTime = unwrapNativeValue(serverTimeResult);
    const uniqueIdResult = await qqNativeInvoke(
        browserWindow,
        'ntApi',
        'nodeIKernelMsgService/generateMsgUniqueId',
        [chatType, serverTime],
        true,
        10000
    );
    const uniqueId = unwrapNativeValue(uniqueIdResult);
    if (uniqueId === undefined || uniqueId === null || typeof uniqueId === 'object') {
        throw new Error(`QQNT returned an invalid unique id: ${safeJson(uniqueIdResult)}`);
    }
    return uniqueId;
}

async function sendImageElements(browserWindow, peer, msgElements, attrId) {
    getWindowState(browserWindow).pluginAttrIds.set(String(attrId), Date.now());
    const msgAttributeInfos = makeSendAttributeInfos(attrId);
    const attempts = [
        {
            name: 'array',
            payload: ['0', peer, msgElements, msgAttributeInfos]
        },
        {
            name: 'object',
            payload: [{
                msgId: '0',
                peer,
                msgElements,
                msgAttributeInfos
            }, null]
        }
    ];
    let lastResult;
    for (const attempt of attempts) {
        const sentMsgWaiter = createNativeEventWaiter(browserWindow, {
            cmdName: MSG_UPDATE_CMD,
            attrId,
            sendStatus: 2
        }, 30000);
        try {
            const result = await qqNativeInvoke(
                browserWindow,
                'ntApi',
                'nodeIKernelMsgService/sendMsg',
                attempt.payload,
                true,
                15000
            );
            lastResult = result;
            if (!isNativeFailure(result)) {
                sentMsgWaiter.promise
                    .then(() => debug('image retry sent'))
                    .catch(error => warn('image retry status not confirmed:', error?.message || error));
                return {
                    shape: attempt.name,
                    result
                };
            }
        } catch (error) {
            lastResult = error;
        }
        sentMsgWaiter.cancel();
    }
    throw new Error(`QQNT rejected image sendMsg: ${safeJson(lastResult)}`);
}

function normalizeRepeatPeer(browserWindow, payload = {}) {
    const source = {
        ...(payload.record || {}),
        ...(payload.peer || {})
    };
    let peer = extractPeerFromRecord(browserWindow, source);
    if (!peer && payload.peer) {
        peer = extractPeerFromRecord(browserWindow, payload.peer);
    }
    if (!peer) {
        throw new Error('Cannot resolve repeat target peer.');
    }
    return peer;
}

function deepCloneForSend(value, depth = 0, seen = new WeakMap()) {
    if (value === null || value === undefined || depth > 12) {
        return value;
    }
    if (typeof value !== 'object') {
        return value;
    }
    if (value instanceof Uint8Array) {
        return new Uint8Array(value);
    }
    if (Buffer.isBuffer(value)) {
        return Buffer.from(value);
    }
    if (value instanceof Map) {
        const map = new Map();
        for (const [key, item] of value) {
            map.set(key, deepCloneForSend(item, depth + 1, seen));
        }
        return map;
    }
    if (seen.has(value)) {
        return seen.get(value);
    }
    if (Array.isArray(value)) {
        const array = [];
        seen.set(value, array);
        for (const item of value) {
            array.push(deepCloneForSend(item, depth + 1, seen));
        }
        return array;
    }
    const object = {};
    seen.set(value, object);
    for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'function') {
            continue;
        }
        object[key] = deepCloneForSend(item, depth + 1, seen);
    }
    return object;
}

function sanitizeElementForSend(element) {
    if (!element || typeof element !== 'object') {
        return null;
    }
    const clone = deepCloneForSend(element);
    clone.elementId = '';
    delete clone.extBufForUI;
    return clone;
}

function sanitizeRepeatPttElement(element) {
    if (!element || typeof element !== 'object') {
        return null;
    }
    if (Number(element.elementType) !== 4 && !element.pttElement) {
        return null;
    }
    return voiceFileSender?.sanitizePttInfo?.(element) || null;
}

async function repeatPttRecord(browserWindow, peer, record = {}) {
    const sourceElements = Array.isArray(record.elements) ? record.elements : [];
    const pttElements = sourceElements.filter(element => Number(element?.elementType) === 4 || element?.pttElement);
    if (!pttElements.length) {
        return null;
    }
    if (pttElements.length !== sourceElements.length) {
        throw new Error('Mixed voice messages cannot be repeated without losing elements.');
    }
    const ptts = pttElements.map(sanitizeRepeatPttElement);
    if (ptts.some(ptt => !ptt)) {
        throw new Error('Voice message data is incomplete.');
    }
    if (!isVoiceMessageEnabled()) {
        throw new Error('Voice message tools are disabled.');
    }
    if (!voiceFileSender?.sendPttInfoAsPtt) {
        throw new Error('Voice repeat module is not available.');
    }
    const results = [];
    for (const ptt of ptts) {
        results.push(await voiceFileSender.sendPttInfoAsPtt(browserWindow, peer, ptt));
    }
    return {
        count: results.length,
        results
    };
}

async function createRepeatElement(browserWindow, element) {
    const type = Number(element?.elementType);
    if (!type) {
        return null;
    }
    if (type === 2 && element.picElement) {
        const sourcePath = getPicSourcePath(element.picElement);
        if (sourcePath) {
            return await createPicElement(browserWindow, sourcePath, element.picElement);
        }
        return null;
    }
    return sanitizeElementForSend(element);
}

async function repeatBySendMsg(browserWindow, peer, record = {}) {
    const sourceElements = Array.isArray(record.elements) ? record.elements : [];
    const msgElements = [];
    for (const element of sourceElements) {
        const nextElement = await createRepeatElement(browserWindow, element);
        if (!nextElement) {
            throw new Error(`Message element ${Number(element?.elementType) || 0} cannot be repeated intact.`);
        }
        msgElements.push(nextElement);
    }
    if (!msgElements.length) {
        throw new Error('No repeatable message element was found.');
    }
    const attrId = await generateMsgUniqueId(browserWindow, peer.chatType);
    const msgAttributeInfos = makeSendAttributeInfos(attrId);
    const result = await qqNativeInvoke(
        browserWindow,
        'ntApi',
        'nodeIKernelMsgService/sendMsg',
        [{
            msgId: '0',
            peer,
            msgElements,
            msgAttributeInfos
        }, null],
        true,
        15000
    );
    if (isNativeFailure(result)) {
        throw new Error(`repeat sendMsg failed: ${safeJson(result)}`);
    }
    return result;
}

async function repeatMessageFromRenderer(browserWindow, payload = {}) {
    if (!isRepeatMessageEnabled()) {
        throw new Error('Repeat message is disabled.');
    }
    const peer = normalizeRepeatPeer(browserWindow, payload);
    const pttResult = await repeatPttRecord(browserWindow, peer, payload.record || {});
    if (pttResult) {
        return {
            method: 'ptt',
            result: pttResult
        };
    }
    return {
        method: 'sendMsg',
        result: await repeatBySendMsg(browserWindow, peer, payload.record || {})
    };
}

async function retryImageRecord(browserWindow, record, key) {
    if (browserWindow.isDestroyed()) {
        return;
    }
    const peer = extractPeerFromRecord(browserWindow, record);
    if (!peer) {
        throw new Error(`Cannot resolve original peer for ${key}.`);
    }
    const images = getImageElements(record);
    const repairedElements = [];
    for (const element of images) {
        const originalPic = element.picElement || element;
        const sourcePath = getPicSourcePath(originalPic);
        const repairedPath = await createOnePixelVariant(sourcePath);
        repairedElements.push(await createPicElement(browserWindow, repairedPath, originalPic));
    }
    const attrId = await generateMsgUniqueId(browserWindow, peer.chatType);
    await sendImageElements(browserWindow, peer, repairedElements, attrId);
}

function handleNativeSend(browserWindow, channel, args) {
    if (shouldBlockUpdateNotice(args)) {
        return true;
    }
    rememberNativePeerAliases(browserWindow, args);
    notifyNativeWaiters(browserWindow, channel, args);
    processDeleteBubbleSkin(args);
    processPreventRecall(args);
    Promise.resolve()
        .then(() => processMessageUpdates(browserWindow, args))
        .catch(error => warn('message update processing failed:', error?.message || error));
    return false;
}

function installNativeSendInterceptor(browserWindow) {
    if (!browserWindow || browserWindow.isDestroyed()) {
        return;
    }
    const state = getWindowState(browserWindow);
    if (state.nativeSendPatched) {
        return;
    }
    const webContents = browserWindow.webContents;
    state.originalSend = webContents.send.bind(webContents);
    webContents.send = function(channel, ...args) {
        let blocked = false;
        try {
            blocked = handleNativeSend(browserWindow, channel, args);
        } catch (error) {
            warn('native send interceptor failed:', error?.message || error);
        }
        if (blocked) {
            return undefined;
        }
        return state.originalSend(channel, ...args);
    };
    state.nativeSendPatched = true;
}

function installForAllWindows() {
    for (const browserWindow of BrowserWindow.getAllWindows()) {
        installNativeSendInterceptor(browserWindow);
    }
}

function start() {
    loadConfig();
    loadPersistedRecallCache();
    installConfigIpc();
    installForAllWindows();
    applyVoiceMessageConfig();
    cleanupOldRepairFiles(true).catch(() => {});
    app?.on?.('browser-window-created', (_event, browserWindow) => {
        installNativeSendInterceptor(browserWindow);
        if (isVoiceMessageEnabled()) {
            voiceFileSender?.onBrowserWindowCreated?.(browserWindow);
        }
    });
    setInterval(installForAllWindows, 3000).unref?.();
    debug('loaded');
}

start();
