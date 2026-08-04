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

test('keeps native speech-to-text bound to the voice record while adding voice forward', async () => {
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
        updatePlacement() {}
    });

    global.window = windowMock;
    global.document = documentMock;
    global.Element = MockElement;
    global.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
    try {
        const actionPromise = injectedVoiceFileSenderUi(panelFactory, '');
        assert.ok(extension);
        const voiceRecord = {
            msgId: 'voice-message-1',
            elements: [{
                elementType: 4,
                pttElement: { fileName: 'voice.amr', duration: 2 }
            }]
        };
        const originalContext = { msgRecord: voiceRecord };
        const menuContext = { menuContext: originalContext };
        const menu = { _: { ctx: menuContext } };
        Object.defineProperty(menu, 'menuContext', {
            get: () => menuContext.menuContext,
            set: value => {
                menuContext.menuContext = value;
            }
        });
        let speechHandled = 0;
        const speechItem = {
            type: 15,
            text: '转文字',
            handler: () => speechHandled++
        };
        const forwardItem = { type: 6, text: '转发', handler() {} };
        const request = {
            menu,
            originalContext,
            context: originalContext,
            getNativeItemsForContext: context => {
                assert.notEqual(context, originalContext);
                assert.equal(context.msgRecord.msgId, voiceRecord.msgId);
                assert.equal(context.msgRecord.elements[0].elementType, 1);
                return [forwardItem];
            }
        };

        assert.equal(extension.beforeOpen(request), request);
        const transformed = extension.transformItems({ ...request, items: [speechItem] });
        assert.equal(transformed.items[0], speechItem);
        assert.equal(transformed.items[1], forwardItem);
        assert.equal(menuContext.menuContext, originalContext);

        const clickHandler = listeners.get('click')[0];
        clickHandler({ composedPath: () => [new MockElement('转文字')] });
        transformed.items[0].handler();
        assert.equal(speechHandled, 1);
        assert.equal(menuContext.menuContext, originalContext);

        menu.menuContext = originalContext;
        extension.beforeOpen(request);
        extension.transformItems({ ...request, items: [speechItem] });
        clickHandler({ composedPath: () => [new MockElement('转发')] });
        const action = await actionPromise;
        assert.equal(action.type, 'prepareNativePttForward');
        assert.equal(action.sourceMsgId, voiceRecord.msgId);
        assert.notEqual(menuContext.menuContext, originalContext);
        assert.equal(menuContext.menuContext.msgRecord.elements[0].elementType, 1);
    } finally {
        global.window = previousGlobals.window;
        global.document = previousGlobals.document;
        global.Element = previousGlobals.Element;
        global.getComputedStyle = previousGlobals.getComputedStyle;
    }
});
