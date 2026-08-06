import {
    bindNativeChatToolbarAction,
    createNativeChatToolbarEntry,
    findNativeChatToolbar
} from './chat-toolbar-entry.js';
import { matchesControlLabelValue } from './control-label-match.js';

const PANEL_ID = 'qqnt-toolbox-local-sticker-panel';
const STYLE_ID = 'qqnt-toolbox-local-sticker-style';
const ENTRY_CLASS = 'qqnt-toolbox-local-sticker-entry';
const NATIVE_EMOJI_LABEL = '\u8868\u60c5';
const ENTRY_MODES = new Set(['contextmenu', 'replace', 'separate']);
const DIRECT_SEND_MODES = new Set(['alt', 'click']);
const LEFT_ENTRY_TARGET_SELECTORS = [
    '.chat-func-bar > .func-bar-native.func-bar-shortcuts:first-child',
    '.chat-func-bar > .chat-func-bar__left .func-bar-native',
    '.chat-func-bar > .chat-func-bar__left'
];
const RIGHT_ENTRY_TARGET_SELECTORS = [
    '.chat-func-bar > .func-bar-native.func-bar-shortcuts:last-child',
    '#func-bar-shortcuts-right',
    '.chat-func-bar > .chat-func-bar__right .func-bar-native',
    '.chat-func-bar > .chat-func-bar__right'
];
const DEFAULT_CONFIG = Object.freeze({
    enabled: false,
    path: '',
    entryMode: 'contextmenu',
    iconOnLeft: false,
    stickersPerRow: 6,
    panelWidth: 350,
    panelHeight: 420,
    sendAsImage: false,
    directSendMode: 'alt',
    recentEnabled: true,
    recentRows: 2
});

function createElement(tag, className = '', text = '') {
    const element = document.createElement(tag);
    if (className) {
        element.className = className;
    }
    if (text) {
        element.textContent = text;
    }
    return element;
}

function clampInteger(value, minimum, maximum, fallback) {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number)
        ? Math.min(maximum, Math.max(minimum, number))
        : fallback;
}

export function normalizeLocalStickerPanelConfig(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        enabled: source.enabled === true,
        path: String(source.path || '').trim(),
        entryMode: ENTRY_MODES.has(source.entryMode) ? source.entryMode : DEFAULT_CONFIG.entryMode,
        iconOnLeft: source.iconOnLeft === true,
        stickersPerRow: clampInteger(source.stickersPerRow, 3, 10, DEFAULT_CONFIG.stickersPerRow),
        panelWidth: clampInteger(source.panelWidth, 280, 520, DEFAULT_CONFIG.panelWidth),
        panelHeight: clampInteger(source.panelHeight, 260, 640, DEFAULT_CONFIG.panelHeight),
        sendAsImage: source.sendAsImage === true,
        directSendMode: DIRECT_SEND_MODES.has(source.directSendMode)
            ? source.directSendMode
            : DEFAULT_CONFIG.directSendMode,
        recentEnabled: source.recentEnabled !== false,
        recentRows: clampInteger(source.recentRows, 1, 6, DEFAULT_CONFIG.recentRows)
    };
}

function isDirectSendGesture(config, event) {
    return config.directSendMode === 'click' ? !event.altKey : event.altKey;
}

export function localStickerFileUrl(filePath) {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    const encoded = normalized.split('/').map(part =>
        encodeURIComponent(part).replace(/%3A/gi, ':')
    ).join('/');
    return 'local:///' + encoded;
}

function getControlLabelValues(element) {
    return [
        element?.getAttribute?.('aria-label'),
        element?.getAttribute?.('data-title'),
        element?.getAttribute?.('title'),
        element?.getAttribute?.('data-text')
    ].filter(Boolean);
}

function getDirectToolbarChild(toolbar, element) {
    let current = element;
    while (current && current.parentElement !== toolbar) {
        current = current.parentElement;
    }
    return current?.parentElement === toolbar ? current : null;
}

