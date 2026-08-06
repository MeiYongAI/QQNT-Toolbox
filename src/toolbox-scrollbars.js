const STYLE_ID = 'qqnt-toolbox-scrollbars-style';
const OVERLAY_ID = 'qqnt-toolbox-scrollbar-overlay';
const SCROLLABLE_CLASS = 'qqnt-toolbox-scrollable';
const ACTIVE_DURATION = 720;
const MIN_THUMB_SIZE = 24;

function ensureStyle(document) {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const link = document.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    link.href = new URL('./toolbox-scrollbars.css', import.meta.url).href;
    (document.head || document.documentElement)?.appendChild(link);
}

function isVerticalScrollContainer(element, view) {
    if (!(element instanceof view.HTMLElement) || !element.isConnected ||
        !element.classList.contains(SCROLLABLE_CLASS) ||
        element.getClientRects().length === 0 ||
        element.scrollHeight <= element.clientHeight + 1) {
        return false;
    }
    const overflowY = view.getComputedStyle(element).overflowY;
    return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
}

function findScrollable(event, view) {
    for (const node of event.composedPath?.() || []) {
        if (isVerticalScrollContainer(node, view)) {
            return node;
        }
    }
    return null;
}

function getVisibleRect(element, view) {
    const rect = element.getBoundingClientRect();
    let top = Math.max(0, rect.top);
    let right = Math.min(view.innerWidth, rect.right);
    let bottom = Math.min(view.innerHeight, rect.bottom);
    let left = Math.max(0, rect.left);

    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = view.getComputedStyle(parent);
        const clipsY = /^(?:auto|scroll|hidden|clip)$/.test(style.overflowY);
        const clipsX = /^(?:auto|scroll|hidden|clip)$/.test(style.overflowX);
        if (!clipsY && !clipsX) {
            continue;
        }
        const parentRect = parent.getBoundingClientRect();
        if (clipsY) {
            top = Math.max(top, parentRect.top);
            bottom = Math.min(bottom, parentRect.bottom);
        }
        if (clipsX) {
            left = Math.max(left, parentRect.left);
            right = Math.min(right, parentRect.right);
        }
    }

    return { top, right, bottom, left };
}

function measure(element, view) {
    if (!isVerticalScrollContainer(element, view)) {
        return null;
    }
    const rect = getVisibleRect(element, view);
    const trackTop = rect.top + 2;
    const trackHeight = Math.max(0, rect.bottom - rect.top - 4);
    if (trackHeight < MIN_THUMB_SIZE || rect.right <= rect.left) {
        return null;
    }

    const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
    const thumbHeight = Math.min(
        trackHeight,
        Math.max(MIN_THUMB_SIZE, trackHeight * element.clientHeight / element.scrollHeight)
    );
    const travel = Math.max(0, trackHeight - thumbHeight);
    const thumbTop = maxScroll > 0 ? travel * element.scrollTop / maxScroll : 0;

    return {
        left: rect.right - 9,
        trackTop,
        trackHeight,
        thumbTop,
        thumbHeight,
        travel,
        maxScroll
    };
}

