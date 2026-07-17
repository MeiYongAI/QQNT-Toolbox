const EDITOR_ID = 'qqnt-toolbox-message-menu-order-editor';
const STYLE_ID = 'qqnt-toolbox-message-menu-order-style';
const SEPARATOR_ID_PREFIX = 'qq:separator:';

export const DEFAULT_MESSAGE_CONTEXT_MENU_ITEMS = Object.freeze([
    { id: 'qq:复制', label: '复制' },
    { id: 'qq:转发', label: '转发' },
    { id: 'toolbox:repeat', label: '复读', toolbox: true },
    { id: 'qq:回复', label: '回复' },
    { id: 'qq:引用', label: '引用' },
    { id: 'qq:收藏', label: '收藏' },
    { id: 'qq:翻译', label: '翻译' },
    { id: 'qq:转文字', label: '转文字' },
    { id: 'qq:提取文字', label: '提取文字' },
    { id: 'qq:识别图中文字', label: '识别图中文字' },
    { id: 'toolbox:voice-save', label: '保存语音', toolbox: true },
    { id: 'qq:保存', label: '保存' },
    { id: 'qq:另存为', label: '另存为' },
    { id: 'qq:打开文件夹', label: '打开文件夹' },
    { id: 'qq:多选', label: '多选' },
    { id: `${SEPARATOR_ID_PREFIX}1`, label: '分隔线' },
    { id: 'toolbox:poke-recall', label: '撤回戳戳', toolbox: true },
    { id: 'qq:撤回', label: '撤回' },
    { id: 'qq:删除', label: '删除' },
    { id: 'qq:清屏', label: '清屏' }
]);

const TOOLBOX_ITEM_CLASSES = new Set([
    'qqnt-toolbox-repeat-menu-item',
    'qqnt-toolbox-poke-menu-item'
]);

function normalizeText(value) {
    return String(value ?? '').trim();
}

function createElement(tag, className = '', content = '') {
    const element = document.createElement(tag);
    if (className) {
        element.className = className;
    }
    if (content !== '') {
        element.textContent = content;
    }
    return element;
}

function isToolboxMenuItem(item) {
    return Array.from(TOOLBOX_ITEM_CLASSES).some(className => item?.classList?.contains(className));
}

export function getContextMenuItemElements(menu, includeToolbox = true) {
    if (!menu?.querySelectorAll) {
        return [];
    }
    const selectors = ['.q-context-menu-item', '[class*="context-menu-item"]', '[role="menuitem"]', 'li', 'button'];
    const candidates = selectors.flatMap(selector => Array.from(menu.querySelectorAll(selector)));
    const seen = new Set();
    return candidates
        .filter(item => {
            if (!item || seen.has(item) || (!includeToolbox && isToolboxMenuItem(item))) {
                return false;
            }
            seen.add(item);
            return !candidates.some(parent => parent !== item && parent.contains?.(item));
        })
        .slice(0, 48);
}

export function normalizeContextMenuOrder(values) {
    const seen = new Set();
    const result = [];
    for (const value of Array.isArray(values) ? values : []) {
        const id = normalizeText(value);
        if (id && !seen.has(id)) {
            seen.add(id);
            result.push(id);
        }
    }
    return result;
}

export function mergeObservedSeparators(order, observedOrder) {
    const result = normalizeContextMenuOrder(order);
    const observed = normalizeContextMenuOrder(observedOrder);
    const knownIds = new Set(result);
    for (let index = observed.length - 1; index >= 0; index -= 1) {
        const id = observed[index];
        if (!id.startsWith(SEPARATOR_ID_PREFIX) || knownIds.has(id)) {
            continue;
        }
        const nextId = observed.slice(index + 1).find(candidate => knownIds.has(candidate));
        const targetIndex = nextId ? result.indexOf(nextId) : result.length;
        result.splice(targetIndex, 0, id);
        knownIds.add(id);
    }
    return result;
}

