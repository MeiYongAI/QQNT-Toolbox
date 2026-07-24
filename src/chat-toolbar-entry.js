const TOOLBAR_SELECTORS = [
    '.chat-func-bar .func-bar-native',
    '.chat-func-bar__left .func-bar-native',
    '[class*="chat-func-bar"] [class*="func-bar-native"]'
];
const NATIVE_TOOLTIP_DELAY = 500;

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

function findNativeEntryTemplate(toolbar) {
    const entries = Array.from(toolbar?.children || []).filter(element =>
        element.dataset.qqntToolboxToolbarEntry !== 'true' &&
        element.getAttribute('aria-hidden') !== 'true' &&
        element.style?.display !== 'none'
    );
    return entries.find(element => element.querySelector('svg')) || null;
}

function attachNativeTooltip(entry, labelTarget) {
    let timer = 0;
    let tooltip = null;
    const hide = () => {
        window.clearTimeout(timer);
        timer = 0;
        tooltip?.remove();
        tooltip = null;
    };
    const show = () => {
        hide();
        timer = window.setTimeout(() => {
            if (!entry.isConnected || !entry.matches(':hover')) {
                return;
            }
            tooltip = createElement(
                'div',
                'q-tooltips-v2 q-tooltips-v2--pos-bottom q-tooltips-v2--small q-float-card',
                labelTarget.getAttribute('aria-label') || ''
            );
            tooltip.style.zIndex = '2000';
            entry.append(tooltip);
            const entryRect = entry.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();
            const centeredLeft = (entryRect.width - tooltipRect.width) / 2;
            const minLeft = 4 - entryRect.left;
            const maxLeft = window.innerWidth - entryRect.left - tooltipRect.width - 4;
            tooltip.style.left = Math.min(maxLeft, Math.max(minLeft, centeredLeft)) + 'px';
            tooltip.style.top = (-tooltipRect.height - 4) + 'px';
        }, NATIVE_TOOLTIP_DELAY);
    };
    entry.addEventListener('pointerenter', show);
    entry.addEventListener('pointerleave', hide);
    entry.addEventListener('blur', hide, true);
}

export function findNativeChatToolbar() {
    for (const selector of TOOLBAR_SELECTORS) {
        const toolbar = document.querySelector(selector);
        if (toolbar) {
            return toolbar;
        }
    }
    return null;
}

export function createNativeChatToolbarEntry(toolbar, options = {}) {
    const template = findNativeEntryTemplate(toolbar);
    if (!template) {
        return null;
    }
    const entry = template.cloneNode(true);
    const legacyTooltip = entry.querySelector('.q-tooltips__content');
    const nativeTooltip = entry.querySelector(':scope > .q-tooltips-v2');
    const labelTarget = entry.querySelector('.icon-item[aria-label], [aria-label], [data-title]') || entry;
    const usesDataTitle = labelTarget.hasAttribute('data-title');
    const glyph = Array.from(entry.querySelectorAll('svg')).find(svg => !legacyTooltip?.contains(svg));
    if (!glyph) {
        return null;
    }
    legacyTooltip?.remove();
    nativeTooltip?.remove();
    for (const element of [entry, ...entry.querySelectorAll('*')]) {
        element.removeAttribute('id');
        element.removeAttribute('title');
        element.removeAttribute('aria-label');
        element.removeAttribute('aria-pressed');
        element.removeAttribute('aria-expanded');
        element.removeAttribute('aria-disabled');
        element.removeAttribute('disabled');
    }
    entry.classList.add(...String(options.className || '').split(/\s+/).filter(Boolean));
    entry.dataset.qqntToolboxToolbarEntry = 'true';
    entry.setAttribute('role', 'button');
    entry.tabIndex = 0;
    labelTarget.setAttribute('aria-label', String(options.label || ''));
    if (usesDataTitle) {
        labelTarget.setAttribute('data-title', String(options.label || ''));
    }
    options.renderIcon?.(glyph);
    attachNativeTooltip(entry, labelTarget);
    return entry;
}

export function bindNativeChatToolbarAction(entry, action) {
    entry.addEventListener('pointerdown', event => {
        if (event.pointerType !== 'touch') {
            event.preventDefault();
        }
    });
    const activate = event => {
        event.preventDefault();
        event.stopPropagation();
        if (entry.getAttribute('aria-disabled') !== 'true') {
            action?.(event);
        }
    };
    entry.addEventListener('click', activate);
    entry.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            activate(event);
        }
    });
    return entry;
}
