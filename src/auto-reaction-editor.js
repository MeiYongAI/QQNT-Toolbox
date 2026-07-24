const EDITOR_ID = 'qqnt-toolbox-auto-reaction-editor';
const STYLE_ID = 'qqnt-toolbox-auto-reaction-editor-style';
const MAX_SELECTED = 64;

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

export function normalizeAutoReactionCatalog(values) {
    const catalog = new Map();
    for (const value of Array.isArray(values) ? values : []) {
        const id = normalizeText(value?.id);
        const src = normalizeText(value?.src);
        if (!/^\d{1,16}$/.test(id) || !src.startsWith('data:image/') || catalog.has(id)) {
            continue;
        }
        catalog.set(id, {
            id,
            category: value?.category === 'unicode' ? 'unicode' : 'qq',
            label: normalizeText(value?.label) || `Emoji ${id}`,
            src
        });
    }
    return Array.from(catalog.values());
}

function parseCssColor(value) {
    const match = String(value || '').match(/^rgba?\(\s*(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)(?:\D+(\d*(?:\.\d+)?))?\s*\)$/i);
    return match ? {
        red: Number(match[1]),
        green: Number(match[2]),
        blue: Number(match[3]),
        alpha: match[4] === undefined || match[4] === '' ? 1 : Number(match[4])
    } : null;
}

