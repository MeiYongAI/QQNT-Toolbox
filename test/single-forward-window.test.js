'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
    createSingleForwardWindowController,
    getForwardGroupScope
} = require('../src/single-forward-window');

class FakeWebContents extends EventEmitter {
    constructor() {
        super();
        this.url = '';
        this.destroyed = false;
    }

    getURL() {
        return this.url;
    }

    isDestroyed() {
        return this.destroyed;
    }

    focus() {
    }
}

class FakeWindow extends EventEmitter {
    constructor(name, parent = null) {
        super();
        this.name = name;
        this.parent = parent;
        this.webContents = new FakeWebContents();
        this.destroyed = false;
        this.visible = false;
        this.skipTaskbar = false;
        this.bounds = { x: 100, y: 80, width: 720, height: 800 };
        this.maximized = false;
        this.fullScreen = false;
    }

    isDestroyed() {
        return this.destroyed;
    }

    getParentWindow() {
        return this.parent;
    }

    navigate(url) {
        this.webContents.url = url;
        this.webContents.emit('did-start-navigation', {}, url, false, true);
        if (!this.destroyed) {
            this.emit('ready-to-show');
        }
    }

    isVisible() {
        return this.visible;
    }

    show() {
        this.visible = true;
    }

    hide() {
        this.visible = false;
    }

    focus() {
        this.emit('focus');
    }

    isMinimized() {
        return false;
    }

    setSkipTaskbar(value) {
        this.skipTaskbar = value;
    }

    getBounds() {
        return { ...this.bounds };
    }

    getNormalBounds() {
        return { ...this.bounds };
    }

    setBounds(value) {
        this.bounds = { ...value };
    }

    isMaximized() {
        return this.maximized;
    }

    maximize() {
        this.maximized = true;
    }

    unmaximize() {
        this.maximized = false;
    }

    isFullScreen() {
        return this.fullScreen;
    }

    setFullScreen(value) {
        this.fullScreen = value;
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.visible = false;
        this.webContents.destroyed = true;
        this.emit('closed');
    }

    close() {
        let prevented = false;
        this.emit('close', {
            preventDefault: () => {
                prevented = true;
            }
        });
        if (!prevented) {
            this.destroy();
        }
        return prevented;
    }
}

function createHarness() {
    let enabled = true;
    let isolated = false;
    let focusedWindow = null;
    const events = [];
    const controller = createSingleForwardWindowController({
        isEnabled: () => enabled,
        isIsolationEnabled: () => isolated,
        isForwardUrl: url => String(url).includes('#/forward/'),
        getScopeKey: getForwardGroupScope,
        getFocusedWindow: () => focusedWindow,
        onEvent: (type, details) => events.push({ type, details })
    });
    return {
        controller,
        events,
        setEnabled: value => {
            enabled = value;
        },
        setIsolated: value => {
            isolated = value;
        },
        setFocused: value => {
            focusedWindow = value;
        }
    };
}

function getForwardUrl(peerUid, msgId, senderUid = '') {
    return `app://qq/index.html#/forward/${encodeURIComponent(JSON.stringify({
        rootMsg: {
            chatType: 2,
            peerUid,
            msgId,
            senderUid
        }
    }))}`;
}

test('extracts only group conversations as isolated forward scopes', () => {
    assert.equal(getForwardGroupScope(getForwardUrl('group-a', 'root')), 'group:group-a');
    assert.equal(getForwardGroupScope(
        `app://qq/index.html#/forward/${encodeURIComponent(JSON.stringify({
            rootMsg: { chatType: 1, peerUid: 'friend-a', msgId: 'root' }
        }))}`
    ), '');
    assert.equal(getForwardGroupScope('app://qq/index.html#/forward/not-json'), '');
});

