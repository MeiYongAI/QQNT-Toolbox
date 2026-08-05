'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const silkWasmEntry = require.resolve('silk-wasm');
delete require.cache[silkWasmEntry];
const {
    estimateSilkDurationMs,
    makePcm16Wav
} = require('../src/voice/media');
const injectedVoiceFileSenderUi = require('../src/voice/renderer-controller');

test('loads voice media helpers without eagerly loading silk-wasm', () => {
    assert.equal(require.cache[silkWasmEntry], undefined);
});

test('does not retain unused voice send waiters or delayed Silk cleanup timers', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'voice-file-sender.js'), 'utf8');

    assert.doesNotMatch(source, /createNativeEventWaiter/);
    assert.doesNotMatch(source, /setTimeout\(\(\) => \{\s*fs\.unlink\(silkPath\)/);
    assert.match(source, /await fs\.unlink\(silkPath\)\.catch/);
});

test('defers missing library durations and incrementally renders large libraries', () => {
    const senderSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'voice-file-sender.js'), 'utf8');
    const listSource = senderSource.match(/async function getLibraryItems\([\s\S]*?\n}\n\nfunction toLibraryViewItems/)[0];
    const panelSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'voice', 'library-panel.js'), 'utf8');
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'voice', 'renderer-controller.js'), 'utf8');

    assert.doesNotMatch(listSource, /await detectLibraryDurationSeconds/);
    assert.match(senderSource, /const LIBRARY_DURATION_CONCURRENCY = 2;/);
    assert.match(senderSource, /function createLibraryIndexLookup\(/);
    assert.match(senderSource, /function queueLibraryDurationRefresh\(/);
    assert.match(senderSource, /persistLibraryDurationUpdates/);
    assert.match(panelSource, /const LIST_INITIAL_RENDER_COUNT = 48;/);
    assert.match(panelSource, /function appendListRows\(/);
    assert.match(panelSource, /list\.addEventListener\('scroll', renderMoreListRows, \{ passive: true \}\)/);
    assert.match(panelSource, /function updateLibraryItems\(/);
    assert.match(rendererSource, /bridge\.updateLibraryItems = payload => libraryPanel\.updateLibraryItems\?\.\(payload\);/);
});

test('uses the built-in FFmpeg resampler without requiring optional libsoxr', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'voice', 'media.js'), 'utf8');

    assert.match(source, /`aresample=\$\{TARGET_SILK_SAMPLE_RATE\}`/);
    assert.doesNotMatch(source, /resampler=soxr|precision=28/);
});

test('estimates Silk duration from complete frames', () => {
    const makeFrame = payload => {
        const size = Buffer.alloc(2);
        size.writeUInt16LE(payload.length);
        return Buffer.concat([size, payload]);
    };
    const silk = Buffer.concat([
        Buffer.from([0x02]),
        Buffer.from('#!SILK_V3', 'latin1'),
        makeFrame(Buffer.from([1, 2])),
        makeFrame(Buffer.from([3, 4, 5]))
    ]);

    assert.equal(estimateSilkDurationMs(silk), 40);
});

test('writes a valid PCM16 WAV header', () => {
    const pcm = Buffer.from([0, 0, 1, 0]);
    const wav = makePcm16Wav(pcm, 24000, 1);

    assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
    assert.equal(wav.readUInt32LE(24), 24000);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(40), pcm.length);
    assert.deepEqual(wav.subarray(44), pcm);
});

