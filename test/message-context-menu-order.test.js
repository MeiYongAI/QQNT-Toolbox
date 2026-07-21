'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const moduleSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'message-context-menu-order.js'),
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
        normalizeContextMenuOrder(['qq:复制', '', 'qq:转发', 'qq:复制', null]),
        ['qq:复制', 'qq:转发']
    );
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
    const { DEFAULT_MESSAGE_CONTEXT_MENU_ITEMS } = await modulePromise;
    const ids = new Set(DEFAULT_MESSAGE_CONTEXT_MENU_ITEMS.map(item => item.id));
    assert.ok(ids.has('qq:复制'));
    assert.ok(ids.has('qq:转发'));
    assert.ok(ids.has('toolbox:repeat'));
    assert.ok(ids.has('toolbox:voice-save'));
    assert.ok(ids.has('toolbox:poke-recall'));
    assert.ok(ids.has('qq:separator:1'));
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

test('patches the QQ menu provider once and keeps custom handlers native', async () => {
    const { createMessageContextMenuOrderController } = await modulePromise;
    let handledRecord = null;
    const controller = createMessageContextMenuOrderController({
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

test('pre-patches declared message menus without touching generic QQ menus', async () => {
    const { createMessageContextMenuOrderController } = await modulePromise;
    const controller = createMessageContextMenuOrderController({
        getConfig: () => ({ enabled: false, items: [], catalog: [] })
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

    const generic = createMenu();
    controller.handleVueComponentMount({ proxy: generic.menu });
    assert.deepEqual(generic.context.openMenu().map(item => item.text), ['native']);

    const message = createMenu();
    controller.handleVueComponentMount({ proxy: { msgCtxMenu: message.menu } });
    assert.deepEqual(message.context.openMenu().map(item => item.text), ['native', 'repeat']);

    const deferred = createMenu();
    controller.handleVueComponentMount({ proxy: { msgCtxMenu: deferred.menu } }, false);
    assert.deepEqual(deferred.context.openMenu().map(item => item.text), ['native']);
});