test('keeps native nested pages and treats close as back', () => {
    const harness = createHarness();
    const main = new FakeWindow('main');
    const root = new FakeWindow('root', main);
    const nested = new FakeWindow('nested', root);

    harness.setFocused(main);
    harness.controller.install(root);
    root.navigate('app://qq/index.html#/forward/root');
    root.bounds = { x: 20, y: 30, width: 760, height: 840 };
    harness.setFocused(root);
    harness.controller.install(nested);
    nested.navigate('app://qq/index.html#/forward/nested');

    assert.equal(root.destroyed, false);
    assert.equal(root.visible, false);
    assert.equal(root.skipTaskbar, true);
    assert.equal(nested.visible, true);
    assert.deepEqual(nested.bounds, root.bounds);
    assert.equal(harness.controller.getState().activeWindow, nested);
    assert.equal(harness.controller.getState().depth, 2);

    nested.bounds = { x: 240, y: 180, width: 860, height: 680 };
    assert.equal(nested.close(), true);
    assert.equal(nested.destroyed, true);
    assert.equal(root.visible, true);
    assert.equal(root.skipTaskbar, false);
    assert.deepEqual(root.bounds, nested.bounds);
    assert.equal(harness.controller.getState().depth, 1);
    assert.equal(root.close(), false);
    assert.equal(root.destroyed, true);
});

test('opening a forward record from another window replaces the native page stack', () => {
    const harness = createHarness();
    const main = new FakeWindow('main');
    const root = new FakeWindow('root', main);
    const nested = new FakeWindow('nested', root);
    const replacement = new FakeWindow('replacement', main);

    harness.setFocused(main);
    harness.controller.install(root);
    root.navigate('app://qq/index.html#/forward/root');
    harness.setFocused(root);
    harness.controller.install(nested);
    nested.navigate('app://qq/index.html#/forward/nested');
    harness.setFocused(main);
    harness.controller.install(replacement);
    replacement.navigate('app://qq/index.html#/forward/replacement');

    assert.equal(root.destroyed, true);
    assert.equal(nested.destroyed, true);
    assert.equal(replacement.destroyed, false);
    assert.equal(replacement.visible, true);
    assert.equal(harness.controller.getState().activeWindow, replacement);
    assert.equal(harness.controller.getState().depth, 1);
});

test('keeps different groups isolated while replacing roots from the same group', () => {
    const harness = createHarness();
    const main = new FakeWindow('main');
    const groupA = new FakeWindow('group-a', main);
    const groupB = new FakeWindow('group-b', main);
    const nextGroupA = new FakeWindow('next-group-a', main);

    harness.setIsolated(true);
    harness.setFocused(main);
    harness.controller.install(groupA);
    groupA.navigate(getForwardUrl('10001', 'a-1', 'sender-a'));
    harness.controller.install(groupB);
    groupB.navigate(getForwardUrl('10002', 'b-1', 'sender-b'));

    assert.equal(groupA.visible, true);
    assert.equal(groupB.visible, true);
    assert.equal(harness.controller.getState().stackCount, 2);

    harness.setFocused(main);
    harness.controller.install(nextGroupA);
    nextGroupA.navigate(getForwardUrl('10001', 'a-2', 'another-sender'));

    assert.equal(groupA.destroyed, true);
    assert.equal(groupB.destroyed, false);
    assert.equal(nextGroupA.visible, true);
    assert.equal(harness.controller.getState().stackCount, 2);
    assert.deepEqual(
        harness.controller.getStates().map(state => state.scopeKey).sort(),
        ['group:10001', 'group:10002']
    );
});

test('treats a card opened inside a forward page as nested instead of another group root', () => {
    const harness = createHarness();
    const main = new FakeWindow('main');
    const groupA = new FakeWindow('group-a', main);
    const groupB = new FakeWindow('group-b', main);
    const nested = new FakeWindow('nested', groupA);

    harness.setIsolated(true);
    harness.setFocused(main);
    harness.controller.install(groupA);
    groupA.navigate(getForwardUrl('10001', 'a-root'));
    harness.controller.install(groupB);
    groupB.navigate(getForwardUrl('10002', 'b-root'));
    harness.setFocused(groupA);
    harness.controller.install(nested);
    nested.navigate(getForwardUrl('10002', 'nested-card'));

    const states = harness.controller.getStates();
    const groupAState = states.find(state => state.scopeKey === 'group:10001');
    const groupBState = states.find(state => state.scopeKey === 'group:10002');
    assert.equal(groupAState.activeWindow, nested);
    assert.equal(groupAState.depth, 2);
    assert.equal(groupBState.activeWindow, groupB);
    assert.equal(groupBState.depth, 1);
    assert.equal(groupB.destroyed, false);
});

