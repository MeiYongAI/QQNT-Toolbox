'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
    createDefaultContextMenuOrderConfig,
    migrateContextMenuOrderConfig
} = require('../src/context-menu-order-config');

const moduleSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'context-menu-order.js'),
    'utf8'
);
const rendererSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer.js'),
    'utf8'
);
const modulePromise = import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);

test('calculates stable insertion positions and drag auto-scroll speed', async () => {
    const { getDragAutoScrollDelta, getDragInsertionIndex } = await modulePromise;

    assert.equal(getDragInsertionIndex([100, 150, 200], 80), 0);
    assert.equal(getDragInsertionIndex([100, 150, 200], 125), 1);
    assert.equal(getDragInsertionIndex([100, 150, 200], 220), 3);
    assert.equal(getDragAutoScrollDelta(100, 100, 500), -18);
    assert.equal(getDragAutoScrollDelta(124, 100, 500), -9);
    assert.equal(getDragAutoScrollDelta(300, 100, 500), 0);
    assert.equal(getDragAutoScrollDelta(500, 100, 500), 18);
});

test('uses pointer sorting instead of native HTML drag and drop', () => {
    assert.match(moduleSource, /addEventListener\('pointerdown'[\s\S]*setPointerCapture/);
    assert.match(moduleSource, /requestAnimationFrame\(runAutoScroll\)/);
    assert.doesNotMatch(moduleSource, /addEventListener\('dragstart'/);
    assert.doesNotMatch(moduleSource, /\.draggable\s*=\s*true/);
});

test('normalizes persisted message menu order without duplicates', async () => {
    const { normalizeContextMenuOrder } = await modulePromise;
    assert.deepEqual(
        normalizeContextMenuOrder([
            'qq:复制',
            '',
            'toolbox:multi-message-to-image',
            'qq:转发',
            'qq:复制',
            null
        ]),
        ['qq:复制', 'qq:转发']
    );
});

test('classifies context-menu targets by stable priority', async () => {
    const { classifyContextMenuScope } = await modulePromise;
    const target = matches => ({
        closest: selector => matches.some(value => selector.includes(value)) ? {} : null
    });

    assert.equal(classifyContextMenuScope(target(['.message'])), 'message');
    assert.equal(classifyContextMenuScope(target(['.avatar', '.message'])), 'avatar');
    assert.equal(classifyContextMenuScope(target(['.recent-contact-item'])), 'recent');
    assert.equal(classifyContextMenuScope(target(['.recent-contact-item', '.avatar'])), 'recent');
    assert.equal(classifyContextMenuScope(target(['.file-item'])), '');
    assert.equal(classifyContextMenuScope(target(['.file-item', '.message'])), 'message');
    assert.equal(classifyContextMenuScope(target(['contenteditable'])), '');
    assert.equal(classifyContextMenuScope(target([])), '');
});

test('migrates the legacy message order into the message scope and removes the old key', () => {
    const migrated = migrateContextMenuOrderConfig({
        interfaceTweaks: {
            inlineMediaViewer: true,
            messageContextMenuOrder: {
                enabled: true,
                items: ['qq:转发', 'qq:复制'],
                catalog: [{ id: 'qq:转发', label: '转发' }]
            }
        }
    });

    assert.equal(migrated.interfaceTweaks.contextMenuOrder.enabled, true);
    assert.deepEqual(migrated.interfaceTweaks.contextMenuOrder.scopes.message, {
        items: ['qq:转发', 'qq:复制'],
        catalog: [{ id: 'qq:转发', label: '转发' }]
    });
    assert.equal('messageContextMenuOrder' in migrated.interfaceTweaks, false);
    assert.equal(migrated.interfaceTweaks.inlineMediaViewer, true);
});

test('keeps an explicit scoped order while removing stale legacy data', () => {
    const migrated = migrateContextMenuOrderConfig({
        interfaceTweaks: {
            contextMenuOrder: {
                enabled: false,
                scopes: {
                    message: { items: ['qq:删除'], catalog: [] },
                    avatar: { items: ['qq:资料'], catalog: [] },
                    file: { items: ['qq:打开文件夹'], catalog: [] },
                    editor: { items: ['qq:粘贴'], catalog: [] }
                }
            },
            messageContextMenuOrder: {
                enabled: true,
                items: ['qq:复制'],
                catalog: [{ id: 'qq:复制', label: '复制' }]
            }
        }
    });

    assert.equal(migrated.interfaceTweaks.contextMenuOrder.enabled, false);
    assert.deepEqual(
        migrated.interfaceTweaks.contextMenuOrder.scopes.message.items,
        ['qq:删除']
    );
    assert.deepEqual(
        migrated.interfaceTweaks.contextMenuOrder.scopes.avatar.items,
        ['qq:资料']
    );
    assert.equal('file' in migrated.interfaceTweaks.contextMenuOrder.scopes, false);
    assert.equal('editor' in migrated.interfaceTweaks.contextMenuOrder.scopes, false);
    assert.equal('messageContextMenuOrder' in migrated.interfaceTweaks, false);
});

test('creates isolated defaults for every supported menu scope', () => {
    const config = createDefaultContextMenuOrderConfig();
    assert.deepEqual(Object.keys(config.scopes), [
        'message', 'avatar', 'recent'
    ]);
    config.scopes.message.items.push('qq:复制');
    assert.deepEqual(config.scopes.avatar.items, []);
});

test('sorts the available native and Toolbox menu items as one stable subset', async () => {
    const { sortContextMenuEntries } = await modulePromise;
    const entries = [
        { descriptor: { id: 'qq:复制' }, value: 'copy' },
        { descriptor: { id: 'qq:删除' }, value: 'delete' },
        { descriptor: { id: 'toolbox:repeat' }, value: 'repeat' },
        { descriptor: { id: 'qq:新版功能' }, value: 'unknown' }
    ];
    const sorted = sortContextMenuEntries(entries, [
        'toolbox:voice-save',
        'toolbox:repeat',
        'qq:复制',
        'qq:删除'
    ]);
    assert.deepEqual(sorted.map(entry => entry.value), ['repeat', 'copy', 'delete', 'unknown']);
});

test('exposes native separators as independently sortable entries', async () => {
    const { describeContextMenuConfigs, sortContextMenuEntries } = await modulePromise;
    const entries = describeContextMenuConfigs([
        { text: '复制', value: 'copy' },
        { type: 'separator', value: 'separator' },
        { text: '撤回', value: 'recall' },
        { text: '删除', value: 'delete' }
    ]);
    const sorted = sortContextMenuEntries(entries, [
        'qq:复制',
        'qq:撤回',
        'qq:删除',
        'qq:separator:1'
    ]);

    assert.equal(entries[1].descriptor.label, '分隔线');
    assert.deepEqual(sorted.map(entry => entry.config.value), ['copy', 'recall', 'delete', 'separator']);
});

test('keeps separators in their QQ position until an existing order saves them', async () => {
    const {
        describeContextMenuConfigs,
        mergeObservedSeparators,
        sortContextMenuEntries
    } = await modulePromise;
    const entries = describeContextMenuConfigs([
        { text: '多选', value: 'multi' },
        { type: 'separator', value: 'separator' },
        { text: '撤回', value: 'recall' },
        { text: '删除', value: 'delete' }
    ]);
    const sorted = sortContextMenuEntries(entries, ['qq:多选', 'qq:撤回', 'qq:删除']);

    assert.deepEqual(sorted.map(entry => entry.config.value), ['multi', 'separator', 'recall', 'delete']);
    assert.deepEqual(
        mergeObservedSeparators(
            ['qq:多选', 'qq:撤回', 'qq:删除'],
            ['qq:多选', 'qq:separator:1', 'qq:撤回', 'qq:删除']
        ),
        ['qq:多选', 'qq:separator:1', 'qq:撤回', 'qq:删除']
    );
});

test('keeps QQ order unchanged until the user saves a custom order', async () => {
    const { sortContextMenuEntries } = await modulePromise;
    const entries = [
        { descriptor: { id: 'qq:多选' }, value: 'multi' },
        { descriptor: { id: 'qq:转发' }, value: 'forward' }
    ];
    assert.deepEqual(
        sortContextMenuEntries(entries, []).map(entry => entry.value),
        ['multi', 'forward']
    );
});

test('ships both QQ native and Toolbox entries in the initial editor catalog', async () => {
    const {
        DEFAULT_CONTEXT_MENU_ITEMS,
        DEFAULT_MESSAGE_CONTEXT_MENU_ITEMS
    } = await modulePromise;
    const ids = new Set(DEFAULT_MESSAGE_CONTEXT_MENU_ITEMS.map(item => item.id));
    assert.ok(ids.has('qq:复制'));
    assert.ok(ids.has('qq:转发'));
    assert.ok(ids.has('toolbox:repeat'));
    assert.ok(ids.has('toolbox:message-to-image'));
    assert.ok(ids.has('toolbox:voice-save'));
    assert.ok(ids.has('toolbox:qr-scan'));
    assert.ok(ids.has('toolbox:poke-recall'));
    assert.equal(ids.has('toolbox:reveal-archived-file'), false);
    assert.equal(ids.has('toolbox:open-archived-file'), false);
    assert.ok(ids.has('qq:separator:1'));
    for (const scope of ['message', 'avatar', 'recent']) {
        assert.ok(DEFAULT_CONTEXT_MENU_ITEMS[scope].length > 0, scope);
    }
});

test('collects Toolbox entries for sorting but excludes them as native templates', async () => {
    const { getContextMenuItemElements } = await modulePromise;
    const makeItem = classes => ({
        classList: { contains: className => classes.includes(className) },
        contains: () => false
    });
    const nativeItem = makeItem(['q-context-menu-item']);
    const repeatItem = makeItem(['q-context-menu-item', 'qqnt-toolbox-repeat-menu-item']);
    const menu = {
        querySelectorAll: selector => selector === '.q-context-menu-item' ? [nativeItem, repeatItem] : []
    };

    assert.deepEqual(getContextMenuItemElements(menu, true), [nativeItem, repeatItem]);
    assert.deepEqual(getContextMenuItemElements(menu, false), [nativeItem]);
});

test('closes a mounted QQ context menu through its Vue lifecycle', async () => {
    const { closeNativeContextMenu } = await modulePromise;
    let closeCalls = 0;
    const unrelated = {
        ctx: { close: () => assert.fail('must not call an unrelated close method') }
    };
    const context = {
        close() {
            closeCalls += 1;
        },
        closeWhenEscPressed() {},
        closeWhenBlur() {},
        preventEventWhenMouseNotInMenu() {}
    };
    const item = {
        __VUE__: [{ parent: unrelated }, { parent: { ctx: context } }],
        classList: { contains: () => false },
        contains: () => false
    };
    const menu = {
        querySelectorAll: selector => selector === '.q-context-menu-item' ? [item] : []
    };

    assert.equal(closeNativeContextMenu(menu), true);
    assert.equal(closeCalls, 1);
});

test('composes native and Toolbox configs before rendering', async () => {
    const { composeContextMenuConfigs, describeContextMenuConfig } = await modulePromise;
    const repeat = {
        type: 990101,
        text: '复读',
        __qqntToolboxDescriptor: { id: 'toolbox:repeat', label: '复读', toolbox: true },
        __qqntToolboxInsertAfter: ['qq:转发']
    };
    const composed = composeContextMenuConfigs([
        { type: 1, text: '复制' },
        { type: 6, text: '转发' },
        { type: 11, text: '删除' }
    ], [repeat]);

    assert.deepEqual(composed.map(item => item.text), ['复制', '转发', '复读', '删除']);
    assert.deepEqual(describeContextMenuConfig(repeat), {
        id: 'toolbox:repeat',
        label: '复读',
        toolbox: true
    });
});

test('does not append the same Toolbox config twice', async () => {
    const { composeContextMenuConfigs } = await modulePromise;
    const repeat = {
        type: 990101,
        text: 'repeat',
        __qqntToolboxDescriptor: { id: 'toolbox:repeat', label: 'repeat', toolbox: true }
    };

    assert.deepEqual(composeContextMenuConfigs([repeat], [repeat]), [repeat]);
});

test('preserves message argument counts and refuses to patch non-message providers', async () => {
    const { createContextMenuOrderController } = await modulePromise;
    const config = createDefaultContextMenuOrderConfig();
    config.enabled = true;
    const controller = createContextMenuOrderController({ getConfig: () => config });
    const calls = [];
    const marker = { type: 'contextmenu' };
    const context = {};
    Object.defineProperty(context, 'showMenuConfig', {
        configurable: true,
        get: () => [{ text: '查看资料' }]
    });
    const originalOpenMenu = function openMenu(...args) {
        calls.push(args);
        return this.showMenuConfig;
    };
    context.openMenu = originalOpenMenu;
    const menu = { _: { ctx: context } };

    assert.equal(controller.patchMenu(menu, null, 'avatar'), false);
    assert.equal(context.openMenu, originalOpenMenu);
    assert.equal(controller.patchMenu(menu, null, 'message'), true);
    context.openMenu();
    context.openMenu(marker);
    assert.equal(calls[0].length, 0);
    assert.equal(calls[1].length, 1);
    assert.equal(calls[1][0], marker);
    controller.dispose();
});

test('sorts non-message DOM without patching its provider', async () => {
    const {
        createContextMenuOrderController,
        reorderContextMenuElements
    } = await modulePromise;
    const config = {
        enabled: true,
        scopes: {
            message: {
                items: ['toolbox:repeat', 'qq:删除', 'qq:复制'],
                catalog: []
            },
            avatar: {
                items: ['qq:戳一戳', 'qq:资料'],
                catalog: []
            },
            recent: { items: [], catalog: [] }
        }
    };
    const controller = createContextMenuOrderController({ getConfig: () => config });
    controller.registerExtension({
        id: 'message-only',
        getItems: () => [{
            text: '复读',
            __qqntToolboxDescriptor: {
                id: 'toolbox:repeat',
                label: '复读',
                toolbox: true
            }
        }]
    });
    const createMenu = labels => {
        const context = {};
        Object.defineProperty(context, 'showMenuConfig', {
            configurable: true,
            get: () => labels.map(text => ({ text }))
        });
        context.openMenu = function openMenu(_event, _items, menuContext) {
            this.menuContext = menuContext;
            return this.showMenuConfig;
        };
        return { menu: { _: { ctx: context } }, context };
    };

    const message = createMenu(['复制', '删除']);
    const avatar = createMenu(['资料', '戳一戳']);
    const recent = createMenu(['置顶', '删除']);
    controller.patchMenu(message.menu, null, 'message');
    assert.equal(controller.patchMenu(avatar.menu, null, 'avatar'), false);
    assert.equal(controller.patchMenu(recent.menu, null, 'recent'), false);

    assert.deepEqual(
        message.context.openMenu(null, [], { msgRecord: { msgId: '1' } }, {})
            .map(item => item.text),
        ['复读', '删除', '复制']
    );
    assert.deepEqual(
        avatar.context.openMenu(null, [], {}, {}).map(item => item.text),
        ['资料', '戳一戳']
    );
    assert.deepEqual(
        recent.context.openMenu(null, [], {}, {}).map(item => item.text),
        ['置顶', '删除']
    );

    const parent = {
        childNodes: [],
        replaceChildren(...children) {
            this.childNodes = children;
            for (const child of children) {
                child.parentNode = this;
            }
        }
    };
    const profile = { textContent: '资料', parentNode: parent };
    const poke = { textContent: '戳一戳', parentNode: parent };
    parent.childNodes = [profile, poke];
    reorderContextMenuElements([profile, poke], config.scopes.avatar.items);
    assert.deepEqual(parent.childNodes, [poke, profile]);
    controller.dispose();
});

test('renders one management tab for each supported menu scope', () => {
    for (const label of ['消息', '头像', '会话列表']) {
        assert.ok(moduleSource.includes(`label: '${label}'`));
    }
    assert.doesNotMatch(moduleSource, /\{ id: 'file', label:/);
    assert.doesNotMatch(moduleSource, /\{ id: 'editor', label:/);
    assert.equal(moduleSource.includes("{ id: 'other', label: '其他' }"), false);
    assert.match(moduleSource, /setAttribute\('role', 'tablist'\)/);
    assert.match(moduleSource, /暂无可排序项目/);
    assert.doesNotMatch(moduleSource, /请先打开一次此类菜单/);
    assert.match(moduleSource, /恢复 QQ 顺序/);
    assert.match(moduleSource, /width: min\(440px, calc\(100vw - 32px\)\)/);
    assert.match(moduleSource, /height: min\(480px, calc\(100vh - 32px\)\)/);
    assert.match(
        moduleSource,
        /\.qqnt-toolbox-menu-order-list \{[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;/
    );
});

test('patches the QQ menu provider once and keeps custom handlers native', async () => {
    const { createContextMenuOrderController } = await modulePromise;
    let handledRecord = null;
    const controller = createContextMenuOrderController({
        getConfig: () => ({ enabled: false, items: [], catalog: [] })
    });
    controller.registerExtension({
        id: 'test-extension',
        getItems: ({ originalContext }) => [{
            type: 990101,
            text: '复读',
            handler: () => {
                handledRecord = originalContext.msgRecord;
            },
            when: () => true,
            __qqntToolboxDescriptor: { id: 'toolbox:repeat', label: '复读', toolbox: true },
            __qqntToolboxInsertAfter: ['qq:转发']
        }]
    });

    const menuContext = {};
    Object.defineProperty(menuContext, 'showMenuConfig', {
        configurable: true,
        get: () => [
            { type: 1, text: '复制' },
            { type: 6, text: '转发' }
        ]
    });
    menuContext.openMenu = function openMenu(_event, _items, context) {
        this.menuContext = context;
        return this.showMenuConfig;
    };
    const menu = { _: { ctx: menuContext } };
    const record = { msgId: '1', elements: [{}] };

    assert.equal(controller.patchMenu(menu), true);
    assert.equal(controller.patchMenu(menu), true);
    const configs = menuContext.openMenu({}, [], { msgRecord: record }, {});
    assert.deepEqual(configs.map(item => item.text), ['复制', '转发', '复读']);
    configs[2].handler();
    assert.equal(handledRecord, record);
});

test('passes the first captured message context without changing QQ openMenu arguments', async () => {
    const { createContextMenuOrderController } = await modulePromise;
    const controller = createContextMenuOrderController({
        getConfig: () => ({ enabled: false, items: [], catalog: [] })
    });
    let extensionContext = null;
    controller.registerExtension({
        id: 'captured-context',
        getItems: context => {
            extensionContext = context;
            return [];
        }
    });

    const menuContext = {};
    Object.defineProperty(menuContext, 'showMenuConfig', {
        configurable: true,
        get: () => [{ type: 1, text: 'native' }]
    });
    let nativeEvent = undefined;
    menuContext.openMenu = function openMenu(event) {
        nativeEvent = event;
        return this.showMenuConfig;
    };
    const menu = { _: { ctx: menuContext } };
    const component = { proxy: { msgCtxMenu: menu }, parent: null };
    const clickedTarget = { id: 'clicked-target' };
    let capturedPath = [clickedTarget];
    const capturedEvent = {
        type: 'contextmenu',
        composedPath: () => capturedPath
    };
    const OriginalElement = global.Element;
    class MockElement {}
    global.Element = MockElement;
    const messageElement = new MockElement();
    messageElement.closest = selector => selector.includes('.message') ? messageElement : null;
    messageElement.__VUE__ = [component];

    try {
        assert.equal(controller.handleContextMenu(capturedEvent, messageElement), true);
        capturedPath = [];
        assert.deepEqual(menuContext.openMenu(null, [], { msgRecord: { msgId: '1' } }, {}), [
            { type: 1, text: 'native' }
        ]);
    } finally {
        global.Element = OriginalElement;
    }

    assert.equal(nativeEvent, null);
    assert.equal(extensionContext.sourceEvent, capturedEvent);
    assert.deepEqual(extensionContext.sourceEventPath, [clickedTarget]);
    assert.equal(extensionContext.messageElement, messageElement);
});

test('pre-patches only a provider owned by a confirmed message component', async () => {
    const { createContextMenuOrderController } = await modulePromise;
    const OriginalElement = global.Element;
    class MockElement {}
    global.Element = MockElement;
    const messageElement = new MockElement();
    const otherElement = new MockElement();
    const controller = createContextMenuOrderController({
        getConfig: () => ({ enabled: false, items: [], catalog: [] }),
        resolveMessageElement: element => element === messageElement ? messageElement : null
    });
    controller.registerExtension({
        id: 'test-extension',
        getItems: () => [{
            type: 990101,
            text: 'repeat',
            __qqntToolboxDescriptor: { id: 'toolbox:repeat', label: 'repeat', toolbox: true }
        }]
    });

    const createMenu = () => {
        const context = {};
        Object.defineProperty(context, 'showMenuConfig', {
            configurable: true,
            get: () => [{ type: 1, text: 'native' }]
        });
        context.openMenu = function openMenu() {
            return this.showMenuConfig;
        };
        return { menu: { _: { ctx: context } }, context };
    };

    try {
        const generic = createMenu();
        controller.handleVueComponentMount({
            proxy: { msgCtxMenu: generic.menu },
            vnode: { el: otherElement }
        });
        assert.deepEqual(generic.context.openMenu().map(item => item.text), ['native']);

        const message = createMenu();
        controller.handleVueComponentMount({
            proxy: { msgCtxMenu: message.menu },
            vnode: { el: messageElement }
        });
        assert.deepEqual(message.context.openMenu().map(item => item.text), ['native', 'repeat']);

        const deferred = createMenu();
        controller.handleVueComponentMount({
            proxy: { msgCtxMenu: deferred.menu },
            vnode: { el: messageElement }
        }, false);
        assert.deepEqual(deferred.context.openMenu().map(item => item.text), ['native']);
    } finally {
        global.Element = OriginalElement;
        controller.dispose();
    }
});

test('never pre-patches a non-message provider from a mounted element', async () => {
    const { createContextMenuOrderController } = await modulePromise;
    const config = createDefaultContextMenuOrderConfig();
    config.enabled = true;
    config.scopes.recent.items = ['qq:删除', 'qq:置顶'];
    const controller = createContextMenuOrderController({ getConfig: () => config });
    const createMenu = () => {
        const context = {};
        Object.defineProperty(context, 'showMenuConfig', {
            configurable: true,
            get: () => [{ text: '置顶' }, { text: '删除' }]
        });
        context.openMenu = function openMenu() {
            return this.showMenuConfig;
        };
        return { menu: { _: { ctx: context } }, context };
    };
    const OriginalElement = global.Element;
    class MockElement {}
    global.Element = MockElement;
    const recentElement = new MockElement();
    recentElement.closest = selector => selector.includes('.recent-contact-item')
        ? recentElement
        : null;

    try {
        const recent = createMenu();
        controller.handleVueComponentMount({
            proxy: { msgCtxMenu: recent.menu },
            vnode: { el: recentElement }
        });
        assert.deepEqual(recent.context.openMenu().map(item => item.text), ['置顶', '删除']);

        const generic = createMenu();
        const genericElement = new MockElement();
        genericElement.closest = () => null;
        controller.handleVueComponentMount({
            proxy: generic.menu,
            vnode: { el: genericElement }
        });
        assert.deepEqual(generic.context.openMenu().map(item => item.text), ['置顶', '删除']);
    } finally {
        global.Element = OriginalElement;
        controller.dispose();
    }
});

test('only confirmed message elements enter the provider patch path', () => {
    assert.match(
        rendererSource,
        /messageTarget\s*\?\s*menuController\.handleContextMenu\(event, messageTarget\)/
    );
    assert.doesNotMatch(
        rendererSource,
        /handleContextMenu\(event,\s*event\.target\)/
    );
});