export function sortContextMenuEntries(entries, order) {
    const requestedOrder = normalizeContextMenuOrder(order);
    if (!requestedOrder.length) {
        return [...entries];
    }
    const normalizedOrder = mergeObservedSeparators(
        requestedOrder,
        entries.map(entry => entry?.descriptor?.id)
    );
    const ranks = new Map(normalizedOrder.map((id, index) => [id, index]));
    return entries
        .map((entry, index) => ({ ...entry, originalIndex: index }))
        .sort((left, right) => {
            const leftRank = ranks.get(left.descriptor?.id);
            const rightRank = ranks.get(right.descriptor?.id);
            return (leftRank ?? Number.MAX_SAFE_INTEGER) - (rightRank ?? Number.MAX_SAFE_INTEGER) ||
                left.originalIndex - right.originalIndex;
        });
}

function normalizeCatalogItem(value) {
    const id = normalizeText(value?.id);
    const label = normalizeText(value?.label);
    if (!id || !label || id.length > 160 || label.length > 80) {
        return null;
    }
    return { id, label, toolbox: value?.toolbox === true };
}

export function describeContextMenuConfig(item) {
    const toolboxDescriptor = normalizeCatalogItem(item?.__qqntToolboxDescriptor);
    if (toolboxDescriptor) {
        return toolboxDescriptor;
    }
    const label = normalizeText(item?.text).replace(/\s+/g, ' ').trim();
    const keyLabel = label.replace(/\s+/g, '').replace(/[.。…]+$/u, '');
    return keyLabel ? { id: `qq:${keyLabel}`, label, toolbox: false } : null;
}

export function describeContextMenuConfigs(items) {
    let separatorIndex = 0;
    return (Array.isArray(items) ? items : []).map(config => {
        const descriptor = describeContextMenuConfig(config);
        if (descriptor || !config || typeof config !== 'object') {
            return { config, descriptor };
        }
        separatorIndex += 1;
        return {
            config,
            descriptor: {
                id: `${SEPARATOR_ID_PREFIX}${separatorIndex}`,
                label: separatorIndex === 1 ? '分隔线' : `分隔线 ${separatorIndex}`,
                toolbox: false
            }
        };
    });
}

function insertContextMenuConfig(items, item) {
    const before = normalizeContextMenuOrder(item?.__qqntToolboxInsertBefore);
    const after = normalizeContextMenuOrder(item?.__qqntToolboxInsertAfter);
    const entries = items.map(config => ({ config, descriptor: describeContextMenuConfig(config) }));
    const beforeIndex = entries.findIndex(entry => before.includes(entry.descriptor?.id));
    if (beforeIndex >= 0) {
        items.splice(beforeIndex, 0, item);
        return;
    }
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (after.includes(entries[index].descriptor?.id)) {
            items.splice(index + 1, 0, item);
            return;
        }
    }
    items.push(item);
}

export function composeContextMenuConfigs(nativeItems, toolboxItems, order = [], sortingEnabled = false) {
    const items = Array.isArray(nativeItems) ? [...nativeItems] : [];
    for (const item of Array.isArray(toolboxItems) ? toolboxItems : []) {
        if (item && typeof item === 'object') {
            insertContextMenuConfig(items, item);
        }
    }
    if (!sortingEnabled) {
        return items;
    }
    return sortContextMenuEntries(
        describeContextMenuConfigs(items),
        order
    ).map(entry => entry.config);
}

