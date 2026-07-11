const { contextBridge, ipcRenderer } = require('electron');

const CHANNEL_GET_CONFIG = 'qqnt-toolbox:get-config';
const CHANNEL_SET_CONFIG = 'qqnt-toolbox:set-config';
const CHANNEL_CONFIG_CHANGED = 'qqnt-toolbox:config-changed';
const CHANNEL_REPEAT_MESSAGE = 'qqnt-toolbox:repeat-message';
const CHANNEL_CLEAR_RECALL_CACHE = 'qqnt-toolbox:clear-recall-cache';
const CHANNEL_OPEN_RECALL_DIR = 'qqnt-toolbox:open-recall-dir';
const CHANNEL_OPEN_RECALL_IMAGE_DIR = 'qqnt-toolbox:open-recall-image-dir';
const CHANNEL_VIEW_RECALL_MESSAGES = 'qqnt-toolbox:view-recall-messages';

contextBridge.exposeInMainWorld('qqnt_toolbox', {
    getConfig: () => ipcRenderer.invoke(CHANNEL_GET_CONFIG),
    setConfig: config => ipcRenderer.invoke(CHANNEL_SET_CONFIG, config),
    repeatMessage: payload => ipcRenderer.invoke(CHANNEL_REPEAT_MESSAGE, payload),
    clearRecallCache: () => ipcRenderer.invoke(CHANNEL_CLEAR_RECALL_CACHE),
    openRecallDir: () => ipcRenderer.invoke(CHANNEL_OPEN_RECALL_DIR),
    openRecallImageDir: () => ipcRenderer.invoke(CHANNEL_OPEN_RECALL_IMAGE_DIR),
    viewRecallMessages: () => ipcRenderer.invoke(CHANNEL_VIEW_RECALL_MESSAGES),
    onConfigChanged: callback => {
        const listener = (_event, config) => callback(config);
        ipcRenderer.on(CHANNEL_CONFIG_CHANGED, listener);
        return () => ipcRenderer.removeListener(CHANNEL_CONFIG_CHANGED, listener);
    }
});
