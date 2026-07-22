'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    loadReactionEmojiCatalog,
    normalizeReactionRequest
} = require('../src/reaction-catalog');

const rendererSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'reaction-limit.js'),
    'utf8'
);
const rendererModule = import(`data:text/javascript;base64,${Buffer.from(rendererSource).toString('base64')}`);

test('recognizes QQ reaction image IDs and clicked states', async () => {
    const {
        applyReactionImageStyle,
        dismissReactionPanel,
        extractReactionEmojiId,
        extractUnicodeReactionEmojiId,
        getRecordReactionState
    } = await rendererModule;

    assert.equal(extractReactionEmojiId('appimg:///qqface-reaction/14.png'), '14');
    assert.equal(extractReactionEmojiId('appimg:///qqface-reaction/0.png'), '0');
    assert.equal(extractReactionEmojiId('file:///default-emojis/395.png?cache=1'), '395');
    assert.equal(extractReactionEmojiId(
        'appimg://D:/Tencent/EmojiSystermResource/478/png/478.png'
    ), '478');
    assert.equal(extractReactionEmojiId('not-an-emoji.png'), '');
    assert.equal(extractUnicodeReactionEmojiId('😊'), '128522');
    assert.equal(extractUnicodeReactionEmojiId('☺️'), '9786');
    assert.equal(extractUnicodeReactionEmojiId('OK'), '');
    assert.equal(getRecordReactionState({
        emojiLikesList: [{ emojiId: '14', isClicked: 'true' }]
    }, '14'), true);
    assert.equal(getRecordReactionState({
        emojiLikesList: [{ emojiId: '14', isClicked: false }]
    }, '14'), false);

    const image = { style: {}, width: 0, height: 0 };
    applyReactionImageStyle(image);
    assert.deepEqual(image, {
        style: {
            display: 'block',
            width: '24px',
            height: '24px',
            maxWidth: '24px',
            maxHeight: '24px',
            objectFit: 'contain'
        },
        width: 24,
        height: 24
    });

    const originalDocument = global.document;
    const originalMouseEvent = global.MouseEvent;
    const originalWindow = global.window;
    const dispatched = [];
    try {
        global.document = { documentElement: { dispatchEvent: event => dispatched.push(event) } };
        global.window = {};
        global.MouseEvent = class FakeMouseEvent {
            constructor(type, options) {
                this.type = type;
                this.options = options;
            }
        };
        assert.equal(dismissReactionPanel(), true);
        assert.equal(dispatched.length, 1);
        assert.equal(dispatched[0].type, 'click');
        assert.equal(dispatched[0].options.bubbles, true);
    } finally {
        global.document = originalDocument;
        global.MouseEvent = originalMouseEvent;
        global.window = originalWindow;
    }
});

test('normalizes safe group reaction requests', () => {
    assert.deepEqual(normalizeReactionRequest({
        peer: { chatType: 2, peerUid: '123456', guildId: '' },
        msgSeq: '987654321',
        emojiId: '14',
        setEmoji: true
    }), {
        peer: { chatType: 2, peerUid: '123456', guildId: '' },
        msgSeq: '987654321',
        emojiId: '14',
        emojiType: '1',
        setEmoji: true
    });
    assert.deepEqual(normalizeReactionRequest({
        peer: { chatType: 2, peerUid: '123456', guildId: '' },
        msgSeq: '987654321',
        emojiId: '128078',
        setEmoji: false
    }), {
        peer: { chatType: 2, peerUid: '123456', guildId: '' },
        msgSeq: '987654321',
        emojiId: '128078',
        emojiType: '2',
        setEmoji: false
    });
    assert.equal(normalizeReactionRequest({
        peer: { chatType: 1, peerUid: 'u_private' },
        msgSeq: '1',
        emojiId: '14',
        setEmoji: true
    }), null);
    assert.equal(normalizeReactionRequest({
        peer: { chatType: 2, peerUid: '123456' },
        msgSeq: '1',
        emojiId: '../14',
        setEmoji: true
    }), null);
});

