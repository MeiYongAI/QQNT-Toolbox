'use strict';

(() => {
    const ROOT_ID = 'qqnt-toolbox-qr-result-layer';
    const STYLE_ID = 'qqnt-toolbox-qr-result-style';

    function normalizeText(value) {
        return String(value ?? '').trim();
    }

    function getOpenableUrl(value) {
        try {
            const url = new URL(normalizeText(value));
            return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
        } catch {
            return '';
        }
    }

    function normalizeInfos(value) {
        return (Array.isArray(value) ? value : []).map(item => {
            const text = normalizeText(item?.text ?? item);
            const url = getOpenableUrl(item?.url || text);
            return text ? { text, url } : null;
        }).filter(Boolean).slice(0, 16);
    }

    function getRgbLuminance(value) {
        const match = String(value || '').match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)(?:\D+([\d.]+))?/i);
        if (!match || (match[4] !== undefined && Number(match[4]) < 0.1)) {
            return null;
        }
        const channels = match.slice(1, 4).map(channel => Number(channel) / 255).map(channel =>
            channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
        );
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    }

    function hasDarkSurface() {
        for (const element of [
            document.querySelector('.aio'),
            document.getElementById('app'),
            document.body,
            document.documentElement
        ]) {
            if (!element) {
                continue;
            }
            const luminance = getRgbLuminance(getComputedStyle(element).backgroundColor);
            if (luminance !== null) {
                return luminance < 0.22;
            }
        }
        return matchMedia('(prefers-color-scheme: dark)').matches;
    }

    function createIcon(paths) {
        const namespace = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(namespace, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        for (const attributes of paths) {
            const path = document.createElementNS(namespace, 'path');
            for (const [name, value] of Object.entries(attributes)) {
                path.setAttribute(name, value);
            }
            svg.append(path);
        }
        return svg;
    }

    function ensureStyles() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
#${ROOT_ID} {
    --qr-surface: var(--bg_top_light, var(--background-05, var(--background-01, #ffffff)));
    --qr-surface-secondary: var(--fill_light_primary, var(--background-02, #f5f6f7));
    --qr-text: var(--text-primary, var(--text_primary, var(--text-01, #1f2329)));
    --qr-text-secondary: var(--text-secondary, var(--text_secondary, var(--text-02, #73777f)));
    --qr-border: var(--border-level-1-color, var(--divider, rgba(0, 0, 0, .10)));
    --qr-hover: var(--overlay_hover, var(--background-hover, rgba(0, 0, 0, .06)));
    --qr-button: var(--fill_standard_secondary, var(--fill_light_primary, rgba(0, 0, 0, .07)));
    --qr-accent: var(--brand_standard, var(--theme-color, var(--brand-primary, #0099ff)));
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    display: grid;
    place-items: center;
    padding: 24px;
    color: var(--qr-text);
    background: var(--overlay_mask_dark, rgba(0, 0, 0, .42));
    font-family: var(--font-family, "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif);
    font-size: 14px;
    line-height: 1.5;
    user-select: none;
    -webkit-app-region: no-drag;
}
#${ROOT_ID}.is-dark {
    --qr-surface: var(--bg_top_light, var(--background-05, var(--background-01, #252526)));
    --qr-surface-secondary: var(--fill_light_primary, var(--background-02, #2d2d2f));
    --qr-text: var(--text-primary, var(--text_primary, var(--text-01, #f2f2f2)));
    --qr-text-secondary: var(--text-secondary, var(--text_secondary, var(--text-02, #a7a7ad)));
    --qr-border: var(--border-level-1-color, var(--divider, rgba(255, 255, 255, .10)));
    --qr-hover: var(--overlay_hover, var(--background-hover, rgba(255, 255, 255, .08)));
    --qr-button: var(--fill_standard_secondary, var(--fill_light_primary, rgba(255, 255, 255, .09)));
}
#${ROOT_ID}, #${ROOT_ID} * { box-sizing: border-box; }
#${ROOT_ID} .qr-result-dialog {
    width: min(480px, 100%);
    max-height: min(580px, calc(100vh - 48px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--qr-border);
    border-radius: 8px;
    color: var(--qr-text);
    background: var(--qr-surface);
    box-shadow: var(--shadow-bg-middle-primary, 0 16px 48px rgba(0, 0, 0, .24));
    transform: translateY(6px) scale(.985);
    opacity: 0;
    transition: transform 130ms ease-out, opacity 130ms ease-out;
}
#${ROOT_ID}.is-visible .qr-result-dialog { transform: none; opacity: 1; }
#${ROOT_ID} .qr-result-header {
    height: 48px;
    flex: 0 0 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px 0 16px;
    border-bottom: 1px solid var(--qr-border);
}
#${ROOT_ID} .qr-result-title { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: 0; }
#${ROOT_ID} button { font: inherit; letter-spacing: 0; }
#${ROOT_ID} .qr-result-close {
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 6px;
    color: var(--qr-text-secondary);
    background: transparent;
    cursor: pointer;
}
#${ROOT_ID} .qr-result-close:hover { color: var(--qr-text); background: var(--qr-hover); }
#${ROOT_ID} .qr-result-close svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
#${ROOT_ID} .qr-result-body { min-height: 0; padding: 18px 20px 20px; overflow: auto; }
#${ROOT_ID} .qr-result-summary { margin: 0 0 14px; font-size: 15px; font-weight: 600; letter-spacing: 0; }
#${ROOT_ID} .qr-result-list {
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--qr-border);
    border-radius: 6px;
    background: var(--qr-surface-secondary);
    list-style: none;
}
#${ROOT_ID} .qr-result-item {
    width: 100%;
    min-height: 50px;
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) 20px;
    gap: 8px;
    align-items: center;
    margin: 0;
    padding: 10px 12px;
    border: 0;
    border-top: 1px solid var(--qr-border);
    color: var(--qr-text);
    background: transparent;
    text-align: left;
}
#${ROOT_ID} .qr-result-list li:first-child .qr-result-item { border-top: 0; }
#${ROOT_ID} button.qr-result-item { cursor: pointer; }
#${ROOT_ID} button.qr-result-item:hover,
#${ROOT_ID} button.qr-result-item:focus-visible { background: var(--qr-hover); outline: none; }
#${ROOT_ID} .qr-result-index { color: var(--qr-text-secondary); font-variant-numeric: tabular-nums; text-align: center; }
#${ROOT_ID} .qr-result-value { min-width: 0; overflow-wrap: anywhere; user-select: text; }
#${ROOT_ID} .qr-result-open-icon { width: 16px; height: 16px; color: var(--qr-text-secondary); fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
#${ROOT_ID} .qr-result-empty { margin: 4px 0 2px; color: var(--qr-text-secondary); }
#${ROOT_ID} .qr-result-footer {
    min-height: 54px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid var(--qr-border);
}
#${ROOT_ID} .qr-result-action {
    min-width: 76px;
    height: 32px;
    margin: 0;
    padding: 0 16px;
    border: 0;
    border-radius: 6px;
    color: var(--qr-text);
    background: var(--qr-button);
    cursor: pointer;
}
#${ROOT_ID} .qr-result-action:hover { filter: brightness(1.05); }
#${ROOT_ID} .qr-result-action:active { transform: translateY(1px); }
#${ROOT_ID} .qr-result-action.is-primary { color: #fff; background: var(--qr-accent); }
#${ROOT_ID} button:focus-visible { outline: 2px solid color-mix(in srgb, var(--qr-accent) 72%, transparent); outline-offset: 1px; }
#${ROOT_ID} button[aria-busy="true"] { pointer-events: none; opacity: .62; }
@media (prefers-reduced-motion: reduce) {
    #${ROOT_ID} .qr-result-dialog { transition: none; }
}
`;
        document.head.append(style);
    }

    function closeQrResultDialog() {
        const root = document.getElementById(ROOT_ID);
        if (!root) {
            return false;
        }
        root.remove();
        return true;
    }

    function showQrResultDialog(options = {}) {
        closeQrResultDialog();
        ensureStyles();
        const infos = normalizeInfos(options.infos);
        const root = document.createElement('div');
        root.id = ROOT_ID;
        root.classList.toggle('is-dark', options.dark === true || (options.dark !== false && hasDarkSurface()));

        const dialog = document.createElement('section');
        dialog.className = 'qr-result-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', `${ROOT_ID}-title`);

        const header = document.createElement('header');
        header.className = 'qr-result-header';
        const title = document.createElement('h2');
        title.id = `${ROOT_ID}-title`;
        title.className = 'qr-result-title';
        title.textContent = normalizeText(options.title) || '二维码识别';
        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'qr-result-close';
        closeButton.setAttribute('aria-label', '关闭');
        closeButton.append(createIcon([{ d: 'M18 6 6 18M6 6l12 12' }]));
        header.append(title, closeButton);

        const body = document.createElement('div');
        body.className = 'qr-result-body';
        const summary = document.createElement('p');
        summary.className = 'qr-result-summary';
        summary.textContent = infos.length
            ? (infos.length === 1 ? '识别结果' : `识别到 ${infos.length} 个二维码`)
            : normalizeText(options.message) || '未识别到二维码';
        body.append(summary);

        const focusable = [];
        if (infos.length) {
            const list = document.createElement('ol');
            list.className = 'qr-result-list';
            infos.forEach((info, index) => {
                const listItem = document.createElement('li');
                const item = document.createElement(info.url ? 'button' : 'div');
                item.className = 'qr-result-item';
                if (info.url) {
                    item.type = 'button';
                    item.setAttribute('aria-label', `打开第 ${index + 1} 个二维码`);
                    focusable.push(item);
                    item.addEventListener('click', async () => {
                        item.setAttribute('aria-busy', 'true');
                        try {
                            const result = await options.onOpen?.(info, index);
                            if (result !== false && result?.ok !== false) {
                                closeQrResultDialog();
                            }
                        } finally {
                            item.removeAttribute('aria-busy');
                        }
                    });
                }
                const number = document.createElement('span');
                number.className = 'qr-result-index';
                number.textContent = String(index + 1);
                const value = document.createElement('span');
                value.className = 'qr-result-value';
                value.textContent = info.text;
                const icon = info.url
                    ? createIcon([
                        { d: 'M14 5h5v5' },
                        { d: 'm10 14 9-9' },
                        { d: 'M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5' }
                    ])
                    : document.createElement('span');
                icon.classList.add('qr-result-open-icon');
                item.append(number, value, icon);
                listItem.append(item);
                list.append(listItem);
            });
            body.append(list);
        } else {
            const empty = document.createElement('p');
            empty.className = 'qr-result-empty';
            empty.textContent = normalizeText(options.detail);
            if (empty.textContent) {
                body.append(empty);
            }
        }

        const footer = document.createElement('footer');
        footer.className = 'qr-result-footer';
        if (infos.length) {
            const copyButton = document.createElement('button');
            copyButton.type = 'button';
            copyButton.className = 'qr-result-action';
            copyButton.textContent = infos.length === 1 ? '复制' : '复制全部';
            focusable.push(copyButton);
            copyButton.addEventListener('click', async () => {
                const content = infos.map((info, index) =>
                    infos.length === 1 ? info.text : `${index + 1}. ${info.text}`
                ).join('\n\n');
                copyButton.setAttribute('aria-busy', 'true');
                try {
                    const result = await options.onCopy?.(content);
                    if (result !== false && result?.ok !== false) {
                        closeQrResultDialog();
                    }
                } finally {
                    copyButton.removeAttribute('aria-busy');
                }
            });
            footer.append(copyButton);
        }
        const confirmButton = document.createElement('button');
        confirmButton.type = 'button';
        confirmButton.className = 'qr-result-action is-primary';
        confirmButton.textContent = infos.length ? '关闭' : '确定';
        focusable.push(confirmButton);
        footer.append(confirmButton);

        dialog.append(header, body, footer);
        root.append(dialog);
        document.body.append(root);

        const close = () => closeQrResultDialog();
        closeButton.addEventListener('click', close);
        confirmButton.addEventListener('click', close);
        root.addEventListener('pointerdown', event => {
            event.stopPropagation();
            if (event.target === root) {
                close();
            }
        });
        root.addEventListener('click', event => event.stopPropagation());
        root.addEventListener('contextmenu', event => event.stopPropagation());
        root.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                close();
                return;
            }
            if (event.key !== 'Tab' || !focusable.length) {
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });
        requestAnimationFrame(() => root.classList.add('is-visible'));
        (focusable[0] || closeButton).focus({ preventScroll: true });
        return { close };
    }

    globalThis.qqntToolboxQrDialog = Object.freeze({
        close: closeQrResultDialog,
        show: showQrResultDialog
    });
})();
