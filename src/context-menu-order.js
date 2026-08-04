const EDITOR_ID = 'qqnt-toolbox-context-menu-order-editor';
const STYLE_ID = 'qqnt-toolbox-context-menu-order-style';
const SEPARATOR_ID_PREFIX = 'qq:separator:';
const OBSOLETE_MESSAGE_CONTEXT_MENU_IDS = new Set([
    'toolbox:multi-message-to-image',
    'toolbox:open-archived-file',
    'toolbox:reveal-archived-file'
]);

export const MENU_SCOPE_DEFINITIONS = Object.freeze([
    { id: 'message', label: '消息' },
    { id: 'avatar', label: '头像' },
    { id: 'recent', label: '会话列表' }
]);

const MENU_SCOPE_IDS = new Set(MENU_SCOPE_DEFINITIONS.map(item => item.id));
const MENU_SCOPE_SELECTORS = Object.freeze({
    avatar: [
        '.avatar-span',
        '.avatar',
        '[class*="avatar" i]',
        '[data-testid*="avatar" i]',
        '[data-type*="avatar" i]'
    ].join(','),
    message: '.message.vue-component,.message,.ml-item',
    recent: [
        '.recent-contact-item',
        '.recent-contact-list-item',
        '[class*="recent-contact-item" i]',
        '[class*="recent-item" i]'
    ].join(',')
});

const MESSAGE_MENU_PROVIDER_PROPERTIES = Object.freeze([
    ['msgCtxMenu', 'message'],
    ['ctxMenu', ''],
    ['contextMenu', ''],
    ['contextMenuRef', ''],
    ['menuRef', '']
]);

