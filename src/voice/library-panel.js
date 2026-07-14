'use strict';

function createVoiceLibraryPanel(options = {}) {
    const ROOT_ID = 'qqnt-toolbox-voice-library';
    const STYLE_ID = 'qqnt-toolbox-voice-library-style';
    const TEXT = {
        title: '\u8bed\u97f3\u6d88\u606f',
        library: '\u8bed\u97f3\u5e93',
        empty: '\u6682\u65e0\u8bed\u97f3',
        folderEmpty: '\u8be5\u6587\u4ef6\u5939\u6682\u65e0\u8bed\u97f3',
        item: '\u8bed\u97f3',
        items: '\u9879',
        folder: '\u6587\u4ef6\u5939',
        pending: '\u5f85\u8f6c\u6362',
        duration: '\u65f6\u957f',
        unknown: '\u672a\u77e5',
        back: '\u8fd4\u56de',
        refresh: '\u5237\u65b0',
        pick: '\u9009\u62e9\u53d1\u9001',
        add: '\u6dfb\u52a0\u5230\u8bed\u97f3\u5e93',
        open: '\u6253\u5f00',
        send: '\u53d1\u9001',
        play: '\u64ad\u653e',
        pause: '\u6682\u505c',
        rename: '\u91cd\u547d\u540d',
        remove: '\u5220\u9664',
        close: '\u5173\u95ed',
        cancel: '\u53d6\u6d88',
        confirm: '\u786e\u5b9a',
        notPlaying: '\u672a\u64ad\u653e',
        progress: '\u64ad\u653e\u8fdb\u5ea6',
        choose: '\u9009\u62e9\u4e2d',
        refreshing: '\u5237\u65b0\u4e2d',
        sending: '\u53d1\u9001\u4e2d',
        converting: '\u4e34\u65f6\u8f6c\u6362\u5e76\u53d1\u9001\u4e2d',
        loading: '\u52a0\u8f7d\u64ad\u653e\u4e2d',
        renaming: '\u91cd\u547d\u540d\u4e2d',
        deleting: '\u5220\u9664\u4e2d',
        missing: '\u672a\u627e\u5230\u6761\u76ee',
        emptyName: '\u540d\u79f0\u4e0d\u80fd\u4e3a\u7a7a',
        deleteTitle: '\u5220\u9664\u8bed\u97f3',
        deleteMessage: '\u5220\u9664\u540e\u65e0\u6cd5\u6062\u590d\uff0c\u786e\u5b9a\u7ee7\u7eed\u5417\uff1f'
    };
    const state = {
        root: null,
        host: null,
        items: [],
        folder: '',
        parent: '',
        busy: false,
        statusTimer: 0,
        moved: false,
        position: null
    };

    function createElement(tagName, className = '', textContent) {
        const element = document.createElement(tagName);
        if (className) {
            element.className = className;
        }
        if (textContent !== undefined) {
            element.textContent = textContent;
        }
        return element;
    }

    function createButton(label, action, className = '', title = label) {
        const button = createElement('button', className, label);
        button.type = 'button';
        button.dataset.voiceAction = action;
        if (title) {
            button.title = title;
            button.setAttribute('aria-label', title);
        }
        return button;
    }

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = String(options.cssText || '').replaceAll('${ROOT_ID}', ROOT_ID);
        document.head.append(style);
    }

    function formatDuration(seconds) {
        const value = Math.ceil(Number(seconds) || 0);
        if (value <= 0) {
            return TEXT.unknown;
        }
        const minutes = Math.floor(value / 60);
        const rest = value % 60;
        return minutes > 0 ? `${minutes}:${String(rest).padStart(2, '0')}` : `${value}\u79d2`;
    }

    function formatPlayerTime(seconds) {
        const value = Math.max(0, Math.floor(Number(seconds) || 0));
        const minutes = Math.floor(value / 60);
        const rest = value % 60;
        return `${minutes}:${String(rest).padStart(2, '0')}`;
    }

    function getFolderTitle(folder = '') {
        const parts = String(folder || '').split('/').filter(Boolean);
        return parts[parts.length - 1] || TEXT.library;
    }

    function getItem(itemId) {
        return state.items.find(item => String(item.id) === String(itemId)) || null;
    }

    function emit(action) {
        options.onAction?.({
            ...action,
            folder: action.folder ?? state.folder
        });
    }

    function updateDisabledState() {
        if (!state.root) {
            return;
        }
        state.root.querySelectorAll('[data-voice-action]').forEach(button => {
            const action = button.dataset.voiceAction;
            if (action === 'close') {
                button.disabled = false;
                return;
            }
            if (action === 'playerToggle') {
                const audio = state.root.querySelector('audio');
                button.disabled = state.busy || !audio?.src;
                return;
            }
            button.disabled = state.busy;
        });
    }

    function setStatus(message = '', statusOptions = {}) {
        if (!state.root) {
            return;
        }
        if (Object.prototype.hasOwnProperty.call(statusOptions, 'disabled')) {
            state.busy = Boolean(statusOptions.disabled);
            updateDisabledState();
        }
        clearTimeout(state.statusTimer);
        let toast = state.root.querySelector('.qvlib-toast');
        if (!message) {
            toast?.classList.remove('is-visible');
            if (toast) {
                setTimeout(() => {
                    if (!toast.classList.contains('is-visible')) {
                        toast.remove();
                    }
                }, 160);
            }
            return;
        }
        if (!toast) {
            toast = createElement('div', 'qvlib-toast');
            state.root.querySelector('.qvlib-shell')?.append(toast);
        }
        toast.textContent = message;
        toast.classList.toggle('is-error', Boolean(statusOptions.error));
        requestAnimationFrame(() => toast.classList.add('is-visible'));
        if (statusOptions.resetAfterMs) {
            state.statusTimer = setTimeout(() => setStatus(''), statusOptions.resetAfterMs);
        }
    }

    function closeDialog() {
        state.root?.querySelector('.qvlib-dialog-layer')?.remove();
    }

    function showDialog(dialogOptions = {}) {
        const shell = state.root?.querySelector('.qvlib-shell');
        if (!shell) {
            return;
        }
        closeDialog();
        const layer = createElement('div', 'qvlib-dialog-layer');
        const form = createElement('form', 'qvlib-dialog');
        const title = createElement('div', 'qvlib-dialog-title', dialogOptions.title || '');
        form.append(title);
        if (dialogOptions.message) {
            form.append(createElement('div', 'qvlib-dialog-message', dialogOptions.message));
        }
        let input = null;
        if (dialogOptions.inputValue !== undefined) {
            input = createElement('input');
            input.value = dialogOptions.inputValue || '';
            input.maxLength = 80;
            form.append(input);
        }
        const actions = createElement('div', 'qvlib-dialog-actions');
        const cancel = createElement('button', '', TEXT.cancel);
        cancel.type = 'button';
        cancel.addEventListener('click', closeDialog);
        const confirm = createElement(
            'button',
            `qvlib-dialog-confirm${dialogOptions.danger ? ' is-danger' : ''}`,
            dialogOptions.confirmText || TEXT.confirm
        );
        confirm.type = 'submit';
        form.addEventListener('submit', event => {
            event.preventDefault();
            event.stopPropagation();
            dialogOptions.onConfirm?.(input?.value.trim() ?? '');
        });
        actions.append(cancel, confirm);
        form.append(actions);
        layer.append(form);
        layer.addEventListener('pointerdown', event => {
            if (event.target === layer) {
                closeDialog();
            }
        });
        shell.append(layer);
        if (input) {
            input.focus();
            input.select?.();
        } else {
            cancel.focus();
        }
    }

    function showRenameDialog(item) {
        showDialog({
            title: TEXT.rename,
            inputValue: item.title || '',
            onConfirm: nextTitle => {
                if (!nextTitle) {
                    setStatus(TEXT.emptyName, { error: true, resetAfterMs: 1600 });
                    return;
                }
                closeDialog();
                setStatus(TEXT.renaming, { disabled: true });
                emit({ type: 'renameLibrary', id: item.id, title: nextTitle });
            }
        });
    }

    function showDeleteDialog(item) {
        showDialog({
            title: TEXT.deleteTitle,
            message: `${item.title || TEXT.item}\n${TEXT.deleteMessage}`,
            confirmText: TEXT.remove,
            danger: true,
            onConfirm: () => {
                closeDialog();
                setStatus(TEXT.deleting, { disabled: true });
                emit({ type: 'deleteLibrary', id: item.id });
            }
        });
    }

    function syncPlayer() {
        const player = state.root?.querySelector('.qvlib-player');
        const audio = player?.querySelector('audio');
        const track = player?.querySelector('.qvlib-track');
        const time = player?.querySelector('.qvlib-player-time');
        const toggle = player?.querySelector('[data-voice-action="playerToggle"]');
        if (!player || !audio || !track || !time || !toggle) {
            return;
        }
        const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
        const current = duration ? Math.min(audio.currentTime || 0, duration) : 0;
        const progress = duration ? Math.min(100, Math.max(0, current / duration * 100)) : 0;
        player.classList.toggle('is-ready', duration > 0);
        track.style.setProperty('--voice-progress', `${progress}%`);
        track.setAttribute('aria-valuenow', String(Math.round(progress)));
        track.setAttribute('aria-valuetext', duration ? `${formatPlayerTime(current)} / ${formatPlayerTime(duration)}` : '0:00');
        time.textContent = duration ? `${formatPlayerTime(current)} / ${formatPlayerTime(duration)}` : '0:00';
        toggle.dataset.playing = String(!audio.paused);
        toggle.title = audio.paused ? TEXT.play : TEXT.pause;
        toggle.setAttribute('aria-label', toggle.title);
        updateDisabledState();
    }

    function seekPlayer(event) {
        const player = state.root?.querySelector('.qvlib-player');
        const audio = player?.querySelector('audio');
        const track = player?.querySelector('.qvlib-track');
        const duration = Number.isFinite(audio?.duration) && audio.duration > 0 ? audio.duration : 0;
        const rect = track?.getBoundingClientRect?.();
        if (!audio || !track || !duration || !rect?.width) {
            return;
        }
        const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        audio.currentTime = duration * ratio;
        syncPlayer();
    }

    function createPlayer() {
        const player = createElement('div', 'qvlib-player');
        const title = createElement('div', 'qvlib-player-title', TEXT.notPlaying);
        const time = createElement('div', 'qvlib-player-time', '0:00');
        const toggle = createButton('', 'playerToggle', 'qvlib-player-toggle', TEXT.play);
        toggle.dataset.playing = 'false';
        const track = createElement('div', 'qvlib-track');
        track.setAttribute('role', 'slider');
        track.setAttribute('aria-label', TEXT.progress);
        track.setAttribute('aria-valuemin', '0');
        track.setAttribute('aria-valuemax', '100');
        track.tabIndex = 0;
        const progress = createElement('div', 'qvlib-progress');
        const thumb = createElement('div', 'qvlib-thumb');
        const audio = document.createElement('audio');
        audio.preload = 'metadata';
        track.append(progress, thumb);
        player.append(title, time, toggle, track, audio);
        for (const eventName of ['loadedmetadata', 'timeupdate', 'play', 'pause', 'ended']) {
            audio.addEventListener(eventName, syncPlayer);
        }
        track.addEventListener('pointerdown', event => {
            event.preventDefault();
            track.setPointerCapture?.(event.pointerId);
            seekPlayer(event);
        });
        track.addEventListener('pointermove', event => {
            if (event.buttons === 1) {
                seekPlayer(event);
            }
        });
        track.addEventListener('pointerup', event => {
            if (track.hasPointerCapture?.(event.pointerId)) {
                track.releasePointerCapture(event.pointerId);
            }
            syncPlayer();
        });
        track.addEventListener('keydown', event => {
            if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
                return;
            }
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                return;
            }
            event.preventDefault();
            if (event.key === 'Home') {
                audio.currentTime = 0;
            } else if (event.key === 'End') {
                audio.currentTime = audio.duration;
            } else {
                audio.currentTime = Math.min(
                    audio.duration,
                    Math.max(0, audio.currentTime + (event.key === 'ArrowRight' ? 5 : -5))
                );
            }
            syncPlayer();
        });
        return player;
    }

    function renderNavigation() {
        const nav = state.root?.querySelector('.qvlib-nav');
        if (!nav) {
            return;
        }
        nav.hidden = !state.folder;
        nav.replaceChildren();
        if (!state.folder) {
            return;
        }
        const back = createButton('\u2190', 'backFolder', 'qvlib-back', TEXT.back);
        const path = createElement('div', 'qvlib-path');
        path.append(
            createElement('div', 'qvlib-path-current', getFolderTitle(state.folder)),
            createElement('div', 'qvlib-path-parent', state.parent || TEXT.library)
        );
        nav.append(back, path);
    }

    function renderList(resetScroll = false) {
        const list = state.root?.querySelector('.qvlib-list');
        const count = state.root?.querySelector('.qvlib-count');
        if (!list) {
            return;
        }
        if (count) {
            count.textContent = `${state.items.length} ${TEXT.items}`;
        }
        renderNavigation();
        list.replaceChildren();
        if (!state.items.length) {
            list.append(createElement('div', 'qvlib-empty', state.folder ? TEXT.folderEmpty : TEXT.empty));
            return;
        }
        for (const item of state.items) {
            const row = createElement('div', 'qvlib-row');
            const main = createElement('div', 'qvlib-main');
            const name = createElement('div', 'qvlib-name', item.title || TEXT.item);
            name.title = item.title || TEXT.item;
            let metaText = '';
            if (item.kind === 'folder') {
                metaText = `${TEXT.folder} \u00b7 ${Number(item.count) || 0} ${TEXT.items}`;
            } else if (item.kind === 'media') {
                metaText = `${TEXT.pending} \u00b7 ${TEXT.duration}\uff1a${formatDuration(item.duration)}`;
            } else {
                metaText = `${TEXT.duration}\uff1a${formatDuration(item.duration)}`;
            }
            main.append(name, createElement('div', 'qvlib-meta', metaText));
            const actions = createElement('div', 'qvlib-actions');
            const specs = item.kind === 'folder'
                ? [
                    [TEXT.open, 'openFolder', ''],
                    [TEXT.rename, 'renameLibrary', '']
                ]
                : [
                    [TEXT.send, 'sendLibrary', 'qvlib-send'],
                    [TEXT.play, 'previewLibrary', ''],
                    [TEXT.rename, 'renameLibrary', ''],
                    [TEXT.remove, 'deleteLibrary', 'qvlib-delete']
                ];
            for (const [label, action, className] of specs) {
                const button = createButton(label, action, `qvlib-row-action ${className}`.trim());
                button.dataset.voiceItemId = item.id;
                actions.append(button);
            }
            row.append(main, actions);
            list.append(row);
        }
        if (resetScroll) {
            list.scrollTop = 0;
        }
        updateDisabledState();
    }

    function setLibrary(payload) {
        const previousFolder = state.folder;
        if (Array.isArray(payload)) {
            state.items = payload;
            state.folder = '';
            state.parent = '';
        } else {
            state.items = Array.isArray(payload?.items) ? payload.items : [];
            state.folder = payload?.folder || '';
            state.parent = payload?.parent || '';
        }
        renderList(previousFolder !== state.folder);
    }

    function playPreview(payload = {}) {
        const audio = state.root?.querySelector('audio');
        const title = state.root?.querySelector('.qvlib-player-title');
        if (!audio || !payload.previewUrl) {
            return;
        }
        if (title) {
            title.textContent = payload.previewTitle || TEXT.item;
        }
        audio.src = payload.previewUrl;
        audio.play?.().catch(() => {});
        syncPlayer();
    }

    function handleAction(action, itemId = '') {
        if (action === 'close') {
            close();
            return;
        }
        if (action === 'playerToggle') {
            const audio = state.root?.querySelector('audio');
            if (!audio?.src) {
                return;
            }
            if (audio.paused) {
                audio.play?.().catch(() => {});
            } else {
                audio.pause?.();
            }
            syncPlayer();
            return;
        }
        if (action === 'backFolder') {
            const folder = state.parent || '';
            setStatus(TEXT.refreshing, { disabled: true });
            emit({ type: 'list', folder });
            return;
        }
        if (action === 'list' || action === 'pick' || action === 'pickSave') {
            setStatus(action === 'list' ? TEXT.refreshing : TEXT.choose, { disabled: true });
            emit({ type: action });
            return;
        }
        const item = getItem(itemId);
        if (!item) {
            setStatus(TEXT.missing, { error: true, resetAfterMs: 1600 });
            return;
        }
        if (action === 'openFolder') {
            setStatus(TEXT.refreshing, { disabled: true });
            emit({ type: 'list', folder: item.relativePath || '' });
            return;
        }
        if (action === 'sendLibrary') {
            setStatus(item.kind === 'media' ? TEXT.converting : TEXT.sending, { disabled: true });
            emit({ type: 'sendLibrary', id: item.id });
            return;
        }
        if (action === 'previewLibrary') {
            setStatus(TEXT.loading, { disabled: true });
            emit({ type: 'previewLibrary', id: item.id });
            return;
        }
        if (action === 'renameLibrary') {
            showRenameDialog(item);
            return;
        }
        if (action === 'deleteLibrary') {
            showDeleteDialog(item);
        }
    }

    function setPosition(left, top, remember = false) {
        const shell = state.root?.querySelector('.qvlib-shell');
        if (!state.root || !shell) {
            return null;
        }
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const width = shell.offsetWidth || Math.min(360, Math.max(0, viewportWidth - 24));
        const height = shell.offsetHeight || Math.min(400, Math.max(0, viewportHeight - 24));
        const margin = 12;
        const minLeft = margin + width / 2;
        const maxLeft = Math.max(minLeft, viewportWidth - margin - width / 2);
        const minTop = margin + height / 2;
        const maxTop = Math.max(minTop, viewportHeight - margin - height / 2);
        const position = {
            left: Math.round(Math.min(maxLeft, Math.max(minLeft, Number(left) || viewportWidth / 2))),
            top: Math.round(Math.min(maxTop, Math.max(minTop, Number(top) || viewportHeight / 2)))
        };
        state.root.style.setProperty('--voice-left', `${position.left}px`);
        state.root.style.setProperty('--voice-top', `${position.top}px`);
        if (remember) {
            state.position = position;
            state.moved = true;
        }
        return position;
    }

    function updatePlacement() {
        if (!state.root) {
            return;
        }
        if (!state.host?.isConnected) {
            state.host = options.resolveHost?.() || null;
        }
        const hostRect = state.host?.getBoundingClientRect?.();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const left = state.moved && state.position
            ? state.position.left
            : (hostRect?.width > 0 ? hostRect.left + hostRect.width / 2 : viewportWidth / 2);
        const top = state.moved && state.position
            ? state.position.top
            : (hostRect?.height > 0 ? hostRect.top + hostRect.height / 2 : viewportHeight / 2);
        const position = setPosition(left, top);
        if (state.moved && position) {
            state.position = position;
        }
    }

    function installDrag(shell, header) {
        let dragState = null;
        const finish = event => {
            if (!dragState || dragState.pointerId !== event.pointerId) {
                return;
            }
            if (header.hasPointerCapture?.(event.pointerId)) {
                header.releasePointerCapture(event.pointerId);
            }
            dragState = null;
            shell.classList.remove('is-dragging');
        };
        header.addEventListener('pointerdown', event => {
            if (event.button !== 0 || event.target?.closest?.('button,input,a')) {
                return;
            }
            const rect = shell.getBoundingClientRect();
            dragState = {
                pointerId: event.pointerId,
                offsetX: event.clientX - (rect.left + rect.width / 2),
                offsetY: event.clientY - (rect.top + rect.height / 2)
            };
            header.setPointerCapture?.(event.pointerId);
            shell.classList.add('is-dragging');
            event.preventDefault();
        });
        header.addEventListener('pointermove', event => {
            if (!dragState || dragState.pointerId !== event.pointerId) {
                return;
            }
            setPosition(
                event.clientX - dragState.offsetX,
                event.clientY - dragState.offsetY,
                true
            );
        });
        header.addEventListener('pointerup', finish);
        header.addEventListener('pointercancel', finish);
    }

    function buildPanel() {
        const root = createElement('div');
        root.id = ROOT_ID;
        const shell = createElement('div', 'qvlib-shell');
        const header = createElement('div', 'qvlib-header');
        const heading = createElement('div', 'qvlib-heading');
        heading.append(
            createElement('div', 'qvlib-title', TEXT.title),
            createElement('div', 'qvlib-count', `0 ${TEXT.items}`)
        );
        const refresh = createButton('\u21bb', 'list', 'qvlib-icon-button', TEXT.refresh);
        const closeButton = createButton('\u00d7', 'close', 'qvlib-icon-button qvlib-close', TEXT.close);
        header.append(heading, refresh, closeButton);
        const nav = createElement('div', 'qvlib-nav');
        nav.hidden = true;
        const list = createElement('div', 'qvlib-list');
        const player = createPlayer();
        const footer = createElement('div', 'qvlib-footer');
        footer.append(
            createButton(TEXT.pick, 'pick'),
            createButton(TEXT.add, 'pickSave')
        );
        shell.append(header, nav, list, player, footer);
        root.append(shell);
        root.addEventListener('click', event => {
            const control = event.target?.closest?.('[data-voice-action]');
            if (!control || !root.contains(control)) {
                event.stopPropagation();
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            handleAction(control.dataset.voiceAction, control.dataset.voiceItemId || '');
        });
        for (const eventName of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'wheel', 'dragover', 'drop']) {
            root.addEventListener(eventName, event => {
                if (event.target === root) {
                    event.preventDefault();
                }
                event.stopPropagation();
            });
        }
        root.addEventListener('contextmenu', event => {
            event.preventDefault();
            event.stopPropagation();
        });
        installDrag(shell, header);
        return root;
    }

    function open() {
        ensureStyle();
        const host = options.resolveHost?.();
        if (!host) {
            return false;
        }
        close();
        state.host = host;
        state.root = buildPanel();
        document.body.append(state.root);
        updatePlacement();
        renderList(true);
        syncPlayer();
        emit({ type: 'list' });
        return true;
    }

    function close() {
        clearTimeout(state.statusTimer);
        const audio = state.root?.querySelector('audio');
        audio?.pause?.();
        state.root?.remove();
        state.root = null;
        state.host = null;
        state.busy = false;
    }

    function handleEscape() {
        if (!state.root) {
            return false;
        }
        if (state.root.querySelector('.qvlib-dialog-layer')) {
            closeDialog();
        } else {
            close();
        }
        return true;
    }

    return {
        open,
        close,
        isOpen: () => Boolean(state.root),
        contains: target => Boolean(state.root?.contains(target)),
        updatePlacement,
        setStatus,
        setLibrary,
        playPreview,
        handleEscape
    };
}

module.exports = createVoiceLibraryPanel;
