const EDITOR_ID = 'qqnt-toolbox-recall-filter-editor';
const STYLE_ID = 'qqnt-toolbox-recall-filter-editor-style';
const MAX_SELECTED = 256;

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

export function normalizeRecallFilterContact(value) {
    const chatType = Number(value?.chatType) || 0;
    const peerUid = normalizeText(value?.peerUid || value?.peerUin);
    if (![1, 2].includes(chatType) || !peerUid) {
        return null;
    }
    const peerUin = normalizeText(value?.peerUin);
    return {
        key: `${chatType}:${peerUid}`,
        chatType,
        peerUid,
        peerUin,
        label: normalizeText(value?.label) || `${chatType === 2 ? '群聊' : '私聊'} ${peerUin || peerUid}`,
        avatarUrl: normalizeText(value?.avatarUrl),
        msgTime: Number(value?.msgTime) || 0
    };
}

export function mergeRecallFilterContacts(contacts, selected) {
    const merged = new Map();
    const append = values => {
        for (const value of Array.isArray(values) ? values : [values]) {
            const contact = normalizeRecallFilterContact(value);
            if (!contact) {
                continue;
            }
            const previous = merged.get(contact.key);
            merged.set(contact.key, {
                ...contact,
                label: previous?.label || contact.label,
                avatarUrl: previous?.avatarUrl || contact.avatarUrl,
                msgTime: Math.max(previous?.msgTime || 0, contact.msgTime)
            });
        }
    };
    append(contacts);
    append(selected);
    return Array.from(merged.values()).sort((left, right) =>
        left.label.localeCompare(right.label, 'zh-CN', { numeric: true, sensitivity: 'base' })
    );
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
    color: var(--qqnt-toolbox-recall-filter-text, var(--text-primary, var(--text_primary, var(--text-01, #1f2329))));
    background: rgba(0, 0, 0, .38);
    font: 14px/1.4 var(--font-family, "Microsoft YaHei UI", "Microsoft YaHei", sans-serif);
    letter-spacing: 0;
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-page {
    display: flex;
    flex-direction: column;
    width: min(500px, calc(100vw - 32px));
    height: min(680px, calc(100vh - 32px));
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--border-level-1-color, var(--divider, rgba(127, 127, 127, .18)));
    border-radius: 8px;
    background: var(--qqnt-toolbox-recall-filter-surface, var(--bg_top_light, var(--background-05, var(--background-01, #fff))));
    box-shadow: var(--shadow-bg-middle-primary, 0 14px 42px rgba(0, 0, 0, .24));
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-header {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    min-height: 54px;
    padding: 0 16px;
    box-sizing: border-box;
    border-bottom: 1px solid var(--border-level-1-color, var(--divider, rgba(127, 127, 127, .14)));
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-title {
    min-width: 0;
    overflow: hidden;
    font-size: 15px;
    font-weight: 600;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-toolbar {
    display: flex;
    flex: none;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-search {
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
#${EDITOR_ID} .qqnt-toolbox-recall-filter-search:focus {
    border-color: var(--brand_standard, var(--brand-primary, #2f6bff));
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-tabs {
    display: flex;
    flex: none;
    gap: 2px;
    padding: 2px;
    border-radius: 6px;
    background: var(--fill_light_primary, var(--background-02, rgba(127, 127, 127, .10)));
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-tab {
    height: 28px;
    padding: 0 10px;
    border: 0;
    border-radius: 4px;
    color: var(--text-secondary, var(--text_secondary, var(--text-02, #6b7280)));
    background: transparent;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-tab[data-active="true"] {
    color: var(--brand_standard, var(--brand-primary, #2f6bff));
    background: var(--fill_light_primary, var(--background-01, rgba(255, 255, 255, .76)));
    box-shadow: 0 1px 3px rgba(0, 0, 0, .12);
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-mode {
    flex: none;
    padding: 0 16px 8px;
    color: var(--text-secondary, var(--text_secondary, var(--text-02, #6b7280)));
    font-size: 12px;
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-list {
    flex: 1;
    min-height: 0;
    padding: 0 16px;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
    scrollbar-width: thin;
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-row {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) 22px;
    align-items: center;
    min-height: 56px;
    gap: 10px;
    border-bottom: 1px solid var(--border-level-1-color, var(--divider, rgba(127, 127, 127, .10)));
    cursor: pointer;
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-row:hover {
    background: var(--overlay_hover, rgba(127, 127, 127, .06));
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-row[data-selected="true"] {
    background: var(--overlay_hover, rgba(127, 127, 127, .08));
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-row[data-selected="true"] .qqnt-toolbox-recall-filter-name {
    color: var(--brand_standard, var(--brand-primary, #2f6bff));
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
    background: var(--fill_standard_secondary, rgba(127, 127, 127, .18));
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-avatar-fallback {
    display: grid;
    place-items: center;
    color: var(--text-secondary, var(--text_secondary, var(--text-02, #6b7280)));
    font-size: 12px;
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-contact {
    display: grid;
    min-width: 0;
    gap: 2px;
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-name,
#${EDITOR_ID} .qqnt-toolbox-recall-filter-detail {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-detail {
    color: var(--text-secondary, var(--text_secondary, var(--text-02, #6b7280)));
    font-size: 12px;
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-check {
    appearance: none;
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    margin: 0;
    box-sizing: border-box;
    border: 1px solid var(--text-secondary, var(--text_secondary, var(--text-02, #8b929d)));
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-check::after {
    width: 4px;
    height: 8px;
    border-right: 2px solid #fff;
    border-bottom: 2px solid #fff;
    content: "";
    opacity: 0;
    transform: rotate(45deg) translate(-1px, -1px);
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-check:checked {
    border-color: var(--brand_standard, var(--brand-primary, #2f6bff));
    background: var(--brand_standard, var(--brand-primary, #2f6bff));
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-check:checked::after {
    opacity: 1;
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-check:disabled:not(:checked) {
    opacity: .4;
    cursor: default;
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-empty {
    padding: 64px 16px;
    color: var(--text-secondary, var(--text_secondary, var(--text-02, #6b7280)));
    text-align: center;
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-footer {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    min-height: 58px;
    gap: 12px;
    padding: 0 16px;
    border-top: 1px solid var(--border-level-1-color, var(--divider, rgba(127, 127, 127, .14)));
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-count {
    color: var(--text-secondary, var(--text_secondary, var(--text-02, #6b7280)));
    font-size: 12px;
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-actions {
    display: flex;
    gap: 8px;
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-cancel,
#${EDITOR_ID} .qqnt-toolbox-recall-filter-save {
    height: 32px;
    padding: 0 14px;
    border: 1px solid var(--border-level-1-color, var(--divider, rgba(127, 127, 127, .22)));
    border-radius: 6px;
    color: inherit;
    background: var(--background-02, rgba(127, 127, 127, .08));
    font: inherit;
    cursor: pointer;
}
#${EDITOR_ID} .qqnt-toolbox-recall-filter-save {
    border-color: var(--brand_standard, var(--brand-primary, #2f6bff));
    color: var(--on_brand_primary, #fff);
    background: var(--brand_standard, var(--brand-primary, #2f6bff));
}
@media (max-width: 560px) {
    #${EDITOR_ID} {
        padding: 12px;
    }
    #${EDITOR_ID} .qqnt-toolbox-recall-filter-toolbar {
        align-items: stretch;
        flex-direction: column;
    }
    #${EDITOR_ID} .qqnt-toolbox-recall-filter-tabs {
        align-self: flex-start;
    }
}`;
    document.head.append(style);
}

export function createRecallFilterEditor(options = {}) {
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
        const selectedContacts = (options.getSelected?.() || []).map(normalizeRecallFilterContact).filter(Boolean);
        const selectedKeys = new Set(selectedContacts.map(contact => contact.key));
        let contacts = mergeRecallFilterContacts([], selectedContacts);
        let filter = 'all';
        let query = '';
        let disposed = false;
        let loading = true;
        let loadFailed = false;

        const layer = createElement('div');
        layer.id = EDITOR_ID;
        layer.tabIndex = -1;
        layer.setAttribute('role', 'dialog');
        layer.setAttribute('aria-modal', 'true');
        layer.setAttribute('aria-label', '防撤回名单');
        const themeRoot = themeSource?.closest?.('#qqnt-toolbox-settings, #qqnt-toolbox-panel');
        let textColor = '';
        if (themeRoot instanceof Element) {
            textColor = getComputedStyle(themeRoot).color;
            if (textColor) {
                layer.style.setProperty('--qqnt-toolbox-recall-filter-text', textColor);
            }
            layer.style.setProperty('--qqnt-toolbox-recall-filter-surface', resolveOpaqueSurface(themeRoot, textColor));
            layer.style.colorScheme = parseCssColor(textColor)?.red > 160 ? 'dark' : 'light';
        }
        const page = createElement('div', 'qqnt-toolbox-recall-filter-page');
        const header = createElement('div', 'qqnt-toolbox-recall-filter-header');
        const title = createElement('div', 'qqnt-toolbox-recall-filter-title', '防撤回名单');
        header.append(title);

        const toolbar = createElement('div', 'qqnt-toolbox-recall-filter-toolbar');
        const search = createElement('input', 'qqnt-toolbox-recall-filter-search');
        search.type = 'search';
        search.placeholder = '搜索群或好友';
        search.setAttribute('aria-label', '搜索群或好友');
        const tabs = createElement('div', 'qqnt-toolbox-recall-filter-tabs');
        for (const [value, label] of [['all', '全部'], ['group', '群聊'], ['private', '好友']]) {
            const tab = createElement('button', 'qqnt-toolbox-recall-filter-tab', label);
            tab.type = 'button';
            tab.dataset.filter = value;
            tab.dataset.active = String(value === filter);
            tabs.append(tab);
        }
        toolbar.append(search, tabs);
        const mode = options.getMode?.();
        const modeText = createElement('div', 'qqnt-toolbox-recall-filter-mode', mode === 'blacklist'
            ? '所选群和好友不启用防撤回'
            : mode === 'whitelist'
                ? '仅所选群和好友启用防撤回'
                : '当前为全部生效，名单将在切换模式后使用');
        const list = createElement('div', 'qqnt-toolbox-recall-filter-list');
        const footer = createElement('div', 'qqnt-toolbox-recall-filter-footer');
        const count = createElement('div', 'qqnt-toolbox-recall-filter-count');
        const actions = createElement('div', 'qqnt-toolbox-recall-filter-actions');
        const cancel = createElement('button', 'qqnt-toolbox-recall-filter-cancel', '取消');
        cancel.type = 'button';
        const save = createElement('button', 'qqnt-toolbox-recall-filter-save', '保存');
        save.type = 'button';
        actions.append(cancel, save);
        footer.append(count, actions);
        page.append(header, toolbar, modeText, list, footer);
        layer.append(page);
        document.body.append(layer);

        const updateCount = () => {
            count.textContent = `已选择 ${selectedKeys.size}`;
            const limitReached = selectedKeys.size >= MAX_SELECTED;
            list.querySelectorAll('.qqnt-toolbox-recall-filter-check:not(:checked)').forEach(input => {
                input.disabled = limitReached;
            });
        };
        const render = () => {
            list.replaceChildren();
            if (loading && !contacts.length) {
                list.append(createElement('div', 'qqnt-toolbox-recall-filter-empty', '正在加载群和好友'));
                updateCount();
                return;
            }
            const words = query.toLocaleLowerCase();
            const visible = contacts.filter(contact =>
                (filter === 'all' ||
                    (filter === 'group' && contact.chatType === 2) ||
                    (filter === 'private' && contact.chatType === 1)) &&
                (!words || `${contact.label} ${contact.peerUin} ${contact.peerUid}`.toLocaleLowerCase().includes(words))
            );
            if (!visible.length) {
                list.append(createElement(
                    'div',
                    'qqnt-toolbox-recall-filter-empty',
                    loadFailed
                        ? '读取群和好友失败'
                        : '没有符合条件的群或好友'
                ));
                updateCount();
                return;
            }
            for (const contact of visible) {
                const row = createElement('label', 'qqnt-toolbox-recall-filter-row');
                const avatar = contact.avatarUrl
                    ? createElement('img', 'qqnt-toolbox-recall-filter-avatar')
                    : createElement('span', 'qqnt-toolbox-recall-filter-avatar qqnt-toolbox-recall-filter-avatar-fallback', contact.chatType === 2 ? '群' : '友');
                if (avatar instanceof HTMLImageElement) {
                    avatar.src = contact.avatarUrl;
                    avatar.alt = '';
                    avatar.addEventListener('error', () => avatar.classList.add('qqnt-toolbox-recall-filter-avatar-fallback'), { once: true });
                }
                const content = createElement('span', 'qqnt-toolbox-recall-filter-contact');
                content.append(
                    createElement('span', 'qqnt-toolbox-recall-filter-name', contact.label),
                    createElement('span', 'qqnt-toolbox-recall-filter-detail', `${contact.chatType === 2 ? '群聊' : '好友'}${contact.peerUin ? ` \u00b7 ${contact.peerUin}` : ''}`)
                );
                const checkbox = createElement('input', 'qqnt-toolbox-recall-filter-check');
                checkbox.type = 'checkbox';
                checkbox.checked = selectedKeys.has(contact.key);
                checkbox.dataset.peerKey = contact.key;
                row.dataset.selected = String(checkbox.checked);
                row.append(avatar, content, checkbox);
                list.append(row);
            }
            updateCount();
        };
        const load = async () => {
            loading = true;
            loadFailed = false;
            render();
            try {
                const loaded = await options.getContacts?.();
                if (!disposed) {
                    contacts = mergeRecallFilterContacts(loaded, selectedContacts);
                }
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
            const tab = event.target.closest?.('.qqnt-toolbox-recall-filter-tab[data-filter]');
            if (!tab) {
                return;
            }
            filter = tab.dataset.filter;
            tabs.querySelectorAll('.qqnt-toolbox-recall-filter-tab').forEach(item => {
                item.dataset.active = String(item === tab);
            });
            render();
        });
        list.addEventListener('change', event => {
            const checkbox = event.target.closest?.('.qqnt-toolbox-recall-filter-check[data-peer-key]');
            if (!checkbox) {
                return;
            }
            if (checkbox.checked) {
                selectedKeys.add(checkbox.dataset.peerKey);
            } else {
                selectedKeys.delete(checkbox.dataset.peerKey);
            }
            checkbox.closest('.qqnt-toolbox-recall-filter-row')?.setAttribute('data-selected', String(checkbox.checked));
            updateCount();
        });
        save.addEventListener('click', async () => {
            save.disabled = true;
            const peers = contacts
                .filter(contact => selectedKeys.has(contact.key))
                .map(({ key, chatType, peerUid, label }) => ({ key, chatType, peerUid, label }));
            await options.save?.(peers);
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
