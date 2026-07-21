const ROOT_ID = 'qqnt-toolbox-fake-forward-editor';
const STYLE_ID = 'qqnt-toolbox-fake-forward-style';
const ENTRY_CLASS = 'qqnt-toolbox-fake-forward-entry';
const MAX_MESSAGES = 100;
const MAX_TEXT_LENGTH = 10000;
const MAX_IMAGES_PER_MESSAGE = 20;
const NATIVE_TOOLTIP_DELAY = 500;
const IMAGE_FILE_PATTERN = /\.(?:apng|bmp|gif|jfif|jpe?g|png|webp)$/i;
const IMAGE_TOKEN_CLASS = 'qff-composer-image';
const TOOLBAR_SELECTORS = [
    '.chat-func-bar .func-bar-native',
    '.chat-func-bar__left .func-bar-native',
    '[class*="chat-func-bar"] [class*="func-bar-native"]'
];

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

function createButton(className, label, title = '') {
    const button = createElement('button', className, label);
    button.type = 'button';
    if (title) {
        button.title = title;
        button.setAttribute('aria-label', title);
    }
    return button;
}

function applyEntryGlyph(svg) {
    const namespace = 'http://www.w3.org/2000/svg';
    svg.replaceChildren();
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('qff-entry-icon');
    const paths = [
        'M13 5H7a4 4 0 0 0-4 4v11l4-3h8a4 4 0 0 0 4-4v-1',
        'M18 3v6',
        'M15 6h6'
    ];
    for (const data of paths) {
        const path = document.createElementNS(namespace, 'path');
        path.setAttribute('d', data);
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '1.6');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.append(path);
    }
    return svg;
}

function formatDateTimeLocal(timestamp = Date.now()) {
    const date = new Date(Number(timestamp) || Date.now());
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
}

