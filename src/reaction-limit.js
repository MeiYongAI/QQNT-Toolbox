const REACTION_PANEL_SELECTOR = '.menu-stickers-panel';
const REACTION_ITEM_SELECTOR = '.menu-stickers-item, .reaction-express-item, .stickers-list-item';
const REACTION_GRID_SELECTOR = '.stickers-list';
const REACTION_MORE_SELECTOR = '.more-reaction-express-tag, .more-reaction-item';
const REACTION_TRIGGER_SELECTOR = `${REACTION_ITEM_SELECTOR}, ${REACTION_MORE_SELECTOR}`;
const TOOLBOX_ITEM_CLASS = 'qqnt-toolbox-reaction-item';
const REACTION_ITEM_SIZE_PX = 24;
const CONTEXT_TTL_MS = 60_000;
const PENDING_TTL_MS = 3_000;
const PANEL_WATCH_TIMEOUT_MS = 1_500;
const MAX_PENDING_STATES = 64;

function normalizeText(value) {
    const text = String(value ?? '').trim();
    return text && text !== 'undefined' && text !== 'null' && text !== '0' ? text : '';
}

function normalizeEmojiId(value) {
    const id = String(value ?? '').trim();
    return /^\d+$/.test(id) ? id : '';
}

export function extractReactionEmojiId(value) {
    if (typeof Element !== 'undefined' && value instanceof Element) {
        const injectedId = normalizeEmojiId(value.dataset?.qqntToolboxReactionId);
        if (injectedId) {
            return injectedId;
        }
        for (const image of value.matches?.('img') ? [value] : value.querySelectorAll?.('img') || []) {
            const id = extractReactionEmojiId(image.currentSrc || image.src || image.getAttribute?.('src'));
            if (id) {
                return id;
            }
        }
        return '';
    }
    const text = String(value ?? '').trim();
    const reactionMatch = /(?:qqface-reaction|default-emojis)[/\\](\d+)\.png(?:[?#]|$)/i.exec(text);
    if (reactionMatch) {
        return reactionMatch[1];
    }
    const systemMatch = /EmojiSystermResource[/\\](\d+)[/\\]png[/\\]\d+\.png(?:[?#]|$)/i.exec(text);
    return systemMatch?.[1] || (/^\d+$/.test(text) ? text : '');
}

export function extractUnicodeReactionEmojiId(value) {
    const text = String(value ?? '').trim().replace(/\uFE0F/g, '');
    const symbols = Array.from(text);
    if (symbols.length !== 1) {
        return '';
    }
    const codePoint = symbols[0].codePointAt(0);
    return Number.isInteger(codePoint) && codePoint > 0x7f ? String(codePoint) : '';
}

function toBoolean(value) {
    return value === true || value === 1 || value === '1' || value === 'true';
}

export function getRecordReactionState(record, emojiId) {
    const reaction = (Array.isArray(record?.emojiLikesList) ? record.emojiLikesList : [])
        .find(item => normalizeEmojiId(item?.emojiId) === normalizeEmojiId(emojiId));
    return reaction ? toBoolean(reaction.isClicked) : false;
}

function getTargetReactionGrid(panel) {
    const unicodeGrid = Array.from(panel.querySelectorAll(REACTION_GRID_SELECTOR))
        .map(grid => ({
            grid,
            unicodeCount: Array.from(grid.children)
                .filter(item => item.matches('.stickers-list-item') &&
                    item.querySelector(':scope > span')).length
        }))
        .sort((left, right) => right.unicodeCount - left.unicodeCount)[0];
    return unicodeGrid?.unicodeCount ? unicodeGrid.grid : null;
}

function isMoreReactionItem(item) {
    if (item.matches(REACTION_MORE_SELECTOR)) {
        return true;
    }
    const icon = item.querySelector('use');
    return String(icon?.getAttribute('href') || icon?.getAttribute('xlink:href') || '')
        .includes('expression_add_24');
}

function findReactionPanelStateOwner(surface) {
    const candidates = [];
    const elements = [];
    for (let element = surface, depth = 0; element && depth < 3;
        element = element.parentElement, depth += 1) {
        elements.push(element);
    }
    const item = surface?.querySelector?.(REACTION_ITEM_SELECTOR);
    if (item) {
        elements.push(item);
    }
    for (const element of elements) {
        if (Array.isArray(element?.__VUE__)) {
            candidates.push(...element.__VUE__);
        }
        if (element?.__vueParentComponent) {
            candidates.push(element.__vueParentComponent);
        }
    }
    const seen = new Set();
    for (const start of candidates) {
        for (let component = start, depth = 0; component && depth < 12;
            component = component.parent, depth += 1) {
            if (seen.has(component)) {
                continue;
            }
            seen.add(component);
            const state = component.setupState;
            if (state && Object.prototype.hasOwnProperty.call(state, 'showPanel') &&
                Object.prototype.hasOwnProperty.call(state, 'stickerPanelPos')) {
                return component;
            }
        }
    }
    return null;
}

export function keepNativeReactionPanelOpenForCurrentEvent(item, onRestored) {
    if (!(item instanceof Element)) {
        return false;
    }
    const owner = findReactionPanelStateOwner(item.closest(REACTION_PANEL_SELECTOR));
    if (!owner || typeof owner.proxy?.$watch !== 'function') {
        return false;
    }
    let preserving = true;
    const stopWatch = owner.proxy.$watch(
        () => owner.setupState.showPanel,
        value => {
            if (preserving && value === false) {
                owner.setupState.showPanel = true;
            }
        },
        { flush: 'sync' }
    );
    setTimeout(() => {
        preserving = false;
        stopWatch?.();
        if (!owner.isUnmounted && owner.setupState.showPanel) {
            Promise.resolve(onRestored?.(owner)).catch(() => {});
        }
    }, 0);
    return true;
}

export function applyReactionImageStyle(image) {
    const size = `${REACTION_ITEM_SIZE_PX}px`;
    Object.assign(image.style, {
        display: 'block',
        width: size,
        height: size,
        maxWidth: size,
        maxHeight: size,
        objectFit: 'contain'
    });
    image.width = REACTION_ITEM_SIZE_PX;
    image.height = REACTION_ITEM_SIZE_PX;
}

export function dismissReactionPanel() {
    if (typeof document === 'undefined' || !document.documentElement ||
        typeof MouseEvent === 'undefined') {
        return false;
    }
    document.documentElement.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: typeof window === 'undefined' ? undefined : window
    }));
    return true;
}

function createReactionItem(template, emoji) {
    const item = template.cloneNode(true);
    item.classList.add(TOOLBOX_ITEM_CLASS);
    item.classList.remove('reaction-item--clicked', 'reaction-item--hovered');
    item.dataset.qqntToolboxReactionId = emoji.id;
    item.removeAttribute('id');
    item.setAttribute('title', emoji.label);
    item.setAttribute('aria-label', emoji.label);
    item.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
    let image = item.matches('img') ? item : item.querySelector('img');
    if (!image) {
        image = document.createElement('img');
        item.replaceChildren(image);
    }
    image.src = emoji.src;
    image.alt = emoji.label;
    image.draggable = false;
    applyReactionImageStyle(image);
    return item;
}

export function createReactionLimitController(options) {
    let augmentEnabled = false;
    let keepPanelOpen = false;
    let panelObserver = null;
    let panelWatchTimer = 0;
    let context = null;
    let catalogPromise = null;
    const pendingPanels = new WeakSet();
    const pendingStates = new Map();

    function getCatalog() {
        catalogPromise ||= Promise.resolve(options.getCatalog?.()).then(value =>
            Array.isArray(value) ? value : []
        );
        return catalogPromise;
    }

    function rememberContext(record) {
        if (!augmentEnabled && !keepPanelOpen) {
            context = null;
            return;
        }
        const peer = options.getPeer?.(record);
        const msgSeq = normalizeText(record?.msgSeq);
        context = peer && msgSeq ? { peer, msgSeq, record, time: Date.now() } : null;
    }

    function getCurrentContext() {
        if (!context || Date.now() - context.time > CONTEXT_TTL_MS) {
            context = null;
        }
        return context;
    }

    function resolveContext(element) {
        const record = options.resolveRecord?.(element);
        if (record) {
            const peer = options.getPeer?.(record);
            const msgSeq = normalizeText(record.msgSeq);
            if (peer && msgSeq) {
                return { peer, msgSeq, record };
            }
        }
        return getCurrentContext();
    }

    function getNextState(targetContext, emojiId) {
        const key = `${targetContext.peer.chatType}:${targetContext.peer.peerUid}:${targetContext.msgSeq}:${emojiId}`;
        const now = Date.now();
        const pending = pendingStates.get(key);
        if (pending && pending.expiresAt <= now) {
            pendingStates.delete(key);
        }
        const current = pending && pending.expiresAt > now
            ? pending.value
            : getRecordReactionState(targetContext.record, emojiId);
        const value = !current;
        pendingStates.delete(key);
        pendingStates.set(key, { value, expiresAt: now + PENDING_TTL_MS });
        while (pendingStates.size > MAX_PENDING_STATES) {
            pendingStates.delete(pendingStates.keys().next().value);
        }
        return value;
    }

    async function augmentPanel(panel) {
        if (!augmentEnabled || !(panel instanceof Element) || pendingPanels.has(panel)) {
            return false;
        }
        const grid = getTargetReactionGrid(panel);
        const template = grid?.querySelector(REACTION_ITEM_SELECTOR);
        if (!grid || !template) {
            return false;
        }
        pendingPanels.add(panel);
        try {
            const catalog = await getCatalog();
            if (!augmentEnabled || !panel.isConnected) {
                return false;
            }
            const existing = new Set(Array.from(panel.querySelectorAll(REACTION_ITEM_SELECTOR))
                .map(item => extractReactionEmojiId(item) ||
                    extractUnicodeReactionEmojiId(item.textContent))
                .filter(Boolean));
            const fragment = document.createDocumentFragment();
            for (const emoji of catalog) {
                const id = normalizeEmojiId(emoji?.id);
                if (!id || existing.has(id) || !normalizeText(emoji?.src)) {
                    continue;
                }
                fragment.append(createReactionItem(template, {
                    id,
                    label: normalizeText(emoji.label) || `表情 ${id}`,
                    src: emoji.src
                }));
                existing.add(id);
            }
            if (!fragment.childElementCount) {
                return false;
            }
            grid.append(fragment);
            return true;
        } finally {
            pendingPanels.delete(panel);
        }
    }

    function stopPanelWatch() {
        panelObserver?.disconnect();
        panelObserver = null;
        if (panelWatchTimer) {
            clearTimeout(panelWatchTimer);
            panelWatchTimer = 0;
        }
    }

    function tryAugmentPanel(panel) {
        Promise.resolve(augmentPanel(panel)).then(augmented => {
            if (augmented) {
                stopPanelWatch();
            }
        }).catch(options.onError || (() => {}));
    }

    function findReactionPanel(node) {
        if (!(node instanceof Element)) {
            return null;
        }
        return node.matches(REACTION_PANEL_SELECTOR)
            ? node
            : node.closest(REACTION_PANEL_SELECTOR) || node.querySelector(REACTION_PANEL_SELECTOR);
    }

    function handlePanelMutations(mutations) {
        for (const mutation of mutations) {
            const targetPanel = findReactionPanel(mutation.target);
            if (targetPanel) {
                tryAugmentPanel(targetPanel);
                return;
            }
            for (const node of mutation.addedNodes) {
                const panel = findReactionPanel(node);
                if (panel) {
                    tryAugmentPanel(panel);
                    return;
                }
            }
        }
    }

    function watchForReactionPanel() {
        if (!augmentEnabled || !document.body) {
            return;
        }
        stopPanelWatch();
        panelObserver = new MutationObserver(handlePanelMutations);
        panelObserver.observe(document.body, { childList: true, subtree: true });
        panelWatchTimer = setTimeout(stopPanelWatch, PANEL_WATCH_TIMEOUT_MS);
        document.querySelectorAll(REACTION_PANEL_SELECTOR).forEach(tryAugmentPanel);
    }

    function handleClick(event) {
        if (!augmentEnabled && !keepPanelOpen) {
            return;
        }
        const target = event.target instanceof Element ? event.target : null;
        const item = target?.closest(REACTION_TRIGGER_SELECTOR);
        if (!item) {
            return;
        }
        if (isMoreReactionItem(item)) {
            const record = options.resolveRecord?.(item);
            if (record) {
                rememberContext(record);
            }
            watchForReactionPanel();
            return;
        }
        const emojiId = extractReactionEmojiId(item) ||
            extractUnicodeReactionEmojiId(item.textContent);
        if (!item.classList.contains(TOOLBOX_ITEM_CLASS)) {
            if (keepPanelOpen) {
                keepNativeReactionPanelOpenForCurrentEvent(item, () => {
                    if (augmentEnabled) {
                        watchForReactionPanel();
                    }
                });
            }
            return;
        }
        const targetContext = resolveContext(item);
        if (!emojiId || !targetContext) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        const sending = Promise.resolve(options.sendReaction?.({
            peer: targetContext.peer,
            msgSeq: targetContext.msgSeq,
            emojiId,
            setEmoji: getNextState(targetContext, emojiId)
        }));
        sending.catch(options.onError || (() => {}));
        if (!keepPanelOpen) {
            dismissReactionPanel();
        }
    }

    function sync(nextState) {
        const nextAugmentEnabled = typeof nextState === 'object'
            ? nextState?.removeLimit === true
            : nextState === true;
        const nextKeepPanelOpen = typeof nextState === 'object' && nextState?.keepOpen === true;
        if (nextAugmentEnabled === augmentEnabled && nextKeepPanelOpen === keepPanelOpen) {
            return;
        }
        const wasAugmentEnabled = augmentEnabled;
        const wasActive = augmentEnabled || keepPanelOpen;
        augmentEnabled = nextAugmentEnabled;
        keepPanelOpen = nextKeepPanelOpen;
        const active = augmentEnabled || keepPanelOpen;

        if (active && !wasActive) {
            document.addEventListener('click', handleClick, true);
        } else if (!active && wasActive) {
            document.removeEventListener('click', handleClick, true);
        }

        if (augmentEnabled && !wasAugmentEnabled) {
            getCatalog().catch(options.onError || (() => {}));
            if (document.querySelector(REACTION_PANEL_SELECTOR)) {
                watchForReactionPanel();
            }
        } else if (!augmentEnabled && wasAugmentEnabled) {
            stopPanelWatch();
            catalogPromise = null;
            document.querySelectorAll(`.${TOOLBOX_ITEM_CLASS}`).forEach(item => item.remove());
        }

        if (!active) {
            context = null;
            pendingStates.clear();
        }
    }

    function dispose() {
        sync({ removeLimit: false, keepOpen: false });
        stopPanelWatch();
        catalogPromise = null;
    }

    return { dispose, rememberContext, sync };
}