function injectStyle() {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#${EDITOR_ID} {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: grid;
    place-items: center;
    padding: 20px;
    box-sizing: border-box;
    color: var(--text-primary, var(--text_primary, var(--text-01, #1f2329)));
    background: rgba(0, 0, 0, .38);
    font: 14px/1.4 var(--font-family, "Microsoft YaHei UI", "Microsoft YaHei", sans-serif);
    letter-spacing: 0;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-dialog {
    display: flex;
    flex-direction: column;
    width: min(380px, calc(100vw - 32px));
    max-height: min(640px, calc(100vh - 32px));
    overflow: hidden;
    border: 1px solid var(--border-level-1-color, var(--divider, rgba(127, 127, 127, .18)));
    border-radius: 8px;
    background: var(--bg_top_light, var(--background-05, var(--background-01, #fff)));
    box-shadow: var(--shadow-bg-middle-primary, 0 14px 42px rgba(0, 0, 0, .24));
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-header,
#${EDITOR_ID} .qqnt-toolbox-menu-order-footer {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    min-height: 48px;
    padding: 0 14px;
    box-sizing: border-box;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-header {
    border-bottom: 1px solid var(--border-level-1-color, var(--divider, rgba(127, 127, 127, .14)));
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-title {
    min-width: 0;
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-close,
#${EDITOR_ID} .qqnt-toolbox-menu-order-move {
    display: grid;
    flex: none;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    color: inherit;
    background: transparent;
    font: inherit;
    cursor: pointer;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-close {
    font-size: 21px;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-close:hover,
#${EDITOR_ID} .qqnt-toolbox-menu-order-move:hover:not(:disabled) {
    background: var(--overlay_hover, rgba(127, 127, 127, .12));
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-move:disabled {
    opacity: .25;
    cursor: default;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-list {
    flex: 1;
    min-height: 0;
    padding: 6px 12px;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--fill_standard_secondary, rgba(127, 127, 127, .30)) transparent;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-list::-webkit-scrollbar {
    width: 6px;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-list::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: var(--fill_standard_secondary, rgba(127, 127, 127, .30));
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-row {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) 30px 30px;
    align-items: center;
    min-height: 42px;
    border-bottom: 1px solid var(--border-level-1-color, var(--divider, rgba(127, 127, 127, .10)));
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-row:last-child {
    border-bottom: 0;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-row[data-dragging="true"] {
    opacity: .45;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-handle {
    width: 28px;
    color: var(--text-secondary, var(--text_secondary, var(--text-02, #6b7280)));
    font-size: 16px;
    line-height: 24px;
    text-align: center;
    cursor: grab;
    user-select: none;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-handle:active {
    cursor: grabbing;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-name {
    display: flex;
    min-width: 0;
    align-items: baseline;
    gap: 8px;
    overflow: hidden;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-name > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-name > small {
    flex: none;
    color: var(--text-secondary, var(--text_secondary, var(--text-02, #6b7280)));
    font-size: 11px;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-footer {
    gap: 12px;
    border-top: 1px solid var(--border-level-1-color, var(--divider, rgba(127, 127, 127, .14)));
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-footer-actions {
    display: flex;
    gap: 8px;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-restore,
#${EDITOR_ID} .qqnt-toolbox-menu-order-cancel,
#${EDITOR_ID} .qqnt-toolbox-menu-order-save {
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--border-level-1-color, var(--divider, rgba(127, 127, 127, .22)));
    border-radius: 6px;
    color: inherit;
    background: var(--background-02, rgba(127, 127, 127, .08));
    font: inherit;
    cursor: pointer;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-save {
    border-color: var(--brand_standard, var(--brand-primary, #2f6bff));
    color: var(--on_brand_primary, #fff);
    background: var(--brand_standard, var(--brand-primary, #2f6bff));
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-restore:hover:not(:disabled),
#${EDITOR_ID} .qqnt-toolbox-menu-order-cancel:hover:not(:disabled) {
    background: var(--overlay_hover, rgba(127, 127, 127, .14));
}
#${EDITOR_ID} button:disabled {
    cursor: default;
    opacity: .55;
}`;
    document.head.append(style);
}

export function createMessageContextMenuOrderController(options) {
    const builtInIds = new Set(DEFAULT_MESSAGE_CONTEXT_MENU_ITEMS.map(item => item.id));
    const discoveredItems = new Map(DEFAULT_MESSAGE_CONTEXT_MENU_ITEMS.map(item => [item.id, item]));
    const extensions = new Map();
    const patchedMenus = new WeakMap();
    let previousFocus = null;
    let catalogSaveTimer = 0;
    let lastObservedOrder = [];

    function getConfig() {
        const config = options.getConfig?.();
        return config && typeof config === 'object' ? config : {};
    }

    function syncConfig() {
        for (const value of Array.isArray(getConfig().catalog) ? getConfig().catalog : []) {
            const item = normalizeCatalogItem(value);
            if (item && !discoveredItems.has(item.id)) {
                discoveredItems.set(item.id, item);
            }
        }
        if (getConfig().enabled !== true) {
            closeEditor();
        }
    }

    function scheduleCatalogSave() {
        window.clearTimeout(catalogSaveTimer);
        catalogSaveTimer = window.setTimeout(() => {
            catalogSaveTimer = 0;
            const catalog = Array.from(discoveredItems.values())
                .filter(item => !builtInIds.has(item.id))
                .slice(0, 120)
                .map(item => ({ id: item.id, label: item.label, toolbox: item.toolbox === true }));
            if (JSON.stringify(getConfig().catalog) !== JSON.stringify(catalog)) {
                Promise.resolve(options.saveCatalog?.(catalog)).catch(() => {});
            }
        }, 240);
    }

    function rememberItems(entries) {
        let changed = false;
        const order = [];
        for (const entry of entries) {
            if (!entry.descriptor) {
                continue;
            }
            order.push(entry.descriptor.id);
            if (!discoveredItems.has(entry.descriptor.id)) {
                discoveredItems.set(entry.descriptor.id, entry.descriptor);
                changed = true;
            }
        }
        lastObservedOrder = Array.from(new Set(order));
        if (changed) {
            scheduleCatalogSave();
        }
    }

    function runExtensionHook(name, value) {
        let current = value;
        for (const extension of extensions.values()) {
            try {
                const next = extension?.[name]?.(current);
                if (next !== undefined) {
                    current = next;
                }
            } catch {
            }
        }
        return current;
    }

    function getExtensionItems(context) {
        const items = [];
        for (const extension of extensions.values()) {
            try {
                const next = extension?.getItems?.(context);
                if (Array.isArray(next)) {
                    items.push(...next);
                }
            } catch {
            }
        }
        return items;
    }

    function patchMenu(menu) {
        const menuContext = menu?._?.ctx;
        if (!menuContext) {
            return false;
        }
        if (patchedMenus.has(menuContext)) {
            return true;
        }
        const showDescriptor = Object.getOwnPropertyDescriptor(menuContext, 'showMenuConfig');
        const originalOpenMenu = menuContext.openMenu;
        if (typeof showDescriptor?.get !== 'function' || showDescriptor.configurable === false ||
            typeof originalOpenMenu !== 'function') {
            return false;
        }
        const state = {
            menu,
            sourceEvent: null,
            originalContext: null,
            context: null,
            options: null
        };
        const originalGet = showDescriptor.get;
        const patchedGet = function patchedToolboxMenuConfig() {
            let configs = originalGet.call(this);
            if (!Array.isArray(configs)) {
                return configs;
            }
            const hookContext = {
                menu,
                sourceEvent: state.sourceEvent,
                originalContext: state.originalContext,
                context: state.context,
                options: state.options
            };
            configs = runExtensionHook('transformItems', { ...hookContext, items: [...configs] })?.items || configs;
            const additions = getExtensionItems(hookContext);
            const combined = composeContextMenuConfigs(
                configs,
                additions,
                getConfig().items,
                getConfig().enabled === true
            );
            if (getConfig().enabled === true) {
                rememberItems(describeContextMenuConfigs(combined));
            }
            return combined;
        };
        const patchedOpenMenu = function patchedToolboxOpenMenu(...args) {
            let request = {
                menu,
                args,
                sourceEvent: args[0] || null,
                items: args[1],
                originalContext: args[2] || null,
                context: args[2] || null,
                options: args[3]
            };
            request = runExtensionHook('beforeOpen', request) || request;
            const nextArgs = Array.isArray(request.args) ? [...request.args] : [...args];
            nextArgs[0] = request.sourceEvent;
            nextArgs[1] = request.items;
            nextArgs[2] = request.context;
            nextArgs[3] = request.options;
            state.sourceEvent = request.sourceEvent;
            state.originalContext = request.originalContext;
            state.context = request.context;
            state.options = request.options;
            return Reflect.apply(originalOpenMenu, this, nextArgs);
        };
        Object.defineProperty(menuContext, 'showMenuConfig', {
            ...showDescriptor,
            get: patchedGet
        });
        menuContext.openMenu = patchedOpenMenu;
        patchedMenus.set(menuContext, state);
        return true;
    }

    function findMenuFromComponent(component, allowDirect = false) {
        const candidates = [
            component?.proxy?.msgCtxMenu,
            component?.ctx?.msgCtxMenu
        ];
        if (allowDirect) {
            candidates.push(component?.proxy, component?.ctx);
        }
        for (const candidate of candidates) {
            if (candidate?._?.ctx && typeof candidate._.ctx.openMenu === 'function' &&
                Object.getOwnPropertyDescriptor(candidate._.ctx, 'showMenuConfig')) {
                return candidate;
            }
        }
        return null;
    }

    function prepareFromElement(element) {
        if (!(element instanceof Element)) {
            return false;
        }
        const candidates = [element];
        const message = element.closest?.('.message.vue-component,.message,.ml-item');
        if (message && message !== element) {
            candidates.push(message);
        }
        const seen = new WeakSet();
        for (const candidate of candidates) {
            for (const start of new Set(candidate?.__VUE__ || [])) {
                for (let component = start, depth = 0; component && depth < 24;
                    component = component.parent, depth += 1) {
                    if (seen.has(component)) {
                        continue;
                    }
                    seen.add(component);
                    const menu = findMenuFromComponent(component, true);
                    if (menu && patchMenu(menu)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    function handleContextMenu(_event, messageElement) {
        return prepareFromElement(messageElement);
    }

    function handleVueComponentMount(component, patchProvider = true) {
        if (patchProvider) {
            const menu = findMenuFromComponent(component);
            if (menu) {
                patchMenu(menu);
            }
        }
        const element = component?.vnode?.el;
        const item = typeof Element !== 'undefined' && element instanceof Element
            ? element.closest?.('.q-context-menu-item')
            : null;
        if (!item) {
            return;
        }
        for (const extension of extensions.values()) {
            try {
                extension?.onItemMounted?.({ component, item });
            } catch {
            }
        }
    }

    function registerExtension(extension) {
        const id = normalizeText(extension?.id);
        if (!id) {
            return () => {};
        }
        extensions.set(id, extension);
        return () => {
            if (extensions.get(id) === extension) {
                extensions.delete(id);
            }
        };
    }

    function getEditorItems() {
        syncConfig();
        const ids = [];
        const seen = new Set();
        const append = values => {
            for (const id of values) {
                if (id && !seen.has(id)) {
                    seen.add(id);
                    ids.push(id);
                }
            }
        };
        const configuredOrder = normalizeContextMenuOrder(getConfig().items);
        const separatorReferenceOrder = lastObservedOrder.length
            ? lastObservedOrder
            : DEFAULT_MESSAGE_CONTEXT_MENU_ITEMS.map(item => item.id);
        append(configuredOrder.length
            ? mergeObservedSeparators(configuredOrder, separatorReferenceOrder)
            : lastObservedOrder);
        append(lastObservedOrder);
        append(discoveredItems.keys());
        return ids.map(id => discoveredItems.get(id) || {
            id,
            label: id.replace(/^[^:]+:/, '') || id,
            toolbox: id.startsWith('toolbox:')
        });
    }

    function updateMoveButtons(list) {
        const rows = Array.from(list.querySelectorAll('.qqnt-toolbox-menu-order-row'));
        rows.forEach((row, index) => {
            row.querySelector('[data-direction="up"]').disabled = index === 0;
            row.querySelector('[data-direction="down"]').disabled = index === rows.length - 1;
        });
    }

    function closeEditor() {
        document.getElementById(EDITOR_ID)?.remove();
        if (previousFocus?.isConnected) {
            previousFocus.focus({ preventScroll: true });
        }
        previousFocus = null;
    }

    function openEditor() {
        closeEditor();
        injectStyle();
        previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const layer = createElement('div');
        layer.id = EDITOR_ID;
        layer.tabIndex = -1;
        layer.setAttribute('role', 'dialog');
        layer.setAttribute('aria-modal', 'true');
        layer.setAttribute('aria-label', '消息右键菜单排序');
        const dialog = createElement('div', 'qqnt-toolbox-menu-order-dialog');
        const header = createElement('div', 'qqnt-toolbox-menu-order-header');
        const title = createElement('div', 'qqnt-toolbox-menu-order-title', '消息右键菜单排序');
        const close = createElement('button', 'qqnt-toolbox-menu-order-close', '×');
        close.type = 'button';
        close.title = '关闭';
        close.setAttribute('aria-label', '关闭');
        header.append(title, close);

        const list = createElement('div', 'qqnt-toolbox-menu-order-list');
        list.setAttribute('role', 'list');
        for (const item of getEditorItems()) {
            const row = createElement('div', 'qqnt-toolbox-menu-order-row');
            row.dataset.itemId = item.id;
            row.setAttribute('role', 'listitem');
            const handle = createElement('span', 'qqnt-toolbox-menu-order-handle', '⋮⋮');
            handle.draggable = true;
            handle.title = '拖动';
            const name = createElement('div', 'qqnt-toolbox-menu-order-name');
            name.append(createElement('span', '', item.label));
            if (item.toolbox) {
                name.append(createElement('small', '', 'Toolbox'));
            }
            const up = createElement('button', 'qqnt-toolbox-menu-order-move', '↑');
            up.type = 'button';
            up.dataset.direction = 'up';
            up.title = '上移';
            up.setAttribute('aria-label', `${item.label} 上移`);
            const down = createElement('button', 'qqnt-toolbox-menu-order-move', '↓');
            down.type = 'button';
            down.dataset.direction = 'down';
            down.title = '下移';
            down.setAttribute('aria-label', `${item.label} 下移`);
            row.append(handle, name, up, down);
            list.append(row);
        }
        updateMoveButtons(list);

        const footer = createElement('div', 'qqnt-toolbox-menu-order-footer');
        const restore = createElement('button', 'qqnt-toolbox-menu-order-restore', '恢复 QQ 顺序');
        restore.type = 'button';
        const footerActions = createElement('div', 'qqnt-toolbox-menu-order-footer-actions');
        const cancel = createElement('button', 'qqnt-toolbox-menu-order-cancel', '取消');
        cancel.type = 'button';
        const save = createElement('button', 'qqnt-toolbox-menu-order-save', '保存');
        save.type = 'button';
        footerActions.append(cancel, save);
        footer.append(restore, footerActions);
        dialog.append(header, list, footer);
        layer.append(dialog);
        document.body.append(layer);

        let draggingRow = null;
        list.addEventListener('dragstart', event => {
            const row = event.target.closest?.('.qqnt-toolbox-menu-order-handle')
                ?.closest?.('.qqnt-toolbox-menu-order-row');
            if (!row) {
                event.preventDefault();
                return;
            }
            draggingRow = row;
            row.dataset.dragging = 'true';
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', row.dataset.itemId || '');
        });
        list.addEventListener('dragover', event => {
            if (!draggingRow) {
                return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            const target = event.target.closest?.('.qqnt-toolbox-menu-order-row');
            if (!target || target === draggingRow) {
                return;
            }
            const rect = target.getBoundingClientRect();
            list.insertBefore(draggingRow, event.clientY < rect.top + rect.height / 2 ? target : target.nextSibling);
            updateMoveButtons(list);
        });
        const finishDrag = () => {
            draggingRow?.removeAttribute('data-dragging');
            draggingRow = null;
            updateMoveButtons(list);
        };
        list.addEventListener('drop', event => {
            event.preventDefault();
            finishDrag();
        });
        list.addEventListener('dragend', finishDrag);
        list.addEventListener('click', event => {
            const button = event.target.closest?.('.qqnt-toolbox-menu-order-move[data-direction]');
            const row = button?.closest?.('.qqnt-toolbox-menu-order-row');
            if (!button || !row || button.disabled) {
                return;
            }
            if (button.dataset.direction === 'up') {
                row.previousElementSibling?.before(row);
            } else {
                row.nextElementSibling?.after(row);
            }
            updateMoveButtons(list);
        });
        close.addEventListener('click', closeEditor);
        cancel.addEventListener('click', closeEditor);
        restore.addEventListener('click', async () => {
            restore.disabled = true;
            await options.saveOrder?.([]);
            closeEditor();
        });
        save.addEventListener('click', async () => {
            save.disabled = true;
            const order = Array.from(list.querySelectorAll('.qqnt-toolbox-menu-order-row'))
                .map(row => row.dataset.itemId)
                .filter(Boolean);
            await options.saveOrder?.(order);
            closeEditor();
        });
        layer.addEventListener('click', event => {
            if (event.target === layer) {
                closeEditor();
            }
        });
        layer.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeEditor();
            }
        });
        layer.focus({ preventScroll: true });
    }

    function dispose() {
        window.clearTimeout(catalogSaveTimer);
        extensions.clear();
        closeEditor();
    }

    return Object.freeze({
        closeEditor,
        dispose,
        handleContextMenu,
        handleVueComponentMount,
        openEditor,
        patchMenu,
        prepareFromElement,
        registerExtension,
        syncConfig
    });
}