export function findNativeEmojiToolbarEntry(toolbar = findNativeChatToolbar()) {
    if (!toolbar) {
        return null;
    }
    const labeled = Array.from(toolbar.querySelectorAll(
        '[aria-label], [data-title], [title], [data-text]'
    ));
    for (const element of labeled) {
        if (element.closest?.(`.${ENTRY_CLASS}`)) {
            continue;
        }
        if (getControlLabelValues(element).some(value =>
            matchesControlLabelValue(value, NATIVE_EMOJI_LABEL))) {
            return getDirectToolbarChild(toolbar, element);
        }
    }
    for (const child of Array.from(toolbar.children)) {
        if (child.classList.contains(ENTRY_CLASS)) {
            continue;
        }
        const iconValues = Array.from(child.querySelectorAll('[data-icon], [icon]')).flatMap(element => [
            element.getAttribute('data-icon'),
            element.getAttribute('icon')
        ]).filter(Boolean);
        if (iconValues.some(value => /^(?:expression|expression_add|emoji)$/i.test(value))) {
            return child;
        }
        const tooltipText = Array.from(child.querySelectorAll(
            '.q-tooltips__content, .q-tooltips-v2, [class*="tooltip"]'
        )).map(element => element.textContent?.trim()).find(value =>
            matchesControlLabelValue(value, NATIVE_EMOJI_LABEL)
        );
        if (tooltipText) {
            return child;
        }
    }
    return null;
}

function applyLocalStickerEntryGlyph(svg) {
    const namespace = 'http://www.w3.org/2000/svg';
    svg.replaceChildren();
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const outline = document.createElementNS(namespace, 'path');
    outline.setAttribute('d', 'M5 3.75h8.8L19.5 9.5V19A1.5 1.5 0 0 1 18 20.5H5A1.5 1.5 0 0 1 3.5 19V5.25A1.5 1.5 0 0 1 5 3.75Z');
    outline.setAttribute('stroke', 'currentColor');
    outline.setAttribute('stroke-width', '1.6');
    outline.setAttribute('stroke-linejoin', 'round');
    const fold = document.createElementNS(namespace, 'path');
    fold.setAttribute('d', 'M13.5 4v4.2c0 .72.58 1.3 1.3 1.3H19');
    fold.setAttribute('stroke', 'currentColor');
    fold.setAttribute('stroke-width', '1.6');
    fold.setAttribute('stroke-linejoin', 'round');
    const face = document.createElementNS(namespace, 'path');
    face.setAttribute('d', 'M7.25 14.1c1.05 1.45 2.37 2.15 3.95 2.15s2.9-.7 3.95-2.15M8.25 10.9h.01M14.15 10.9h.01');
    face.setAttribute('stroke', 'currentColor');
    face.setAttribute('stroke-width', '1.6');
    face.setAttribute('stroke-linecap', 'round');
    svg.append(outline, fold, face);
}

function createSvgIcon(pathData, viewBox = '0 0 24 24') {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');
    for (const data of pathData) {
        const pathElement = document.createElementNS(namespace, 'path');
        pathElement.setAttribute('d', data);
        pathElement.setAttribute('stroke', 'currentColor');
        pathElement.setAttribute('stroke-width', '1.7');
        pathElement.setAttribute('stroke-linecap', 'round');
        pathElement.setAttribute('stroke-linejoin', 'round');
        svg.append(pathElement);
    }
    return svg;
}

function createIconButton(className, label, iconPaths) {
    const button = createElement('button', className);
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.append(createSvgIcon(iconPaths));
    return button;
}

export function findProseMirrorEditor() {
    const editorElement = document.querySelector('.qq-msg-editor');
    for (const instance of new Set(editorElement?.__VUE__ || [])) {
        try {
            const getter = instance?.proxy?.getEditor;
            const value = typeof getter === 'function' ? getter.call(instance.proxy) : getter;
            const editor = value?.editor || value?.value?.editor || value;
            if (editor?.view && editor?.schemaInstance) {
                return editor;
            }
        } catch {
        }
    }
    return null;
}

function findMessageComposer() {
    return Array.from(document.querySelectorAll([
        '.qq-msg-editor',
        '.ck.ck-content.ck-editor__editable'
    ].join(','))).find(element => element.getClientRects().length > 0) || null;
}

function countComposerMedia(composer) {
    if (!composer) {
        return 0;
    }
    const media = new Set();
    const wrapperSelector = [
        'msg-img',
        '[data-type="pic"]',
        '[data-type="image"]',
        '[data-type="marketFace"]',
        '[data-element-type="pic"]'
    ].join(',');
    for (const element of composer.querySelectorAll([
        'img',
        'msg-img',
        '[data-type="pic"]',
        '[data-type="image"]',
        '[data-type="marketFace"]',
        '[data-element-type="pic"]'
    ].join(','))) {
        const wrapper = element.closest?.(wrapperSelector);
        media.add(wrapper && composer.contains(wrapper) ? wrapper : element);
    }
    return media.size;
}

function isVisibleControl(element) {
    return element instanceof HTMLElement &&
        element.getClientRects().length > 0 &&
        !element.disabled &&
        element.getAttribute('aria-disabled') !== 'true';
}

