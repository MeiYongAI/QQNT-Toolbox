const { contextBridge, ipcRenderer } = require('electron');

const CHANNEL_GET_RECALL_VIEWER_DATA = 'qqnt-toolbox:get-recall-viewer-data';
const CHANNEL_GET_RECALL_AUDIO_PREVIEW = 'qqnt-toolbox:get-recall-audio-preview';
const CHANNEL_OPEN_RECALL_VIEWER_FILE = 'qqnt-toolbox:open-recall-viewer-file';
const CHANNEL_JUMP_RECALL_MESSAGE = 'qqnt-toolbox:jump-recall-message';

function invokeWithTimeout(channel, payload, timeoutMs = 10000) {
    let timeout = 0;
    const request = ipcRenderer.invoke(channel, payload);
    const deadline = new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Recall viewer request timed out.')), timeoutMs);
    });
    return Promise.race([request, deadline]).finally(() => clearTimeout(timeout));
}

contextBridge.exposeInMainWorld('qqntToolboxRecallViewer', {
    getData: () => invokeWithTimeout(CHANNEL_GET_RECALL_VIEWER_DATA),
    getAudioPreview: payload => ipcRenderer.invoke(CHANNEL_GET_RECALL_AUDIO_PREVIEW, payload),
    openFile: payload => ipcRenderer.invoke(CHANNEL_OPEN_RECALL_VIEWER_FILE, payload),
    jumpToMessage: payload => ipcRenderer.invoke(CHANNEL_JUMP_RECALL_MESSAGE, payload)
});
