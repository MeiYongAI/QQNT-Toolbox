const { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, screen, shell } = require('electron');
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
const {
    normalizePreventRecallConfig,
    normalizeRecallBuddyContacts,
    normalizeRecallGroupContacts,
    shouldHandlePreventRecallRecord
} = require('./prevent-recall');
const {
    createRepeatMessageHandler,
    mapWithConcurrency
} = require('./repeat-message');
const { applyCustomImageSummary } = require('./image-summary');
const { PRESERVE_KIND, createFileRetryPlan, getRepairKinds } = require('./file-retry');
const {
    MAX_FAKE_FORWARD_IMAGES_PER_MESSAGE,
    buildFakeForwardFileUploadParams,
    buildFakeForwardImageUploadParams,
    buildFakeForwardVideoUploadParams,
    buildFakeForwardSendRequest,
    buildFakeForwardUploadRequest,
    createFakeForwardImageMsgInfo,
    createFakeForwardVideoMsgInfo,
    parseFakeForwardSendResponse,
    parseFakeForwardUploadResponse
} = require('./fake-forward');
const { loadReactionEmojiCatalog, normalizeReactionRequest } = require('./reaction-catalog');
const { getTencentFilesRoots } = require('./qq-data-root');
const {
    classifyMediaFilePath,
    createInlineMediaDownloadPayload,
    createInlineMediaVisitDownloadPayload,
    extractInlineMediaGallery,
    getInlineMediaMessageKeys,
    isInlineMediaItemSupported,
    isNativeMediaViewerUrl,
    isSameInlineMediaItem,
    mergeInlineMediaItems,
    normalizeInlineMediaOpenItem,
    normalizeInlineMediaSourceUrl,
    resolveInlineReplyPreview
} = require('./inline-media-preview');
const {
    buildEmojiMediaViewerPayload,
    collectEmojiImageSources,
    sanitizeMarketFaceData
} = require('./emoji-image-preview');
const { createLocalMediaServer } = require('./local-media-server');
const {
    createMediaSessionController,
    createMediaTaskRegistry
} = require('./media-session');
const {
    createSingleForwardWindowController,
    getForwardGroupScope
} = require('./single-forward-window');
const {
    constrainPipResize,
    fitPipBounds,
    getPipOuterSize,
    movePipBounds,
    normalizeAspectRatio,
    snapPipBounds
} = require('./media-pip-window');
const { createDiagnosticActionRunner, createDiagnosticLogger } = require('./diagnostics');
const { createPluginUpdater } = require('./plugin-updater');
const {
    expandQrScanPathCandidates,
    getOpenableQrUrl,
    isQqThumbnailPath,
    migrateQrScanConfig,
    normalizeQrScanInfos,
    summarizeQrScanValue
} = require('./qr-scan');
const {
    CHANNEL_GET_CONFIG,
    CHANNEL_SET_CONFIG,
    CHANNEL_CONFIG_CHANGED,
    CHANNEL_DIAGNOSTIC_EVENT,
    CHANNEL_DIAGNOSTIC_ACTION,
    CHANNEL_OPEN_MEDIA_VIEWER,
    CHANNEL_SCAN_QR_CODE,
    CHANNEL_QR_RESULT_ACTION,
    CHANNEL_MEDIA_VIEWER_GET_STATE,
    CHANNEL_MEDIA_VIEWER_PREPARE,
    CHANNEL_MEDIA_VIEWER_ACTION,
    CHANNEL_MEDIA_VIEWER_STATE_CHANGED,
    CHANNEL_MEDIA_PIP_GET_STATE,
    CHANNEL_MEDIA_PIP_ACTION,
    CHANNEL_MEDIA_PIP_DRAG,
    CHANNEL_MEDIA_PIP_STATE_CHANGED,
    CHANNEL_OPEN_EMOJI_AS_IMAGE,
    CHANNEL_FORWARD_OPEN_INTENT,
    CHANNEL_REPEAT_MESSAGE,
    CHANNEL_STAGE_FAKE_FORWARD_IMAGE,
    CHANNEL_RESOLVE_FAKE_FORWARD_SENDER_NAME,
    CHANNEL_SEND_FAKE_FORWARD,
    CHANNEL_GET_REACTION_CATALOG,
    CHANNEL_SET_MESSAGE_REACTION,
    CHANNEL_SEND_POKE,
    CHANNEL_RECALL_POKE,
    CHANNEL_REGISTER_POKE_ACCOUNT,
    CHANNEL_CLEAR_RECALL_CACHE,
    CHANNEL_OPEN_RECALL_DIR,
    CHANNEL_OPEN_RECALL_IMAGE_DIR,
    CHANNEL_VIEW_RECALL_MESSAGES,
    CHANNEL_GET_RECALL_CONTACTS,
    CHANNEL_GET_RECALL_VIEWER_DATA,
    CHANNEL_GET_RECALL_AUDIO_PREVIEW,
    CHANNEL_JUMP_RECALL_MESSAGE,
    CHANNEL_GET_UPDATE_STATE,
    CHANNEL_CHECK_UPDATE,
    CHANNEL_PREPARE_UPDATE,
    CHANNEL_RESTART_UPDATE,
    CHANNEL_UPDATE_STATE_CHANGED
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
const WINDOWS_MEDIA_VIEWER_OPACITY = 254 / 255;
const MEDIA_VIEWER_PRESENT_TIMEOUT_MS = 750;
const SET_MESSAGE_REACTION_COMMAND = 'nodeIKernelMsgService/setMsgEmojiLikes';
const FORWARD_RESOURCE_DOWNLOAD_TIMEOUT_MS = 60 * 1000;
const MAX_INLINE_MEDIA_PEERS = 40;
const MAX_INLINE_MEDIA_PER_PEER = 500;
const NUDGE_SEND_COMMAND = 'nodeIKernelMsgService/sendNudge';
const POKE_EVENT_TTL_MS = 60 * 60 * 1000;
const POKE_AUTO_REPLY_MAX_AGE_MS = 60 * 1000;
const POKE_AUTO_REPLY_SEQUENCE_WINDOW_MS = 10 * 1000;
const POKE_COMMAND = 'OidbSvcTrpcTcp.0xED3_1';
const POKE_RECALL_COMMAND = 'OidbSvcTrpcTcp.0xF51_1';
const WINDOWS_NATIVE_BINARY = 'poke-bridge.win32-x64.node';
const MAX_RECALL_CACHE_SIZE = 100000;
const IMAGE_EXTENSIONS = new Set([
    '.apng', '.bmp', '.gif', '.jfif', '.jpeg', '.jpg', '.png', '.webp'
]);
const FAKE_FORWARD_STAGED_IMAGE_PREFIX = 'qqnt-toolbox-fake-forward-';
const MAX_FAKE_FORWARD_STAGED_IMAGE_BYTES = 32 * 1024 * 1024;
const FAKE_FORWARD_IMAGE_MIME_EXTENSIONS = Object.freeze({
    'image/apng': '.apng',
    'image/bmp': '.bmp',
    'image/gif': '.gif',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp'
});
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
const INLINE_MEDIA_BACKGROUND_VALUES = new Set(['transparent', 'white', 'semi', 'black']);
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
    fakeForward: {
        enabled: false
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
        customImageSummaryEnabled: false,
        customImageSummary: '',
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
    updater: {
        checkOnStartup: false
    },
    preventRecall: {
        enabled: false,
        preventSelfMsg: false,
        persistedFiles: false,
        redirectPicPath: false,
        markerStyle: 'badge',
        filterMode: 'all',
        filterPeers: [],
        customColor: false,
        customTextColor: {
            light: '#ff6666',
            dark: '#c70000'
        }
    },
    interfaceTweaks: {
        inlineMediaViewer: false,
        inlineMediaBackground: 'black',
        mediaPipBounds: {
            x: 0,
            y: 0,
            width: 0,
            height: 0
        },
        openEmojiAsImage: false,
        singleClickMediaViewer: false,
        showFullUnreadCount: false,
        messageContextMenuOrder: {
            enabled: false,
            items: [],
            catalog: []
        },
        imageViewerOptimization: false,
        activeQrScan: false,
        singleMediaViewer: false,
        singleForwardViewer: false,
        singleForwardGroupIsolation: false,
        goBackMainList: false,
        preventMessageDrag: false,
        preventRecentContactDrag: false,
        preventProfileCardHover: false,
        deleteBubbleSkin: false,
        hiddenWeatherBtn: false,
        hiddenClassicBtn: false,
        hiddenHelpBtn: false,
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
    bridgeLoadAttempted: false,
    bridgeInstalled: false,
    wrapperApi: null,
    wrapperSession: null,
    processedEvents: new Map(),
    autoReplySequences: new Map()
};
const recallStates = new Map();
let configCache = null;
let recallViewerWindow = null;
let mediaViewerWindow = null;
let mediaViewerWindowReady = null;
let pendingMediaViewerPresentation = null;
let mediaViewerVisibilityRevision = 0;
let mediaPipWindow = null;
let mediaPipWindowReady = null;
let mediaPipAspectRatio = 16 / 9;
let mediaPipBoundsSaveTimer = null;
let mediaPipApplyingBounds = false;
let mediaPipDragging = false;
let mediaPipDragOrigin = null;
let mediaPipNativeHandle = null;
const recallViewerRecordIndex = new Map();
const recallViewerState = {
    accountUin: ''
};
const mediaViewerSession = createMediaSessionController({
    createId: () => crypto.randomUUID(),
    isSameItem: isSameInlineMediaItem
});
const mediaDownloadTasks = createMediaTaskRegistry();
const singleForwardWindowController = createSingleForwardWindowController({
    isEnabled: () => configCache?.interfaceTweaks?.singleForwardViewer === true,
    isIsolationEnabled: () =>
        configCache?.interfaceTweaks?.singleForwardGroupIsolation === true,
    isForwardUrl: url => getWindowRoute(url) === 'forward',
    getScopeKey: getForwardGroupScope,
    getFocusedWindow: () => BrowserWindow.getFocusedWindow(),
    onEvent: (type, details) => recordDiagnostic(
        'info', `forward.single-window-${type}`, details
    )
});
const mediaPipSession = {
    active: null,
    sticky: false
};
const inlineMediaServer = createLocalMediaServer();
let reactionEmojiCatalog = null;
let diagnosticLogger = null;
let diagnosticActionRunner = null;
let pluginUpdater = null;
let automaticUpdateTimer = null;

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

function getInstalledPluginVersion() {
    const version = String(getPluginManifest().version || '').trim();
    if (version) {
        return version;
    }
    try {
        return String(JSON.parse(
            fsSync.readFileSync(path.resolve(__dirname, '..', 'manifest.json'), 'utf8')
        ).version || '');
    } catch {
        return '';
    }
}

function broadcastUpdateState(state) {
    for (const browserWindow of BrowserWindow.getAllWindows()) {
        if (!browserWindow.isDestroyed()) {
            browserWindow.webContents.send(CHANNEL_UPDATE_STATE_CHANGED, state);
        }
    }
}

function getPluginUpdater() {
    if (!pluginUpdater) {
        pluginUpdater = createPluginUpdater({
            currentVersion: getInstalledPluginVersion(),
            pluginRoot: path.resolve(__dirname, '..'),
            dataDir: getPluginDataDir(),
            onStateChange: broadcastUpdateState
        });
    }
    return pluginUpdater;
}

function scheduleAutomaticUpdateCheck(delayMs = 10000) {
    if (automaticUpdateTimer) {
        clearTimeout(automaticUpdateTimer);
        automaticUpdateTimer = null;
    }
    if (getConfig().updater?.checkOnStartup !== true) {
        return;
    }
    automaticUpdateTimer = setTimeout(() => {
        automaticUpdateTimer = null;
        getPluginUpdater().checkForUpdates({ force: false }).catch(() => {});
    }, delayMs);
    automaticUpdateTimer.unref?.();
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
        fakeForward: {
            enabled: config.fakeForward?.enabled === true
        },
        voice: {
            enabled: config.voiceMessage?.enabled === true,
            saveContextMenu: config.voiceMessage?.saveInContextMenu === true,
            forwardContextMenu: config.voiceMessage?.forwardInContextMenu === true,
            fakeDuration: config.voiceMessage?.fakeDurationEnabled === true
        },
        message: {
            promptNoSeq: config.messageTweaks?.promptNoSeq === true,
            customImageSummary: config.messageTweaks?.customImageSummaryEnabled === true,
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
            redirectImages: config.preventRecall?.redirectPicPath === true,
            markerStyle: config.preventRecall?.markerStyle,
            filterMode: config.preventRecall?.filterMode,
            filterPeers: config.preventRecall?.filterPeers?.length || 0
        },
        poke: {
            autoReply: config.entertainment?.autoPokeBack === true,
            autoReplyLimit: Math.max(0, Number(config.entertainment?.autoPokeBackLimit) || 0),
            doubleClickAvatar: config.entertainment?.doubleClickAvatarPoke === true,
            contextMenu: config.entertainment?.rightClickAvatarPoke === true
        },
        interface: {
            inlineMedia: config.interfaceTweaks?.inlineMediaViewer === true,
            emojiAsImage: config.interfaceTweaks?.openEmojiAsImage === true,
            singleClickMedia: config.interfaceTweaks?.singleClickMediaViewer === true,
            activeQrScan: config.interfaceTweaks?.activeQrScan === true,
            singleMediaWindow: config.interfaceTweaks?.singleMediaViewer === true,
            singleForwardWindow: config.interfaceTweaks?.singleForwardViewer === true,
            singleForwardGroupIsolation:
                config.interfaceTweaks?.singleForwardGroupIsolation === true,
            menuOrder: config.interfaceTweaks?.messageContextMenuOrder?.enabled === true,
            preventProfileCard: config.interfaceTweaks?.preventProfileCardHover === true,
            preventRecentDrag: config.interfaceTweaks?.preventRecentContactDrag === true
        },
        floatingPanel: {
            enabled: config.floatingPanel?.enabled === true,
            shortcut: String(config.floatingPanel?.shortcut || '')
        },
        updater: {
            checkOnStartup: config.updater?.checkOnStartup === true
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

function normalizeMediaPipBounds(value) {
    const number = key => {
        const result = Number(value?.[key]);
        return Number.isFinite(result) ? Math.round(result) : 0;
    };
    return {
        x: number('x'),
        y: number('y'),
        width: Math.max(0, number('width')),
        height: Math.max(0, number('height'))
    };
}

function normalizeSimplifyConfig(config) {
    if (!INLINE_MEDIA_BACKGROUND_VALUES.has(config.interfaceTweaks?.inlineMediaBackground)) {
        config.interfaceTweaks.inlineMediaBackground = DEFAULT_CONFIG.interfaceTweaks.inlineMediaBackground;
    }
    config.interfaceTweaks.mediaPipBounds = normalizeMediaPipBounds(
        config.interfaceTweaks.mediaPipBounds
    );
    config.sideBar.top = normalizeSimplifyItemList(config.sideBar.top, 'sidebar-top');
    config.sideBar.bottom = normalizeSimplifyItemList(config.sideBar.bottom, 'sidebar-bottom');
    config.topFuncBar = normalizeSimplifyItemList(config.topFuncBar, 'top-func');
    config.chatFuncBar = normalizeSimplifyItemList(config.chatFuncBar, 'chat-func');
    config.preventRecall = normalizePreventRecallConfig(config.preventRecall);
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
        configCache = normalizeSimplifyConfig(mergeConfig(migrateQrScanConfig(
            JSON.parse(fsSync.readFileSync(configPath, 'utf8'))
        )));
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
    const wasSingleForwardViewerEnabled = configCache?.interfaceTweaks?.singleForwardViewer === true;
    const wasSingleForwardGroupIsolationEnabled =
        configCache?.interfaceTweaks?.singleForwardGroupIsolation === true;
    const normalizedConfig = normalizeSimplifyConfig(mergeConfig(migrateQrScanConfig(nextConfig)));
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
    syncMediaViewerConfig();
    if (wasSingleForwardViewerEnabled !==
        (configCache.interfaceTweaks.singleForwardViewer === true) ||
        wasSingleForwardGroupIsolationEnabled !==
        (configCache.interfaceTweaks.singleForwardGroupIsolation === true)) {
        singleForwardWindowController.sync(BrowserWindow.getAllWindows());
    }
    broadcastConfigChanged();
    scheduleAutomaticUpdateCheck(1000);
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
        const state = getWindowState(browserWindow);
        if (state.selfUin && state.selfUin !== selfUin) {
            state.inlineMediaByPeer.clear();
            state.inlineReplySourcesByPeer.clear();
        }
        state.selfUin = selfUin;
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

async function getRecallBuddyContacts(browserWindow) {
    const payloads = isQqVersionAtLeast(9, 9, 30)
        ? [['QQNT-Toolbox', false, 0], ['QQNT-Toolbox', 0], [false, 0]]
        : [[false, 0], ['QQNT-Toolbox', false, 0], ['QQNT-Toolbox', 0]];
    let buddyResult = null;
    let lastError = null;
    for (const payload of payloads) {
        try {
            buddyResult = await qqNativeInvoke(
                browserWindow,
                'ntApi',
                'nodeIKernelBuddyService/getBuddyListV2',
                payload,
                true,
                8000
            );
            if (!isNativeFailure(buddyResult)) {
                break;
            }
        } catch (error) {
            lastError = error;
        }
    }
    if (!buddyResult || isNativeFailure(buddyResult)) {
        if (lastError) {
            throw lastError;
        }
        return [];
    }
    const basicContacts = normalizeRecallBuddyContacts(buddyResult);
    const buddyUids = basicContacts.map(contact => contact.peerUid);
    if (!buddyUids.length) {
        return [];
    }
    try {
        const profileService = getQqWrapperSession()?.getProfileService?.();
        if (typeof profileService?.getCoreAndBaseInfo !== 'function') {
            throw new Error('QQ profile service is unavailable.');
        }
        const profiles = await Promise.resolve(
            profileService.getCoreAndBaseInfo('nodeStore', buddyUids)
        );
        return normalizeRecallBuddyContacts(buddyResult, profiles);
    } catch (error) {
        recordDiagnostic('warn', 'recall.buddy-profile-load-failed', {
            errorName: error?.name || 'Error',
            errorMessage: String(error?.message || error || '')
        });
        return basicContacts;
    }
}

async function getRecallGroupContacts(browserWindow) {
    const waiter = createNativeEventWaiter(browserWindow, (response, result) => {
        const command = normalizeText(response?.cmdName || result?.cmdName);
        return command.endsWith('KernelGroupListener/onGroupListUpdate');
    }, 10000);
    try {
        const response = await qqNativeInvoke(
            browserWindow,
            'ntApi',
            'nodeIKernelGroupService/getGroupList',
            [false],
            true,
            8000
        );
        const immediate = normalizeRecallGroupContacts(response);
        if (immediate.length) {
            waiter.cancel();
            return immediate;
        }
        return normalizeRecallGroupContacts(await waiter.promise);
    } catch (error) {
        waiter.cancel();
        throw error;
    }
}

async function getRecallContactCandidates(browserWindow) {
    if (!browserWindow) {
        return [];
    }
    const results = await Promise.allSettled([
        getRecallGroupContacts(browserWindow),
        getRecallBuddyContacts(browserWindow)
    ]);
    const contacts = [];
    for (const [index, result] of results.entries()) {
        if (result.status === 'fulfilled') {
            contacts.push(...result.value);
            continue;
        }
        recordDiagnostic('warn', index === 0 ? 'recall.group-list-load-failed' : 'recall.buddy-list-load-failed', {
            errorName: result.reason?.name || 'Error',
            errorMessage: String(result.reason?.message || result.reason || '')
        });
    }
    return contacts;
}

function getWindowsNativeBridge() {
    if (process.platform !== 'win32' || process.arch !== 'x64') {
        return null;
    }
    if (pokeState.bridge || pokeState.bridgeLoadAttempted) {
        return pokeState.bridge;
    }
    pokeState.bridgeLoadAttempted = true;
    try {
        pokeState.bridge = require(path.join(__dirname, '..', 'native', WINDOWS_NATIVE_BINARY));
    } catch {
        pokeState.bridge = null;
    }
    return pokeState.bridge;
}

function installPokeBridge() {
    if (pokeState.bridgeInstalled) {
        return true;
    }
    try {
        const code = Number(getWindowsNativeBridge()?.install?.());
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

async function resolveFakeForwardSenderUid(browserWindow, senderUin) {
    const aliases = getWindowState(browserWindow).peerUidByUin;
    const cached = normalizeText(aliases.get(senderUin));
    if (cached) {
        return cached;
    }
    try {
        const result = await qqNativeInvoke(
            browserWindow,
            'ntApi',
            'nodeIKernelProfileService/getUidByUin',
            [{ uin: senderUin, callFrom: 'QQNT-Toolbox' }, null],
            true,
            5000
        );
        const uid = normalizeText(findFirstByKey(result, ['uid', 'peerUid', 'ntUid']));
        if (uid) {
            aliases.set(senderUin, uid);
            return uid;
        }
    } catch {
    }
    return '';
}

function getFakeForwardProfileNickname(value) {
    return normalizeText(
        value?.detail?.simpleInfo?.coreInfo?.nick ||
        value?.simpleInfo?.coreInfo?.nick ||
        value?.detail?.coreInfo?.nick ||
        value?.coreInfo?.nick ||
        value?.detail?.nick ||
        value?.nick
    );
}

async function resolveFakeForwardSenderName(senderUin) {
    senderUin = normalizeUin(senderUin);
    if (!senderUin) {
        return '';
    }
    const profileService = getQqWrapperSession()?.getProfileService?.();
    if (typeof profileService?.getUserDetailInfoByUin !== 'function') {
        return '';
    }
    try {
        return getFakeForwardProfileNickname(await Promise.resolve(
            profileService.getUserDetailInfoByUin(senderUin)
        ));
    } catch {
        return '';
    }
}

async function resolveFakeForwardPeerUin(browserWindow, peer) {
    if (Number(peer?.chatType) === 2) {
        return normalizeUin(peer?.peerUid);
    }
    const peerUid = normalizeText(peer?.peerUid);
    const cached = normalizeUin(peer?.peerUin) || resolveUinFromUid(browserWindow, peerUid);
    if (cached) {
        return cached;
    }
    try {
        const result = await qqNativeInvoke(
            browserWindow,
            'ntApi',
            'nodeIKernelProfileService/getUinByUid',
            [{ uid: peerUid, callFrom: 'QQNT-Toolbox' }, null],
            true,
            5000
        );
        const uin = normalizeUin(findFirstByKey(result, ['uin', 'peerUin']));
        if (uin) {
            getWindowState(browserWindow).peerUidByUin.set(uin, peerUid);
            return uin;
        }
    } catch {
    }
    return '';
}

async function invokeFakeForwardSso(browserWindow, request) {
    installPokeBridge();
    const directResult = await sendSsoThroughWrapperSession(request.command, request.packet);
    return directResult
        ? directResult.response
        : await qqNativeInvoke(
            browserWindow,
            'ntApi',
            'nodeIKernelMsgService/sendSsoCmdReqByContend',
            [request.command, request.packet],
            true,
            30000
        );
}

function findRichMediaUploadInfo(value, criteria = {}, depth = 0, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || value instanceof Uint8Array || depth > 7 || seen.has(value)) {
        return null;
    }
    seen.add(value);
    const candidatePath = normalizePathText(value.filePath || value.commonFileInfo?.filePath);
    const candidateModelId = normalizeText(value.fileModelId || value.commonFileInfo?.fileModelId);
    const matchesPath = criteria.filePath && candidatePath &&
        normalizeComparablePath(candidatePath) === normalizeComparablePath(criteria.filePath);
    const matchesModelId = criteria.fileModelId && candidateModelId === normalizeText(criteria.fileModelId);
    const matches = criteria.filePath || criteria.fileModelId
        ? matchesPath || matchesModelId
        : true;
    if (matches && (value.commonFileInfo || value.fileErrCode !== undefined)) {
        return value;
    }
    const children = value instanceof Map ? value.values() : Object.values(value);
    for (const child of children) {
        const found = findRichMediaUploadInfo(child, criteria, depth + 1, seen);
        if (found) {
            return found;
        }
    }
    return null;
}

function createFakeForwardUploadWaiters(criteria, timeoutMs = 60 * 1000) {
    const waiters = BrowserWindow.getAllWindows()
        .filter(window => window && !window.isDestroyed() && !window.webContents?.isDestroyed())
        .map(window => createNativeEventWaiter(window, (response, result) => {
            const cmdName = normalizeText(result?.cmdName || response?.cmdName);
            if (!/nodeIKernelMsgListener\/onRichMediaUploadComplete$/i.test(cmdName)) {
                return false;
            }
            return Boolean(
                findRichMediaUploadInfo(result, criteria) ||
                findRichMediaUploadInfo(response, criteria)
            );
        }, timeoutMs));
    if (!waiters.length) {
        throw new Error('No QQ window is available for upload events.');
    }
    return {
        cancel: () => waiters.forEach(waiter => waiter.cancel()),
        promise: Promise.any(waiters.map(waiter => waiter.promise)).catch(error => {
            const first = error?.errors?.find(item => item instanceof Error);
            throw first || error;
        })
    };
}

function createFakeForwardImageUploadWaiters(filePath, timeoutMs = 60 * 1000) {
    return createFakeForwardUploadWaiters({ filePath }, timeoutMs);
}

function startFakeForwardImageUpload(peer, filePath) {
    const service = getQqWrapperSession()?.getRichMediaService?.();
    if (typeof service?.uploadRMFileWithoutMsg !== 'function') {
        throw new Error('QQ rich-media upload service is unavailable.');
    }
    return service.uploadRMFileWithoutMsg(buildFakeForwardImageUploadParams(peer, filePath));
}

function startFakeForwardVideoUpload(peer, filePath) {
    const service = getQqWrapperSession()?.getRichMediaService?.();
    if (typeof service?.uploadRMFileWithoutMsg !== 'function') {
        throw new Error('QQ rich-media upload service is unavailable.');
    }
    return service.uploadRMFileWithoutMsg(buildFakeForwardVideoUploadParams(peer, filePath));
}

function getCompletedFakeForwardUpload(eventResult, criteria, label) {
    const uploadInfo = findRichMediaUploadInfo(eventResult, criteria) || eventResult;
    const errorCode = Number(uploadInfo?.fileErrCode);
    if (Number.isFinite(errorCode) && errorCode !== 0) {
        throw new Error(`${label}上传失败：${uploadInfo?.fileErrMsg || errorCode}`);
    }
    return uploadInfo;
}

async function uploadFakeForwardImage(browserWindow, peer, filePath) {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile() || !stat.size) {
        throw new Error(`图片文件不存在或为空：${path.basename(filePath)}`);
    }
    const extension = await nativeFileType(browserWindow, filePath);
    if (!IMAGE_EXTENSIONS.has(`.${extension}`)) {
        throw new Error(`不支持的图片格式：${path.basename(filePath)}`);
    }
    const waiter = createFakeForwardImageUploadWaiters(filePath);
    try {
        const invocation = startFakeForwardImageUpload(peer, filePath);
        const invocationFailure = Promise.resolve(invocation).then(() => new Promise(() => {}));
        const eventResult = await Promise.race([waiter.promise, invocationFailure]);
        const uploadInfo = getCompletedFakeForwardUpload(eventResult, { filePath }, '图片');
        const commonFileInfo = uploadInfo?.commonFileInfo || {};
        const fileUuid = normalizeText(commonFileInfo.uuid || uploadInfo?.fileId);
        if (!fileUuid) {
            throw new Error(`QQ 未返回图片资源 ID：${path.basename(filePath)}`);
        }
        const [imageSize, fileSize, md5, sha1] = await Promise.all([
            nativeImageSize(browserWindow, filePath),
            nativeFileSize(browserWindow, filePath),
            getFileMd5(filePath),
            getFileSha1(filePath)
        ]);
        return createFakeForwardImageMsgInfo({
            peer,
            fileUuid,
            fileSize,
            width: imageSize.width,
            height: imageSize.height,
            extension,
            fileName: `${md5}.${extension}`,
            md5,
            sha1
        });
    } finally {
        waiter.cancel();
    }
}

async function uploadFakeForwardVideo(browserWindow, peer, filePath) {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile() || !stat.size) {
        throw new Error(`视频文件不存在或为空：${path.basename(filePath)}`);
    }
    const mediaInfo = await probeMediaInfo(filePath);
    if (!mediaInfo.width || !mediaInfo.height) {
        throw new Error(`无法读取视频画面：${path.basename(filePath)}`);
    }
    const thumbPath = await createVideoThumbnail(filePath, '', {
        blur: false,
        extension: '.jpg',
        maxWidth: 640
    });
    const waiter = createFakeForwardUploadWaiters({ filePath }, 5 * 60 * 1000);
    try {
        const invocation = startFakeForwardVideoUpload(peer, filePath);
        const invocationFailure = Promise.resolve(invocation).then(() => new Promise(() => {}));
        const eventResult = await Promise.race([waiter.promise, invocationFailure]);
        const uploadInfo = getCompletedFakeForwardUpload(eventResult, { filePath }, '视频');
        const commonFileInfo = uploadInfo?.commonFileInfo || {};
        const fileUuid = normalizeText(commonFileInfo.uuid || uploadInfo?.fileId);
        if (!fileUuid) {
            throw new Error(`QQ 未返回视频资源 ID：${path.basename(filePath)}`);
        }
        const [thumbMsgInfo, md5, sha1] = await Promise.all([
            uploadFakeForwardImage(browserWindow, peer, thumbPath),
            getFileMd5(filePath),
            getFileSha1(filePath)
        ]);
        const extension = path.extname(filePath).replace(/^\./, '').toLowerCase() || 'mp4';
        return createFakeForwardVideoMsgInfo({
            peer,
            fileUuid,
            fileSize: stat.size,
            width: mediaInfo.width,
            height: mediaInfo.height,
            duration: mediaInfo.duration,
            extension,
            fileName: `${md5}.${extension}`,
            md5,
            sha1,
            thumbMsgInfo
        });
    } finally {
        waiter.cancel();
        await fs.unlink(thumbPath).catch(() => {});
    }
}

function getFilePrefixMd5(filePath, byteLimit = 10002432) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5');
        const stream = fsSync.createReadStream(filePath, { start: 0, end: byteLimit - 1 });
        stream.on('data', chunk => hash.update(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

function createFakeForwardFileModelId() {
    return String(crypto.randomBytes(6).readUIntBE(0, 6));
}

async function uploadFakeForwardFile(peer, filePath, requestedName) {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile() || !stat.size) {
        throw new Error(`文件不存在或为空：${path.basename(filePath)}`);
    }
    const fileName = path.basename(normalizeText(requestedName)) || path.basename(filePath);
    const fileModelId = createFakeForwardFileModelId();
    const request = buildFakeForwardFileUploadParams(peer, filePath, fileName, fileModelId);
    const service = getQqWrapperSession()?.getRichMediaService?.();
    if (typeof service?.onlyUploadFile !== 'function') {
        throw new Error('QQ file upload service is unavailable.');
    }
    const criteria = { filePath, fileModelId };
    const waiter = createFakeForwardUploadWaiters(criteria, 10 * 60 * 1000);
    try {
        const invocation = service.onlyUploadFile(request.peer, request.files);
        const invocationFailure = Promise.resolve(invocation).then(() => new Promise(() => {}));
        const eventResult = await Promise.race([waiter.promise, invocationFailure]);
        const uploadInfo = getCompletedFakeForwardUpload(eventResult, criteria, '文件');
        const commonFileInfo = uploadInfo?.commonFileInfo || {};
        const fileId = normalizeText(commonFileInfo.uuid || uploadInfo?.fileId);
        if (!fileId) {
            throw new Error(`QQ 未返回文件资源 ID：${fileName}`);
        }
        const [localMd5, localMd510m] = await Promise.all([
            getFileMd5(filePath),
            getFilePrefixMd5(filePath)
        ]);
        const md5 = /^[0-9a-f]{32}$/i.test(commonFileInfo.md5 || '')
            ? String(commonFileInfo.md5).toLowerCase()
            : localMd5;
        const md510m = /^[0-9a-f]{32}$/i.test(commonFileInfo.md510m || '')
            ? String(commonFileInfo.md510m).toLowerCase()
            : localMd510m;
        const fileHash = normalizeText(findFirstByKey(uploadInfo, [
            'fileIdCrcMedia', 'fileIdCrc', 'crcMedia', 'fileHash', 'fileAddon'
        ]));
        return { type: 'file', name: fileName, fileId, fileSize: stat.size, md5, md510m, fileHash };
    } finally {
        waiter.cancel();
    }
}

function getFakeForwardUploadKey(type, filePath, fileName = '') {
    return `${type}\0${normalizeComparablePath(filePath)}\0${type === 'file' ? fileName : ''}`;
}

async function prepareFakeForwardMedia(browserWindow, payload) {
    const peer = payload?.peer || {};
    const messages = Array.isArray(payload?.messages) ? payload.messages : [];
    const selected = new Map();
    for (const [messageIndex, message] of messages.entries()) {
        const segments = getFakeForwardSourceSegments(message);
        const images = segments.filter(segment => segment?.type === 'image');
        if (images.length > MAX_FAKE_FORWARD_IMAGES_PER_MESSAGE) {
            throw new Error(`第 ${messageIndex + 1} 条消息的图片数量过多。`);
        }
        const standalone = segments.filter(segment => segment?.type === 'video' || segment?.type === 'file');
        const meaningful = segments.filter(segment => segment?.type !== 'text' || String(segment.text ?? '').length);
        if (standalone.length && (standalone.length !== 1 || meaningful.length !== 1)) {
            throw new Error(`第 ${messageIndex + 1} 条消息中的视频或文件必须单独发送。`);
        }
        for (const segment of segments) {
            if (segment?.type === 'text') {
                continue;
            }
            if (!['image', 'video', 'file'].includes(segment?.type)) {
                throw new Error(`第 ${messageIndex + 1} 条消息包含不支持的内容。`);
            }
            const filePath = normalizePathText(segment?.path);
            if (!filePath || !path.isAbsolute(filePath)) {
                throw new Error(`第 ${messageIndex + 1} 条消息包含无效的文件路径。`);
            }
            const fileName = path.basename(normalizeText(segment.name)) || path.basename(filePath);
            const key = getFakeForwardUploadKey(segment.type, filePath, fileName);
            if (!selected.has(key)) {
                selected.set(key, { key, type: segment.type, filePath, fileName });
            }
        }
    }
    const uploaded = await mapWithConcurrency(Array.from(selected.values()), 2, async item => {
        if (item.type === 'file') {
            return { key: item.key, segment: await uploadFakeForwardFile(peer, item.filePath, item.fileName) };
        }
        const msgInfo = item.type === 'video'
            ? await uploadFakeForwardVideo(browserWindow, peer, item.filePath)
            : await uploadFakeForwardImage(browserWindow, peer, item.filePath);
        return {
            key: item.key,
            segment: { type: item.type, name: item.fileName, msgInfo }
        };
    });
    const byPath = new Map(uploaded.map(item => [item.key, item.segment]));
    return {
        ...payload,
        messages: messages.map(message => ({
            ...message,
            segments: getFakeForwardSourceSegments(message).map(segment => {
                if (segment?.type === 'text') {
                    return { type: 'text', text: String(segment.text ?? '') };
                }
                const filePath = normalizePathText(segment?.path);
                const fileName = path.basename(normalizeText(segment?.name)) || path.basename(filePath);
                return byPath.get(getFakeForwardUploadKey(segment?.type, filePath, fileName));
            })
        }))
    };
}

function getFakeForwardSourceSegments(message) {
    if (Array.isArray(message?.segments)) {
        return message.segments;
    }
    return [
        ...(String(message?.content ?? '') ? [{ type: 'text', text: String(message.content) }] : []),
        ...(Array.isArray(message?.images)
            ? message.images.map(image => ({ type: 'image', ...image }))
            : [])
    ];
}

function toFakeForwardImageBuffer(value) {
    if (Buffer.isBuffer(value)) {
        return value;
    }
    if (value instanceof ArrayBuffer) {
        return Buffer.from(value);
    }
    if (ArrayBuffer.isView(value)) {
        return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }
    if (value?.type === 'Buffer' && Array.isArray(value.data)) {
        return Buffer.from(value.data);
    }
    return Buffer.alloc(0);
}

async function stageFakeForwardImage(payload) {
    const data = toFakeForwardImageBuffer(payload?.data);
    if (!data.length || data.length > MAX_FAKE_FORWARD_STAGED_IMAGE_BYTES) {
        throw new Error('图片为空或超过 32 MB。');
    }
    const originalName = path.basename(normalizeText(payload?.name)) || 'image.png';
    const nameExtension = path.extname(originalName).toLowerCase();
    const mimeExtension = FAKE_FORWARD_IMAGE_MIME_EXTENSIONS[normalizeText(payload?.type).toLowerCase()];
    const extension = IMAGE_EXTENSIONS.has(nameExtension) ? nameExtension : mimeExtension;
    if (!extension) {
        throw new Error('不支持该图片格式。');
    }
    const filePath = path.join(
        os.tmpdir(),
        `${FAKE_FORWARD_STAGED_IMAGE_PREFIX}${crypto.randomUUID()}${extension}`
    );
    await fs.writeFile(filePath, data, { flag: 'wx' });
    const baseName = path.basename(originalName, nameExtension);
    return {
        path: filePath,
        name: `${baseName || 'image'}${extension}`
    };
}

async function cleanupFakeForwardStagedImages(payload) {
    const tempDirectory = normalizeComparablePath(os.tmpdir());
    const paths = new Set();
    for (const message of Array.isArray(payload?.messages) ? payload.messages : []) {
        for (const segment of getFakeForwardSourceSegments(message)) {
            const filePath = normalizePathText(segment?.type === 'image' ? segment.path : '');
            if (normalizeComparablePath(path.dirname(filePath)) === tempDirectory &&
                path.basename(filePath).startsWith(FAKE_FORWARD_STAGED_IMAGE_PREFIX)) {
                paths.add(filePath);
            }
        }
    }
    await Promise.all(Array.from(paths, filePath => fs.unlink(filePath).catch(() => {})));
}

async function sendFakeForwardFromRenderer(browserWindow, payload) {
    if (getConfig().fakeForward?.enabled !== true) {
        throw new Error('伪造合并转发功能未开启。');
    }
    registerPokeAccount(browserWindow, payload?.selfUin);
    let selfUid = '';
    if (Number(payload?.peer?.chatType) === 1) {
        const selfUin = getWindowState(browserWindow).selfUin;
        if (!selfUin) {
            throw new Error('无法获取当前账号。');
        }
        selfUid = await resolveFakeForwardSenderUid(browserWindow, selfUin);
    }
    const preparedPayload = await prepareFakeForwardMedia(browserWindow, payload);
    const upload = await buildFakeForwardUploadRequest(preparedPayload, { selfUid });
    const response = await invokeFakeForwardSso(browserWindow, upload);
    if (isNativeFailure(response)) {
        throw new Error(`上传合并转发记录失败：${safeJson(response)}`);
    }
    const resId = await parseFakeForwardUploadResponse(response);
    const peerUin = await resolveFakeForwardPeerUin(browserWindow, upload.peer);
    const sendRequest = await buildFakeForwardSendRequest(upload, resId, { peerUin });
    const sendResponse = await parseFakeForwardSendResponse(
        await invokeFakeForwardSso(browserWindow, sendRequest)
    );
    if (sendResponse.result !== 0) {
        throw new Error(`发送合并转发卡片失败：${sendResponse.result}${
            sendResponse.errMsg ? ` (${sendResponse.errMsg})` : ''
        }`);
    }
    await cleanupFakeForwardStagedImages(payload);
    return {
        ok: true,
        count: upload.count
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
        const tencentFilesRoots = getTencentFilesRoots({
            documentsPath: app.getPath('documents')
        });
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
    ipcMain.on(CHANNEL_FORWARD_OPEN_INTENT, event => {
        const sourceWindow = BrowserWindow.fromWebContents(event.sender);
        if (!sourceWindow) {
            return;
        }
        singleForwardWindowController.markOpenIntent(
            sourceWindow,
            getWindowRoute(sourceWindow.webContents.getURL()) === 'forward'
                ? 'nested'
            : 'root'
        );
    });
    ipcMain.handle(CHANNEL_GET_RECALL_CONTACTS, event =>
        getRecallContactCandidates(BrowserWindow.fromWebContents(event.sender))
    );
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
    ipcMain.handle(CHANNEL_GET_UPDATE_STATE, () => getPluginUpdater().getState());
    ipcMain.handle(CHANNEL_CHECK_UPDATE, (_event, options) => getPluginUpdater().checkForUpdates({
        force: options?.force === true
    }));
    ipcMain.handle(CHANNEL_PREPARE_UPDATE, () => getPluginUpdater().prepareUpdate());
    ipcMain.handle(CHANNEL_RESTART_UPDATE, async () => {
        const updater = getPluginUpdater();
        const result = await updater.activatePendingUpdate();
        if (!result.ok) {
            return result;
        }
        setTimeout(() => {
            app.relaunch();
            app.quit();
        }, 250).unref?.();
        return result;
    });
    ipcMain.handle(CHANNEL_OPEN_MEDIA_VIEWER, async (event, payload) => {
        const browserWindow = BrowserWindow.fromWebContents(event.sender);
        const summary = {
            type: payload?.type || '',
            source: payload?.source || 'message'
        };
        try {
            const decision = browserWindow
                ? await openMediaViewerFromRenderer(browserWindow, payload)
                : { handled: false, activateNative: true };
            recordDiagnostic(decision.handled ? 'info' : 'warn', 'media.viewer-open', {
                ...summary,
                ok: decision.handled,
                activateNative: decision.activateNative
            });
            return decision;
        } catch (error) {
            recordDiagnostic('error', 'media.viewer-open-failed', { ...summary, error });
            return { handled: false, activateNative: true };
        }
    });
    ipcMain.handle(CHANNEL_SCAN_QR_CODE, async (event, payload) => {
        const browserWindow = BrowserWindow.fromWebContents(event.sender);
        return browserWindow
            ? await scanQrCode(browserWindow, payload)
            : { ok: false, reason: 'window-unavailable' };
    });
    ipcMain.handle(CHANNEL_QR_RESULT_ACTION, (event, payload) =>
        handleQrResultAction(event, payload)
    );
    ipcMain.handle(CHANNEL_MEDIA_VIEWER_GET_STATE, event =>
        isToolboxMediaViewerSender(event.sender) ? getMediaViewerPublicState() : null
    );
    ipcMain.handle(CHANNEL_MEDIA_VIEWER_PREPARE, async (event, payload) => {
        if (!isToolboxMediaViewerSender(event.sender)) {
            return null;
        }
        const sourceWindow = getMediaViewerSourceWindow(payload?.galleryId);
        return sourceWindow ? await prepareMediaViewerItem(sourceWindow, payload) : null;
    });
    ipcMain.handle(CHANNEL_MEDIA_VIEWER_ACTION, async (event, payload) => {
        if (!isToolboxMediaViewerSender(event.sender)) {
            return { ok: false };
        }
        return await handleMediaViewerAction(payload);
    });
    ipcMain.handle(CHANNEL_MEDIA_PIP_GET_STATE, event =>
        isToolboxMediaPipSender(event.sender) ? getMediaPipPublicState() : null
    );
    ipcMain.handle(CHANNEL_MEDIA_PIP_ACTION, async (event, payload) => {
        if (!isToolboxMediaPipSender(event.sender)) {
            return { ok: false };
        }
        return await handleMediaPipAction(payload);
    });
    ipcMain.on(CHANNEL_MEDIA_PIP_DRAG, (event, payload) => {
        if (isToolboxMediaPipSender(event.sender)) {
            handleMediaPipDrag(payload);
        }
    });
    ipcMain.handle(CHANNEL_OPEN_EMOJI_AS_IMAGE, async (event, payload) => {
        const browserWindow = BrowserWindow.fromWebContents(event.sender);
        try {
            const opened = browserWindow
                ? await openEmojiAsImageFromRenderer(browserWindow, payload)
                : false;
            recordDiagnostic(opened ? 'info' : 'warn', 'emoji-image.open-request', {
                ok: opened
            });
            return opened;
        } catch (error) {
            recordDiagnostic('error', 'emoji-image.open-failed', { error });
            return false;
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
    ipcMain.handle(CHANNEL_STAGE_FAKE_FORWARD_IMAGE, (_event, payload) => stageFakeForwardImage(payload));
    ipcMain.handle(CHANNEL_RESOLVE_FAKE_FORWARD_SENDER_NAME, (_event, senderUin) =>
        resolveFakeForwardSenderName(senderUin)
    );
    ipcMain.handle(CHANNEL_SEND_FAKE_FORWARD, async (event, payload) => {
        const browserWindow = BrowserWindow.fromWebContents(event.sender);
        if (!browserWindow) {
            throw new Error('BrowserWindow was not found.');
        }
        const summary = {
            chatType: Number(payload?.peer?.chatType) || 0,
            messageCount: Array.isArray(payload?.messages) ? payload.messages.length : 0,
            mediaTypes: Array.isArray(payload?.messages)
                ? payload.messages.flatMap(message => getFakeForwardSourceSegments(message))
                    .map(segment => segment?.type)
                    .filter(type => ['image', 'video', 'file'].includes(type))
                : []
        };
        recordDiagnostic('info', 'fake-forward.requested', summary);
        try {
            const result = await sendFakeForwardFromRenderer(browserWindow, payload);
            recordDiagnostic('info', 'fake-forward.completed', summary);
            return result;
        } catch (error) {
            recordDiagnostic('error', 'fake-forward.failed', { ...summary, error });
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
            inlineReplySourcesByPeer: new Map()
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

function getMessageTweaksConfig() {
    if (!configCache) {
        loadConfig();
    }
    return configCache.messageTweaks;
}

function isInlineMediaViewerEnabled(tweaks = getInterfaceTweaksConfig()) {
    return tweaks?.inlineMediaViewer === true;
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

function normalizeQrFilePath(value) {
    let source = normalizeText(value);
    if (!source) {
        return '';
    }
    if (/^appimg:\/\//i.test(source)) {
        source = source.replace(/^appimg:\/\/+?/i, '');
        try {
            source = decodeURIComponent(source);
        } catch {
        }
        if (/^\/[a-z]:[\\/]/i.test(source)) {
            source = source.slice(1);
        }
    } else if (/^file:/i.test(source)) {
        try {
            source = fileURLToPath(source);
        } catch {
            return '';
        }
    }
    return path.isAbsolute(source) ? path.normalize(source) : '';
}

async function resolveQrScanFile(browserWindow, payload) {
    const candidatePaths = expandQrScanPathCandidates([
        payload?.filePath,
        ...(Array.isArray(payload?.candidatePaths) ? payload.candidatePaths : []),
        payload?.sourceUrl
    ].map(normalizeQrFilePath).filter(Boolean));
    const existingPaths = candidatePaths
        .map(filePath => getExistingFilePath([filePath]))
        .filter(Boolean);
    const preferredPath = existingPaths[0] || '';
    const unresolvedPath = candidatePaths.find(path.isAbsolute) || '';
    const item = normalizeInlineMediaOpenItem({
        ...payload,
        type: 'image',
        ...(unresolvedPath ? { filePath: unresolvedPath } : {})
    });
    if (!item || item.type !== 'image') {
        return preferredPath;
    }
    if (preferredPath && !isQqThumbnailPath(preferredPath)) {
        return preferredPath;
    }
    if (!createInlineMediaDownloadPayload(item)) {
        return preferredPath;
    }
    try {
        const downloadedPath = await downloadInlineMedia(browserWindow, item, {
            triggerType: 0,
            source: 'qr-scan'
        });
        return getExistingFilePath([downloadedPath]) || preferredPath;
    } catch (error) {
        if (preferredPath) {
            recordDiagnostic('info', 'qr-scan.original-unavailable', {
                reason: error?.message || String(error)
            });
            return preferredPath;
        }
        throw error;
    }
}

function getQrScanFileSummary(filePath) {
    let bytes = 0;
    let width = 0;
    let height = 0;
    try {
        bytes = fsSync.statSync(filePath).size;
    } catch {
    }
    try {
        const size = nativeImage.createFromPath(filePath).getSize();
        width = Number(size.width) || 0;
        height = Number(size.height) || 0;
    } catch {
    }
    return {
        source: /[\\/]Ori[\\/]/i.test(filePath)
            ? 'qq-original'
            : isQqThumbnailPath(filePath) ? 'qq-thumbnail' : 'local',
        extension: path.extname(filePath).toLowerCase(),
        bytes,
        width,
        height
    };
}

async function invokeQqQrScanner(browserWindow, filePath) {
    const service = getQqWrapperSession()?.getNodeMiscService?.();
    if (typeof service?.scanQBar === 'function') {
        return {
            method: 'wrapper',
            result: await Promise.resolve(service.scanQBar(filePath))
        };
    }
    return {
        method: 'ipc',
        result: await qqNativeInvoke(
            browserWindow,
            'ntApi',
            QR_SCAN_COMMAND,
            [filePath],
            true,
            30000
        )
    };
}

async function scanQrCode(browserWindow, payload) {
    if (getInterfaceTweaksConfig()?.activeQrScan !== true) {
        return { ok: false, reason: 'disabled' };
    }
    if (!browserWindow || browserWindow.isDestroyed() || browserWindow.webContents.isDestroyed()) {
        return { ok: false, reason: 'window-unavailable' };
    }
    try {
        const filePath = await resolveQrScanFile(browserWindow, payload);
        if (!filePath) {
            return {
                ok: false,
                reason: 'image-unavailable',
                message: '图片尚未下载完成'
            };
        }
        const scan = await invokeQqQrScanner(browserWindow, filePath);
        const result = scan.result;
        if (isNativeFailure(result)) {
            throw new Error('QQ QBar returned a failure result.');
        }
        const infos = normalizeQrScanInfos(result);
        recordDiagnostic('info', 'qr-scan.completed', {
            method: scan.method,
            resultCount: infos.length,
            file: getQrScanFileSummary(filePath),
            resultShape: summarizeQrScanValue(result)
        });
        return {
            ok: true,
            count: infos.length,
            infos: infos.map(info => ({
                text: info.text,
                url: getOpenableQrUrl(info.text)
            })),
            ...(infos.length ? {} : { message: '未识别到二维码' })
        };
    } catch (error) {
        recordDiagnostic('warn', 'qr-scan.failed', {
            reason: error?.message || String(error)
        });
        return {
            ok: false,
            reason: 'scan-failed',
            message: '二维码识别失败'
        };
    }
}

async function handleQrResultAction(event, payload = {}) {
    const type = normalizeText(payload.type);
    if (type === 'open') {
        const url = getOpenableQrUrl(payload.url);
        if (!url) {
            return { ok: false, reason: 'invalid-url' };
        }
        if (isToolboxMediaViewerSender(event?.sender)) {
            hideMediaViewer();
            clearMediaViewerSession();
        }
        await shell.openExternal(url);
        return { ok: true };
    }
    if (type === 'copy') {
        const content = String(payload.text ?? '');
        if (!content || content.length > 128 * 1024) {
            return { ok: false, reason: 'invalid-text' };
        }
        clipboard.writeText(content);
        return { ok: true };
    }
    return { ok: false, reason: 'invalid-action' };
}

function isMediaViewerWindow(browserWindow) {
    if (!browserWindow || browserWindow.isDestroyed()) {
        return false;
    }
    return isNativeMediaViewerUrl(browserWindow.webContents.getURL());
}

function closeExistingMediaViewers(sender) {
    for (const browserWindow of BrowserWindow.getAllWindows()) {
        if (browserWindow !== mediaViewerWindow && browserWindow.webContents !== sender &&
            isMediaViewerWindow(browserWindow)) {
            browserWindow.close();
        }
    }
}

function isToolboxMediaViewerSender(sender) {
    return Boolean(
        mediaViewerWindow && !mediaViewerWindow.isDestroyed() &&
        mediaViewerWindow.webContents === sender
    );
}

function isToolboxMediaPipSender(sender) {
    return Boolean(
        mediaPipWindow && !mediaPipWindow.isDestroyed() &&
        mediaPipWindow.webContents === sender
    );
}

function normalizeMediaPlaybackState(value) {
    const currentTime = Number(value?.currentTime);
    const volume = Number(value?.volume);
    const playbackRate = Number(value?.playbackRate);
    return {
        currentTime: Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0,
        paused: value?.paused !== false,
        volume: Number.isFinite(volume) ? Math.min(Math.max(volume, 0), 1) : 1,
        muted: value?.muted === true,
        playbackRate: Number.isFinite(playbackRate)
            ? Math.min(Math.max(playbackRate, 0.25), 4)
            : 1
    };
}

function cloneMediaViewerGallery(gallery, selectedIndex = gallery?.index) {
    const items = Array.isArray(gallery?.items)
        ? gallery.items.map(item => ({ ...item }))
        : [];
    const index = Number(selectedIndex);
    return {
        id: normalizeText(gallery?.id),
        index: Number.isInteger(index)
            ? Math.min(Math.max(index, 0), Math.max(0, items.length - 1))
            : 0,
        items
    };
}

function getMediaPipPublicState() {
    const active = mediaPipSession.active;
    const gallery = active?.gallery;
    const index = gallery?.index || 0;
    return {
        galleryId: gallery?.id || '',
        index,
        item: active?.viewerItems[index]
            ? { ...active.viewerItems[index] }
            : null,
        playback: active?.playback
            ? { ...active.playback }
            : normalizeMediaPlaybackState()
    };
}

function sendMediaPipState(payload = getMediaPipPublicState()) {
    if (!mediaPipWindow || mediaPipWindow.isDestroyed() ||
        mediaPipWindow.webContents.isDestroyed()) {
        return false;
    }
    mediaPipWindow.webContents.send(CHANNEL_MEDIA_PIP_STATE_CHANGED, payload);
    return true;
}

function clearMediaPipSession() {
    mediaPipSession.active = null;
}

function hideMediaPipWindow() {
    if (!mediaPipWindow || mediaPipWindow.isDestroyed()) {
        return;
    }
    mediaPipDragging = false;
    mediaPipDragOrigin = null;
    endMediaPipNativeMove();
    sendMediaPipState({ hidden: true });
    mediaPipWindow.hide();
}

function closeMediaPipSession() {
    hideMediaPipWindow();
    clearMediaPipSession();
}

function getMediaPipDisplay(sourceWindow) {
    const reference = mediaViewerWindow && !mediaViewerWindow.isDestroyed()
        ? mediaViewerWindow
        : sourceWindow;
    try {
        return screen.getDisplayMatching(reference.getBounds());
    } catch {
        return screen.getPrimaryDisplay();
    }
}

function scheduleMediaPipBoundsSave() {
    if (mediaPipApplyingBounds || mediaPipDragging ||
        !mediaPipWindow || mediaPipWindow.isDestroyed()) {
        return;
    }
    const bounds = normalizeMediaPipBounds(mediaPipWindow.getBounds());
    const config = configCache || loadConfig();
    config.interfaceTweaks.mediaPipBounds = bounds;
    clearTimeout(mediaPipBoundsSaveTimer);
    mediaPipBoundsSaveTimer = setTimeout(() => {
        mediaPipBoundsSaveTimer = null;
        const configPath = getConfigPath();
        fs.mkdir(path.dirname(configPath), { recursive: true })
            .then(() => fs.writeFile(configPath, JSON.stringify(configCache, null, 2), 'utf8'))
            .catch(error => warn('media PiP bounds save failed:', error?.message || error));
    }, 250);
    mediaPipBoundsSaveTimer.unref?.();
}

function setMediaPipBounds(viewerWindow, bounds) {
    if (!bounds || viewerWindow.isDestroyed()) {
        return;
    }
    mediaPipApplyingBounds = true;
    try {
        viewerWindow.setBounds(bounds);
    } finally {
        mediaPipApplyingBounds = false;
    }
}

function moveMediaPipWindow(dx, dy) {
    if (mediaPipNativeHandle) {
        try {
            const result = Number(getWindowsNativeBridge()?.moveWindow?.(
                mediaPipNativeHandle,
                Math.round(dx),
                Math.round(dy)
            ));
            if (result === 1) {
                return;
            }
        } catch {
        }
        endMediaPipNativeMove();
    }
    setMediaPipBounds(mediaPipWindow, movePipBounds(mediaPipDragOrigin, dx, dy));
}

function beginMediaPipNativeMove() {
    endMediaPipNativeMove();
    if (process.platform !== 'win32' || process.arch !== 'x64') {
        return;
    }
    try {
        const handle = mediaPipWindow.getNativeWindowHandle();
        const result = Number(getWindowsNativeBridge()?.beginWindowMove?.(handle));
        if (result === 1) {
            mediaPipNativeHandle = handle;
        }
    } catch {
    }
}

function endMediaPipNativeMove() {
    if (mediaPipNativeHandle) {
        try {
            getWindowsNativeBridge()?.endWindowMove?.();
        } catch {
        }
    }
    mediaPipNativeHandle = null;
}

function handleMediaPipDrag(payload = {}) {
    if (!mediaPipWindow || mediaPipWindow.isDestroyed()) {
        mediaPipDragging = false;
        mediaPipDragOrigin = null;
        endMediaPipNativeMove();
        return;
    }
    const phase = normalizeText(payload.phase);
    if (phase === 'start') {
        mediaPipDragging = true;
        mediaPipDragOrigin = mediaPipWindow.getBounds();
        beginMediaPipNativeMove();
        return;
    }
    if (phase === 'end') {
        const wasDragging = mediaPipDragging;
        mediaPipDragging = false;
        mediaPipDragOrigin = null;
        endMediaPipNativeMove();
        if (wasDragging) {
            snapMediaPipWindow();
        }
        return;
    }
    const dx = Number(payload.dx);
    const dy = Number(payload.dy);
    if (phase !== 'move' || !mediaPipDragging || !mediaPipDragOrigin ||
        !Number.isFinite(dx) || !Number.isFinite(dy)) {
        return;
    }
    moveMediaPipWindow(dx, dy);
}

function configureMediaPipGeometry(viewerWindow, sourceWindow, aspectRatio) {
    mediaPipAspectRatio = normalizeAspectRatio(aspectRatio);
    const display = getMediaPipDisplay(sourceWindow);
    const workArea = display.workArea || display.bounds;
    const bounds = fitPipBounds(
        getConfig().interfaceTweaks.mediaPipBounds,
        workArea,
        mediaPipAspectRatio
    );
    const minimum = getPipOuterSize(workArea, mediaPipAspectRatio, 1);
    const maximum = getPipOuterSize(workArea, mediaPipAspectRatio, Number.MAX_SAFE_INTEGER);
    viewerWindow.setMinimumSize(minimum.width, minimum.height);
    viewerWindow.setMaximumSize(maximum.width, maximum.height);
    setMediaPipBounds(viewerWindow, bounds);
}

function handleMediaPipResize(event, proposedBounds, details) {
    if (!mediaPipWindow || mediaPipWindow.isDestroyed()) {
        return;
    }
    const current = mediaPipWindow.getBounds();
    const display = screen.getDisplayMatching(current);
    const workArea = display.workArea || display.bounds;
    const bounds = constrainPipResize(
        current,
        proposedBounds,
        details?.edge,
        workArea,
        mediaPipAspectRatio
    );
    if (!bounds) {
        return;
    }
    event.preventDefault();
    setMediaPipBounds(mediaPipWindow, bounds);
    scheduleMediaPipBoundsSave();
}

function snapMediaPipWindow() {
    if (mediaPipDragging || !mediaPipWindow || mediaPipWindow.isDestroyed()) {
        return;
    }
    const current = mediaPipWindow.getBounds();
    const display = screen.getDisplayMatching(current);
    const snapped = snapPipBounds(current, display.workArea || display.bounds);
    if (snapped && (snapped.x !== current.x || snapped.y !== current.y)) {
        setMediaPipBounds(mediaPipWindow, snapped);
    }
    scheduleMediaPipBoundsSave();
}

async function ensureMediaPipWindow(sourceWindow, aspectRatio) {
    if (mediaPipWindow && !mediaPipWindow.isDestroyed()) {
        await mediaPipWindowReady;
        configureMediaPipGeometry(mediaPipWindow, sourceWindow, aspectRatio);
        return mediaPipWindow;
    }
    const display = getMediaPipDisplay(sourceWindow);
    const initialBounds = fitPipBounds(
        getConfig().interfaceTweaks.mediaPipBounds,
        display.workArea || display.bounds,
        aspectRatio
    );
    const viewerWindow = new BrowserWindow({
        ...initialBounds,
        show: false,
        frame: false,
        transparent: true,
        resizable: true,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        focusable: false,
        hasShadow: false,
        backgroundColor: '#00000000',
        title: `${PLUGIN_NAME} - 画中画`,
        webPreferences: {
            preload: path.join(__dirname, 'media-pip-preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false
        }
    });
    mediaPipWindow = viewerWindow;
    mediaPipWindowReady = viewerWindow.loadFile(path.join(__dirname, 'media-pip.html'));
    viewerWindow.setMenuBarVisibility(false);
    viewerWindow.on('will-resize', handleMediaPipResize);
    viewerWindow.on('resize', scheduleMediaPipBoundsSave);
    viewerWindow.on('move', scheduleMediaPipBoundsSave);
    viewerWindow.on('moved', snapMediaPipWindow);
    viewerWindow.on('closed', () => {
        if (mediaPipWindow === viewerWindow) {
            mediaPipDragging = false;
            mediaPipDragOrigin = null;
            endMediaPipNativeMove();
            mediaPipWindow = null;
            mediaPipWindowReady = null;
            clearMediaPipSession();
        }
    });
    try {
        await mediaPipWindowReady;
        configureMediaPipGeometry(viewerWindow, sourceWindow, aspectRatio);
    } catch (error) {
        if (!viewerWindow.isDestroyed()) {
            viewerWindow.destroy();
        }
        throw error;
    }
    return viewerWindow;
}

function getMediaViewerSourceWindow(galleryId = '') {
    const sourceWindow = mediaViewerSession.get(null, normalizeText(galleryId))?.sourceWindow;
    if (!sourceWindow || sourceWindow.isDestroyed() || sourceWindow.webContents.isDestroyed()) {
        return null;
    }
    return sourceWindow;
}

function getMediaViewerPublicState() {
    const state = mediaViewerSession.getPublicState(
        getInterfaceTweaksConfig()?.inlineMediaBackground || 'black'
    );
    return {
        ...state,
        qrScanEnabled: getInterfaceTweaksConfig()?.activeQrScan === true
    };
}

function sendMediaViewerState(payload = getMediaViewerPublicState()) {
    if (!mediaViewerWindow || mediaViewerWindow.isDestroyed() ||
        mediaViewerWindow.webContents.isDestroyed()) {
        return false;
    }
    mediaViewerWindow.webContents.send(CHANNEL_MEDIA_VIEWER_STATE_CHANGED, payload);
    return true;
}

function waitForMediaViewerPresentation(presentationId) {
    pendingMediaViewerPresentation?.finish(false);
    return new Promise(resolve => {
        const entry = {
            presentationId,
            timer: null,
            finish(value) {
                if (pendingMediaViewerPresentation === entry) {
                    pendingMediaViewerPresentation = null;
                }
                clearTimeout(entry.timer);
                resolve(value === true);
            }
        };
        entry.timer = setTimeout(() => entry.finish(false), MEDIA_VIEWER_PRESENT_TIMEOUT_MS);
        entry.timer.unref?.();
        pendingMediaViewerPresentation = entry;
    });
}

function completeMediaViewerPresentation(presentationId) {
    const entry = pendingMediaViewerPresentation;
    if (!entry || entry.presentationId !== normalizeText(presentationId)) {
        return false;
    }
    entry.finish(true);
    return true;
}

function clearMediaViewerSession() {
    mediaViewerSession.clearAll();
}

async function hideMediaViewer() {
    if (!mediaViewerWindow || mediaViewerWindow.isDestroyed()) {
        return false;
    }
    const viewerWindow = mediaViewerWindow;
    const visibilityRevision = ++mediaViewerVisibilityRevision;
    const presentationId = crypto.randomUUID();
    const cleared = waitForMediaViewerPresentation(presentationId);
    if (process.platform === 'win32') {
        viewerWindow.setOpacity(0);
        viewerWindow.setIgnoreMouseEvents(true);
    }
    sendMediaViewerState({ hidden: true, presentationId });
    const didClear = await cleared;
    if (visibilityRevision !== mediaViewerVisibilityRevision ||
        viewerWindow !== mediaViewerWindow || viewerWindow.isDestroyed()) {
        return false;
    }
    viewerWindow.hide();
    return didClear;
}

function syncMediaViewerConfig() {
    if (!isInlineMediaViewerEnabled()) {
        mediaPipSession.sticky = false;
        hideMediaViewer();
        closeMediaPipSession();
        clearMediaViewerSession();
        return;
    }
    if (mediaViewerWindow?.isVisible()) {
        sendMediaViewerState();
    }
}

function getMediaViewerDisplay(sourceWindow) {
    try {
        return screen.getDisplayMatching(sourceWindow.getBounds());
    } catch {
        return screen.getPrimaryDisplay();
    }
}

async function positionMediaViewerWindow(viewerWindow, sourceWindow) {
    const display = getMediaViewerDisplay(sourceWindow);
    if (viewerWindow.isDestroyed()) {
        return;
    }
    const currentDisplay = screen.getDisplayMatching(viewerWindow.getBounds());
    if (viewerWindow.isFullScreen() && currentDisplay.id === display.id) {
        return;
    }
    if (viewerWindow.isFullScreen()) {
        viewerWindow.setFullScreen(false);
    }
    viewerWindow.setBounds(display.bounds);
    viewerWindow.setFullScreen(true);
}

async function ensureMediaViewerWindow(sourceWindow) {
    if (mediaViewerWindow && !mediaViewerWindow.isDestroyed()) {
        await mediaViewerWindowReady;
        await positionMediaViewerWindow(mediaViewerWindow, sourceWindow);
        return mediaViewerWindow;
    }
    const display = getMediaViewerDisplay(sourceWindow);
    const viewerWindow = new BrowserWindow({
        ...display.bounds,
        show: false,
        frame: false,
        resizable: false,
        maximizable: false,
        thickFrame: false,
        transparent: true,
        skipTaskbar: true,
        fullscreen: false,
        fullscreenable: true,
        autoHideMenuBar: true,
        backgroundColor: '#00000000',
        title: `${PLUGIN_NAME} - 媒体预览`,
        webPreferences: {
            preload: path.join(__dirname, 'media-viewer-preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    mediaViewerWindow = viewerWindow;
    viewerWindow.setMenuBarVisibility(false);
    if (process.platform === 'win32') {
        // A sub-255 opacity gives Chromium an explicit layered window, so it
        // does not pause windows visible through the translucent backdrop.
        viewerWindow.setOpacity(WINDOWS_MEDIA_VIEWER_OPACITY);
    }
    mediaViewerWindowReady = viewerWindow.loadFile(path.join(__dirname, 'media-viewer.html'));
    viewerWindow.on('minimize', () => sendMediaViewerState({ hidden: true }));
    viewerWindow.on('restore', () => sendMediaViewerState());
    viewerWindow.on('closed', () => {
        if (mediaViewerWindow === viewerWindow) {
            mediaViewerWindow = null;
            mediaViewerWindowReady = null;
            pendingMediaViewerPresentation?.finish(false);
            clearMediaViewerSession();
        }
    });
    try {
        await mediaViewerWindowReady;
        await positionMediaViewerWindow(viewerWindow, sourceWindow);
    } catch (error) {
        if (!viewerWindow.isDestroyed()) {
            viewerWindow.destroy();
        }
        throw error;
    }
    return viewerWindow;
}

function bindMediaViewerSourceWindow(sourceWindow) {
    const sourceState = getWindowState(sourceWindow);
    if (sourceState.mediaViewerCloseBound) {
        return;
    }
    sourceState.mediaViewerCloseBound = true;
    sourceWindow.once('closed', () => {
        if (mediaViewerSession.get(sourceWindow)) {
            hideMediaViewer();
            mediaViewerSession.clear(sourceWindow);
        }
        mediaViewerSession.clearStagedForward(sourceWindow);
        mediaDownloadTasks.clear(sourceWindow, new Error('The source window closed.'));
        if (mediaPipSession.active?.sourceWindow === sourceWindow) {
            closeMediaPipSession();
        }
    });
}

async function activateMediaViewerWindow(viewerWindow, stateOverrides = null) {
    mediaViewerVisibilityRevision += 1;
    const state = getMediaViewerPublicState();
    const presentationId = crypto.randomUUID();
    const presented = waitForMediaViewerPresentation(presentationId);
    if (process.platform === 'win32') {
        viewerWindow.setOpacity(0);
        viewerWindow.setIgnoreMouseEvents(true);
    }
    sendMediaViewerState({
        ...state,
        ...stateOverrides,
        presentationId
    });
    if (viewerWindow.isMinimized()) {
        viewerWindow.restore();
    }
    viewerWindow.showInactive();
    const didPresent = await presented;
    if (viewerWindow.isDestroyed() ||
        mediaViewerSession.get()?.gallery.id !== state.galleryId) {
        return false;
    }
    if (!didPresent) {
        viewerWindow.hide();
        throw new Error('Media viewer did not commit its first frame.');
    }
    if (!viewerWindow.isVisible()) {
        return false;
    }
    if (process.platform === 'win32') {
        viewerWindow.setOpacity(WINDOWS_MEDIA_VIEWER_OPACITY);
        viewerWindow.setIgnoreMouseEvents(false);
    }
    viewerWindow.show();
    viewerWindow.focus();
    viewerWindow.webContents.focus();
    return true;
}

async function presentMediaViewer(sourceWindow) {
    let session = mediaViewerSession.get(sourceWindow);
    if (!session) {
        return false;
    }
    const selection = mediaViewerSession.getSelection(
        sourceWindow,
        session.gallery.id,
        session.gallery.index
    );
    if (selection && await openMediaPipForStickyMode(selection)) {
        return true;
    }
    const viewerWindow = await ensureMediaViewerWindow(sourceWindow);
    session = mediaViewerSession.get(sourceWindow, session.gallery.id);
    if (!session) {
        return false;
    }
    return await activateMediaViewerWindow(viewerWindow);
}

function isInlineMediaHost(browserWindow) {
    if (!browserWindow || browserWindow.isDestroyed() || browserWindow.webContents.isDestroyed()) {
        return false;
    }
    const url = browserWindow.webContents.getURL();
    return ['#/main/message', '#/chat', '#/forward', '#/record'].some(route => url.includes(route));
}

function getInlineMediaExpectedSize(item) {
    const size = Number(item?.fileSize);
    return Number.isSafeInteger(size) && size > 0 ? size : 0;
}

function isDecodableInlineImage(filePath) {
    try {
        const image = nativeImage.createFromPath(filePath);
        const size = image?.getSize?.();
        return Boolean(!image?.isEmpty?.() && size?.width > 0 && size?.height > 0);
    } catch {
        return false;
    }
}

function getReadyInlineMediaPath(item) {
    const filePath = getAbsoluteFilePathCandidate([item?.filePath]);
    if (!filePath) {
        return '';
    }
    try {
        const stat = fsSync.statSync(filePath);
        const expectedSize = getInlineMediaExpectedSize(item);
        const ready = stat.isFile() && stat.size > 0 && (
            !expectedSize || stat.size >= expectedSize ||
            item?.type === 'image' && isDecodableInlineImage(filePath)
        );
        return ready
            ? filePath
            : '';
    } catch {
        return '';
    }
}

function isInlineMediaItemAvailable(item) {
    return isInlineMediaItemSupported(item) && Boolean(
        getReadyInlineMediaPath(item) ||
        normalizeInlineMediaSourceUrl(item?.sourceUrl)
    );
}

function canResolveInlineMediaItem(item) {
    return isInlineMediaItemSupported(item) && Boolean(createInlineMediaDownloadPayload(item));
}

function canOpenInlineMediaItem(item) {
    return isInlineMediaItemSupported(item) && (
        isInlineMediaItemAvailable(item) || canResolveInlineMediaItem(item) || item?.pendingFile === true
    );
}

function canListInlineMediaItem(item) {
    return isInlineMediaItemSupported(item) && Boolean(
        getAbsoluteFilePathCandidate([item?.filePath]) ||
        normalizeInlineMediaSourceUrl(item?.sourceUrl) ||
        canResolveInlineMediaItem(item) ||
        item?.pendingFile === true
    );
}

async function createMediaViewerDisplayItem(item) {
    const localPath = getReadyInlineMediaPath(item);
    const sourceUrl = normalizeInlineMediaSourceUrl(item.sourceUrl);
    const needsResolve = !localPath && (item.pendingFile === true || canResolveInlineMediaItem(item));
    const previewPath = getExistingFilePath([item.previewSource]);
    const previewUrl = previewPath ? '' : normalizeInlineMediaSourceUrl(item.previewSource);
    const src = localPath ? await inlineMediaServer.getUrl(localPath) : sourceUrl;
    return {
        id: getInlineMediaItemKey(item),
        type: item.type,
        src,
        previewSrc: previewPath ? await inlineMediaServer.getUrl(previewPath) : previewUrl,
        name: item.name,
        ...(item.senderName ? { senderName: item.senderName } : {}),
        ...(item.timestamp ? { timestamp: item.timestamp } : {}),
        canJump: Boolean(item.identity?.chatType && item.identity?.peerUid && item.identity?.msgId),
        needsResolve
    };
}

function createDeferredMediaViewerDisplayItem(item) {
    const sourceUrl = normalizeInlineMediaSourceUrl(item?.sourceUrl);
    const previewUrl = normalizeInlineMediaSourceUrl(item?.previewSource);
    return {
        id: getInlineMediaItemKey(item),
        type: item.type,
        src: sourceUrl,
        previewSrc: previewUrl,
        name: item.name,
        ...(item.senderName ? { senderName: item.senderName } : {}),
        ...(item.timestamp ? { timestamp: item.timestamp } : {}),
        canJump: Boolean(item.identity?.chatType && item.identity?.peerUid && item.identity?.msgId),
        needsResolve: !sourceUrl || canResolveInlineMediaItem(item)
    };
}

async function showMediaViewer(browserWindow, gallery, options = {}) {
    let session = null;
    try {
        recordDiagnostic('info', 'media.preview-build-started', {
            itemCount: Array.isArray(gallery?.items) ? gallery.items.length : 0,
            selectedIndex: Number(gallery?.index)
        });
        gallery = completeInlineMediaGallery(browserWindow, gallery);
        const selected = gallery?.items?.[gallery.index];
        if (!selected) {
            recordDiagnostic('info', 'media.preview-skipped', {
                reason: 'invalid-selection'
            });
            return false;
        }
        if (!browserWindow || browserWindow.isDestroyed() || browserWindow.webContents.isDestroyed()) {
            return false;
        }
        const selectedKey = getInlineMediaItemKey(selected);
        const items = gallery.items.filter(canListInlineMediaItem);
        const index = items.findIndex(item => getInlineMediaItemKey(item) === selectedKey);
        if (index < 0) {
            recordDiagnostic('info', 'media.preview-skipped', {
                reason: 'selected-media-not-ready'
            });
            return false;
        }
        session = mediaViewerSession.begin(browserWindow, { items, index }, {
            nativeFallback: options.nativeFallback
        });
        if (!session) {
            return false;
        }
        bindMediaViewerSourceWindow(browserWindow);
        closeExistingMediaViewers(browserWindow.webContents);
        const previewItems = items.map(createDeferredMediaViewerDisplayItem);
        previewItems[index] = await createMediaViewerDisplayItem(items[index]);
        if (!mediaViewerSession.setViewerItems(session, previewItems)) {
            return true;
        }
        const selectedIndex = session.gallery.index;
        const selectedItem = session.gallery.items[selectedIndex];
        if (previewItems[selectedIndex]?.needsResolve && selectedItem?.pendingFile !== true) {
            // Start QQ's manual download while its chat window still owns focus.
            downloadInlineMedia(browserWindow, selectedItem, {
                triggerType: 0,
                source: 'chat'
            })?.catch(() => {});
        }
        if (options.deferPresentation !== true) {
            await presentMediaViewer(browserWindow);
        }
        recordDiagnostic('info', 'media.preview-build-completed', {
            itemCount: previewItems.length,
            selectedIndex,
            selectedSource: previewItems[selectedIndex]?.needsResolve
                ? 'unresolved'
                : previewItems[selectedIndex]?.src?.startsWith('http://127.0.0.1:')
                    ? 'local'
                    : 'resource',
            unresolvedItems: previewItems.filter(item => item.needsResolve).length
        });
        return true;
    } catch (error) {
        if (session && mediaViewerSession.get(browserWindow, session.gallery.id) === session) {
            hideMediaViewer();
            mediaViewerSession.clear(browserWindow);
        }
        recordDiagnostic('error', 'media.preview-build-failed', {
            reason: error?.message || String(error)
        });
        throw error;
    }
}

function findInlineMediaDownloadInfo(value, item) {
    const msgId = normalizeText(item?.identity?.msgId);
    const elementId = normalizeText(item?.identity?.elementId);
    if (!msgId || !elementId) {
        return null;
    }
    return findIpcObject(value, candidate =>
        normalizeText(candidate?.msgId) === msgId &&
        normalizeText(candidate?.msgElementId || candidate?.elementId) === elementId &&
        (candidate?.filePath !== undefined || candidate?.fileErrCode !== undefined)
    );
}

async function hasCompleteIsoMediaStructure(filePath, fileSize) {
    if (!['.m4v', '.mov', '.mp4'].includes(path.extname(filePath).toLowerCase()) || fileSize < 8) {
        return false;
    }
    const handle = await fs.open(filePath, 'r');
    const header = Buffer.alloc(16);
    let offset = 0;
    let hasMovie = false;
    let hasMediaData = false;
    try {
        while (offset + 8 <= fileSize) {
            const { bytesRead } = await handle.read(header, 0, 16, offset);
            if (bytesRead < 8) {
                return false;
            }
            let boxSize = header.readUInt32BE(0);
            let headerSize = 8;
            if (boxSize === 1) {
                if (bytesRead < 16) {
                    return false;
                }
                const extendedSize = header.readBigUInt64BE(8);
                if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) {
                    return false;
                }
                boxSize = Number(extendedSize);
                headerSize = 16;
            } else if (boxSize === 0) {
                boxSize = fileSize - offset;
            }
            if (boxSize < headerSize || boxSize > fileSize - offset) {
                return false;
            }
            const boxType = header.toString('ascii', 4, 8);
            hasMovie ||= boxType === 'moov';
            hasMediaData ||= boxType === 'mdat';
            offset += boxSize;
        }
        return offset === fileSize && hasMovie && hasMediaData;
    } finally {
        await handle.close();
    }
}

async function waitForCompletedInlineMediaFile(browserWindow, item, filePath, expectedSize, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (browserWindow.isDestroyed() || browserWindow.webContents.isDestroyed()) {
            throw new Error('The source window closed before the media file became available.');
        }
        try {
            const stat = await fs.stat(filePath);
            if (stat.isFile() && stat.size > 0) {
                if (!expectedSize || stat.size >= expectedSize) {
                    return filePath;
                }
                const validation = item?.type === 'image' && isDecodableInlineImage(filePath)
                    ? 'decoded-image'
                    : item?.type === 'video' && await hasCompleteIsoMediaStructure(filePath, stat.size)
                        ? 'complete-video'
                        : '';
                if (validation) {
                    recordDiagnostic('info', 'media.download-size-mismatch-accepted', {
                        type: item.type,
                        fileName: path.basename(filePath),
                        expectedSize,
                        observedSize: stat.size,
                        validation
                    });
                    return filePath;
                }
            }
        } catch {
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('QQ reported a completed media download, but the file is incomplete.');
}

function resolveInlineMediaDownload(browserWindow, item, options) {
    const key = getInlineMediaItemKey(item);
    const current = mediaDownloadTasks.get(browserWindow, 'rich', key);
    if (current) {
        return current.promise;
    }
    const deadline = Date.now() + (options.timeoutMs || 65 * 1000);
    const waiter = createNativeEventWaiter(browserWindow, (response, result) => {
        const cmdName = normalizeText(result?.cmdName || response?.cmdName);
        return /nodeIKernelMsgListener\/onRichMediaDownloadComplete$/i.test(cmdName) &&
            Boolean(findInlineMediaDownloadInfo(result, item) || findInlineMediaDownloadInfo(response, item));
    }, Math.max(1, deadline - Date.now()));
    const entry = {
        promise: null,
        cancel: error => waiter.cancel(error)
    };
    entry.promise = (async () => {
        try {
            recordDiagnostic('info', 'media.download-requested', {
                type: item.type,
                source: options.source,
                method: options.method
            });
            await options.start();
            const event = await waiter.promise;
            const info = findInlineMediaDownloadInfo(event, item);
            if (!info) {
                throw new Error('QQ completed a different media download.');
            }
            const errorCode = Number(info.fileErrCode);
            if (Number.isFinite(errorCode) && errorCode !== 0) {
                throw new Error(`QQ media download failed: ${info.fileErrMsg || errorCode}`);
            }
            const filePath = getAbsoluteFilePathCandidate([
                info.filePath,
                info.commonFileInfo?.filePath
            ]);
            if (!filePath) {
                throw new Error('QQ completed the media download without a local path.');
            }
            const eventSize = Number(info.totalSize || info.commonFileInfo?.fileSize);
            const expectedSize = Number.isSafeInteger(eventSize) && eventSize > 0
                ? eventSize
                : getInlineMediaExpectedSize(item);
            let observedSize = 0;
            try {
                observedSize = (await fs.stat(filePath)).size;
            } catch {
            }
            recordDiagnostic('info', 'media.download-complete-signaled', {
                type: item.type,
                source: options.source,
                fileName: path.basename(filePath),
                expectedSize,
                observedSize
            });
            await waitForCompletedInlineMediaFile(
                browserWindow,
                item,
                filePath,
                expectedSize,
                Math.max(1, deadline - Date.now())
            );
            item.filePath = filePath;
            try {
                item.fileSize = (await fs.stat(filePath)).size;
            } catch {
            }
            recordDiagnostic('info', 'media.download-resolved', {
                type: item.type,
                source: options.source
            });
            return filePath;
        } catch (error) {
            recordDiagnostic('warn', 'media.download-failed', {
                type: item.type,
                source: options.source,
                error: error?.message || String(error)
            });
            throw error;
        } finally {
            waiter.cancel();
        }
    })();
    mediaDownloadTasks.set(browserWindow, 'rich', key, entry);
    entry.promise.catch(() => {});
    return entry.promise;
}

function downloadInlineMedia(browserWindow, item, options = {}) {
    const triggerType = Number(options.triggerType) === 1 ? 1 : 0;
    const payload = createInlineMediaDownloadPayload(item, triggerType);
    if (!payload) {
        return null;
    }
    return resolveInlineMediaDownload(browserWindow, item, {
        source: options.source || 'chat',
        method: 'downloadRichMedia',
        start: () => qqNativeInvoke(
            browserWindow,
            'ntApi',
            'nodeIKernelMsgService/downloadRichMedia',
            payload,
            false
        )
    });
}

function watchInlineMediaDownload(browserWindow, item, options = {}) {
    return resolveInlineMediaDownload(browserWindow, item, {
        source: options.source || 'forward',
        method: options.method || 'native-click',
        start: async () => {}
    });
}

function openForwardMediaViewerFromDownloadRequest(browserWindow, command) {
    if (!isInlineMediaViewerEnabled() ||
        getWindowRoute(browserWindow?.webContents?.getURL()) !== 'forward' ||
        !/nodeIKernelMsgService\/downloadRichMedia$/i.test(normalizeText(command?.cmdName))) {
        return false;
    }
    const firstArgument = Array.isArray(command.payload) ? command.payload[0] : command.payload;
    const request = firstArgument?.getReq;
    if (Number(request?.triggerType) !== 0) {
        return false;
    }
    const filePath = getAbsoluteFilePathCandidate([request?.filePath]);
    const item = normalizeInlineMediaOpenItem({
        type: classifyMediaFilePath(filePath),
        filePath,
        name: path.basename(filePath),
        identity: {
            chatType: request?.chatType,
            peerUid: request?.peerUid,
            msgId: request?.msgId,
            elementId: request?.elementId
        }
    });
    if (item?.type !== 'video' || !isInlineMediaItemSupported(item)) {
        return false;
    }
    watchInlineMediaDownload(browserWindow, item, {
        source: 'forward',
        method: 'native-request'
    })?.catch(() => {});
    const stagedGallery = mediaViewerSession.consumeStagedForward(browserWindow, item);
    if (stagedGallery) {
        showMediaViewer(browserWindow, stagedGallery)
            .catch(error => warn('forward media viewer failed:', error?.message || error));
        return true;
    }
    const activeSession = mediaViewerSession.get(browserWindow);
    if (activeSession?.gallery.items.some(candidate => isSameInlineMediaItem(candidate, item))) {
        return true;
    }
    showMediaViewer(browserWindow, { items: [item], index: 0 })
        .catch(error => warn('forward media viewer failed:', error?.message || error));
    return true;
}

function createPendingInlineFileDownload() {
    let resolvePromise;
    let rejectPromise;
    let settled = false;
    let timer = null;
    const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });
    const finish = (error, filePath = '') => {
        if (settled) {
            return;
        }
        settled = true;
        clearTimeout(timer);
        if (error) {
            rejectPromise(error);
        } else {
            resolvePromise(filePath);
        }
    };
    timer = setTimeout(() => finish(new Error('Timed out waiting for QQ file download.')), 65 * 1000);
    promise.catch(() => {});
    return {
        bound: false,
        promise,
        reject: error => finish(error),
        resolve: filePath => finish(null, filePath)
    };
}

function getFileAssistantDownloadIds(payload) {
    const values = Array.isArray(payload?.[0]) ? payload[0] : [payload?.[0]];
    return values.map(value => normalizeText(value?.id ?? value)).filter(Boolean);
}

function getFileAssistantStatus(result, fileIds) {
    return findIpcObject(result?.payload, value =>
        fileIds.includes(normalizeText(value?.id)) && value?.fileStatus !== undefined
    );
}

function bindPendingInlineFileDownload(browserWindow, command) {
    if (!/nodeIKernelFileAssistantService\/downloadFile$/i.test(normalizeText(command?.cmdName))) {
        return;
    }
    const session = mediaViewerSession.get(browserWindow);
    const item = session?.gallery.items?.[session.gallery.index];
    const itemKey = getInlineMediaItemKey(item);
    const pending = mediaDownloadTasks.get(browserWindow, 'file', itemKey);
    const fileIds = getFileAssistantDownloadIds(command.payload);
    if (!pending || pending.bound || !fileIds.length) {
        return;
    }
    pending.bound = true;
    recordDiagnostic('info', 'media.file-download-bound', { fileCount: fileIds.length });
    const waiter = createNativeEventWaiter(browserWindow, (_response, result) => {
        if (!/nodeIKernelFileAssistantListener\/onFileStatusChanged$/i.test(normalizeText(result?.cmdName))) {
            return false;
        }
        const status = getFileAssistantStatus(result, fileIds);
        return Number(status?.fileStatus) === 2 && normalizeText(status?.fileProgress) === '0' &&
            Boolean(getAbsoluteFilePathCandidate([status?.filePath]));
    }, 60 * 1000);
    pending.cancel = error => waiter.cancel(error);
    presentMediaViewer(browserWindow)
        .catch(error => warn('pending file media viewer failed:', error?.message || error));
    waiter.promise.then(result => {
        const status = getFileAssistantStatus(result, fileIds);
        const filePath = getAbsoluteFilePathCandidate([status?.filePath]);
        if (!filePath) {
            throw new Error('QQ file download completed without a local path.');
        }
        item.filePath = filePath;
        item.pendingFile = false;
        recordDiagnostic('info', 'media.file-download-resolved');
        pending.resolve(filePath);
    }).catch(error => {
        recordDiagnostic('warn', 'media.file-download-failed', {
            error: error?.message || String(error)
        });
        pending.reject(error);
    });
}

async function prepareMediaViewerItem(browserWindow, payload) {
    if (!isInlineMediaViewerEnabled() || !browserWindow || browserWindow.isDestroyed() ||
        browserWindow.webContents.isDestroyed()) {
        return null;
    }
    const index = Number(payload?.index);
    const selection = mediaViewerSession.getSelection(
        browserWindow,
        normalizeText(payload?.galleryId),
        index
    );
    if (!selection) {
        return null;
    }
    const { gallery, item } = selection;
    const finalize = result => {
        if (result) {
            mediaViewerSession.patchViewerItem(
                browserWindow,
                gallery.id,
                index,
                { ...result, needsResolve: false }
            );
        }
        return result;
    };
    const itemKey = getInlineMediaItemKey(item);
    const pendingFile = mediaDownloadTasks.get(browserWindow, 'file', itemKey);
    if (item.pendingFile === true && pendingFile) {
        const filePath = await pendingFile.promise;
        return finalize({
            type: item.type,
            src: await inlineMediaServer.getUrl(filePath),
            name: item.name
        });
    }
    const existingPath = getReadyInlineMediaPath(item);
    if (existingPath) {
        return finalize({
            type: item.type,
            src: await inlineMediaServer.getUrl(existingPath),
            name: item.name
        });
    }
    const preload = payload?.preload === true;
    if (preload && item.type === 'video') {
        return null;
    }
    const pendingDownload = mediaDownloadTasks.get(browserWindow, 'rich', itemKey);
    const downloadedPath = pendingDownload
        ? await pendingDownload.promise
        : await downloadInlineMedia(browserWindow, item, {
            triggerType: preload ? 1 : 0,
            source: preload ? 'preload' : 'chat'
        });
    if (downloadedPath) {
        return finalize({
            type: item.type,
            src: await inlineMediaServer.getUrl(downloadedPath),
            name: item.name
        });
    }
    const sourceUrl = normalizeInlineMediaSourceUrl(item.sourceUrl);
    return sourceUrl ? finalize({
        type: item.type,
        src: sourceUrl,
        name: item.name
    }) : null;
}

function getMediaViewerSelection(payload) {
    const sourceWindow = getMediaViewerSourceWindow(payload?.galleryId);
    return sourceWindow
        ? mediaViewerSession.getSelection(sourceWindow, normalizeText(payload?.galleryId), payload?.index)
        : null;
}

async function resolveMediaViewerLocalFile(selection) {
    let filePath = getExistingFilePath([selection.item.filePath]);
    if (filePath) {
        return filePath;
    }
    await prepareMediaViewerItem(selection.sourceWindow, {
        galleryId: selection.gallery.id,
        index: selection.index
    });
    filePath = getExistingFilePath([selection.item.filePath]);
    return filePath;
}

async function saveMediaViewerItem(selection) {
    const sourcePath = await resolveMediaViewerLocalFile(selection);
    if (!sourcePath) {
        return { ok: false, message: '媒体尚未保存到本地' };
    }
    const fileName = path.basename(normalizeText(selection.item.name) || sourcePath);
    const result = await dialog.showSaveDialog(mediaViewerWindow, {
        title: '另存为',
        defaultPath: path.join(app.getPath('downloads'), fileName)
    });
    if (result.canceled || !result.filePath) {
        return { ok: false, canceled: true };
    }
    if (normalizeComparablePath(result.filePath) !== normalizeComparablePath(sourcePath)) {
        await fs.copyFile(sourcePath, result.filePath);
    }
    return { ok: true, message: '已保存' };
}

async function copyMediaViewerImage(selection) {
    if (selection.item.type !== 'image') {
        return { ok: false };
    }
    const filePath = await resolveMediaViewerLocalFile(selection);
    const sourceUrl = normalizeInlineMediaSourceUrl(selection.item.sourceUrl);
    const image = filePath
        ? nativeImage.createFromPath(filePath)
        : /^data:image\//i.test(sourceUrl)
            ? nativeImage.createFromDataURL(sourceUrl)
            : null;
    if (!image || image.isEmpty()) {
        return { ok: false, message: '图片尚未保存到本地' };
    }
    clipboard.writeImage(image);
    return { ok: true, message: '已复制' };
}

async function jumpToMediaViewerMessage(selection) {
    const identity = selection.item.identity || {};
    const peerUid = normalizeText(identity.peerUid);
    const msgId = normalizeText(identity.msgId);
    const chatType = Number(identity.chatType);
    if (!peerUid || !msgId || !chatType) {
        return { ok: false, message: '无法定位这条消息' };
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
    const sourceWindow = selection.sourceWindow;
    hideMediaViewer();
    if (sourceWindow.isMinimized()) {
        sourceWindow.restore();
    }
    sourceWindow.show();
    sourceWindow.focus();
    sourceWindow.webContents.focus();
    const source = `(() => { const channel = new BroadcastChannel('MainWindow'); channel.postMessage(${JSON.stringify(command)}); channel.close(); return true; })()`;
    await sourceWindow.webContents.executeJavaScript(source, true);
    return { ok: true };
}

async function openMediaPip(selection, payload) {
    const item = selection.viewerItem;
    if (item?.type !== 'video' || !normalizeInlineMediaSourceUrl(item.src)) {
        return { ok: false };
    }
    const videoWidth = Number(payload?.videoWidth);
    const videoHeight = Number(payload?.videoHeight);
    const aspectRatio = videoWidth > 0 && videoHeight > 0
        ? videoWidth / videoHeight
        : 16 / 9;
    mediaPipSession.active = {
        sourceWindow: selection.sourceWindow,
        gallery: cloneMediaViewerGallery(selection.gallery, selection.index),
        viewerItems: selection.session.viewerItems.map(viewerItem => ({ ...viewerItem })),
        playback: normalizeMediaPlaybackState(payload?.playback)
    };
    let pipWindow;
    try {
        pipWindow = await ensureMediaPipWindow(selection.sourceWindow, aspectRatio);
    } catch (error) {
        clearMediaPipSession();
        throw error;
    }
    mediaPipSession.sticky = true;
    sendMediaPipState();
    hideMediaViewer();
    pipWindow.showInactive();
    pipWindow.setAlwaysOnTop(
        true,
        process.platform === 'win32' ? 'pop-up-menu' : 'floating'
    );
    pipWindow.moveTop();
    return { ok: true };
}

async function openMediaPipForStickyMode(selection) {
    let item = selection.viewerItem;
    if (!mediaPipSession.sticky || item?.type !== 'video') {
        return false;
    }
    try {
        if (!normalizeInlineMediaSourceUrl(item.src) && item.needsResolve) {
            await prepareMediaViewerItem(selection.sourceWindow, {
                galleryId: selection.gallery.id,
                index: selection.index
            });
            selection = getMediaViewerSelection({
                galleryId: selection.gallery.id,
                index: selection.index
            });
            item = selection?.viewerItem;
        }
        if (!selection || item?.type !== 'video' || !normalizeInlineMediaSourceUrl(item.src)) {
            return false;
        }
        const result = await openMediaPip(selection, {
            playback: { paused: false }
        });
        return result.ok === true;
    } catch (error) {
        recordDiagnostic('warn', 'media.pip-auto-open-failed', {
            reason: error?.message || String(error)
        });
        return false;
    }
}

async function restoreMediaViewerFromPip(playback) {
    const pip = mediaPipSession.active;
    const sourceWindow = pip?.sourceWindow;
    const sessionGallery = pip?.gallery;
    const gallery = cloneMediaViewerGallery(sessionGallery);
    const viewerItems = pip?.viewerItems.map(item => ({ ...item })) || [];
    if (!sourceWindow || sourceWindow.isDestroyed() || sourceWindow.webContents.isDestroyed() ||
        !gallery.id || !viewerItems[gallery.index]) {
        closeMediaPipSession();
        return { ok: false };
    }
    playback = normalizeMediaPlaybackState(playback);
    const viewerWindow = await ensureMediaViewerWindow(sourceWindow);
    if (mediaPipSession.active !== pip) {
        return { ok: false };
    }
    const session = mediaViewerSession.begin(sourceWindow, gallery, { viewerItems });
    if (!session) {
        return { ok: false };
    }
    bindMediaViewerSourceWindow(sourceWindow);
    await activateMediaViewerWindow(viewerWindow, { playback });
    closeMediaPipSession();
    return { ok: true };
}

async function handleMediaPipAction(payload = {}) {
    const type = normalizeText(payload.type);
    const pip = mediaPipSession.active;
    const matchesSession = normalizeText(payload.galleryId) === pip?.gallery.id &&
        Number(payload.index) === pip?.gallery.index;
    if (!matchesSession) {
        return { ok: false };
    }
    if (type === 'close') {
        closeMediaPipSession();
        return { ok: true };
    }
    if (type === 'metadata') {
        const width = Number(payload.videoWidth);
        const height = Number(payload.videoHeight);
        if (!mediaPipWindow || mediaPipWindow.isDestroyed() ||
            !pip?.sourceWindow || width <= 0 || height <= 0) {
            return { ok: false };
        }
        configureMediaPipGeometry(mediaPipWindow, pip.sourceWindow, width / height);
        return { ok: true };
    }
    if (type === 'enlarge') {
        mediaPipSession.sticky = false;
        return await restoreMediaViewerFromPip(payload.playback);
    }
    return { ok: false };
}

async function handleMediaViewerAction(payload = {}) {
    const type = normalizeText(payload.type);
    if (type === 'presented') {
        return { ok: completeMediaViewerPresentation(payload.presentationId) };
    }
    if (type === 'close') {
        const hidden = hideMediaViewer();
        clearMediaViewerSession();
        await hidden;
        return { ok: true };
    }
    if (type === 'minimize') {
        mediaViewerWindow?.minimize();
        return { ok: true };
    }
    const selection = getMediaViewerSelection(payload);
    if (!selection) {
        return { ok: false };
    }
    if (type === 'select') {
        mediaViewerSession.select(
            selection.sourceWindow,
            selection.gallery.id,
            selection.index
        );
        await openMediaPipForStickyMode(selection);
        return { ok: true };
    }
    try {
        if (type === 'fallback-native') {
            const fallback = mediaViewerSession.takeNativeFallback(
                selection.sourceWindow,
                selection.gallery.id
            );
            return await openNativeMediaViewerFallback(
                selection.sourceWindow,
                fallback,
                selection.item.sourceIndex
            );
        }
        if (type === 'open-pip') {
            return await openMediaPip(selection, payload);
        }
        if (type === 'save') {
            return await saveMediaViewerItem(selection);
        }
        if (type === 'copy-image') {
            return await copyMediaViewerImage(selection);
        }
        if (type === 'scan-qr') {
            if (selection.item.type !== 'image') {
                return { ok: false };
            }
            return await scanQrCode(selection.sourceWindow, selection.item);
        }
        if (type === 'show-in-folder') {
            const filePath = await resolveMediaViewerLocalFile(selection);
            if (!filePath) {
                return { ok: false, message: '媒体尚未保存到本地' };
            }
            shell.showItemInFolder(filePath);
            return { ok: true };
        }
        if (type === 'open-external') {
            const filePath = await resolveMediaViewerLocalFile(selection);
            if (filePath) {
                const error = await shell.openPath(filePath);
                return error ? { ok: false, message: '无法打开媒体' } : { ok: true };
            }
            const sourceUrl = normalizeInlineMediaSourceUrl(selection.item.sourceUrl);
            if (/^https?:/i.test(sourceUrl)) {
                await shell.openExternal(sourceUrl);
                return { ok: true };
            }
            return { ok: false, message: '媒体尚未保存到本地' };
        }
        if (type === 'jump-to-message') {
            return await jumpToMediaViewerMessage(selection);
        }
    } catch (error) {
        if (type === 'jump-to-message' && !selection.sourceWindow.isDestroyed()) {
            await presentMediaViewer(selection.sourceWindow).catch(() => {});
        }
        recordDiagnostic('warn', 'media.viewer-action-failed', {
            type,
            reason: error?.message || String(error)
        });
        return { ok: false, message: '操作失败' };
    }
    return { ok: false };
}

async function selectExistingMediaViewerItem(browserWindow, item) {
    const session = mediaViewerSession.get(browserWindow);
    if (!session) {
        return false;
    }
    const index = mediaViewerSession.findItem(browserWindow, item);
    if (index < 0) {
        return false;
    }
    mediaViewerSession.select(browserWindow, session.gallery.id, index);
    if (session.viewerItems.length) {
        await presentMediaViewer(browserWindow);
    }
    return true;
}

async function openMediaViewerFromRenderer(browserWindow, payload) {
    const nativeFallback = { handled: false, activateNative: true };
    if (!isInlineMediaViewerEnabled() ||
        !browserWindow || browserWindow.isDestroyed() || browserWindow.webContents.isDestroyed()) {
        return nativeFallback;
    }
    const item = normalizeInlineMediaOpenItem(payload);
    if (!item || !isInlineMediaItemSupported(item)) {
        return nativeFallback;
    }
    const requestedItems = Array.isArray(payload?.gallery?.items)
        ? payload.gallery.items.map(normalizeInlineMediaOpenItem).filter(Boolean)
        : [];
    const requestedIndex = requestedItems.findIndex(candidate => isSameInlineMediaItem(candidate, item));
    if (item.pendingFile === true) {
        mediaDownloadTasks.replaceKind(
            browserWindow,
            'file',
            getInlineMediaItemKey(item),
            createPendingInlineFileDownload(),
            new Error('Pending file preview was replaced.')
        );
        const handled = await showMediaViewer(
            browserWindow,
            { items: [item], index: 0 },
            { deferPresentation: true }
        );
        return { handled, activateNative: true };
    }
    if (getWindowRoute(browserWindow.webContents.getURL()) === 'forward') {
        const gallery = requestedIndex >= 0
            ? { items: requestedItems, index: requestedIndex }
            : { items: [item], index: 0 };
        const handled = mediaViewerSession.stageForward(browserWindow, gallery);
        recordDiagnostic('info', 'media.forward-gallery-staged', {
            itemCount: gallery.items.length,
            selectedIndex: gallery.index
        });
        return { handled, activateNative: true };
    }
    if (requestedItems.length > 1 && requestedIndex >= 0) {
        const handled = await showMediaViewer(browserWindow, {
            items: requestedItems,
            index: requestedIndex
        });
        return { handled, activateNative: !handled };
    }
    if (await selectExistingMediaViewerItem(browserWindow, item)) {
        return { handled: true, activateNative: false };
    }
    mediaDownloadTasks.clearKind(
        browserWindow,
        'file',
        new Error('Pending file preview was replaced.')
    );
    if (!canOpenInlineMediaItem(item)) {
        return nativeFallback;
    }
    const handled = await showMediaViewer(browserWindow, { items: [item], index: 0 });
    return { handled, activateNative: !handled };
}

function buildNativeMediaViewerPayload(fallback, sourceIndex) {
    const payload = fallback?.payload;
    if (!Array.isArray(payload)) {
        return null;
    }
    const result = payload.slice();
    if (result[0] && typeof result[0] === 'object' && Number.isInteger(Number(sourceIndex))) {
        result[0] = { ...result[0], index: Number(sourceIndex) };
    }
    return result;
}

async function openNativeMediaViewerFallback(browserWindow, fallback, sourceIndex) {
    const payload = buildNativeMediaViewerPayload(fallback, sourceIndex);
    if (!payload || !browserWindow || browserWindow.isDestroyed() || browserWindow.webContents.isDestroyed()) {
        return { ok: false };
    }
    await qqNativeInvoke(
        browserWindow,
        'WindowApi',
        OPEN_MEDIA_VIEWER_COMMAND,
        payload,
        false
    );
    if (mediaViewerSession.get(browserWindow)) {
        hideMediaViewer();
        mediaViewerSession.clear(browserWindow);
    }
    recordDiagnostic('info', 'media.native-viewer-fallback', {
        selectedIndex: Number(sourceIndex) || 0
    });
    return { ok: true };
}

async function waitForEmojiImageFile(filePath, timeoutMs = 8000) {
    const candidate = normalizePathText(filePath);
    if (!candidate) {
        return '';
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const existing = getExistingFilePath([candidate]);
        if (existing) {
            return existing;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return '';
}

async function requestEmojiImageDownload(browserWindow, face, filePath) {
    const data = sanitizeMarketFaceData(face);
    if (!filePath || !data.emojiId || !data.key || !data.emojiPackageId) {
        return '';
    }
    try {
        await qqNativeInvoke(
            browserWindow,
            'ntApi',
            'nodeIKernelMsgService/fetchMarketEmoticonAioImage',
            [{
                marketEmoticonAioImageReq: {
                    eId: data.emojiId,
                    epId: data.emojiPackageId,
                    name: data.faceName,
                    width: data.imageWidth,
                    height: data.imageHeight,
                    jobType: 0,
                    encryptKey: data.key,
                    filePath,
                    downloadType: 4
                }
            }, undefined],
            false,
            10000
        );
    } catch (error) {
        recordDiagnostic('warn', 'emoji-image.download-request-failed', {
            error: error?.message || error
        });
        return '';
    }
    return await waitForEmojiImageFile(filePath);
}

async function openEmojiAsImageFromRenderer(browserWindow, payload) {
    if (getInterfaceTweaksConfig().openEmojiAsImage !== true) {
        return false;
    }
    if (!browserWindow || browserWindow.isDestroyed()) {
        return false;
    }
    const face = payload?.marketFace && typeof payload.marketFace === 'object'
        ? payload.marketFace
        : {};
    const sources = collectEmojiImageSources(face, Array.isArray(payload?.sources) ? payload.sources : []);
    let filePath = getExistingFilePath(sources.localPaths);
    if (!filePath && sources.localPaths[0]) {
        filePath = await requestEmojiImageDownload(browserWindow, face, sources.localPaths[0]);
    }
    const sourceUrl = sources.remoteUrls[0] || normalizeText(payload?.sourceUrl);
    const mediaPayload = buildEmojiMediaViewerPayload({
        sourcePath: filePath,
        sourceUrl,
        name: normalizeText(payload?.name) || face.faceName,
        width: Number(payload?.width) || face.imageWidth,
        height: Number(payload?.height) || face.imageHeight
    });
    if (!mediaPayload) {
        return false;
    }
    const source = filePath || sourceUrl;
    if (isInlineMediaViewerEnabled() && isInlineMediaHost(browserWindow)) {
        const opened = await showMediaViewer(browserWindow, {
            items: [{
                type: 'image',
                ...(filePath ? { filePath } : { sourceUrl }),
                name: normalizeText(payload?.name) || face.faceName || path.basename(source) || 'emoji.png'
            }],
            index: 0
        });
        if (opened) {
            recordDiagnostic('info', 'emoji-image.opened', {
                source: filePath ? 'local' : 'resource',
                viewer: 'telegram'
            });
        }
        return opened;
    }
    await qqNativeInvoke(
        browserWindow,
        'WindowApi',
        OPEN_MEDIA_VIEWER_COMMAND,
        mediaPayload,
        false,
        10000
    );
    recordDiagnostic('info', 'emoji-image.opened', {
        source: filePath ? 'local' : 'resource',
        viewer: 'native'
    });
    return true;
}

function handleToolboxNativeRequest(browserWindow, _channel, args) {
    const command = args.find(value => value?.cmdName && value?.payload !== undefined);
    if (!command) {
        return false;
    }
    bindPendingInlineFileDownload(browserWindow, command);
    openForwardMediaViewerFromDownloadRequest(browserWindow, command);
    applyCustomImageSummary(command, getMessageTweaksConfig());
    if (isDebugEnabled() && getWindowRoute(browserWindow?.webContents?.getURL()) === 'forward' &&
        /(?:RichMedia|VideoPlay)/i.test(command.cmdName)) {
        const firstArgument = Array.isArray(command.payload) ? command.payload[0] : command.payload;
        recordDiagnostic('info', 'media.forward-native-request', {
            cmdName: command.cmdName,
            argumentCount: Array.isArray(command.payload) ? command.payload.length : 1,
            fields: firstArgument && typeof firstArgument === 'object'
                ? Object.keys(firstArgument).sort()
                : []
        });
    }
    const tweaks = getInterfaceTweaksConfig();
    const request = args.find(value => typeof value?.callbackId === 'string');
    if (command.cmdName !== OPEN_MEDIA_VIEWER_COMMAND) {
        return false;
    }
    mediaViewerSession.clearStagedForward(browserWindow);
    if (isInlineMediaViewerEnabled(tweaks) && isInlineMediaHost(browserWindow)) {
        const gallery = extractInlineMediaGallery(command);
        if (!gallery) {
            return false;
        }
        const selected = gallery.items[gallery.index];
        if (!canOpenInlineMediaItem(selected)) {
            return false;
        }
        const activeSession = mediaViewerSession.get(browserWindow);
        const activeItem = activeSession?.gallery.items?.[activeSession.gallery.index];
        const activeGalleryContainsIncoming = mediaViewerSession.containsAll(
            browserWindow,
            gallery.items
        );
        if (activeGalleryContainsIncoming && activeItem && isSameInlineMediaItem(activeItem, selected)) {
            recordDiagnostic('info', 'media.native-viewer-coalesced', {
                selectedIndex: gallery.index
            });
            if (request) {
                replyWithNativeResult(args[0], request, null);
            }
            return true;
        }
        const nativeFallback = { payload: command.payload };
        showMediaViewer(browserWindow, gallery, { nativeFallback })
            .catch(error => {
                warn('media viewer failed:', error?.message || error);
                openNativeMediaViewerFallback(browserWindow, nativeFallback, selected.sourceIndex)
                    .catch(fallbackError => warn(
                        'native media viewer fallback failed:',
                        fallbackError?.message || fallbackError
                    ));
            });
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
    const msgId = getRecallKey(record);
    const stored = recallState.recalledMessages.get(msgId);
    const recallInfo = getRecallInfo(record);
    if (!stored && !recallInfo) {
        return null;
    }
    const config = getPreventRecallConfig();
    if (!stored && recallInfo.isSelfOperate && !config.preventSelfMsg) {
        return null;
    }
    const cached = stored || recallState.liveMessages.get(msgId);
    if (!cached) {
        return null;
    }
    const recovered = cloneRecallRecord(cached);
    if (getConfig().interfaceTweaks.deleteBubbleSkin) {
        deleteBubbleSkinFromRecord(recovered);
    }
    recovered.qqnt_toolbox_recall ||= createRecallMark(record);
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
    rememberPokeAccountFromRecords(browserWindow, context.records);
    const recallState = getRecallState(getWindowState(browserWindow).selfUin, false);
    if (!recallState) {
        return;
    }
    const config = getPreventRecallConfig();
    for (const record of context.records) {
        const msgId = getRecallKey(record);
        const hasRecoveredRecord = recallState.recalledMessages.has(msgId);
        if (!shouldHandlePreventRecallRecord(config, record, hasRecoveredRecord)) {
            if (getRecallInfo(record)) {
                recallState.liveMessages.delete(msgId);
            }
            continue;
        }
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

async function getExistingFilePathAsync(candidates) {
    for (const candidate of candidates) {
        const filePath = normalizePathText(candidate);
        try {
            const stat = filePath ? await fs.stat(filePath) : null;
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

function getInlineMediaSourceUrl(candidates) {
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
        const sourceUrl = normalizeInlineMediaSourceUrl(candidate);
        if (sourceUrl) {
            return sourceUrl;
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
    const guildId = normalizeText(value?.guildId || value?.peer?.guildId);
    return chatType && peerUid ? `${chatType}:${peerUid}:${guildId}` : '';
}

function getInlineMediaItemKey(item) {
    const identity = item?.identity || {};
    const msgId = normalizeText(identity.msgId);
    const elementId = normalizeText(identity.elementId);
    return msgId && elementId
        ? `${msgId}:${elementId}`
        : `${normalizeText(item?.type)}:${normalizeComparablePath(
            item?.filePath || item?.sourceUrl
        )}`;
}

function createInlineMediaItem(record, element, elementIndex, options = {}) {
    const lazy = options.lazy === true;
    let type;
    let media;
    let filePath;
    let sourceValues = [];
    if (Number(element?.elementType) === 2 || element?.picElement) {
        type = 'image';
        media = element.picElement || element;
        sourceValues = [
            media.sourcePath,
            media.filePath,
            media.originPath,
            media.localPath,
            media.path,
            media.originImageUrl,
            media.remoteUrl,
            media.originUrl,
            media.url
        ];
        filePath = lazy ? getPendingPicPath(media) : getPicSourcePath(media) || getPendingPicPath(media);
    } else if (Number(element?.elementType) === 5 || element?.videoElement) {
        type = 'video';
        media = element.videoElement || element;
        sourceValues = [
            media.filePath,
            media.sourcePath,
            media.originPath,
            media.localPath,
            media.path,
            media.remoteUrl,
            media.originUrl,
            media.url
        ];
        filePath = lazy ? getPendingVideoPath(media) : getVideoSourcePath(media) || getPendingVideoPath(media);
    } else if (Number(element?.elementType) === 3 || element?.fileElement) {
        media = element.fileElement || element;
        sourceValues = [media.filePath, media.sourcePath, media.originPath, media.localPath, media.path];
        filePath = lazy ? getPendingFilePath(media) : getFileSourcePath(media) || getPendingFilePath(media);
        type = classifyMediaFilePath(media.fileName, filePath, ...sourceValues);
    }
    const sourceUrl = getInlineMediaSourceUrl(sourceValues);
    const identity = {
        chatType: Number(record?.chatType || record?.peer?.chatType) || 0,
        peerUid: normalizeText(
            record?.peerUid || record?.peerUin || record?.peer?.peerUid || record?.peer?.peerUin
        ),
        msgId: normalizeText(record?.msgId),
        msgSeq: normalizeText(record?.msgSeq),
        msgTime: normalizeText(record?.msgTime),
        guildId: normalizeText(record?.guildId || record?.peer?.guildId),
        elementId: normalizeText(element?.elementId)
    };
    if (!type || (!filePath && !sourceUrl)) {
        return null;
    }
    const previewCandidates = [
        ...(type === 'video' ? [media.coverPath] : []),
        ...getThumbPathCandidates(media.thumbPath),
        ...getThumbPathCandidates(media.picThumbPath)
    ];
    const previewSource = lazy
        ? getInlineMediaSourceUrl(previewCandidates) || getAbsoluteFilePathCandidate(previewCandidates)
        : getExistingFilePath(previewCandidates) ||
            getInlineMediaSourceUrl(previewCandidates) ||
            getAbsoluteFilePathCandidate(previewCandidates);
    const senderName = normalizeText(
        record?.sendRemarkName || record?.sendMemberName || record?.sendNickName ||
        record?.senderNick || record?.senderName || record?.senderUid || record?.senderUin
    );
    const timestamp = Number(record?.msgTime || record?.timestamp);
    return {
        type,
        ...(filePath ? { filePath } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(previewSource ? { previewSource } : {}),
        fingerprint: normalizeText(
            media.md5HexStr || media.originImageMd5 || media.videoMd5 || media.fileMd5
        ).toLowerCase(),
        name: normalizeText(media.fileName || media.summary) ||
            (filePath ? path.basename(filePath) : type === 'video' ? 'video.mp4' : 'image.png'),
        sourceIndex: elementIndex,
        identity,
        ...(senderName ? { senderName } : {}),
        ...(Number.isFinite(timestamp) && timestamp > 0 ? { timestamp } : {}),
        ...(Number(media.fileSize) > 0 ? { fileSize: Number(media.fileSize) } : {})
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
    } else if (leftSeq && rightSeq && leftSeq !== rightSeq) {
        return leftSeq.localeCompare(rightSeq);
    }
    const leftTime = normalizeText(left?.identity?.msgTime || left?.timestamp);
    const rightTime = normalizeText(right?.identity?.msgTime || right?.timestamp);
    if (/^\d+$/.test(leftTime) && /^\d+$/.test(rightTime)) {
        const difference = BigInt(leftTime) - BigInt(rightTime);
        if (difference !== 0n) {
            return difference < 0n ? -1 : 1;
        }
    } else if (leftTime && rightTime && leftTime !== rightTime) {
        return leftTime.localeCompare(rightTime);
    }
    const leftMsgId = normalizeText(left?.identity?.msgId);
    const rightMsgId = normalizeText(right?.identity?.msgId);
    if (leftMsgId && rightMsgId && leftMsgId !== rightMsgId) {
        return leftMsgId.localeCompare(rightMsgId, undefined, { numeric: true });
    }
    return Number(left?.sourceIndex) - Number(right?.sourceIndex);
}

function rememberInlineMediaRecords(browserWindow, context) {
    if (!isInlineMediaViewerEnabled() ||
        getWindowRoute(browserWindow?.webContents?.getURL()) === 'forward') {
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
    if (getWindowRoute(browserWindow?.webContents?.getURL()) === 'forward') {
        return gallery;
    }
    const selected = gallery?.items?.[gallery.index];
    if (!selected) {
        return gallery;
    }
    const peerKey = getInlineMediaPeerKey(selected?.identity);
    const state = browserWindow ? getWindowState(browserWindow) : null;
    const peerItems = peerKey ? state?.inlineMediaByPeer.get(peerKey) : null;
    const rememberedItems = Array.from(peerItems?.values?.() || []);
    const replySources = peerKey ? state?.inlineReplySourcesByPeer.get(peerKey) : null;
    const viewerItems = gallery.items.map(item =>
        resolveInlineReplyPreview(item, rememberedItems, replySources)
    );
    const selectedItem = viewerItems[gallery.index];
    const items = mergeInlineMediaItems(
        rememberedItems,
        viewerItems
    ).filter(canListInlineMediaItem).sort(compareInlineMediaItems);
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
    const config = getFileRetryConfig();
    if (config.enabled === false) {
        return null;
    }
    return createFileRetryPlan(elements, getRepairDescriptor, isGeneratedRepairPath, config);
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
    const kinds = getRepairKinds(plan);
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
    const repairDir = getRepairDir();
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
    try {
        const remaining = await fs.readdir(repairDir);
        if (!remaining.length) {
            await fs.rmdir(repairDir);
        }
    } catch {
    }
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

async function getFileHash(filePath, algorithm) {
    const hash = crypto.createHash(algorithm);
    const stream = fsSync.createReadStream(filePath);
    return await new Promise((resolve, reject) => {
        stream.on('data', chunk => hash.update(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

async function getFileMd5(filePath) {
    return await getFileHash(filePath, 'md5');
}

async function getFileSha1(filePath) {
    return await getFileHash(filePath, 'sha1');
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

async function createVideoThumbnail(filePath, originalThumbPath = '', options = {}) {
    const repairDir = await ensureRepairDir();
    const stem = safeFileStem(path.basename(filePath, path.extname(filePath)));
    const extension = options.extension === '.jpg' ? '.jpg' : '.png';
    const blur = options.blur !== false;
    const outPath = path.join(
        repairDir,
        `${stem}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.thumb${blur ? '.blur' : ''}${extension}`
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
            '-frames:v', '1'
        );
        const filters = [];
        if (options.maxWidth) {
            filters.push(`scale=w='min(${Number(options.maxWidth)},iw)':h=-2`);
        }
        if (blur) {
            filters.push('gblur=sigma=18');
        }
        if (filters.length) {
            ffmpegArgs.push('-vf', filters.join(','));
        }
        ffmpegArgs.push('-update', '1', '-an');
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

async function createVideoElement(browserWindow, filePath, originalVideoElement = {}, mediaInfo = null, options = {}) {
    const info = mediaInfo || await probeMediaInfo(filePath);
    if (!info.width || !info.height) {
        throw new Error('Video stream dimensions are unavailable.');
    }
    const originalThumbPath = getThumbPathCandidate(originalVideoElement.thumbPath);
    const generatedThumbPath = await createVideoThumbnail(filePath, originalThumbPath, {
        blur: options.blurThumbnail !== false
    });
    const cached = await copyMediaToQqCache(browserWindow, filePath, 5, originalVideoElement.fileName);
    const thumbFilePath = await cacheGeneratedVideoThumbnail(cached.filePath, cached.md5, generatedThumbPath);
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
        const thumbPath = await createVideoThumbnail(filePath, originalThumbPath, {
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

async function downloadForwardDetailResource(browserWindow, remoteUrl, fileName, fallbackExtension) {
    if (!remoteUrl) {
        throw new Error('The forwarded resource has no download URL.');
    }
    const baseName = path.basename(normalizeText(fileName)) || `forward-resource${fallbackExtension}`;
    const extension = path.extname(baseName) || fallbackExtension;
    const stem = safeFileStem(path.basename(baseName, extension)) || 'forward-resource';
    const repairDir = await ensureRepairDir();
    const targetPath = path.join(
        repairDir,
        `${stem}.forward.${Date.now()}.${crypto.randomBytes(4).toString('hex')}${extension}`
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FORWARD_RESOURCE_DOWNLOAD_TIMEOUT_MS);
    const handleWindowClosed = () => controller.abort();
    timeout.unref?.();
    browserWindow?.once?.('closed', handleWindowClosed);
    try {
        const response = await fetch(remoteUrl, { signal: controller.signal });
        if (!response.ok || !response.body) {
            throw new Error(`Forwarded resource download failed: HTTP ${response.status}.`);
        }
        await pipeline(Readable.fromWeb(response.body), fsSync.createWriteStream(targetPath));
        const stat = await fs.stat(targetPath);
        if (!stat.isFile() || stat.size <= 0) {
            throw new Error('Forwarded resource download returned an empty file.');
        }
        cleanupOldRepairFiles().catch(() => {});
        return targetPath;
    } catch (error) {
        await fs.rm(targetPath, { force: true }).catch(() => {});
        if (controller.signal.aborted) {
            throw new Error('Forwarded resource download was cancelled or timed out.');
        }
        throw error;
    } finally {
        clearTimeout(timeout);
        browserWindow?.removeListener?.('closed', handleWindowClosed);
    }
}

async function downloadForwardDetailImage(browserWindow, picElement) {
    const remoteUrl = getViewerRemoteUrl(picElement?.originImageUrl, picElement?.thumbPath);
    const nameExtension = path.extname(normalizeText(picElement?.fileName)).toLowerCase();
    const fallbackExtension = IMAGE_EXTENSIONS.has(nameExtension) ? nameExtension : '.png';
    return await downloadForwardDetailResource(
        browserWindow,
        remoteUrl,
        normalizeText(picElement?.fileName) || `forward-image${fallbackExtension}`,
        fallbackExtension
    );
}

async function waitForForwardDetailFile(candidates, browserWindow, timeoutMs = 60000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (browserWindow?.isDestroyed?.() || browserWindow?.webContents?.isDestroyed?.()) {
            return '';
        }
        const filePath = await getExistingFilePathAsync(candidates);
        if (filePath) {
            return filePath;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    return '';
}

function getForwardDetailMediaPathCandidates(media) {
    return [
        media?.filePath,
        media?.sourcePath,
        media?.originPath,
        media?.localPath,
        media?.path
    ];
}

async function invokeForwardDetailMediaDownload(browserWindow, record, element) {
    const payload = createInlineMediaVisitDownloadPayload({
        visit: { ...record, element }
    });
    if (!payload) {
        throw new Error('The forwarded media visit context is incomplete.');
    }
    return await qqNativeInvoke(
        browserWindow,
        'ntApi',
        'nodeIKernelRichMediaService/downloadRichMediaInVisit',
        payload,
        false
    );
}

async function downloadForwardDetailMedia(
    browserWindow,
    record,
    element,
    media,
    fallbackName,
    fallbackExtension
) {
    const pathCandidates = getForwardDetailMediaPathCandidates(media);
    const result = await invokeForwardDetailMediaDownload(browserWindow, record, element);
    if (isRepeatCommandFailure(result)) {
        throw new Error(`forwarded media download failed: ${safeJson(result)}`);
    }
    const localPath = getViewerFileUrl(result, ...pathCandidates);
    if (localPath) {
        return fileURLToPath(localPath);
    }
    const remoteUrl = getViewerRemoteUrl(result, media);
    if (remoteUrl) {
        return await downloadForwardDetailResource(
            browserWindow,
            remoteUrl,
            normalizeText(media?.fileName) || fallbackName,
            fallbackExtension
        );
    }
    const downloadedPath = await waitForForwardDetailFile(pathCandidates, browserWindow);
    if (!downloadedPath) {
        throw new Error('QQ did not return a downloaded path for the forwarded media.');
    }
    return downloadedPath;
}

async function downloadForwardDetailFile(browserWindow, record, element) {
    const fileElement = element?.fileElement || element;
    return await downloadForwardDetailMedia(
        browserWindow,
        record,
        element,
        fileElement,
        'forward-file.bin',
        '.bin'
    );
}

async function downloadForwardDetailVideo(browserWindow, record, element) {
    const videoElement = element?.videoElement || element;
    const pendingPath = getPendingVideoPath(videoElement);
    const fileName = normalizeText(videoElement?.fileName) || path.basename(pendingPath) || 'forward-video.mp4';
    const extension = path.extname(fileName).toLowerCase();
    const fallbackExtension = VIDEO_EXTENSIONS.has(extension) ? extension : '.mp4';
    return await downloadForwardDetailMedia(
        browserWindow,
        record,
        element,
        videoElement,
        `forward-video${fallbackExtension}`,
        fallbackExtension
    );
}

async function prepareForwardDetailElement(browserWindow, record, element) {
    const elementType = Number(element?.elementType);
    let rebuilt;
    if (elementType === 2 || element?.picElement) {
        const picElement = element.picElement || element;
        const localPath = getPicSourcePath(picElement) ||
            await downloadForwardDetailImage(browserWindow, picElement);
        rebuilt = await createPicElement(browserWindow, localPath, picElement, {
            allowOriginalHash: true
        });
    } else if (elementType === 3 || element?.fileElement) {
        const fileElement = element.fileElement || element;
        const localPath = getFileSourcePath(fileElement) ||
            await downloadForwardDetailFile(browserWindow, record, element);
        rebuilt = await createFileElement(
            localPath,
            normalizeText(fileElement?.fileName) || path.basename(localPath),
            fileElement
        );
    } else if (elementType === 5 || element?.videoElement) {
        const videoElement = element.videoElement || element;
        const localPath = getVideoSourcePath(videoElement) ||
            await downloadForwardDetailVideo(browserWindow, record, element);
        rebuilt = await createVideoElement(browserWindow, localPath, videoElement, null, {
            blurThumbnail: false
        });
    } else {
        return element;
    }
    rebuilt.elementGroupId = Number(element?.elementGroupId) || 0;
    return rebuilt;
}

async function prepareForwardDetailRecord(browserWindow, record = {}) {
    const sourceElements = Array.isArray(record.elements) ? record.elements : [];
    const elements = await mapWithConcurrency(
        sourceElements,
        2,
        element => prepareForwardDetailElement(browserWindow, record, element)
    );
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

async function repeatBySendMsg(browserWindow, peer, record = {}, options = {}) {
    const confirm = options.confirm === true;
    const sourceElements = Array.isArray(record.elements) ? record.elements : [];
    const msgElements = options.detached === true
        ? sourceElements.map(element => element && typeof element === 'object' ? { ...element } : element)
        : deepCloneForSend(sourceElements);
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
    const result = await service.forwardSubMsgWithComment(
        [rootMsgId],
        [subMsgId],
        rootPeer,
        [destinationPeer],
        [],
        new Map()
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
    if (kind === PRESERVE_KIND) {
        const preserved = deepCloneForSend(element);
        if (preserved && typeof preserved === 'object') {
            preserved.elementId = '';
        }
        return preserved;
    }
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
    if (config.enabled === false || plan.some(descriptor =>
        descriptor.kind !== PRESERVE_KIND && config[descriptor.kind] === false
    )) {
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
        kinds: getRepairKinds(plan),
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
    processDeleteBubbleSkin(context);
    processPreventRecall(browserWindow, context);
    rememberInlineMediaRecords(browserWindow, context);
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
        singleForwardWindowController.install(browserWindow);
        installNativeSendHandler(browserWindow);
        installNativeRequestHandler(browserWindow);
    }
}

function start() {
    loadConfig();
    getPluginUpdater();
    scheduleAutomaticUpdateCheck();
    app?.once?.('before-quit', () => {
        singleForwardWindowController.setQuitting(true);
        clearTimeout(mediaPipBoundsSaveTimer);
        if (mediaPipWindow && !mediaPipWindow.isDestroyed()) {
            mediaPipWindow.destroy();
        }
        if (mediaViewerWindow && !mediaViewerWindow.isDestroyed()) {
            mediaViewerWindow.destroy();
        }
        inlineMediaServer.close();
    });
    installConfigIpc();
    installForAllWindows();
    applyVoiceMessageConfig();
    cleanupOldRepairFiles(true).catch(() => {});
    app?.on?.('browser-window-created', (_event, browserWindow) => {
        singleForwardWindowController.install(browserWindow);
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