function findNativeSendButton() {
    return Array.from(document.querySelectorAll('button, [role="button"], .q-button')).find(element => {
        if (!isVisibleControl(element)) {
            return false;
        }
        return [
            element.getAttribute('aria-label'),
            element.getAttribute('data-title'),
            element.getAttribute('title'),
            element.textContent
        ].some(value => matchesControlLabelValue(value, '\u53d1\u9001'));
    }) || null;
}

function findNativeEmojiPanel(target) {
    for (let candidate = target; candidate && candidate !== document.body; candidate = candidate.parentElement) {
        if (!(candidate instanceof HTMLElement) || candidate.id === PANEL_ID) {
            continue;
        }
        const className = String(candidate.className || '');
        const knownFloatingPanel = /(?:q-float-card|popover|popup|emoji.*panel|emoticon.*panel|face.*panel|sticker.*panel|expression.*panel|panel.*(?:emoji|emoticon|face|sticker|expression))/i.test(className);
        const positionedPanel = /panel/i.test(className) &&
            ['absolute', 'fixed'].includes(getComputedStyle(candidate).position);
        if ((!knownFloatingPanel && !positionedPanel) || candidate.closest('.qq-msg-editor')) {
            continue;
        }
        const rect = candidate.getBoundingClientRect();
        if (rect.width >= 220 && rect.height >= 160 &&
            candidate.querySelectorAll('img, svg').length >= 4) {
            return candidate;
        }
    }
    return null;
}

function isNativeDefaultEmojiPanel(panel) {
    const labeled = Array.from(panel?.querySelectorAll?.(
        '[aria-label], [data-title], [title], [data-text]'
    ) || []);
    let explicitlyInactive = false;
    for (const element of labeled) {
        const isDefault = [
            element.getAttribute('aria-label'),
            element.getAttribute('data-title'),
            element.getAttribute('title'),
            element.getAttribute('data-text')
        ].some(value => matchesControlLabelValue(value, '\u9ed8\u8ba4\u8868\u60c5'));
        if (!isDefault) {
            continue;
        }
        for (let control = element; control && control !== panel; control = control.parentElement) {
            if (control.getAttribute('aria-selected') === 'true' ||
                control.getAttribute('aria-pressed') === 'true' ||
                control.getAttribute('data-active') === 'true' ||
                /(?:^|[-_\s])(active|selected|current)(?:$|[-_\s])/i.test(String(control.className || ''))) {
                return true;
            }
            explicitlyInactive ||= control.getAttribute('aria-selected') === 'false' ||
                control.getAttribute('aria-pressed') === 'false' ||
                control.getAttribute('data-active') === 'false';
        }
    }
    if (explicitlyInactive) {
        return false;
    }
    const visibleText = String(panel?.innerText || '');
    return visibleText.includes('\u6700\u8fd1\u8868\u60c5') &&
        visibleText.includes('\u8d85\u7ea7\u8868\u60c5');
}

export function insertLocalStickerIntoComposer(filePath, picSubType) {
    const ckeditor = document.querySelector(
        '.ck.ck-content.ck-editor__editable'
    )?.ckeditorInstance;
    if (ckeditor?.model) {
        try {
            const model = ckeditor.model;
            model.change(writer => {
                const selection = model.document.selection;
                const position = selection.getFirstPosition();
                const image = writer.createElement('msg-img', {
                    data: JSON.stringify({
                        type: 'pic',
                        src: filePath,
                        picSubType,
                        summary: ''
                    })
                });
                writer.insert(image, position);
                writer.setSelection(writer.createPositionAt(image, 'after'));
            });
            return true;
        } catch {
            return false;
        }
    }

    const editor = findProseMirrorEditor();
    if (!editor) {
        return false;
    }
    try {
        const { view, schemaInstance: schema } = editor;
        const state = view.state;
        const image = schema.nodeFromJSON({
            type: 'msgPic',
            attrs: {
                item: {
                    type: 'pic',
                    src: filePath,
                    picSubType,
                    thumbUrl: ''
                }
            }
        });
        const transaction = state.tr.insert(state.selection.head, image);
        view.dispatch(transaction);
        view.focus();
        return true;
    } catch {
        return false;
    }
}

function packIdentity(pack) {
    return `${pack?.recent === true ? 'recent' : 'pack'}:${pack?.dirPath || ''}:${pack?.label || ''}`;
}

function consumeEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
}