test('uses one replacing root stack across groups while isolation is disabled', () => {
    const harness = createHarness();
    const main = new FakeWindow('main');
    const groupA = new FakeWindow('group-a', main);
    const groupB = new FakeWindow('group-b', main);

    harness.setFocused(main);
    harness.controller.install(groupA);
    groupA.navigate(getForwardUrl('10001', 'a-root'));
    harness.controller.install(groupB);
    groupB.navigate(getForwardUrl('10002', 'b-root'));

    assert.equal(groupA.destroyed, true);
    assert.equal(groupB.destroyed, false);
    assert.equal(harness.controller.getState().scopeKey, 'global');
    assert.equal(harness.controller.getState().stackCount, 1);
});

test('collapses isolated group roots to the focused window when isolation is disabled', () => {
    const harness = createHarness();
    const main = new FakeWindow('main');
    const groupA = new FakeWindow('group-a', main);
    const groupB = new FakeWindow('group-b', main);

    harness.setIsolated(true);
    harness.setFocused(main);
    harness.controller.install(groupA);
    groupA.navigate(getForwardUrl('10001', 'a-root'));
    harness.controller.install(groupB);
    groupB.navigate(getForwardUrl('10002', 'b-root'));

    harness.setFocused(groupA);
    harness.setIsolated(false);
    harness.controller.sync([groupA, groupB]);

    assert.equal(groupA.destroyed, false);
    assert.equal(groupB.destroyed, true);
    assert.equal(harness.controller.getState().activeWindow, groupA);
    assert.equal(harness.controller.getState().scopeKey, 'global');
    assert.equal(harness.controller.getState().stackCount, 1);
});

test('uses an explicit nested intent when the new window already has focus', () => {
    const harness = createHarness();
    const main = new FakeWindow('main');
    const root = new FakeWindow('root', main);
    const nested = new FakeWindow('nested');

    harness.setFocused(main);
    harness.controller.install(root);
    root.navigate('app://qq/index.html#/forward/root');
    root.emit('focus');
    harness.controller.markOpenIntent(root, 'nested');
    harness.setFocused(nested);
    harness.controller.install(nested);
    nested.navigate('app://qq/index.html#/forward/nested');

    assert.equal(root.destroyed, false);
    assert.equal(harness.controller.getState().activeWindow, nested);
    assert.equal(harness.controller.getState().depth, 2);
});

test('a root intent replaces the old record even when focus still points at it', () => {
    const harness = createHarness();
    const main = new FakeWindow('main');
    const root = new FakeWindow('root', main);
    const replacement = new FakeWindow('replacement', main);

    harness.setFocused(main);
    harness.controller.install(root);
    root.navigate(getForwardUrl('10001', 'first'));
    harness.setFocused(root);
    harness.controller.markOpenIntent(main, 'root');
    harness.controller.install(replacement);
    replacement.navigate(getForwardUrl('10001', 'second'));

    assert.equal(root.destroyed, true);
    assert.equal(replacement.destroyed, false);
    assert.equal(harness.controller.getState().activeWindow, replacement);
    assert.equal(harness.controller.getState().depth, 1);
});

test('back transfers the current normal bounds instead of restoring the parent placement', () => {
    const harness = createHarness();
    const main = new FakeWindow('main');
    const root = new FakeWindow('root', main);
    const nested = new FakeWindow('nested', root);

    harness.setFocused(main);
    harness.controller.install(root);
    root.navigate(getForwardUrl('10001', 'root'));
    harness.setFocused(root);
    harness.controller.install(nested);
    nested.navigate(getForwardUrl('10001', 'nested'));
    assert.deepEqual(nested.bounds, root.bounds);

    nested.bounds = { x: 360, y: 220, width: 640, height: 720 };
    nested.close();

    assert.equal(root.maximized, false);
    assert.deepEqual(root.bounds, nested.bounds);
});

