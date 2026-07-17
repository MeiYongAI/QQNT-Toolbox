const { app, BrowserWindow, clipboard, ipcMain, nativeImage, shell } = require('electron');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Readable, Writable } = require('stream');
const { pipeline } = require('stream/promises');
const { fileURLToPath, pathToFileURL } = require('url');
const { serialize, deserialize } = require('v8');
const { deflateSync, inflateSync } = require('zlib');
const { ZipWriter } = require('@zip.js/zip.js');
const { randomizePngEncoding } = require('./png-variant');
const { buildPokePacket, buildPokeRecallPacket, extractPokeEvent, normalizeUin } = require('./poke-protocol');
const { resolveRecallImageUrl } = require('./recall-image-url');
const { createRepeatMessageHandler } = require('./repeat-message');
const { loadReactionEmojiCatalog, normalizeReactionRequest } = require('./reaction-catalog');
const {
    classifyMediaFilePath,
    createInlineMediaDownloadPayload,
    createInlineMediaDownloadRequest,
    extractInlineMediaGallery,
    getInlineMediaMessageKeys,
    isNativeMediaViewerUrl,
    isSameInlineMediaItem,
    mergeInlineMediaItems,
    normalizeInlineMediaOpenItem,
    resolveInlineReplyPreview
} = require('./inline-media-preview');
const { createLocalMediaServer } = require('./local-media-server');
const { createDiagnosticActionRunner, createDiagnosticLogger } = require('./diagnostics');
const {
    CHANNEL_GET_CONFIG,
    CHANNEL_SET_CONFIG,
    CHANNEL_CONFIG_CHANGED,
    CHANNEL_DIAGNOSTIC_EVENT,
    CHANNEL_DIAGNOSTIC_ACTION,
    CHANNEL_INLINE_MEDIA_PREVIEW,
    CHANNEL_OPEN_INLINE_MEDIA,
    CHANNEL_PREPARE_INLINE_MEDIA,
    CHANNEL_REPEAT_MESSAGE,
    CHANNEL_GET_REACTION_CATALOG,
    CHANNEL_SET_MESSAGE_REACTION,
    CHANNEL_SEND_POKE,
    CHANNEL_RECALL_POKE,
    CHANNEL_REGISTER_POKE_ACCOUNT,
    CHANNEL_CLEAR_RECALL_CACHE,
    CHANNEL_OPEN_RECALL_DIR,
    CHANNEL_OPEN_RECALL_IMAGE_DIR,
    CHANNEL_VIEW_RECALL_MESSAGES,
    CHANNEL_GET_RECALL_VIEWER_DATA,
    CHANNEL_GET_RECALL_AUDIO_PREVIEW,
    CHANNEL_JUMP_RECALL_MESSAGE
} = require('./ipc-channels');
const {
    addNativeRequestHandler,
    addNativeSendHandler,
    createNativeEventWaiter,
    isNativeFailure,
    qqNativeInvoke,
    unwrapNativeValue
} = require('./native-ipc');
const {
    createNativeEventContext,
    isNativeMainChannel
} = require('./native-event-context');

