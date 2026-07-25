const { contextBridge, ipcRenderer, webUtils } = require('electron');

const CHANNEL_GET_CONFIG = 'qqnt-toolbox:get-config';
const CHANNEL_SET_CONFIG = 'qqnt-toolbox:set-config';
const CHANNEL_CONFIG_CHANGED = 'qqnt-toolbox:config-changed';
const CHANNEL_DIAGNOSTIC_EVENT = 'qqnt-toolbox:diagnostic-event';
const CHANNEL_DIAGNOSTIC_ACTION = 'qqnt-toolbox:diagnostic-action';
const CHANNEL_OPEN_MEDIA_VIEWER = 'qqnt-toolbox:open-media-viewer';
const CHANNEL_SCAN_QR_CODE = 'qqnt-toolbox:scan-qr-code';
const CHANNEL_QR_RESULT_ACTION = 'qqnt-toolbox:qr-result-action';
const CHANNEL_OPEN_EMOJI_AS_IMAGE = 'qqnt-toolbox:open-emoji-as-image';
const CHANNEL_LOAD_MESSAGE_IMAGE_RENDERER = 'qqnt-toolbox:load-message-image-renderer';
const CHANNEL_SAVE_MESSAGE_IMAGE = 'qqnt-toolbox:save-message-image';
const CHANNEL_FORWARD_OPEN_INTENT = 'qqnt-toolbox:forward-open-intent';
const CHANNEL_REPEAT_MESSAGE = 'qqnt-toolbox:repeat-message';
const CHANNEL_STAGE_FAKE_FORWARD_IMAGE = 'qqnt-toolbox:stage-fake-forward-image';
const CHANNEL_RESOLVE_FAKE_FORWARD_SENDER_NAME = 'qqnt-toolbox:resolve-fake-forward-sender-name';
const CHANNEL_SEND_FAKE_FORWARD = 'qqnt-toolbox:send-fake-forward';
const CHANNEL_CHOOSE_LOCAL_STICKER_DIRECTORY = 'qqnt-toolbox:choose-local-sticker-directory';
const CHANNEL_GET_LOCAL_STICKERS = 'qqnt-toolbox:get-local-stickers';
const CHANNEL_REMEMBER_LOCAL_STICKER = 'qqnt-toolbox:remember-local-sticker';
const CHANNEL_SEND_LOCAL_STICKER = 'qqnt-toolbox:send-local-sticker';
const CHANNEL_OPEN_LOCAL_STICKER_DIRECTORY = 'qqnt-toolbox:open-local-sticker-directory';
const CHANNEL_UPDATE_LOCAL_STICKER_PACK_ORDER = 'qqnt-toolbox:update-local-sticker-pack-order';
const CHANNEL_CHOOSE_LOCAL_STICKER_TOOL = 'qqnt-toolbox:choose-local-sticker-tool';
const CHANNEL_GET_LOCAL_STICKER_ENVIRONMENT = 'qqnt-toolbox:get-local-sticker-environment';
const CHANNEL_OPEN_LOCAL_STICKER_TOOL_DOWNLOAD = 'qqnt-toolbox:open-local-sticker-tool-download';
const CHANNEL_TEST_LOCAL_STICKER_PROXY = 'qqnt-toolbox:test-local-sticker-proxy';
const CHANNEL_DOWNLOAD_TELEGRAM_STICKERS = 'qqnt-toolbox:download-telegram-stickers';
const CHANNEL_GET_REACTION_CATALOG = 'qqnt-toolbox:get-reaction-catalog';
const CHANNEL_GET_AUTO_REACTION_CATALOG = 'qqnt-toolbox:get-auto-reaction-catalog';
const CHANNEL_SET_MESSAGE_REACTION = 'qqnt-toolbox:set-message-reaction';
const CHANNEL_SEND_POKE = 'qqnt-toolbox:send-poke';
const CHANNEL_SEND_WINDOW_SHAKE = 'qqnt-toolbox:send-window-shake';
const CHANNEL_RECALL_POKE = 'qqnt-toolbox:recall-poke';
const CHANNEL_REGISTER_POKE_ACCOUNT = 'qqnt-toolbox:register-poke-account';
const CHANNEL_CLEAR_RECALL_CACHE = 'qqnt-toolbox:clear-recall-cache';
const CHANNEL_OPEN_RECALL_DIR = 'qqnt-toolbox:open-recall-dir';
const CHANNEL_OPEN_RECALL_IMAGE_DIR = 'qqnt-toolbox:open-recall-image-dir';
const CHANNEL_VIEW_RECALL_MESSAGES = 'qqnt-toolbox:view-recall-messages';
const CHANNEL_GET_RECALL_CONTACTS = 'qqnt-toolbox:get-recall-contacts';
const CHANNEL_GET_UPDATE_STATE = 'qqnt-toolbox:get-update-state';
const CHANNEL_CHECK_UPDATE = 'qqnt-toolbox:check-update';
const CHANNEL_PREPARE_UPDATE = 'qqnt-toolbox:prepare-update';
const CHANNEL_RESTART_UPDATE = 'qqnt-toolbox:restart-update';
const CHANNEL_UPDATE_STATE_CHANGED = 'qqnt-toolbox:update-state-changed';

