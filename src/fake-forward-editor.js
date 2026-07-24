import {
    bindNativeChatToolbarAction,
    createNativeChatToolbarEntry,
    findNativeChatToolbar
} from './chat-toolbar-entry.js';

const ROOT_ID = 'qqnt-toolbox-fake-forward-editor';
const STYLE_ID = 'qqnt-toolbox-fake-forward-style';
const ENTRY_CLASS = 'qqnt-toolbox-fake-forward-entry';
const MAX_MESSAGES = 100;
const MAX_TEXT_LENGTH = 10000;
const MAX_IMAGES_PER_MESSAGE = 20;
const IMAGE_FILE_PATTERN = /\.(?:apng|bmp|gif|jfif|jpe?g|png|webp)$/i;
const VIDEO_FILE_PATTERN = /\.(?:3g2|3gp|asf|avi|flv|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|mts|ogv|ts|vob|webm|wmv)$/i;
const IMAGE_TOKEN_CLASS = 'qff-composer-image';
const ATTACHMENT_TOKEN_CLASS = 'qff-composer-attachment';
const COMPOSER_BLOCK_TAGS = new Set(['DIV', 'P', 'LI']);

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

function formatDateTimeParts(timestamp = Date.now()) {
    const date = new Date(Number(timestamp) || Date.now());
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    const value = local.toISOString();
    return {
        date: value.slice(0, 10),
        time: value.slice(11, 16)
    };
}