test('uses restored bounds instead of inheriting maximized state', () => {
    const harness = createHarness();
    const main = new FakeWindow('main');
    const root = new FakeWindow('root', main);
    const nested = new FakeWindow('nested', root);

    root.maximized = true;
    root.bounds = { x: 240, y: 120, width: 680, height: 760 };
    nested.maximized = true;
    harness.setFocused(main);
    harness.controller.install(root);
    root.navigate(getForwardUrl('10001', 'root'));
    harness.setFocused(root);
    harness.controller.install(nested);
    nested.navigate(getForwardUrl('10001', 'nested'));

    assert.equal(nested.maximized, false);
    assert.deepEqual(nested.bounds, root.bounds);
    assert.equal(harness.events.some(event => event.type.startsWith('placement-')), false);
});

test('keeps distinct native nested pages even when QQ gives them the same route', () => {
    const harness = createHarness();
    const main = new FakeWindow('main');
    const root = new FakeWindow('root', main);
    const nested = new FakeWindow('nested', root);
    const sharedUrl = 'app://qq/index.html#/forward/shared';

    harness.setFocused(main);
    harness.controller.install(root);
    root.navigate(sharedUrl);
    harness.setFocused(root);
    harness.controller.install(nested);
    nested.navigate(sharedUrl);

    assert.equal(root.destroyed, false);
    assert.equal(root.visible, false);
    assert.equal(nested.destroyed, false);
    assert.equal(nested.visible, true);
    assert.equal(harness.controller.getState().activeWindow, nested);
    assert.equal(harness.controller.getState().depth, 2);
});

test('recovers the previous native page if the active nested window is destroyed', () => {
    const harness = createHarness();
    const main = new FakeWindow('main');
    const root = new FakeWindow('root', main);
    const nested = new FakeWindow('nested', root);

    harness.setFocused(main);
    harness.controller.install(root);
    root.navigate('app://qq/index.html#/forward/root');
    harness.setFocused(root);
    harness.controller.install(nested);
    nested.navigate('app://qq/index.html#/forward/nested');
    nested.destroy();

    assert.equal(root.visible, true);
    assert.equal(harness.controller.getState().activeWindow, root);
    assert.equal(harness.controller.getState().depth, 1);
});

test('releases hidden pages while disabled and allows normal closure while quitting', () => {
    const disabledHarness = createHarness();
    const main = new FakeWindow('main');
    const root = new FakeWindow('root', main);
    const nested = new FakeWindow('nested', root);
    disabledHarness.setFocused(main);
    disabledHarness.controller.install(root);
    root.navigate('app://qq/index.html#/forward/root');
    disabledHarness.setFocused(root);
    disabledHarness.controller.install(nested);
    nested.navigate('app://qq/index.html#/forward/nested');
    disabledHarness.setEnabled(false);
    disabledHarness.controller.sync([root, nested]);
    assert.equal(root.destroyed, true);
    assert.equal(nested.destroyed, false);
    assert.equal(nested.close(), false);

    const quittingHarness = createHarness();
    const nextRoot = new FakeWindow('next-root', main);
    const nextNested = new FakeWindow('next-nested', nextRoot);
    quittingHarness.setFocused(main);
    quittingHarness.controller.install(nextRoot);
    nextRoot.navigate('app://qq/index.html#/forward/root');
    quittingHarness.setFocused(nextRoot);
    quittingHarness.controller.install(nextNested);
    nextNested.navigate('app://qq/index.html#/forward/nested');
    quittingHarness.controller.setQuitting(true);
    assert.equal(nextNested.close(), false);
    assert.equal(nextRoot.visible, false);
});

test('releases every hidden page in a multi-level stack', () => {
    const harness = createHarness();
    const main = new FakeWindow('main');
    const root = new FakeWindow('root', main);
    const middle = new FakeWindow('middle', root);
    const nested = new FakeWindow('nested', middle);

    harness.setFocused(main);
    harness.controller.install(root);
    root.navigate('app://qq/index.html#/forward/root');
    harness.setFocused(root);
    harness.controller.install(middle);
    middle.navigate('app://qq/index.html#/forward/middle');
    harness.setFocused(middle);
    harness.controller.install(nested);
    nested.navigate('app://qq/index.html#/forward/nested');

    harness.setEnabled(false);
    harness.controller.sync([root, middle, nested]);

    assert.equal(root.destroyed, true);
    assert.equal(middle.destroyed, true);
    assert.equal(nested.destroyed, false);
    assert.equal(harness.controller.getState().depth, 0);
});