export const DEFAULT_MESSAGE_CONTEXT_MENU_ITEMS = Object.freeze([
    { id: 'qq:复制', label: '复制' },
    { id: 'toolbox:message-to-image', label: '转图', toolbox: true },
    { id: 'qq:转发', label: '转发' },
    { id: 'toolbox:repeat', label: '复读', toolbox: true },
    { id: 'qq:回复', label: '回复' },
    { id: 'qq:引用', label: '引用' },
    { id: 'qq:收藏', label: '收藏' },
    { id: 'qq:翻译', label: '翻译' },
    { id: 'qq:转文字', label: '转文字' },
    { id: 'qq:提取文字', label: '提取文字' },
    { id: 'qq:识别图中文字', label: '识别图中文字' },
    { id: 'toolbox:qr-scan', label: '识别二维码', toolbox: true },
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

export const DEFAULT_CONTEXT_MENU_ITEMS = Object.freeze({
    message: DEFAULT_MESSAGE_CONTEXT_MENU_ITEMS,
    avatar: Object.freeze([
        { id: 'qq:@TA', label: '@TA' },
        { id: 'qq:戳一戳', label: '戳一戳' },
        { id: 'qq:私聊', label: '私聊' },
        { id: 'qq:发消息', label: '发消息' },
        { id: 'qq:查看资料', label: '查看资料' },
        { id: 'qq:复制QQ号', label: '复制 QQ 号' },
        { id: 'qq:设置专属头衔', label: '设置专属头衔' },
        { id: 'qq:禁言', label: '禁言' },
        { id: 'qq:踢出群聊', label: '踢出群聊' },
        { id: 'qq:举报', label: '举报' }
    ]),
    recent: Object.freeze([
        { id: 'qq:置顶', label: '置顶' },
        { id: 'qq:取消置顶', label: '取消置顶' },
        { id: 'qq:标为未读', label: '标为未读' },
        { id: 'qq:设为已读', label: '设为已读' },
        { id: 'qq:消息免打扰', label: '消息免打扰' },
        { id: 'qq:取消消息免打扰', label: '取消消息免打扰' },
        { id: 'qq:打开独立聊天窗口', label: '打开独立聊天窗口' },
        { id: 'qq:移至分组', label: '移至分组' },
        { id: 'qq:清空聊天记录', label: '清空聊天记录' },
        { id: 'qq:隐藏会话', label: '隐藏会话' },
        { id: 'qq:从消息列表删除', label: '从消息列表删除' }
    ])
});

const TOOLBOX_ITEM_CLASSES = new Set([
    'qqnt-toolbox-repeat-menu-item',
    'qqnt-toolbox-poke-menu-item',
    'qqnt-toolbox-qr-scan-menu-item',
    'qqnt-toolbox-message-to-image-menu-item'
]);

function normalizeText(value) {
    return String(value ?? '').trim();
}

function normalizeMenuScope(value, fallback = 'message') {
    return MENU_SCOPE_IDS.has(value) ? value : fallback;
}

function closestScopeElement(element, scope) {
    const selector = MENU_SCOPE_SELECTORS[scope];
    if (!selector || typeof element?.closest !== 'function') {
        return null;
    }
    try {
        return element.closest(selector);
    } catch {
        return null;
    }
}

export function classifyContextMenuScope(element) {
    for (const scope of ['recent', 'avatar', 'message']) {
        if (closestScopeElement(element, scope)) {
            return scope;
        }
    }
    return '';
}

function snapshotEventPath(event) {
    try {
        return Array.from(event?.composedPath?.() || []);
    } catch {
        return [];
    }
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

export function closeNativeContextMenu(menu) {
    const elements = [menu, ...getContextMenuItemElements(menu, false)];
    const seen = new WeakSet();
    for (const element of elements) {
        const starts = [
            ...Array.from(element?.__VUE__ || []),
            element?.__vueParentComponent
        ].filter(Boolean);
        for (const start of starts) {
            for (let component = start, depth = 0; component && depth < 12;
                component = component.parent, depth += 1) {
                if (seen.has(component)) {
                    continue;
                }
                seen.add(component);
                const context = component.ctx || component.proxy;
                if (typeof context?.close !== 'function' ||
                    typeof context?.closeWhenEscPressed !== 'function' ||
                    typeof context?.closeWhenBlur !== 'function' ||
                    typeof context?.preventEventWhenMouseNotInMenu !== 'function') {
                    continue;
                }
                Reflect.apply(context.close, component.proxy || context, []);
                return true;
            }
        }
    }
    return false;
}

export function normalizeContextMenuOrder(values) {
    const seen = new Set();
    const result = [];
    for (const value of Array.isArray(values) ? values : []) {
        const id = normalizeText(value);
        if (id && !OBSOLETE_MESSAGE_CONTEXT_MENU_IDS.has(id) && !seen.has(id)) {
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

export function describeContextMenuElement(element) {
    const label = normalizeText(element?.textContent).replace(/\s+/g, ' ').trim();
    const keyLabel = label.replace(/\s+/g, '').replace(/[.。…]+$/u, '');
    return keyLabel ? { id: `qq:${keyLabel}`, label, toolbox: false } : null;
}

export function reorderContextMenuElements(elements, order) {
    const entries = Array.from(elements || [])
        .map(element => ({ element, descriptor: describeContextMenuElement(element) }))
        .filter(entry => entry.descriptor);
    const sorted = sortContextMenuEntries(entries, order);
    const groups = new Map();
    for (const entry of entries) {
        const parent = entry.element?.parentNode;
        if (!parent || typeof parent.replaceChildren !== 'function') {
            continue;
        }
        if (!groups.has(parent)) {
            groups.set(parent, []);
        }
        groups.get(parent).push(entry.element);
    }
    for (const [parent, originalElements] of groups) {
        const desiredElements = sorted
            .filter(entry => entry.element?.parentNode === parent)
            .map(entry => entry.element);
        if (desiredElements.length !== originalElements.length ||
            desiredElements.every((element, index) => element === originalElements[index])) {
            continue;
        }
        const children = Array.from(parent.childNodes || []);
        const positions = originalElements.map(element => children.indexOf(element));
        if (positions.some(index => index < 0)) {
            continue;
        }
        const reordered = [...children];
        positions.forEach((position, index) => {
            reordered[position] = desiredElements[index];
        });
        parent.replaceChildren(...reordered);
    }
    return sorted;
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
    const itemIds = new Set(items.map(item => describeContextMenuConfig(item)?.id).filter(Boolean));
    for (const item of Array.isArray(toolboxItems) ? toolboxItems : []) {
        if (!item || typeof item !== 'object') {
            continue;
        }
        const itemId = describeContextMenuConfig(item)?.id;
        if (itemId && itemIds.has(itemId)) {
            continue;
        }
        insertContextMenuConfig(items, item);
        if (itemId) {
            itemIds.add(itemId);
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

export function getDragInsertionIndex(rowMidpoints, pointerY) {
    const y = Number(pointerY);
    if (!Number.isFinite(y)) {
        return 0;
    }
    const midpoints = Array.isArray(rowMidpoints) ? rowMidpoints : [];
    const index = midpoints.findIndex(value => y < Number(value));
    return index < 0 ? midpoints.length : index;
}

export function getDragAutoScrollDelta(pointerY, top, bottom, edgeSize = 48, maxSpeed = 18) {
    const y = Number(pointerY);
    const start = Number(top);
    const end = Number(bottom);
    const edge = Math.max(1, Number(edgeSize) || 48);
    const speed = Math.max(1, Number(maxSpeed) || 18);
    if (![y, start, end].every(Number.isFinite) || end <= start) {
        return 0;
    }
    if (y < start + edge) {
        return -Math.ceil(speed * Math.min(1, Math.max(0, (start + edge - y) / edge)));
    }
    if (y > end - edge) {
        return Math.ceil(speed * Math.min(1, Math.max(0, (y - (end - edge)) / edge)));
    }
    return 0;
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
    -webkit-app-region: no-drag;
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
    width: min(440px, calc(100vw - 32px));
    height: min(480px, calc(100vh - 32px));
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
#${EDITOR_ID} .qqnt-toolbox-menu-order-tabs {
    display: flex;
    flex: none;
    gap: 2px;
    padding: 8px 12px 0;
    overflow: hidden;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-tab {
    position: relative;
    flex: 1 1 0;
    min-width: 0;
    height: 34px;
    padding: 0 10px;
    border: 0;
    border-radius: 6px 6px 0 0;
    color: var(--text-secondary, var(--text_secondary, var(--text-02, #6b7280)));
    background: transparent;
    font: inherit;
    cursor: pointer;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-tab:hover {
    color: inherit;
    background: var(--overlay_hover, rgba(127, 127, 127, .10));
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-tab[aria-selected="true"] {
    color: var(--brand_standard, var(--brand-primary, #2f6bff));
    font-weight: 600;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-tab[aria-selected="true"]::after {
    position: absolute;
    right: 12px;
    bottom: 0;
    left: 12px;
    height: 2px;
    border-radius: 2px;
    background: currentColor;
    content: "";
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
    scrollbar-gutter: stable;
    scrollbar-width: thin;
    scrollbar-color: var(--fill_standard_secondary, rgba(127, 127, 127, .30)) transparent;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-empty {
    display: grid;
    min-height: 260px;
    place-items: center;
    padding: 24px;
    box-sizing: border-box;
    color: var(--text-secondary, var(--text_secondary, var(--text-02, #6b7280)));
    text-align: center;
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
    grid-template-columns: 34px minmax(0, 1fr) 30px 30px;
    align-items: center;
    min-height: 42px;
    box-sizing: border-box;
    border-bottom: 1px solid var(--border-level-1-color, var(--divider, rgba(127, 127, 127, .10)));
    background: transparent;
    transition: background-color 120ms ease, border-color 120ms ease;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-row:last-child {
    border-bottom: 0;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-row[data-dragging="true"] {
    border: 1px dashed var(--brand_standard, var(--brand-primary, #2f6bff));
    border-radius: 6px;
    background: color-mix(in srgb, var(--brand_standard, var(--brand-primary, #2f6bff)) 9%, transparent);
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-row[data-dragging="true"] > * {
    visibility: hidden;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-list[data-dragging="true"],
#${EDITOR_ID} .qqnt-toolbox-menu-order-list[data-dragging="true"] * {
    cursor: grabbing !important;
    user-select: none;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-drag-ghost {
    position: fixed;
    z-index: 2;
    margin: 0;
    overflow: hidden;
    box-sizing: border-box;
    pointer-events: none;
    border: 1px solid var(--brand_standard, var(--brand-primary, #2f6bff));
    border-radius: 6px;
    color: var(--text-primary, var(--text_primary, var(--text-01, #1f2329)));
    background: var(--bg_top_light, var(--background-05, var(--background-01, #fff)));
    box-shadow: 0 8px 24px rgba(0, 0, 0, .26);
    opacity: .96;
    will-change: transform;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-handle {
    width: 34px;
    height: 34px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    color: var(--text-secondary, var(--text_secondary, var(--text-02, #6b7280)));
    background: transparent;
    font-size: 16px;
    line-height: 24px;
    text-align: center;
    cursor: grab;
    touch-action: none;
    user-select: none;
}
#${EDITOR_ID} .qqnt-toolbox-menu-order-handle:hover,
#${EDITOR_ID} .qqnt-toolbox-menu-order-handle:focus-visible {
    color: inherit;
    background: var(--overlay_hover, rgba(127, 127, 127, .12));
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

export function createContextMenuOrderController(options) {
    const runtime = typeof window !== 'undefined' ? window : globalThis;
    const scopeStates = new Map(MENU_SCOPE_DEFINITIONS.map(({ id }) => {
        const defaults = DEFAULT_CONTEXT_MENU_ITEMS[id] || [];
        return [id, {
            builtInIds: new Set(defaults.map(item => item.id)),
            discoveredItems: new Map(defaults.map(item => [item.id, item])),
            lastObservedOrder: []
        }];
    }));
    const extensions = new Map();
    const patchedMenus = new WeakMap();
    const patchedStates = new Set();
    let previousFocus = null;
    let editorCleanup = null;
    let catalogSaveTimer = 0;
    let nativeMenuRequestId = 0;
    const nativeMenuTimers = new Set();

    function getConfig() {
        const config = options.getConfig?.();
        return config && typeof config === 'object' ? config : {};
    }

    function getScopeConfig(scope) {
        const config = getConfig();
        const scoped = config.scopes?.[scope];
        if (scoped && typeof scoped === 'object') {
            return scoped;
        }
        return scope === 'message' && !config.scopes ? config : {};
    }

    function getScopeCatalog(scope) {
        const state = scopeStates.get(scope);
        return Array.from(state.discoveredItems.values())
            .filter(item => !state.builtInIds.has(item.id))
            .slice(0, 160)
            .map(item => ({
                id: item.id,
                label: item.label,
                toolbox: item.toolbox === true
            }));
    }

    function buildScopesConfig(orderOverrides = null) {
        const scopes = {};
        for (const { id } of MENU_SCOPE_DEFINITIONS) {
            const scopeConfig = getScopeConfig(id);
            const hasOverride = orderOverrides &&
                Object.prototype.hasOwnProperty.call(orderOverrides, id);
            scopes[id] = {
                items: normalizeContextMenuOrder(
                    hasOverride ? orderOverrides[id] : scopeConfig.items
                ),
                catalog: getScopeCatalog(id)
            };
        }
        return scopes;
    }

    function syncConfig() {
        for (const { id } of MENU_SCOPE_DEFINITIONS) {
            const state = scopeStates.get(id);
            for (const value of Array.isArray(getScopeConfig(id).catalog)
                ? getScopeConfig(id).catalog
                : []) {
                const item = normalizeCatalogItem(value);
                if (item && !OBSOLETE_MESSAGE_CONTEXT_MENU_IDS.has(item.id) &&
                    !state.discoveredItems.has(item.id)) {
                    state.discoveredItems.set(item.id, item);
                }
            }
        }
        if (getConfig().enabled !== true) {
            clearNativeMenuRequest();
            closeEditor();
        }
    }

    function scheduleCatalogSave() {
        runtime.clearTimeout(catalogSaveTimer);
        catalogSaveTimer = runtime.setTimeout(() => {
            catalogSaveTimer = 0;
            const scopes = buildScopesConfig();
            const changed = MENU_SCOPE_DEFINITIONS.some(({ id }) =>
                JSON.stringify(getScopeConfig(id).catalog) !==
                JSON.stringify(scopes[id].catalog)
            );
            if (!changed) {
                return;
            }
            if (typeof options.saveScopes === 'function') {
                Promise.resolve(options.saveScopes(scopes)).catch(() => {});
            } else {
                Promise.resolve(options.saveCatalog?.(scopes.message.catalog)).catch(() => {});
            }
        }, 240);
    }

    function rememberItems(scope, entries) {
        const state = scopeStates.get(normalizeMenuScope(scope));
        let changed = false;
        const order = [];
        for (const entry of entries) {
            if (!entry.descriptor) {
                continue;
            }
            order.push(entry.descriptor.id);
            if (!state.discoveredItems.has(entry.descriptor.id)) {
                state.discoveredItems.set(entry.descriptor.id, entry.descriptor);
                changed = true;
            }
        }
        state.lastObservedOrder = Array.from(new Set(order));
        if (changed) {
            scheduleCatalogSave();
        }
    }

    function extensionMatchesScope(extension, scope) {
        return normalizeMenuScope(extension?.scope, 'message') === scope;
    }

    function runExtensionHook(name, value, scope) {
        let current = value;
        for (const extension of extensions.values()) {
            if (!extensionMatchesScope(extension, scope)) {
                continue;
            }
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

    function getExtensionItems(context, scope) {
        const items = [];
        for (const extension of extensions.values()) {
            if (!extensionMatchesScope(extension, scope)) {
                continue;
            }
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

    function getEventElement(event, fallback = null) {
        if (typeof Element === 'undefined') {
            return null;
        }
        if (fallback instanceof Element) {
            return fallback;
        }
        try {
            const pathElement = Array.from(event?.composedPath?.() || [])
                .find(item => item instanceof Element);
            if (pathElement) {
                return pathElement;
            }
        } catch {
        }
        return event?.target instanceof Element ? event.target : null;
    }

    function isMenuProvider(value) {
        return value?._?.ctx &&
            typeof value._.ctx.openMenu === 'function' &&
            Boolean(Object.getOwnPropertyDescriptor(value._.ctx, 'showMenuConfig'));
    }

    function unwrapMenuProvider(value) {
        if (isMenuProvider(value)) {
            return value;
        }
        try {
            return isMenuProvider(value?.value) ? value.value : null;
        } catch {
            return null;
        }
    }

    function findMenuCandidatesFromComponent(component, allowDirect = false) {
        const result = [];
        const seen = new WeakSet();
        const add = (value, scope = '') => {
            const menu = unwrapMenuProvider(value);
            const context = menu?._?.ctx;
            if (!context || seen.has(context)) {
                return;
            }
            seen.add(context);
            result.push({ menu, scope });
        };
        for (const host of [component?.proxy, component?.ctx]) {
            if (!host || (typeof host !== 'object' && typeof host !== 'function')) {
                continue;
            }
            for (const [property, scope] of MESSAGE_MENU_PROVIDER_PROPERTIES) {
                if (!allowDirect && scope !== 'message') {
                    continue;
                }
                try {
                    add(host[property], scope);
                } catch {
                }
            }
            if (allowDirect) {
                add(host);
            }
        }
        return result;
    }

    function patchMenu(menu, capturedContext = null, defaultScope = 'message') {
        const menuContext = menu?._?.ctx;
        if (!menuContext) {
            return false;
        }
        const resolvedDefaultScope = normalizeMenuScope(defaultScope, '');
        const capturedScope = normalizeMenuScope(capturedContext?.scope, '');
        if (resolvedDefaultScope !== 'message' && capturedScope !== 'message') {
            return false;
        }
        const existingState = patchedMenus.get(menuContext);
        if (existingState) {
            if (capturedContext && capturedScope) {
                existingState.pendingSourceEvent = capturedContext.sourceEvent || null;
                existingState.pendingSourceEventPath = capturedContext.sourceEventPath || [];
                existingState.pendingTargetElement = capturedContext.targetElement || null;
                existingState.pendingMessageElement = capturedContext.messageElement || null;
            }
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
            menuContext,
            originalShowDescriptor: showDescriptor,
            originalOpenMenu,
            patchedGet: null,
            patchedOpenMenu: null,
            sourceEvent: null,
            capturedSourceEvent: null,
            sourceEventPath: [],
            targetElement: null,
            messageElement: null,
            pendingSourceEvent: capturedContext?.sourceEvent || null,
            pendingSourceEventPath: capturedContext?.sourceEventPath || [],
            pendingTargetElement: capturedContext?.targetElement || null,
            pendingMessageElement: capturedContext?.messageElement || null,
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
            const scope = 'message';
            const hookContext = {
                menu,
                scope,
                sourceEvent: state.capturedSourceEvent || state.sourceEvent,
                sourceEventPath: state.sourceEventPath,
                targetElement: state.targetElement,
                messageElement: scope === 'message' ? state.messageElement : null,
                originalContext: state.originalContext,
                context: state.context,
                options: state.options
            };
            configs = runExtensionHook(
                'transformItems',
                { ...hookContext, items: [...configs] },
                scope
            )?.items || configs;
            const additions = getExtensionItems(hookContext, scope);
            const scopeConfig = getScopeConfig(scope);
            const combined = composeContextMenuConfigs(
                configs,
                additions,
                scopeConfig.items,
                getConfig().enabled === true
            );
            if (getConfig().enabled === true) {
                rememberItems(scope, describeContextMenuConfigs(combined));
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
                options: args[3],
                getNativeItemsForContext: context => {
                    const previousContext = menuContext.menuContext;
                    try {
                        menuContext.menuContext = context;
                        const configs = originalGet.call(menuContext);
                        return Array.isArray(configs) ? [...configs] : [];
                    } catch {
                        return [];
                    } finally {
                        try {
                            menuContext.menuContext = previousContext;
                        } catch {
                        }
                    }
                }
            };
            const scope = 'message';
            request = runExtensionHook('beforeOpen', { ...request, scope }, scope) || request;
            const nextArgs = Array.isArray(request.args) ? [...request.args] : [...args];
            if (nextArgs.length > 0) {
                nextArgs[0] = request.sourceEvent;
            }
            if (nextArgs.length > 1) {
                nextArgs[1] = request.items;
            }
            if (nextArgs.length > 2) {
                nextArgs[2] = request.context;
            }
            if (nextArgs.length > 3) {
                nextArgs[3] = request.options;
            }
            state.sourceEvent = request.sourceEvent;
            state.capturedSourceEvent = state.pendingSourceEvent || request.sourceEvent;
            state.sourceEventPath = state.pendingSourceEventPath.length
                ? state.pendingSourceEventPath
                : snapshotEventPath(state.capturedSourceEvent);
            state.targetElement = state.pendingTargetElement ||
                getEventElement(state.capturedSourceEvent);
            state.messageElement = scope === 'message'
                ? state.pendingMessageElement || closestScopeElement(state.targetElement, 'message')
                : null;
            state.pendingSourceEvent = null;
            state.pendingSourceEventPath = [];
            state.pendingTargetElement = null;
            state.pendingMessageElement = null;
            state.originalContext = request.originalContext;
            state.context = request.context;
            state.options = request.options;
            return Reflect.apply(originalOpenMenu, this, nextArgs);
        };
        state.patchedGet = patchedGet;
        state.patchedOpenMenu = patchedOpenMenu;
        Object.defineProperty(menuContext, 'showMenuConfig', {
            ...showDescriptor,
            get: patchedGet
        });
        menuContext.openMenu = patchedOpenMenu;
        patchedMenus.set(menuContext, state);
        patchedStates.add(state);
        return true;
    }

    function restoreMenuState(state) {
        if (!state || !patchedStates.has(state)) {
            return;
        }
        const currentDescriptor = Object.getOwnPropertyDescriptor(
            state.menuContext,
            'showMenuConfig'
        );
        if (currentDescriptor?.get === state.patchedGet) {
            Object.defineProperty(
                state.menuContext,
                'showMenuConfig',
                state.originalShowDescriptor
            );
        }
        if (state.menuContext.openMenu === state.patchedOpenMenu) {
            state.menuContext.openMenu = state.originalOpenMenu;
        }
        patchedMenus.delete(state.menuContext);
        patchedStates.delete(state);
    }

    function clearNativeMenuRequest() {
        nativeMenuRequestId += 1;
        for (const timer of nativeMenuTimers) {
            runtime.clearTimeout(timer);
        }
        nativeMenuTimers.clear();
    }

    function isVisibleNativeMenu(menu) {
        if (!menu?.isConnected || menu.hidden) {
            return false;
        }
        try {
            const style = runtime.getComputedStyle?.(menu);
            if (style?.display === 'none' || style?.visibility === 'hidden') {
                return false;
            }
        } catch {
        }
        return getContextMenuItemElements(menu, true).length > 0;
    }

    function getMenuDistance(menu, point) {
        try {
            const rect = menu.getBoundingClientRect?.();
            if (!rect || (!rect.width && !rect.height)) {
                return Number.MAX_SAFE_INTEGER;
            }
            const dx = point.x < rect.left
                ? rect.left - point.x
                : point.x > rect.right ? point.x - rect.right : 0;
            const dy = point.y < rect.top
                ? rect.top - point.y
                : point.y > rect.bottom ? point.y - rect.bottom : 0;
            return Math.hypot(dx, dy);
        } catch {
            return Number.MAX_SAFE_INTEGER;
        }
    }

    function applyNativeMenuOrder(scope, point) {
        if (getConfig().enabled !== true || typeof document === 'undefined') {
            return false;
        }
        const menus = Array.from(document.querySelectorAll(
            '.q-context-menu,[role="menu"][class*="context-menu" i]'
        )).filter(isVisibleNativeMenu);
        if (!menus.length) {
            return false;
        }
        menus.sort((left, right) => getMenuDistance(left, point) - getMenuDistance(right, point));
        const menu = menus[0];
        const elements = getContextMenuItemElements(menu, true);
        const entries = elements
            .map(element => ({ element, descriptor: describeContextMenuElement(element) }))
            .filter(entry => entry.descriptor);
        if (!entries.length) {
            return false;
        }
        rememberItems(scope, entries);
        reorderContextMenuElements(elements, getScopeConfig(scope).items);
        return true;
    }

    function handleNativeContextMenu(event, element = null, scopeHint = '') {
        clearNativeMenuRequest();
        if (getConfig().enabled !== true || typeof Element === 'undefined') {
            return false;
        }
        const target = getEventElement(event, element);
        const scope = normalizeMenuScope(scopeHint, '') || classifyContextMenuScope(target);
        if (!scope || scope === 'message') {
            return false;
        }
        const requestId = nativeMenuRequestId;
        const point = {
            x: Number(event?.clientX) || 0,
            y: Number(event?.clientY) || 0
        };
        for (const delay of [16, 48, 112, 220]) {
            const timer = runtime.setTimeout(() => {
                nativeMenuTimers.delete(timer);
                if (requestId === nativeMenuRequestId) {
                    applyNativeMenuOrder(scope, point);
                }
            }, delay);
            nativeMenuTimers.add(timer);
        }
        return true;
    }

    function prepareFromElement(element, sourceEvent = null) {
        if (typeof Element === 'undefined') {
            return false;
        }
        const target = getEventElement(sourceEvent, element);
        if (!(target instanceof Element)) {
            return false;
        }
        const messageElement = closestScopeElement(target, 'message') || element;
        if (!(messageElement instanceof Element)) {
            return false;
        }
        const anchors = [];
        const seenElements = new Set();
        const addAnchor = value => {
            if (value instanceof Element && !seenElements.has(value)) {
                seenElements.add(value);
                anchors.push(value);
            }
        };
        addAnchor(target);
        addAnchor(element);
        addAnchor(messageElement);
        for (let ancestor = target.parentElement, depth = 0;
            ancestor && depth < 12;
            ancestor = ancestor.parentElement, depth += 1) {
            addAnchor(ancestor);
        }

        const seenComponents = new WeakSet();
        for (const anchor of anchors) {
            const starts = [
                ...Array.from(anchor?.__VUE__ || []),
                anchor?.__vueParentComponent
            ].filter(Boolean);
            for (const start of new Set(starts)) {
                for (let component = start, depth = 0; component && depth < 24;
                    component = component.parent, depth += 1) {
                    if (seenComponents.has(component)) {
                        continue;
                    }
                    seenComponents.add(component);
                    const candidates = findMenuCandidatesFromComponent(component, true);
                    for (const candidate of candidates) {
                        if (candidate.scope && candidate.scope !== 'message') {
                            continue;
                        }
                        if (patchMenu(candidate.menu, {
                            scope: 'message',
                            sourceEvent,
                            sourceEventPath: snapshotEventPath(sourceEvent),
                            targetElement: target,
                            messageElement
                        }, 'message')) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    function handleContextMenu(event, element = null) {
        return prepareFromElement(element || getEventElement(event), event);
    }

    function patchMessageProviderFromComponent(component, messageElement) {
        const seen = new WeakSet();
        for (let current = component, depth = 0; current && depth < 24;
            current = current.parent, depth += 1) {
            if (seen.has(current)) {
                continue;
            }
            seen.add(current);
            for (const candidate of findMenuCandidatesFromComponent(current, true)) {
                if (candidate.scope && candidate.scope !== 'message') {
                    continue;
                }
                if (patchMenu(candidate.menu, {
                    scope: 'message',
                    messageElement
                }, 'message')) {
                    return true;
                }
            }
        }
        return false;
    }

    function getMountedItemScope(component) {
        const seen = new WeakSet();
        for (let current = component, depth = 0; current && depth < 16;
            current = current.parent, depth += 1) {
            if (seen.has(current)) {
                continue;
            }
            seen.add(current);
            for (const { menu } of findMenuCandidatesFromComponent(current, true)) {
                const state = patchedMenus.get(menu._.ctx);
                if (state) {
                    return 'message';
                }
            }
        }
        return '';
    }

    function handleVueComponentMount(component, patchProvider = true) {
        if (patchProvider) {
            const componentElement = component?.vnode?.el;
            let messageElement = null;
            try {
                messageElement = options.resolveMessageElement?.(componentElement) || null;
            } catch {
            }
            if (typeof Element !== 'undefined' && messageElement instanceof Element) {
                patchMessageProviderFromComponent(component, messageElement);
            }
        }
        const element = component?.vnode?.el;
        const item = typeof Element !== 'undefined' && element instanceof Element
            ? element.closest?.('.q-context-menu-item')
            : null;
        if (!item) {
            return;
        }
        const scope = getMountedItemScope(component) || 'message';
        for (const extension of extensions.values()) {
            if (!extensionMatchesScope(extension, scope)) {
                continue;
            }
            try {
                extension?.onItemMounted?.({ component, item, scope });
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

    function getEditorItems(scope, order = getScopeConfig(scope).items) {
        syncConfig();
        const state = scopeStates.get(scope);
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
        const configuredOrder = normalizeContextMenuOrder(order);
        const separatorReferenceOrder = state.lastObservedOrder.length
            ? state.lastObservedOrder
            : (DEFAULT_CONTEXT_MENU_ITEMS[scope] || []).map(item => item.id);
        append(configuredOrder.length
            ? mergeObservedSeparators(configuredOrder, separatorReferenceOrder)
            : state.lastObservedOrder);
        append(state.lastObservedOrder);
        append(state.discoveredItems.keys());
        return ids.map(id => state.discoveredItems.get(id) || {
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
        const cleanup = editorCleanup;
        editorCleanup = null;
        cleanup?.();
        if (typeof document !== 'undefined') {
            document.getElementById(EDITOR_ID)?.remove();
        }
        if (previousFocus?.isConnected) {
            previousFocus.focus({ preventScroll: true });
        }
        previousFocus = null;
    }

    function openEditor() {
        closeEditor();
        injectStyle();
        syncConfig();
        previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const layer = createElement('div');
        layer.id = EDITOR_ID;
        layer.tabIndex = -1;
        layer.setAttribute('role', 'dialog');
        layer.setAttribute('aria-modal', 'true');
        layer.setAttribute('aria-label', '菜单排序管理');
        const dialog = createElement('div', 'qqnt-toolbox-menu-order-dialog');
        const header = createElement('div', 'qqnt-toolbox-menu-order-header');
        const title = createElement('div', 'qqnt-toolbox-menu-order-title', '菜单排序管理');
        const close = createElement('button', 'qqnt-toolbox-menu-order-close', '×');
        close.type = 'button';
        close.title = '关闭';
        close.setAttribute('aria-label', '关闭');
        header.append(title, close);

        const tabs = createElement('div', 'qqnt-toolbox-menu-order-tabs');
        tabs.setAttribute('role', 'tablist');
        const list = createElement('div', 'qqnt-toolbox-menu-order-list');
        list.id = `${EDITOR_ID}-list`;
        list.setAttribute('role', 'list');
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
        dialog.append(header, tabs, list, footer);
        layer.append(dialog);
        document.body.append(layer);

        const draftOrders = Object.fromEntries(MENU_SCOPE_DEFINITIONS.map(({ id }) => [
            id,
            normalizeContextMenuOrder(getScopeConfig(id).items)
        ]));
        let activeScope = 'message';
        let pointerDrag = null;
        let autoScrollFrame = 0;

        const createRow = item => {
            const row = createElement('div', 'qqnt-toolbox-menu-order-row');
            row.dataset.itemId = item.id;
            row.setAttribute('role', 'listitem');
            const handle = createElement('button', 'qqnt-toolbox-menu-order-handle', '⋮⋮');
            handle.type = 'button';
            handle.title = '拖动';
            handle.setAttribute('aria-label', `${item.label} 拖动排序`);
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
            return row;
        };

        const updateDraftOrder = () => {
            draftOrders[activeScope] = Array.from(
                list.querySelectorAll('.qqnt-toolbox-menu-order-row')
            ).map(row => row.dataset.itemId).filter(Boolean);
        };

        const renderScope = scope => {
            activeScope = normalizeMenuScope(scope, 'message');
            list.replaceChildren();
            const items = getEditorItems(activeScope, draftOrders[activeScope]);
            if (items.length) {
                list.append(...items.map(createRow));
                updateMoveButtons(list);
            } else {
                const empty = createElement(
                    'div',
                    'qqnt-toolbox-menu-order-empty',
                    '暂无可排序项目'
                );
                empty.setAttribute('role', 'status');
                list.append(empty);
            }
            tabs.querySelectorAll('.qqnt-toolbox-menu-order-tab').forEach(tab => {
                const selected = tab.dataset.scope === activeScope;
                tab.setAttribute('aria-selected', String(selected));
                tab.tabIndex = selected ? 0 : -1;
            });
            restore.disabled = !getScopeConfig(activeScope).items?.length &&
                !scopeStates.get(activeScope).lastObservedOrder.length;
        };

        for (const definition of MENU_SCOPE_DEFINITIONS) {
            const tab = createElement(
                'button',
                'qqnt-toolbox-menu-order-tab',
                definition.label
            );
            tab.type = 'button';
            tab.dataset.scope = definition.id;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-controls', list.id);
            tab.addEventListener('click', () => {
                if (definition.id !== activeScope) {
                    renderScope(definition.id);
                }
            });
            tabs.append(tab);
        }
        renderScope(activeScope);

        const updatePointerDrag = clientY => {
            if (!pointerDrag?.started) {
                return;
            }
            pointerDrag.clientY = clientY;
            pointerDrag.ghost.style.transform =
                `translate3d(0, ${clientY - pointerDrag.startY}px, 0)`;
            const rows = Array.from(list.querySelectorAll('.qqnt-toolbox-menu-order-row'))
                .filter(row => row !== pointerDrag.row);
            const insertionIndex = getDragInsertionIndex(
                rows.map(row => {
                    const rect = row.getBoundingClientRect();
                    return rect.top + rect.height / 2;
                }),
                clientY
            );
            const target = rows[insertionIndex] || null;
            if (target && pointerDrag.row.nextElementSibling !== target) {
                list.insertBefore(pointerDrag.row, target);
                updateMoveButtons(list);
            } else if (!target && pointerDrag.row !== list.lastElementChild) {
                list.append(pointerDrag.row);
                updateMoveButtons(list);
            }
        };

        const runAutoScroll = () => {
            if (!pointerDrag?.started) {
                autoScrollFrame = 0;
                return;
            }
            const rect = list.getBoundingClientRect();
            const delta = getDragAutoScrollDelta(pointerDrag.clientY, rect.top, rect.bottom);
            if (delta) {
                const previousScrollTop = list.scrollTop;
                list.scrollTop += delta;
                if (list.scrollTop !== previousScrollTop) {
                    updatePointerDrag(pointerDrag.clientY);
                }
            }
            autoScrollFrame = runtime.requestAnimationFrame(runAutoScroll);
        };

        const startPointerDrag = () => {
            if (!pointerDrag || pointerDrag.started) {
                return;
            }
            const rect = pointerDrag.row.getBoundingClientRect();
            const ghost = pointerDrag.row.cloneNode(true);
            ghost.classList.add('qqnt-toolbox-menu-order-drag-ghost');
            ghost.removeAttribute('data-dragging');
            ghost.setAttribute('aria-hidden', 'true');
            ghost.querySelectorAll('button').forEach(button => {
                button.tabIndex = -1;
            });
            Object.assign(ghost.style, {
                left: `${rect.left}px`,
                top: `${rect.top}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`
            });
            layer.append(ghost);
            pointerDrag.started = true;
            pointerDrag.ghost = ghost;
            pointerDrag.row.dataset.dragging = 'true';
            list.dataset.dragging = 'true';
            autoScrollFrame = runtime.requestAnimationFrame(runAutoScroll);
        };

        const finishPointerDrag = () => {
            const drag = pointerDrag;
            pointerDrag = null;
            if (!drag) {
                return;
            }
            if (drag.handle.hasPointerCapture?.(drag.pointerId)) {
                drag.handle.releasePointerCapture(drag.pointerId);
            }
            if (autoScrollFrame) {
                runtime.cancelAnimationFrame(autoScrollFrame);
                autoScrollFrame = 0;
            }
            drag.ghost?.remove();
            drag.row.removeAttribute('data-dragging');
            list.removeAttribute('data-dragging');
            updateMoveButtons(list);
            if (drag.started) {
                updateDraftOrder();
            }
        };
        editorCleanup = finishPointerDrag;

        list.addEventListener('pointerdown', event => {
            const handle = event.target.closest?.('.qqnt-toolbox-menu-order-handle');
            const row = handle?.closest?.('.qqnt-toolbox-menu-order-row');
            if (pointerDrag || !handle || !row || event.button !== 0) {
                return;
            }
            pointerDrag = {
                pointerId: event.pointerId,
                handle,
                row,
                startX: event.clientX,
                startY: event.clientY,
                clientY: event.clientY,
                started: false,
                ghost: null
            };
            handle.setPointerCapture?.(event.pointerId);
            event.preventDefault();
        });
        list.addEventListener('pointermove', event => {
            if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) {
                return;
            }
            if (!pointerDrag.started && Math.hypot(
                event.clientX - pointerDrag.startX,
                event.clientY - pointerDrag.startY
            ) >= 4) {
                startPointerDrag();
            }
            if (pointerDrag.started) {
                updatePointerDrag(event.clientY);
                event.preventDefault();
            }
        });
        list.addEventListener('pointerup', event => {
            if (pointerDrag?.pointerId === event.pointerId) {
                const started = pointerDrag.started;
                finishPointerDrag();
                if (started) {
                    event.preventDefault();
                }
            }
        });
        list.addEventListener('pointercancel', event => {
            if (pointerDrag?.pointerId === event.pointerId) {
                finishPointerDrag();
            }
        });

        const moveRow = (row, direction) => {
            if (direction === 'up') {
                row.previousElementSibling?.before(row);
            } else {
                row.nextElementSibling?.after(row);
            }
            updateMoveButtons(list);
            updateDraftOrder();
            row.scrollIntoView?.({ block: 'nearest' });
        };
        list.addEventListener('click', event => {
            const button = event.target.closest?.(
                '.qqnt-toolbox-menu-order-move[data-direction]'
            );
            const row = button?.closest?.('.qqnt-toolbox-menu-order-row');
            if (!button || !row || button.disabled) {
                return;
            }
            moveRow(row, button.dataset.direction);
        });
        list.addEventListener('keydown', event => {
            const handle = event.target.closest?.('.qqnt-toolbox-menu-order-handle');
            const row = handle?.closest?.('.qqnt-toolbox-menu-order-row');
            if (!handle || !row || !['ArrowUp', 'ArrowDown'].includes(event.key)) {
                return;
            }
            event.preventDefault();
            moveRow(row, event.key === 'ArrowUp' ? 'up' : 'down');
            handle.focus({ preventScroll: true });
        });

        const closeEditorWithCleanup = () => closeEditor();
        close.addEventListener('click', closeEditorWithCleanup);
        cancel.addEventListener('click', closeEditorWithCleanup);
        restore.addEventListener('click', () => {
            finishPointerDrag();
            draftOrders[activeScope] = [];
            renderScope(activeScope);
        });
        save.addEventListener('click', async () => {
            finishPointerDrag();
            save.disabled = true;
            if (typeof options.saveScopes === 'function') {
                await options.saveScopes(buildScopesConfig(draftOrders));
            } else {
                await options.saveOrder?.(draftOrders.message);
            }
            closeEditor();
        });
        layer.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeEditorWithCleanup();
            }
        });
        layer.focus({ preventScroll: true });
    }

    function dispose() {
        runtime.clearTimeout(catalogSaveTimer);
        clearNativeMenuRequest();
        extensions.clear();
        for (const state of Array.from(patchedStates)) {
            restoreMenuState(state);
        }
        closeEditor();
    }

    return Object.freeze({
        closeEditor,
        dispose,
        handleContextMenu,
        handleNativeContextMenu,
        handleVueComponentMount,
        openEditor,
        patchMenu,
        prepareFromElement,
        registerExtension,
        syncConfig
    });
}

export const createMessageContextMenuOrderController = createContextMenuOrderController;
