const { contextBridge, ipcRenderer } = require('electron');

const CHANNEL_GET_RECALL_VIEWER_DATA = 'qqnt-toolbox:get-recall-viewer-data';
const CHANNEL_GET_RECALL_AUDIO_PREVIEW = 'qqnt-toolbox:get-recall-audio-preview';
const CHANNEL_JUMP_RECALL_MESSAGE = 'qqnt-toolbox:jump-recall-message';
const CHANNEL_COPY_RECALL_TEXT = 'qqnt-toolbox:copy-recall-text';

contextBridge.exposeInMainWorld('qqntToolboxRecallViewer', {
    getData: () => ipcRenderer.invoke(CHANNEL_GET_RECALL_VIEWER_DATA),
    getAudioPreview: payload => ipcRenderer.invoke(CHANNEL_GET_RECALL_AUDIO_PREVIEW, payload),
    jumpToMessage: payload => ipcRenderer.invoke(CHANNEL_JUMP_RECALL_MESSAGE, payload),
    copyText: value => ipcRenderer.invoke(CHANNEL_COPY_RECALL_TEXT, value)
});