test('closes intercepted reactions by default and keeps them open when configured', async () => {
    const {
        createReactionLimitController,
        keepNativeReactionPanelOpenForCurrentEvent
    } = await rendererModule;
    const originals = {
        document: global.document,
        Element: global.Element,
        MouseEvent: global.MouseEvent,
        MutationObserver: global.MutationObserver,
        window: global.window
    };
    const listeners = new Map();
    const outsideClicks = [];
    const sent = [];
    let catalogReads = 0;
    let observerStarts = 0;

    function createPanelOwner() {
        let showPanel = true;
        let watcher = null;
        const setupState = {
            stickerPanelPos: 'top: 0; left: 0'
        };
        Object.defineProperty(setupState, 'showPanel', {
            configurable: true,
            enumerable: true,
            get: () => showPanel,
            set: value => {
                showPanel = value;
                watcher?.(value);
            }
        });
        return {
            isUnmounted: false,
            setupState,
            proxy: {
                $watch: (_source, callback) => {
                    watcher = callback;
                    return () => {
                        watcher = null;
                    };
                }
            }
        };
    }

    class FakeElement {
        constructor(emojiId, more = false, toolbox = true) {
            this.dataset = { qqntToolboxReactionId: emojiId };
            this.textContent = '';
            this.more = more;
            this.classList = {
                contains: className => toolbox && className === 'qqnt-toolbox-reaction-item'
            };
            this.panel = null;
        }

        closest(selector) {
            if (selector === '.menu-stickers-panel') {
                return this.panel;
            }
            if (this.more) {
                return selector.includes('.more-reaction-item') ? this : null;
            }
            return selector.includes('.menu-stickers-item') ? this : null;
        }

        matches() {
            return false;
        }

        querySelectorAll() {
            return [];
        }

        querySelector(selector) {
            if (!this.more || selector !== 'use') {
                return null;
            }
            return {
                getAttribute: name => name === 'xlink:href'
                    ? '/resource/icons/expression_add_24.svg#expression_add_24'
                    : null
            };
        }
    }

    try {
        global.Element = FakeElement;
        global.MouseEvent = class FakeMouseEvent {
            constructor(type, options) {
                this.type = type;
                this.options = options;
            }
        };
        global.MutationObserver = class FakeMutationObserver {
            observe() {
                observerStarts += 1;
            }
            disconnect() {}
        };
        global.window = {};
        global.document = {
            body: {},
            documentElement: { dispatchEvent: event => outsideClicks.push(event) },
            addEventListener: (type, listener) => listeners.set(type, listener),
            removeEventListener: (type, listener) => {
                if (listeners.get(type) === listener) {
                    listeners.delete(type);
                }
            },
            querySelector: () => null,
            querySelectorAll: () => []
        };

        const panelOwner = createPanelOwner();
        const nativeItem = new FakeElement('66');
        nativeItem.panel = { __VUE__: [{ parent: panelOwner }] };
        assert.equal(keepNativeReactionPanelOpenForCurrentEvent(nativeItem), true);
        panelOwner.setupState.showPanel = false;
        assert.equal(panelOwner.setupState.showPanel, true);
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(panelOwner.setupState.showPanel, true);

        const record = { msgSeq: '42', emojiLikesList: [] };
        const createController = () => createReactionLimitController({
            getCatalog: () => {
                catalogReads += 1;
                return [];
            },
            getPeer: () => ({ chatType: 2, peerUid: '10001' }),
            resolveRecord: () => record,
            sendReaction: payload => sent.push(payload)
        });
        const createEvent = (target = new FakeElement('128522')) => ({
            target,
            preventDefault() {},
            stopPropagation() {},
            stopImmediatePropagation() {}
        });

        const defaultController = createController();
        defaultController.sync({ removeLimit: true, keepOpen: false });
        defaultController.rememberContext(record);
        assert.equal(catalogReads, 1);
        assert.equal(observerStarts, 0);
        listeners.get('click')({ target: new FakeElement('', true) });
        assert.equal(observerStarts, 1);
        listeners.get('click')(createEvent());
        assert.equal(sent.length, 1);
        assert.equal(outsideClicks.length, 1);
        defaultController.dispose();

        const persistentController = createController();
        persistentController.sync({ removeLimit: false, keepOpen: true });
        persistentController.rememberContext(record);
        assert.equal(catalogReads, 1);

        const persistentOwner = createPanelOwner();
        const persistentNativeItem = new FakeElement('66', false, false);
        persistentNativeItem.panel = { __VUE__: [{ parent: persistentOwner }] };
        listeners.get('click')(createEvent(persistentNativeItem));
        assert.equal(sent.length, 1);
        persistentOwner.setupState.showPanel = false;
        assert.equal(persistentOwner.setupState.showPanel, true);
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(persistentOwner.setupState.showPanel, true);

        listeners.get('click')(createEvent());
        assert.equal(sent.length, 2);
        assert.equal(outsideClicks.length, 1);
        persistentController.dispose();
    } finally {
        global.document = originals.document;
        global.Element = originals.Element;
        global.MouseEvent = originals.MouseEvent;
        global.MutationObserver = originals.MutationObserver;
        global.window = originals.window;
    }
});

test('loads the QAuxiliary-unfiltered Unicode reactions from QQ data', () => {
    const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-toolbox-reaction-'));
    const directory = path.join(
        resourcesPath,
        'nt_qq',
        'global',
        'nt_data',
        'Emoji',
        'emoji-resource'
    );
    const imageDirectory = path.join(directory, 'emoji_res');
    fs.mkdirSync(directory, { recursive: true });
    fs.mkdirSync(imageDirectory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'face_config.json'), JSON.stringify({
        emoji: [
            { QCid: '128078', AQLid: '26', QDes: '/鄙视' },
            { QCid: '128591', AQLid: '27', QDes: '/合十' },
            { QCid: '128070', AQLid: '31', QDes: '/向上' },
            { QCid: '128522', AQLid: '0', QDes: '/嘿嘿' }
        ]
    }));
    fs.writeFileSync(path.join(imageDirectory, 'emoji_026.png'), Buffer.from([1, 2, 3]));
    fs.writeFileSync(path.join(imageDirectory, 'emoji_027.png'), Buffer.from([4, 5, 6]));
    fs.writeFileSync(path.join(imageDirectory, 'emoji_031.png'), Buffer.from([7, 8, 9]));
    fs.writeFileSync(path.join(imageDirectory, 'emoji_000.png'), Buffer.from([7, 8, 9]));

    try {
        const catalog = loadReactionEmojiCatalog([resourcesPath]);
        assert.deepEqual(catalog.map(item => [item.id, item.assetId, item.label]), [
            ['128078', '26', '鄙视'],
            ['128591', '27', '合十'],
            ['128070', '31', '中指']
        ]);
        assert.ok(catalog.every(item => item.src.startsWith('data:image/png;base64,')));
    } finally {
        fs.rmSync(resourcesPath, { recursive: true, force: true });
    }
});