function install(document) {
    const view = document.defaultView;
    if (!view || document.getElementById(OVERLAY_ID)) {
        return;
    }
    ensureStyle(document);

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'qqnt-toolbox-scrollbar-overlay v-scrollbar-track';
    overlay.tabIndex = -1;
    overlay.setAttribute('aria-hidden', 'true');
    const thumb = document.createElement('div');
    thumb.className = 'qqnt-toolbox-scrollbar-thumb v-scrollbar-thumb';
    overlay.appendChild(thumb);
    (document.body || document.documentElement).appendChild(overlay);

    let current = null;
    let hovered = null;
    let overlayHovered = false;
    let activeUntil = 0;
    let animationFrame = 0;
    let hideTimer = 0;
    let dragging = null;

    const setVisible = visible => {
        overlay.dataset.visible = String(visible);
        overlay.setAttribute('aria-hidden', String(!visible));
    };

    const cancelHide = () => {
        if (hideTimer) {
            view.clearTimeout(hideTimer);
            hideTimer = 0;
        }
    };

    const hide = () => {
        cancelHide();
        current = null;
        setVisible(false);
    };

    const scheduleHide = () => {
        cancelHide();
        if (!current || dragging || overlayHovered || hovered === current) {
            return;
        }
        const delay = Math.max(0, activeUntil - Date.now());
        if (!delay) {
            hide();
            return;
        }
        hideTimer = view.setTimeout(() => {
            hideTimer = 0;
            if (!dragging && !overlayHovered && hovered !== current &&
                Date.now() >= activeUntil) {
                hide();
            }
        }, delay + 16);
    };

    const render = () => {
        animationFrame = 0;
        if (!current) {
            hide();
            return;
        }
        const metrics = measure(current, view);
        if (!metrics) {
            hide();
            return;
        }

        overlay.style.setProperty('--qqnt-toolbox-scrollbar-left', `${metrics.left}px`);
        overlay.style.setProperty('--qqnt-toolbox-scrollbar-top', `${metrics.trackTop}px`);
        overlay.style.setProperty('--qqnt-toolbox-scrollbar-height', `${metrics.trackHeight}px`);
        overlay.style.setProperty('--qqnt-toolbox-scrollbar-thumb-top', `${metrics.thumbTop}px`);
        overlay.style.setProperty('--qqnt-toolbox-scrollbar-thumb-height', `${metrics.thumbHeight}px`);
        overlay.setAttribute('aria-valuemin', '0');
        overlay.setAttribute('aria-valuemax', String(Math.round(metrics.maxScroll)));
        overlay.setAttribute('aria-valuenow', String(Math.round(current.scrollTop)));
        setVisible(true);

        if (!dragging && !overlayHovered && hovered !== current && Date.now() >= activeUntil) {
            hide();
            return;
        }
        scheduleHide();
    };

    const scheduleRender = () => {
        if (!animationFrame) {
            animationFrame = view.requestAnimationFrame(render);
        }
    };

    const activate = (element, duration = 0) => {
        if (!isVerticalScrollContainer(element, view)) {
            return false;
        }
        current = element;
        cancelHide();
        if (duration > 0) {
            activeUntil = Math.max(activeUntil, Date.now() + duration);
        }
        if (document.body && overlay.parentElement !== document.body) {
            document.body.appendChild(overlay);
        } else if (document.body?.lastElementChild !== overlay) {
            document.body?.appendChild(overlay);
        }
        scheduleRender();
        return true;
    };

    const updateScrollFromPointer = clientY => {
        if (!dragging || !current) {
            return;
        }
        const metrics = measure(current, view);
        if (!metrics || metrics.travel <= 0) {
            return;
        }
        const desiredTop = Math.min(
            metrics.travel,
            Math.max(0, clientY - metrics.trackTop - dragging.pointerOffset)
        );
        current.scrollTop = metrics.maxScroll * desiredTop / metrics.travel;
        activeUntil = Date.now() + ACTIVE_DURATION;
        scheduleRender();
    };

    document.addEventListener('pointermove', event => {
        if (dragging || overlay.contains(event.target)) {
            return;
        }
        const next = findScrollable(event, view);
        hovered = next;
        if (next) {
            activate(next);
        } else if (current) {
            activeUntil = Math.max(activeUntil, Date.now() + 120);
            scheduleRender();
        }
    }, true);

    document.addEventListener('pointerout', event => {
        if (event.relatedTarget || dragging) {
            return;
        }
        hovered = null;
        overlayHovered = false;
        activeUntil = Date.now() + 120;
        scheduleRender();
    }, true);

    document.addEventListener('scroll', event => {
        if (isVerticalScrollContainer(event.target, view)) {
            activate(event.target, ACTIVE_DURATION);
        }
    }, true);

    document.addEventListener('wheel', event => {
        const target = findScrollable(event, view);
        if (target) {
            activate(target, ACTIVE_DURATION);
        }
    }, { capture: true, passive: true });

    overlay.addEventListener('pointerenter', () => {
        overlayHovered = true;
        cancelHide();
        scheduleRender();
    });
    overlay.addEventListener('pointerleave', () => {
        overlayHovered = false;
        if (!dragging) {
            activeUntil = Date.now() + 160;
            scheduleRender();
        }
    });
    overlay.addEventListener('pointerdown', event => {
        if (!current || event.button !== 0) {
            return;
        }
        const metrics = measure(current, view);
        if (!metrics) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const pointerOffset = event.target === thumb
            ? event.clientY - metrics.trackTop - metrics.thumbTop
            : metrics.thumbHeight / 2;
        dragging = { pointerId: event.pointerId, pointerOffset };
        overlay.dataset.dragging = 'true';
        overlay.setPointerCapture?.(event.pointerId);
        updateScrollFromPointer(event.clientY);
    });
    overlay.addEventListener('pointermove', event => {
        if (dragging?.pointerId === event.pointerId) {
            event.preventDefault();
            updateScrollFromPointer(event.clientY);
        }
    });

    const finishDrag = event => {
        if (dragging?.pointerId !== event.pointerId) {
            return;
        }
        overlay.releasePointerCapture?.(event.pointerId);
        dragging = null;
        delete overlay.dataset.dragging;
        activeUntil = Date.now() + ACTIVE_DURATION;
        scheduleRender();
    };
    overlay.addEventListener('pointerup', finishDrag);
    overlay.addEventListener('pointercancel', finishDrag);
    view.addEventListener('resize', scheduleRender, { passive: true });
    view.addEventListener('blur', hide, { passive: true });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            hide();
        }
    }, { passive: true });
}

if (typeof document !== 'undefined') {
    install(document);
}

export { install as installToolboxScrollbars };
