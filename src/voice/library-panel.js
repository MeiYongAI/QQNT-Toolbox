'use strict';

function createVoiceLibraryPanel(options = {}) {
    const ROOT_ID = 'qqnt-toolbox-voice-library';
    const STYLE_ID = 'qqnt-toolbox-voice-library-style';
    const LIST_RENDER_OVERSCAN = 8;
    const LIST_RENDER_STEP = 8;
    const LIST_MIN_RENDER_COUNT = 24;
    const ESTIMATED_LIST_ROW_HEIGHT = 55;
    const ICON_PATHS = Object.freeze({
        folder: '<path d="M3 5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9L12 6h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
        fileAudio: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z"/><path d="M14 2v6h6"/><path d="M9 13v4M12 11v8M15 13v4"/>',
        more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
        chevronLeft: '<path d="m15 18-6-6 6-6"/>',
        refresh: '<path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5"/>',
        close: '<path d="M18 6 6 18M6 6l12 12"/>',
        send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
        play: '<path d="m6 3 14 9-14 9Z"/>',
        rename: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
        delete: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/>',
        folderPlus: '<path d="M3 5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9L12 6h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M12 10v6M9 13h6"/>',
        moveTo: '<path d="M3 5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9L12 6h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="m9 12 3 3 3-3M12 9v6"/>'
    });
    const TEXT = {
        title: '\u8bed\u97f3\u6d88\u606f',
        library: '\u8bed\u97f3\u5e93',
        empty: '\u6682\u65e0\u8bed\u97f3',
        folderEmpty: '\u8be5\u6587\u4ef6\u5939\u6682\u65e0\u8bed\u97f3',
        item: '\u8bed\u97f3',
        items: '\u9879',
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
        move: '\u79fb\u52a8',
        moveTo: '\u79fb\u52a8\u5230',
        newFolder: '\u65b0\u5efa\u6587\u4ef6\u5939',
        remove: '\u5220\u9664',
        more: '\u66f4\u591a\u64cd\u4f5c',
        sendSelected: '\u53d1\u9001\u9009\u4e2d\u7684\u8bed\u97f3',
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
        creatingFolder: '\u65b0\u5efa\u6587\u4ef6\u5939\u4e2d',
        moving: '\u79fb\u52a8\u4e2d',
        deleting: '\u5220\u9664\u4e2d',
        missing: '\u672a\u627e\u5230\u6761\u76ee',
        noMoveTarget: '\u6ca1\u6709\u53ef\u7528\u7684\u76ee\u6807\u6587\u4ef6\u5939',
        emptyName: '\u540d\u79f0\u4e0d\u80fd\u4e3a\u7a7a',
        deleteTitle: '\u5220\u9664\u8bed\u97f3',
        deleteMessage: '\u5220\u9664\u540e\u65e0\u6cd5\u6062\u590d\uff0c\u786e\u5b9a\u7ee7\u7eed\u5417\uff1f',
        deleteFolderTitle: '\u5220\u9664\u6587\u4ef6\u5939',
        deleteFolderMessage: '\u6587\u4ef6\u5939\u5185\u7684\u6240\u6709\u8bed\u97f3\u548c\u5b50\u6587\u4ef6\u5939\u90fd\u4f1a\u88ab\u5220\u9664\uff0c\u4e14\u65e0\u6cd5\u6062\u590d\u3002'
    };
    const state = {
        root: null,
        host: null,
        items: [],
        folders: [],
        folder: '',
        parent: '',
        busy: false,
        statusTimer: 0,
        windowBlurHandler: null,
        moved: false,
        position: null,
        renderedItemStart: 0,
        renderedItemEnd: 0,
        listRenderFrame: 0,
        finishDrag: null,
        dragging: false,
        pendingLibraryPayload: undefined,
        pendingLibraryFrame: 0,
        playingRow: null,
        selectedItemId: '',
        selectedItem: null
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

    function createIcon(name, className = '') {
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.classList.add('qvlib-icon');
        if (className) {
            icon.classList.add(className);
        }
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('fill', 'none');
        icon.setAttribute('stroke', 'currentColor');
        icon.setAttribute('stroke-width', '1.8');
        icon.setAttribute('stroke-linecap', 'round');
        icon.setAttribute('stroke-linejoin', 'round');
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = ICON_PATHS[name] || '';
        return icon;
    }

    function createIconButton(iconName, action, className, title) {
        const button = createButton('', action, className, title);
        button.append(createIcon(iconName));
        return button;
    }

    function createLabeledButton(iconName, label, action, className = '') {
        const button = createButton('', action, className, label);
        button.append(createIcon(iconName), createElement('span', '', label));
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

    function formatClockTime(seconds) {
        const value = Math.max(0, Math.floor(Number(seconds) || 0));
        const minutes = Math.floor(value / 60);
        const rest = value % 60;
        return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
    }

    function formatDuration(seconds) {
        const value = Math.ceil(Number(seconds) || 0);
        return value > 0 ? formatClockTime(value) : TEXT.unknown;
    }

    function formatPlayerTime(seconds) {
        return formatClockTime(seconds);
    }

    function getFolderTitle(folder = '') {
        const parts = String(folder || '').split('/').filter(Boolean);
        return parts[parts.length - 1] || TEXT.library;
    }

    function normalizeFolderPath(folder = '') {
        return String(folder || '')
            .replace(/\\/g, '/')
            .split('/')
            .filter(Boolean)
            .join('/');
    }

    function getParentFolder(folder = '') {
        const parts = normalizeFolderPath(folder).split('/').filter(Boolean);
        parts.pop();
        return parts.join('/');
    }

    function getFolderOptionLabel(folder = '') {
        const normalized = normalizeFolderPath(folder);
        return normalized ? `${TEXT.library} / ${normalized.split('/').join(' / ')}` : TEXT.library;
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
            if (action === 'sendSelected') {
                const item = state.selectedItem;
                button.disabled = state.busy || !item || item.kind === 'folder';
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
            if (state.busy) {
                closeItemMenu();
            }
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

    function closeItemMenu(restoreFocus = false) {
        if (!state.root) {
            return false;
        }
        const menu = state.root.querySelector('.qvlib-item-menu');
        if (!menu) {
            return false;
        }
        const triggerId = menu.dataset.triggerId || '';
        const row = menu.dataset.voiceItemId
            ? Array.from(state.root.querySelectorAll('.qvlib-row')).find(candidate =>
                candidate.dataset.voiceItemId === menu.dataset.voiceItemId
            )
            : null;
        const trigger = triggerId
            ? state.root.querySelector(`[data-menu-trigger-id="${triggerId}"]`)
            : null;
        menu.remove();
        state.root.querySelectorAll('.qvlib-more[aria-expanded="true"]').forEach(button => {
            button.setAttribute('aria-expanded', 'false');
        });
        if (restoreFocus) {
            trigger?.focus?.();
        }
        row?.classList.remove('is-menu-open');
        return true;
    }

    function releasePointerActionFocus() {
        const activeElement = document.activeElement;
        if (activeElement?.matches?.('.qvlib-more') && state.root?.contains(activeElement) &&
            !state.root.querySelector('.qvlib-item-menu')) {
            activeElement.blur?.();
        }
    }

    function setSelectedItem(itemId = '') {
        const item = getItem(itemId);
        state.selectedItem = item && item.kind !== 'folder'
            ? { ...item, parentPath: item.parentPath ?? state.folder }
            : null;
        state.selectedItemId = state.selectedItem ? String(state.selectedItem.id) : '';
        for (const row of state.root?.querySelectorAll('.qvlib-row') || []) {
            const selected = Boolean(state.selectedItemId) && row.dataset.voiceItemId === state.selectedItemId;
            if (row.classList.contains('is-file')) {
                row.querySelector('.qvlib-primary')?.setAttribute('aria-pressed', String(selected));
            }
        }
        syncPlayingRows();
        updateDisabledState();
    }

    function showItemMenu(itemId, anchor = null, point = null) {
        const shell = state.root?.querySelector('.qvlib-shell');
        const item = getItem(itemId);
        if (!shell || !item || state.busy) {
            return;
        }
        closeItemMenu();
        const menu = createElement('div', 'qvlib-item-menu');
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', `${item.title || TEXT.item} ${TEXT.more}`);
        menu.dataset.voiceItemId = String(item.id);
        const row = Array.from(state.root.querySelectorAll('.qvlib-row')).find(candidate =>
            candidate.dataset.voiceItemId === String(item.id)
        );
        row?.classList.add('is-menu-open');
        const menuTrigger = anchor?.matches?.('.qvlib-more')
            ? anchor
            : row?.querySelector('.qvlib-more');
        const triggerId = menuTrigger?.dataset?.menuTriggerId || '';
        if (triggerId) {
            menu.dataset.triggerId = triggerId;
            menuTrigger.setAttribute('aria-expanded', 'true');
        }
        const specs = item.kind === 'folder'
            ? [
                [TEXT.move, 'moveLibrary', 'moveTo', ''],
                [TEXT.rename, 'renameLibrary', 'rename', ''],
                [TEXT.remove, 'deleteLibrary', 'delete', 'qvlib-menu-delete']
            ]
            : [
                [TEXT.send, 'sendLibrary', 'send', ''],
                [TEXT.play, 'previewLibrary', 'play', ''],
                [TEXT.move, 'moveLibrary', 'moveTo', ''],
                [TEXT.rename, 'renameLibrary', 'rename', ''],
                [TEXT.remove, 'deleteLibrary', 'delete', 'qvlib-menu-delete']
            ];
        for (const [label, action, iconName, className] of specs) {
            const button = createLabeledButton(
                iconName,
                label,
                action,
                `qvlib-menu-item ${className}`.trim()
            );
            button.dataset.voiceItemId = item.id;
            button.setAttribute('role', 'menuitem');
            menu.append(button);
        }
        menu.addEventListener('keydown', event => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                return;
            }
            const entries = Array.from(menu.querySelectorAll('[role="menuitem"]'));
            const currentIndex = Math.max(0, entries.indexOf(document.activeElement));
            const nextIndex = event.key === 'Home'
                ? 0
                : event.key === 'End'
                    ? entries.length - 1
                    : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length;
            event.preventDefault();
            event.stopPropagation();
            entries[nextIndex]?.focus?.();
        });
        menu.addEventListener('focusout', () => {
            requestAnimationFrame(() => {
                if (!menu.isConnected || menu.contains(document.activeElement)) {
                    return;
                }
                const activeTrigger = menu.dataset.triggerId
                    ? state.root?.querySelector(`[data-menu-trigger-id="${menu.dataset.triggerId}"]`)
                    : null;
                if (document.activeElement !== activeTrigger) {
                    closeItemMenu();
                }
            });
        });
        shell.append(menu);
        const shellRect = shell.getBoundingClientRect();
        const anchorRect = anchor?.getBoundingClientRect?.() || null;
        const menuWidth = menu.offsetWidth || 132;
        const menuHeight = menu.offsetHeight || specs.length * 34 + 8;
        const margin = 8;
        const originLeft = point
            ? Number(point.clientX) - shellRect.left
            : Number(anchorRect?.right) - shellRect.left - menuWidth;
        let top = point
            ? Number(point.clientY) - shellRect.top
            : Number(anchorRect?.bottom) - shellRect.top + 4;
        const availableWidth = shell.clientWidth || shellRect.width;
        const availableHeight = shell.clientHeight || shellRect.height;
        const left = Math.min(
            Math.max(margin, availableWidth - menuWidth - margin),
            Math.max(margin, Number.isFinite(originLeft) ? originLeft : margin)
        );
        if (top + menuHeight > availableHeight - margin) {
            top = point
                ? Number(point.clientY) - shellRect.top - menuHeight
                : Number(anchorRect?.top) - shellRect.top - menuHeight - 4;
        }
        menu.style.left = `${left}px`;
        menu.style.top = `${Math.max(margin, top)}px`;
        menu.querySelector('[role="menuitem"]')?.focus?.();
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
        let select = null;
        if (dialogOptions.inputValue !== undefined) {
            input = createElement('input');
            input.value = dialogOptions.inputValue || '';
            input.maxLength = 80;
            form.append(input);
        }
        if (Array.isArray(dialogOptions.selectOptions)) {
            select = createElement('select');
            select.setAttribute('aria-label', dialogOptions.selectLabel || dialogOptions.title || '');
            for (const optionSpec of dialogOptions.selectOptions) {
                const option = createElement('option');
                option.value = String(optionSpec?.value ?? '');
                option.textContent = String(optionSpec?.label ?? option.value);
                select.append(option);
            }
            form.append(select);
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
            dialogOptions.onConfirm?.((input || select)?.value.trim() ?? '');
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
        const field = input || select;
        if (field) {
            field.focus();
            input?.select?.();
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
                emit({
                    type: 'renameLibrary',
                    id: item.id,
                    title: nextTitle,
                    selectedItemId: state.selectedItemId
                });
            }
        });
    }

    function showCreateFolderDialog() {
        showDialog({
            title: TEXT.newFolder,
            inputValue: '',
            onConfirm: title => {
                if (!title) {
                    setStatus(TEXT.emptyName, { error: true, resetAfterMs: 1600 });
                    return;
                }
                closeDialog();
                setStatus(TEXT.creatingFolder, { disabled: true });
                emit({ type: 'createLibraryFolder', title });
            }
        });
    }

    function showMoveDialog(item) {
        const sourcePath = normalizeFolderPath(item.relativePath || '');
        const currentParent = normalizeFolderPath(item.parentPath ?? state.folder);
        const folders = Array.from(new Set(state.folders.map(normalizeFolderPath)))
            .filter(folder => folder !== currentParent)
            .filter(folder => item.kind !== 'folder' || (
                folder !== sourcePath && !folder.startsWith(`${sourcePath}/`)
            ));
        if (!folders.length) {
            setStatus(TEXT.noMoveTarget, { error: true, resetAfterMs: 1800 });
            return;
        }
        showDialog({
            title: `${TEXT.moveTo} ${item.title || TEXT.item}`,
            selectLabel: TEXT.moveTo,
            selectOptions: folders.map(folder => ({
                value: folder,
                label: getFolderOptionLabel(folder)
            })),
            onConfirm: targetFolder => {
                closeDialog();
                setStatus(TEXT.moving, { disabled: true });
                emit({
                    type: 'moveLibrary',
                    id: item.id,
                    targetFolder,
                    selectedItemId: state.selectedItemId
                });
            }
        });
    }

    function selectionIsAffectedBy(item) {
        if (!state.selectedItem || !item) {
            return false;
        }
        if (String(state.selectedItem.id) === String(item.id)) {
            return true;
        }
        if (item.kind !== 'folder') {
            return false;
        }
        const folderPath = normalizeFolderPath(item.relativePath || '');
        const selectedPath = normalizeFolderPath(state.selectedItem.relativePath || '');
        return Boolean(folderPath && selectedPath.startsWith(`${folderPath}/`));
    }

    function showDeleteDialog(item) {
        const isFolder = item.kind === 'folder';
        showDialog({
            title: isFolder ? TEXT.deleteFolderTitle : TEXT.deleteTitle,
            message: `${item.title || TEXT.item}\n${isFolder ? TEXT.deleteFolderMessage : TEXT.deleteMessage}`,
            confirmText: TEXT.remove,
            danger: true,
            onConfirm: () => {
                closeDialog();
                if (selectionIsAffectedBy(item)) {
                    resetPlayer();
                    setSelectedItem('');
                }
                setStatus(TEXT.deleting, { disabled: true });
                emit({ type: 'deleteLibrary', id: item.id });
            }
        });
    }

    function isAudioPlaying(audio) {
        return Boolean(audio?.src && !audio.paused && !audio.ended);
    }

    function syncPlayingRows() {
        const audio = state.root?.querySelector('.qvlib-player audio');
        const isPlaying = isAudioPlaying(audio);
        let playingRow = null;
        if (isPlaying && state.selectedItemId) {
            const cachedRow = state.playingRow;
            playingRow = cachedRow?.isConnected &&
                cachedRow.dataset.voiceItemId === state.selectedItemId
                ? cachedRow
                : Array.from(state.root?.querySelectorAll('.qvlib-row.is-file') || [])
                    .find(row => row.dataset.voiceItemId === state.selectedItemId) || null;
        }
        if (state.playingRow && state.playingRow !== playingRow) {
            state.playingRow.classList.remove('is-playing');
        }
        playingRow?.classList.add('is-playing');
        state.playingRow = playingRow;
    }

    function syncPlayer() {
        const player = state.root?.querySelector('.qvlib-player');
        const audio = player?.querySelector('audio');
        const track = player?.querySelector('.qvlib-track');
        const time = player?.querySelector('.qvlib-player-time');
        const toggle = player?.querySelector('[data-voice-action="playerToggle"]');
        const send = player?.querySelector('[data-voice-action="sendSelected"]');
        if (!player || !audio || !track || !time || !toggle) {
            return;
        }
        const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
        const current = duration ? Math.min(audio.currentTime || 0, duration) : 0;
        const progress = duration ? Math.min(100, Math.max(0, current / duration * 100)) : 0;
        player.classList.toggle('is-ready', duration > 0);
        track.style.setProperty('--voice-progress', `${progress}%`);
        track.setAttribute('aria-valuenow', String(Math.round(progress)));
        const timeText = duration
            ? `${formatPlayerTime(current)} / ${formatPlayerTime(duration)}`
            : formatPlayerTime(0);
        track.setAttribute('aria-valuetext', timeText);
        time.textContent = timeText;
        const isPlaying = isAudioPlaying(audio);
        toggle.dataset.playing = String(isPlaying);
        toggle.title = isPlaying ? TEXT.pause : TEXT.play;
        toggle.setAttribute('aria-label', toggle.title);
        toggle.disabled = state.busy || !audio.src;
        if (send) {
            send.disabled = state.busy || !state.selectedItem || state.selectedItem.kind === 'folder';
        }
        syncPlayingRows();
    }

    function resetPlayer() {
        const player = state.root?.querySelector('.qvlib-player');
        const audio = player?.querySelector('audio');
        const title = player?.querySelector('.qvlib-player-title');
        if (!audio) {
            return;
        }
        audio.pause?.();
        audio.removeAttribute('src');
        audio.load?.();
        if (title) {
            title.textContent = TEXT.notPlaying;
        }
        syncPlayer();
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
        const time = createElement('div', 'qvlib-player-time', formatPlayerTime(0));
        const toggle = createButton('', 'playerToggle', 'qvlib-player-toggle', TEXT.play);
        toggle.dataset.playing = 'false';
        const send = createIconButton('send', 'sendSelected', 'qvlib-player-send', TEXT.sendSelected);
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
        player.append(title, time, toggle, track, send, audio);
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
        const back = createIconButton('chevronLeft', 'backFolder', 'qvlib-back', TEXT.back);
        const path = createElement('div', 'qvlib-path');
        path.append(
            createElement('div', 'qvlib-path-current', getFolderTitle(state.folder)),
            createElement('div', 'qvlib-path-parent', state.parent || TEXT.library)
        );
        nav.append(back, path);
    }

    function getItemMetaText(item) {
        if (item.kind === 'folder') {
            return `${Number(item.count) || 0} ${TEXT.items}`;
        }
        return formatDuration(item.duration);
    }

    function createListRow(item, itemIndex, playingItemId = '') {
        const isFolder = item.kind === 'folder';
        const row = createElement(
            'div',
            `qvlib-row ${isFolder ? 'is-folder' : 'is-file'}${item.kind === 'media' ? ' is-media' : ''}`
        );
        row.dataset.voiceItemId = item.id;
        row.dataset.voiceKind = isFolder ? 'folder' : 'file';
        row.dataset.voiceIndex = String(itemIndex);
        if (!isFolder && playingItemId === String(item.id)) {
            row.classList.add('is-playing');
        }
        row.setAttribute('role', 'listitem');
        const primary = createButton(
            '',
            isFolder ? 'openFolder' : 'previewLibrary',
            'qvlib-primary',
            `${isFolder ? TEXT.open : TEXT.play} ${item.title || TEXT.item}`
        );
        primary.dataset.voiceItemId = item.id;
        if (!isFolder) {
            primary.setAttribute('aria-pressed', String(state.selectedItemId === String(item.id)));
        }
        const icon = createElement('span', 'qvlib-item-icon');
        icon.append(createIcon(isFolder ? 'folder' : 'fileAudio'));
        if (!isFolder) {
            const playingIndicator = createElement('span', 'qvlib-playing-indicator');
            playingIndicator.setAttribute('aria-hidden', 'true');
            for (let index = 0; index < 4; index++) {
                playingIndicator.append(createElement('span', 'qvlib-playing-bar'));
            }
            icon.append(playingIndicator);
        }
        const main = createElement('div', 'qvlib-main');
        const name = createElement('div', 'qvlib-name', item.title || TEXT.item);
        name.title = item.title || TEXT.item;
        main.append(name, createElement('div', 'qvlib-meta', getItemMetaText(item)));
        primary.append(icon, main);
        const actions = createElement('div', 'qvlib-actions');
        const more = createIconButton('more', 'itemMenu', 'qvlib-more', TEXT.more);
        more.dataset.voiceItemId = item.id;
        more.dataset.menuTriggerId = `qvlib-menu-${String(item.id).replace(/[^a-z0-9_-]/gi, '-')}`;
        more.setAttribute('aria-haspopup', 'menu');
        more.setAttribute('aria-expanded', 'false');
        actions.append(more);
        row.append(primary, actions);
        return row;
    }

    function getListRenderRange(itemCount, scrollTop, clientHeight) {
        const count = Math.max(0, Math.trunc(Number(itemCount)) || 0);
        if (!count) {
            return { start: 0, end: 0 };
        }
        const top = Math.max(0, Number(scrollTop) || 0);
        const viewportHeight = Math.max(
            ESTIMATED_LIST_ROW_HEIGHT,
            Number(clientHeight) || 0
        );
        const firstVisible = Math.min(
            count - 1,
            Math.floor(top / ESTIMATED_LIST_ROW_HEIGHT)
        );
        const visibleEnd = Math.min(
            count,
            Math.max(
                firstVisible + 1,
                Math.ceil((top + viewportHeight) / ESTIMATED_LIST_ROW_HEIGHT)
            )
        );
        const unalignedStart = Math.max(0, firstVisible - LIST_RENDER_OVERSCAN);
        let start = Math.floor(unalignedStart / LIST_RENDER_STEP) * LIST_RENDER_STEP;
        const end = Math.min(
            count,
            Math.max(start + LIST_MIN_RENDER_COUNT, visibleEnd + LIST_RENDER_OVERSCAN)
        );
        if (end === count && end - start < LIST_MIN_RENDER_COUNT) {
            start = Math.max(0, end - LIST_MIN_RENDER_COUNT);
        }
        return { start, end };
    }

    function createListSpacer(className, rowCount) {
        const spacer = createElement('div', `qvlib-list-spacer ${className}`);
        spacer.setAttribute('aria-hidden', 'true');
        spacer.style.height = `${Math.max(0, rowCount) * ESTIMATED_LIST_ROW_HEIGHT}px`;
        return spacer;
    }

    function renderListWindow(targetScrollTop = null, force = false) {
        const list = state.root?.querySelector('.qvlib-list');
        if (!list || !state.items.length) {
            return;
        }
        const scrollTop = targetScrollTop === null
            ? list.scrollTop
            : Math.max(0, Number(targetScrollTop) || 0);
        const { start, end } = getListRenderRange(
            state.items.length,
            scrollTop,
            list.clientHeight
        );
        if (!force && start === state.renderedItemStart && end === state.renderedItemEnd) {
            return;
        }
        const audio = state.root?.querySelector('.qvlib-player audio');
        const playingItemId = isAudioPlaying(audio) ? state.selectedItemId : '';
        const fragment = document.createDocumentFragment();
        fragment.append(createListSpacer('qvlib-list-spacer-top', start));
        for (let index = start; index < end; index++) {
            fragment.append(createListRow(state.items[index], index, playingItemId));
        }
        fragment.append(createListSpacer(
            'qvlib-list-spacer-bottom',
            state.items.length - end
        ));
        list.replaceChildren(fragment);
        state.playingRow = null;
        state.renderedItemStart = start;
        state.renderedItemEnd = end;
        list.scrollTop = scrollTop;
        syncPlayingRows();
        updateDisabledState();
    }

    function cancelListWindowRender() {
        if (!state.listRenderFrame) {
            return;
        }
        cancelAnimationFrame(state.listRenderFrame);
        state.listRenderFrame = 0;
    }

    function handleListScroll() {
        closeItemMenu();
        if (state.listRenderFrame) {
            return;
        }
        state.listRenderFrame = requestAnimationFrame(() => {
            state.listRenderFrame = 0;
            renderListWindow();
        });
    }

    function renderList(resetScroll = false) {
        const list = state.root?.querySelector('.qvlib-list');
        const count = state.root?.querySelector('.qvlib-count');
        if (!list) {
            return;
        }
        closeItemMenu();
        cancelListWindowRender();
        const previousScrollTop = resetScroll ? 0 : list.scrollTop;
        if (count) {
            count.textContent = `${state.items.length} ${TEXT.items}`;
        }
        renderNavigation();
        list.replaceChildren();
        state.renderedItemStart = 0;
        state.renderedItemEnd = 0;
        if (!state.items.length) {
            list.append(createElement('div', 'qvlib-empty', state.folder ? TEXT.folderEmpty : TEXT.empty));
            return;
        }
        renderListWindow(previousScrollTop, true);
    }

    function updateLibraryItems(payload = {}) {
        if (!state.root || String(payload.folder || '') !== state.folder || !Array.isArray(payload.items)) {
            return false;
        }
        const durations = new Map();
        for (const item of payload.items) {
            const duration = Number(item?.duration) || 0;
            if (item?.id && duration > 0) {
                durations.set(String(item.id), duration);
            }
        }
        if (!durations.size) {
            return false;
        }
        let changed = false;
        for (const item of state.items) {
            const duration = durations.get(String(item.id));
            if (duration && Number(item.duration) !== duration) {
                item.duration = duration;
                changed = true;
            }
        }
        const selectedDuration = durations.get(state.selectedItemId);
        if (state.selectedItem && selectedDuration && Number(state.selectedItem.duration) !== selectedDuration) {
            state.selectedItem.duration = selectedDuration;
        }
        if (!changed) {
            return false;
        }
        for (const row of state.root.querySelectorAll('.qvlib-row[data-voice-item-id]')) {
            const item = getItem(row.dataset.voiceItemId);
            const meta = row.querySelector('.qvlib-meta');
            if (item && meta) {
                meta.textContent = getItemMetaText(item);
            }
        }
        return true;
    }

    function haveSameLibraryRows(previousItems, nextItems) {
        if (!Array.isArray(previousItems) || !Array.isArray(nextItems) ||
            previousItems.length !== nextItems.length) {
            return false;
        }
        return previousItems.every((previousItem, index) => {
            const nextItem = nextItems[index];
            return String(previousItem?.id || '') === String(nextItem?.id || '') &&
                String(previousItem?.kind || '') === String(nextItem?.kind || '') &&
                String(previousItem?.title || '') === String(nextItem?.title || '') &&
                normalizeFolderPath(previousItem?.relativePath || '') ===
                    normalizeFolderPath(nextItem?.relativePath || '') &&
                normalizeFolderPath(previousItem?.parentPath || '') ===
                    normalizeFolderPath(nextItem?.parentPath || '');
        });
    }

    function updateRenderedListMetadata() {
        const count = state.root?.querySelector('.qvlib-count');
        if (count) {
            const countText = `${state.items.length} ${TEXT.items}`;
            if (count.textContent !== countText) {
                count.textContent = countText;
            }
        }
        for (const row of state.root?.querySelectorAll('.qvlib-row[data-voice-item-id]') || []) {
            const indexedItem = state.items[Number(row.dataset.voiceIndex)];
            const item = String(indexedItem?.id || '') === row.dataset.voiceItemId
                ? indexedItem
                : getItem(row.dataset.voiceItemId);
            if (!item) {
                continue;
            }
            const isFolder = item.kind === 'folder';
            const itemTitle = item.title || TEXT.item;
            const name = row.querySelector('.qvlib-name');
            const meta = row.querySelector('.qvlib-meta');
            const primary = row.querySelector('.qvlib-primary');
            if (name && name.textContent !== itemTitle) {
                name.textContent = itemTitle;
            }
            if (name && name.title !== itemTitle) {
                name.title = itemTitle;
            }
            const metaText = getItemMetaText(item);
            if (meta && meta.textContent !== metaText) {
                meta.textContent = metaText;
            }
            if (primary) {
                const controlTitle = `${isFolder ? TEXT.open : TEXT.play} ${itemTitle}`;
                if (primary.title !== controlTitle) {
                    primary.title = controlTitle;
                    primary.setAttribute('aria-label', controlTitle);
                }
                if (!isFolder) {
                    primary.setAttribute('aria-pressed', String(state.selectedItemId === String(item.id)));
                }
            }
        }
        syncPlayingRows();
    }

    function applyLibraryPayload(payload) {
        const previousFolder = state.folder;
        const previousParent = state.parent;
        const previousItems = state.items;
        const hasSelectedItem = !Array.isArray(payload) &&
            Object.prototype.hasOwnProperty.call(payload || {}, 'selectedItem');
        if (Array.isArray(payload)) {
            state.items = payload;
            state.folders = [''];
            state.folder = '';
            state.parent = '';
        } else {
            state.items = Array.isArray(payload?.items) ? payload.items : [];
            if (Array.isArray(payload?.folders)) {
                state.folders = Array.from(new Set(payload.folders.map(normalizeFolderPath)));
                if (!state.folders.includes('')) {
                    state.folders.unshift('');
                }
            }
            state.folder = payload?.folder || '';
            state.parent = payload?.parent || '';
        }
        const canReuseRenderedRows = previousFolder === state.folder &&
            haveSameLibraryRows(previousItems, state.items);
        if (hasSelectedItem) {
            const selectedItem = payload?.selectedItem;
            if (selectedItem && selectedItem.kind !== 'folder') {
                state.selectedItem = { ...selectedItem };
                state.selectedItemId = String(selectedItem.id || '');
                const audio = state.root?.querySelector('.qvlib-player audio');
                const playerTitle = state.root?.querySelector('.qvlib-player-title');
                if (audio?.src && playerTitle) {
                    playerTitle.textContent = selectedItem.title || TEXT.item;
                }
            } else {
                resetPlayer();
                state.selectedItem = null;
                state.selectedItemId = '';
            }
        } else if (state.selectedItem) {
            const refreshedItem = getItem(state.selectedItemId);
            if (refreshedItem && refreshedItem.kind !== 'folder') {
                state.selectedItem = {
                    ...refreshedItem,
                    parentPath: refreshedItem.parentPath ?? state.folder
                };
            } else if (String(state.selectedItem.parentPath || '') === String(state.folder || '')) {
                resetPlayer();
                state.selectedItem = null;
                state.selectedItemId = '';
            }
        }
        if (canReuseRenderedRows) {
            if (previousParent !== state.parent) {
                renderNavigation();
            }
            updateRenderedListMetadata();
        } else {
            renderList(previousFolder !== state.folder);
        }
        updateDisabledState();
    }

    function schedulePendingLibraryFlush() {
        if (state.dragging || state.pendingLibraryFrame || state.pendingLibraryPayload === undefined) {
            return;
        }
        state.pendingLibraryFrame = requestAnimationFrame(() => {
            state.pendingLibraryFrame = 0;
            if (state.dragging || state.pendingLibraryPayload === undefined) {
                return;
            }
            const payload = state.pendingLibraryPayload;
            state.pendingLibraryPayload = undefined;
            applyLibraryPayload(payload);
        });
    }

    function setLibrary(payload) {
        if (state.dragging || state.pendingLibraryFrame) {
            state.pendingLibraryPayload = payload;
            schedulePendingLibraryFlush();
            return;
        }
        applyLibraryPayload(payload);
    }

    function playPreview(payload = {}) {
        const audio = state.root?.querySelector('audio');
        const title = state.root?.querySelector('.qvlib-player-title');
        if (!audio || !payload.previewUrl || String(payload.id || '') !== state.selectedItemId) {
            return;
        }
        if (title) {
            title.textContent = payload.previewTitle || TEXT.item;
        }
        audio.src = payload.previewUrl;
        audio.play?.().catch(() => {});
        syncPlayer();
    }

    function handleAction(action, itemId = '', control = null) {
        if (action === 'close') {
            close();
            return;
        }
        if (action === 'itemMenu') {
            const openMenu = state.root?.querySelector('.qvlib-item-menu');
            if (openMenu && openMenu.dataset.triggerId === control?.dataset?.menuTriggerId) {
                closeItemMenu(true);
            } else {
                showItemMenu(itemId, control);
            }
            return;
        }
        if (action === 'playerToggle') {
            const audio = state.root?.querySelector('audio');
            if (!audio?.src) {
                return;
            }
            if (isAudioPlaying(audio)) {
                audio.pause?.();
            } else {
                if (audio.ended) {
                    audio.currentTime = 0;
                }
                audio.play?.().catch(() => {});
            }
            syncPlayer();
            return;
        }
        closeItemMenu();
        if (action === 'createFolder') {
            showCreateFolderDialog();
            return;
        }
        let selectedActionItem = null;
        if (action === 'sendSelected') {
            action = 'sendLibrary';
            itemId = state.selectedItemId;
            selectedActionItem = state.selectedItem;
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
        const item = selectedActionItem || getItem(itemId);
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
            if (state.selectedItemId !== String(item.id)) {
                resetPlayer();
            }
            setSelectedItem(item.id);
            setStatus(TEXT.loading, { disabled: true });
            emit({ type: 'previewLibrary', id: item.id });
            return;
        }
        if (action === 'renameLibrary') {
            showRenameDialog(item);
            return;
        }
        if (action === 'moveLibrary') {
            showMoveDialog(item);
            return;
        }
        if (action === 'deleteLibrary') {
            showDeleteDialog(item);
        }
    }

    function getShellSize(shell, viewportWidth, viewportHeight) {
        return {
            width: shell.offsetWidth || Math.min(360, Math.max(0, viewportWidth - 16)),
            height: shell.offsetHeight || Math.min(400, Math.max(0, viewportHeight - 16))
        };
    }

    function setPosition(left, top) {
        const shell = state.root?.querySelector('.qvlib-shell');
        if (!state.root || !shell) {
            return null;
        }
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const { width, height } = getShellSize(shell, viewportWidth, viewportHeight);
        const margin = 8;
        const nextLeft = Number(left);
        const nextTop = Number(top);
        const position = {
            left: Math.min(
                Math.max(margin, viewportWidth - width - margin),
                Math.max(margin, Number.isFinite(nextLeft) ? nextLeft : margin)
            ),
            top: Math.min(
                Math.max(margin, viewportHeight - height - margin),
                Math.max(margin, Number.isFinite(nextTop) ? nextTop : margin)
            )
        };
        shell.style.left = `${position.left}px`;
        shell.style.top = `${position.top}px`;
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
        const shell = state.root.querySelector('.qvlib-shell');
        const { width, height } = getShellSize(shell, viewportWidth, viewportHeight);
        const left = state.moved && state.position
            ? state.position.left
            : (hostRect?.width > 0 ? hostRect.left + (hostRect.width - width) / 2 : (viewportWidth - width) / 2);
        const top = state.moved && state.position
            ? state.position.top
            : (hostRect?.height > 0 ? hostRect.top + (hostRect.height - height) / 2 : (viewportHeight - height) / 2);
        const position = setPosition(left, top);
        if (state.moved && position) {
            state.position = position;
        }
    }

    function installDrag(shell, header) {
        let dragState = null;
        let dragFrame = 0;

        const updateDragPosition = event => {
            if (!dragState || !Number.isFinite(event?.clientX) || !Number.isFinite(event?.clientY)) {
                return;
            }
            dragState.position = {
                left: Math.min(
                    dragState.maxLeft,
                    Math.max(dragState.margin, event.clientX - dragState.offsetX)
                ),
                top: Math.min(
                    dragState.maxTop,
                    Math.max(dragState.margin, event.clientY - dragState.offsetY)
                )
            };
        };

        const applyDragPosition = () => {
            dragFrame = 0;
            if (!dragState) {
                return;
            }
            shell.style.transform = `translate3d(${dragState.position.left - dragState.startLeft}px, ${dragState.position.top - dragState.startTop}px, 0)`;
        };

        const finish = event => {
            if (!dragState || (event?.pointerId !== undefined && dragState.pointerId !== event.pointerId)) {
                return;
            }
            if (event?.type !== 'lostpointercapture') {
                updateDragPosition(event);
            }
            const finishedDrag = dragState;
            dragState = null;
            if (dragFrame) {
                cancelAnimationFrame(dragFrame);
                dragFrame = 0;
            }
            if (header.hasPointerCapture?.(finishedDrag.pointerId)) {
                header.releasePointerCapture(finishedDrag.pointerId);
            }
            shell.style.left = `${finishedDrag.position.left}px`;
            shell.style.top = `${finishedDrag.position.top}px`;
            shell.style.transform = '';
            shell.classList.remove('is-dragging');
            state.dragging = false;
            state.position = { ...finishedDrag.position };
            state.moved = true;
            schedulePendingLibraryFlush();
        };

        header.addEventListener('pointerdown', event => {
            if (event.button !== 0 || event.target?.closest?.('button, [role="button"], input, select, textarea, a')) {
                return;
            }
            const rect = shell.getBoundingClientRect();
            const margin = 8;
            const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
            dragState = {
                pointerId: event.pointerId,
                offsetX: event.clientX - rect.left,
                offsetY: event.clientY - rect.top,
                startLeft: rect.left,
                startTop: rect.top,
                margin,
                maxLeft: Math.max(margin, viewportWidth - rect.width - margin),
                maxTop: Math.max(margin, viewportHeight - rect.height - margin),
                position: {
                    left: rect.left,
                    top: rect.top
                }
            };
            shell.classList.add('is-dragging');
            state.dragging = true;
            header.setPointerCapture?.(event.pointerId);
            event.preventDefault();
        });
        header.addEventListener('pointermove', event => {
            if (!dragState || dragState.pointerId !== event.pointerId) {
                return;
            }
            updateDragPosition(event);
            if (!dragFrame) {
                dragFrame = requestAnimationFrame(applyDragPosition);
            }
            event.preventDefault();
        });
        header.addEventListener('pointerup', finish);
        header.addEventListener('pointercancel', finish);
        header.addEventListener('lostpointercapture', finish);
        return finish;
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
        const createFolder = createIconButton('folderPlus', 'createFolder', 'qvlib-icon-button', TEXT.newFolder);
        const refresh = createIconButton('refresh', 'list', 'qvlib-icon-button', TEXT.refresh);
        const closeButton = createIconButton('close', 'close', 'qvlib-icon-button qvlib-close', TEXT.close);
        header.append(heading, createFolder, refresh, closeButton);
        const nav = createElement('div', 'qvlib-nav');
        nav.hidden = true;
        const listFrame = createElement('div', 'qvlib-list-frame');
        const list = createElement('div', 'qvlib-list qqnt-toolbox-scrollable');
        list.id = `${ROOT_ID}-list`;
        list.setAttribute('role', 'list');
        list.tabIndex = 0;
        list.addEventListener('scroll', handleListScroll, { passive: true });
        listFrame.append(list);
        const player = createPlayer();
        const footer = createElement('div', 'qvlib-footer');
        footer.append(
            createLabeledButton('send', TEXT.pick, 'pick'),
            createLabeledButton('folderPlus', TEXT.add, 'pickSave')
        );
        shell.append(header, nav, listFrame, player, footer);
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
            handleAction(
                control.dataset.voiceAction,
                control.dataset.voiceItemId || '',
                control
            );
        });
        root.addEventListener('pointerdown', event => {
            if (!event.target?.closest?.('.qvlib-item-menu, .qvlib-more')) {
                closeItemMenu();
            }
        }, true);
        root.addEventListener('pointerleave', () => {
            root.classList.add('is-pointer-outside');
            releasePointerActionFocus();
        });
        root.addEventListener('pointerenter', () => {
            root.classList.remove('is-pointer-outside');
        });
        root.addEventListener('pointercancel', releasePointerActionFocus, true);
        for (const eventName of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'wheel', 'dragover', 'drop']) {
            root.addEventListener(eventName, event => {
                if (event.target === root) {
                    event.preventDefault();
                }
                event.stopPropagation();
            });
        }
        root.addEventListener('contextmenu', event => {
            const row = event.target?.closest?.('.qvlib-row[data-voice-item-id]');
            if (row && root.contains(row)) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                const hasPointerPosition = Number.isFinite(event.clientX) && Number.isFinite(event.clientY) &&
                    (event.clientX !== 0 || event.clientY !== 0);
                const anchor = hasPointerPosition
                    ? null
                    : row.querySelector('.qvlib-more') || row.querySelector('.qvlib-primary');
                showItemMenu(row.dataset.voiceItemId, anchor, hasPointerPosition ? event : null);
                return;
            }
            event.preventDefault();
            event.stopPropagation();
        });
        state.finishDrag = installDrag(shell, header);
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
        state.windowBlurHandler = () => {
            state.finishDrag?.();
            state.root?.classList.add('is-pointer-outside');
            closeItemMenu();
            releasePointerActionFocus();
        };
        window.addEventListener('blur', state.windowBlurHandler);
        updatePlacement();
        renderList(true);
        syncPlayer();
        emit({ type: 'list' });
        return true;
    }

    function close() {
        clearTimeout(state.statusTimer);
        cancelListWindowRender();
        state.finishDrag?.();
        state.finishDrag = null;
        if (state.pendingLibraryFrame) {
            cancelAnimationFrame(state.pendingLibraryFrame);
            state.pendingLibraryFrame = 0;
        }
        state.pendingLibraryPayload = undefined;
        state.dragging = false;
        if (state.windowBlurHandler) {
            window.removeEventListener('blur', state.windowBlurHandler);
            state.windowBlurHandler = null;
        }
        const audio = state.root?.querySelector('audio');
        audio?.pause?.();
        state.root?.remove();
        state.root = null;
        state.host = null;
        state.busy = false;
        state.renderedItemStart = 0;
        state.renderedItemEnd = 0;
        state.playingRow = null;
        state.folders = [];
        state.selectedItemId = '';
        state.selectedItem = null;
    }

    function handleEscape() {
        if (!state.root) {
            return false;
        }
        if (state.root.querySelector('.qvlib-dialog-layer')) {
            closeDialog();
        } else if (closeItemMenu(true)) {
            return true;
        } else {
            close();
        }
        return true;
    }

    return {
        open,
        close,
        isOpen: () => Boolean(
            state.root?.isConnected && state.root.getClientRects().length > 0
        ),
        contains: target => Boolean(state.root?.contains(target)),
        updatePlacement,
        setStatus,
        setLibrary,
        updateLibraryItems,
        playPreview,
        handleEscape
    };
}

module.exports = createVoiceLibraryPanel;