function parseDateTimeParts(date, time) {
    const timestamp = new Date(String(date || '') + 'T' + String(time || '')).getTime();
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

function inferColorScheme(color) {
    const match = String(color || '').match(/^rgba?\(\s*(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/i);
    if (!match) {
        return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    const brightness = Number(match[1]) * 0.299 + Number(match[2]) * 0.587 + Number(match[3]) * 0.114;
    return brightness >= 160 ? 'dark' : 'light';
}

function removeTrailingMediaPlaceholderBreaks(segments) {
    if (!segments.some(segment => ['image', 'video', 'file'].includes(segment?.type))) {
        return segments;
    }
    const trailing = segments.at(-1);
    if (trailing?.type !== 'text' || !/[\r\n]/.test(trailing.text)) {
        return segments;
    }
    trailing.text = trailing.text.replace(/(?:\r?\n)+[ \t]*$/, '');
    if (!trailing.text.trim()) {
        segments.pop();
    }
    return segments;
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
        } else if (segment?.type === 'video' || segment?.type === 'file') {
            const media = {
                type: segment.type,
                path: String(segment.path || ''),
                name: String(segment.name || ''),
                size: Math.max(0, Number(segment.size) || 0)
            };
            if (media.path) {
                segments.push(media);
            }
        }
    }
    removeTrailingMediaPlaceholderBreaks(segments);
    const standalone = segments.filter(segment => segment.type === 'video' || segment.type === 'file');
    if (standalone.length && (standalone.length !== 1 || segments.length !== 1)) {
        return [];
    }
    return segments;
}

export function readFakeForwardComposerSegments(root) {
    const segments = [];
    const appendText = text => {
        if (!text) {
            return;
        }
        const previous = segments.at(-1);
        if (previous?.type === 'text') {
            previous.text += text;
        } else {
            segments.push({ type: 'text', text });
        }
    };
    const appendBlockBoundary = () => {
        const previous = segments.at(-1);
        if (segments.length && !(previous?.type === 'text' && previous.text.endsWith('\n'))) {
            appendText('\n');
        }
    };
    const visitChildren = parent => {
        let hasPreviousNode = false;
        for (const child of Array.from(parent?.childNodes || [])) {
            const tagName = String(child?.tagName || '').toUpperCase();
            if (hasPreviousNode && COMPOSER_BLOCK_TAGS.has(tagName)) {
                appendBlockBoundary();
            }
            visit(child);
            hasPreviousNode ||= child?.nodeType === 1 ||
                (child?.nodeType === 3 && Boolean(child.nodeValue));
        }
    };
    const visit = node => {
        if (node?.nodeType === 3) {
            appendText(node.nodeValue || '');
            return;
        }
        if (node?.nodeType !== 1) {
            return;
        }
        if (node.classList?.contains(IMAGE_TOKEN_CLASS)) {
            segments.push({
                type: 'image',
                path: String(node.dataset?.path || ''),
                name: String(node.dataset?.name || ''),
                pending: node.dataset?.pending === 'true'
            });
            return;
        }
        if (node.classList?.contains(ATTACHMENT_TOKEN_CLASS)) {
            segments.push({
                type: node.dataset?.type === 'video' ? 'video' : 'file',
                path: String(node.dataset?.path || ''),
                name: String(node.dataset?.name || ''),
                size: Math.max(0, Number(node.dataset?.size) || 0),
                pending: node.dataset?.pending === 'true'
            });
            return;
        }
        if (String(node.tagName || '').toUpperCase() === 'BR') {
            appendText('\n');
            return;
        }
        visitChildren(node);
    };
    visitChildren(root);
    return removeTrailingMediaPlaceholderBreaks(segments);
}

function messagePreview(message) {
    return normalizeDraftSegments(message).map(segment => {
        if (segment.type === 'image') {
            return '[图片]';
        }
        if (segment.type === 'video') {
            return `[视频] ${segment.name}`;
        }
        if (segment.type === 'file') {
            return `[文件] ${segment.name}`;
        }
        return segment.text;
    }).join('').trim();
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
        resolvingSenderName: false,
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
        state.sendButton.disabled = state.sending || state.resolvingSenderName || state.messages.length === 0;
    }

    function readComposerSegments() {
        return readFakeForwardComposerSegments(state.fields.composer);
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

    function removeComposerToken(token) {
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
        remove.addEventListener('click', () => removeComposerToken(token));
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

    function formatFileSize(value) {
        const size = Math.max(0, Number(value) || 0);
        if (size < 1024) {
            return size + ' B';
        }
        if (size < 1024 * 1024) {
            return (size / 1024).toFixed(size < 10 * 1024 ? 1 : 0) + ' KB';
        }
        if (size < 1024 * 1024 * 1024) {
            return (size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
        }
        return (size / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
    }

    function createComposerAttachment(media) {
        const type = media.type === 'video' ? 'video' : 'file';
        const extension = /\.([^.]+)$/.exec(String(media.name || ''))?.[1] || '';
        const token = createElement('span', ATTACHMENT_TOKEN_CLASS);
        token.contentEditable = 'false';
        token.dataset.type = type;
        token.dataset.path = String(media.path || '');
        token.dataset.name = String(media.name || '');
        token.dataset.size = String(Math.max(0, Number(media.size) || 0));
        token.dataset.pending = String(!media.path);
        token.title = media.name || media.path || (type === 'video' ? '视频' : '文件');
        const icon = createElement(
            'span',
            'qff-composer-attachment-icon',
            type === 'video' ? '▶' : (extension.slice(0, 4).toUpperCase() || 'FILE')
        );
        const details = createElement('span', 'qff-composer-attachment-details');
        details.append(
            createElement('span', 'qff-composer-attachment-name', media.name || (type === 'video' ? '视频' : '文件')),
            createElement('span', 'qff-composer-attachment-meta', formatFileSize(media.size))
        );
        const remove = createButton(
            'qff-composer-image-remove qff-composer-attachment-remove',
            '×',
            type === 'video' ? '移除视频' : '移除文件'
        );
        remove.addEventListener('pointerdown', event => event.preventDefault());
        remove.addEventListener('click', () => removeComposerToken(token));
        token.append(icon, details, remove);
        return token;
    }

    function renderComposer(segments = []) {
        for (const token of state.fields.composer.querySelectorAll('.' + IMAGE_TOKEN_CLASS)) {
            releaseImagePreview(token);
        }
        const nodes = [];
        for (const segment of normalizeDraftSegments({ segments })) {
            if (segment.type === 'image') {
                nodes.push(createComposerImage(segment));
            } else if (segment.type === 'video' || segment.type === 'file') {
                nodes.push(createComposerAttachment(segment));
            } else {
                nodes.push(document.createTextNode(segment.text));
            }
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

    function isVideoFile(file) {
        return file instanceof File &&
            (String(file.type || '').startsWith('video/') || VIDEO_FILE_PATTERN.test(file.name || ''));
    }

    function getTransferFiles(dataTransfer) {
        const files = Array.from(dataTransfer?.files || []).filter(file => file instanceof File);
        if (files.length) {
            return files;
        }
        return Array.from(dataTransfer?.items || [])
            .filter(item => item.kind === 'file')
            .map(item => item.getAsFile())
            .filter(file => file instanceof File);
    }

    async function getLocalFilePath(file) {
        const directPath = String(file?.path || '');
        if (directPath) {
            return directPath;
        }
        return String(await options.getFilePath?.(file) || '');
    }

    async function resolveComposerImage(file, token) {
        try {
            let image = {
                path: await getLocalFilePath(file),
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
            removeComposerToken(token);
            setStatus(error?.message || '图片处理失败', 'error');
        }
    }

    async function resolveComposerAttachment(file, token) {
        try {
            const filePath = await getLocalFilePath(file);
            if (!filePath) {
                throw new Error('无法读取本地文件路径');
            }
            if (!token.isConnected) {
                return;
            }
            token.dataset.path = filePath;
            token.dataset.pending = 'false';
        } catch (error) {
            removeComposerToken(token);
            setStatus(error?.message || '文件处理失败', 'error');
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

    function insertAttachmentFile(file) {
        const hasContent = readComposerSegments().some(segment =>
            segment.type !== 'text' || segment.text.trim()
        );
        if (hasContent) {
            setStatus('视频或文件必须单独作为一条消息', 'error');
            return;
        }
        const type = isVideoFile(file) ? 'video' : 'file';
        const token = createComposerAttachment({
            type,
            name: file.name,
            size: file.size
        });
        state.fields.composer.replaceChildren(token);
        selectAfter(token);
        resolveComposerAttachment(file, token);
    }

    function insertComposerFiles(files, range = getComposerRange()) {
        if (!files.length) {
            return;
        }
        if (state.fields.composer.querySelector('.' + ATTACHMENT_TOKEN_CLASS)) {
            setStatus('视频或文件必须单独作为一条消息', 'error');
            return;
        }
        if (files.every(isImageFile)) {
            insertImageFiles(files, range);
            return;
        }
        if (files.length !== 1) {
            setStatus('视频或文件每条消息只能添加一个', 'error');
            return;
        }
        insertAttachmentFile(files[0]);
    }

    function handleComposerPaste(event) {
        const files = getTransferFiles(event.clipboardData);
        if (files.length) {
            event.preventDefault();
            insertComposerFiles(files);
            return;
        }
        const text = event.clipboardData?.getData('text/plain');
        if (text !== undefined) {
            event.preventDefault();
            if (state.fields.composer.querySelector('.' + ATTACHMENT_TOKEN_CLASS)) {
                setStatus('视频或文件必须单独作为一条消息', 'error');
                return;
            }
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
        const files = getTransferFiles(event.dataTransfer);
        if (files.length) {
            event.preventDefault();
            event.stopPropagation();
            insertComposerFiles(files, range);
        }
    }

    function handleComposerKeydown(event) {
        const attachment = state.fields.composer.querySelector('.' + ATTACHMENT_TOKEN_CLASS);
        if (!attachment || event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }
        if (event.key === 'Backspace' || event.key === 'Delete') {
            event.preventDefault();
            removeComposerToken(attachment);
            return;
        }
        if (event.key === 'Enter' || event.key.length === 1) {
            event.preventDefault();
            setStatus('视频或文件必须单独作为一条消息', 'error');
        }
    }

    function setTimestampFields(timestamp = Date.now()) {
        const value = formatDateTimeParts(timestamp);
        state.fields.timestampDate.value = value.date;
        state.fields.timestampTime.value = value.time;
    }

    function clearForm() {
        state.selectedId = '';
        state.fields.senderUin.value = '';
        state.fields.senderName.value = '';
        setTimestampFields();
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
        setTimestampFields(message.timestamp);
        renderComposer(message.segments);
        state.fields.commit.textContent = '保存修改';
        state.fields.cancelEdit.hidden = false;
        setStatus();
        renderList();
    }

    async function commitForm() {
        if (state.resolvingSenderName) {
            return;
        }
        const senderUin = state.fields.senderUin.value.trim();
        let senderName = state.fields.senderName.value.trim();
        const segments = readComposerSegments();
        const textLength = segments.filter(segment => segment.type === 'text')
            .reduce((length, segment) => length + segment.text.length, 0);
        const images = segments.filter(segment => segment.type === 'image');
        const standalone = segments.filter(segment => segment.type === 'video' || segment.type === 'file');
        if (!/^\d{5,20}$/.test(senderUin)) {
            setStatus('请输入有效的发送者 QQ 号', 'error');
            state.fields.senderUin.focus();
            return;
        }
        if (segments.some(segment => segment.pending || (segment.type !== 'text' && !segment.path))) {
            setStatus('文件正在处理，请稍候', 'error');
            return;
        }
        if (standalone.length && (standalone.length !== 1 || segments.length !== 1)) {
            setStatus('视频或文件必须单独作为一条消息', 'error');
            return;
        }
        const hasText = segments.some(segment => segment.type === 'text' && segment.text.trim());
        if (!hasText && !images.length && !standalone.length) {
            setStatus('请输入消息内容', 'error');
            state.fields.composer.focus();
            return;
        }
        if (textLength > MAX_TEXT_LENGTH) {
            setStatus('消息内容不能超过 ' + MAX_TEXT_LENGTH + ' 个字符', 'error');
            return;
        }
        if (!senderName) {
            state.resolvingSenderName = true;
            state.fields.commit.disabled = true;
            state.sendButton.disabled = true;
            setStatus('正在获取昵称');
            try {
                senderName = String(await options.resolveSenderName?.(senderUin) || '').trim();
            } catch {
                senderName = '';
            } finally {
                state.resolvingSenderName = false;
                state.fields.commit.disabled = state.sending || state.resolvingSenderName;
                renderList();
            }
            if (!senderName) {
                setStatus('未能获取该 QQ 号的昵称，请手动填写', 'error');
                state.fields.senderName.focus();
                return;
            }
            state.fields.senderName.value = senderName;
        }
        const next = {
            id: state.selectedId || makeEntryId(),
            senderUin,
            senderName,
            segments: normalizeDraftSegments({ segments }),
            timestamp: parseDateTimeParts(
                state.fields.timestampDate.value,
                state.fields.timestampTime.value
            )
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
        state.fields.addFile.disabled = sending;
        state.fields.commit.disabled = sending || state.resolvingSenderName;
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

    function syncColorScheme() {
        const themeSource = state.root?.querySelector('.qff-dialog') || state.root;
        if (!themeSource || !state.fields.timestampDate || !state.fields.timestampTime) {
            return;
        }
        const scheme = inferColorScheme(getComputedStyle(themeSource).color);
        state.root.style.colorScheme = scheme;
        state.fields.timestampDate.style.colorScheme = scheme;
        state.fields.timestampTime.style.colorScheme = scheme;
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
        title.id = 'qqnt-toolbox-fake-forward-title';
        dialog.setAttribute('aria-labelledby', title.id);
        const closeButton = createButton('qff-close', '×', '关闭');
        header.append(title, closeButton);

        const body = createElement('div', 'qff-body');
        const listPane = createElement('section', 'qff-list-pane');
        const listHeader = createElement('div', 'qff-list-header');
        const listHeading = createElement('div', 'qff-list-heading');
        state.count = createElement('span', 'qff-count');
        listHeading.append(createElement('span', 'qff-list-title', '消息'), state.count);
        state.list = createElement('ol', 'qff-list');
        const listActions = createElement('div', 'qff-list-actions');
        state.fields.moveUp = createButton('qff-list-action', '上移');
        state.fields.moveDown = createButton('qff-list-action', '下移');
        state.fields.remove = createButton('qff-list-action qff-list-delete', '删除');
        listActions.append(state.fields.moveUp, state.fields.moveDown, state.fields.remove);
        listHeader.append(listHeading, listActions);
        listPane.append(listHeader, state.list);

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
        const senderUinField = createField('发送者 QQ', state.fields.senderUin);
        const senderNameField = createField('显示昵称', state.fields.senderName);
        fieldRow.append(senderUinField, senderNameField);
        const timeRow = createElement('div', 'qff-time-row');
        state.fields.timestampDate = createElement('input', 'qff-input');
        state.fields.timestampDate.type = 'date';
        state.fields.timestampDate.required = true;
        state.fields.timestampTime = createElement('input', 'qff-input');
        state.fields.timestampTime.type = 'time';
        state.fields.timestampTime.required = true;
        const dateField = createField('日期', state.fields.timestampDate);
        const clockField = createField('时间', state.fields.timestampTime);
        dateField.classList.add('qff-date-field');
        clockField.classList.add('qff-clock-field');
        timeRow.append(dateField, clockField);
        state.fields.composer = createElement('div', 'qff-composer');
        state.fields.composer.contentEditable = 'true';
        state.fields.composer.spellcheck = false;
        state.fields.composer.setAttribute('role', 'textbox');
        state.fields.composer.setAttribute('aria-label', '消息内容');
        state.fields.composer.setAttribute('aria-multiline', 'true');
        state.fields.filePicker = createElement('input');
        state.fields.filePicker.type = 'file';
        state.fields.filePicker.multiple = true;
        state.fields.filePicker.hidden = true;
        const composerField = createElement('div', 'qff-field qff-composer-field');
        const composerShell = createElement('div', 'qff-composer-shell');
        const composerToolbar = createElement('div', 'qff-composer-toolbar');
        const addFile = createButton('qff-button qff-file-button', '选择文件', '添加媒体或文件');
        state.fields.addFile = addFile;
        const formActions = createElement('div', 'qff-form-actions');
        state.fields.cancelEdit = createButton('qff-button', '取消编辑');
        state.fields.commit = createButton('qff-button qff-commit', '添加');
        state.fields.commit.type = 'submit';
        formActions.append(state.fields.cancelEdit, state.fields.commit);
        composerToolbar.append(addFile, formActions);
        composerShell.append(state.fields.composer);
        composerField.append(
            createElement('span', 'qff-label', '消息内容'),
            composerShell,
            composerToolbar,
            state.fields.filePicker
        );
        form.append(
            fieldRow,
            timeRow,
            composerField
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
            commitForm().catch(error => setStatus(error?.message || '保存失败', 'error'));
        });
        state.fields.cancelEdit.addEventListener('click', clearForm);
        state.fields.composer.addEventListener('paste', handleComposerPaste);
        state.fields.composer.addEventListener('keydown', handleComposerKeydown);
        state.fields.composer.addEventListener('dragover', event => {
            if (state.draggedImage || Array.from(event.dataTransfer?.types || []).includes('Files')) {
                event.preventDefault();
                event.dataTransfer.dropEffect = state.draggedImage ? 'move' : 'copy';
            }
        });
        state.fields.composer.addEventListener('drop', handleComposerDrop);
        addFile.addEventListener('click', () => state.fields.filePicker.click());
        state.fields.filePicker.addEventListener('change', () => {
            insertComposerFiles(Array.from(state.fields.filePicker.files || []));
            state.fields.filePicker.value = '';
        });
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
        syncColorScheme();
        requestAnimationFrame(() => {
            if (state.root && !state.root.hidden) {
                syncColorScheme();
            }
        });
        document.body.style.overflow = 'hidden';
        state.fields.senderUin.focus();
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
        const toolbar = findNativeChatToolbar();
        const available = isSupportedPeer(options.getPeer?.()) &&
            Boolean(toolbar);
        if (!available) {
            removeEntries();
            close();
            return;
        }
        if (toolbar.querySelector(':scope > .' + ENTRY_CLASS)) {
            return;
        }
        removeEntries();
        const entry = createNativeChatToolbarEntry(toolbar, {
            className: ENTRY_CLASS,
            label: '伪造转发',
            renderIcon: applyEntryGlyph
        });
        if (!entry) {
            return;
        }
        bindNativeChatToolbarAction(entry, open);
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
