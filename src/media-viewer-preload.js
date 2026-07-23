'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const CHANNEL_MEDIA_VIEWER_GET_STATE = 'qqnt-toolbox:media-viewer-get-state';
const CHANNEL_MEDIA_VIEWER_PREPARE = 'qqnt-toolbox:media-viewer-prepare';
const CHANNEL_MEDIA_VIEWER_ACTION = 'qqnt-toolbox:media-viewer-action';
const CHANNEL_MEDIA_VIEWER_STATE_CHANGED = 'qqnt-toolbox:media-viewer-state-changed';
const CHANNEL_QR_RESULT_ACTION = 'qqnt-toolbox:qr-result-action';

contextBridge.exposeInMainWorld('qqntToolboxMediaViewer', {
    getState: () => ipcRenderer.invoke(CHANNEL_MEDIA_VIEWER_GET_STATE),
    prepare: payload => ipcRenderer.invoke(CHANNEL_MEDIA_VIEWER_PREPARE, payload),
    action: payload => ipcRenderer.invoke(CHANNEL_MEDIA_VIEWER_ACTION, payload),
    qrResultAction: payload => ipcRenderer.invoke(CHANNEL_QR_RESULT_ACTION, payload),
    onStateChanged: callback => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on(CHANNEL_MEDIA_VIEWER_STATE_CHANGED, listener);
        return () => ipcRenderer.removeListener(CHANNEL_MEDIA_VIEWER_STATE_CHANGED, listener);
    }
});
