'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const test = require('node:test');

class FakeWebContents extends EventEmitter {
    constructor(id) {
        super();
        this.id = id;
        this.destroyed = false;
        this.sent = [];
    }

    isDestroyed() {
        return this.destroyed;
    }

    send(channel, ...args) {
        this.sent.push([channel, ...args]);
        return 'sent';
    }
}

class FakeBrowserWindow extends EventEmitter {
    constructor(id) {
        super();
        this.destroyed = false;
        this.webContents = new FakeWebContents(id);
    }

    isDestroyed() {
        return this.destroyed;
    }

    close() {
        this.destroyed = true;
        this.webContents.destroyed = true;
        this.webContents.emit('destroyed');
        this.emit('closed');
    }
}

function loadNativeIpc(ipcMain) {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === 'electron') {
            return { ipcMain };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    const modulePath = require.resolve('../src/native-ipc');
    delete require.cache[modulePath];
    try {
        return require(modulePath);
    } finally {
        Module._load = originalLoad;
    }
}

const ipcMain = new EventEmitter();
const nativeIpc = loadNativeIpc(ipcMain);

test('shares one send patch across handlers and honors blocking', () => {
    const browserWindow = new FakeBrowserWindow(11);
    const calls = [];
    const first = (_window, channel) => calls.push(`first:${channel}`);
    const second = (_window, channel) => {
        calls.push(`second:${channel}`);
        return channel === 'blocked';
    };

    nativeIpc.addNativeSendHandler(browserWindow, first);
    nativeIpc.addNativeSendHandler(browserWindow, first);
    nativeIpc.addNativeSendHandler(browserWindow, second);

    assert.equal(browserWindow.webContents.send('normal', 1), 'sent');
    assert.equal(browserWindow.webContents.send('blocked', 2), undefined);
    assert.deepEqual(calls, [
        'first:normal',
        'second:normal',
        'first:blocked',
        'second:blocked'
    ]);
    assert.deepEqual(browserWindow.webContents.sent, [['normal', 1]]);
});

test('resolves native invoke responses through the shared waiter', async () => {
    const browserWindow = new FakeBrowserWindow(12);
    const channel = 'RM_IPCFROM_RENDERER12';
    ipcMain.once(channel, (event, request, command) => {
        assert.equal(command.cmdName, 'nodeIKernelMsgService/example');
        assert.deepEqual(command.payload, ['payload']);
        event.sender.send(
            'RM_IPCFROM_MAIN12',
            { callbackId: request.callbackId, promiseStatue: 'full' },
            { result: 0, value: 'ok' }
        );
    });

    const result = await nativeIpc.qqNativeInvoke(
        browserWindow,
        'ntApi',
        'nodeIKernelMsgService/example',
        ['payload']
    );
    assert.deepEqual(result, { result: 0, value: 'ok' });
});

test('matches message events and rejects waiters when a window closes', async () => {
    const browserWindow = new FakeBrowserWindow(13);
    const completed = nativeIpc.createNativeEventWaiter(browserWindow, {
        cmdName: 'nodeIKernelMsgListener/onMsgInfoListUpdate',
        attrId: '42',
        sendStatus: [2]
    });
    const record = {
        msgId: '1',
        elements: [],
        msgAttrs: new Map([[0, { attrId: '42' }]]),
        sendStatus: 2
    };
    const event = {
        cmdName: 'nodeIKernelMsgListener/onMsgInfoListUpdate',
        payload: [record]
    };
    browserWindow.webContents.send('RM_IPCFROM_MAIN13', event, event);
    assert.equal((await completed.promise).cmdName, event.cmdName);

    const pending = nativeIpc.createNativeEventWaiter(browserWindow, 'never', 10000);
    browserWindow.close();
    await assert.rejects(pending.promise, /closed before the native response/);
});
