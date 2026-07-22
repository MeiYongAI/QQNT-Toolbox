const { contextBridge, ipcRenderer } = require('electron');

const CHANNEL_GET_CONFIG = 'qqnt-toolbox:get-config';
const CHANNEL_SET_CONFIG = 'qqnt-toolbox:set-config';
const CHANNEL_CONFIG_CHANGED = 'qqnt-toolbox:config-changed';
const CHANNEL_DIAGNOSTIC_EVENT = 'qqnt-toolbox:diagnostic-event';
const CHANNEL_DIAGNOSTIC_ACTION = 'qqnt-toolbox:diagnostic-action';
const CHANNEL_INLINE_MEDIA_PREVIEW = 'qqnt-toolbox:inline-media-preview';
const CHANNEL_OPEN_INLINE_MEDIA = 'qqnt-toolbox:open-inline-media';
const CHANNEL_PREPARE_INLINE_MEDIA = 'qqnt-toolbox:prepare-inline-media';
const CHANNEL_OPEN_EMOJI_AS_IMAGE = 'qqnt-toolbox:open-emoji-as-image';
const CHANNEL_REPEAT_MESSAGE = 'qqnt-toolbox:repeat-message';
const CHANNEL_STAGE_FAKE_FORWARD_IMAGE = 'qqnt-toolbox:stage-fake-forward-image';
const CHANNEL_SEND_FAKE_FORWARD = 'qqnt-toolbox:send-fake-forward';
const CHANNEL_GET_REACTION_CATALOG = 'qqnt-toolbox:get-reaction-catalog';
const CHANNEL_SET_MESSAGE_REACTION = 'qqnt-toolbox:set-message-reaction';
const CHANNEL_SEND_POKE = 'qqnt-toolbox:send-poke';
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
    repeatMessage: payload => ipcRenderer.invoke(CHANNEL_REPEAT_MESSAGE, payload),
    stageFakeForwardImage: payload => ipcRenderer.invoke(CHANNEL_STAGE_FAKE_FORWARD_IMAGE, payload),
    sendFakeForward: payload => ipcRenderer.invoke(CHANNEL_SEND_FAKE_FORWARD, payload),
    getReactionEmojiCatalog: () => ipcRenderer.invoke(CHANNEL_GET_REACTION_CATALOG),
    setMessageReaction: payload => ipcRenderer.invoke(CHANNEL_SET_MESSAGE_REACTION, payload),
    sendPoke: payload => ipcRenderer.invoke(CHANNEL_SEND_POKE, payload),
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
    openInlineMedia: payload => ipcRenderer.invoke(CHANNEL_OPEN_INLINE_MEDIA, payload),
    prepareInlineMedia: payload => ipcRenderer.invoke(CHANNEL_PREPARE_INLINE_MEDIA, payload),
    openEmojiAsImage: payload => ipcRenderer.invoke(CHANNEL_OPEN_EMOJI_AS_IMAGE, payload),
    onInlineMediaPreview: callback => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on(CHANNEL_INLINE_MEDIA_PREVIEW, listener);
        return () => ipcRenderer.removeListener(CHANNEL_INLINE_MEDIA_PREVIEW, listener);
    },
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