const PLUGIN_SLUG = 'qqnt_toolbox';
const PLUGIN_NAME = 'QQNT Toolbox';
const MSG_UPDATE_CMD = 'nodeIKernelMsgListener/onMsgInfoListUpdate';
const POKE_RECEIVE_CMD = 'nodeIKernelMsgListener/onRecvMsg';
const SEND_STATUS_FAILED = 0;
const SEND_STATUS_SUCCESS_NO_SEQ = 3;
const MAX_RETRY_PER_RECORD = 1;
const RETRY_DELAY_MS = 800;
const REPAIR_FILE_TTL_MS = 24 * 60 * 60 * 1000;
const QR_SCAN_COMMAND = 'nodeIKernelNodeMiscService/scanQBar';
const OPEN_MEDIA_VIEWER_COMMAND = 'openMediaViewer';
const SET_MESSAGE_REACTION_COMMAND = 'nodeIKernelMsgService/setMsgEmojiLikes';
const MEDIA_PREVIEW_DOWNLOAD_WAIT_MS = 30 * 1000;
const MAX_INLINE_MEDIA_PEERS = 40;
const MAX_INLINE_MEDIA_PER_PEER = 500;
const NUDGE_SEND_COMMAND = 'nodeIKernelMsgService/sendNudge';
const POKE_EVENT_TTL_MS = 60 * 60 * 1000;
const POKE_AUTO_REPLY_MAX_AGE_MS = 60 * 1000;
const POKE_AUTO_REPLY_SEQUENCE_WINDOW_MS = 10 * 1000;
const POKE_COMMAND = 'OidbSvcTrpcTcp.0xED3_1';
const POKE_RECALL_COMMAND = 'OidbSvcTrpcTcp.0xF51_1';
const POKE_NATIVE_BINARY = 'poke-bridge.win32-x64.node';
const MAX_RECALL_CACHE_SIZE = 100000;
const IMAGE_EXTENSIONS = new Set([
    '.apng', '.bmp', '.gif', '.jfif', '.jpeg', '.jpg', '.png', '.webp'
]);
const VIDEO_EXTENSIONS = new Set([
    '.3g2', '.3gp', '.asf', '.avi', '.flv', '.m2ts', '.m4v', '.mkv', '.mov', '.mp4', '.mpeg', '.mpg',
    '.mts', '.ogv', '.ts', '.vob', '.webm', '.wmv'
]);
const AUDIO_EXTENSIONS = new Set([
    '.aac', '.ac3', '.aiff', '.alac', '.amr', '.ape', '.flac', '.m4a', '.mka', '.mp3', '.ogg', '.opus',
    '.wav', '.weba', '.wma'
]);
let voiceFileSender = null;
try {
    voiceFileSender = require('./voice-file-sender');
} catch {
    voiceFileSender = null;
}
const DEFAULT_CONFIG = {
    fileRetryFixer: {
        enabled: false,
        image: false,
        video: false,
        audio: false,
        otherFiles: false,
        deleteFailedMessage: false,
        archivePassword: ''
    },
    repeatMessage: {
        enabled: false,
        doubleClick: false,
        showInContextMenu: false
    },
    voiceMessage: {
        enabled: false,
        saveInContextMenu: false,
        forwardInContextMenu: false,
        fakeDurationEnabled: false,
        fakeDurationSeconds: 1
    },
    messageTweaks: {
        promptNoSeq: false,
        removeReactionLimit: false,
        keepReactionPanelOpen: false,
        removeReplyAt: false
    },
    entertainment: {
        autoPokeBack: false,
        autoPokeBackLimit: 1,
        doubleClickAvatarPoke: false,
        rightClickAvatarPoke: false
    },
    floatingPanel: {
        enabled: true,
        shortcut: 'ControlRight'
    },
    preventRecall: {
        enabled: false,
        preventSelfMsg: false,
        persistedFiles: false,
        redirectPicPath: false,
        customColor: false,
        customTextColor: {
            light: '#ff6666',
            dark: '#c70000'
        }
    },
    interfaceTweaks: {
        inlineMediaViewer: false,
        singleClickMediaViewer: false,
        showFullUnreadCount: false,
        messageContextMenuOrder: {
            enabled: false,
            items: [],
            catalog: []
        },
        imageViewerOptimization: false,
        disableImageQrScan: false,
        singleMediaViewer: false,
        goBackMainList: false,
        preventMessageDrag: false,
        preventRecentContactDrag: false,
        preventProfileCardHover: false,
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
const pokeState = {
    bridge: null,
    bridgeInstalled: false,
    wrapperApi: null,
    wrapperSession: null,
    processedEvents: new Map(),
    autoReplySequences: new Map()
};
const recallStates = new Map();
let configCache = null;
let recallViewerWindow = null;
const recallViewerRecordIndex = new Map();
const recallViewerState = {
    accountUin: ''
};
const inlineMediaServer = createLocalMediaServer();
let reactionEmojiCatalog = null;
let diagnosticLogger = null;
let diagnosticActionRunner = null;

function isDebugEnabled() {
    return process.env.QQNT_TOOLBOX_DEBUG === '1' || configCache?.debug?.enabled === true;
}

function getDiagnosticLogger() {
    if (!diagnosticLogger) {
        diagnosticLogger = createDiagnosticLogger({
            isEnabled: isDebugEnabled,
            getDirectory: getDebugDirectory,
            getEnvironment: getDiagnosticEnvironment
        });
    }
    return diagnosticLogger;
}

function recordDiagnostic(level, event, details = {}) {
    return getDiagnosticLogger().record(level, event, details);
}

function getDiagnosticActionRunner() {
    if (!diagnosticActionRunner) {
        diagnosticActionRunner = createDiagnosticActionRunner({
            logger: getDiagnosticLogger(),
            copyText: value => clipboard.writeText(value),
            showItemInFolder: filePath => shell.showItemInFolder(filePath),
            openPath: directory => shell.openPath(directory)
        });
    }
    return diagnosticActionRunner;
}

function debug(...args) {
    if (isDebugEnabled()) {
        console.log(`[${PLUGIN_NAME}]`, ...args);
        recordDiagnostic('info', `debug.${String(args[0] || 'event').replace(/:$/, '')}`, {
            values: args.slice(1)
        });
    }
}

function warn(...args) {
    if (isDebugEnabled()) {
        console.warn(`[${PLUGIN_NAME}]`, ...args);
        recordDiagnostic('warn', `warning.${String(args[0] || 'event').replace(/:$/, '')}`, {
            values: args.slice(1)
        });
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
    } catch {
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

function getDebugDirectory() {
    return path.join(getPluginDataDir(), 'debug');
}

function getPluginManifest() {
    const plugins = globalThis.LiteLoader?.plugins || global.LiteLoader?.plugins || {};
    return Object.values(plugins)
        .find(plugin => plugin?.manifest?.slug === PLUGIN_SLUG || plugin?.manifest?.name === PLUGIN_NAME)
        ?.manifest || {};
}

function getLiteLoaderVersion() {
    const packageInfo = globalThis.LiteLoader?.package || global.LiteLoader?.package || {};
    return String(
        packageInfo.liteloader?.version ||
        packageInfo.liteloaderqqnt?.version ||
        packageInfo.version ||
        ''
    );
}

function getWindowRoute(value) {
    const url = String(value || '');
    const hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
    if (hash.startsWith('#/forward/')) {
        return 'forward';
    }
    if (hash.startsWith('#/record')) {
        return 'record';
    }
    if (hash.startsWith('#/image-viewer')) {
        return 'image-viewer';
    }
    if (hash.startsWith('#/chat')) {
        return 'chat';
    }
    if (hash.startsWith('#/setting')) {
        return 'settings';
    }
    return hash ? 'other' : 'unknown';
}

function getDiagnosticFeatureSummary(config = getConfig()) {
    return {
        fileRetry: {
            enabled: config.fileRetryFixer?.enabled === true,
            image: config.fileRetryFixer?.image === true,
            video: config.fileRetryFixer?.video === true,
            audio: config.fileRetryFixer?.audio === true,
            otherFiles: config.fileRetryFixer?.otherFiles === true,
            deleteFailedMessage: config.fileRetryFixer?.deleteFailedMessage === true
        },
        repeat: {
            enabled: config.repeatMessage?.enabled === true,
            doubleClick: config.repeatMessage?.doubleClick === true,
            contextMenu: config.repeatMessage?.showInContextMenu === true
        },
        voice: {
            enabled: config.voiceMessage?.enabled === true,
            saveContextMenu: config.voiceMessage?.saveInContextMenu === true,
            forwardContextMenu: config.voiceMessage?.forwardInContextMenu === true,
            fakeDuration: config.voiceMessage?.fakeDurationEnabled === true
        },
        message: {
            promptNoSeq: config.messageTweaks?.promptNoSeq === true,
            removeReplyAt: config.messageTweaks?.removeReplyAt === true
        },
        reactions: {
            removeLimit: config.messageTweaks?.removeReactionLimit === true,
            keepOpen: config.messageTweaks?.keepReactionPanelOpen === true
        },
        preventRecall: {
            enabled: config.preventRecall?.enabled === true,
            preventSelf: config.preventRecall?.preventSelfMsg === true,
            persistedFiles: config.preventRecall?.persistedFiles === true,
            redirectImages: config.preventRecall?.redirectPicPath === true
        },
        poke: {
            autoReply: config.entertainment?.autoPokeBack === true,
            autoReplyLimit: Math.max(0, Number(config.entertainment?.autoPokeBackLimit) || 0),
            doubleClickAvatar: config.entertainment?.doubleClickAvatarPoke === true,
            contextMenu: config.entertainment?.rightClickAvatarPoke === true
        },
        interface: {
            inlineMedia: config.interfaceTweaks?.inlineMediaViewer === true,
            singleClickMedia: config.interfaceTweaks?.singleClickMediaViewer === true,
            singleMediaWindow: config.interfaceTweaks?.singleMediaViewer === true,
            menuOrder: config.interfaceTweaks?.messageContextMenuOrder?.enabled === true,
            preventProfileCard: config.interfaceTweaks?.preventProfileCardHover === true,
            preventRecentDrag: config.interfaceTweaks?.preventRecentContactDrag === true
        },
        floatingPanel: {
            enabled: config.floatingPanel?.enabled === true,
            shortcut: String(config.floatingPanel?.shortcut || '')
        },
        simplify: {
            sideTopHidden: (config.sideBar?.top || []).filter(item => item?.enabled === false).length,
            sideBottomHidden: (config.sideBar?.bottom || []).filter(item => item?.enabled === false).length,
            topHidden: (config.topFuncBar || []).filter(item => item?.enabled === false).length,
            chatHidden: (config.chatFuncBar || []).filter(item => item?.enabled === false).length
        }
    };
}

function getDiagnosticEnvironment() {
    const routeCounts = {};
    for (const browserWindow of BrowserWindow.getAllWindows()) {
        if (browserWindow.isDestroyed()) {
            continue;
        }
        const route = getWindowRoute(browserWindow.webContents.getURL());
        routeCounts[route] = (routeCounts[route] || 0) + 1;
    }
    return {
        pluginVersion: String(getPluginManifest().version || ''),
        qqVersion: getQqVersion(),
        liteLoaderVersion: getLiteLoaderVersion(),
        electronVersion: String(process.versions.electron || ''),
        nodeVersion: String(process.versions.node || ''),
        platform: process.platform,
        arch: process.arch,
        features: getDiagnosticFeatureSummary(),
        windows: routeCounts
    };
}

function getRepairDir() {
    return path.join(getPluginDataDir(), 'file-retry');
}

function getPreventRecallRootDir() {
    return path.join(getPluginDataDir(), 'prevent-recall');
}

function getPreventRecallDir(accountUin) {
    const normalized = normalizeUin(accountUin);
    return normalized ? path.join(getPreventRecallRootDir(), normalized) : '';
}

function getPreventRecallCachePath(accountUin) {
    const directory = getPreventRecallDir(accountUin);
    return directory ? path.join(directory, 'active-recall-cache.bin') : '';
}

function getPreventRecallImageDir(accountUin) {
    const directory = getPreventRecallDir(accountUin);
    return directory ? path.join(directory, 'images') : '';
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

function normalizeSimplifyItemName(value) {
    return String(value ?? '')
        .trim()
        .replace(/\s*[（(]?(?:99\+|\d+)\s*(?:条未读(?:消息)?|条新消息|个未读(?:消息)?)[）)]?\s*$/u, '')
        .trim();
}

function normalizeSimplifyItemList(items, prefix) {
    const normalized = new Map();
    for (const source of Array.isArray(items) ? items : []) {
        const rawId = String(source?.id ?? '').trim();
        const name = normalizeSimplifyItemName(source?.name) || normalizeSimplifyItemName(rawId);
        if (!name) {
            continue;
        }
        const id = !rawId || rawId.startsWith(`${prefix}:`)
            ? `${prefix}:${name.replace(/\s+/g, '')}`
            : rawId;
        const previous = normalized.get(id);
        normalized.set(id, {
            id,
            name,
            enabled: (previous?.enabled !== false) && source?.enabled !== false
        });
    }
    return Array.from(normalized.values());
}

function normalizeSimplifyConfig(config) {
    config.sideBar.top = normalizeSimplifyItemList(config.sideBar.top, 'sidebar-top');
    config.sideBar.bottom = normalizeSimplifyItemList(config.sideBar.bottom, 'sidebar-bottom');
    config.topFuncBar = normalizeSimplifyItemList(config.topFuncBar, 'top-func');
    config.chatFuncBar = normalizeSimplifyItemList(config.chatFuncBar, 'chat-func');
    return config;
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
        configCache = normalizeSimplifyConfig(mergeConfig(JSON.parse(fsSync.readFileSync(configPath, 'utf8'))));
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
    const wasDebugEnabled = isDebugEnabled();
    const normalizedConfig = normalizeSimplifyConfig(mergeConfig(nextConfig));
    const willDebugBeEnabled = process.env.QQNT_TOOLBOX_DEBUG === '1' || normalizedConfig.debug?.enabled === true;
    if (wasDebugEnabled && !willDebugBeEnabled) {
        recordDiagnostic('info', 'diagnostics.disabled');
    }
    configCache = normalizedConfig;
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(configCache, null, 2), 'utf8');
    if (!wasDebugEnabled && willDebugBeEnabled) {
        recordDiagnostic('info', 'diagnostics.enabled', {
            qqVersion: getQqVersion(),
            pluginVersion: getPluginManifest().version || '',
            features: getDiagnosticFeatureSummary(configCache)
        });
    }
    applyVoiceMessageConfig();
    broadcastConfigChanged();
    return clonePlain(configCache);
}

function getConfig() {
    return loadConfig();
}

function getFileRetryConfig() {
    return getConfig().fileRetryFixer;
}

function isRepeatMessageEnabled() {
    return getConfig().repeatMessage.enabled === true;
}

function isVoiceMessageEnabled() {
    return getConfig().voiceMessage.enabled === true;
}

function isVoiceSaveInContextMenuEnabled() {
    return getConfig().voiceMessage.saveInContextMenu === true;
}

function isVoiceForwardInContextMenuEnabled() {
    return getConfig().voiceMessage.forwardInContextMenu === true;
}

function getFakeVoiceDurationSeconds() {
    const config = getConfig().voiceMessage;
    if (config.fakeDurationEnabled !== true) {
        return 0;
    }
    const value = Math.trunc(Number(config.fakeDurationSeconds));
    return Number.isFinite(value) ? Math.min(Math.max(value, 1), 300) : 1;
}

function getPreventRecallConfig() {
    return getConfig().preventRecall;
}

function getEntertainmentConfig() {
    return getConfig().entertainment;
}

function getAutoPokeBackLimit() {
    const value = Math.trunc(Number(getEntertainmentConfig().autoPokeBackLimit));
    return Number.isFinite(value) ? Math.min(Math.max(value, 0), 9999) : 1;
}

function isPreventRecallEnabled() {
    return getPreventRecallConfig().enabled === true;
}

function applyVoiceMessageConfig() {
    voiceFileSender?.setDiagnosticRecorder?.(recordDiagnostic);
    voiceFileSender?.setEnabled?.(isVoiceMessageEnabled());
    voiceFileSender?.setSaveInContextMenuEnabled?.(isVoiceSaveInContextMenuEnabled());
    voiceFileSender?.setForwardInContextMenuEnabled?.(isVoiceForwardInContextMenuEnabled());
    voiceFileSender?.setFakeDurationSeconds?.(getFakeVoiceDurationSeconds());
}

function registerPokeAccount(browserWindow, value) {
    const selfUin = normalizeUin(value);
    if (selfUin && browserWindow && !browserWindow.isDestroyed()) {
        getWindowState(browserWindow).selfUin = selfUin;
        getRecallState(selfUin);
    }
    return Boolean(selfUin);
}

async function resolveRecallAccount(browserWindow) {
    if (!browserWindow || browserWindow.isDestroyed()) {
        throw new Error('BrowserWindow was not found.');
    }
    const viewerAccount = browserWindow === recallViewerWindow
        ? normalizeUin(recallViewerState.accountUin)
        : '';
    const selfUin = viewerAccount ||
        normalizeUin(getWindowState(browserWindow).selfUin) ||
        normalizeUin(await resolvePokeAccount(browserWindow));
    if (!selfUin) {
        throw new Error('Current QQ account was not found.');
    }
    getRecallState(selfUin);
    return selfUin;
}

function findAuthUin(value, depth = 0, seen = new WeakSet()) {
    if (!value || depth > 5) {
        return '';
    }
    if (typeof value === 'string') {
        const direct = normalizeUin(value);
        if (direct) {
            return direct;
        }
        try {
            return findAuthUin(JSON.parse(value), depth + 1, seen);
        } catch {
            return '';
        }
    }
    if (typeof value !== 'object' || value instanceof Uint8Array || seen.has(value)) {
        return '';
    }
    seen.add(value);
    for (const key of ['uin', 'selfUin', 'accountUin']) {
        const uin = normalizeUin(value[key]);
        if (uin) {
            return uin;
        }
    }
    for (const key of ['authData', 'data', 'result', 'payload', 'account', 'accountInfo']) {
        const uin = findAuthUin(value[key], depth + 1, seen);
        if (uin) {
            return uin;
        }
    }
    return '';
}

async function resolvePokeAccount(browserWindow, pageUin = '') {
    registerPokeAccount(browserWindow, pageUin);
    const state = getWindowState(browserWindow);
    let authUin = '';
    try {
        const authData = await qqNativeInvoke(
            browserWindow,
            'GlobalDataApi',
            'fetchAuthData',
            [],
            true,
            3000
        );
        authUin = findAuthUin(authData);
        registerPokeAccount(browserWindow, authUin);
    } catch (error) {
        debug('poke account lookup failed:', error?.message || error);
    }
    return state.selfUin || '';
}

function getQqVersion() {
    const version = globalThis.LiteLoader?.package?.qqnt?.version;
    if (version) {
        return String(version);
    }
    try {
        return String(require(path.join(process.resourcesPath, 'app', 'package.json')).version || '');
    } catch {
        return '';
    }
}

function isQqVersionAtLeast(major, minor, patch) {
    const actual = (getQqVersion().match(/\d+/g) || []).slice(0, 3).map(Number);
    if (actual.length < 3) {
        return false;
    }
    const required = [major, minor, patch];
    for (let index = 0; index < required.length; index++) {
        if (actual[index] !== required[index]) {
            return actual[index] > required[index];
        }
    }
    return true;
}

function supportsNativeNudge() {
    return isQqVersionAtLeast(9, 9, 32);
}

function getQqWrapperApi() {
    if (pokeState.wrapperApi) {
        return pokeState.wrapperApi;
    }
    for (const [id, module] of Object.entries(require.cache)) {
        if (path.basename(id).toLowerCase() === 'wrapper.node' &&
            module?.exports?.NodeIQQNTWrapperSession) {
            pokeState.wrapperApi = module.exports;
            return pokeState.wrapperApi;
        }
    }
    pokeState.wrapperApi = require(path.join(process.resourcesPath, 'app', 'wrapper.node'));
    return pokeState.wrapperApi;
}

function getQqWrapperSession() {
    if (pokeState.wrapperSession) {
        return pokeState.wrapperSession;
    }
    const sessionClass = getQqWrapperApi()?.NodeIQQNTWrapperSession;
    if (typeof sessionClass?.getNTWrapperSession !== 'function') {
        return null;
    }
    const session = sessionClass.getNTWrapperSession('nt_1');
    if (!session || typeof session.getMsgService !== 'function') {
        return null;
    }
    pokeState.wrapperSession = session;
    return session;
}

function installPokeBridge() {
    if (pokeState.bridgeInstalled) {
        return true;
    }
    if (process.platform !== 'win32' || process.arch !== 'x64') {
        return false;
    }
    try {
        pokeState.bridge ||= require(path.join(__dirname, '..', 'native', POKE_NATIVE_BINARY));
        const code = Number(pokeState.bridge?.install?.());
        pokeState.bridgeInstalled = code === 1 || code === 2;
        return pokeState.bridgeInstalled;
    } catch {
        return false;
    }
}

async function sendSsoThroughWrapperSession(command, packet) {
    const session = getQqWrapperSession();
    const service = session?.getMsgService?.();
    if (!service || typeof service.sendSsoCmdReqByContend !== 'function' ||
        typeof pokeState.bridge?.armConversion !== 'function' ||
        typeof pokeState.bridge?.disarmConversion !== 'function') {
        return null;
    }
    let request;
    pokeState.bridge.armConversion();
    try {
        request = service.sendSsoCmdReqByContend(command, packet);
    } finally {
        pokeState.bridge.disarmConversion();
    }
    return {
        path: 'wrapper-session',
        response: await request
    };
}

function getNativeNudgePeer(browserWindow, payload, chatType, targetUin, groupUin) {
    if (chatType === 2) {
        return {
            chatType,
            peerUid: groupUin,
            guildId: ''
        };
    }
    let peerUid = normalizeText(payload?.peerUid);
    if (!peerUid.startsWith('u_')) {
        const aliases = getWindowState(browserWindow).peerUidByUin;
        peerUid = aliases.get(targetUin) || aliases.get(peerUid) || '';
    }
    if (!peerUid.startsWith('u_')) {
        return null;
    }
    return {
        chatType,
        peerUid,
        guildId: ''
    };
}

async function sendPokeThroughNativeService(browserWindow, payload, chatType, targetUin, groupUin) {
    const peer = getNativeNudgePeer(browserWindow, payload, chatType, targetUin, groupUin);
    if (!peer) {
        return { ok: false, reason: 'peer-unavailable' };
    }
    const response = await qqNativeInvoke(
        browserWindow,
        'ntApi',
        NUDGE_SEND_COMMAND,
        [{
            peer,
            targetUin,
            chatUin: chatType === 2 ? groupUin : targetUin
        }, null],
        true,
        10000
    );
    const nativeCode = Number(response?.result);
    if (isNativeFailure(response) || (Number.isFinite(nativeCode) && nativeCode !== 0)) {
        throw new Error(`Native nudge request failed: ${safeJson(response)}`);
    }
    return { ok: true, method: 'native-nudge' };
}

async function sendPokeThroughLegacyProtocol(browserWindow, targetUin, groupUin) {
    if (!installPokeBridge()) {
        return { ok: false, reason: 'bridge-unavailable' };
    }
    const packet = buildPokePacket({ targetUin, groupUin });
    const directResult = await sendSsoThroughWrapperSession(POKE_COMMAND, packet);
    const response = directResult
        ? directResult.response
        : await qqNativeInvoke(
            browserWindow,
            'ntApi',
            'nodeIKernelMsgService/sendSsoCmdReqByContend',
            [POKE_COMMAND, packet],
            true,
            10000
        );
    const nativeCode = Number(response?.result);
    if (isNativeFailure(response) || (Number.isFinite(nativeCode) && nativeCode !== 0)) {
        throw new Error(`Native SSO request failed: ${safeJson(response)}`);
    }
    return { ok: true, method: 'legacy-sso' };
}

async function recallPokeThroughLegacyProtocol(browserWindow, request) {
    const selfUin = getWindowState(browserWindow).selfUin;
    const chatType = Number(request?.chatType);
    const initiatorUin = normalizeUin(request?.initiatorUin);
    const peerUin = chatType === 2
        ? normalizeUin(request?.peerUin)
        : normalizeUin(request?.targetUin);
    if (!initiatorUin || initiatorUin !== selfUin ||
        (chatType !== 1 && chatType !== 2) || !peerUin) {
        return { ok: false, reason: 'invalid-record' };
    }
    if (!installPokeBridge()) {
        return { ok: false, reason: 'bridge-unavailable' };
    }

    const packet = buildPokeRecallPacket({
        chatType,
        peerUin,
        msgType: request?.msgType,
        msgSeq: request?.msgSeq,
        msgTime: request?.msgTime,
        msgUid: request?.msgUid,
        msgId: request?.msgId,
        businessId: request?.businessId,
        tipsSeqId: request?.tipsSeqId
    });
    const directResult = await sendSsoThroughWrapperSession(POKE_RECALL_COMMAND, packet);
    const response = directResult
        ? directResult.response
        : await qqNativeInvoke(
            browserWindow,
            'ntApi',
            'nodeIKernelMsgService/sendSsoCmdReqByContend',
            [POKE_RECALL_COMMAND, packet],
            true,
            10000
        );
    const nativeCode = Number(response?.result);
    if (isNativeFailure(response) || (Number.isFinite(nativeCode) && nativeCode !== 0)) {
        throw new Error(`Poke recall request failed: ${safeJson(response)}`);
    }
    return { ok: true, method: 'legacy-f51' };
}

async function recallPoke(browserWindow, payload) {
    registerPokeAccount(browserWindow, payload?.selfUin);
    if (supportsNativeNudge()) {
        return { ok: false, reason: 'native-managed' };
    }
    if (!getWindowState(browserWindow).selfUin) {
        return { ok: false, reason: 'account-unavailable' };
    }
    try {
        return await recallPokeThroughLegacyProtocol(browserWindow, payload?.recall);
    } catch (error) {
        warn('poke recall failed:', error?.message || error);
        return { ok: false, reason: 'recall-failed' };
    }
}

async function sendPoke(browserWindow, payload) {
    const chatType = Number(payload?.chatType);
    const targetUin = normalizeUin(payload?.targetUin);
    const groupUin = chatType === 2 ? normalizeUin(payload?.groupUin) : '';
    registerPokeAccount(browserWindow, payload?.selfUin);
    if ((chatType !== 1 && chatType !== 2) || !targetUin || (chatType === 2 && !groupUin)) {
        return { ok: false, reason: 'invalid-target' };
    }

    try {
        if (supportsNativeNudge()) {
            return await sendPokeThroughNativeService(
                browserWindow,
                payload,
                chatType,
                targetUin,
                groupUin
            );
        }
        return await sendPokeThroughLegacyProtocol(browserWindow, targetUin, groupUin);
    } catch (error) {
        warn('poke failed:', error?.message || error);
        return { ok: false, reason: 'send-failed' };
    }
}

function broadcastConfigChanged() {
    const config = clonePlain(configCache || DEFAULT_CONFIG);
    for (const browserWindow of BrowserWindow.getAllWindows()) {
        if (!browserWindow.isDestroyed()) {
            browserWindow.webContents.send(CHANNEL_CONFIG_CHANGED, config);
        }
    }
}

function getReactionEmojiCatalog() {
    const messageTweaks = getConfig().messageTweaks;
    if (messageTweaks.removeReactionLimit !== true) {
        return [];
    }
    if (!reactionEmojiCatalog) {
        const documentDirectories = [
            app.getPath('documents'),
            path.join(os.homedir(), 'Documents'),
            path.join(process.env.USERPROFILE || os.homedir(), 'Documents')
        ];
        const tencentFilesRoots = Array.from(new Set(documentDirectories))
            .map(directory => path.join(directory, 'Tencent Files'));
        const catalog = loadReactionEmojiCatalog(tencentFilesRoots);
        if (catalog.length) {
            reactionEmojiCatalog = catalog;
        }
        return catalog;
    }
    return reactionEmojiCatalog;
}

async function setMessageReaction(browserWindow, payload) {
    const messageTweaks = getConfig().messageTweaks;
    if (messageTweaks.removeReactionLimit !== true) {
        return { ok: false, reason: 'disabled' };
    }
    const request = normalizeReactionRequest(payload);
    if (!request) {
        return { ok: false, reason: 'invalid-request' };
    }
    try {
        const result = await qqNativeInvoke(
            browserWindow,
            'ntApi',
            SET_MESSAGE_REACTION_COMMAND,
            [request, null],
            true,
            10000
        );
        return isNativeFailure(result)
            ? { ok: false, reason: 'native-failure' }
            : { ok: true };
    } catch (error) {
        warn('set message reaction failed:', error?.message || error);
        return { ok: false, reason: 'send-failed' };
    }
}

async function runDiagnosticAction(action) {
    return await getDiagnosticActionRunner().run(action);
}

function installConfigIpc() {
    if (globalThis.__qqntToolboxConfigIpcInstalled) {
        return;
    }
    globalThis.__qqntToolboxConfigIpcInstalled = true;
    ipcMain.handle(CHANNEL_GET_CONFIG, () => getConfig());
    ipcMain.handle(CHANNEL_SET_CONFIG, (_event, nextConfig) => saveConfig(nextConfig));
    ipcMain.handle(CHANNEL_DIAGNOSTIC_EVENT, (event, payload) => {
        if (!isDebugEnabled()) {
            return { ok: false, reason: 'disabled' };
        }
        const browserWindow = BrowserWindow.fromWebContents(event.sender);
        const entry = recordDiagnostic(
            ['warn', 'error'].includes(payload?.level) ? payload.level : 'info',
            `renderer.${String(payload?.event || 'event')}`,
            {
                route: getWindowRoute(browserWindow?.webContents?.getURL()),
                details: payload?.details || {}
            }
        );
        return { ok: Boolean(entry) };
    });
    ipcMain.handle(CHANNEL_DIAGNOSTIC_ACTION, (_event, action) => runDiagnosticAction(action));
    ipcMain.handle(CHANNEL_OPEN_INLINE_MEDIA, async (event, payload) => {
        const browserWindow = BrowserWindow.fromWebContents(event.sender);
        const summary = {
            type: payload?.type || '',
            source: payload?.identity ? 'file-message' : 'message'
        };
        try {
            const opened = browserWindow ? await openInlineMediaFromRenderer(browserWindow, payload) : false;
            recordDiagnostic(opened ? 'info' : 'warn', 'media.inline-open', {
                ...summary,
                ok: opened
            });
            return opened;
        } catch (error) {
            recordDiagnostic('error', 'media.inline-open-failed', { ...summary, error });
            throw error;
        }
    });
    ipcMain.handle(CHANNEL_PREPARE_INLINE_MEDIA, async (event, payload) => {
        const browserWindow = BrowserWindow.fromWebContents(event.sender);
        const index = Number(payload?.index);
        try {
            const prepared = browserWindow ? await prepareInlineMedia(browserWindow, payload) : null;
            recordDiagnostic(prepared ? 'info' : 'warn', 'media.prepare-completed', {
                ok: Boolean(prepared),
                index: Number.isInteger(index) ? index : -1,
                type: prepared?.type || ''
            });
            return prepared;
        } catch (error) {
            recordDiagnostic('error', 'media.prepare-failed', {
                index: Number.isInteger(index) ? index : -1,
                error
            });
            throw error;
        }
    });
    ipcMain.handle(CHANNEL_REPEAT_MESSAGE, async (event, payload) => {
        const browserWindow = BrowserWindow.fromWebContents(event.sender);
        if (!browserWindow) {
            throw new Error('BrowserWindow was not found.');
        }
        const summary = {
            source: payload?.recordSource || 'chat',
            elementTypes: (payload?.record?.elements || []).map(element => Number(element?.elementType) || 0),
            hasDestination: Boolean(payload?.destinationPeer)
        };
        recordDiagnostic('info', 'repeat.requested', summary);
        try {
            const result = await repeatMessageFromRenderer(browserWindow, payload);
            recordDiagnostic('info', 'repeat.completed', summary);
            return result;
        } catch (error) {
            recordDiagnostic('error', 'repeat.failed', { ...summary, error });
            throw error;
        }
    });
    ipcMain.handle(CHANNEL_GET_REACTION_CATALOG, () => {
        try {
            return getReactionEmojiCatalog();
        } catch (error) {
            warn('reaction emoji catalog failed:', error?.message || error);
            return [];
        }
    });
    ipcMain.handle(CHANNEL_SET_MESSAGE_REACTION, async (event, payload) => {
        const browserWindow = BrowserWindow.fromWebContents(event.sender);
        if (!browserWindow) {
            return { ok: false, reason: 'window-not-found' };
        }
        const result = await setMessageReaction(browserWindow, payload);
        recordDiagnostic(result?.ok ? 'info' : 'warn', 'reaction.completed', {
            ok: result?.ok === true,
            reason: result?.reason || '',
            setEmoji: payload?.setEmoji === true
        });
        return result;
    });
    ipcMain.handle(CHANNEL_SEND_POKE, async (event, payload) => {
        const entertainment = getEntertainmentConfig();
        const source = String(payload?.source || 'double-click');
        const enabled = source === 'context-menu'
            ? entertainment.rightClickAvatarPoke !== false
            : entertainment.doubleClickAvatarPoke === true;
        if (!enabled) {
            return { ok: false, reason: 'disabled' };
        }
        const browserWindow = BrowserWindow.fromWebContents(event.sender);
        if (!browserWindow) {
            return { ok: false, reason: 'window-not-found' };
        }
        const result = await sendPoke(browserWindow, payload);
        recordDiagnostic(result?.ok ? 'info' : 'warn', 'poke.completed', {
            ok: result?.ok === true,
            reason: result?.reason || '',
            method: result?.method || '',
            source,
            chatType: Number(payload?.chatType) || 0
        });
        return result;
    });
    ipcMain.handle(CHANNEL_RECALL_POKE, async (event, payload) => {
        const browserWindow = BrowserWindow.fromWebContents(event.sender);
        if (!browserWindow) {
            return { ok: false, reason: 'window-not-found' };
        }
        const result = await recallPoke(browserWindow, payload);
        recordDiagnostic(result?.ok ? 'info' : 'warn', 'poke-recall.completed', {
            ok: result?.ok === true,
            reason: result?.reason || '',
            method: result?.method || ''
        });
        return result;
    });
    ipcMain.handle(CHANNEL_REGISTER_POKE_ACCOUNT, async (event, selfUin) => {
        const browserWindow = BrowserWindow.fromWebContents(event.sender);
        if (!browserWindow) {
            return '';
        }
        return await resolvePokeAccount(browserWindow, selfUin);
    });
    ipcMain.handle(CHANNEL_CLEAR_RECALL_CACHE, async event => {
        const browserWindow = BrowserWindow.fromWebContents(event.sender);
        return await clearPreventRecallCache(await resolveRecallAccount(browserWindow));
    });
    ipcMain.handle(CHANNEL_OPEN_RECALL_DIR, async event => {
        const browserWindow = BrowserWindow.fromWebContents(event.sender);
        return await openPreventRecallDir(await resolveRecallAccount(browserWindow));
    });
    ipcMain.handle(CHANNEL_OPEN_RECALL_IMAGE_DIR, async event => {
        const browserWindow = BrowserWindow.fromWebContents(event.sender);
        return await openPreventRecallImageDir(await resolveRecallAccount(browserWindow));
    });
    ipcMain.handle(CHANNEL_VIEW_RECALL_MESSAGES, async event => {
        const browserWindow = BrowserWindow.fromWebContents(event.sender);
        const accountUin = await resolveRecallAccount(browserWindow);
        return await openPreventRecallMessages(accountUin);
    });
    ipcMain.handle(CHANNEL_GET_RECALL_VIEWER_DATA, async event => {
        const browserWindow = BrowserWindow.fromWebContents(event.sender);
        const accountUin = await resolveRecallAccount(browserWindow);
        return await getRecallViewerData(accountUin);
    });
    ipcMain.handle(CHANNEL_GET_RECALL_AUDIO_PREVIEW, (_event, payload) => getRecallAudioPreview(payload));
    ipcMain.handle(CHANNEL_JUMP_RECALL_MESSAGE, (_event, payload) => jumpToRecallMessage(payload));
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

function getWindowState(browserWindow) {
    let state = windowStates.get(browserWindow);
    if (!state) {
        state = {
            selfUin: '',
            peerUidByUin: new Map(),
            retriedRecords: new Map(),
            inFlightRecords: new Set(),
            pluginAttrIds: new Map(),
            inlineMediaByPeer: new Map(),
            inlineReplySourcesByPeer: new Map(),
            inlineMediaGallery: null,
            inlineMediaDownloads: new Map()
        };
        windowStates.set(browserWindow, state);
    }
    return state;
}

function findIpcObject(value, predicate, depth = 0, seen = new WeakSet()) {
    if (!value || depth > 6 || typeof value !== 'object' || value instanceof Uint8Array) {
        return null;
    }
    if (seen.has(value)) {
        return null;
    }
    seen.add(value);
    if (predicate(value)) {
        return value;
    }
    const entries = value instanceof Map ? value.values() : Object.values(value);
    for (const item of entries) {
        const match = findIpcObject(item, predicate, depth + 1, seen);
        if (match) {
            return match;
        }
    }
    return null;
}

function getInterfaceTweaksConfig() {
    if (!configCache) {
        loadConfig();
    }
    return configCache.interfaceTweaks;
}

function replyWithNativeResult(event, request, result) {
    const sender = event?.sender;
    if (!sender || sender.isDestroyed()) {
        return false;
    }
    const peerId = request.peerId ?? sender.id;
    const responseChannel = `RM_IPCFROM_MAIN${peerId}`;
    const response = {
        callbackId: request.callbackId,
        promiseStatue: 'full',
        type: 'response',
        eventName: request.eventName,
        peerId
    };
    setImmediate(() => {
        if (!sender.isDestroyed()) {
            sender.send(responseChannel, response, result);
        }
    });
    return true;
}

function replyWithEmptyQrResult(event, request) {
    return replyWithNativeResult(event, request, { infos: [] });
}

function isMediaViewerWindow(browserWindow) {
    if (!browserWindow || browserWindow.isDestroyed()) {
        return false;
    }
    return isNativeMediaViewerUrl(browserWindow.webContents.getURL());
}

function closeExistingMediaViewers(sender) {
    for (const browserWindow of BrowserWindow.getAllWindows()) {
        if (browserWindow.webContents !== sender && isMediaViewerWindow(browserWindow)) {
            browserWindow.close();
        }
    }
}

function isInlineMediaHost(browserWindow) {
    if (!browserWindow || browserWindow.isDestroyed() || browserWindow.webContents.isDestroyed()) {
        return false;
    }
    const url = browserWindow.webContents.getURL();
    return ['#/main/message', '#/chat', '#/forward', '#/record'].some(route => url.includes(route));
}

async function showInlineMediaPreview(browserWindow, gallery) {
    gallery = completeInlineMediaGallery(browserWindow, gallery);
    const state = getWindowState(browserWindow);
    const selected = gallery.items[gallery.index];
    const selectedKey = getInlineMediaItemKey(selected);
    const items = gallery.items;
    const index = Math.max(items.findIndex(item => getInlineMediaItemKey(item) === selectedKey), 0);
    const galleryId = crypto.randomUUID();
    state.inlineMediaGallery = { id: galleryId, items };
    state.inlineMediaDownloads.clear();
    const previewItems = await Promise.all(items.map(async item => {
        const localPath = getExistingFilePath([item.filePath]);
        return {
            type: item.type,
            src: localPath ? await inlineMediaServer.getUrl(localPath) : '',
            name: item.name,
            needsResolve: !localPath && Boolean(createInlineMediaDownloadRequest(item))
        };
    }));
    const sender = browserWindow.webContents;
    sender.send(CHANNEL_INLINE_MEDIA_PREVIEW, {
        galleryId,
        index,
        items: previewItems
    });
}

async function downloadInlineMediaFile(browserWindow, item) {
    const existingPath = getExistingFilePath([item?.filePath]);
    if (existingPath) {
        return existingPath;
    }
    const payload = createInlineMediaDownloadPayload(item);
    if (!payload) {
        return '';
    }
    const request = payload[0].getReq;
    try {
        await qqNativeInvoke(
            browserWindow,
            'ntApi',
            'nodeIKernelMsgService/downloadRichMedia',
            payload,
            false
        );
    } catch {
        return '';
    }
    const deadline = Date.now() + MEDIA_PREVIEW_DOWNLOAD_WAIT_MS;
    while (Date.now() < deadline) {
        const filePath = getExistingFilePath([request.filePath]);
        if (filePath) {
            item.filePath = filePath;
            return filePath;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return '';
}

async function prepareInlineMedia(browserWindow, payload) {
    if (getInterfaceTweaksConfig().inlineMediaViewer !== true) {
        return null;
    }
    const state = getWindowState(browserWindow);
    const gallery = state.inlineMediaGallery;
    const index = Number(payload?.index);
    if (!gallery || normalizeText(payload?.galleryId) !== gallery.id ||
        !Number.isInteger(index) || index < 0 || index >= gallery.items.length) {
        return null;
    }
    const item = gallery.items[index];
    const key = `${gallery.id}:${index}`;
    let pending = state.inlineMediaDownloads.get(key);
    if (!pending) {
        pending = downloadInlineMediaFile(browserWindow, item)
            .finally(() => state.inlineMediaDownloads.delete(key));
        state.inlineMediaDownloads.set(key, pending);
    }
    const filePath = await pending;
    if (!filePath || state.inlineMediaGallery?.id !== gallery.id) {
        return null;
    }
    return {
        type: item.type,
        src: await inlineMediaServer.getUrl(filePath),
        name: item.name
    };
}

async function openInlineMediaFromRenderer(browserWindow, payload) {
    if (getInterfaceTweaksConfig().inlineMediaViewer !== true) {
        return false;
    }
    const item = normalizeInlineMediaOpenItem(payload);
    if (!item || (!getExistingFilePath([item.filePath]) && !createInlineMediaDownloadRequest(item))) {
        return false;
    }
    const filePath = getExistingFilePath([item.filePath]) || await downloadInlineMediaFile(browserWindow, item);
    if (!filePath) {
        return false;
    }
    item.filePath = filePath;
    closeExistingMediaViewers(browserWindow.webContents);
    await showInlineMediaPreview(browserWindow, { items: [item], index: 0 });
    return true;
}

function handleToolboxNativeRequest(browserWindow, _channel, args) {
    const command = args.find(value => value?.cmdName && value?.payload !== undefined);
    if (!command) {
        return false;
    }
    const tweaks = getInterfaceTweaksConfig();
    const request = args.find(value => typeof value?.callbackId === 'string');
    if (tweaks.disableImageQrScan === true && command.cmdName === QR_SCAN_COMMAND) {
        recordDiagnostic('info', 'qr-scan.blocked');
        return Boolean(request && replyWithEmptyQrResult(args[0], request));
    }
    if (command.cmdName !== OPEN_MEDIA_VIEWER_COMMAND) {
        return false;
    }
    if (tweaks.inlineMediaViewer === true && isInlineMediaHost(browserWindow)) {
        const gallery = extractInlineMediaGallery(command);
        if (!gallery) {
            return false;
        }
        closeExistingMediaViewers(browserWindow.webContents);
        showInlineMediaPreview(browserWindow, gallery)
            .catch(error => warn('inline media preview failed:', error?.message || error));
        recordDiagnostic('info', 'media.native-viewer-intercepted', {
            itemCount: gallery.items.length,
            selectedIndex: gallery.index
        });
        if (request) {
            replyWithNativeResult(args[0], request, null);
        }
        return true;
    }
    if (tweaks.singleMediaViewer === true) {
        closeExistingMediaViewers(browserWindow.webContents);
    }
    return false;
}

function rememberNativePeerAliases(browserWindow, context) {
    const state = getWindowState(browserWindow);
    for (const alias of context.aliases) {
        state.peerUidByUin.set(alias.peerUin, alias.peerUid);
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

function resolveUinFromUid(browserWindow, uid) {
    uid = normalizeText(uid);
    if (!uid) {
        return '';
    }
    for (const [uin, mappedUid] of getWindowState(browserWindow).peerUidByUin) {
        if (mappedUid === uid) {
            return normalizeUin(uin);
        }
    }
    return '';
}

function rememberPokeAccountFromRecords(browserWindow, records) {
    for (const record of records) {
        if (Number(record?.sendType) === 1 && registerPokeAccount(browserWindow, record?.senderUin)) {
            return;
        }
    }
}

function getPokeEventKey(record, event) {
    const msgId = normalizeText(record?.msgId);
    if (msgId && msgId !== '0') {
        return `msg:${msgId}`;
    }
    return [
        'poke',
        normalizeText(record?.chatType),
        normalizeText(record?.peerUid || record?.peerUin),
        normalizeText(record?.msgSeq),
        normalizeText(record?.msgTime),
        event.initiatorUin || event.initiatorUid,
        event.targetUin || event.targetUid
    ].join(':');
}

function getPokeReplyTargetKey(chatType, targetUin, groupUin = '') {
    return [
        Number(chatType) || 0,
        normalizeUin(groupUin),
        normalizeUin(targetUin)
    ].join(':');
}

function prunePokeState() {
    const now = Date.now();
    const cutoff = now - POKE_EVENT_TTL_MS;
    for (const [key, timestamp] of pokeState.processedEvents) {
        if (timestamp < cutoff) {
            pokeState.processedEvents.delete(key);
        }
    }
    const sequenceCutoff = now - POKE_AUTO_REPLY_SEQUENCE_WINDOW_MS;
    for (const [key, sequence] of pokeState.autoReplySequences) {
        if (sequence.lastAt < sequenceCutoff) {
            pokeState.autoReplySequences.delete(key);
        }
    }
}

function isRecentPokeRecord(record) {
    const msgTime = Number(record?.msgTime);
    if (!Number.isFinite(msgTime) || msgTime <= 0) {
        return true;
    }
    const timestamp = msgTime > 1e12 ? msgTime : msgTime * 1000;
    return Math.abs(Date.now() - timestamp) <= POKE_AUTO_REPLY_MAX_AGE_MS;
}

function processPokeUpdates(browserWindow, context) {
    if (!context.commandNames.has(POKE_RECEIVE_CMD)) {
        return;
    }
    const records = context.records;
    rememberPokeAccountFromRecords(browserWindow, records);
    if (getEntertainmentConfig().autoPokeBack !== true) {
        return;
    }

    prunePokeState();
    for (const record of new Set(records)) {
        const event = extractPokeEvent(record);
        if (!event || !isRecentPokeRecord(record)) {
            continue;
        }
        event.initiatorUin ||= resolveUinFromUid(browserWindow, event.initiatorUid);
        event.targetUin ||= resolveUinFromUid(browserWindow, event.targetUid);

        const chatType = Number(record?.chatType);
        const peerUin = normalizeUin(record?.peerUin || record?.peerUid) ||
            resolveUinFromUid(browserWindow, record?.peerUid);
        if (chatType === 1 && peerUin && event.initiatorUin === peerUin &&
            event.targetUin && event.targetUin !== peerUin) {
            registerPokeAccount(browserWindow, event.targetUin);
        }
        const selfUin = getWindowState(browserWindow).selfUin;
        if (!event.initiatorUin || !event.targetUin || !selfUin ||
            event.targetUin !== selfUin || event.initiatorUin === selfUin) {
            continue;
        }

        const groupUin = chatType === 2 ? peerUin : '';
        if ((chatType !== 1 && chatType !== 2) || (chatType === 2 && !groupUin)) {
            continue;
        }
        const key = getPokeEventKey(record, event);
        if (pokeState.processedEvents.has(key)) {
            continue;
        }
        const now = Date.now();
        pokeState.processedEvents.set(key, now);
        const replyTargetKey = getPokeReplyTargetKey(chatType, event.initiatorUin, groupUin);
        const previousSequence = pokeState.autoReplySequences.get(replyTargetKey);
        const sequence = previousSequence &&
            now - previousSequence.lastAt <= POKE_AUTO_REPLY_SEQUENCE_WINDOW_MS
            ? previousSequence
            : { count: 0, lastAt: 0 };
        const limit = getAutoPokeBackLimit();
        if (limit > 0 && sequence.count >= limit) {
            sequence.lastAt = now;
            pokeState.autoReplySequences.set(replyTargetKey, sequence);
            recordDiagnostic('info', 'poke-auto-reply.skipped', { reason: 'limit', chatType, limit });
            continue;
        }
        const nextSequence = { count: sequence.count + 1, lastAt: now };
        pokeState.autoReplySequences.set(replyTargetKey, nextSequence);
        Promise.resolve(sendPoke(browserWindow, {
            chatType,
            targetUin: event.initiatorUin,
            groupUin,
            selfUin,
            source: 'auto-reply'
        })).then(result => {
            recordDiagnostic(result?.ok ? 'info' : 'warn', 'poke-auto-reply.completed', {
                ok: result?.ok === true,
                reason: result?.reason || '',
                method: result?.method || '',
                chatType
            });
            if (!result?.ok && pokeState.autoReplySequences.get(replyTargetKey) === nextSequence) {
                pokeState.autoReplySequences.delete(replyTargetKey);
            }
        }).catch(error => {
            if (pokeState.autoReplySequences.get(replyTargetKey) === nextSequence) {
                pokeState.autoReplySequences.delete(replyTargetKey);
            }
            warn('automatic poke-back failed:', error?.message || error);
        });
    }
}

function isMsgRecord(value) {
    return Boolean(value && typeof value === 'object' && (value.msgId !== undefined || value.msgSeq !== undefined) && Array.isArray(value.elements));
}

function deleteBubbleSkinFromRecord(record) {
    const attributes = record?.msgAttrs;
    const attribute = attributes instanceof Map ? attributes.get(0) : attributes?.[0] || attributes?.['0'];
    if (!attribute?.vasMsgInfo?.bubbleInfo) {
        return false;
    }
    const nextAttribute = {
        ...attribute,
        vasMsgInfo: {
            ...attribute.vasMsgInfo,
            bubbleInfo: {
                bubbleId: 0,
                bubbleDiyTextId: null,
                subBubbleId: null,
                canConvertToText: null
            }
        }
    };
    if (attributes instanceof Map) {
        attributes.set(0, nextAttribute);
    } else if (attributes) {
        attributes[0] = nextAttribute;
    }
    return true;
}

function processDeleteBubbleSkin(context) {
    if (!getConfig().interfaceTweaks.deleteBubbleSkin) {
        return;
    }
    for (const record of context.records) {
        deleteBubbleSkinFromRecord(record);
    }
}

function shouldBlockUpdateNotice(context) {
    return getConfig().interfaceTweaks.hiddenUpdateBtnAndNotice === true &&
        context.hasUnitedConfigGroup;
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

function createRecallState(accountUin) {
    return {
        accountUin: normalizeUin(accountUin),
        imageDownloads: new Map(),
        liveMessages: new Map(),
        recalledMessages: new Map(),
        persistedIds: new Set(),
        loaded: false
    };
}

function getRecallState(accountUin, create = true) {
    const normalized = normalizeUin(accountUin);
    if (!normalized) {
        return null;
    }
    let state = recallStates.get(normalized);
    if (!state && create) {
        state = createRecallState(normalized);
        recallStates.set(normalized, state);
    }
    if (state && !state.loaded) {
        loadPersistedRecallCache(state);
    }
    return state || null;
}

function pruneRecallCache(recallState) {
    if (!recallState) {
        return;
    }
    while (recallState.liveMessages.size > MAX_RECALL_CACHE_SIZE) {
        recallState.liveMessages.delete(recallState.liveMessages.keys().next().value);
    }
    while (recallState.recalledMessages.size > MAX_RECALL_CACHE_SIZE) {
        recallState.recalledMessages.delete(recallState.recalledMessages.keys().next().value);
    }
}

function cloneRecallRecord(record) {
    return deepCloneForSend(record);
}

function getRecallPicOriginalSourcePath(pic) {
    return getExistingFilePath([
        pic?.sourcePath,
        pic?.filePath,
        pic?.originPath,
        pic?.localPath,
        pic?.path
    ]);
}

function getRecallImageTargetPath(recallState, record, element, index, sourcePath) {
    const pic = element?.picElement;
    const imageDirectory = getPreventRecallImageDir(recallState?.accountUin);
    if (!pic || !imageDirectory) {
        return '';
    }
    const md5 = normalizeText(pic.md5HexStr || pic.originImageMd5)
        .replace(/[^a-f0-9]/gi, '')
        .toLowerCase();
    const identity = md5 || crypto.createHash('sha1')
        .update([
            normalizeText(pic.fileUuid),
            normalizeText(record?.msgId),
            normalizeText(element?.elementId),
            String(index)
        ].join(':'))
        .digest('hex');
    const extension = [path.extname(sourcePath), path.extname(normalizeText(pic.fileName))]
        .map(value => value.toLowerCase())
        .find(value => IMAGE_EXTENSIONS.has(value)) || '.jpg';
    return path.join(imageDirectory, `${identity}${extension}`);
}

function applyRecallImagePath(pic, targetPath) {
    if (!pic || !targetPath) {
        return false;
    }
    let changed = [pic.sourcePath, pic.filePath, pic.originPath, pic.localPath, pic.path]
        .some(value => value && normalizeComparablePath(value) !== normalizeComparablePath(targetPath));
    pic.sourcePath = targetPath;
    pic.filePath = targetPath;
    pic.originPath = targetPath;
    pic.localPath = targetPath;
    pic.path = targetPath;
    if (pic.thumbPath instanceof Map) {
        const keys = pic.thumbPath.size ? Array.from(pic.thumbPath.keys()) : [0];
        for (const key of keys) {
            changed = normalizeComparablePath(pic.thumbPath.get(key)) !== normalizeComparablePath(targetPath) || changed;
            pic.thumbPath.set(key, targetPath);
        }
    } else if (Array.isArray(pic.thumbPath)) {
        changed = pic.thumbPath.some(value => normalizeComparablePath(value) !== normalizeComparablePath(targetPath)) || changed;
        pic.thumbPath = pic.thumbPath.length ? pic.thumbPath.map(() => targetPath) : [targetPath];
    } else if (pic.thumbPath && typeof pic.thumbPath === 'object') {
        const keys = Object.keys(pic.thumbPath);
        for (const key of keys.length ? keys : ['0']) {
            changed = normalizeComparablePath(pic.thumbPath[key]) !== normalizeComparablePath(targetPath) || changed;
            pic.thumbPath[key] = targetPath;
        }
    } else {
        changed = normalizeComparablePath(pic.thumbPath) !== normalizeComparablePath(targetPath) || changed;
        pic.thumbPath = new Map([[0, targetPath], [198, targetPath], [720, targetPath]]);
    }
    return changed;
}

function copyRecallImageSync(recallState, record, element, index, sourcePath) {
    const targetPath = getRecallImageTargetPath(recallState, record, element, index, sourcePath);
    if (!targetPath) {
        return '';
    }
    fsSync.mkdirSync(path.dirname(targetPath), { recursive: true });
    if (normalizeComparablePath(sourcePath) !== normalizeComparablePath(targetPath)) {
        const sourceSize = fsSync.statSync(sourcePath).size;
        const targetSize = fsSync.existsSync(targetPath) ? fsSync.statSync(targetPath).size : -1;
        if (sourceSize > targetSize) {
            fsSync.copyFileSync(sourcePath, targetPath);
        }
    }
    return fsSync.existsSync(targetPath) ? targetPath : '';
}

function localizeRecallImages(recallState, record) {
    if (!getPreventRecallConfig().redirectPicPath) {
        return false;
    }
    let changed = false;
    const elements = getRecordElements(record);
    for (let index = 0; index < elements.length; index++) {
        const element = elements[index];
        const pic = element?.picElement;
        if (!pic) {
            continue;
        }
        const sourcePath = getPicSourcePath(pic);
        if (!sourcePath) {
            continue;
        }
        try {
            const targetPath = copyRecallImageSync(recallState, record, element, index, sourcePath);
            changed = applyRecallImagePath(pic, targetPath) || changed;
        } catch (error) {
            warn('recall image localize failed:', error?.message || error);
        }
    }
    return changed;
}

async function copyRecallImageAsync(recallState, record, element, index, sourcePath) {
    const targetPath = getRecallImageTargetPath(recallState, record, element, index, sourcePath);
    if (!targetPath) {
        return '';
    }
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    if (normalizeComparablePath(sourcePath) !== normalizeComparablePath(targetPath)) {
        const sourceSize = (await fs.stat(sourcePath)).size;
        let targetSize = -1;
        try {
            targetSize = (await fs.stat(targetPath)).size;
        } catch {
        }
        if (sourceSize > targetSize) {
            await fs.copyFile(sourcePath, targetPath);
        }
    }
    try {
        return (await fs.stat(targetPath)).isFile() ? targetPath : '';
    } catch {
        return '';
    }
}

async function downloadRecallImageFromRemote(recallState, record, element, index) {
    const pic = element?.picElement;
    if (!pic) {
        return '';
    }
    const remoteUrl = await resolveRecallImageUrl(pic);
    const targetPath = getRecallImageTargetPath(
        recallState,
        record,
        element,
        index,
        normalizeText(pic.fileName)
    );
    if (!remoteUrl || !targetPath) {
        return '';
    }
    const temporaryPath = `${targetPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    timeout.unref?.();
    try {
        const response = await fetch(remoteUrl, { signal: controller.signal });
        const contentType = normalizeText(response.headers?.get?.('content-type')).toLowerCase();
        if (!response.ok || !response.body || contentType.includes('json') || contentType.startsWith('text/')) {
            return '';
        }
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await pipeline(Readable.fromWeb(response.body), fsSync.createWriteStream(temporaryPath));
        const downloadedSize = (await fs.stat(temporaryPath)).size;
        if (!downloadedSize) {
            return '';
        }
        let currentSize = -1;
        try {
            currentSize = (await fs.stat(targetPath)).size;
        } catch {
        }
        if (currentSize >= downloadedSize) {
            return targetPath;
        }
        await fs.rm(targetPath, { force: true });
        await fs.rename(temporaryPath, targetPath);
        return targetPath;
    } catch (error) {
        warn('recall image CDN download failed:', error?.message || error);
        return '';
    } finally {
        clearTimeout(timeout);
        await fs.rm(temporaryPath, { force: true }).catch(() => {});
    }
}

function getRecallImageJobKey(record, element, index) {
    const pic = element?.picElement;
    const identity = normalizeText(pic?.md5HexStr || pic?.originImageMd5 || pic?.fileUuid);
    return identity
        ? `image:${identity}`
        : `message:${normalizeText(record?.msgId)}:${normalizeText(element?.elementId)}:${index}`;
}

async function archiveRecallImage(recallState, record, element, index) {
    const pic = element?.picElement;
    if (!pic) {
        return '';
    }
    const originalSource = getRecallPicOriginalSourcePath(pic);
    const availableSource = originalSource || getPicSourcePath(pic);
    const expectedSize = Number(pic.fileSize) || 0;
    const existingTarget = getExistingFilePath([
        getRecallImageTargetPath(
            recallState,
            record,
            element,
            index,
            availableSource || normalizeText(pic.fileName)
        )
    ]);
    if (existingTarget) {
        const existingSize = (await fs.stat(existingTarget)).size;
        if (expectedSize <= 0 || existingSize >= expectedSize) {
            return existingTarget;
        }
    }
    let originalSize = 0;
    if (originalSource) {
        try {
            originalSize = (await fs.stat(originalSource)).size;
        } catch {
        }
    }
    let targetPath = availableSource
        ? await copyRecallImageAsync(recallState, record, element, index, availableSource)
        : '';
    let archivedSize = 0;
    if (targetPath) {
        try {
            archivedSize = (await fs.stat(targetPath)).size;
        } catch {
        }
    }
    const hasCompleteOriginal = Boolean(originalSource) && (expectedSize <= 0 || originalSize >= expectedSize);
    if (!hasCompleteOriginal && (!targetPath || (expectedSize > 0 && archivedSize < expectedSize))) {
        const downloadedPath = await downloadRecallImageFromRemote(recallState, record, element, index);
        if (downloadedPath) {
            targetPath = downloadedPath;
        }
    }
    return targetPath;
}

function findRecallPicElement(record, sourceElement, index) {
    const elements = getRecordElements(record);
    const elementId = normalizeText(sourceElement?.elementId);
    const md5 = normalizeText(sourceElement?.picElement?.md5HexStr);
    return elements.find(element => element?.picElement && elementId && normalizeText(element.elementId) === elementId) ||
        elements.find(element => element?.picElement && md5 && normalizeText(element.picElement.md5HexStr) === md5) ||
        elements[index];
}

function scheduleRecallImageLocalization(recallState, record) {
    if (!getPreventRecallConfig().redirectPicPath || !recallState) {
        return Promise.resolve(false);
    }
    const msgId = getRecallKey(record);
    if (!msgId) {
        return Promise.resolve(false);
    }
    const tasks = getRecordElements(record).map((element, index) => {
        if (!element?.picElement) {
            return null;
        }
        const key = getRecallImageJobKey(record, element, index);
        let job = recallState.imageDownloads.get(key);
        if (!job) {
            job = archiveRecallImage(recallState, record, element, index);
            recallState.imageDownloads.set(key, job);
            job.then(
                () => recallState.imageDownloads.get(key) === job && recallState.imageDownloads.delete(key),
                () => recallState.imageDownloads.get(key) === job && recallState.imageDownloads.delete(key)
            );
        }
        return job.then(targetPath => {
            if (!targetPath) {
                return false;
            }
            const current = recallState.liveMessages.get(msgId) || recallState.recalledMessages.get(msgId) || record;
            const currentElement = findRecallPicElement(current, element, index);
            const changed = applyRecallImagePath(currentElement?.picElement, targetPath);
            if (current !== record) {
                applyRecallImagePath(findRecallPicElement(record, element, index)?.picElement, targetPath);
            }
            return changed;
        });
    }).filter(Boolean);
    if (!tasks.length) {
        return Promise.resolve(false);
    }
    return Promise.all(tasks).then(results => {
        const changed = results.some(Boolean);
        if (changed && recallState.recalledMessages.has(msgId)) {
            persistRecallRecord(recallState, recallState.recalledMessages.get(msgId), true);
        }
        return changed;
    }).catch(error => {
        warn('recall image archive failed:', error?.message || error);
        return false;
    });
}

function persistRecallRecord(recallState, record, allowUpdate = false) {
    if (!getPreventRecallConfig().persistedFiles) {
        return;
    }
    const msgId = getRecallKey(record);
    const directory = getPreventRecallDir(recallState?.accountUin);
    const cachePath = getPreventRecallCachePath(recallState?.accountUin);
    if (!msgId || !directory || !cachePath || (!allowUpdate && recallState.persistedIds.has(msgId))) {
        return;
    }
    try {
        fsSync.mkdirSync(directory, { recursive: true });
        const payload = deflateSync(serialize(record));
        const length = Buffer.allocUnsafe(4);
        length.writeUInt32BE(payload.length);
        fsSync.appendFileSync(cachePath, Buffer.concat([length, payload]));
        recallState.persistedIds.add(msgId);
    } catch (error) {
        warn('recall persist failed:', error?.message || error);
    }
}

function loadPersistedRecallCache(recallState) {
    if (!recallState?.accountUin) {
        return;
    }
    if (recallState.loaded) {
        return;
    }
    recallState.loaded = true;
    const directory = getPreventRecallDir(recallState.accountUin);
    const cachePath = getPreventRecallCachePath(recallState.accountUin);
    try {
        fsSync.mkdirSync(directory, { recursive: true });
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
            if (!msgId || !record?.qqnt_toolbox_recall) {
                continue;
            }
            const storedAccount = normalizeUin(record?.qqnt_toolbox_account_uin);
            if (storedAccount && storedAccount !== recallState.accountUin) {
                continue;
            }
            recallState.recalledMessages.set(msgId, record);
            recallState.persistedIds.add(msgId);
        }
        pruneRecallCache(recallState);
    } catch (error) {
        warn('recall cache load failed:', error?.message || error);
    }
}

function cacheRecallCandidate(recallState, record) {
    if (!recallState) {
        return;
    }
    const msgId = getRecallKey(record);
    if (!msgId || !getRecordElements(record).length || getRecallInfo(record) || record?.qqnt_toolbox_recall) {
        return;
    }
    const cached = deepCloneForSend(record);
    recallState.liveMessages.set(msgId, cached);
    pruneRecallCache(recallState);
}

function getRecoveredRecallRecord(recallState, record) {
    if (!recallState) {
        return null;
    }
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
    if (getConfig().interfaceTweaks.deleteBubbleSkin) {
        deleteBubbleSkinFromRecord(recovered);
    }
    recovered.qqnt_toolbox_recall = createRecallMark(record);
    recovered.qqnt_toolbox_account_uin = recallState.accountUin;
    scheduleRecallImageLocalization(recallState, recovered);
    localizeRecallImages(recallState, recovered);
    recallState.liveMessages.delete(msgId);
    recallState.recalledMessages.set(msgId, deepCloneForSend(recovered));
    persistRecallRecord(recallState, recovered);
    pruneRecallCache(recallState);
    return recovered;
}

function processPreventRecall(browserWindow, context) {
    if (!isPreventRecallEnabled()) {
        return;
    }
    rememberPokeAccountFromRecords(browserWindow, context.records);
    const recallState = getRecallState(getWindowState(browserWindow).selfUin, false);
    if (!recallState) {
        return;
    }
    for (const record of context.records) {
        const recovered = getRecoveredRecallRecord(recallState, record);
        if (!recovered) {
            cacheRecallCandidate(recallState, record);
            continue;
        }
        Object.keys(record).forEach(key => delete record[key]);
        Object.assign(record, recovered);
        recordDiagnostic('info', 'recall.recovered', {
            chatType: Number(recovered?.chatType) || 0,
            elementTypes: (recovered?.elements || []).map(element => Number(element?.elementType) || 0),
            persisted: getConfig().preventRecall.persistedFiles === true
        });
    }
}

async function clearPreventRecallCache(accountUin) {
    const recallState = getRecallState(accountUin);
    const rootDirectory = path.resolve(getPreventRecallRootDir());
    const accountDirectory = path.resolve(getPreventRecallDir(accountUin));
    if (!recallState || path.dirname(accountDirectory) !== rootDirectory) {
        throw new Error('Invalid recall cache directory.');
    }
    recallState.liveMessages.clear();
    recallState.recalledMessages.clear();
    recallState.persistedIds.clear();
    recallState.imageDownloads.clear();
    await fs.rm(accountDirectory, { recursive: true, force: true });
    await fs.mkdir(accountDirectory, { recursive: true });
    await fs.writeFile(getPreventRecallCachePath(accountUin), Buffer.alloc(0));
    return { success: true };
}

async function openPreventRecallDir(accountUin) {
    const directory = getPreventRecallDir(accountUin);
    if (!directory) {
        throw new Error('Current QQ account was not found.');
    }
    await fs.mkdir(directory, { recursive: true });
    return await shell.openPath(directory);
}

async function openPreventRecallImageDir(accountUin) {
    const directory = getPreventRecallImageDir(accountUin);
    if (!directory) {
        throw new Error('Current QQ account was not found.');
    }
    await fs.mkdir(directory, { recursive: true });
    return await shell.openPath(directory);
}

async function getAllPreventRecallRecords(accountUin) {
    const recallState = getRecallState(accountUin);
    if (!recallState) {
        return [];
    }
    const recordsByKey = new Map();
    const addRecord = record => {
        if (!record || typeof record !== 'object') {
            return;
        }
        const key = normalizeText(record.msgId) ||
            `${normalizeText(record.peerUid || record.peer?.peerUid)}:${normalizeText(record.msgSeq)}:${recordsByKey.size}`;
        recordsByKey.set(key || String(recordsByKey.size), record);
    };
    for (const record of recallState.recalledMessages.values()) {
        const storedAccount = normalizeUin(record?.qqnt_toolbox_account_uin);
        if (storedAccount && storedAccount !== recallState.accountUin) {
            continue;
        }
        if (localizeRecallImages(recallState, record)) {
            persistRecallRecord(recallState, record, true);
        }
        addRecord(record);
    }
    return Array.from(recordsByKey.values());
}

function getRecallDisplayName(record) {
    const mark = record?.qqnt_toolbox_recall || {};
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

function getRecallOperatorName(record) {
    const mark = record?.qqnt_toolbox_recall || {};
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
    return uin ? `https://q.qlogo.cn/headimg_dl?dst_uin=${uin}&spec=100` : '';
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

function getArkViewerCard(arkElement) {
    let data = {};
    try {
        data = JSON.parse(normalizeText(arkElement?.bytesData));
    } catch {
    }
    const metadata = data?.meta && typeof data.meta === 'object'
        ? Object.values(data.meta).find(value => value && typeof value === 'object') || {}
        : {};
    return {
        type: 'card',
        title: normalizeText(metadata.title) || normalizeText(data.prompt) || normalizeText(arkElement?.prompt) || '卡片消息',
        subtitle: normalizeText(metadata.desc) || normalizeText(data.desc) || normalizeText(arkElement?.appName) || normalizeText(arkElement?.appView),
        image: getViewerRemoteUrl(metadata.preview, metadata.icon)
    };
}

async function getRecallViewerContent(record) {
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
            let remoteUrl = '';
            if (!imagePath) {
                remoteUrl = await resolveRecallImageUrl(element.picElement).catch(error => {
                    warn('recall image URL resolution failed:', error?.message || error);
                    return '';
                });
            }
            parts.push({
                type: 'image',
                src: imagePath ? pathToFileURL(imagePath).href : remoteUrl,
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
                duration: Number(element.videoElement.duration || element.videoElement.fileTime) || 0,
                width: Number(element.videoElement.thumbWidth) || 0,
                height: Number(element.videoElement.thumbHeight) || 0,
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
            parts.push(getArkViewerCard(element.arkElement));
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

async function getRecallViewerData(accountUin) {
    const normalizedAccount = normalizeUin(accountUin);
    if (!normalizedAccount) {
        throw new Error('Current QQ account was not found.');
    }
    const records = await getAllPreventRecallRecords(normalizedAccount);
    const chats = new Map();
    recallViewerRecordIndex.clear();
    for (const record of records) {
        const peerUid = normalizeText(record?.peerUid || record?.peer?.peerUid);
        if (!peerUid) {
            continue;
        }
        const chatType = Number(record?.chatType) || 0;
        const key = `${chatType}:${peerUid}`;
        const mark = record?.qqnt_toolbox_recall || {};
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
            ...await getRecallViewerContent(record)
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
    const recallState = getRecallState(recallViewerState.accountUin, false);
    const recallRecord = recallViewerRecordIndex.get(msgId) || recallState?.recalledMessages.get(msgId);
    if (recallState && recallRecord) {
        await scheduleRecallImageLocalization(recallState, recallRecord);
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

async function openPreventRecallMessages(accountUin) {
    accountUin = normalizeUin(accountUin);
    if (!accountUin) {
        throw new Error('Current QQ account was not found.');
    }
    const viewerPath = path.join(__dirname, 'recall-viewer.html');
    recallViewerState.accountUin = accountUin;
    if (recallViewerWindow && !recallViewerWindow.isDestroyed()) {
        await recallViewerWindow.loadFile(viewerPath);
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
    await recallViewerWindow.loadFile(viewerPath);
    recallViewerWindow.webContents.on('before-input-event', (_event, input) => {
        if (input.key === 'F5' && input.type === 'keyUp') {
            openPreventRecallMessages(recallViewerState.accountUin).catch(() => {});
        }
    });
    recallViewerWindow.on('closed', () => {
        recallViewerWindow = null;
        recallViewerState.accountUin = '';
        recallViewerRecordIndex.clear();
    });
    return { success: true };
}

function isMsgInfoListUpdate(context) {
    return context.commandNames.has(MSG_UPDATE_CMD);
}

function getRecordElements(record) {
    return Array.isArray(record?.elements) ? record.elements : [];
}

function isImageElement(element) {
    return Number(element?.elementType) === 2 || Boolean(element?.picElement);
}

function getElementRetryFingerprint(element) {
    if (isImageElement(element)) {
        const pic = element.picElement || element;
        return `image:${normalizeText(pic.md5HexStr || pic.md5 || pic.fileName || pic.sourcePath)}`;
    }
    if (Number(element?.elementType) === 5 || element?.videoElement) {
        const video = element.videoElement || element;
        return `video:${normalizeText(video.videoMd5 || video.fileMd5 || video.fileName || video.filePath)}`;
    }
    if (Number(element?.elementType) === 3 || element?.fileElement) {
        const file = element.fileElement || element;
        return `file:${normalizeText(file.fileMd5 || file.fileName || file.filePath)}`;
    }
    return `element:${Number(element?.elementType) || 0}`;
}

function getRecordRetryKey(record) {
    const msgId = normalizeText(record?.msgId);
    if (msgId && msgId !== '0') {
        return `msg:${msgId}`;
    }
    const attrId = getMsgAttrId(record);
    const fingerprints = getRecordElements(record).map(getElementRetryFingerprint).join(',');
    return [
        'record',
        normalizeText(record?.chatType),
        normalizeText(record?.peerUid || record?.peer?.peerUid),
        normalizeText(record?.msgSeq),
        normalizeText(record?.msgRandom),
        normalizeText(attrId),
        fingerprints
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
    return getThumbPathCandidates(thumbPath)[0] || '';
}

function getThumbPathCandidates(thumbPath) {
    let values = [];
    if (typeof thumbPath === 'string') {
        values = [thumbPath];
    } else if (thumbPath instanceof Map) {
        values = Array.from(thumbPath.values());
    } else if (Array.isArray(thumbPath)) {
        values = thumbPath;
    } else if (thumbPath && typeof thumbPath === 'object') {
        values = Object.values(thumbPath);
    }
    return Array.from(new Set(values.map(normalizePathText).filter(Boolean)));
}

function getThumbSizeCandidate(thumbPath) {
    let value;
    if (thumbPath instanceof Map) {
        value = Array.from(thumbPath.keys())[0];
    } else if (thumbPath && typeof thumbPath === 'object') {
        value = Object.keys(thumbPath)[0];
    }
    const size = Number(value);
    return Number.isFinite(size) && size > 0 ? size : 750;
}

function getPicSourcePath(picElement) {
    return getExistingFilePath([
        picElement?.sourcePath,
        picElement?.filePath,
        picElement?.originPath,
        picElement?.localPath,
        picElement?.path,
        ...getThumbPathCandidates(picElement?.thumbPath)
    ]);
}

function getVideoSourcePath(videoElement) {
    return getExistingFilePath([
        videoElement?.filePath,
        videoElement?.sourcePath,
        videoElement?.originPath,
        videoElement?.localPath,
        videoElement?.path
    ]);
}

function getFileSourcePath(fileElement) {
    return getExistingFilePath([
        fileElement?.filePath,
        fileElement?.sourcePath,
        fileElement?.originPath,
        fileElement?.localPath,
        fileElement?.path
    ]);
}

function getExistingFilePath(candidates) {
    for (const candidate of candidates) {
        const filePath = normalizePathText(candidate);
        try {
            const stat = filePath ? fsSync.statSync(filePath) : null;
            if (stat?.isFile() && stat.size > 0) {
                return filePath;
            }
        } catch {
        }
    }
    return '';
}

function getAbsoluteFilePathCandidate(candidates) {
    for (const candidate of candidates) {
        const filePath = normalizePathText(candidate);
        if (filePath && path.isAbsolute(filePath)) {
            return filePath;
        }
    }
    return '';
}

function getPendingPicPath(picElement) {
    return getAbsoluteFilePathCandidate([
        picElement?.sourcePath,
        picElement?.filePath,
        picElement?.originPath,
        picElement?.localPath,
        picElement?.path,
        ...getThumbPathCandidates(picElement?.thumbPath)
    ]);
}

function getPendingVideoPath(videoElement) {
    return getAbsoluteFilePathCandidate([
        videoElement?.filePath,
        videoElement?.sourcePath,
        videoElement?.originPath,
        videoElement?.localPath,
        videoElement?.path
    ]);
}

function getPendingFilePath(fileElement) {
    return getAbsoluteFilePathCandidate([
        fileElement?.filePath,
        fileElement?.sourcePath,
        fileElement?.originPath,
        fileElement?.localPath,
        fileElement?.path
    ]);
}

function getInlineMediaPeerKey(value) {
    const chatType = Number(value?.chatType || value?.peer?.chatType) || 0;
    const peerUid = normalizeText(
        value?.peerUid || value?.peerUin || value?.peer?.peerUid || value?.peer?.peerUin
    );
    return chatType && peerUid ? `${chatType}:${peerUid}` : '';
}

function getInlineMediaItemKey(item) {
    const identity = item?.identity || {};
    const msgId = normalizeText(identity.msgId);
    const elementId = normalizeText(identity.elementId);
    return msgId && elementId
        ? `${msgId}:${elementId}`
        : `${normalizeText(item?.type)}:${normalizeComparablePath(item?.filePath)}`;
}

function createInlineMediaItem(record, element, elementIndex) {
    let type;
    let media;
    let filePath;
    if (Number(element?.elementType) === 2 || element?.picElement) {
        type = 'image';
        media = element.picElement || element;
        filePath = getPicSourcePath(media) || getPendingPicPath(media);
    } else if (Number(element?.elementType) === 5 || element?.videoElement) {
        type = 'video';
        media = element.videoElement || element;
        filePath = getVideoSourcePath(media) || getPendingVideoPath(media);
    } else if (Number(element?.elementType) === 3 || element?.fileElement) {
        media = element.fileElement || element;
        filePath = getFileSourcePath(media) || getPendingFilePath(media);
        type = classifyMediaFilePath(media.fileName, filePath);
    }
    if (!type || !filePath) {
        return null;
    }
    return {
        type,
        filePath,
        fingerprint: normalizeText(
            media.md5HexStr || media.originImageMd5 || media.videoMd5 || media.fileMd5
        ).toLowerCase(),
        name: normalizeText(media.fileName || media.summary) || path.basename(filePath),
        sourceIndex: elementIndex,
        identity: {
            chatType: Number(record?.chatType || record?.peer?.chatType) || 0,
            peerUid: normalizeText(
                record?.peerUid || record?.peerUin || record?.peer?.peerUid || record?.peer?.peerUin
            ),
            msgId: normalizeText(record?.msgId),
            msgSeq: normalizeText(record?.msgSeq),
            elementId: normalizeText(element?.elementId)
        }
    };
}

function compareInlineMediaItems(left, right) {
    const leftSeq = normalizeText(left?.identity?.msgSeq);
    const rightSeq = normalizeText(right?.identity?.msgSeq);
    if (/^\d+$/.test(leftSeq) && /^\d+$/.test(rightSeq)) {
        const difference = BigInt(leftSeq) - BigInt(rightSeq);
        if (difference !== 0n) {
            return difference < 0n ? -1 : 1;
        }
    } else if (leftSeq !== rightSeq) {
        return leftSeq.localeCompare(rightSeq);
    }
    return Number(left?.sourceIndex) - Number(right?.sourceIndex);
}

function rememberInlineMediaRecords(browserWindow, context) {
    if (getInterfaceTweaksConfig().inlineMediaViewer !== true) {
        return;
    }
    const state = getWindowState(browserWindow);
    const embeddedReplyRecords = new Set();
    for (const record of context.records) {
        const peerKey = getInlineMediaPeerKey(record);
        if (!peerKey) {
            continue;
        }
        for (const element of getRecordElements(record)) {
            const embeddedMsgId = normalizeText(element?.replyElement?.sourceMsgIdInRecords);
            if (embeddedMsgId) {
                embeddedReplyRecords.add(`${peerKey}:id:${embeddedMsgId}`);
            }
        }
    }
    for (const record of context.records) {
        const peerKey = getInlineMediaPeerKey(record);
        const recordMsgId = normalizeText(record?.msgId);
        if (!peerKey || (recordMsgId && embeddedReplyRecords.has(`${peerKey}:id:${recordMsgId}`))) {
            continue;
        }
        const elements = getRecordElements(record);
        const reply = elements.find(element => element?.replyElement)?.replyElement;
        let replySources = state.inlineReplySourcesByPeer.get(peerKey);
        if (reply && !replySources) {
            replySources = new Map();
            state.inlineReplySourcesByPeer.set(peerKey, replySources);
            while (state.inlineReplySourcesByPeer.size > MAX_INLINE_MEDIA_PEERS) {
                state.inlineReplySourcesByPeer.delete(state.inlineReplySourcesByPeer.keys().next().value);
            }
        }
        for (const key of getInlineMediaMessageKeys(record)) {
            if (reply) {
                replySources.set(key, {
                    msgId: normalizeText(reply.replayMsgId),
                    msgSeq: normalizeText(reply.replayMsgSeq)
                });
            } else if (replySources) {
                replySources.delete(key);
            }
        }
        while (replySources?.size > MAX_INLINE_MEDIA_PER_PEER * 2) {
            replySources.delete(replySources.keys().next().value);
        }
        const items = elements
            .map((element, index) => createInlineMediaItem(record, element, index))
            .filter(Boolean);
        if (!items.length) {
            continue;
        }
        let peerItems = state.inlineMediaByPeer.get(peerKey);
        if (!peerItems) {
            peerItems = new Map();
        }
        state.inlineMediaByPeer.delete(peerKey);
        state.inlineMediaByPeer.set(peerKey, peerItems);
        while (state.inlineMediaByPeer.size > MAX_INLINE_MEDIA_PEERS) {
            const oldestPeerKey = state.inlineMediaByPeer.keys().next().value;
            state.inlineMediaByPeer.delete(oldestPeerKey);
            state.inlineReplySourcesByPeer.delete(oldestPeerKey);
        }
        for (const item of items) {
            peerItems.set(getInlineMediaItemKey(item), item);
        }
        if (peerItems.size > MAX_INLINE_MEDIA_PER_PEER) {
            const ordered = Array.from(peerItems.values()).sort(compareInlineMediaItems);
            for (const item of ordered.slice(0, peerItems.size - MAX_INLINE_MEDIA_PER_PEER)) {
                peerItems.delete(getInlineMediaItemKey(item));
            }
        }
    }
}

function completeInlineMediaGallery(browserWindow, gallery) {
    const selected = gallery?.items?.[gallery.index];
    const peerKey = getInlineMediaPeerKey(selected?.identity);
    const peerItems = peerKey ? getWindowState(browserWindow).inlineMediaByPeer.get(peerKey) : null;
    if (!selected || !peerItems?.size) {
        return gallery;
    }
    const rememberedItems = Array.from(peerItems.values());
    const replySources = getWindowState(browserWindow).inlineReplySourcesByPeer.get(peerKey);
    const viewerItems = gallery.items.map(item =>
        resolveInlineReplyPreview(item, rememberedItems, replySources)
    );
    const selectedItem = viewerItems[gallery.index];
    const items = mergeInlineMediaItems(
        rememberedItems,
        viewerItems
    ).sort(compareInlineMediaItems);
    const index = items.findIndex(item => isSameInlineMediaItem(item, selectedItem));
    return index >= 0 ? { items, index } : gallery;
}

function isGeneratedRepairPath(filePath) {
    const repairDir = normalizeComparablePath(getRepairDir());
    const candidate = normalizeComparablePath(filePath);
    return candidate === repairDir || candidate.startsWith(`${repairDir}\\`);
}

function isSupportedImagePath(filePath) {
    return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function getRepairDescriptor(element) {
    if (isImageElement(element)) {
        const sourcePath = getPicSourcePath(element.picElement || element);
        if (!sourcePath || !isSupportedImagePath(sourcePath)) {
            return null;
        }
        return { kind: 'image', element, sourcePath };
    }
    if (Number(element?.elementType) === 5 || element?.videoElement) {
        const video = element.videoElement || element;
        const sourcePath = getVideoSourcePath(video);
        const extension = path.extname(sourcePath) || path.extname(normalizeText(video.fileName));
        return sourcePath ? { kind: 'video', element, sourcePath, extension } : null;
    }
    if (Number(element?.elementType) !== 3 && !element?.fileElement) {
        return null;
    }
    const file = element.fileElement || element;
    const sourcePath = getFileSourcePath(file);
    if (!sourcePath) {
        return null;
    }
    const extension = (path.extname(sourcePath) || path.extname(normalizeText(file.fileName))).toLowerCase();
    const kind = VIDEO_EXTENSIONS.has(extension)
        ? 'video'
        : AUDIO_EXTENSIONS.has(extension)
            ? 'audio'
            : 'otherFiles';
    return { kind, element, sourcePath, extension };
}

function createRecordRepairPlan(record) {
    const sendStatus = Number(record?.sendStatus);
    if (sendStatus !== SEND_STATUS_FAILED && sendStatus !== SEND_STATUS_SUCCESS_NO_SEQ) {
        return null;
    }
    const elements = getRecordElements(record);
    if (!elements.length) {
        return null;
    }
    const descriptors = elements.map(getRepairDescriptor);
    if (descriptors.some(descriptor => !descriptor || isGeneratedRepairPath(descriptor.sourcePath))) {
        return null;
    }
    const config = getFileRetryConfig();
    if (config.enabled === false || descriptors.some(descriptor => config[descriptor.kind] === false)) {
        return null;
    }
    if (descriptors.some(descriptor => descriptor.kind === 'otherFiles') && !String(config.archivePassword || '')) {
        return null;
    }
    return descriptors;
}

function queueFileRetry(browserWindow, record, plan) {
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
    const kinds = plan.map(descriptor => descriptor.kind);
    recordDiagnostic('info', 'file-retry.queued', {
        sendStatus: Number(record?.sendStatus),
        kinds,
        deleteFailedMessage: getFileRetryConfig().deleteFailedMessage === true
    });
    setTimeout(() => {
        retryFileRecord(browserWindow, record, plan, key)
            .catch(error => warn('file-retry.failed', { kinds, error }))
            .finally(() => state.inFlightRecords.delete(key));
    }, RETRY_DELAY_MS);
}

function processMessageUpdates(browserWindow, context) {
    if (!isMsgInfoListUpdate(context)) {
        return;
    }
    if (getFileRetryConfig().enabled === false) {
        return;
    }
    const state = getWindowState(browserWindow);
    pruneRetryState(state);
    const seen = new Set();
    for (const record of context.records) {
        const key = getRecordRetryKey(record);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        const attrId = getMsgAttrId(record);
        if (attrId !== undefined && state.pluginAttrIds.has(String(attrId))) {
            continue;
        }
        const plan = createRecordRepairPlan(record);
        if (plan) {
            queueFileRetry(browserWindow, record, plan);
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
    return String(value || 'file')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'file';
}

async function createPixelPreservingImageVariant(sourcePath) {
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
    const png = randomizePngEncoding(image.toPNG());
    const variantImage = nativeImage.createFromBuffer(png, { scaleFactor: 1 });
    const variantBitmap = Buffer.from(variantImage.toBitmap({ scaleFactor: 1 }));
    if (variantImage.isEmpty() || !variantBitmap.equals(bitmap)) {
        throw new Error('Pixel-preserving image verification failed.');
    }
    const repairDir = await ensureRepairDir();
    const stem = safeFileStem(path.basename(sourcePath, path.extname(sourcePath)));
    const fileName = `${stem}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.qqnt-toolbox.png`;
    const outPath = path.join(repairDir, fileName);
    await fs.writeFile(outPath, png);
    cleanupOldRepairFiles().catch(() => {});
    return outPath;
}

async function probeMediaInfo(filePath) {
    if (!voiceFileSender?.runTool) {
        throw new Error('FFmpeg tools are unavailable.');
    }
    const { stdout } = await voiceFileSender.runTool('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration:stream=codec_type,width,height,duration',
        '-of', 'json',
        filePath
    ]);
    const result = JSON.parse(stdout);
    const videoStream = result?.streams?.find(stream => stream.codec_type === 'video');
    const duration = Number(result?.format?.duration ?? videoStream?.duration);
    if (!Number.isFinite(duration) || duration < 0) {
        throw new Error(`Cannot read media duration: ${filePath}`);
    }
    return {
        duration,
        width: Number(videoStream?.width) || 0,
        height: Number(videoStream?.height) || 0
    };
}

async function createRemuxedMediaVariant(sourcePath, extensionHint = '') {
    if (!voiceFileSender?.runTool) {
        throw new Error('FFmpeg tools are unavailable.');
    }
    const extension = (path.extname(sourcePath) || extensionHint).toLowerCase();
    if (!extension) {
        throw new Error(`Media file has no extension: ${sourcePath}`);
    }
    const repairDir = await ensureRepairDir();
    const stem = safeFileStem(path.basename(sourcePath, path.extname(sourcePath)));
    const nonce = `${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
    const outPath = path.join(repairDir, `${stem}.${nonce}.qqnt-toolbox${extension}`);
    try {
        const sourceInfo = await probeMediaInfo(sourcePath);
        const ffmpegArgs = [
            '-hide_banner',
            '-loglevel', 'error',
            '-y',
            '-i', sourcePath,
            '-map', '0',
            '-map_metadata', '0',
            '-map_chapters', '0',
            '-c', 'copy',
            '-metadata', `comment=qqnt-toolbox-${nonce}`
        ];
        if (['.3g2', '.3gp', '.m4v', '.mov', '.mp4'].includes(extension)) {
            ffmpegArgs.push('-movflags', '+faststart');
        }
        ffmpegArgs.push(outPath);
        await voiceFileSender.runTool('ffmpeg', ffmpegArgs);
        const [outputInfo, sourceMd5, outputMd5, outputStat] = await Promise.all([
            probeMediaInfo(outPath),
            getFileMd5(sourcePath),
            getFileMd5(outPath),
            fs.stat(outPath)
        ]);
        if (Math.abs(sourceInfo.duration - outputInfo.duration) > 0.001) {
            throw new Error(`Media duration changed (${sourceInfo.duration} -> ${outputInfo.duration}).`);
        }
        if (!outputStat.size || sourceMd5 === outputMd5) {
            throw new Error('Media remux did not create a distinct file.');
        }
        cleanupOldRepairFiles().catch(() => {});
        return {
            filePath: outPath,
            ...outputInfo
        };
    } catch (error) {
        await fs.unlink(outPath).catch(() => {});
        throw error;
    }
}

async function createEncryptedArchiveVariant(sourcePath, password) {
    if (!String(password || '')) {
        throw new Error('Archive password is empty.');
    }
    const sourceStat = await fs.stat(sourcePath);
    const repairDir = await ensureRepairDir();
    const originalStem = path.basename(sourcePath, path.extname(sourcePath));
    const stem = safeFileStem(originalStem);
    const nonce = `${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
    const outPath = path.join(repairDir, `${stem}.${nonce}.qqnt-toolbox.zip`);
    const output = fsSync.createWriteStream(outPath);
    const zipWriter = new ZipWriter(Writable.toWeb(output), {
        password: String(password),
        encryptionStrength: 3,
        level: 6,
        useWebWorkers: false
    });
    try {
        await zipWriter.add(
            path.basename(sourcePath),
            Readable.toWeb(fsSync.createReadStream(sourcePath)),
            {
                lastModDate: sourceStat.mtime,
                lastAccessDate: sourceStat.atime,
                creationDate: sourceStat.birthtime
            }
        );
        await zipWriter.close();
        const outputStat = await fs.stat(outPath);
        if (!outputStat.size) {
            throw new Error('Encrypted archive is empty.');
        }
        cleanupOldRepairFiles().catch(() => {});
        return {
            filePath: outPath,
            fileName: `${originalStem}.zip`
        };
    } catch (error) {
        output.destroy();
        await fs.unlink(outPath).catch(() => {});
        throw error;
    }
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

async function createPicElement(browserWindow, filePath, originalPicElement = {}, options = {}) {
    const picSubType = Number(originalPicElement?.picSubType) || 0;
    const copied = await copyImageToQqCache(browserWindow, filePath, picSubType);
    const originalMd5 = normalizeText(originalPicElement.md5HexStr || originalPicElement.md5).toLowerCase();
    if (options.allowOriginalHash !== true && originalMd5 && copied.md5.toLowerCase() === originalMd5) {
        throw new Error('QQ normalized the image variant back to the original hash.');
    }
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

async function copyMediaToQqCache(browserWindow, filePath, elementType, preferredFileName = '') {
    const md5 = await getFileMd5(filePath);
    let fileName = normalizeText(preferredFileName) || path.basename(filePath);
    if (!path.extname(fileName) && path.extname(filePath)) {
        fileName += path.extname(filePath);
    }
    const result = await qqNativeInvoke(
        browserWindow,
        'ntApi',
        'nodeIKernelMsgService/getRichMediaFilePathForGuild',
        [{
            md5HexStr: md5,
            fileName,
            elementType,
            elementSubType: 0,
            thumbSize: 0,
            needCreate: true,
            downloadType: 1,
            file_uuid: ''
        }],
        true,
        15000
    );
    if (isNativeFailure(result)) {
        throw new Error(`getRichMediaFilePathForGuild failed: ${safeJson(result)}`);
    }
    const value = unwrapNativeValue(result);
    const cachePath = normalizePathText(
        typeof value === 'string'
            ? value
            : findFirstByKey(result, ['newPath', 'filePath', 'path'])
    );
    if (!cachePath) {
        throw new Error(`getRichMediaFilePathForGuild returned no path: ${safeJson(result)}`);
    }
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    if (normalizeComparablePath(filePath) !== normalizeComparablePath(cachePath)) {
        await fs.copyFile(filePath, cachePath);
    }
    return { fileName, filePath: cachePath, md5 };
}

async function createBlurredVideoThumbnail(filePath, originalThumbPath = '', options = {}) {
    const repairDir = await ensureRepairDir();
    const stem = safeFileStem(path.basename(filePath, path.extname(filePath)));
    const extension = options.extension === '.jpg' ? '.jpg' : '.png';
    const outPath = path.join(
        repairDir,
        `${stem}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.thumb.blur${extension}`
    );
    const hasOriginalThumb = Boolean(originalThumbPath && fsSync.existsSync(originalThumbPath));
    const inputPath = hasOriginalThumb ? originalThumbPath : filePath;
    try {
        const ffmpegArgs = [
            '-hide_banner',
            '-loglevel', 'error',
            '-y'
        ];
        if (!hasOriginalThumb) {
            ffmpegArgs.push('-ss', '0');
        }
        ffmpegArgs.push(
            '-i', inputPath,
            '-map', '0:v:0',
            '-frames:v', '1',
            '-vf', options.maxWidth
                ? `scale=w='min(${Number(options.maxWidth)},iw)':h=-2,gblur=sigma=18`
                : 'gblur=sigma=18',
            '-update', '1',
            '-an'
        );
        if (extension === '.jpg') {
            ffmpegArgs.push('-q:v', '4');
        }
        ffmpegArgs.push(outPath);
        await voiceFileSender.runTool('ffmpeg', ffmpegArgs);
        const image = nativeImage.createFromPath(outPath);
        if (image.isEmpty()) {
            throw new Error('Generated blurred video thumbnail is invalid.');
        }
        cleanupOldRepairFiles().catch(() => {});
        return outPath;
    } catch (error) {
        await fs.unlink(outPath).catch(() => {});
        throw error;
    }
}

function getVideoThumbCachePath(videoCachePath, videoMd5) {
    const normalized = path.normalize(videoCachePath);
    const root = path.parse(normalized).root;
    const parts = normalized.slice(root.length).split(path.sep).filter(Boolean);
    let oriIndex = -1;
    for (let index = parts.length - 1; index >= 0; index--) {
        if (parts[index].toLowerCase() === 'ori') {
            oriIndex = index;
            break;
        }
    }
    if (oriIndex < 0) {
        return '';
    }
    parts[oriIndex] = 'Thumb';
    return path.join(root, ...parts.slice(0, -1), `${videoMd5}_0.png`);
}

async function cacheGeneratedVideoThumbnail(videoCachePath, videoMd5, thumbFilePath) {
    const cachePath = getVideoThumbCachePath(videoCachePath, videoMd5);
    if (!cachePath) {
        return thumbFilePath;
    }
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.copyFile(thumbFilePath, cachePath);
    return cachePath;
}

async function createVideoElement(browserWindow, filePath, originalVideoElement = {}, mediaInfo = null) {
    const info = mediaInfo || await probeMediaInfo(filePath);
    if (!info.width || !info.height) {
        throw new Error('Video stream dimensions are unavailable.');
    }
    const originalThumbPath = getThumbPathCandidate(originalVideoElement.thumbPath);
    const blurredThumbPath = await createBlurredVideoThumbnail(filePath, originalThumbPath);
    const cached = await copyMediaToQqCache(browserWindow, filePath, 5, originalVideoElement.fileName);
    const thumbFilePath = await cacheGeneratedVideoThumbnail(cached.filePath, cached.md5, blurredThumbPath);
    const [fileSize, thumbStat, thumbMd5] = await Promise.all([
        fs.stat(filePath),
        fs.stat(thumbFilePath),
        getFileMd5(thumbFilePath)
    ]);
    const originalFileTime = Number(originalVideoElement.fileTime ?? originalVideoElement.duration);
    return {
        elementType: 5,
        elementId: '',
        videoElement: {
            fileName: cached.fileName,
            filePath: cached.filePath,
            videoMd5: cached.md5,
            thumbMd5,
            fileTime: Number.isFinite(originalFileTime) && originalFileTime > 0
                ? originalFileTime
                : Math.trunc(info.duration),
            thumbPath: new Map([[0, thumbFilePath]]),
            thumbSize: thumbStat.size,
            thumbWidth: Number(originalVideoElement.thumbWidth) || info.width,
            thumbHeight: Number(originalVideoElement.thumbHeight) || info.height,
            fileSize: String(fileSize.size)
        },
        extBufForUI: new Uint8Array()
    };
}

async function createFileElement(filePath, fileName, originalFileElement = {}, videoInfo = null) {
    const fileSize = (await fs.stat(filePath)).size;
    const fileElement = {
        fileName,
        folderId: originalFileElement.folderId,
        fileBizId: undefined,
        filePath,
        fileSize: String(fileSize)
    };
    if (videoInfo) {
        const thumbSize = getThumbSizeCandidate(originalFileElement.picThumbPath);
        const originalThumbPath = getThumbPathCandidate(originalFileElement.picThumbPath);
        const thumbPath = await createBlurredVideoThumbnail(filePath, originalThumbPath, {
            extension: '.jpg',
            maxWidth: thumbSize
        });
        Object.assign(fileElement, {
            fileMd5: '',
            picHeight: Number(originalFileElement.picHeight) || videoInfo.height,
            picWidth: Number(originalFileElement.picWidth) || videoInfo.width,
            picThumbPath: new Map([[thumbSize, thumbPath]]),
            file10MMd5: '',
            fileSha: '',
            fileSha3: '',
            fileUuid: '',
            fileSubId: '',
            thumbFileSize: thumbSize
        });
    }
    return {
        elementType: 3,
        elementId: '',
        fileElement,
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

async function sendRepairedElements(browserWindow, peer, msgElements, attrId) {
    getWindowState(browserWindow).pluginAttrIds.set(String(attrId), Date.now());
    const msgAttributeInfos = makeSendAttributeInfos(attrId);
    const sentMsgWaiter = createNativeEventWaiter(browserWindow, {
        cmdName: MSG_UPDATE_CMD,
        attrId,
        sendStatus: 2
    }, 30000);
    try {
        await qqNativeInvoke(
            browserWindow,
            'ntApi',
            'nodeIKernelMsgService/sendMsg',
            [{
                msgId: '0',
                peer,
                msgElements,
                msgAttributeInfos
            }, null],
            false
        );
        return await sentMsgWaiter.promise;
    } catch (error) {
        sentMsgWaiter.cancel();
        throw new Error(`File retry was not confirmed successful: ${error?.message || error}`);
    }
}

async function deleteFailedRecord(browserWindow, peer, record) {
    const msgId = normalizeText(record?.msgId);
    if (!msgId || msgId === '0') {
        return false;
    }
    const result = await qqNativeInvoke(
        browserWindow,
        'ntApi',
        'nodeIKernelMsgService/deleteMsg',
        [{ peer, msgIds: [msgId] }, null],
        true,
        10000
    );
    if (isNativeFailure(result)) {
        throw new Error(`deleteMsg failed: ${safeJson(result)}`);
    }
    return true;
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

function normalizeRepeatDestinationPeer(browserWindow, payload, sourcePeer) {
    if (!payload?.destinationPeer) {
        return sourcePeer;
    }
    const peer = extractPeerFromRecord(browserWindow, payload.destinationPeer);
    if (!peer) {
        throw new Error('Cannot resolve repeat destination peer.');
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
    if (Buffer.isBuffer(value)) {
        return Buffer.from(value);
    }
    if (value instanceof Uint8Array) {
        return new Uint8Array(value);
    }
    if (seen.has(value)) {
        return seen.get(value);
    }
    if (value instanceof Map) {
        const map = new Map();
        seen.set(value, map);
        for (const [key, item] of value) {
            map.set(key, deepCloneForSend(item, depth + 1, seen));
        }
        return map;
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

async function getRepeatSourceRecord(browserWindow, peer, msgId) {
    const result = await qqNativeInvoke(
        browserWindow,
        'ntApi',
        'nodeIKernelMsgService/getMsgsByMsgId',
        [{ peer, msgIds: [msgId] }, null],
        true,
        15000
    );
    if (isNativeFailure(result)) {
        throw new Error(`repeat getMsgsByMsgId failed: ${safeJson(result)}`);
    }
    const record = findIpcObject(
        result,
        value => isMsgRecord(value) && normalizeText(value.msgId) === msgId
    );
    if (!record) {
        throw new Error('The complete source message could not be loaded.');
    }
    return record;
}

async function downloadForwardDetailResource(remoteUrl, fileName, fallbackExtension) {
    if (!remoteUrl) {
        throw new Error('The forwarded resource has no download URL.');
    }
    const response = await fetch(remoteUrl);
    if (!response.ok || !response.body) {
        throw new Error(`Forwarded resource download failed: HTTP ${response.status}.`);
    }
    const baseName = path.basename(normalizeText(fileName)) || `forward-resource${fallbackExtension}`;
    const extension = path.extname(baseName) || fallbackExtension;
    const stem = safeFileStem(path.basename(baseName, extension)) || 'forward-resource';
    const repairDir = await ensureRepairDir();
    const targetPath = path.join(
        repairDir,
        `${stem}.forward.${Date.now()}.${crypto.randomBytes(4).toString('hex')}${extension}`
    );
    try {
        await pipeline(Readable.fromWeb(response.body), fsSync.createWriteStream(targetPath));
    } catch (error) {
        await fs.rm(targetPath, { force: true }).catch(() => {});
        throw error;
    }
    return targetPath;
}

async function downloadForwardDetailImage(picElement) {
    const remoteUrl = getViewerRemoteUrl(picElement?.originImageUrl, picElement?.thumbPath);
    const nameExtension = path.extname(normalizeText(picElement?.fileName)).toLowerCase();
    const fallbackExtension = IMAGE_EXTENSIONS.has(nameExtension) ? nameExtension : '.png';
    return await downloadForwardDetailResource(
        remoteUrl,
        normalizeText(picElement?.fileName) || `forward-image${fallbackExtension}`,
        fallbackExtension
    );
}

async function waitForForwardDetailFile(candidates, timeoutMs = 60000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const filePath = getExistingFilePath(candidates);
        if (filePath) {
            return filePath;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    return '';
}

async function downloadForwardDetailFile(browserWindow, record, element) {
    const fileElement = element?.fileElement || element;
    const result = await qqNativeInvoke(
        browserWindow,
        'ntApi',
        'nodeIKernelRichMediaService/downloadRichMediaInVisit',
        [{
            downloadType: 1,
            thumbSize: 0,
            msgId: normalizeText(record?.msgId),
            msgRandom: normalizeText(record?.msgRandom),
            msgSeq: normalizeText(record?.msgSeq),
            msgTime: normalizeText(record?.msgTime),
            chatType: Number(record?.chatType),
            senderUid: normalizeText(record?.senderUid),
            peerUid: normalizeText(record?.peerUid),
            guildId: normalizeText(record?.guildId),
            ele: element,
            useHttps: true
        }, null],
        true,
        60000
    );
    if (isRepeatCommandFailure(result)) {
        throw new Error(`forwarded file download failed: ${safeJson(result)}`);
    }
    const localPath = getViewerFileUrl(result, fileElement?.filePath);
    if (localPath) {
        return fileURLToPath(localPath);
    }
    const remoteUrl = getViewerRemoteUrl(result);
    if (remoteUrl) {
        return await downloadForwardDetailResource(
            remoteUrl,
            normalizeText(fileElement?.fileName) || 'forward-file.bin',
            '.bin'
        );
    }
    const downloadedPath = await waitForForwardDetailFile([fileElement?.filePath]);
    if (!downloadedPath) {
        throw new Error('QQ did not return a downloaded path for the forwarded file.');
    }
    return downloadedPath;
}

async function prepareForwardDetailRecord(browserWindow, record = {}) {
    const elements = [];
    for (const element of Array.isArray(record.elements) ? record.elements : []) {
        if (Number(element?.elementType) === 2 || element?.picElement) {
            const picElement = element.picElement || element;
            const localPath = getPicSourcePath(picElement) || await downloadForwardDetailImage(picElement);
            const rebuilt = await createPicElement(browserWindow, localPath, picElement, {
                allowOriginalHash: true
            });
            rebuilt.elementGroupId = Number(element?.elementGroupId) || 0;
            elements.push(rebuilt);
            continue;
        }
        if (Number(element?.elementType) === 3 || element?.fileElement) {
            const fileElement = element.fileElement || element;
            const localPath = getFileSourcePath(fileElement) ||
                await downloadForwardDetailFile(browserWindow, record, element);
            const rebuilt = await createFileElement(
                localPath,
                normalizeText(fileElement?.fileName) || path.basename(localPath),
                fileElement
            );
            rebuilt.elementGroupId = Number(element?.elementGroupId) || 0;
            elements.push(rebuilt);
            continue;
        }
        elements.push(element);
    }
    return { ...record, elements };
}

function isRepeatCommandFailure(result) {
    const code = Number(result?.result);
    return isNativeFailure(result) || (Number.isFinite(code) && code !== 0);
}

function createRepeatFinalWaiters(browserWindow, attrId) {
    return {
        success: createNativeEventWaiter(browserWindow, {
            cmdName: MSG_UPDATE_CMD,
            attrId,
            sendStatus: 2
        }, 30000),
        failure: createNativeEventWaiter(browserWindow, {
            cmdName: MSG_UPDATE_CMD,
            attrId,
            sendStatus: [SEND_STATUS_FAILED, SEND_STATUS_SUCCESS_NO_SEQ]
        }, 30000)
    };
}

async function waitForRepeatFinal(waiters) {
    const confirmation = await Promise.race([
        waiters.success.promise.then(value => ({ success: true, value })),
        waiters.failure.promise.then(value => ({ success: false, value }))
    ]);
    if (!confirmation.success) {
        throw new Error(`repeat send was rejected by QQ: ${safeJson(confirmation.value)}`);
    }
}

function cancelRepeatFinalWaiters(waiters) {
    waiters?.success.cancel();
    waiters?.failure.cancel();
}

async function repeatBySendMsg(browserWindow, peer, record = {}, confirm = false) {
    const msgElements = deepCloneForSend(record.elements || []);
    if (!Array.isArray(msgElements) || !msgElements.length) {
        throw new Error('The source message has no repeatable elements.');
    }
    for (const element of msgElements) {
        if (element && typeof element === 'object') {
            element.elementId = '';
        }
    }
    const attrId = await generateMsgUniqueId(browserWindow, peer.chatType);
    const waiters = confirm ? createRepeatFinalWaiters(browserWindow, attrId) : null;
    try {
        const result = await qqNativeInvoke(
            browserWindow,
            'ntApi',
            'nodeIKernelMsgService/sendMsg',
            [{
                msgId: '0',
                peer,
                msgElements,
                msgAttributeInfos: makeSendAttributeInfos(attrId)
            }, null],
            true,
            15000
        );
        if (isRepeatCommandFailure(result)) {
            throw new Error(`repeat sendMsg failed: ${safeJson(result)}`);
        }
        if (confirm) {
            await waitForRepeatFinal(waiters);
        }
        return result;
    } finally {
        cancelRepeatFinalWaiters(waiters);
    }
}

async function repeatNestedForwardCard(browserWindow, destinationPeer, record, forwardContext) {
    const rootMsg = forwardContext?.rootMsg;
    const rootPeer = extractPeerFromRecord(browserWindow, rootMsg);
    const rootMsgId = normalizeText(rootMsg?.msgId);
    const subMsgId = normalizeText(record?.msgId);
    if (!rootPeer || !rootMsgId || !subMsgId) {
        throw new Error('The nested chat record route context is incomplete.');
    }
    const service = getQqWrapperSession()?.getMsgService?.();
    if (typeof service?.forwardSubMsgWithComment !== 'function') {
        throw new Error('QQ does not expose forwardSubMsgWithComment.');
    }
    const attrId = await generateMsgUniqueId(browserWindow, destinationPeer.chatType);
    const result = await service.forwardSubMsgWithComment(
        [rootMsgId],
        [subMsgId],
        rootPeer,
        [destinationPeer],
        [],
        makeSendAttributeInfos(attrId)
    );
    if (isRepeatCommandFailure(result)) {
        throw new Error(`forwardSubMsgWithComment failed: ${safeJson(result)}`);
    }
    return result;
}

async function repeatByNativeForward(browserWindow, sourcePeer, destinationPeer, record = {}) {
    const msgId = normalizeText(record.msgId);
    if (!msgId || msgId === '0') {
        throw new Error('The source message has no valid message ID.');
    }
    const result = await qqNativeInvoke(
        browserWindow,
        'ntApi',
        'nodeIKernelMsgService/forwardMsgWithComment',
        [{
            commentElements: [],
            dstContacts: [destinationPeer],
            msgAttributeInfos: new Map(),
            msgIds: [msgId],
            srcContact: sourcePeer
        }, null],
        true,
        15000
    );
    if (isRepeatCommandFailure(result)) {
        throw new Error(`repeat forwardMsgWithComment failed: ${safeJson(result)}`);
    }
    return result;
}

const repeatMessageFromRenderer = createRepeatMessageHandler({
    isEnabled: isRepeatMessageEnabled,
    normalizeText,
    resolveSourcePeer: normalizeRepeatPeer,
    resolveDestinationPeer: normalizeRepeatDestinationPeer,
    loadSourceRecord: getRepeatSourceRecord,
    repeatVoice: repeatPttRecord,
    repeatNestedForward: repeatNestedForwardCard,
    prepareForwardDetail: prepareForwardDetailRecord,
    repeatBySend: repeatBySendMsg,
    repeatByNativeForward
});

async function createRepairedElement(browserWindow, descriptor, archivePassword) {
    const { element, kind, sourcePath } = descriptor;
    if (kind === 'image') {
        const originalPic = element.picElement || element;
        const repairedPath = await createPixelPreservingImageVariant(sourcePath);
        return await createPicElement(browserWindow, repairedPath, originalPic);
    }
    if (kind === 'otherFiles') {
        const originalFile = element.fileElement || element;
        const archive = await createEncryptedArchiveVariant(sourcePath, archivePassword);
        return await createFileElement(archive.filePath, archive.fileName, originalFile);
    }
    const remuxed = await createRemuxedMediaVariant(sourcePath, descriptor.extension);
    if (kind === 'video' && (element.videoElement || Number(element.elementType) === 5)) {
        return await createVideoElement(
            browserWindow,
            remuxed.filePath,
            element.videoElement || element,
            remuxed
        );
    }
    const originalFile = element.fileElement || element;
    const fileName = normalizeText(originalFile.fileName) || path.basename(sourcePath);
    return await createFileElement(
        remuxed.filePath,
        fileName,
        originalFile,
        kind === 'video' ? remuxed : null
    );
}

async function retryFileRecord(browserWindow, record, plan, key) {
    if (browserWindow.isDestroyed()) {
        return;
    }
    const peer = extractPeerFromRecord(browserWindow, record);
    if (!peer) {
        throw new Error(`Cannot resolve original peer for ${key}.`);
    }
    const config = getFileRetryConfig();
    if (config.enabled === false || plan.some(descriptor => config[descriptor.kind] === false)) {
        return;
    }
    const repairedElements = [];
    for (const descriptor of plan) {
        repairedElements.push(await createRepairedElement(
            browserWindow,
            descriptor,
            config.archivePassword
        ));
    }
    const attrId = await generateMsgUniqueId(browserWindow, peer.chatType);
    await sendRepairedElements(browserWindow, peer, repairedElements, attrId);
    if (getFileRetryConfig().deleteFailedMessage === true) {
        await deleteFailedRecord(browserWindow, peer, record);
    }
    recordDiagnostic('info', 'file-retry.completed', {
        chatType: Number(peer.chatType) || 0,
        kinds: plan.map(descriptor => descriptor.kind),
        deletedFailedMessage: getFileRetryConfig().deleteFailedMessage === true
    });
}

function handleNativeSend(browserWindow, channel, args) {
    if (!isNativeMainChannel(channel)) {
        return false;
    }
    const context = createNativeEventContext(args, {
        detectUnitedConfigGroup: getConfig().interfaceTweaks.hiddenUpdateBtnAndNotice === true
    });
    if (shouldBlockUpdateNotice(context)) {
        return true;
    }
    rememberNativePeerAliases(browserWindow, context);
    if (isVoiceMessageEnabled()) {
        voiceFileSender?.rememberNativePeerAliases?.(browserWindow, context.aliases);
    }
    rememberInlineMediaRecords(browserWindow, context);
    processDeleteBubbleSkin(context);
    processPreventRecall(browserWindow, context);
    processPokeUpdates(browserWindow, context);
    Promise.resolve()
        .then(() => processMessageUpdates(browserWindow, context))
        .catch(error => warn('message update processing failed:', error?.message || error));
    return false;
}

function installNativeSendHandler(browserWindow) {
    if (!browserWindow || browserWindow.isDestroyed()) {
        return;
    }
    addNativeSendHandler(
        browserWindow,
        handleNativeSend,
        error => warn('native send interceptor failed:', error?.message || error)
    );
}

function installNativeRequestHandler(browserWindow) {
    if (!browserWindow || browserWindow.isDestroyed()) {
        return;
    }
    addNativeRequestHandler(
        browserWindow,
        handleToolboxNativeRequest,
        error => warn('native request interceptor failed:', error?.message || error)
    );
}

function installForAllWindows() {
    for (const browserWindow of BrowserWindow.getAllWindows()) {
        installNativeSendHandler(browserWindow);
        installNativeRequestHandler(browserWindow);
    }
}

function start() {
    loadConfig();
    app?.once?.('before-quit', () => inlineMediaServer.close());
    installConfigIpc();
    installForAllWindows();
    applyVoiceMessageConfig();
    cleanupOldRepairFiles(true).catch(() => {});
    app?.on?.('browser-window-created', (_event, browserWindow) => {
        installNativeSendHandler(browserWindow);
        installNativeRequestHandler(browserWindow);
        if (isVoiceMessageEnabled()) {
            voiceFileSender?.onBrowserWindowCreated?.(browserWindow);
        }
    });
    setInterval(installForAllWindows, 3000).unref?.();
    debug('loaded', {
        qqVersion: getQqVersion(),
        pluginVersion: getPluginManifest().version || '',
        features: getDiagnosticFeatureSummary()
    });
}

start();
