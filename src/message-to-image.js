const STYLE_ID = 'qqnt-toolbox-message-to-image-style';
const ROOT_ID = 'qqnt-toolbox-message-to-image-render-root';
const TOAST_ID = 'qqnt-toolbox-message-image-toast';
const TOOLBAR_BUTTON_CLASS = 'qqnt-toolbox-message-to-image-toolbar-button';
const INCLUDE_REACTIONS_CLASS = 'qqnt-toolbox-message-image-include-reactions';
const MAX_RENDER_MESSAGES = 50;
const NATIVE_TOOLBAR_LABELS = new Set(['逐条转发', '合并转发', '保存至电脑', '收藏', '删除', '复制']);
const HTML2CANVAS_COLOR_PROPERTIES = [
    'background-color',
    'border-top-color',
    'border-right-color',
    'border-bottom-color',
    'border-left-color',
    'color',
    'text-decoration-color',
    '-webkit-text-stroke-color'
];

function compactText(value) {
    return String(value?.textContent ?? value ?? '').replace(/\s+/g, ' ').trim();
}

export function getMessageImageToastPresentation(result = {}) {
    const fileName = String(result.filePath || '').split(/[\\/]/).pop() || '消息图片';
    if (result.copyError) {
        return { message: `已保存，但复制失败：${fileName}`, error: true };
    }
    return {
        message: result.copied ? `已保存并复制：${fileName}` : `已保存：${fileName}`,
        error: false
    };
}

function isRenderableElement(value) {
    return Boolean(value && value.nodeType === 1 &&
        typeof value.getBoundingClientRect === 'function' && value.isConnected !== false);
}

export function sortMessageImageElements(elements) {
    return Array.from(new Set(Array.isArray(elements) ? elements : []))
        .filter(isRenderableElement)
        .sort((left, right) => {
            const leftRect = left.getBoundingClientRect();
            const rightRect = right.getBoundingClientRect();
            return leftRect.top - rightRect.top || leftRect.left - rightRect.left;
        });
}

export function getMessageImageContentElement(message) {
    if (!message) {
        return null;
    }
    if (message.matches?.('.message-container')) {
        return message;
    }
    return message.querySelector?.('.message-container') || message;
}

function colorHasFill(value) {
    const color = String(value || '').trim().toLowerCase();
    return Boolean(color && color !== 'transparent' &&
        !/^rgba?\([^)]*[,/]\s*0(?:\.0+)?\s*\)$/.test(color));
}

export function isNativeSelectionMarkerChecked(marker, windowRef = window) {
    if (!marker) {
        return false;
    }
    const input = marker.matches?.('input') ? marker : marker.querySelector?.('input');
    if (input?.checked) {
        return true;
    }
    for (const element of [marker, ...Array.from(marker.querySelectorAll?.('*') || []).slice(0, 12)]) {
        const state = [
            element.getAttribute?.('aria-checked'),
            element.getAttribute?.('data-checked'),
            element.getAttribute?.('data-state')
        ].filter(Boolean).join(' ').toLowerCase();
        const className = String(element.className?.baseVal ?? element.className ?? '').toLowerCase();
        if (state === 'true' || /(^|[\s_-])(checked|selected)([\s_-]|$)/.test(`${state} ${className}`)) {
            return true;
        }
    }
    const style = windowRef.getComputedStyle?.(marker);
    return colorHasFill(style?.backgroundColor) &&
        Boolean(marker.querySelector?.('svg, [class*="check" i], [class*="tick" i]'));
}

function findNativeSelectionMarker(row, messageElement, windowRef) {
    const explicit = row.querySelectorAll([
        'input[type="checkbox"]',
        '[role="checkbox"]',
        '[aria-checked]',
        '[data-checked]',
        '[class*="checkbox" i]',
        '[class*="check-box" i]'
    ].join(','));
    if (explicit.length) {
        return Array.from(explicit).find(marker => isNativeSelectionMarkerChecked(marker, windowRef)) || explicit[0];
    }

    const rowRect = row.getBoundingClientRect();
    const messageRect = messageElement.getBoundingClientRect();
    const candidates = row.querySelectorAll('button, span, div, svg');
    for (const candidate of candidates) {
        const rect = candidate.getBoundingClientRect();
        if (rect.width < 14 || rect.width > 34 || rect.height < 14 || rect.height > 34 ||
            rect.left > Math.min(messageRect.left - 2, rowRect.left + 64)) {
            continue;
        }
        const style = windowRef.getComputedStyle(candidate);
        const radius = Number.parseFloat(style.borderRadius) || 0;
        if (radius >= Math.min(rect.width, rect.height) * 0.35) {
            return candidate;
        }
    }
    return null;
}

function normalizeToolbarLabel(value) {
    return String(value || '').replace(/\s+/g, '').trim();
}

function isVisibleToolbarLabel(element, windowRef) {
    const rect = element?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
        return false;
    }
    const style = windowRef.getComputedStyle?.(element);
    return style?.display !== 'none' && style?.visibility !== 'hidden';
}

