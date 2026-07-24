'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
    WINDOW_SHAKE_RECEIVE_COMMAND,
    createWindowShakeElement,
    createWindowShakeController,
    isWindowShakeRecord,
    shouldArmWindowShakeGuard
} = require('../src/window-shake');

function createShakeRecord(chatType = 1, faceType = 5, faceIndex = 1) {
    return {
        chatType,
        msgId: '10001',
        elements: [{
            elementType: 6,
            faceElement: {
                faceIndex,
                faceType,
                pokeType: 1
            }
        }]
    };
}

function createContext(commandName, records) {
    return {
        commandNames: new Set([commandName]),
        records
    };
}

class FakeBrowserWindow extends EventEmitter {
    isDestroyed() {
        return false;
    }
}

test('builds the minimal QQNT private window-shake face element', () => {
    assert.deepEqual(createWindowShakeElement(), {
        elementType: 6,
        elementId: '',
        faceElement: {
            faceIndex: 1,
            faceType: 5,
            pokeType: 1
        }
    });
});

test('recognizes the private shake face without confusing it with poke tips', () => {
    assert.equal(isWindowShakeRecord(createShakeRecord()), true);
    assert.equal(isWindowShakeRecord(createShakeRecord(2)), false);
    assert.equal(isWindowShakeRecord(createShakeRecord(1, 3)), false);
    assert.equal(isWindowShakeRecord(createShakeRecord(1, 5, 2)), false);
    assert.equal(isWindowShakeRecord({
        chatType: 1,
        elements: [{
            grayTipElement: {
                jsonGrayTipElement: { busiId: '1061' }
            }
        }]
    }), false);
});

test('arms for a received shake even when the batch also contains normal messages', () => {
    const mixedContext = createContext(WINDOW_SHAKE_RECEIVE_COMMAND, [
        createShakeRecord(),
        { chatType: 1, msgId: '10002', elements: [{ elementType: 1 }] }
    ]);

    assert.equal(shouldArmWindowShakeGuard(mixedContext, true), true);
    assert.equal(shouldArmWindowShakeGuard(mixedContext, false), false);
    assert.equal(shouldArmWindowShakeGuard(
        createContext('other-command', [createShakeRecord()]),
        true
    ), false);
});

test('prevents window movement only while the received-shake guard is active', () => {
    let time = 1000;
    let blocked = 0;
    const browserWindow = new FakeBrowserWindow();
    const controller = createWindowShakeController({
        guardDurationMs: 500,
        now: () => time,
        onBlocked: () => blocked += 1
    });
    const context = createContext(WINDOW_SHAKE_RECEIVE_COMMAND, [createShakeRecord()]);
    const event = { preventDefault() { this.prevented = true; } };

    assert.equal(controller.install(browserWindow), true);
    assert.equal(controller.install(browserWindow), false);
    browserWindow.emit('will-move', event);
    assert.equal(event.prevented, undefined);

    assert.equal(controller.arm(browserWindow, context, true), true);
    browserWindow.emit('will-move', event);
    assert.equal(event.prevented, true);
    assert.equal(blocked, 1);

    event.prevented = false;
    time = 1500;
    browserWindow.emit('will-move', event);
    assert.equal(event.prevented, false);
    assert.equal(blocked, 1);
});

test('keeps native messages flowing and installs the window-level guard', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
    const handlerSource = mainSource.slice(
        mainSource.indexOf('function handleNativeSend'),
        mainSource.indexOf('function installNativeSendHandler')
    );

    assert.match(handlerSource, /windowShakeController\.arm\(/);
    assert.match(handlerSource, /processMessageUpdates[\s\S]*return false;/);
    assert.doesNotMatch(handlerSource, /return blockWindowShake/);
    assert.match(mainSource, /windowShakeController\.install\(browserWindow\)/);
    assert.match(mainSource, /CHANNEL_SEND_WINDOW_SHAKE/);
    assert.match(mainSource, /msgElements:\s*\[createWindowShakeElement\(\)\]/);
    assert.match(mainSource, /Number\(peer\?\.chatType\) !== 1/);
    assert.match(preloadSource, /sendWindowShake:\s*payload => ipcRenderer\.invoke\(CHANNEL_SEND_WINDOW_SHAKE, payload\)/);
});

test('mounts a native-style send button only for supported private chats', () => {
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    const toolbarSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'chat-toolbar-entry.js'), 'utf8');

    assert.match(rendererSource, /entertainment\.sendWindowShake/);
    assert.match(rendererSource, /Number\(peer\?\.chatType\) === 1/);
    assert.match(rendererSource, /!context\.isTemporary/);
    assert.match(rendererSource, /createNativeChatToolbarEntry\(toolbar/);
    assert.match(rendererSource, /sendWindowShake\(\{ peer \}\)/);
    assert.match(toolbarSource, /template\.cloneNode\(true\)/);
    assert.match(toolbarSource, /q-tooltips-v2--small/);
    assert.match(toolbarSource, /bindNativeChatToolbarAction/);
});
