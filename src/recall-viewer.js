(() => {
    const api = window.qqntToolboxRecallViewer;
    const chatList = document.getElementById('chat-list');
    const messageList = document.getElementById('message-list');
    const chatTypeLabels = new Map([[1, '私'], [2, '群'], [100, '临']]);
    let chats = [];
    let selectedKey = '';
    let toastTimer = 0;
    let activeAudio = null;
    let closeImagePreview = null;

    function createElement(tagName, className, textContent) {
        const element = document.createElement(tagName);
        if (className) {
            element.className = className;
        }
        if (textContent !== undefined) {
            element.textContent = textContent;
        }
        return element;
    }

    function showEmpty(target, message) {
        target.replaceChildren(createElement('div', 'empty-state', message));
    }

    function getAvatarInitial(label) {
        return Array.from(String(label || '').trim()).slice(0, 1).join('').toUpperCase() || '?';
    }

    function createAvatar(src, label, className) {
        const avatar = createElement('span', className, getAvatarInitial(label));
        avatar.setAttribute('aria-hidden', 'true');
        if (!src) {
            return avatar;
        }
        const image = document.createElement('img');
        image.src = src;
        image.alt = '';
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        image.addEventListener('error', () => image.remove(), { once: true });
        avatar.appendChild(image);
        return avatar;
    }

    function formatMessageTime(value) {
        const timestamp = Number(value);
        if (!timestamp) {
            return '';
        }
        const date = new Date(timestamp > 100000000000 ? timestamp : timestamp * 1000);
        if (Number.isNaN(date.getTime())) {
            return '';
        }
        const pad = part => String(part).padStart(2, '0');
        return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    function formatDuration(value) {
        const seconds = Math.max(0, Math.floor(Number(value) || 0));
        const minutes = Math.floor(seconds / 60);
        return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
    }

    function formatFileSize(value) {
        let size = Number(value) || 0;
        if (!size) {
            return '';
        }
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let unit = 0;
        while (size >= 1024 && unit < units.length - 1) {
            size /= 1024;
            unit++;
        }
        return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
    }

    function showToast(message, duration = 2200) {
        window.clearTimeout(toastTimer);
        document.querySelector('.toast')?.remove();
        const toast = createElement('div', 'toast', message);
        document.body.appendChild(toast);
        toastTimer = window.setTimeout(() => toast.remove(), duration);
    }

    function hasSelectionWithin(element) {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.toString().trim() || selection.rangeCount === 0) {
            return false;
        }
        return element.contains(selection.getRangeAt(0).commonAncestorContainer);
    }

    async function jumpToMessage(message) {
        try {
            await api.jumpToMessage({
                msgId: message.msgId,
                peerUid: message.peerUid,
                chatType: message.chatType
            });
        } catch {
            showToast('无法跳转到这条消息');
        }
    }

    function stopControlPropagation(element) {
        for (const eventName of ['pointerdown', 'mousedown', 'click', 'dblclick']) {
            element.addEventListener(eventName, event => event.stopPropagation());
        }
    }

    function applyImageDimensions(imageItem, width, height) {
        width = Number(width) || 0;
        height = Number(height) || 0;
        if (width <= 0 || height <= 0) {
            return false;
        }
        const scale = Math.min(1, 280 / width, 320 / height);
        imageItem.style.width = `${Math.max(1, Math.round(width * scale))}px`;
        imageItem.style.aspectRatio = `${width} / ${height}`;
        return true;
    }

    function openImagePreview(src, name = '') {
        closeImagePreview?.();
        const layer = createElement('div', 'image-preview-layer');
        const image = document.createElement('img');
        image.className = 'image-preview';
        image.src = src;
        image.alt = name || '图片';
        const closeButton = createElement('button', 'image-preview-close', '\u00d7');
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label', '关闭图片');
        const close = () => {
            document.removeEventListener('keydown', handleKeydown, true);
            layer.remove();
            if (closeImagePreview === close) {
                closeImagePreview = null;
            }
        };
        const handleKeydown = event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
            }
        };
        closeButton.addEventListener('click', close);
        layer.addEventListener('click', event => {
            if (event.target === layer) {
                close();
            }
        });
        image.addEventListener('click', event => event.stopPropagation());
        layer.append(image, closeButton);
        document.body.appendChild(layer);
        document.addEventListener('keydown', handleKeydown, true);
        closeImagePreview = close;
        closeButton.focus();
    }

    function createImagePart(part, compact = false) {
        if (!part.src) {
            return createElement('div', 'unsupported-part', `[图片] ${part.name || ''}`.trim());
        }
        const imageItem = createElement('div', 'image-item');
        const image = document.createElement('img');
        image.src = part.src;
        image.alt = part.name || '加载失败';
        image.loading = 'lazy';
        imageItem.tabIndex = 0;
        imageItem.setAttribute('role', 'button');
        imageItem.setAttribute('aria-label', `查看图片${part.name ? `：${part.name}` : ''}`);
        if (compact) {
            imageItem.classList.add('is-grid');
        } else if (!applyImageDimensions(imageItem, part.width, part.height)) {
            image.addEventListener('load', () => applyImageDimensions(imageItem, image.naturalWidth, image.naturalHeight), { once: true });
        }
        imageItem.appendChild(image);
        for (const eventName of ['pointerdown', 'mousedown', 'dblclick']) {
            imageItem.addEventListener(eventName, event => event.stopPropagation());
        }
        imageItem.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            openImagePreview(part.src, part.name);
        });
        imageItem.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                openImagePreview(part.src, part.name);
            }
        });
        return imageItem;
    }

    function createWaveform(values) {
        const waveform = createElement('span', 'voice-waveform');
        const waves = Array.isArray(values) && values.length ? values : [4, 10, 7, 14, 9, 16, 6, 12, 8, 15, 5, 11];
        const max = Math.max(...waves, 1);
        for (const value of waves.slice(0, 24)) {
            const bar = createElement('i', 'voice-wave');
            bar.style.height = `${Math.max(3, Math.round((Number(value) || 0) / max * 15))}px`;
            waveform.appendChild(bar);
        }
        return waveform;
    }

    function createVoicePart(message, part) {
        const voice = createElement('div', 'voice-player');
        const toggle = createElement('button', 'voice-toggle');
        toggle.type = 'button';
        toggle.setAttribute('aria-label', '播放语音');
        const icon = createElement('span', 'voice-toggle-icon');
        const waveform = createWaveform(part.waves);
        const duration = createElement('span', 'voice-duration', formatDuration(part.duration));
        const audio = document.createElement('audio');
        audio.preload = 'metadata';
        voice.append(toggle, waveform, duration, audio);
        toggle.appendChild(icon);
        stopControlPropagation(voice);

        const sync = () => {
            const total = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Number(part.duration) || 0;
            const current = Math.max(0, Number(audio.currentTime) || 0);
            const ratio = total ? Math.min(1, current / total) : 0;
            const bars = Array.from(waveform.children);
            bars.forEach((bar, index) => bar.classList.toggle('played', index / Math.max(1, bars.length - 1) <= ratio));
            voice.classList.toggle('playing', !audio.paused);
            toggle.setAttribute('aria-label', audio.paused ? '播放语音' : '暂停语音');
            duration.textContent = audio.paused || !current
                ? formatDuration(total || part.duration)
                : `${formatDuration(current)} / ${formatDuration(total)}`;
        };

        const play = async () => {
            if (audio.src) {
                if (audio.paused) {
                    if (activeAudio && activeAudio !== audio) {
                        activeAudio.pause();
                    }
                    activeAudio = audio;
                    await audio.play();
                } else {
                    audio.pause();
                }
                return;
            }
            voice.classList.add('loading');
            try {
                const preview = await api.getAudioPreview({
                    msgId: message.msgId,
                    elementIndex: part.elementIndex
                });
                audio.src = preview.url;
                if (activeAudio && activeAudio !== audio) {
                    activeAudio.pause();
                }
                activeAudio = audio;
                await audio.play();
            } catch {
                showToast('语音文件不在 QQ 缓存中，暂时无法播放');
            } finally {
                voice.classList.remove('loading');
            }
        };

        toggle.addEventListener('click', event => {
            event.stopPropagation();
            play().catch(() => showToast('语音播放失败'));
        });
        audio.addEventListener('loadedmetadata', sync);
        audio.addEventListener('timeupdate', sync);
        audio.addEventListener('play', sync);
        audio.addEventListener('pause', sync);
        audio.addEventListener('ended', sync);

        if (part.transcript) {
            const group = createElement('div', 'voice-group');
            group.append(voice, createElement('div', 'voice-transcript', part.transcript));
            return group;
        }
        return voice;
    }

    function createMediaCard(kind, title, meta, imageUrl = '') {
        const card = createElement('div', 'media-card');
        if (imageUrl) {
            const image = document.createElement('img');
            image.className = 'media-card-image';
            image.src = imageUrl;
            image.alt = '';
            image.loading = 'lazy';
            card.appendChild(image);
        }
        const badge = createElement('span', 'media-kind', kind);
        const copy = createElement('div', 'media-copy');
        copy.appendChild(createElement('div', 'media-title', title));
        if (meta) {
            copy.appendChild(createElement('div', 'media-meta', meta));
        }
        card.append(badge, copy);
        return card;
    }

    function parseForwardPart(part) {
        try {
            const doc = new DOMParser().parseFromString(part.xml || '', 'application/xml');
            const source = doc.querySelector('source')?.getAttribute('name') || '聊天记录';
            const titles = Array.from(doc.querySelectorAll('title')).map(item => item.textContent?.trim()).filter(Boolean);
            const summary = doc.querySelector('summary')?.textContent?.trim() || titles.slice(1).join('\n');
            return { title: titles[0] || source, summary };
        } catch {
            return { title: '聊天记录', summary: '' };
        }
    }

    function renderPart(message, part, options = {}) {
        if (part.type === 'text') {
            return createElement('p', 'message-text', part.text);
        }
        if (part.type === 'mention') {
            return createElement('span', 'message-mention', part.text);
        }
        if (part.type === 'image') {
            return createImagePart(part, options.compactImage === true);
        }
        if (part.type === 'voice') {
            return createVoicePart(message, part);
        }
        if (part.type === 'reply') {
            return createElement('div', 'reply-preview', part.text || '[消息]');
        }
        if (part.type === 'file') {
            return createMediaCard('文件', part.name || '文件', formatFileSize(part.size));
        }
        if (part.type === 'video') {
            if (part.src) {
                const video = document.createElement('video');
                video.className = 'video-part';
                video.src = part.src;
                video.poster = part.poster || '';
                video.preload = 'metadata';
                video.controls = true;
                stopControlPropagation(video);
                return video;
            }
            return createMediaCard('视频', part.name || '视频', [formatDuration(part.duration), formatFileSize(part.size)].filter(Boolean).join(' · '));
        }
        if (part.type === 'face') {
            if (part.src) {
                return createImagePart({ src: part.src, name: part.name });
            }
            return createElement('div', 'face-part', `[${part.name || '表情'}]`);
        }
        if (part.type === 'card') {
            const subtitle = /^\d+$/.test(part.subtitle || '') ? formatFileSize(part.subtitle) : part.subtitle;
            return createMediaCard('卡片', part.title || '卡片消息', subtitle, part.image);
        }
        if (part.type === 'forward') {
            const forward = parseForwardPart(part);
            return createMediaCard('记录', forward.title, forward.summary);
        }
        return createElement('div', part.type === 'notice' ? 'notice-part' : 'unsupported-part', part.text || '暂不支持的消息');
    }

    function renderTextRun(messageParts, startIndex) {
        const line = createElement('p', 'message-text');
        let index = startIndex;
        while (index < messageParts.length && ['text', 'mention'].includes(messageParts[index].type)) {
            const part = messageParts[index];
            line.appendChild(part.type === 'mention'
                ? renderPart(null, part)
                : document.createTextNode(part.text || ''));
            index++;
        }
        return { line, nextIndex: index };
    }

    function renderMessages(chat) {
        if (!chat?.messages?.length) {
            showEmpty(messageList, '该会话没有撤回数据');
            return;
        }
        if (activeAudio) {
            activeAudio.pause();
            activeAudio = null;
        }
        closeImagePreview?.();
        const fragment = document.createDocumentFragment();
        for (const message of chat.messages) {
            const item = createElement('article', 'message-item');
            const avatar = createAvatar(message.avatarUrl, message.sender, 'message-avatar');
            const box = createElement('div', 'message-box');
            const sender = createElement('p', 'sender', message.sender || '未知发送者');
            const messageTime = formatMessageTime(message.recallTime || message.msgTime);
            const content = createElement('div', 'message-content');
            const parts = createElement('div', 'message-parts');
            content.tabIndex = 0;
            content.setAttribute('aria-label', '点击定位到原消息');

            const messageParts = Array.isArray(message.parts) && message.parts.length
                ? message.parts
                : [{ type: 'unsupported', text: '[空消息]' }];
            const imageCount = messageParts.filter(part => part.type === 'image').length;
            let imageList = null;
            for (let index = 0; index < messageParts.length;) {
                const part = messageParts[index];
                if (part.type === 'text' || part.type === 'mention') {
                    const textRun = renderTextRun(messageParts, index);
                    parts.appendChild(textRun.line);
                    index = textRun.nextIndex;
                    imageList = null;
                    continue;
                }
                if (part.type === 'image' && imageCount > 1) {
                    if (!imageList) {
                        imageList = createElement('div', 'image-list');
                        parts.appendChild(imageList);
                    }
                    imageList.appendChild(renderPart(message, part, { compactImage: true }));
                    index++;
                    continue;
                }
                imageList = null;
                parts.appendChild(renderPart(message, part));
                index++;
            }
            content.appendChild(parts);
            content.addEventListener('click', () => {
                if (!hasSelectionWithin(content)) {
                    jumpToMessage(message);
                }
            });
            content.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    jumpToMessage(message);
                }
            });

            box.append(sender, content);
            if (messageTime) {
                box.appendChild(createElement('time', 'message-time', messageTime));
            }
            item.append(avatar, box);
            fragment.appendChild(item);
        }
        messageList.replaceChildren(fragment);
        messageList.scrollTop = 0;
    }

    function selectChat(key) {
        selectedKey = key;
        for (const button of chatList.querySelectorAll('.chat-item')) {
            button.classList.toggle('active', button.dataset.key === key);
        }
        renderMessages(chats.find(chat => chat.key === key));
    }

    function renderChats() {
        if (!chats.length) {
            showEmpty(chatList, '没有撤回数据');
            showEmpty(messageList, '请选择左侧会话');
            return;
        }
        const fragment = document.createDocumentFragment();
        for (const chat of chats) {
            const button = createElement('button', 'chat-item');
            button.type = 'button';
            button.dataset.key = chat.key;
            button.title = chat.peerUin ? `${chat.peerName} ${chat.peerUin}` : chat.peerName;
            const label = chat.peerName || chat.peerUid;
            button.appendChild(createAvatar(chat.avatarUrl, label, 'chat-avatar'));
            const copy = createElement('span', 'chat-copy');
            copy.appendChild(createElement('span', 'chat-name', label));
            if (chat.peerUin) {
                copy.appendChild(createElement('span', 'chat-uin', chat.peerUin));
            }
            button.appendChild(copy);
            const tag = chatTypeLabels.get(Number(chat.chatType));
            if (tag) {
                button.appendChild(createElement('span', 'chat-tag', tag));
            }
            button.addEventListener('click', () => selectChat(chat.key));
            fragment.appendChild(button);
        }
        chatList.replaceChildren(fragment);
        if (selectedKey && chats.some(chat => chat.key === selectedKey)) {
            selectChat(selectedKey);
        }
    }

    async function load() {
        if (!api?.getData) {
            showEmpty(chatList, '查看器加载失败');
            return;
        }
        try {
            chats = await api.getData();
            renderChats();
        } catch {
            showEmpty(chatList, '加载撤回列表失败');
            showEmpty(messageList, '暂无可显示的数据');
        }
    }

    load();
})();