function collectToolbarLabelEntries(documentRef, windowRef, visibleOnly = true) {
    const entries = [];
    const walker = documentRef.createTreeWalker(documentRef.body, 4);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const label = normalizeToolbarLabel(node.nodeValue);
        const element = node.parentElement;
        if (NATIVE_TOOLBAR_LABELS.has(label) &&
            !element?.closest?.(`.${TOOLBAR_BUTTON_CLASS}`) &&
            (!visibleOnly || isVisibleToolbarLabel(element, windowRef))) {
            entries.push({ label, element });
        }
    }
    return entries;
}

function findCommonAncestor(left, right, body) {
    for (let node = left; node && node !== body; node = node.parentElement) {
        if (node.contains?.(right)) {
            return node;
        }
    }
    return null;
}

function getToolbarRectScore(toolbar, windowRef) {
    const rect = toolbar?.getBoundingClientRect?.();
    if (!rect || rect.width < 280 || rect.height < 64 || rect.height > 280 ||
        rect.bottom < windowRef.innerHeight * 0.55) {
        return null;
    }
    return {
        area: rect.width * rect.height,
        bottom: rect.bottom
    };
}

export function findNativeMultiSelectToolbar(documentRef = document, windowRef = window) {
    const entries = collectToolbarLabelEntries(documentRef, windowRef);
    const forwardEntries = entries.filter(entry => entry.label === '逐条转发');
    const mergeEntries = entries.filter(entry => entry.label === '合并转发');
    if (!forwardEntries.length || !mergeEntries.length) {
        return null;
    }

    const candidates = [];
    const seen = new Set();
    for (const forward of forwardEntries) {
        for (const merge of mergeEntries) {
            let toolbar = findCommonAncestor(forward.element, merge.element, documentRef.body);
            while (toolbar && toolbar !== documentRef.body) {
                const score = getToolbarRectScore(toolbar, windowRef);
                const contained = entries.filter(entry => toolbar.contains?.(entry.element));
                const labels = new Map(contained.map(entry => [entry.label, entry.element]));
                if (score && labels.size >= 4 && !seen.has(toolbar)) {
                    seen.add(toolbar);
                    candidates.push({ toolbar, labels, ...score });
                    break;
                }
                toolbar = toolbar.parentElement;
            }
        }
    }
    candidates.sort((left, right) => right.bottom - left.bottom || left.area - right.area);
    return candidates[0] || null;
}

export function findNativeMultiSelectToolbarHosts(documentRef = document, windowRef = window) {
    const entries = collectToolbarLabelEntries(documentRef, windowRef, false);
    const forwardEntries = entries.filter(entry => entry.label === '逐条转发');
    const mergeEntries = entries.filter(entry => entry.label === '合并转发');
    const candidates = [];
    const seen = new Set();
    for (const forward of forwardEntries) {
        for (const merge of mergeEntries) {
            let toolbar = findCommonAncestor(forward.element, merge.element, documentRef.body);
            while (toolbar && toolbar !== documentRef.body) {
                const contained = entries.filter(entry => toolbar.contains?.(entry.element));
                const labels = new Map(contained.map(entry => [entry.label, entry.element]));
                if (labels.size >= 4) {
                    if (!seen.has(toolbar)) {
                        seen.add(toolbar);
                        candidates.push({ toolbar, labels });
                    }
                    break;
                }
                toolbar = toolbar.parentElement;
            }
        }
    }
    return candidates;
}

function findToolbarActionRoot(labelElement, toolbar) {
    let action = labelElement;
    for (let node = labelElement; node && node !== toolbar; node = node.parentElement) {
        const rect = node.getBoundingClientRect();
        const labels = Array.from(NATIVE_TOOLBAR_LABELS).filter(label => compactText(node).includes(label));
        if (labels.length === 1 && rect.width >= 36 && rect.width <= 150 && rect.height >= 42 && rect.height <= 150) {
            action = node;
        }
    }
    return action;
}

function replaceExactText(root, previous, next) {
    const documentRef = root.ownerDocument;
    const walker = documentRef.createTreeWalker(root, 4);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (String(node.nodeValue || '').trim() === previous) {
            node.nodeValue = String(node.nodeValue).replace(previous, next);
            return true;
        }
    }
    return false;
}

