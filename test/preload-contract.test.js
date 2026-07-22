'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

function loadPreload(relativePath) {
    const exposed = new Map();
    const invocations = [];
    const listeners = [];
    const electron = {
        contextBridge: {
            exposeInMainWorld(name, api) {
                exposed.set(name, api);
            }
        },
        ipcRenderer: {
            invoke(channel, payload) {
                invocations.push([channel, payload]);
                return Promise.resolve({ channel, payload });
            },
            on(channel, listener) {
                listeners.push([channel, listener]);
            },
            removeListener(channel, listener) {
                const index = listeners.findIndex(item => item[0] === channel && item[1] === listener);
                if (index >= 0) {
                    listeners.splice(index, 1);
                }
            }
        }
    };
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === 'electron') {
            return electron;
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    const modulePath = require.resolve(path.join('..', relativePath));
    delete require.cache[modulePath];
    try {
        require(modulePath);
    } finally {
        Module._load = originalLoad;
        delete require.cache[modulePath];
    }
    return { exposed, invocations, listeners };
}

test('keeps LiteLoader preload entrypoints self-contained', () => {
    for (const relativePath of ['src/preload.js', 'src/recall-viewer-preload.js']) {
        const filePath = path.join(__dirname, '..', relativePath);
        const source = fs.readFileSync(filePath, 'utf8');
        const dependencies = Array.from(source.matchAll(/require\(['"]([^'"]+)['"]\)/g), match => match[1]);
        assert.deepEqual(dependencies, ['electron'], relativePath);
    }
});

test('exposes the main Toolbox preload API and stable IPC channels', async () => {
    const runtime = loadPreload('src/preload.js');
    const api = runtime.exposed.get('qqnt_toolbox');

    assert.ok(api);
    await api.recordDiagnosticEvent({ event: 'renderer.ready' });
    await api.runDiagnosticAction('copy-report');
    await api.openInlineMedia({ type: 'video' });
    await api.prepareInlineMedia({ galleryId: 'gallery', index: 1 });
    await api.repeatMessage({ id: 'repeat' });
    await api.stageFakeForwardImage({ name: 'image.png', data: new ArrayBuffer(1) });
    await api.resolveFakeForwardSenderName('12345678');
    await api.sendFakeForward({ messages: [] });
    await api.getReactionEmojiCatalog();
    await api.setMessageReaction({ emojiId: '14' });
    await api.sendPoke({ id: 'poke' });
    await api.recallPoke({ id: 'recall-poke' });
    await api.viewRecallMessages();
    await api.getRecallContacts();
    await api.getUpdateState();
    await api.checkForUpdates({ force: true });
    await api.prepareUpdate();
    await api.restartForUpdate();
    const unsubscribePreview = api.onInlineMediaPreview(() => {});
    const unsubscribeUpdate = api.onUpdateStateChanged(() => {});
    const unsubscribe = api.onConfigChanged(() => {});
    assert.equal(runtime.listeners.length, 3);
    unsubscribePreview();
    assert.equal(runtime.listeners.length, 2);
    unsubscribeUpdate();
    assert.equal(runtime.listeners.length, 1);
    unsubscribe();
    assert.equal(runtime.listeners.length, 0);
    assert.deepEqual(runtime.invocations.map(item => item[0]), [
        'qqnt-toolbox:diagnostic-event',
        'qqnt-toolbox:diagnostic-action',
        'qqnt-toolbox:open-inline-media',
        'qqnt-toolbox:prepare-inline-media',
        'qqnt-toolbox:repeat-message',
        'qqnt-toolbox:stage-fake-forward-image',
        'qqnt-toolbox:resolve-fake-forward-sender-name',
        'qqnt-toolbox:send-fake-forward',
        'qqnt-toolbox:get-reaction-catalog',
        'qqnt-toolbox:set-message-reaction',
        'qqnt-toolbox:send-poke',
        'qqnt-toolbox:recall-poke',
        'qqnt-toolbox:view-recall-messages',
        'qqnt-toolbox:get-recall-contacts',
        'qqnt-toolbox:get-update-state',
        'qqnt-toolbox:check-update',
        'qqnt-toolbox:prepare-update',
        'qqnt-toolbox:restart-update'
    ]);
});

test('exposes the standalone recall viewer preload API', async () => {
    const runtime = loadPreload('src/recall-viewer-preload.js');
    const api = runtime.exposed.get('qqntToolboxRecallViewer');

    assert.ok(api);
    await api.getData();
    await api.getAudioPreview({ msgId: '1', elementIndex: 0 });
    await api.jumpToMessage({ msgId: '1' });
    assert.deepEqual(runtime.invocations.map(item => item[0]), [
        'qqnt-toolbox:get-recall-viewer-data',
        'qqnt-toolbox:get-recall-audio-preview',
        'qqnt-toolbox:jump-recall-message'
    ]);
});

test('uses the Lite-Tools style standalone recall viewer', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

    assert.match(mainSource, /recall-viewer\.html/);
    assert.match(mainSource, /recall-viewer-preload\.js/);
    assert.doesNotMatch(mainSource, /recall-record-(?:query|summary|viewer)/);
    assert.doesNotMatch(rendererSource, /recall-record-viewer|isRecallViewer/);
});