function parseDateTimeLocal(value) {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function formatListTime(timestamp) {
    return new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(new Date(Number(timestamp) || Date.now()));
}

function avatarUrl(uin) {
    return 'https://q1.qlogo.cn/g?b=qq&nk=' + encodeURIComponent(uin) + '&s=100';
}

function localImageUrl(filePath) {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    const encoded = normalized.split('/').map(part =>
        encodeURIComponent(part).replace(/%3A/gi, ':')
    ).join('/');
    return 'local:///' + encoded;
}

function normalizeDraftSegments(source) {
    const rawSegments = Array.isArray(source?.segments)
        ? source.segments
        : [
            ...(String(source?.content || '') ? [{ type: 'text', text: String(source.content) }] : []),
            ...(Array.isArray(source?.images)
                ? source.images.map(image => ({ type: 'image', ...image }))
                : [])
        ];
    const segments = [];
    let imageCount = 0;
    let textLength = 0;
    for (const segment of rawSegments) {
        if (segment?.type === 'text') {
            const remaining = MAX_TEXT_LENGTH - textLength;
            const text = String(segment.text ?? '').slice(0, Math.max(0, remaining));
            if (!text) {
                continue;
            }
            textLength += text.length;
            const previous = segments.at(-1);
            if (previous?.type === 'text') {
                previous.text += text;
            } else {
                segments.push({ type: 'text', text });
            }
        } else if (segment?.type === 'image' && imageCount < MAX_IMAGES_PER_MESSAGE) {
            const image = {
                type: 'image',
                path: String(segment.path || ''),
                name: String(segment.name || '')
            };
            if (image.path) {
                segments.push(image);
                imageCount += 1;
            }
        }
    }
    return segments;
}

function messagePreview(message) {
    return normalizeDraftSegments(message).map(segment => segment.type === 'image'
        ? '[图片]'
        : segment.text
    ).join('').trim();
}

function isSupportedPeer(peer) {
    return [1, 2].includes(Number(peer?.chatType)) && Boolean(String(peer?.peerUid || '').trim());
}

function makeEntryId() {
    return globalThis.crypto?.randomUUID?.() ||
        String(Date.now()) + '-' + Math.random().toString(16).slice(2);
}

export function createFakeForwardEditor(options = {}) {
    const state = {
        messages: [],
        selectedId: '',
        sending: false,
        observer: null,
        refreshFrame: 0,
        installed: false,
        root: null,
        list: null,
        count: null,
        status: null,
        sendButton: null,
        draggedImage: null,
        objectUrls: new Set(),
        previousOverflow: '',
        fields: {}
    };

    function getStorageKey() {
        const scope = String(options.getStorageScope?.() || 'default').replace(/[^\w-]/g, '');
        return 'qqnt-toolbox-fake-forward-draft:' + (scope || 'default');
    }

    function loadDraft() {
        try {
            const value = JSON.parse(localStorage.getItem(getStorageKey()) || '[]');
            state.messages = Array.isArray(value)
                ? value.slice(0, MAX_MESSAGES).filter(item => item && typeof item === 'object').map(item => ({
                    id: String(item.id || makeEntryId()),
                    senderUin: String(item.senderUin || ''),
                    senderName: String(item.senderName || ''),
                    segments: normalizeDraftSegments(item),
                    timestamp: Number(item.timestamp) || Date.now()
                }))
                : [];
        } catch {
            state.messages = [];
        }
    }

    function saveDraft() {
        try {
            if (state.messages.length) {
                localStorage.setItem(getStorageKey(), JSON.stringify(state.messages));
            } else {
                localStorage.removeItem(getStorageKey());
            }
        } catch {
        }
    }

    function setStatus(message = '', kind = '') {
        if (!state.status) {
            return;
        }
        state.status.textContent = message;
        state.status.title = message;
        state.status.dataset.kind = kind;
    }

    function renderList() {
        if (!state.list) {
            return;
        }
        state.list.replaceChildren();
        state.count.textContent = String(state.messages.length) + '/' + MAX_MESSAGES;
        if (!state.messages.length) {
            state.list.append(createElement('li', 'qff-empty', '暂无消息'));
        } else {
            for (const message of state.messages) {
                const item = createElement('li');
                const button = createButton('qff-message', '');
                button.setAttribute('aria-selected', String(message.id === state.selectedId));
                const avatar = createElement('img', 'qff-avatar');
                avatar.alt = '';
                avatar.src = avatarUrl(message.senderUin);
                avatar.addEventListener('error', () => avatar.removeAttribute('src'), { once: true });
                const main = createElement('span', 'qff-message-main');
                const meta = createElement('span', 'qff-message-meta');
                meta.append(
                    createElement('span', 'qff-message-name', message.senderName || message.senderUin),
                    createElement('span', 'qff-message-time', formatListTime(message.timestamp))
                );
                main.append(meta, createElement('span', 'qff-message-text', messagePreview(message)));
                button.append(avatar, main);
                button.addEventListener('click', () => selectMessage(message.id));
                item.append(button);
                state.list.append(item);
            }
        }
        const index = state.messages.findIndex(item => item.id === state.selectedId);
        state.fields.moveUp.disabled = state.sending || index <= 0;
        state.fields.moveDown.disabled = state.sending || index < 0 || index >= state.messages.length - 1;
        state.fields.remove.disabled = state.sending || index < 0;
        state.sendButton.disabled = state.sending || state.messages.length === 0;
    }

    function appendTextSegment(segments, text) {
        if (!text) {
            return;
        }
        const previous = segments.at(-1);
        if (previous?.type === 'text') {
            previous.text += text;
        } else {
            segments.push({ type: 'text', text });
        }
    }

    function readComposerSegments() {
        const segments = [];
        function visit(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                appendTextSegment(segments, node.nodeValue || '');
                return;
            }
            if (!(node instanceof HTMLElement)) {
                return;
            }
            if (node.classList.contains(IMAGE_TOKEN_CLASS)) {
                segments.push({
                    type: 'image',
                    path: String(node.dataset.path || ''),
                    name: String(node.dataset.name || ''),
                    pending: node.dataset.pending === 'true'
                });
                return;
            }
            if (node.tagName === 'BR') {
                appendTextSegment(segments, '\n');
                return;
            }
            for (const child of node.childNodes) {
                visit(child);
            }
            if (/^(?:DIV|P|LI)$/.test(node.tagName) && node.nextSibling) {
                appendTextSegment(segments, '\n');
            }
        }
        for (const child of state.fields.composer.childNodes) {
            visit(child);
        }
        return segments;
    }

    function releaseImagePreview(token) {
        const url = token?.dataset?.objectUrl;
        if (!url) {
            return;
        }
        URL.revokeObjectURL(url);
        state.objectUrls.delete(url);
        delete token.dataset.objectUrl;
    }

    function removeComposerImage(token) {
        if (!token || state.sending) {
            return;
        }
        releaseImagePreview(token);
        token.remove();
        state.fields.composer.focus();
    }

    function createComposerImage(image, previewUrl = '') {
        const token = createElement('span', IMAGE_TOKEN_CLASS);
        token.contentEditable = 'false';
        token.draggable = true;
        token.dataset.path = String(image.path || '');
        token.dataset.name = String(image.name || '');
        token.dataset.pending = String(!image.path);
        token.title = image.name || image.path || '图片';
        const preview = createElement('img', 'qff-composer-image-preview');
        preview.alt = '';
        preview.draggable = false;
        preview.src = previewUrl || localImageUrl(image.path);
        const remove = createButton('qff-composer-image-remove', '×', '移除图片');
        remove.addEventListener('pointerdown', event => event.preventDefault());
        remove.addEventListener('click', () => removeComposerImage(token));
        token.addEventListener('dragstart', event => {
            if (state.sending) {
                event.preventDefault();
                return;
            }
            state.draggedImage = token;
            token.classList.add('qff-composer-image-dragging');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('application/x-qqnt-toolbox-image', 'move');
        });
        token.addEventListener('dragend', () => {
            token.classList.remove('qff-composer-image-dragging');
            state.draggedImage = null;
        });
        if (previewUrl) {
            token.dataset.objectUrl = previewUrl;
            state.objectUrls.add(previewUrl);
        }
        token.append(preview, remove);
        return token;
    }

    function renderComposer(segments = []) {
        for (const token of state.fields.composer.querySelectorAll('.' + IMAGE_TOKEN_CLASS)) {
            releaseImagePreview(token);
        }
        const nodes = [];
        for (const segment of normalizeDraftSegments({ segments })) {
            nodes.push(segment.type === 'image'
                ? createComposerImage(segment)
                : document.createTextNode(segment.text)
            );
        }
        state.fields.composer.replaceChildren(...nodes);
    }

    function getComposerRange() {
        const selection = window.getSelection();
        if (selection?.rangeCount) {
            const range = selection.getRangeAt(0);
            if (state.fields.composer.contains(range.commonAncestorContainer)) {
                return range.cloneRange();
            }
        }
        const range = document.createRange();
        range.selectNodeContents(state.fields.composer);
        range.collapse(false);
        return range;
    }

    function getDropRange(event) {
        const targetToken = event.target instanceof Element
            ? event.target.closest('.' + IMAGE_TOKEN_CLASS)
            : null;
        if (targetToken && state.fields.composer.contains(targetToken)) {
            const range = document.createRange();
            const before = event.clientX < targetToken.getBoundingClientRect().left + targetToken.offsetWidth / 2;
            range[before ? 'setStartBefore' : 'setStartAfter'](targetToken);
            range.collapse(true);
            return range;
        }
        const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY);
        if (caret && state.fields.composer.contains(caret.commonAncestorContainer)) {
            return caret;
        }
        return getComposerRange();
    }

    function selectAfter(node) {
        const range = document.createRange();
        range.setStartAfter(node);
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function insertText(text, range = getComposerRange()) {
        if (!text) {
            return;
        }
        const currentLength = readComposerSegments()
            .filter(segment => segment.type === 'text')
            .reduce((length, segment) => length + segment.text.length, 0);
        const value = String(text).slice(0, Math.max(0, MAX_TEXT_LENGTH - currentLength));
        if (!value) {
            setStatus('消息内容不能超过 ' + MAX_TEXT_LENGTH + ' 个字符', 'error');
            return;
        }
        range.deleteContents();
        const node = document.createTextNode(value);
        range.insertNode(node);
        selectAfter(node);
    }

    function isImageFile(file) {
        return file instanceof File &&
            (String(file.type || '').startsWith('image/') || IMAGE_FILE_PATTERN.test(file.name || ''));
    }

    function getImageFiles(dataTransfer) {
        const files = Array.from(dataTransfer?.files || []).filter(isImageFile);
        if (files.length) {
            return files;
        }
        return Array.from(dataTransfer?.items || [])
            .filter(item => item.kind === 'file')
            .map(item => item.getAsFile())
            .filter(isImageFile);
    }

    async function resolveComposerImage(file, token) {
        try {
            let image = {
                path: String(file.path || ''),
                name: String(file.name || '')
            };
            if (!image.path) {
                image = await options.stageImage?.({
                    name: file.name,
                    type: file.type,
                    data: await file.arrayBuffer()
                });
            }
            if (!image?.path) {
                throw new Error('无法读取图片文件');
            }
            if (!token.isConnected) {
                return;
            }
            token.dataset.path = String(image.path);
            token.dataset.name = String(image.name || file.name || '');
            token.dataset.pending = 'false';
            token.title = token.dataset.name || token.dataset.path;
            const preview = token.querySelector('.qff-composer-image-preview');
            preview.src = localImageUrl(token.dataset.path);
            releaseImagePreview(token);
        } catch (error) {
            removeComposerImage(token);
            setStatus(error?.message || '图片处理失败', 'error');
        }
    }

    function insertImageFiles(files, range = getComposerRange()) {
        const currentCount = state.fields.composer.querySelectorAll('.' + IMAGE_TOKEN_CLASS).length;
        const accepted = files.slice(0, Math.max(0, MAX_IMAGES_PER_MESSAGE - currentCount));
        if (!accepted.length) {
            setStatus('每条消息最多包含 ' + MAX_IMAGES_PER_MESSAGE + ' 张图片', 'error');
            return;
        }
        range.deleteContents();
        let lastToken = null;
        for (const file of accepted) {
            const previewUrl = URL.createObjectURL(file);
            const token = createComposerImage({ name: file.name }, previewUrl);
            range.insertNode(token);
            range.setStartAfter(token);
            range.collapse(true);
            lastToken = token;
            resolveComposerImage(file, token);
        }
        if (lastToken) {
            selectAfter(lastToken);
        }
    }

    function handleComposerPaste(event) {
        const files = getImageFiles(event.clipboardData);
        if (files.length) {
            event.preventDefault();
            insertImageFiles(files);
            return;
        }
        const text = event.clipboardData?.getData('text/plain');
        if (text !== undefined) {
            event.preventDefault();
            insertText(text);
        }
    }

    function handleComposerDrop(event) {
        if (state.sending) {
            return;
        }
        const range = getDropRange(event);
        if (state.draggedImage) {
            event.preventDefault();
            event.stopPropagation();
            const token = state.draggedImage;
            range.insertNode(token);
            selectAfter(token);
            return;
        }
        const files = getImageFiles(event.dataTransfer);
        if (files.length) {
            event.preventDefault();
            event.stopPropagation();
            insertImageFiles(files, range);
        }
    }

    function clearForm() {
        state.selectedId = '';
        state.fields.senderUin.value = '';
        state.fields.senderName.value = '';
        state.fields.timestamp.value = formatDateTimeLocal();
        renderComposer();
        state.fields.commit.textContent = '添加';
        state.fields.cancelEdit.hidden = true;
        setStatus();
        renderList();
    }

    function selectMessage(id) {
        const message = state.messages.find(item => item.id === id);
        if (!message) {
            clearForm();
            return;
        }
        state.selectedId = id;
        state.fields.senderUin.value = message.senderUin;
        state.fields.senderName.value = message.senderName;
        state.fields.timestamp.value = formatDateTimeLocal(message.timestamp);
        renderComposer(message.segments);
        state.fields.commit.textContent = '保存修改';
        state.fields.cancelEdit.hidden = false;
        setStatus();
        renderList();
    }

    function commitForm() {
        const senderUin = state.fields.senderUin.value.trim();
        const senderName = state.fields.senderName.value.trim() || senderUin;
        const segments = readComposerSegments();
        const textLength = segments.filter(segment => segment.type === 'text')
            .reduce((length, segment) => length + segment.text.length, 0);
        const images = segments.filter(segment => segment.type === 'image');
        if (!/^\d{5,20}$/.test(senderUin)) {
            setStatus('请输入有效的发送者 QQ 号', 'error');
            state.fields.senderUin.focus();
            return;
        }
        if (images.some(image => image.pending || !image.path)) {
            setStatus('图片正在处理，请稍候', 'error');
            return;
        }
        const hasText = segments.some(segment => segment.type === 'text' && segment.text.trim());
        if (!hasText && !images.length) {
            setStatus('请输入消息内容', 'error');
            state.fields.composer.focus();
            return;
        }
        if (textLength > MAX_TEXT_LENGTH) {
            setStatus('消息内容不能超过 ' + MAX_TEXT_LENGTH + ' 个字符', 'error');
            return;
        }
        const next = {
            id: state.selectedId || makeEntryId(),
            senderUin,
            senderName,
            segments: normalizeDraftSegments({ segments }),
            timestamp: parseDateTimeLocal(state.fields.timestamp.value)
        };
        const index = state.messages.findIndex(item => item.id === state.selectedId);
        if (index >= 0) {
            state.messages.splice(index, 1, next);
        } else if (state.messages.length < MAX_MESSAGES) {
            state.messages.push(next);
        } else {
            setStatus('一次最多生成 ' + MAX_MESSAGES + ' 条消息', 'error');
            return;
        }
        saveDraft();
        clearForm();
    }

    function moveSelected(offset) {
        const index = state.messages.findIndex(item => item.id === state.selectedId);
        const target = index + offset;
        if (index < 0 || target < 0 || target >= state.messages.length) {
            return;
        }
        [state.messages[index], state.messages[target]] = [state.messages[target], state.messages[index]];
        saveDraft();
        renderList();
    }

    function removeSelected() {
        const index = state.messages.findIndex(item => item.id === state.selectedId);
        if (index < 0) {
            return;
        }
        state.messages.splice(index, 1);
        saveDraft();
        clearForm();
    }

    function setSending(sending) {
        state.sending = sending;
        state.root?.querySelectorAll('input').forEach(control => {
            control.disabled = sending;
        });
        state.fields.composer.contentEditable = String(!sending);
        state.fields.composer.querySelectorAll('.qff-composer-image-remove').forEach(control => {
            control.disabled = sending;
        });
        state.fields.commit.disabled = sending;
        state.fields.cancelEdit.disabled = sending;
        state.sendButton.textContent = sending ? '发送中' : '发送';
        renderList();
    }

    function close(force = false) {
        if (!state.root || (state.sending && !force)) {
            return;
        }
        state.root.hidden = true;
        document.body.style.overflow = state.previousOverflow;
    }

    async function send() {
        const peer = options.getPeer?.();
        if (!isSupportedPeer(peer)) {
            setStatus('当前会话不支持伪造合并转发', 'error');
            return;
        }
        if (!state.messages.length || state.sending) {
            return;
        }
        setSending(true);
        setStatus('正在生成聊天记录');
        try {
            const result = await options.send?.({
                peer,
                messages: state.messages.map(message => ({
                    senderUin: message.senderUin,
                    senderName: message.senderName,
                    segments: normalizeDraftSegments(message),
                    timestamp: message.timestamp
                }))
            });
            if (result?.ok === false) {
                throw new Error(result.reason || '发送失败');
            }
            state.messages = [];
            saveDraft();
            clearForm();
            close(true);
        } catch (error) {
            setStatus(error?.message || '发送失败', 'error');
            options.onError?.(error);
        } finally {
            setSending(false);
        }
    }

    function createField(labelText, input) {
        const field = createElement('label', 'qff-field');
        field.append(createElement('span', 'qff-label', labelText), input);
        return field;
    }

    function ensureStylesheet() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        const link = createElement('link');
        link.id = STYLE_ID;
        link.rel = 'stylesheet';
        link.href = new URL('./fake-forward-editor.css', import.meta.url).href;
        document.head.append(link);
    }

    function ensureEditor() {
        if (state.root?.isConnected) {
            return;
        }
        ensureStylesheet();
        const root = createElement('div');
        root.id = ROOT_ID;
        root.hidden = true;
        const dialog = createElement('section', 'qff-dialog');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');

        const header = createElement('header', 'qff-header');
        const title = createElement('h2', 'qff-title', '伪造合并转发');
        const closeButton = createButton('qff-close', '×', '关闭');
        header.append(title, closeButton);

        const body = createElement('div', 'qff-body');
        const listPane = createElement('section', 'qff-list-pane');
        const listHeader = createElement('div', 'qff-list-header');
        state.count = createElement('span', 'qff-count');
        listHeader.append(createElement('span', 'qff-list-title', '消息'), state.count);
        state.list = createElement('ol', 'qff-list');
        const listActions = createElement('div', 'qff-list-actions');
        state.fields.moveUp = createButton('qff-icon-button', '↑', '上移');
        state.fields.moveDown = createButton('qff-icon-button', '↓', '下移');
        state.fields.remove = createButton('qff-icon-button', '×', '删除');
        listActions.append(state.fields.moveUp, state.fields.moveDown, state.fields.remove);
        listPane.append(listHeader, state.list, listActions);

        const form = createElement('form', 'qff-form');
        const fieldRow = createElement('div', 'qff-field-row');
        state.fields.senderUin = createElement('input', 'qff-input');
        state.fields.senderUin.type = 'text';
        state.fields.senderUin.inputMode = 'numeric';
        state.fields.senderUin.maxLength = 20;
        state.fields.senderUin.autocomplete = 'off';
        state.fields.senderName = createElement('input', 'qff-input');
        state.fields.senderName.type = 'text';
        state.fields.senderName.maxLength = 80;
        state.fields.senderName.autocomplete = 'off';
        fieldRow.append(
            createField('发送者 QQ', state.fields.senderUin),
            createField('显示昵称', state.fields.senderName)
        );
        state.fields.timestamp = createElement('input', 'qff-input');
        state.fields.timestamp.type = 'datetime-local';
        state.fields.composer = createElement('div', 'qff-composer');
        state.fields.composer.contentEditable = 'true';
        state.fields.composer.spellcheck = false;
        state.fields.composer.setAttribute('role', 'textbox');
        state.fields.composer.setAttribute('aria-label', '消息内容');
        state.fields.composer.setAttribute('aria-multiline', 'true');
        const formActions = createElement('div', 'qff-form-actions');
        state.fields.cancelEdit = createButton('qff-button', '取消编辑');
        state.fields.commit = createButton('qff-button qff-primary', '添加');
        state.fields.commit.type = 'submit';
        formActions.append(state.fields.cancelEdit, state.fields.commit);
        form.append(
            fieldRow,
            createField('时间', state.fields.timestamp),
            createField('消息内容', state.fields.composer),
            formActions
        );
        body.append(listPane, form);

        const footer = createElement('footer', 'qff-footer');
        state.status = createElement('span', 'qff-status');
        state.status.setAttribute('aria-live', 'polite');
        const footerActions = createElement('div', 'qff-footer-actions');
        const cancel = createButton('qff-button', '取消');
        state.sendButton = createButton('qff-button qff-primary', '发送');
        footerActions.append(cancel, state.sendButton);
        footer.append(state.status, footerActions);
        dialog.append(header, body, footer);
        root.append(dialog);
        document.body.append(root);
        state.root = root;

        closeButton.addEventListener('click', () => close());
        cancel.addEventListener('click', () => close());
        root.addEventListener('pointerdown', event => {
            if (event.target === root) {
                close();
            }
        });
        form.addEventListener('submit', event => {
            event.preventDefault();
            commitForm();
        });
        state.fields.cancelEdit.addEventListener('click', clearForm);
        state.fields.composer.addEventListener('beforeinput', event => {
            if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
                event.preventDefault();
                insertText('\n');
            }
        });
        state.fields.composer.addEventListener('paste', handleComposerPaste);
        state.fields.composer.addEventListener('dragover', event => {
            if (state.draggedImage || Array.from(event.dataTransfer?.types || []).includes('Files')) {
                event.preventDefault();
                event.dataTransfer.dropEffect = state.draggedImage ? 'move' : 'copy';
            }
        });
        state.fields.composer.addEventListener('drop', handleComposerDrop);
        state.fields.moveUp.addEventListener('click', () => moveSelected(-1));
        state.fields.moveDown.addEventListener('click', () => moveSelected(1));
        state.fields.remove.addEventListener('click', removeSelected);
        state.sendButton.addEventListener('click', send);
        renderList();
    }

    function open() {
        if (!options.getEnabled?.() || !isSupportedPeer(options.getPeer?.())) {
            return;
        }
        ensureEditor();
        loadDraft();
        clearForm();
        state.previousOverflow = document.body.style.overflow;
        state.root.hidden = false;
        document.body.style.overflow = 'hidden';
        state.fields.senderUin.focus();
    }

    function findToolbar() {
        for (const selector of TOOLBAR_SELECTORS) {
            const toolbar = document.querySelector(selector);
            if (toolbar) {
                return toolbar;
            }
        }
        return null;
    }

    function findNativeEntryTemplate(toolbar) {
        const entries = Array.from(toolbar?.children || []).filter(element =>
            !element.classList.contains(ENTRY_CLASS) &&
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
        return hide;
    }

    function cloneNativeEntry(template) {
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
        entry.classList.add(ENTRY_CLASS);
        entry.setAttribute('role', 'button');
        entry.tabIndex = 0;
        labelTarget.setAttribute('aria-label', '伪造转发');
        if (usesDataTitle) {
            labelTarget.setAttribute('data-title', '伪造转发');
        }
        applyEntryGlyph(glyph);
        attachNativeTooltip(entry, labelTarget);
        return entry;
    }

    function removeEntries() {
        document.querySelectorAll('.' + ENTRY_CLASS).forEach(element => element.remove());
    }

    function connectObserver() {
        if (state.observer) {
            return;
        }
        state.observer = new MutationObserver(scheduleSync);
        state.observer.observe(document.body, { childList: true, subtree: true });
    }

    function disconnectObserver() {
        state.observer?.disconnect();
        state.observer = null;
    }

    function sync() {
        const enabled = options.getEnabled?.() === true;
        if (!enabled) {
            disconnectObserver();
            removeEntries();
            close();
            return;
        }
        ensureStylesheet();
        connectObserver();
        const toolbar = findToolbar();
        const template = findNativeEntryTemplate(toolbar);
        const available = isSupportedPeer(options.getPeer?.()) &&
            Boolean(toolbar) &&
            Boolean(template);
        if (!available) {
            removeEntries();
            close();
            return;
        }
        if (toolbar.querySelector(':scope > .' + ENTRY_CLASS)) {
            return;
        }
        removeEntries();
        const entry = cloneNativeEntry(template);
        if (!entry) {
            return;
        }
        entry.addEventListener('pointerdown', event => {
            if (event.pointerType !== 'touch') {
                event.preventDefault();
            }
        });
        entry.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            open();
        });
        entry.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            open();
        });
        toolbar.append(entry);
    }

    function scheduleSync() {
        if (state.refreshFrame) {
            return;
        }
        state.refreshFrame = requestAnimationFrame(() => {
            state.refreshFrame = 0;
            sync();
        });
    }

    function handleKeydown(event) {
        if (event.key === 'Escape' && state.root && !state.root.hidden) {
            event.preventDefault();
            event.stopPropagation();
            close();
        }
    }

    function install() {
        if (state.installed) {
            return;
        }
        state.installed = true;
        document.addEventListener('keydown', handleKeydown, true);
        window.addEventListener('hashchange', scheduleSync);
        sync();
    }

    function destroy() {
        disconnectObserver();
        if (state.refreshFrame) {
            cancelAnimationFrame(state.refreshFrame);
        }
        document.removeEventListener('keydown', handleKeydown, true);
        window.removeEventListener('hashchange', scheduleSync);
        removeEntries();
        for (const url of state.objectUrls) {
            URL.revokeObjectURL(url);
        }
        state.objectUrls.clear();
        state.root?.remove();
        state.root = null;
        state.installed = false;
    }

    return { destroy, install, open, sync };
}