function createImageIcon(documentRef) {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = documentRef.createElementNS(namespace, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<rect x="3.5" y="4.5" width="17" height="15" rx="2" />' +
        '<circle cx="8.5" cy="9.5" r="1.4" />' +
        '<path d="m4 17 4.5-4.5 3.5 3.5 2.5-2.5 5.5 5.5" />';
    svg.style.width = '24px';
    svg.style.height = '24px';
    return svg;
}

function ensureStyle(documentRef) {
    if (documentRef.getElementById(STYLE_ID)) {
        return;
    }
    const style = documentRef.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#${ROOT_ID} {
    position: fixed;
    top: 0;
    left: -10000px;
    z-index: -2147483647;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 680px;
    padding: 6px;
    overflow: visible;
    color: var(--text_primary, var(--text-01, #1f2329));
    background: transparent !important;
    pointer-events: none;
    box-sizing: border-box;
    contain: layout style;
}
#${ROOT_ID} .qqnt-toolbox-message-image-row {
    position: relative !important;
    display: block !important;
    flex: none !important;
    width: 100% !important;
    min-width: 0 !important;
    height: auto !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
    background: transparent !important;
    opacity: 1 !important;
    transform: none !important;
}
#${ROOT_ID} .qqnt-toolbox-message-image-source {
    position: relative !important;
    inset: auto !important;
    display: block !important;
    width: 100% !important;
    min-width: 0 !important;
    height: auto !important;
    min-height: 0 !important;
    margin: 0 !important;
    overflow: visible !important;
    background: transparent !important;
    opacity: 1 !important;
    transform: none !important;
}
#${ROOT_ID} .qqnt-toolbox-message-image-source::before,
#${ROOT_ID} .qqnt-toolbox-message-image-source::after {
    display: none !important;
    content: none !important;
}
#${ROOT_ID} .message-container {
    max-width: 640px !important;
    background-color: transparent !important;
    background-image: none !important;
    box-shadow: none !important;
}
#${ROOT_ID} .message-container::before,
#${ROOT_ID} .message-container::after {
    display: none !important;
    content: none !important;
}
#${ROOT_ID} .message-content__wrapper {
    max-width: 640px !important;
}
#${ROOT_ID} [class*="select-mask" i],
#${ROOT_ID} [class*="selected-mask" i],
#${ROOT_ID} [class*="checkbox" i],
#${ROOT_ID} [role="checkbox"],
#${ROOT_ID} input[type="checkbox"],
#${ROOT_ID} .plus-one-btn,
#${ROOT_ID} [class*="qqnt-toolbox" i]:not(.qqnt-toolbox-message-image-row):not(.qqnt-toolbox-message-image-source) {
    display: none !important;
}
#${ROOT_ID}:not(.${INCLUDE_REACTIONS_CLASS}) [class*="reaction" i],
#${ROOT_ID}:not(.${INCLUDE_REACTIONS_CLASS}) .emoji-like {
    display: none !important;
}
#${TOAST_ID} {
    position: fixed;
    z-index: 2147483647;
    top: 68px;
    left: 50%;
    max-width: min(420px, calc(100vw - 32px));
    padding: 8px 13px;
    overflow: hidden;
    border: 1px solid var(--border-level-1-color, var(--divider, rgba(127, 127, 127, .2)));
    border-radius: 6px;
    color: var(--text-primary, var(--text-01, #1f2329));
    background: var(--bg_top_light, var(--background-05, var(--background-01, #fff)));
    box-shadow: var(--shadow-bg-middle-primary, 0 8px 24px rgba(0, 0, 0, .2));
    font-size: 12px;
    line-height: 20px;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transform: translate(-50%, -6px);
    transition: opacity .14s ease, transform .14s ease;
}
#${TOAST_ID}[data-visible="true"] {
    opacity: 1;
    transform: translate(-50%, 0);
}
#${TOAST_ID}[data-error="true"] {
    color: var(--text_error, #e5484d);
    border-color: color-mix(in srgb, var(--text_error, #e5484d) 48%, transparent);
}
@media (prefers-reduced-motion: reduce) {
    #${TOAST_ID} {
        transition: none;
    }
}
`;
    documentRef.head?.append(style);
}

function copyDynamicMedia(original, clone, documentRef) {
    const originalImages = original.querySelectorAll('img');
    const cloneImages = clone.querySelectorAll('img');
    originalImages.forEach((image, index) => {
        const target = cloneImages[index];
        if (target && (image.currentSrc || image.src)) {
            target.src = image.currentSrc || image.src;
            target.loading = 'eager';
        }
    });

    const originalCanvases = original.querySelectorAll('canvas');
    const cloneCanvases = clone.querySelectorAll('canvas');
    originalCanvases.forEach((canvas, index) => {
        const target = cloneCanvases[index];
        if (!target) {
            return;
        }
        try {
            const image = documentRef.createElement('img');
            image.src = canvas.toDataURL('image/png');
            image.className = target.className;
            image.style.cssText = target.style.cssText;
            image.width = canvas.width;
            image.height = canvas.height;
            target.replaceWith(image);
        } catch {
        }
    });

    const originalVideos = original.querySelectorAll('video');
    const cloneVideos = clone.querySelectorAll('video');
    originalVideos.forEach((video, index) => {
        const target = cloneVideos[index];
        if (!target) {
            return;
        }
        try {
            if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
                const canvas = documentRef.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                canvas.getContext('2d')?.drawImage(video, 0, 0);
                const image = documentRef.createElement('img');
                image.src = canvas.toDataURL('image/png');
                image.className = target.className;
                image.style.cssText = target.style.cssText;
                target.replaceWith(image);
            } else if (video.poster) {
                target.poster = video.poster;
            }
        } catch {
        }
    });
}

function sanitizeMessageClone(original, clone, documentRef, includeReactions = false) {
    copyDynamicMedia(original, clone, documentRef);
    clone.classList.add('qqnt-toolbox-message-image-source');
    for (const element of [clone, ...clone.querySelectorAll('*')]) {
        Array.from(element.classList || []).forEach(className => {
            if (/(^|[-_])(selected|selecting|checked)([-_]|$)/i.test(className)) {
                element.classList.remove(className);
            }
        });
        element.removeAttribute('aria-selected');
        element.removeAttribute('data-selected');
        element.removeAttribute('data-is-selected');
    }
    clone.removeAttribute('id');
    clone.hidden = false;
    clone.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
    const removableSelectors = [
        '.plus-one-btn',
        '[class*="qqnt-toolbox" i]',
        '[class*="select-mask" i]',
        '[class*="selected-mask" i]',
        '[class*="checkbox" i]',
        '[role="checkbox"]',
        'input[type="checkbox"]',
        '.q-context-menu'
    ];
    if (!includeReactions) {
        removableSelectors.push('[class*="reaction" i]', '.emoji-like');
    }
    clone.querySelectorAll(removableSelectors.join(',')).forEach(element => element.remove());
    clone.querySelectorAll('button, [role="button"]').forEach(element => {
        const className = String(element.className?.baseVal ?? element.className ?? '').toLowerCase();
        if (compactText(element) === '+1' || /repeat|plus-one/.test(className)) {
            element.remove();
        }
    });
    return clone;
}

function appendDetachedReactionClones(message, content, shell, documentRef) {
    const reactions = Array.from(message.querySelectorAll('[class*="reaction" i], .emoji-like'))
        .filter(element => !content.contains(element));
    for (const reaction of reactions) {
        if (reactions.some(parent => parent !== reaction && parent.contains(reaction))) {
            continue;
        }
        const clone = reaction.cloneNode(true);
        copyDynamicMedia(reaction, clone, documentRef);
        shell.append(clone);
    }
}

function cloneMessageContent(message, documentRef, includeReactions = false) {
    const content = getMessageImageContentElement(message);
    if (!content) {
        return null;
    }
    if (content === message) {
        return sanitizeMessageClone(message, message.cloneNode(true), documentRef, includeReactions);
    }
    const shell = message.cloneNode(false);
    shell.append(content.cloneNode(true));
    if (includeReactions) {
        appendDetachedReactionClones(message, content, shell, documentRef);
    }
    return sanitizeMessageClone(content, shell, documentRef, includeReactions);
}

function readCssColor(context, value) {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = 'rgba(0, 0, 0, 0)';
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
}

function formatRgba([red, green, blue, alpha]) {
    return `rgba(${red}, ${green}, ${blue}, ${Number((alpha / 255).toFixed(3))})`;
}

function compositeColor(foreground, background) {
    const alpha = foreground[3] / 255;
    return [
        Math.round(foreground[0] * alpha + background[0] * (1 - alpha)),
        Math.round(foreground[1] * alpha + background[1] * (1 - alpha)),
        Math.round(foreground[2] * alpha + background[2] * (1 - alpha)),
        255
    ];
}

function createColorContext(documentRef) {
    const canvas = documentRef.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return canvas.getContext('2d', { willReadFrequently: true });
}

export function getMessageImageBackground(message, scope, windowRef, documentRef) {
    const context = createColorContext(documentRef);
    if (!context) {
        return { color: '#ffffff', image: 'none' };
    }
    const body = documentRef.body;
    const theme = [
        documentRef.documentElement?.getAttribute?.('q-theme'),
        body?.getAttribute?.('q-theme'),
        documentRef.documentElement?.dataset?.theme,
        body?.dataset?.theme
    ].filter(Boolean).join(' ').toLowerCase();
    const fallback = /dark|night/.test(theme) ? '#1f1f1f' : '#ffffff';
    const candidates = [];
    const seen = new Set();
    const appendAncestors = start => {
        for (let node = start?.nodeType === 1 ? start : null; node; node = node.parentElement) {
            if (!seen.has(node)) {
                seen.add(node);
                candidates.push(node);
            }
            if (node === body) {
                break;
            }
        }
    };
    appendAncestors(scope);
    if (!candidates.length) {
        appendAncestors(message?.parentElement);
    }

    let color = '';
    let image = 'none';
    let imageStyle = null;
    for (const element of candidates) {
        const style = windowRef.getComputedStyle(element);
        if (image === 'none' && style.backgroundImage && style.backgroundImage !== 'none') {
            image = style.backgroundImage;
            imageStyle = style;
        }
        if (!color) {
            const parsed = readCssColor(context, style.backgroundColor || 'transparent');
            if (parsed[3] >= 250) {
                color = formatRgba(parsed);
            }
        }
        if (color && image !== 'none') {
            break;
        }
    }
    if (!color) {
        const variables = body ? windowRef.getComputedStyle(body) : null;
        for (const name of ['--bg_bottom_standard', '--bg_bottom_light', '--background-primary']) {
            const value = variables?.getPropertyValue?.(name)?.trim();
            if (!value) {
                continue;
            }
            const parsed = readCssColor(context, value);
            if (parsed[3] >= 250) {
                color = formatRgba(parsed);
                break;
            }
        }
    }
    return {
        color: color || fallback,
        image,
        position: imageStyle?.backgroundPosition || 'center',
        repeat: imageStyle?.backgroundRepeat || 'no-repeat',
        size: imageStyle?.backgroundSize || 'cover'
    };
}

export function normalizeUnsupportedCssColors(surface, windowRef, documentRef, options = {}) {
    const context = createColorContext(documentRef);
    if (!context) {
        return 0;
    }
    const cache = new Map();
    const resolveColor = value => {
        if (cache.has(value)) {
            return cache.get(value);
        }
        const resolved = readCssColor(context, value);
        cache.set(value, resolved);
        return resolved;
    };
    const matte = options.matteColor ? resolveColor(options.matteColor) : null;
    let count = 0;
    for (const element of [surface, ...surface.querySelectorAll('*')]) {
        const computed = windowRef.getComputedStyle(element);
        for (const property of HTML2CANVAS_COLOR_PROPERTIES) {
            const value = computed.getPropertyValue(property);
            const unsupported = /^color\(/i.test(String(value).trim());
            const parsed = resolveColor(value);
            const shouldFlatten = matte && parsed[3] > 0 && parsed[3] < 255;
            if (!unsupported && !shouldFlatten) {
                continue;
            }
            const output = shouldFlatten ? compositeColor(parsed, matte) : parsed;
            element.style.setProperty(property, formatRgba(output), 'important');
            count += 1;
        }
    }
    return count;
}

function waitForPaint(windowRef) {
    return new Promise(resolve => {
        const frame = typeof windowRef.requestAnimationFrame === 'function'
            ? windowRef.requestAnimationFrame.bind(windowRef)
            : callback => setTimeout(callback, 16);
        frame(() => frame(resolve));
    });
}

async function waitForSurface(surface, windowRef) {
    const images = Array.from(surface.querySelectorAll('img'));
    await Promise.all(images.map(image => {
        if (image.complete) {
            return Promise.resolve();
        }
        return Promise.race([
            image.decode?.().catch(() => {}) || Promise.resolve(),
            new Promise(resolve => windowRef.setTimeout(resolve, 1200))
        ]);
    }));
    if (surface.ownerDocument.fonts?.ready) {
        await Promise.race([
            surface.ownerDocument.fonts.ready,
            new Promise(resolve => windowRef.setTimeout(resolve, 500))
        ]);
    }
    await waitForPaint(windowRef);
}

export function cropTransparentCanvas(canvas, options = {}) {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context || !canvas.width || !canvas.height) {
        return canvas;
    }
    let pixels;
    try {
        pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    } catch {
        return canvas;
    }
    let left = canvas.width;
    let top = canvas.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
            if (pixels[(y * canvas.width + x) * 4 + 3] <= 2) {
                continue;
            }
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
        }
    }
    if (right < left || bottom < top) {
        return canvas;
    }
    const margin = Math.max(0, Math.round(Number(options.margin) || 0));
    left = Math.max(0, left - margin);
    top = Math.max(0, top - margin);
    right = Math.min(canvas.width - 1, right + margin);
    bottom = Math.min(canvas.height - 1, bottom + margin);
    if (left === 0 && top === 0 && right === canvas.width - 1 && bottom === canvas.height - 1) {
        return canvas;
    }
    const output = canvas.ownerDocument.createElement('canvas');
    output.width = right - left + 1;
    output.height = bottom - top + 1;
    output.getContext('2d')?.drawImage(
        canvas,
        left,
        top,
        output.width,
        output.height,
        0,
        0,
        output.width,
        output.height
    );
    return output;
}

function canvasToPngBytes(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(async blob => {
            if (!blob) {
                reject(new Error('消息图片编码失败'));
                return;
            }
            resolve(new Uint8Array(await blob.arrayBuffer()));
        }, 'image/png');
    });
}

export function installCanvasTextAlignment(canvas, offsetY = -1) {
    const context = canvas?.getContext?.('2d');
    if (!context || !Number.isFinite(offsetY) || offsetY === 0) {
        return () => {};
    }
    const originals = new Map();
    for (const method of ['fillText', 'strokeText']) {
        if (typeof context[method] !== 'function') {
            continue;
        }
        const original = context[method];
        originals.set(method, original);
        context[method] = function(...args) {
            args[2] = Number(args[2]) + offsetY;
            return original.apply(this, args);
        };
    }
    return () => {
        for (const [method, original] of originals) {
            context[method] = original;
        }
    };
}

export function createMessageImageController(options = {}) {
    const documentRef = options.document || document;
    const windowRef = options.window || window;
    const isEnabled = typeof options.isEnabled === 'function' ? options.isEnabled : () => true;
    const includeBackground = typeof options.includeBackground === 'function'
        ? options.includeBackground
        : () => false;
    const includeReactions = typeof options.includeReactions === 'function'
        ? options.includeReactions
        : () => false;
    const getMessageElement = typeof options.getMessageElement === 'function' ? options.getMessageElement : value => value;
    const getMessageRecord = typeof options.getMessageRecord === 'function' ? options.getMessageRecord : () => null;
    const getRecordKey = typeof options.getRecordKey === 'function' ? options.getRecordKey : () => '';
    const getMessageScope = typeof options.getMessageScope === 'function' ? options.getMessageScope : () => documentRef;
    const loadRenderer = typeof options.loadRenderer === 'function'
        ? options.loadRenderer
        : async () => {
            if (typeof windowRef.html2canvas !== 'function') {
                throw new Error('消息转图片组件不可用');
            }
            return windowRef.html2canvas;
        };
    const save = typeof options.save === 'function' ? options.save : async () => ({ ok: false });
    const onError = typeof options.onError === 'function' ? options.onError : () => {};
    const onDiagnostic = typeof options.onDiagnostic === 'function' ? options.onDiagnostic : () => {};
    let observer = null;
    let toolbarStateObserver = null;
    let toolbarVisibilityObserver = null;
    let toolbarVisibilityTargets = [];
    let activeToolbar = null;
    let activeToolbarStateSource = null;
    let busy = false;
    let rendererPromise = null;
    let installTimer = 0;
    let toastTimer = 0;

    function showToast(message, error = false) {
        windowRef.clearTimeout(toastTimer);
        documentRef.getElementById(TOAST_ID)?.remove();
        const toast = documentRef.createElement('div');
        toast.id = TOAST_ID;
        toast.textContent = String(message || '');
        toast.dataset.error = String(error);
        toast.setAttribute('role', error ? 'alert' : 'status');
        toast.setAttribute('aria-live', error ? 'assertive' : 'polite');
        documentRef.body?.append(toast);
        const reveal = () => {
            if (toast.isConnected !== false) {
                toast.dataset.visible = 'true';
            }
        };
        if (typeof windowRef.requestAnimationFrame === 'function') {
            windowRef.requestAnimationFrame(reveal);
        } else {
            reveal();
        }
        toastTimer = windowRef.setTimeout(() => toast.remove(), error ? 3200 : 2200);
    }

    function getRenderer() {
        if (!rendererPromise) {
            rendererPromise = Promise.resolve()
                .then(loadRenderer)
                .then(renderer => {
                    if (typeof renderer !== 'function') {
                        throw new Error('消息转图片组件不可用');
                    }
                    return renderer;
                })
                .catch(error => {
                    rendererPromise = null;
                    throw error;
                });
        }
        return rendererPromise;
    }

    function collectMessages(root) {
        const messages = [];
        const seenElements = new Set();
        const seenRecords = new Set();
        root.querySelectorAll?.('.message, .ml-item').forEach(candidate => {
            const message = getMessageElement(candidate);
            if (!isRenderableElement(message) || seenElements.has(message)) {
                return;
            }
            seenElements.add(message);
            const record = getMessageRecord(message);
            const key = getRecordKey(record);
            if (!key || seenRecords.has(key)) {
                return;
            }
            seenRecords.add(key);
            messages.push(message);
        });
        return sortMessageImageElements(messages);
    }

    function collectSelectedMessages(toolbar, recordSelection = true) {
        const scope = getMessageScope(toolbar) || documentRef;
        const messages = collectMessages(scope);
        const selected = messages.filter(message => {
            const row = message.closest?.('.ml-item') || message;
            const marker = findNativeSelectionMarker(row, message, windowRef);
            return marker && isNativeSelectionMarkerChecked(marker, windowRef);
        });
        if (recordSelection) {
            onDiagnostic('message-image.native-selection', {
                selected: selected.length,
                visible: messages.length
            });
        }
        return selected;
    }

    async function renderMessages(elements) {
        if (!isEnabled() || busy) {
            return { ok: false, reason: busy ? 'busy' : 'disabled' };
        }
        const messages = sortMessageImageElements(elements).slice(0, MAX_RENDER_MESSAGES);
        if (!messages.length) {
            return { ok: false, reason: 'no-message', message: '没有可转换的消息' };
        }
        busy = true;
        ensureStyle(documentRef);
        documentRef.getElementById(ROOT_ID)?.remove();
        const surface = documentRef.createElement('div');
        surface.id = ROOT_ID;
        surface.setAttribute('aria-hidden', 'true');
        const scope = getMessageScope(messages[0]) || documentRef;
        const background = getMessageImageBackground(messages[0], scope, windowRef, documentRef);
        const withBackground = includeBackground();
        const withReactions = includeReactions();
        surface.classList.toggle(INCLUDE_REACTIONS_CLASS, withReactions);
        if (withBackground) {
            surface.style.setProperty('background-color', background.color, 'important');
            if (background.image !== 'none') {
                surface.style.setProperty('background-image', background.image, 'important');
                surface.style.setProperty('background-position', background.position, 'important');
                surface.style.setProperty('background-repeat', background.repeat, 'important');
                surface.style.setProperty('background-size', background.size, 'important');
            }
        }
        for (const message of messages) {
            const row = documentRef.createElement('div');
            row.className = 'qqnt-toolbox-message-image-row';
            const content = cloneMessageContent(message, documentRef, withReactions);
            if (!content) {
                continue;
            }
            row.append(content);
            surface.append(row);
        }
        documentRef.body?.append(surface);
        try {
            const normalizedColors = normalizeUnsupportedCssColors(surface, windowRef, documentRef, {
                matteColor: withBackground ? '' : background.color
            });
            if (normalizedColors) {
                onDiagnostic('message-image.colors-normalized', { count: normalizedColors });
            }
            await waitForSurface(surface, windowRef);
            const scale = Math.max(1, Math.min(2, Number(windowRef.devicePixelRatio) || 1));
            const renderDom = await getRenderer();
            const renderWidth = Math.ceil(surface.scrollWidth);
            const renderHeight = Math.ceil(surface.scrollHeight);
            const renderCanvas = documentRef.createElement('canvas');
            renderCanvas.width = Math.floor(renderWidth * scale);
            renderCanvas.height = Math.floor(renderHeight * scale);
            renderCanvas.style.width = `${renderWidth}px`;
            renderCanvas.style.height = `${renderHeight}px`;
            const restoreTextAlignment = installCanvasTextAlignment(renderCanvas);
            let canvas;
            try {
                canvas = await renderDom(surface, {
                    allowTaint: false,
                    backgroundColor: null,
                    canvas: renderCanvas,
                    logging: false,
                    removeContainer: true,
                    scale,
                    useCORS: true,
                    width: renderWidth,
                    height: renderHeight,
                    windowWidth: documentRef.documentElement.clientWidth,
                    windowHeight: documentRef.documentElement.clientHeight
                });
            } finally {
                restoreTextAlignment();
            }
            const output = cropTransparentCanvas(canvas, { margin: Math.round(scale * 4) });
            const result = await save({
                data: await canvasToPngBytes(output),
                count: messages.length
            });
            if (!result?.ok) {
                const message = result?.message || '保存消息图片失败';
                throw new Error(message.startsWith('保存') ? message : `保存失败：${message}`);
            }
            const toast = getMessageImageToastPresentation(result);
            showToast(toast.message, toast.error);
            return result;
        } catch (error) {
            onError(error);
            showToast(error?.message || '保存消息图片失败', true);
            return { ok: false, reason: 'render-failed', message: error?.message || String(error) };
        } finally {
            surface.remove();
            busy = false;
            const toolbarInfo = activeToolbar?.isConnected
                ? findNativeMultiSelectToolbar(documentRef, windowRef)
                : null;
            if (toolbarInfo?.toolbar === activeToolbar) {
                refreshToolbarButton(toolbarInfo, true);
            }
        }
    }

    function renderSingle(messageElement) {
        return renderMessages(isRenderableElement(messageElement) ? [messageElement] : []);
    }

    function getToolbarStateSource(toolbarInfo) {
        const label = toolbarInfo.labels.get('逐条转发') ||
            toolbarInfo.labels.get('合并转发') ||
            toolbarInfo.labels.values().next().value;
        return {
            action: findToolbarActionRoot(label, toolbarInfo.toolbar),
            label
        };
    }

    function markToolbarButtonBusy(button) {
        button.dataset.busy = 'true';
        button.toggleAttribute('disabled', true);
        button.setAttribute('aria-disabled', 'true');
        button.style.pointerEvents = 'none';
        button.style.opacity = '0.55';
    }

    function createToolbarButton(toolbarInfo, stateSource) {
        const insertionLabel = toolbarInfo.labels.get('复制') || toolbarInfo.labels.values().next().value;
        const insertionTarget = findToolbarActionRoot(insertionLabel, toolbarInfo.toolbar);
        const button = stateSource.action.cloneNode(true);
        button.classList.add(TOOLBAR_BUTTON_CLASS);
        button.removeAttribute('id');
        if (!replaceExactText(button, compactText(stateSource.label), '转图')) {
            button.append(documentRef.createTextNode('转图'));
        }
        const nativeIcon = button.querySelector('svg');
        if (nativeIcon) {
            nativeIcon.replaceWith(createImageIcon(documentRef));
        } else {
            const iconHost = button.querySelector('[class*="icon" i]');
            (iconHost || button).prepend(createImageIcon(documentRef));
        }
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            if (busy || button.dataset.busy === 'true') {
                return;
            }
            const selected = collectSelectedMessages(toolbarInfo.toolbar);
            if (!selected.length) {
                return;
            }
            const rendering = renderMessages(selected);
            markToolbarButtonBusy(button);
            Promise.resolve(rendering).catch(onError);
        }, true);
        if (busy) {
            markToolbarButtonBusy(button);
        }
        return { button, insertionTarget };
    }

    function refreshToolbarButton(toolbarInfo, replace = false) {
        if (!toolbarInfo?.toolbar?.isConnected || toolbarInfo.toolbar !== activeToolbar) {
            return null;
        }
        const stateSource = getToolbarStateSource(toolbarInfo);
        if (!stateSource.action?.isConnected) {
            return null;
        }
        const current = toolbarInfo.toolbar.querySelector(`.${TOOLBAR_BUTTON_CLASS}`);
        if (current && !replace) {
            return current;
        }
        const { button, insertionTarget } = createToolbarButton(toolbarInfo, stateSource);
        if (current) {
            current.replaceWith(button);
        } else {
            insertionTarget.parentElement?.insertBefore(button, insertionTarget);
            onDiagnostic('message-image.toolbar-mounted', {
                actions: toolbarInfo.labels.size
            });
        }
        return button;
    }

    function bindToolbarState(toolbarInfo) {
        const stateSource = getToolbarStateSource(toolbarInfo).action;
        if (activeToolbarStateSource === stateSource && toolbarStateObserver) {
            return false;
        }
        toolbarStateObserver?.disconnect();
        toolbarStateObserver = null;
        activeToolbarStateSource = stateSource || null;
        if (!stateSource) {
            return true;
        }
        const Observer = windowRef.MutationObserver || MutationObserver;
        toolbarStateObserver = new Observer(() => {
            if (!isEnabled() || !activeToolbar?.isConnected || !activeToolbarStateSource?.isConnected) {
                sync();
                return;
            }
            const info = findNativeMultiSelectToolbar(documentRef, windowRef);
            if (!info || info.toolbar !== activeToolbar ||
                getToolbarStateSource(info).action !== activeToolbarStateSource) {
                sync();
                return;
            }
            refreshToolbarButton(info, true);
        });
        toolbarStateObserver.observe(stateSource, {
            attributes: true,
            childList: true,
            characterData: true,
            subtree: true
        });
        return true;
    }

    function clearToolbarState() {
        toolbarStateObserver?.disconnect();
        toolbarStateObserver = null;
        activeToolbarStateSource = null;
    }

    function bindToolbarVisibility() {
        const targets = [];
        const seen = new Set();
        for (const { toolbar } of findNativeMultiSelectToolbarHosts(documentRef, windowRef)) {
            for (let element = toolbar, depth = 0;
                element && element !== documentRef.body && depth < 5;
                element = element.parentElement, depth += 1) {
                if (!seen.has(element)) {
                    seen.add(element);
                    targets.push(element);
                }
            }
        }
        if (targets.length === toolbarVisibilityTargets.length &&
            targets.every((target, index) => target === toolbarVisibilityTargets[index])) {
            return;
        }
        toolbarVisibilityObserver?.disconnect();
        toolbarVisibilityObserver = null;
        toolbarVisibilityTargets = targets;
        if (!targets.length) {
            return;
        }
        const Observer = windowRef.MutationObserver || MutationObserver;
        toolbarVisibilityObserver = new Observer(sync);
        for (const target of targets) {
            toolbarVisibilityObserver.observe(target, {
                attributes: true,
                attributeFilter: ['aria-hidden', 'class', 'hidden', 'style']
            });
        }
    }

    function clearToolbarVisibility() {
        toolbarVisibilityObserver?.disconnect();
        toolbarVisibilityObserver = null;
        toolbarVisibilityTargets = [];
    }

    function sync() {
        if (!isEnabled()) {
            clearToolbarState();
            clearToolbarVisibility();
            documentRef.querySelectorAll(`.${TOOLBAR_BUTTON_CLASS}`).forEach(button => button.remove());
            activeToolbar = null;
            return;
        }
        bindToolbarVisibility();
        const info = findNativeMultiSelectToolbar(documentRef, windowRef);
        if (activeToolbar && activeToolbar !== info?.toolbar) {
            activeToolbar.querySelector?.(`.${TOOLBAR_BUTTON_CLASS}`)?.remove();
            clearToolbarState();
        }
        activeToolbar = info?.toolbar || null;
        if (info) {
            const stateSourceChanged = bindToolbarState(info);
            refreshToolbarButton(info, stateSourceChanged);
        } else {
            clearToolbarState();
        }
    }

    function install() {
        if (observer || installTimer) {
            return;
        }
        if (!documentRef.body) {
            installTimer = windowRef.setTimeout(() => {
                installTimer = 0;
                install();
            }, 50);
            return;
        }
        const Observer = windowRef.MutationObserver || MutationObserver;
        observer = new Observer(mutations => {
            if (activeToolbar && !activeToolbar.isConnected) {
                activeToolbar = null;
                clearToolbarState();
                sync();
                return;
            }
            if (activeToolbar?.isConnected) {
                if (mutations.some(mutation =>
                    mutation.target === activeToolbar || activeToolbar.contains?.(mutation.target))) {
                    sync();
                }
                return;
            }
            if (mutations.some(mutation => Array.from(mutation.addedNodes).some(node => {
                const content = String(node.textContent || '');
                return content.includes('逐条转发') || content.includes('合并转发');
            }))) {
                sync();
            }
        });
        observer.observe(documentRef.body, { childList: true, subtree: true });
        sync();
    }

    function destroy() {
        observer?.disconnect();
        observer = null;
        clearToolbarState();
        clearToolbarVisibility();
        windowRef.clearTimeout(installTimer);
        installTimer = 0;
        windowRef.clearTimeout(toastTimer);
        toastTimer = 0;
        documentRef.querySelectorAll(`.${TOOLBAR_BUTTON_CLASS}`).forEach(button => button.remove());
        documentRef.getElementById(ROOT_ID)?.remove();
        documentRef.getElementById(TOAST_ID)?.remove();
        activeToolbar = null;
    }

    return {
        destroy,
        install,
        renderMessages,
        renderSingle,
        sync
    };
}