contextBridge.exposeInMainWorld('qqnt_toolbox', {
    getConfig: () => ipcRenderer.invoke(CHANNEL_GET_CONFIG),
    setConfig: config => ipcRenderer.invoke(CHANNEL_SET_CONFIG, config),
    recordDiagnosticEvent: payload => ipcRenderer.invoke(CHANNEL_DIAGNOSTIC_EVENT, payload),
    runDiagnosticAction: action => ipcRenderer.invoke(CHANNEL_DIAGNOSTIC_ACTION, action),
    markForwardOpenIntent: () => ipcRenderer.send(CHANNEL_FORWARD_OPEN_INTENT),
    repeatMessage: payload => ipcRenderer.invoke(CHANNEL_REPEAT_MESSAGE, payload),
    getPathForFile: file => webUtils?.getPathForFile?.(file) || file?.path || '',
    stageFakeForwardImage: payload => ipcRenderer.invoke(CHANNEL_STAGE_FAKE_FORWARD_IMAGE, payload),
    resolveFakeForwardSenderName: senderUin =>
        ipcRenderer.invoke(CHANNEL_RESOLVE_FAKE_FORWARD_SENDER_NAME, senderUin),
    sendFakeForward: payload => ipcRenderer.invoke(CHANNEL_SEND_FAKE_FORWARD, payload),
    chooseLocalStickerDirectory: () => ipcRenderer.invoke(CHANNEL_CHOOSE_LOCAL_STICKER_DIRECTORY),
    getLocalStickers: options => ipcRenderer.invoke(CHANNEL_GET_LOCAL_STICKERS, options),
    rememberLocalSticker: filePath => ipcRenderer.invoke(CHANNEL_REMEMBER_LOCAL_STICKER, filePath),
    sendLocalSticker: payload => ipcRenderer.invoke(CHANNEL_SEND_LOCAL_STICKER, payload),
    openLocalStickerDirectory: () => ipcRenderer.invoke(CHANNEL_OPEN_LOCAL_STICKER_DIRECTORY),
    updateLocalStickerPackOrder: packPaths =>
        ipcRenderer.invoke(CHANNEL_UPDATE_LOCAL_STICKER_PACK_ORDER, packPaths),
    chooseLocalStickerTool: tool => ipcRenderer.invoke(CHANNEL_CHOOSE_LOCAL_STICKER_TOOL, tool),
    getLocalStickerEnvironment: () => ipcRenderer.invoke(CHANNEL_GET_LOCAL_STICKER_ENVIRONMENT),
    openLocalStickerToolDownload: tool =>
        ipcRenderer.invoke(CHANNEL_OPEN_LOCAL_STICKER_TOOL_DOWNLOAD, tool),
    testLocalStickerProxy: proxyUrl => ipcRenderer.invoke(CHANNEL_TEST_LOCAL_STICKER_PROXY, proxyUrl),
    downloadTelegramStickers: url => ipcRenderer.invoke(CHANNEL_DOWNLOAD_TELEGRAM_STICKERS, url),
    getReactionEmojiCatalog: () => ipcRenderer.invoke(CHANNEL_GET_REACTION_CATALOG),
    getAutoReactionEmojiCatalog: () => ipcRenderer.invoke(CHANNEL_GET_AUTO_REACTION_CATALOG),
    setMessageReaction: payload => ipcRenderer.invoke(CHANNEL_SET_MESSAGE_REACTION, payload),
    sendPoke: payload => ipcRenderer.invoke(CHANNEL_SEND_POKE, payload),
    sendWindowShake: payload => ipcRenderer.invoke(CHANNEL_SEND_WINDOW_SHAKE, payload),
    recallPoke: payload => ipcRenderer.invoke(CHANNEL_RECALL_POKE, payload),
    registerPokeAccount: selfUin => ipcRenderer.invoke(CHANNEL_REGISTER_POKE_ACCOUNT, selfUin),
    clearRecallCache: () => ipcRenderer.invoke(CHANNEL_CLEAR_RECALL_CACHE),
    openRecallDir: () => ipcRenderer.invoke(CHANNEL_OPEN_RECALL_DIR),
    openRecallImageDir: () => ipcRenderer.invoke(CHANNEL_OPEN_RECALL_IMAGE_DIR),
    viewRecallMessages: () => ipcRenderer.invoke(CHANNEL_VIEW_RECALL_MESSAGES),
    getRecallContacts: () => ipcRenderer.invoke(CHANNEL_GET_RECALL_CONTACTS),
    getUpdateState: () => ipcRenderer.invoke(CHANNEL_GET_UPDATE_STATE),
    checkForUpdates: options => ipcRenderer.invoke(CHANNEL_CHECK_UPDATE, options),
    prepareUpdate: () => ipcRenderer.invoke(CHANNEL_PREPARE_UPDATE),
    restartForUpdate: () => ipcRenderer.invoke(CHANNEL_RESTART_UPDATE),
    openMediaViewer: payload => ipcRenderer.invoke(CHANNEL_OPEN_MEDIA_VIEWER, payload),
    scanQrCode: payload => ipcRenderer.invoke(CHANNEL_SCAN_QR_CODE, payload),
    qrResultAction: payload => ipcRenderer.invoke(CHANNEL_QR_RESULT_ACTION, payload),
    openEmojiAsImage: payload => ipcRenderer.invoke(CHANNEL_OPEN_EMOJI_AS_IMAGE, payload),
    loadMessageImageRenderer: () => ipcRenderer.invoke(CHANNEL_LOAD_MESSAGE_IMAGE_RENDERER),
    saveMessageImage: payload => ipcRenderer.invoke(CHANNEL_SAVE_MESSAGE_IMAGE, payload),
    onConfigChanged: callback => {
        const listener = (_event, config) => callback(config);
        ipcRenderer.on(CHANNEL_CONFIG_CHANGED, listener);
        return () => ipcRenderer.removeListener(CHANNEL_CONFIG_CHANGED, listener);
    },
    onUpdateStateChanged: callback => {
        const listener = (_event, state) => callback(state);
        ipcRenderer.on(CHANNEL_UPDATE_STATE_CHANGED, listener);
        return () => ipcRenderer.removeListener(CHANNEL_UPDATE_STATE_CHANGED, listener);
    }
});
