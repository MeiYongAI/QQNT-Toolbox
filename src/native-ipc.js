'use strict';

const crypto = require('crypto');
const { ipcMain } = require('electron');

const windowStates = new WeakMap();
const requestWindows = new Map();
let requestInterceptorInstalled = false;

function safeJson(value) {
    try {
        return JSON.stringify(value, (_key, item) => {
            if (item instanceof Map) {
                return Object.fromEntries(item);
            }
            if (typeof item === 'bigint') {
                return item.toString();
            }
            return item;
        });
    } catch {
        return String(value);
    }
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

function getMsgAttrId(record) {
    const attrs = record?.msgAttrs;
    if (!attrs) {
        return undefined;
    }
    if (attrs instanceof Map) {
        return attrs.get(0)?.attrId;
    }
    return attrs[0]?.attrId || attrs['0']?.attrId;
}

function collectMsgRecords(value, records = [], depth = 0, seen = new WeakSet()) {
    if (!value || depth > 7 || records.length > 200 || typeof value !== 'object') {
        return records;
    }
    if (seen.has(value)) {
        return records;
    }
    seen.add(value);
    if (Array.isArray(value)) {
        for (const item of value) {
            collectMsgRecords(item, records, depth + 1, seen);
        }
        return records;
    }
    if (value instanceof Uint8Array || value instanceof Map) {
        return records;
    }
    if ((value.msgId !== undefined || value.msgSeq !== undefined) &&
        (value.msgAttrs !== undefined || Array.isArray(value.elements))) {
        records.push(value);
        return records;
    }
    for (const key of ['payload', 'msgList', 'records', 'data', 'result', 'msgRecords', 'msgRecord']) {
        collectMsgRecords(value[key], records, depth + 1, seen);
    }
    return records;
}

function eventHasMessageAttr(response, result, attrId, sendStatus) {
    const records = [
        ...collectMsgRecords(response?.payload),
        ...collectMsgRecords(result?.payload),
        ...collectMsgRecords(result)
    ];
    const statuses = sendStatus === undefined
        ? null
        : (Array.isArray(sendStatus) ? sendStatus : [sendStatus]).map(Number);
    return records.some(record => {
        const recordAttrId = getMsgAttrId(record);
        return recordAttrId !== undefined && String(recordAttrId) === String(attrId) &&
            (!statuses || statuses.includes(Number(record.sendStatus)));
    });
}

function normalizeComparablePath(filePath) {
    return String(filePath || '').replace(/\//g, '\\').toLowerCase();
}

function valueContainsPath(value, filePath, depth = 0, seen = new WeakSet()) {
    if (!filePath || value === undefined || value === null || depth > 8) {
        return false;
    }
    if (typeof value === 'string') {
        return normalizeComparablePath(value) === normalizeComparablePath(filePath);
    }
    if (typeof value !== 'object' || value instanceof Uint8Array || seen.has(value)) {
        return false;
    }
    seen.add(value);
    const entries = value instanceof Map ? value.values() : Object.values(value);
    for (const item of entries) {
        if (valueContainsPath(item, filePath, depth + 1, seen)) {
            return true;
        }
    }
    return false;
}

function matchesNativeResponse(waitResponse, callbackId, response, result) {
    if (waitResponse === true) {
        return response?.callbackId === callbackId;
    }
    if (typeof waitResponse === 'function') {
        try {
            return waitResponse(response, result, callbackId) === true;
        } catch {
            return false;
        }
    }
    if (typeof waitResponse === 'object' && waitResponse) {
        const cmdName = waitResponse.cmdName;
        if (cmdName && response?.cmdName !== cmdName && result?.cmdName !== cmdName) {
            return false;
        }
        if (waitResponse.attrId !== undefined) {
            return eventHasMessageAttr(response, result, waitResponse.attrId, waitResponse.sendStatus);
        }
        if (waitResponse.filePath !== undefined) {
            return valueContainsPath(response, waitResponse.filePath) ||
                valueContainsPath(result, waitResponse.filePath);
        }
        return true;
    }
    if (Array.isArray(waitResponse)) {
        return waitResponse.includes(response?.cmdName) || waitResponse.includes(result?.cmdName);
    }
    return response?.cmdName === waitResponse || result?.cmdName === waitResponse;
}

function assertBrowserWindow(browserWindow) {
    if (!browserWindow || browserWindow.isDestroyed?.() || browserWindow.webContents?.isDestroyed?.()) {
        throw new Error('BrowserWindow is unavailable.');
    }
}

function getWindowState(browserWindow) {
    let state = windowStates.get(browserWindow);
    if (!state) {
        state = {
            handlers: new Map(),
            requestHandlers: new Map(),
            installed: false,
            originalSend: null,
            waiters: new Set(),
            disposed: false
        };
        windowStates.set(browserWindow, state);
    }
    return state;
}

function removeWaiter(state, waiter) {
    if (!waiter || waiter.settled) {
        return false;
    }
    waiter.settled = true;
    clearTimeout(waiter.timer);
    state.waiters.delete(waiter);
    return true;
}

function disposeWindow(browserWindow, state) {
    if (state.disposed) {
        return;
    }
    state.disposed = true;
    for (const waiter of Array.from(state.waiters)) {
        if (removeWaiter(state, waiter)) {
            waiter.reject(new Error('BrowserWindow was closed before the native response arrived.'));
        }
    }
    state.handlers.clear();
    state.requestHandlers.clear();
    requestWindows.delete(browserWindow);
    windowStates.delete(browserWindow);
}

function installNativeRequestInterceptor() {
    if (requestInterceptorInstalled) {
        return;
    }
    const originalEmit = ipcMain.emit;
    ipcMain.emit = function(channel, ...args) {
        let blocked = false;
        if (typeof channel === 'string' && channel.startsWith('RM_IPCFROM_RENDERER')) {
            const sender = args[0]?.sender;
            for (const [browserWindow, state] of requestWindows) {
                if (browserWindow.webContents !== sender) {
                    continue;
                }
                for (const [handler, onError] of Array.from(state.requestHandlers)) {
                    try {
                        blocked = handler(browserWindow, channel, args) === true || blocked;
                    } catch (error) {
                        try {
                            onError?.(error);
                        } catch {
                        }
                    }
                }
                break;
            }
        }
        if (blocked) {
            return true;
        }
        return Reflect.apply(originalEmit, this, [channel, ...args]);
    };
    requestInterceptorInstalled = true;
}

function notifyNativeWaiters(state, channel, args) {
    const [response, result] = args;
    for (const waiter of Array.from(state.waiters)) {
        if (waiter.channel !== channel ||
            !matchesNativeResponse(waiter.waitResponse, waiter.callbackId, response, result)) {
            continue;
        }
        if (removeWaiter(state, waiter)) {
            waiter.resolve(extractNativeResult(response, result));
        }
    }
}

function installNativeIpc(browserWindow) {
    assertBrowserWindow(browserWindow);
    const state = getWindowState(browserWindow);
    if (state.installed) {
        return;
    }
    const webContents = browserWindow.webContents;
    state.originalSend = webContents.send.bind(webContents);
    webContents.send = function(channel, ...args) {
        notifyNativeWaiters(state, channel, args);
        let blocked = false;
        for (const [handler, onError] of Array.from(state.handlers)) {
            try {
                blocked = handler(browserWindow, channel, args) === true || blocked;
            } catch (error) {
                try {
                    onError?.(error);
                } catch {
                }
            }
        }
        if (blocked) {
            return undefined;
        }
        return state.originalSend(channel, ...args);
    };
    state.installed = true;
    const dispose = () => disposeWindow(browserWindow, state);
    browserWindow.once('closed', dispose);
    webContents.once('destroyed', dispose);
}

function addNativeSendHandler(browserWindow, handler, onError) {
    if (typeof handler !== 'function') {
        throw new TypeError('A native send handler is required.');
    }
    installNativeIpc(browserWindow);
    const state = getWindowState(browserWindow);
    state.handlers.set(handler, onError);
    return () => state.handlers.delete(handler);
}

function addNativeRequestHandler(browserWindow, handler, onError) {
    if (typeof handler !== 'function') {
        throw new TypeError('A native request handler is required.');
    }
    installNativeIpc(browserWindow);
    installNativeRequestInterceptor();
    const state = getWindowState(browserWindow);
    state.requestHandlers.set(handler, onError);
    requestWindows.set(browserWindow, state);
    return () => state.requestHandlers.delete(handler);
}

function createNativeEventWaiter(browserWindow, waitResponse, timeoutMs = 10000) {
    installNativeIpc(browserWindow);
    const state = getWindowState(browserWindow);
    const responseChannel = `RM_IPCFROM_MAIN${browserWindow.webContents.id}`;
    let waiter;
    const promise = new Promise((resolve, reject) => {
        waiter = {
            callbackId: null,
            channel: responseChannel,
            reject,
            resolve,
            settled: false,
            waitResponse,
            timer: setTimeout(() => {
                if (removeWaiter(state, waiter)) {
                    reject(new Error(`Timed out waiting for native event: ${safeJson(waitResponse)}`));
                }
            }, timeoutMs)
        };
        state.waiters.add(waiter);
    });
    return {
        promise,
        cancel: error => {
            if (!removeWaiter(state, waiter)) {
                return false;
            }
            if (error) {
                waiter.reject(error);
            }
            return true;
        }
    };
}

async function nativeInvoke(
    browserWindow,
    eventName,
    cmdName,
    payload = [],
    waitResponse = true,
    timeoutMs = 10000,
    cmdType = 'invoke'
) {
    installNativeIpc(browserWindow);
    const webContentId = browserWindow.webContents.id;
    const callbackId = crypto.randomUUID();
    const requestChannel = `RM_IPCFROM_RENDERER${webContentId}`;
    const responseChannel = `RM_IPCFROM_MAIN${webContentId}`;
    const listeners = ipcMain.listeners(requestChannel);
    if (!listeners.length) {
        throw new Error(`No QQNT native IPC listener was found for ${requestChannel}.`);
    }
    const request = {
        peerId: webContentId,
        callbackId,
        type: 'request',
        eventName
    };
    const command = { cmdName, cmdType, payload };

    return await new Promise((resolve, reject) => {
        const state = getWindowState(browserWindow);
        let waiter = null;
        if (waitResponse) {
            waiter = {
                callbackId,
                channel: responseChannel,
                reject,
                resolve,
                settled: false,
                waitResponse,
                timer: setTimeout(() => {
                    if (removeWaiter(state, waiter)) {
                        reject(new Error(`Timed out waiting for native response: ${cmdName}`));
                    }
                }, timeoutMs)
            };
            state.waiters.add(waiter);
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
            removeWaiter(state, waiter);
            reject(error);
        }
    });
}

async function qqNativeInvoke(browserWindow, eventName, cmdName, payload = [], waitResponse = true, timeoutMs = 10000) {
    return await nativeInvoke(browserWindow, eventName, cmdName, payload, waitResponse, timeoutMs, 'invoke');
}

module.exports = {
    addNativeRequestHandler,
    addNativeSendHandler,
    createNativeEventWaiter,
    installNativeIpc,
    isNativeFailure,
    nativeInvoke,
    qqNativeInvoke,
    unwrapNativeValue
};
