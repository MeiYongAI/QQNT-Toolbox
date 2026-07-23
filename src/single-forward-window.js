'use strict';

const GLOBAL_SCOPE = 'global';
const OPEN_INTENT_TTL_MS = 3000;

function getForwardGroupScope(value) {
    const marker = '#/forward/';
    const url = String(value || '');
    const markerIndex = url.indexOf(marker);
    if (markerIndex < 0) {
        return '';
    }
    try {
        const route = JSON.parse(decodeURIComponent(url.slice(markerIndex + marker.length)));
        const rootMsg = route?.rootMsg;
        const peerUid = String(rootMsg?.peerUid || '').trim();
        return Number(rootMsg?.chatType) === 2 && peerUid
            ? `group:${peerUid}`
            : '';
    } catch {
        return '';
    }
}

function createSingleForwardWindowController(options = {}) {
    const isEnabled = typeof options.isEnabled === 'function'
        ? options.isEnabled
        : () => false;
    const isIsolationEnabled = typeof options.isIsolationEnabled === 'function'
        ? options.isIsolationEnabled
        : () => false;
    const isForwardUrl = typeof options.isForwardUrl === 'function'
        ? options.isForwardUrl
        : () => false;
    const getScopeKey = typeof options.getScopeKey === 'function'
        ? options.getScopeKey
        : () => '';
    const getFocusedWindow = typeof options.getFocusedWindow === 'function'
        ? options.getFocusedWindow
        : () => null;
    const onEvent = typeof options.onEvent === 'function'
        ? options.onEvent
        : () => {};

    const installedWindows = new WeakSet();
    const windowStates = new WeakMap();
    const windowStacks = new WeakMap();
    const stacks = new Map();
    let currentStack = null;
    let activityRevision = 0;
    let isolationMode = null;
    let quitting = false;
    let pendingOpenIntent = null;

    function isUsableWindow(browserWindow) {
        return Boolean(browserWindow && !browserWindow.isDestroyed?.() &&
            browserWindow.webContents && !browserWindow.webContents.isDestroyed?.());
    }

    function getWindowUrl(browserWindow) {
        return isUsableWindow(browserWindow)
            ? String(browserWindow.webContents.getURL?.() || '')
            : '';
    }

    function emit(type, stack, details = {}) {
        onEvent(type, {
            depth: stack?.activeWindow ? stack.history.length + 1 : 0,
            stackCount: stacks.size,
            isolated: stack?.scopeKey !== GLOBAL_SCOPE,
            ...details
        });
    }

    function getStateFor(browserWindow) {
        return browserWindow ? windowStates.get(browserWindow) : null;
    }

    function getStackForWindow(browserWindow) {
        const stack = browserWindow ? windowStacks.get(browserWindow) : null;
        return stack && stacks.get(stack.scopeKey) === stack ? stack : null;
    }

    function touchStack(stack) {
        if (!stack || stacks.get(stack.scopeKey) !== stack) {
            return;
        }
        stack.lastUsed = ++activityRevision;
        currentStack = stack;
    }

    function selectCurrentStack() {
        if (currentStack && stacks.get(currentStack.scopeKey) === currentStack) {
            return currentStack;
        }
        currentStack = [...stacks.values()].reduce((latest, stack) =>
            !latest || stack.lastUsed > latest.lastUsed ? stack : latest
        , null);
        return currentStack;
    }

    function setTaskbarVisibility(browserWindow, visible) {
        try {
            browserWindow.setSkipTaskbar?.(!visible);
        } catch {
        }
    }

    function showWindow(browserWindow) {
        if (!isUsableWindow(browserWindow)) {
            return;
        }
        const state = getStateFor(browserWindow);
        if (state) {
            state.suspended = false;
        }
        setTaskbarVisibility(browserWindow, true);
        try {
            if (browserWindow.isMinimized?.()) {
                browserWindow.restore?.();
            }
            browserWindow.show?.();
            browserWindow.focus?.();
            browserWindow.webContents.focus?.();
        } catch {
        }
        const stack = getStackForWindow(browserWindow);
        if (stack?.activeWindow === browserWindow) {
            touchStack(stack);
        }
    }

    function suspendWindow(browserWindow) {
        const state = getStateFor(browserWindow);
        if (state) {
            state.suspended = true;
        }
        setTaskbarVisibility(browserWindow, false);
        try {
            browserWindow.hide?.();
        } catch {
        }
    }

    function destroyWindow(browserWindow) {
        if (!browserWindow) {
            return;
        }
        const state = getStateFor(browserWindow);
        if (state) {
            state.forceClose = true;
        }
        try {
            browserWindow.hide?.();
            browserWindow.destroy?.();
        } catch {
        }
    }

    function getNormalWindowBounds(browserWindow) {
        if (!isUsableWindow(browserWindow)) {
            return null;
        }
        try {
            const bounds = browserWindow.isMaximized?.() || browserWindow.isFullScreen?.()
                ? browserWindow.getNormalBounds?.() || browserWindow.getBounds?.()
                : browserWindow.getBounds?.();
            return bounds && Number(bounds.width) > 0 && Number(bounds.height) > 0
                ? { ...bounds }
                : null;
        } catch {
            return null;
        }
    }

    function applyNormalWindowBounds(browserWindow, bounds) {
        if (!isUsableWindow(browserWindow) || !bounds) {
            return false;
        }
        try {
            if (browserWindow.isFullScreen?.()) {
                browserWindow.setFullScreen?.(false);
            }
            if (browserWindow.isMaximized?.()) {
                browserWindow.unmaximize?.();
            }
            browserWindow.setBounds?.(bounds, false);
            return true;
        } catch {
            return false;
        }
    }

    function copyNormalWindowBounds(sourceWindow, targetWindow) {
        return applyNormalWindowBounds(targetWindow, getNormalWindowBounds(sourceWindow));
    }

    function presentWhenReady(browserWindow) {
        setTaskbarVisibility(browserWindow, true);
        if (browserWindow.isVisible?.()) {
            showWindow(browserWindow);
        }
    }

    function getOpenerWindow(browserWindow, state) {
        if (state.opener && state.opener !== browserWindow) {
            return state.opener;
        }
        const focusedWindow = getFocusedWindow();
        if (focusedWindow && focusedWindow !== browserWindow) {
            return focusedWindow;
        }
        try {
            const parentWindow = browserWindow.getParentWindow?.();
            return parentWindow && parentWindow !== browserWindow ? parentWindow : null;
        } catch {
            return null;
        }
    }

    function resolveRootScope(url) {
        if (!isIsolationEnabled()) {
            return GLOBAL_SCOPE;
        }
        return String(getScopeKey(url) || '').trim() || GLOBAL_SCOPE;
    }

    function adoptRootWindow(browserWindow, url, scopeKey) {
        const stack = {
            scopeKey,
            rootUrl: url,
            currentUrl: url,
            activeWindow: browserWindow,
            history: [],
            lastUsed: 0
        };
        stacks.set(scopeKey, stack);
        windowStacks.set(browserWindow, stack);
        touchStack(stack);
        presentWhenReady(browserWindow);
        emit('adopted', stack);
        return true;
    }

    function activateNestedWindow(stack, browserWindow, url) {
        const previousWindow = stack.activeWindow;
        copyNormalWindowBounds(previousWindow, browserWindow);
        suspendWindow(previousWindow);
        stack.history.push(previousWindow);
        stack.activeWindow = browserWindow;
        stack.currentUrl = url;
        windowStacks.set(browserWindow, stack);
        touchStack(stack);
        presentWhenReady(browserWindow);
        emit('nested', stack);
        return true;
    }

    function replaceRootWindow(stack, browserWindow, url) {
        const previousWindows = [...stack.history, stack.activeWindow].filter(Boolean);
        copyNormalWindowBounds(stack.activeWindow, browserWindow);
        stack.rootUrl = url;
        stack.currentUrl = url;
        stack.activeWindow = browserWindow;
        stack.history = [];
        windowStacks.set(browserWindow, stack);
        touchStack(stack);
        for (const previousWindow of previousWindows) {
            if (previousWindow !== browserWindow) {
                windowStacks.delete(previousWindow);
                destroyWindow(previousWindow);
            }
        }
        presentWhenReady(browserWindow);
        emit('replaced', stack);
        return true;
    }

    function destroyStack(stack) {
        if (!stack) {
            return;
        }
        if (stacks.get(stack.scopeKey) === stack) {
            stacks.delete(stack.scopeKey);
        }
        for (const browserWindow of [...stack.history, stack.activeWindow]) {
            windowStacks.delete(browserWindow);
            destroyWindow(browserWindow);
        }
        if (currentStack === stack) {
            currentStack = null;
        }
    }

    function getNestedStack(browserWindow, state) {
        const opener = getOpenerWindow(browserWindow, state);
        const stack = getStackForWindow(opener);
        return stack?.activeWindow === opener ? stack : null;
    }

    function markOpenIntent(sourceWindow, type) {
        if (!isEnabled() || !isUsableWindow(sourceWindow)) {
            return false;
        }
        pendingOpenIntent = {
            sourceWindow,
            type: type === 'nested' ? 'nested' : 'root',
            expiresAt: Date.now() + OPEN_INTENT_TTL_MS
        };
        return true;
    }

    function takeOpenIntent() {
        const intent = pendingOpenIntent;
        pendingOpenIntent = null;
        return intent?.expiresAt >= Date.now() ? intent : null;
    }

    function handleNavigation(browserWindow, url, state) {
        url = String(url || '');
        if (!isEnabled() || !isForwardUrl(url) || !isUsableWindow(browserWindow)) {
            return false;
        }
        if (isolationMode === null) {
            isolationMode = isIsolationEnabled();
        }
        state.forward = true;

        const current = getStackForWindow(browserWindow);
        if (current) {
            if (current.activeWindow === browserWindow) {
                current.currentUrl = url;
                touchStack(current);
            }
            return true;
        }

        const intent = takeOpenIntent();
        const intentStack = intent?.type === 'nested'
            ? getStackForWindow(intent.sourceWindow)
            : null;
        if (intentStack && intentStack.activeWindow === intent.sourceWindow) {
            return activateNestedWindow(intentStack, browserWindow, url);
        }
        const nested = intent?.type === 'root'
            ? null
            : getNestedStack(browserWindow, state);
        if (nested) {
            return activateNestedWindow(nested, browserWindow, url);
        }

        const scopeKey = resolveRootScope(url);
        const existing = stacks.get(scopeKey);
        if (existing && isUsableWindow(existing.activeWindow)) {
            return replaceRootWindow(existing, browserWindow, url);
        }
        if (existing) {
            destroyStack(existing);
        }
        return adoptRootWindow(browserWindow, url, scopeKey);
    }

    function takePreviousWindow(stack) {
        while (stack.history.length) {
            const browserWindow = stack.history.pop();
            if (isUsableWindow(browserWindow)) {
                return browserWindow;
            }
        }
        return null;
    }

    function returnToPreviousWindow(browserWindow, event, state) {
        const stack = getStackForWindow(browserWindow);
        if (state.forceClose || quitting || !isEnabled() || stack?.activeWindow !== browserWindow) {
            return false;
        }
        const previousWindow = takePreviousWindow(stack);
        if (!previousWindow) {
            return false;
        }
        event?.preventDefault?.();
        state.forceClose = true;
        copyNormalWindowBounds(browserWindow, previousWindow);
        suspendWindow(browserWindow);
        stack.activeWindow = previousWindow;
        stack.currentUrl = getWindowUrl(previousWindow);
        windowStacks.delete(browserWindow);
        showWindow(previousWindow);
        destroyWindow(browserWindow);
        emit('back', stack);
        return true;
    }

    function recoverAfterUnexpectedClose(browserWindow) {
        const stack = windowStacks.get(browserWindow);
        windowStacks.delete(browserWindow);
        if (!stack || stacks.get(stack.scopeKey) !== stack) {
            return;
        }
        const historyIndex = stack.history.indexOf(browserWindow);
        if (historyIndex >= 0) {
            stack.history.splice(historyIndex, 1);
        }
        if (browserWindow !== stack.activeWindow) {
            return;
        }
        if (!quitting && isEnabled()) {
            const previousWindow = takePreviousWindow(stack);
            if (previousWindow) {
                stack.activeWindow = previousWindow;
                stack.currentUrl = getWindowUrl(previousWindow);
                showWindow(previousWindow);
                emit('recovered', stack);
                return;
            }
        }
        stacks.delete(stack.scopeKey);
        if (currentStack === stack) {
            currentStack = null;
            selectCurrentStack();
        }
    }

    function install(browserWindow) {
        if (!isUsableWindow(browserWindow) || installedWindows.has(browserWindow)) {
            return false;
        }
        installedWindows.add(browserWindow);
        const focusedWindow = getFocusedWindow();
        let parentWindow = null;
        try {
            parentWindow = browserWindow.getParentWindow?.() || null;
        } catch {
        }
        const state = {
            opener: focusedWindow && focusedWindow !== browserWindow
                ? focusedWindow
                : parentWindow,
            forceClose: false,
            forward: false,
            suspended: false
        };
        windowStates.set(browserWindow, state);

        browserWindow.on?.('focus', () => {
            const stack = getStackForWindow(browserWindow);
            if (stack?.activeWindow === browserWindow) {
                touchStack(stack);
            }
        });
        browserWindow.on?.('ready-to-show', () => {
            const stack = getStackForWindow(browserWindow);
            if (stack?.activeWindow === browserWindow) {
                showWindow(browserWindow);
            }
        });
        browserWindow.webContents.on?.(
            'did-start-navigation',
            (_event, url, _isInPlace, isMainFrame) => {
                if (isMainFrame !== false) {
                    handleNavigation(browserWindow, url, state);
                }
            }
        );
        browserWindow.webContents.on?.(
            'did-navigate-in-page',
            (_event, url, isMainFrame) => {
                if (isMainFrame !== false) {
                    handleNavigation(browserWindow, url, state);
                }
            }
        );
        browserWindow.on?.('close', event =>
            returnToPreviousWindow(browserWindow, event, state)
        );
        browserWindow.on?.('closed', () => recoverAfterUnexpectedClose(browserWindow));

        const url = getWindowUrl(browserWindow);
        if (isForwardUrl(url)) {
            handleNavigation(browserWindow, url, state);
        }
        return true;
    }

    function release() {
        pendingOpenIntent = null;
        const releasedStacks = [...stacks.values()];
        stacks.clear();
        currentStack = null;
        for (const stack of releasedStacks) {
            for (const browserWindow of stack.history) {
                windowStacks.delete(browserWindow);
                destroyWindow(browserWindow);
            }
            const activeWindow = stack.activeWindow;
            windowStacks.delete(activeWindow);
            if (isUsableWindow(activeWindow)) {
                const state = getStateFor(activeWindow);
                if (state) {
                    state.suspended = false;
                }
                setTaskbarVisibility(activeWindow, true);
            }
        }
    }

    function sync(browserWindows = []) {
        const nextIsolationMode = isIsolationEnabled();
        if (!isEnabled()) {
            release();
            isolationMode = nextIsolationMode;
            return false;
        }
        if (isolationMode !== null && isolationMode !== nextIsolationMode) {
            release();
        }
        isolationMode = nextIsolationMode;

        for (const browserWindow of browserWindows) {
            install(browserWindow);
        }
        const focusedWindow = getFocusedWindow();
        const orderedWindows = [...browserWindows].sort((left, right) =>
            left === focusedWindow ? 1 : right === focusedWindow ? -1 : 0
        );
        for (const browserWindow of orderedWindows) {
            if (!isUsableWindow(browserWindow) || getStackForWindow(browserWindow)) {
                continue;
            }
            const state = getStateFor(browserWindow);
            const url = getWindowUrl(browserWindow);
            if (state && isForwardUrl(url)) {
                handleNavigation(browserWindow, url, state);
            }
        }
        return true;
    }

    function setQuitting(value = true) {
        quitting = value === true;
    }

    function serializeStack(stack) {
        return {
            scopeKey: stack.scopeKey,
            activeWindow: stack.activeWindow,
            currentUrl: stack.currentUrl,
            history: stack.history.slice(),
            depth: stack.activeWindow ? stack.history.length + 1 : 0
        };
    }

    function getState() {
        const stack = selectCurrentStack();
        return {
            ...(stack ? serializeStack(stack) : {
                scopeKey: '',
                activeWindow: null,
                currentUrl: '',
                history: [],
                depth: 0
            }),
            stackCount: stacks.size
        };
    }

    function getStates() {
        return [...stacks.values()]
            .sort((left, right) => left.lastUsed - right.lastUsed)
            .map(serializeStack);
    }

    return {
        getState,
        getStates,
        install,
        markOpenIntent,
        setQuitting,
        sync
    };
}

module.exports = {
    createSingleForwardWindowController,
    getForwardGroupScope
};