function resolveOpaqueSurface(themeRoot, textColor) {
    for (let element = themeRoot; element instanceof Element; element = element.parentElement) {
        const color = getComputedStyle(element).backgroundColor;
        const parsed = parseCssColor(color);
        if (parsed?.alpha >= 0.98) {
            return `rgb(${parsed.red}, ${parsed.green}, ${parsed.blue})`;
        }
    }
    const text = parseCssColor(textColor);
    return text && text.red + text.green + text.blue > 420 ? '#1f1f1f' : '#ffffff';
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
    color: var(--qqnt-toolbox-auto-reaction-text, var(--text-primary, var(--text_primary, #1f2329)));
    background: rgba(0, 0, 0, .38);
    font: 14px/1.4 var(--font-family, "Microsoft YaHei UI", "Microsoft YaHei", sans-serif);
    letter-spacing: 0;
}
#${EDITOR_ID} .qqnt-toolbox-auto-reaction-page {
    display: flex;
    flex-direction: column;
    width: min(560px, calc(100vw - 32px));
    height: min(680px, calc(100vh - 32px));
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--border-level-1-color, var(--divider, rgba(127, 127, 127, .18)));
    border-radius: 8px;
    background: var(--qqnt-toolbox-auto-reaction-surface, var(--background-01, #fff));
    box-shadow: var(--shadow-bg-middle-primary, 0 14px 42px rgba(0, 0, 0, .24));
}
#${EDITOR_ID} .qqnt-toolbox-auto-reaction-header {
    display: grid;
    flex: none;
    place-items: center;
    min-height: 54px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border-level-1-color, var(--divider, rgba(127, 127, 127, .14)));
    box-sizing: border-box;
}
#${EDITOR_ID} .qqnt-toolbox-auto-reaction-title {
    font-size: 15px;
    font-weight: 600;
}
#${EDITOR_ID} .qqnt-toolbox-auto-reaction-toolbar {
    display: flex;
    flex: none;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
}
#${EDITOR_ID} .qqnt-toolbox-auto-reaction-search {
    min-width: 0;
    height: 32px;
    flex: 1;
    padding: 0 10px;
    box-sizing: border-box;
    border: 1px solid transparent;
    border-radius: 6px;
    outline: 0;
    color: inherit;
    background: var(--fill_standard_secondary, var(--background-02, rgba(127, 127, 127, .12)));
    font: inherit;
}
#${EDITOR_ID} .qqnt-toolbox-auto-reaction-search:focus {
    border-color: var(--brand_standard, var(--brand-primary, #2f6bff));
}
#${EDITOR_ID} .qqnt-toolbox-auto-reaction-tabs {
    display: flex;
    flex: none;
    gap: 2px;
    padding: 2px;
    border-radius: 6px;
    background: var(--fill_light_primary, var(--background-02, rgba(127, 127, 127, .10)));
}
#${EDITOR_ID} .qqnt-toolbox-auto-reaction-tab {
    height: 28px;
    padding: 0 10px;
    border: 0;
    border-radius: 4px;
    color: var(--text-secondary, var(--text_secondary, #6b7280));
    background: transparent;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
}
#${EDITOR_ID} .qqnt-toolbox-auto-reaction-tab[data-active="true"] {
    color: var(--brand_standard, var(--brand-primary, #2f6bff));
    background: var(--fill_light_primary, var(--background-01, rgba(255, 255, 255, .76)));
    box-shadow: 0 1px 3px rgba(0, 0, 0, .10);
}
#${EDITOR_ID} .qqnt-toolbox-auto-reaction-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(62px, 1fr));
    grid-auto-rows: 68px;
    flex: 1;
    min-height: 0;
    gap: 8px;
    padding: 0 16px 12px;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
    scrollbar-width: thin;
}
#${EDITOR_ID} .qqnt-toolbox-auto-reaction-item {
    position: relative;
    display: grid;
    grid-template-rows: 36px 16px;
    place-items: center;
    gap: 2px;
    min-width: 0;
    padding: 6px 4px;
    box-sizing: border-box;
    border: 1px solid transparent;
    border-radius: 6px;
    color: inherit;
    background: transparent;
    font: inherit;
    cursor: pointer;
}
#${EDITOR_ID} .qqnt-toolbox-auto-reaction-item:hover {
    background: var(--overlay_hover, rgba(127, 127, 127, .08));
}
#${EDITOR_ID} .qqnt-toolbox-auto-reaction-item[data-selected="true"] {
    border-color: var(--brand_standard, var(--brand-primary, #2f6bff));
    background: color-mix(in srgb, var(--brand_standard, var(--brand-primary, #2f6bff)) 10%, transparent);
}
#${EDITOR_ID} .qqnt-toolbox-auto-reaction-item[data-selected="true"]::after {
    position: absolute;
    top: 3px;
    right: 4px;
    color: var(--brand_standard, var(--brand-primary, #2f6bff));
    content: "✓";
    font-size: 11px;
    font-weight: 700;
}
#${EDITOR_ID} .qqnt-toolbox-auto-reaction-image {
    width: 30px;
    height: 30px;
    object-fit: contain;
}
#${EDITOR_ID} .qqnt-toolbox-auto-reaction-label {
    width: 100%;
    overflow: hidden;
    color: var(--text-secondary, var(--text_secondary, #6b7280));
    font-size: 11px;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#${EDITOR_ID} .qqnt-toolbox-auto-reaction-empty {
    grid-column: 1 / -1;
    align-self: start;
    padding: 64px 16px;
    color: var(--text-secondary, var(--text_secondary, #6b7280));
    text-align: center;
}
#${EDITOR_ID} .qqnt-toolbox-auto-reaction-footer {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    min-height: 58px;
    gap: 12px;
    padding: 0 16px;
    border-top: 1px solid var(--border-level-1-color, var(--divider, rgba(127, 127, 127, .14)));
}
#${EDITOR_ID} .qqnt-toolbox-auto-reaction-count {
    color: var(--text-secondary, var(--text_secondary, #6b7280));
    font-size: 12px;
}
#${EDITOR_ID} .qqnt-toolbox-auto-reaction-actions {
    display: flex;
    gap: 8px;
}
#${EDITOR_ID} .qqnt-toolbox-auto-reaction-cancel,
#${EDITOR_ID} .qqnt-toolbox-auto-reaction-save {
    height: 32px;
    padding: 0 14px;
    border: 1px solid var(--border-level-1-color, var(--divider, rgba(127, 127, 127, .22)));
    border-radius: 6px;
    color: inherit;
    background: var(--background-02, rgba(127, 127, 127, .08));
    font: inherit;
    cursor: pointer;
}
#${EDITOR_ID} .qqnt-toolbox-auto-reaction-save {
    border-color: var(--brand_standard, var(--brand-primary, #2f6bff));
    color: var(--on_brand_primary, #fff);
    background: var(--brand_standard, var(--brand-primary, #2f6bff));
}
@media (max-width: 560px) {
    #${EDITOR_ID} {
        padding: 12px;
    }
    #${EDITOR_ID} .qqnt-toolbox-auto-reaction-toolbar {
        align-items: stretch;
        flex-direction: column;
    }
    #${EDITOR_ID} .qqnt-toolbox-auto-reaction-tabs {
        align-self: flex-start;
    }
}`;
    document.head.append(style);
}

export function createAutoReactionEditor(options = {}) {
    let cleanup = null;
    let previousFocus = null;

    function close() {
        const dispose = cleanup;
        cleanup = null;
        dispose?.();
        document.getElementById(EDITOR_ID)?.remove();
        if (previousFocus?.isConnected) {
            previousFocus.focus({ preventScroll: true });
        }
        previousFocus = null;
    }

    function open(themeSource = null) {
        close();
        injectStyle();
        previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const selected = new Set((options.getSelected?.() || [])
            .map(normalizeText)
            .filter(id => /^\d{1,16}$/.test(id))
            .slice(0, MAX_SELECTED));
        let catalog = [];
        let filter = 'all';
        let query = '';
        let loading = true;
        let loadFailed = false;
        let disposed = false;

        const layer = createElement('div');
        layer.id = EDITOR_ID;
        layer.tabIndex = -1;
        layer.setAttribute('role', 'dialog');
        layer.setAttribute('aria-modal', 'true');
        layer.setAttribute('aria-label', '自动回应表情');
        const themeRoot = themeSource?.closest?.('#qqnt-toolbox-settings, #qqnt-toolbox-panel');
        let textColor = '';
        if (themeRoot instanceof Element) {
            textColor = getComputedStyle(themeRoot).color;
            if (textColor) {
                layer.style.setProperty('--qqnt-toolbox-auto-reaction-text', textColor);
            }
            layer.style.setProperty(
                '--qqnt-toolbox-auto-reaction-surface',
                resolveOpaqueSurface(themeRoot, textColor)
            );
            layer.style.colorScheme = parseCssColor(textColor)?.red > 160 ? 'dark' : 'light';
        }

        const page = createElement('div', 'qqnt-toolbox-auto-reaction-page');
        const header = createElement('div', 'qqnt-toolbox-auto-reaction-header');
        header.append(createElement('div', 'qqnt-toolbox-auto-reaction-title', '自动回应表情'));
        const toolbar = createElement('div', 'qqnt-toolbox-auto-reaction-toolbar');
        const search = createElement('input', 'qqnt-toolbox-auto-reaction-search');
        search.type = 'search';
        search.placeholder = '搜索表情';
        search.setAttribute('aria-label', '搜索表情');
        const tabs = createElement('div', 'qqnt-toolbox-auto-reaction-tabs');
        for (const [value, label] of [['all', '全部'], ['qq', 'QQ 表情'], ['unicode', 'Emoji']]) {
            const tab = createElement('button', 'qqnt-toolbox-auto-reaction-tab', label);
            tab.type = 'button';
            tab.dataset.filter = value;
            tab.dataset.active = String(value === filter);
            tabs.append(tab);
        }
        toolbar.append(search, tabs);
        const grid = createElement('div', 'qqnt-toolbox-auto-reaction-grid');
        const footer = createElement('div', 'qqnt-toolbox-auto-reaction-footer');
        const count = createElement('div', 'qqnt-toolbox-auto-reaction-count');
        const actions = createElement('div', 'qqnt-toolbox-auto-reaction-actions');
        const cancel = createElement('button', 'qqnt-toolbox-auto-reaction-cancel', '取消');
        cancel.type = 'button';
        const save = createElement('button', 'qqnt-toolbox-auto-reaction-save', '保存');
        save.type = 'button';
        actions.append(cancel, save);
        footer.append(count, actions);
        page.append(header, toolbar, grid, footer);
        layer.append(page);
        document.body.append(layer);

        const updateCount = () => {
            count.textContent = `已选择 ${selected.size}/${MAX_SELECTED}`;
            const limitReached = selected.size >= MAX_SELECTED;
            grid.querySelectorAll('.qqnt-toolbox-auto-reaction-item[data-selected="false"]').forEach(item => {
                item.disabled = limitReached;
            });
        };
        const render = () => {
            grid.replaceChildren();
            if (loading) {
                grid.append(createElement('div', 'qqnt-toolbox-auto-reaction-empty', '正在加载表情'));
                updateCount();
                return;
            }
            const words = query.toLocaleLowerCase();
            const visible = catalog.filter(item =>
                (filter === 'all' || item.category === filter) &&
                (!words || `${item.label} ${item.id}`.toLocaleLowerCase().includes(words))
            );
            if (!visible.length) {
                grid.append(createElement(
                    'div',
                    'qqnt-toolbox-auto-reaction-empty',
                    loadFailed ? '读取表情资源失败' : '没有符合条件的表情'
                ));
                updateCount();
                return;
            }
            for (const item of visible) {
                const button = createElement('button', 'qqnt-toolbox-auto-reaction-item');
                button.type = 'button';
                button.dataset.emojiId = item.id;
                button.dataset.selected = String(selected.has(item.id));
                button.setAttribute('aria-pressed', String(selected.has(item.id)));
                button.setAttribute('aria-label', item.label);
                button.title = item.label;
                const image = createElement('img', 'qqnt-toolbox-auto-reaction-image');
                image.src = item.src;
                image.alt = '';
                button.append(image, createElement('span', 'qqnt-toolbox-auto-reaction-label', item.label));
                grid.append(button);
            }
            updateCount();
        };
        const load = async () => {
            try {
                catalog = normalizeAutoReactionCatalog(await options.getCatalog?.());
                loadFailed = !catalog.length;
            } catch {
                loadFailed = true;
            } finally {
                if (!disposed) {
                    loading = false;
                    render();
                }
            }
        };
        const closePage = () => close();
        cancel.addEventListener('click', closePage);
        search.addEventListener('input', () => {
            query = search.value.trim();
            render();
        });
        tabs.addEventListener('click', event => {
            const tab = event.target.closest?.('.qqnt-toolbox-auto-reaction-tab[data-filter]');
            if (!tab) {
                return;
            }
            filter = tab.dataset.filter;
            tabs.querySelectorAll('.qqnt-toolbox-auto-reaction-tab').forEach(item => {
                item.dataset.active = String(item === tab);
            });
            render();
        });
        grid.addEventListener('click', event => {
            const button = event.target.closest?.('.qqnt-toolbox-auto-reaction-item[data-emoji-id]');
            if (!button || button.disabled) {
                return;
            }
            const id = button.dataset.emojiId;
            if (selected.has(id)) {
                selected.delete(id);
            } else if (selected.size < MAX_SELECTED) {
                selected.add(id);
            }
            button.dataset.selected = String(selected.has(id));
            button.setAttribute('aria-pressed', String(selected.has(id)));
            updateCount();
        });
        save.addEventListener('click', async () => {
            save.disabled = true;
            await options.save?.(Array.from(selected));
            close();
        });
        layer.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closePage();
            }
        });
        layer.addEventListener('click', event => {
            if (event.target === layer) {
                closePage();
            }
        });
        cleanup = () => {
            disposed = true;
        };
        render();
        load().catch(() => {});
        layer.focus({ preventScroll: true });
    }

    return Object.freeze({ close, open });
}
