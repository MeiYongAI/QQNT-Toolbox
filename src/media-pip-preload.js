'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const CHANNEL_MEDIA_PIP_GET_STATE = 'qqnt-toolbox:media-pip-get-state';
const CHANNEL_MEDIA_PIP_ACTION = 'qqnt-toolbox:media-pip-action';
const CHANNEL_MEDIA_PIP_DRAG = 'qqnt-toolbox:media-pip-drag';
const CHANNEL_MEDIA_PIP_STATE_CHANGED = 'qqnt-toolbox:media-pip-state-changed';

contextBridge.exposeInMainWorld('qqntToolboxMediaPip', {
    getState: () => ipcRenderer.invoke(CHANNEL_MEDIA_PIP_GET_STATE),
    action: payload => ipcRenderer.invoke(CHANNEL_MEDIA_PIP_ACTION, payload),
    drag: payload => ipcRenderer.send(CHANNEL_MEDIA_PIP_DRAG, payload),
    onStateChanged: callback => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on(CHANNEL_MEDIA_PIP_STATE_CHANGED, listener);
        return () => ipcRenderer.removeListener(CHANNEL_MEDIA_PIP_STATE_CHANGED, listener);
    }
});