function createVoiceRendererHarness() {
    const previousGlobals = {
        window: global.window,
        document: global.document,
        Element: global.Element,
        getComputedStyle: global.getComputedStyle
    };
    const listeners = new Map();
    let extension = null;
    class MockElement {
        constructor(text = '') {
            this.innerText = text;
            this.textContent = text;
        }

        matches(selector) {
            return selector === '.q-context-menu-item';
        }
    }
    const documentMock = {
        body: new MockElement(),
        documentElement: new MockElement(),
        addEventListener(name, handler) {
            const handlers = listeners.get(name) || [];
            handlers.push(handler);
            listeners.set(name, handlers);
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        elementFromPoint: () => null
    };
    const windowMock = {
        __voiceFileSenderEnabled: true,
        __voiceFileSenderSaveInContextMenuEnabled: true,
        __voiceFileSenderForwardInContextMenuEnabled: true,
        __qqntToolboxMessageContextMenu: {
            registerExtension(value) {
                extension = value;
            }
        },
        addEventListener() {}
    };
    const panelFactory = () => ({
        close() {},
        contains: () => false,
        handleEscape() {},
        isOpen: () => false,
        open() {},
        playPreview() {},
        setLibrary() {},
        setStatus() {},
        updateLibraryItems() {},
        updatePlacement() {}
    });

    global.window = windowMock;
    global.document = documentMock;
    global.Element = MockElement;
    global.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
    const actionPromise = injectedVoiceFileSenderUi(panelFactory, '');
    return {
        actionPromise,
        extension,
        listeners,
        MockElement,
        window: windowMock,
        restore() {
            global.window = previousGlobals.window;
            global.document = previousGlobals.document;
            global.Element = previousGlobals.Element;
            global.getComputedStyle = previousGlobals.getComputedStyle;
        }
    };
}

function createVoiceMenuRequest(record, getNativeItemsForContext) {
    const originalContext = { msgRecord: record };
    const menuContext = { menuContext: originalContext };
    const menu = { _: { ctx: menuContext } };
    Object.defineProperty(menu, 'menuContext', {
        get: () => menuContext.menuContext,
        set: value => {
            menuContext.menuContext = value;
        }
    });
    return {
        menu,
        menuContext,
        originalContext,
        request: {
            menu,
            originalContext,
            context: originalContext,
            getNativeItemsForContext
        }
    };
}

test('keeps the real voice menu and binds only native forward to a text placeholder', async () => {
    const harness = createVoiceRendererHarness();
    try {
        assert.ok(harness.extension);
        const voiceRecord = {
            msgId: 'voice-message-1',
            playbackState: 'paused',
            transcription: { text: 'converted voice text' },
            elements: [{
                elementType: 4,
                pttElement: { fileName: 'voice.amr', duration: 2 }
            }]
        };
        let speechHandled = 0;
        const speechItem = {
            type: 15,
            text: '转文字',
            icon: 'native-speech-icon',
            handler: () => speechHandled++
        };
        const collectItem = { type: 8, text: '收藏' };
        const forwardedArgs = [];
        const forwardPrototype = {
            handler(...args) {
                forwardedArgs.push({ args, thisValue: this });
            },
            when: () => true
        };
        const nativeForward = Object.assign(Object.create(forwardPrototype), {
            type: 6,
            text: '转发',
            icon: 'one_by_one_forward'
        });
        const request = createVoiceMenuRequest(voiceRecord, context => {
            assert.notEqual(context, request.originalContext);
            assert.equal(context.msgRecord.msgId, voiceRecord.msgId);
            assert.equal(context.msgRecord.elements[0].elementType, 1);
            return [nativeForward];
        });

        const prepared = harness.extension.beforeOpen(request.request);
        assert.equal(prepared, request.request);
        assert.equal(prepared.context, request.originalContext);
        const transformed = harness.extension.transformItems({
            ...prepared,
            items: [speechItem, collectItem]
        });
        assert.equal(transformed.items[0], speechItem);
        assert.equal(transformed.items[0].type, 15);
        assert.notEqual(transformed.items[1], nativeForward);
        assert.equal(Object.getPrototypeOf(transformed.items[1]), forwardPrototype);
        assert.equal(transformed.items[1].type, 6);
        assert.equal(transformed.items[2], collectItem);

        const clickHandler = harness.listeners.get('click')[0];
        clickHandler({ composedPath: () => [new harness.MockElement('转文字')] });
        transformed.items[0].handler();
        assert.equal(speechHandled, 1);
        assert.equal(request.menuContext.menuContext, request.originalContext);

        const nativeContext = { sendable: true, sourceEvent: 'source-event' };
        const nativeEvent = { type: 'click' };
        clickHandler({ composedPath: () => [new harness.MockElement('转发')] });
        transformed.items[1].handler(voiceRecord, voiceRecord.elements[0], nativeContext, nativeEvent);
        assert.equal(forwardedArgs.length, 1);
        assert.equal(forwardedArgs[0].thisValue, nativeForward);
        assert.equal(forwardedArgs[0].args[0].msgId, voiceRecord.msgId);
        assert.equal(forwardedArgs[0].args[0].elements[0].elementType, 1);
        assert.equal(forwardedArgs[0].args[1], forwardedArgs[0].args[0].elements[0]);
        assert.equal(forwardedArgs[0].args[2], nativeContext);
        assert.equal(forwardedArgs[0].args[3], nativeEvent);
        assert.equal((await harness.actionPromise).type, 'prepareNativePttForward');
    } finally {
        harness.restore();
    }
});