export function createLocalStickerController(options = {}) {
    let root = null;
    let headerTitle = null;
    let content = null;
    let packBar = null;
    let separateEntry = null;
    let anchor = null;
    let store = null;
    let storeConfigKey = '';
    let activePackKey = '';
    let requestRevision = 0;
    let noticeTimer = 0;
    let lastNativePointerActivation = 0;
    let nativeStickerSendObserver = null;
    let nativeStickerSendTimer = 0;
    let nativeStickerSendRevision = 0;
    let installed = false;
    let configSignature = '';

    const getConfig = () => normalizeLocalStickerPanelConfig(
        options.getConfig?.()?.localStickers
    );
    const getBridge = () => options.getBridge?.() || window.qqnt_toolbox || null;

    function getStoreConfigKey(config = getConfig()) {
        return [
            config.path,
            config.stickersPerRow,
            config.recentEnabled,
            config.recentRows
        ].join('|');
    }

    function ensureStyle() {
        const existing = document.getElementById(STYLE_ID);
        if (existing) {
            return existing;
        }
        const link = document.createElement('link');
        link.id = STYLE_ID;
        link.rel = 'stylesheet';
        link.href = new URL('./local-sticker-panel.css', import.meta.url).href;
        document.head.append(link);
        return link;
    }

    function close() {
        if (!root) {
            return;
        }
        root.hidden = true;
        root.removeAttribute('data-loading');
        anchor = null;
        requestRevision += 1;
    }

    function setNotice(message, error = false) {
        if (!headerTitle) {
            return;
        }
        window.clearTimeout(noticeTimer);
        const previousNodes = Array.from(headerTitle.childNodes).map(node => node.cloneNode(true));
        headerTitle.textContent = message;
        headerTitle.dataset.notice = error ? 'error' : 'success';
        noticeTimer = window.setTimeout(() => {
            delete headerTitle.dataset.notice;
            if (headerTitle.textContent === message) {
                headerTitle.replaceChildren(...previousNodes);
            }
        }, 1600);
    }

    function createEmptyState(message, action = '') {
        const empty = createElement('div', 'qls-empty');
        empty.append(createElement('div', 'qls-empty-text', message));
        if (action) {
            const button = createElement(
                'button',
                'qls-empty-action',
                action === 'open-directory' ? '\u6253\u5f00\u8d34\u7eb8\u76ee\u5f55' : '\u9009\u62e9\u76ee\u5f55'
            );
            button.type = 'button';
            button.dataset.action = action;
            empty.append(button);
        }
        return empty;
    }

    function renderPack(pack) {
        activePackKey = packIdentity(pack);
        headerTitle.textContent = pack.label || '\u672c\u5730\u8d34\u7eb8';
        const count = createElement('span', 'qls-pack-count', String(pack.stickers?.length || 0));
        headerTitle.append(count);
        content.replaceChildren();
        const grid = createElement('div', 'qls-grid');
        grid.style.setProperty('--qls-columns', String(getConfig().stickersPerRow));
        for (const sticker of Array.isArray(pack.stickers) ? pack.stickers : []) {
            const button = createElement('button', 'qls-sticker');
            button.type = 'button';
            button.dataset.stickerPath = sticker.path;
            button.setAttribute('aria-label', sticker.label || '\u672c\u5730\u8d34\u7eb8');
            const image = document.createElement('img');
            image.alt = '';
            image.decoding = 'async';
            image.loading = 'lazy';
            image.draggable = false;
            image.src = localStickerFileUrl(sticker.path);
            image.addEventListener('load', () => button.dataset.loaded = 'true', { once: true });
            image.addEventListener('error', () => button.dataset.error = 'true', { once: true });
            button.append(image);
            grid.append(button);
        }
        content.append(grid);
        for (const button of packBar.querySelectorAll('.qls-pack')) {
            const selected = button.dataset.packKey === activePackKey;
            button.dataset.active = String(selected);
            button.setAttribute('aria-pressed', String(selected));
            if (selected) {
                button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
        }
    }

    function renderPackBar(packs) {
        const actions = packBar.querySelector('.qls-actions');
        packBar.querySelector('.qls-pack-list')?.remove();
        const list = createElement('div', 'qls-pack-list');
        for (const pack of packs) {
            const button = createElement('button', 'qls-pack');
            button.type = 'button';
            button.dataset.packKey = packIdentity(pack);
            button.setAttribute('aria-label', pack.label || '\u8d34\u7eb8\u5305');
            button.title = pack.label || '\u8d34\u7eb8\u5305';
            if (pack.icon) {
                const image = document.createElement('img');
                image.alt = '';
                image.loading = 'lazy';
                image.draggable = false;
                image.src = localStickerFileUrl(pack.icon);
                image.addEventListener('error', () => {
                    image.remove();
                    button.dataset.fallback = (pack.label || '?').slice(0, 1);
                }, { once: true });
                button.append(image);
            } else {
                button.dataset.fallback = (pack.label || '?').slice(0, 1);
            }
            list.append(button);
        }
        packBar.insertBefore(list, actions);
    }

    function renderStore(nextStore, preferredKey = activePackKey) {
        store = nextStore;
        root?.removeAttribute('data-loading');
        if (nextStore?.status !== 'success' || !nextStore.stickerPacks?.length) {
            headerTitle.textContent = '\u672c\u5730\u8d34\u7eb8';
            packBar.querySelector('.qls-pack-list')?.replaceChildren();
            content.replaceChildren(createEmptyState(
                String(nextStore?.msg || '\u672c\u5730\u8d34\u7eb8\u52a0\u8f7d\u5931\u8d25'),
                getConfig().path ? 'open-directory' : 'choose-directory'
            ));
            return;
        }
        const packs = nextStore.stickerPacks;
        renderPackBar(packs);
        const selected = packs.find(pack => packIdentity(pack) === preferredKey) || packs[0];
        renderPack(selected);
    }

    function renderLoading() {
        root.dataset.loading = 'true';
        headerTitle.textContent = '\u672c\u5730\u8d34\u7eb8';
        content.replaceChildren(createEmptyState('\u6b63\u5728\u52a0\u8f7d\u8d34\u7eb8'));
        packBar.querySelector('.qls-pack-list')?.replaceChildren();
    }

    async function loadStore(force = false, showLoading = true) {
        const revision = ++requestRevision;
        const nextStoreConfigKey = getStoreConfigKey();
        if (showLoading || !store || storeConfigKey !== nextStoreConfigKey) {
            renderLoading();
        }
        const bridge = getBridge();
        if (typeof bridge?.getLocalStickers !== 'function') {
            if (revision === requestRevision) {
                renderStore({ status: 'failed', msg: '\u672c\u5730\u8d34\u7eb8\u63a5\u53e3\u4e0d\u53ef\u7528' });
            }
            return null;
        }
        try {
            const result = await bridge.getLocalStickers({ force });
            if (revision === requestRevision) {
                storeConfigKey = nextStoreConfigKey;
                renderStore(result);
            }
            return result;
        } catch (error) {
            if (revision === requestRevision) {
                renderStore({ status: 'failed', msg: '\u672c\u5730\u8d34\u7eb8\u52a0\u8f7d\u5931\u8d25' });
            }
            options.onError?.(error);
            return null;
        }
    }

    async function chooseDirectory() {
        const bridge = getBridge();
        if (typeof bridge?.chooseLocalStickerDirectory !== 'function') {
            setNotice('\u76ee\u5f55\u9009\u62e9\u4e0d\u53ef\u7528', true);
            return;
        }
        const result = await bridge.chooseLocalStickerDirectory();
        if (!result?.ok || !result.path) {
            return;
        }
        await options.setConfigValue?.('localStickers.path', result.path);
    }

    async function rememberSticker(stickerPath) {
        const remember = getBridge()?.rememberLocalSticker;
        if (typeof remember !== 'function' || !getConfig().recentEnabled) {
            return;
        }
        try {
            const result = await remember(stickerPath);
            if (!root.hidden && result?.store?.status === 'success') {
                renderStore(result.store, activePackKey);
            }
        } catch {
        }
    }

    async function activateSticker(stickerPath, event) {
        const config = getConfig();
        const picSubType = config.sendAsImage ? 0 : 1;
        if (isDirectSendGesture(config, event)) {
            const peer = options.getPeer?.();
            const send = getBridge()?.sendLocalSticker;
            if (!peer || typeof send !== 'function') {
                setNotice('\u5f53\u524d\u4f1a\u8bdd\u65e0\u6cd5\u53d1\u9001', true);
                return;
            }
            root.dataset.busy = 'true';
            try {
                const result = await send({ path: stickerPath, peer });
                if (result?.ok !== true) {
                    setNotice('\u8d34\u7eb8\u53d1\u9001\u5931\u8d25', true);
                    return;
                }
            } catch (error) {
                options.onError?.(error);
                setNotice('\u8d34\u7eb8\u53d1\u9001\u5931\u8d25', true);
                return;
            } finally {
                root.removeAttribute('data-busy');
            }
        } else if (!insertLocalStickerIntoComposer(stickerPath, picSubType)) {
            setNotice('\u65e0\u6cd5\u63d2\u5165\u5f53\u524d\u8f93\u5165\u6846', true);
            return;
        }
        rememberSticker(stickerPath);
        if (!event.ctrlKey) {
            close();
        }
    }

    function cancelNativeStickerSend() {
        nativeStickerSendRevision += 1;
        nativeStickerSendObserver?.disconnect();
        nativeStickerSendObserver = null;
        window.clearTimeout(nativeStickerSendTimer);
        nativeStickerSendTimer = 0;
    }

    function watchNativeStickerInsertion(composer, directSendMode) {
        cancelNativeStickerSend();
        const revision = nativeStickerSendRevision;
        const mediaCount = countComposerMedia(composer);
        const observedRoot = composer.parentElement || composer;
        const finish = () => {
            if (revision !== nativeStickerSendRevision) {
                return;
            }
            const currentComposer = findMessageComposer();
            if (!currentComposer || countComposerMedia(currentComposer) <= mediaCount) {
                return;
            }
            cancelNativeStickerSend();
            const sendRevision = nativeStickerSendRevision;
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                    if (sendRevision === nativeStickerSendRevision &&
                        getConfig().directSendMode === directSendMode) {
                        findNativeSendButton()?.click();
                    }
                });
            });
        };
        nativeStickerSendObserver = new MutationObserver(finish);
        nativeStickerSendObserver.observe(observedRoot, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'data']
        });
        nativeStickerSendTimer = window.setTimeout(cancelNativeStickerSend, 1200);
        queueMicrotask(finish);
    }

    function handleNativeStickerDirectSend(event) {
        const config = getConfig();
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        if (!config.enabled || !isDirectSendGesture(config, event) || event.button !== 0 || !target ||
            event.ctrlKey || event.metaKey || event.shiftKey ||
            target.closest?.('[id^="qqnt-toolbox-"]')) {
            return;
        }
        const nativePanel = findNativeEmojiPanel(target);
        if (!nativePanel || isNativeDefaultEmojiPanel(nativePanel)) {
            return;
        }
        const composer = findMessageComposer();
        if (composer) {
            watchNativeStickerInsertion(composer, config.directSendMode);
        }
    }

    function handlePanelClick(event) {
        const sticker = event.target.closest?.('.qls-sticker[data-sticker-path]');
        if (sticker && root.contains(sticker)) {
            consumeEvent(event);
            activateSticker(sticker.dataset.stickerPath, event);
            return;
        }
        const packButton = event.target.closest?.('.qls-pack[data-pack-key]');
        if (packButton && root.contains(packButton)) {
            const pack = store?.stickerPacks?.find(item =>
                packIdentity(item) === packButton.dataset.packKey
            );
            if (pack) {
                renderPack(pack);
            }
            return;
        }
        const action = event.target.closest?.('[data-action]')?.dataset.action;
        if (action === 'choose-directory') {
            chooseDirectory();
        } else if (action === 'refresh') {
            loadStore(true);
        } else if (action === 'open-directory') {
            Promise.resolve(getBridge()?.openLocalStickerDirectory?.()).then(result => {
                if (result?.ok === false) {
                    setNotice('\u65e0\u6cd5\u6253\u5f00\u8d34\u7eb8\u76ee\u5f55', true);
                }
            }).catch(error => options.onError?.(error));
        }
    }

    function ensurePanel() {
        if (root?.isConnected) {
            return root;
        }
        ensureStyle();
        root = createElement('section', 'qls-panel');
        root.id = PANEL_ID;
        root.hidden = true;
        root.style.position = 'fixed';
        root.style.visibility = 'hidden';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-label', '\u672c\u5730\u8d34\u7eb8');

        const header = createElement('header', 'qls-header');
        headerTitle = createElement('div', 'qls-title', '\u672c\u5730\u8d34\u7eb8');
        header.append(headerTitle);
        content = createElement('div', 'qls-content qqnt-toolbox-scrollable');
        packBar = createElement('footer', 'qls-bar');
        packBar.append(createElement('div', 'qls-pack-list'));
        const actions = createElement('div', 'qls-actions');
        const refresh = createIconButton('qls-tool', '\u5237\u65b0\u8d34\u7eb8', [
            'M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5',
            'M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5'
        ]);
        refresh.dataset.action = 'refresh';
        const folder = createIconButton('qls-tool', '\u6253\u5f00\u8d34\u7eb8\u76ee\u5f55', [
            'M3.5 6.5A1.5 1.5 0 0 1 5 5h5l2 2h7A1.5 1.5 0 0 1 20.5 8.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5v-11Z'
        ]);
        folder.dataset.action = 'open-directory';
        actions.append(refresh, folder);
        packBar.append(actions);
        root.append(header, content, packBar);
        root.addEventListener('click', handlePanelClick);
        root.addEventListener('contextmenu', event => event.stopPropagation());
        document.body.append(root);
        return root;
    }

    function positionPanel(nextAnchor = anchor) {
        if (!root || root.hidden || !nextAnchor?.isConnected) {
            return;
        }
        anchor = nextAnchor;
        const config = getConfig();
        root.style.setProperty('--qls-width', `${config.panelWidth}px`);
        root.style.setProperty('--qls-height', `${config.panelHeight}px`);
        root.style.setProperty('--qls-columns', String(config.stickersPerRow));
        const anchorRect = nextAnchor.getBoundingClientRect();
        const panelRect = root.getBoundingClientRect();
        const margin = 8;
        const left = Math.min(
            window.innerWidth - panelRect.width - margin,
            Math.max(margin, anchorRect.left - 8)
        );
        const above = anchorRect.top - panelRect.height - margin;
        const top = above >= margin
            ? above
            : Math.min(window.innerHeight - panelRect.height - margin, anchorRect.bottom + margin);
        root.style.left = `${Math.max(margin, left)}px`;
        root.style.top = `${Math.max(margin, top)}px`;
    }

    function revealPanel(nextAnchor) {
        const style = ensureStyle();
        const reveal = () => {
            if (!root || root.hidden || anchor !== nextAnchor) {
                return;
            }
            positionPanel(nextAnchor);
            root.style.removeProperty('visibility');
            root.style.removeProperty('position');
        };
        if (style?.sheet) {
            reveal();
        } else {
            style?.addEventListener('load', () => window.requestAnimationFrame(reveal), { once: true });
        }
    }

    function open(nextAnchor, force = false) {
        if (!nextAnchor) {
            return;
        }
        ensurePanel();
        root.style.visibility = 'hidden';
        root.hidden = false;
        anchor = nextAnchor;
        revealPanel(nextAnchor);
        const canReuse = !force && store && storeConfigKey === getStoreConfigKey();
        if (canReuse) {
            renderStore(store, activePackKey);
            loadStore(false, false);
        } else {
            loadStore(force);
        }
    }

    function toggle(nextAnchor) {
        ensurePanel();
        if (!root.hidden && anchor === nextAnchor) {
            close();
        } else {
            open(nextAnchor);
        }
    }

    function removeSeparateEntries() {
        document.querySelectorAll(`.${ENTRY_CLASS}`).forEach(entry => entry.remove());
        separateEntry = null;
    }

    function findSeparateEntryTarget(nativeToolbar, iconOnLeft) {
        const selectors = iconOnLeft ? LEFT_ENTRY_TARGET_SELECTORS : RIGHT_ENTRY_TARGET_SELECTORS;
        for (const selector of selectors) {
            const target = document.querySelector(selector);
            if (target) {
                return target;
            }
        }
        return nativeToolbar;
    }

    function syncSeparateEntry(toolbar, config) {
        const target = findSeparateEntryTarget(toolbar, config.iconOnLeft);
        if (!config.enabled || config.entryMode !== 'separate' || !toolbar || !target) {
            removeSeparateEntries();
            return;
        }
        const entries = Array.from(document.querySelectorAll(`.${ENTRY_CLASS}`));
        separateEntry = entries.find(entry => entry.parentElement === target) || null;
        entries.filter(entry => entry !== separateEntry).forEach(entry => entry.remove());
        const entrySide = config.iconOnLeft ? 'left' : 'right';
        if (separateEntry?.dataset.entrySide === entrySide) {
            return;
        }
        separateEntry?.remove();
        separateEntry = createNativeChatToolbarEntry(toolbar, {
            className: ENTRY_CLASS,
            label: '\u672c\u5730\u8d34\u7eb8',
            renderIcon: applyLocalStickerEntryGlyph
        });
        if (!separateEntry) {
            return;
        }
        separateEntry.dataset.entrySide = entrySide;
        bindNativeChatToolbarAction(separateEntry, () => toggle(separateEntry));
        separateEntry.addEventListener('contextmenu', event => {
            consumeEvent(event);
            toggle(separateEntry);
        });
        const nativeEmoji = findNativeEmojiToolbarEntry(toolbar);
        if (config.iconOnLeft) {
            target.insertBefore(separateEntry, target.firstChild);
        } else if (nativeEmoji?.parentElement === target && nativeEmoji.nextSibling) {
            target.insertBefore(separateEntry, nativeEmoji.nextSibling);
        } else if (target !== toolbar) {
            target.insertBefore(separateEntry, target.firstChild);
        } else {
            target.append(separateEntry);
        }
    }

    function getNativeEntryFromEvent(event) {
        const toolbar = findNativeChatToolbar();
        const nativeEntry = findNativeEmojiToolbarEntry(toolbar);
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        return nativeEntry && target && nativeEntry.contains(target) ? nativeEntry : null;
    }

    function handleContextMenu(event) {
        const config = getConfig();
        if (!config.enabled || !['contextmenu', 'replace'].includes(config.entryMode)) {
            return;
        }
        const nativeEntry = getNativeEntryFromEvent(event);
        if (!nativeEntry) {
            return;
        }
        consumeEvent(event);
        toggle(nativeEntry);
    }

    function handlePointerDown(event) {
        const config = getConfig();
        const nativeEntry = config.enabled && config.entryMode === 'replace' && event.button === 0
            ? getNativeEntryFromEvent(event)
            : null;
        if (nativeEntry) {
            consumeEvent(event);
            lastNativePointerActivation = performance.now();
            toggle(nativeEntry);
            return;
        }
        if (!root?.hidden && !root.contains(event.target) && !anchor?.contains?.(event.target)) {
            close();
        }
    }

    function suppressReplacedNativeEntry(event) {
        const config = getConfig();
        if (!config.enabled || config.entryMode !== 'replace' || event.button !== 0) {
            return;
        }
        const nativeEntry = getNativeEntryFromEvent(event);
        if (!nativeEntry) {
            return;
        }
        consumeEvent(event);
        if (event.type === 'click' && performance.now() - lastNativePointerActivation > 500) {
            toggle(nativeEntry);
        }
    }

    function handleKeyDown(event) {
        if (event.key === 'Escape' && root && !root.hidden && root.isConnected &&
            root.getClientRects().length > 0) {
            consumeEvent(event);
            close();
            return;
        }
        const config = getConfig();
        if (!config.enabled || config.entryMode !== 'replace' || !['Enter', ' '].includes(event.key)) {
            return;
        }
        const nativeEntry = getNativeEntryFromEvent(event);
        if (nativeEntry) {
            consumeEvent(event);
            toggle(nativeEntry);
        }
    }

    function sync() {
        const config = getConfig();
        const signature = [
            config.enabled,
            config.path,
            config.entryMode,
            config.iconOnLeft,
            config.stickersPerRow,
            config.panelWidth,
            config.panelHeight,
            config.recentEnabled,
            config.recentRows
        ].join('|');
        const previousSignature = configSignature;
        configSignature = signature;
        const toolbar = findNativeChatToolbar();
        syncSeparateEntry(toolbar, config);
        if (!config.enabled) {
            cancelNativeStickerSend();
        }
        if (!config.enabled) {
            close();
            return;
        }
        if (!root?.hidden) {
            if (!anchor?.isConnected || previousSignature && previousSignature !== signature) {
                if (anchor?.isConnected) {
                    positionPanel(anchor);
                    loadStore(true);
                } else {
                    close();
                }
            } else {
                positionPanel(anchor);
            }
        }
    }

    function install() {
        if (installed) {
            return;
        }
        installed = true;
        ensureStyle();
        document.addEventListener('contextmenu', handleContextMenu, true);
        document.addEventListener('pointerdown', handlePointerDown, true);
        document.addEventListener('mousedown', suppressReplacedNativeEntry, true);
        document.addEventListener('mouseup', suppressReplacedNativeEntry, true);
        document.addEventListener('click', suppressReplacedNativeEntry, true);
        document.addEventListener('click', handleNativeStickerDirectSend, true);
        document.addEventListener('keydown', handleKeyDown, true);
        window.addEventListener('resize', () => positionPanel());
        sync();
    }

    async function refresh(force = true) {
        if (root && !root.hidden) {
            return await loadStore(force);
        }
        const bridge = getBridge();
        const result = typeof bridge?.getLocalStickers === 'function'
            ? await bridge.getLocalStickers({ force })
            : null;
        if (result) {
            store = result;
            storeConfigKey = getStoreConfigKey();
        }
        return result;
    }

    return {
        close,
        install,
        open,
        refresh,
        sync
    };
}
