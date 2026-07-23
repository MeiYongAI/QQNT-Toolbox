'use strict';

(() => {
    const bridge = window.qqntToolboxMediaViewer;
    if (!bridge) {
        return;
    }

    const CONTROL_HIDE_DELAY_MS = 1100;
    const LOAD_INDICATOR_DELAY_MS = 140;
    const PRELOAD_DELAY_MS = 160;
    const WHEEL_STEP = 90;
    const WHEEL_LOCK_MS = 180;
    const CONTEXT_MENU_MARGIN = 8;
    const MIN_SCALE = 0.25;
    const MAX_SCALE = 8;
    const SPEEDS = [0.5, 1, 1.5, 2];
    const BACKGROUNDS = new Set(['transparent', 'white', 'semi', 'black']);
    const MEDIA_STAGE_MIN_TOP = 11;

    const viewer = document.getElementById('media-viewer');
    const stage = document.getElementById('media-stage');
    const slot = document.getElementById('media-slot');
    const loading = document.getElementById('loading');
    const loadError = document.getElementById('load-error');
    const retry = document.getElementById('retry');
    const previous = document.getElementById('previous');
    const next = document.getElementById('next');
    const minimize = document.getElementById('minimize');
    const close = document.getElementById('close');
    const playerControls = document.getElementById('player-controls');
    const playPause = document.getElementById('play-pause');
    const videoFullscreen = document.getElementById('video-fullscreen');
    const playerSettings = document.getElementById('player-settings');
    const playerSettingsMenu = document.getElementById('player-settings-menu');
    const speedBadge = document.getElementById('speed-badge');
    const qualityBadge = document.getElementById('quality-badge');
    const qualityLabel = document.getElementById('quality-label');
    const speedOptions = Array.from(document.querySelectorAll('[data-speed]'));
    const currentTime = document.getElementById('current-time');
    const duration = document.getElementById('duration');
    const seek = document.getElementById('seek');
    const volumeToggle = document.getElementById('volume-toggle');
    const volume = document.getElementById('volume');
    const pictureInPicture = document.getElementById('picture-in-picture');
    const mediaCount = document.getElementById('media-count');
    const mediaSender = document.getElementById('media-sender');
    const mediaSeparator = document.getElementById('media-separator');
    const mediaDate = document.getElementById('media-date');
    const save = document.getElementById('save');
    const rotate = document.getElementById('rotate');
    const more = document.getElementById('more');
    const moreMenu = document.getElementById('more-menu');
    const menuSave = document.getElementById('menu-save');
    const copyImage = document.getElementById('copy-image');
    const scanQr = document.getElementById('scan-qr');
    const showInFolder = document.getElementById('show-in-folder');
    const openExternal = document.getElementById('open-external');
    const jumpToMessage = document.getElementById('jump-to-message');
    const toast = document.getElementById('toast');

    function createEmptyViewerState(background = 'black') {
        return {
            galleryId: '',
            index: 0,
            items: [],
            background: BACKGROUNDS.has(background) ? background : 'black',
            qrScanEnabled: false,
            playback: null
        };
    }

    let state = createEmptyViewerState();
    let activeMedia = null;
    let activeIndex = -1;
    let activeGalleryId = '';
    let activeVideoCleanup = null;
    let renderRevision = 0;
    let preparedMedia = new Map();
    let preloadTimer = 0;
    let loadingTimer = 0;
    let controlsTimer = 0;
    let toastTimer = 0;
    let wheelDelta = 0;
    let wheelLockedUntil = 0;
    let controlsHidden = false;
    let menuOpen = false;
    let settingsMenuOpen = false;
    let rangeAdjusting = false;
    let mediaScale = 1;
    let mediaRotation = 0;
    let mediaOffsetX = 0;
    let mediaOffsetY = 0;
    let panState = null;
    let suppressCloseUntil = 0;
    let lastPointer = null;
    let nativeFallbackKey = '';
    let savedVolume = readSavedVolume();
    let savedPlaybackRate = readSavedPlaybackRate();
    let lastPositiveVolume = savedVolume > 0 ? savedVolume : 1;

    function normalizeText(value) {
        return String(value ?? '').trim();
    }

    function normalizeItem(value, previousItem = null) {
        const timestamp = Number(value?.timestamp);
        return {
            id: normalizeText(value?.id) || normalizeText(previousItem?.id),
            type: value?.type === 'video' ? 'video' : 'image',
            src: normalizeText(value?.src) || normalizeText(previousItem?.src),
            previewSrc: normalizeText(value?.previewSrc) || normalizeText(previousItem?.previewSrc),
            name: normalizeText(value?.name) || normalizeText(previousItem?.name),
            senderName: normalizeText(value?.senderName) || normalizeText(previousItem?.senderName),
            timestamp: Number.isFinite(timestamp) && timestamp > 0
                ? timestamp
                : Number(previousItem?.timestamp) || 0,
            needsResolve: value?.needsResolve === true,
            canJump: value?.canJump === true,
            loadRevision: Number(previousItem?.loadRevision) || 0
        };
    }

    function normalizePlaybackState(value) {
        if (!value || typeof value !== 'object') {
            return null;
        }
        const currentTime = Number(value.currentTime);
        const volumeValue = Number(value.volume);
        const playbackRate = Number(value.playbackRate);
        return {
            currentTime: Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0,
            paused: value.paused !== false,
            volume: Number.isFinite(volumeValue) ? Math.min(Math.max(volumeValue, 0), 1) : 1,
            muted: value.muted === true,
            playbackRate: Number.isFinite(playbackRate)
                ? Math.min(Math.max(playbackRate, 0.25), 4)
                : 1
        };
    }

    function normalizeState(value) {
        const galleryId = normalizeText(value?.galleryId);
        const previousItems = galleryId && galleryId === state.galleryId ? state.items : [];
        const previousById = new Map(previousItems.map(item => [item.id, item]));
        const items = (Array.isArray(value?.items) ? value.items : [])
            .map(item => normalizeItem(item, previousById.get(normalizeText(item?.id))))
            .filter(item => item.src || item.needsResolve);
        return {
            galleryId,
            index: Math.min(Math.max(Number(value?.index) || 0, 0), Math.max(0, items.length - 1)),
            items,
            background: BACKGROUNDS.has(value?.background) ? value.background : 'black',
            qrScanEnabled: value?.qrScanEnabled === true,
            playback: normalizePlaybackState(value?.playback)
        };
    }

    function readSavedVolume() {
        try {
            const value = Number(localStorage.getItem('qqnt-toolbox-media-volume'));
            return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 1;
        } catch {
            return 1;
        }
    }

    function saveVolume(value) {
        savedVolume = Math.min(Math.max(Number(value) || 0, 0), 1);
        if (savedVolume > 0) {
            lastPositiveVolume = savedVolume;
        }
        try {
            localStorage.setItem('qqnt-toolbox-media-volume', String(savedVolume));
        } catch {
        }
    }

    function readSavedPlaybackRate() {
        try {
            const value = Number(localStorage.getItem('qqnt-toolbox-media-playback-rate'));
            return SPEEDS.includes(value) ? value : 1;
        } catch {
            return 1;
        }
    }

    function savePlaybackRate(value) {
        savedPlaybackRate = SPEEDS.includes(Number(value)) ? Number(value) : 1;
        try {
            localStorage.setItem('qqnt-toolbox-media-playback-rate', String(savedPlaybackRate));
        } catch {
        }
    }

    function createAbortError() {
        return Object.assign(new Error('Media load aborted.'), { name: 'AbortError' });
    }

    function isAbortError(error) {
        return error?.name === 'AbortError';
    }

    function releaseMedia(media) {
        if (!media || media === activeMedia) {
            return;
        }
        media.pause?.();
        media.removeAttribute?.('poster');
        media.removeAttribute?.('src');
        media.load?.();
        media.remove?.();
    }

    function dropPreparedMedia(index) {
        const entry = preparedMedia.get(index);
        if (!entry) {
            return;
        }
        preparedMedia.delete(index);
        entry.controller?.abort();
        releaseMedia(entry.media);
    }

    function clearPreparedMedia() {
        for (const index of Array.from(preparedMedia.keys())) {
            dropPreparedMedia(index);
        }
        preparedMedia = new Map();
    }

    function clearActiveMedia() {
        unbindActiveVideo();
        const media = activeMedia;
        activeMedia = null;
        activeIndex = -1;
        activeGalleryId = '';
        panState = null;
        slot.replaceChildren();
        releaseMedia(media);
    }

    function resetMediaLifecycle(options = {}) {
        renderRevision += 1;
        clearTimeout(preloadTimer);
        clearTimeout(loadingTimer);
        preloadTimer = 0;
        loadingTimer = 0;
        clearPreparedMedia();
        clearActiveMedia();
        if (options.clearStatus) {
            setLoading(false);
            setLoadError(false);
        }
        if (options.conceal) {
            concealMedia();
        }
    }

    function getMediaSource(item) {
        if (!item.loadRevision || !/^https?:/i.test(item.src)) {
            return item.src;
        }
        const separator = item.src.includes('?') ? '&' : '?';
        return `${item.src}${separator}qqnt_toolbox_retry=${item.loadRevision}`;
    }

    function loadMediaElement(item, index, galleryId, signal) {
        const isVideo = item.type === 'video';
        const media = document.createElement(isVideo ? 'video' : 'img');
        media.className = 'media-content';
        media.draggable = false;
        media.dataset.galleryId = galleryId;
        media.dataset.index = String(index);
        media.dataset.itemId = item.id;
        if (isVideo) {
            media.preload = 'auto';
            media.playsInline = true;
            media.controls = false;
            media.disableRemotePlayback = true;
            if (item.previewSrc) {
                media.poster = item.previewSrc;
            }
        } else {
            media.decoding = 'async';
            media.alt = item.name || '图片';
        }
        return new Promise((resolve, reject) => {
            const readyEvent = isVideo ? 'canplay' : 'load';
            const timeoutMs = item.needsResolve
                ? (isVideo ? 65000 : 15000)
                : (isVideo ? 20000 : 10000);
            let settled = false;
            const timer = window.setTimeout(() => finish(new Error('Media load timed out.')), timeoutMs);
            const cleanup = () => {
                clearTimeout(timer);
                media.removeEventListener(readyEvent, handleReady);
                media.removeEventListener('error', handleError);
                signal.removeEventListener('abort', handleAbort);
            };
            const finish = async error => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                if (error) {
                    media.removeAttribute('src');
                    media.load?.();
                    reject(error);
                    return;
                }
                if (!isVideo) {
                    await media.decode?.().catch(() => {});
                }
                resolve(media);
            };
            const handleReady = () => finish(signal.aborted ? createAbortError() : null);
            const handleError = () => finish(new Error('Media load failed.'));
            const handleAbort = () => finish(createAbortError());
            media.addEventListener(readyEvent, handleReady, { once: true });
            media.addEventListener('error', handleError, { once: true });
            signal.addEventListener('abort', handleAbort, { once: true });
            if (signal.aborted) {
                handleAbort();
                return;
            }
            media.src = getMediaSource(item);
            media.load?.();
            if ((!isVideo && media.complete && media.naturalWidth > 0) ||
                (isVideo && media.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA)) {
                handleReady();
            }
        });
    }

    async function resolveMediaItem(index, galleryId, signal, preload = false) {
        const resolved = await bridge.prepare({ galleryId, index, preload });
        if (signal.aborted || galleryId !== state.galleryId) {
            throw createAbortError();
        }
        if (!resolved?.src) {
            throw new Error('Media could not be resolved.');
        }
        const item = state.items[index];
        item.src = normalizeText(resolved.src);
        item.previewSrc = normalizeText(resolved.previewSrc) || item.previewSrc;
        item.name = normalizeText(resolved.name) || item.name;
        item.needsResolve = false;
        item.loadRevision += 1;
        return item;
    }

    async function prepareMedia(index, galleryId, signal, forceResolve = false, preload = false) {
        let item = state.items[index];
        let firstError = null;
        if (!forceResolve && item?.src) {
            try {
                return await loadMediaElement(item, index, galleryId, signal);
            } catch (error) {
                if (isAbortError(error)) {
                    throw error;
                }
                firstError = error;
            }
        }
        if (item?.needsResolve) {
            item = await resolveMediaItem(index, galleryId, signal, preload);
            return await loadMediaElement(item, index, galleryId, signal);
        }
        if (forceResolve && item?.src) {
            return await loadMediaElement(item, index, galleryId, signal);
        }
        throw firstError || new Error('Media source is unavailable.');
    }

    function getPreparedMedia(index, forceResolve = false, preload = false) {
        if (index < 0 || index >= state.items.length) {
            return null;
        }
        if (forceResolve) {
            dropPreparedMedia(index);
        }
        const cached = preparedMedia.get(index);
        if (cached) {
            return cached;
        }
        const galleryId = state.galleryId;
        const entry = {
            galleryId,
            controller: new AbortController(),
            media: null,
            promise: null
        };
        entry.promise = prepareMedia(index, galleryId, entry.controller.signal, forceResolve, preload)
            .then(media => {
                if (entry.controller.signal.aborted || galleryId !== state.galleryId) {
                    releaseMedia(media);
                    throw createAbortError();
                }
                entry.media = media;
                return media;
            })
            .catch(error => {
                if (preparedMedia.get(index) === entry) {
                    preparedMedia.delete(index);
                }
                throw error;
            });
        preparedMedia.set(index, entry);
        return entry;
    }

    function setLoading(isLoading, immediate = false) {
        clearTimeout(loadingTimer);
        loadingTimer = 0;
        if (!isLoading) {
            loading.hidden = true;
            stage.removeAttribute('aria-busy');
            return;
        }
        stage.setAttribute('aria-busy', 'true');
        const show = () => {
            loadingTimer = 0;
            loading.hidden = false;
        };
        if (immediate) {
            show();
        } else {
            loading.hidden = true;
            loadingTimer = window.setTimeout(show, LOAD_INDICATOR_DELAY_MS);
        }
    }

    function setLoadError(visible) {
        loadError.hidden = !visible;
    }

    function concealMedia() {
        viewer.classList.add('is-concealed');
    }

    function acknowledgePresentation(presentationId) {
        presentationId = normalizeText(presentationId);
        if (!presentationId) {
            return;
        }
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                bridge.action({ type: 'presented', presentationId }).catch(() => {});
            });
        });
    }

    function revealSelectedMedia(galleryId, index) {
        if (!activeMedia || activeGalleryId !== galleryId || activeIndex !== index) {
            return false;
        }
        viewer.classList.remove('is-concealed');
        return true;
    }

    function cachePreviousMedia(media, index, galleryId) {
        if (!media || index < 0 || galleryId !== state.galleryId) {
            releaseMedia(media);
            return;
        }
        dropPreparedMedia(index);
        preparedMedia.set(index, {
            galleryId,
            controller: null,
            media,
            promise: Promise.resolve(media)
        });
    }

    function requestNativeFallback(galleryId, index) {
        const key = `${galleryId}:${index}`;
        if (nativeFallbackKey === key) {
            return;
        }
        nativeFallbackKey = key;
        runAction('fallback-native', { galleryId, index }).then(result => {
            if (result?.ok !== true && nativeFallbackKey === key) {
                nativeFallbackKey = '';
            }
        });
    }

    async function renderSelected(forceResolve = false, playbackState = null) {
        const revision = ++renderRevision;
        const galleryId = state.galleryId;
        const index = state.index;
        const item = state.items[index];
        updateChrome();
        if (!item) {
            setLoading(false);
            setLoadError(true);
            requestNativeFallback(galleryId, index);
            return;
        }
        if (!forceResolve && activeMedia && activeIndex === index && activeGalleryId === galleryId) {
            applyVideoPlaybackState(activeMedia, playbackState);
            setLoading(false);
            setLoadError(false);
            revealSelectedMedia(galleryId, index);
            scheduleAdjacentPreload();
            return;
        }
        setLoadError(false);
        setLoading(true);
        activeMedia?.pause?.();
        const prepared = getPreparedMedia(index, forceResolve);
        if (!prepared) {
            setLoading(false);
            setLoadError(true);
            requestNativeFallback(galleryId, index);
            return;
        }
        let media;
        try {
            media = await prepared.promise;
        } catch (error) {
            if (revision !== renderRevision || galleryId !== state.galleryId || isAbortError(error)) {
                return;
            }
            setLoading(false);
            setLoadError(true);
            requestNativeFallback(galleryId, index);
            return;
        }
        if (revision !== renderRevision || galleryId !== state.galleryId || index !== state.index) {
            return;
        }
        preparedMedia.delete(index);
        const previousMedia = activeMedia;
        const previousIndex = activeIndex;
        const previousGalleryId = activeGalleryId;
        unbindActiveVideo();
        activeMedia = media;
        activeIndex = index;
        activeGalleryId = galleryId;
        nativeFallbackKey = '';
        mediaScale = 1;
        mediaRotation = 0;
        mediaOffsetX = 0;
        mediaOffsetY = 0;
        panState = null;
        slot.replaceChildren(media);
        media.classList.remove('is-entering');
        void media.offsetWidth;
        media.classList.add('is-entering');
        if (previousMedia && previousMedia !== media) {
            cachePreviousMedia(previousMedia, previousIndex, previousGalleryId);
        }
        if (item.type === 'video') {
            bindActiveVideo(media, playbackState);
        } else {
            updatePlayerControls();
        }
        fitMediaToStage();
        applyMediaTransform();
        revealSelectedMedia(galleryId, index);
        setLoading(false);
        setLoadError(false);
        scheduleAdjacentPreload();
        scheduleControlsHide();
    }

    function scheduleAdjacentPreload() {
        clearTimeout(preloadTimer);
        const galleryId = state.galleryId;
        const index = state.index;
        preloadTimer = window.setTimeout(() => {
            preloadTimer = 0;
            if (galleryId !== state.galleryId || index !== state.index) {
                return;
            }
            const retained = new Set([index - 1, index + 1].filter(value =>
                value >= 0 && value < state.items.length
            ));
            for (const mediaIndex of retained) {
                const item = state.items[mediaIndex];
                if (item?.src || item?.type === 'image') {
                    getPreparedMedia(mediaIndex, false, true)?.promise.catch(() => {});
                }
            }
            for (const mediaIndex of Array.from(preparedMedia.keys())) {
                if (!retained.has(mediaIndex)) {
                    dropPreparedMedia(mediaIndex);
                }
            }
        }, PRELOAD_DELAY_MS);
    }

    function formatDuration(value) {
        const total = Math.max(0, Math.floor(Number(value) || 0));
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const seconds = total % 60;
        return hours
            ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
            : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function getBufferedRatio(video) {
        if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.buffered.length) {
            return 0;
        }
        try {
            return Math.min(1, video.buffered.end(video.buffered.length - 1) / video.duration);
        } catch {
            return 0;
        }
    }

    function getVideoQuality(video) {
        const width = Number(video.videoWidth) || 0;
        const height = Number(video.videoHeight) || 0;
        const dimension = Math.min(width, height);
        if (!dimension) {
            return { badge: '', detail: '原始' };
        }
        const badge = dimension > 2000
            ? '4K'
            : dimension > 1000
                ? 'FHD'
                : dimension > 700
                    ? 'HD'
                    : 'SD';
        return { badge, detail: `原始 · ${dimension}p` };
    }

    function setVideoFullscreen(enabled) {
        const next = Boolean(enabled);
        viewer.classList.toggle('video-expanded', next);
        videoFullscreen.classList.toggle('is-fullscreen', next);
        videoFullscreen.setAttribute('aria-pressed', String(next));
        videoFullscreen.setAttribute('aria-label', next ? '退出全屏播放' : '全屏播放');
        if (activeMedia) {
            requestAnimationFrame(() => {
                fitMediaToStage();
                applyMediaTransform();
            });
        }
    }

    function updatePlayerControls() {
        const video = activeMedia?.tagName === 'VIDEO' ? activeMedia : null;
        if (!video) {
            playerControls.hidden = true;
            viewer.classList.remove('is-video');
            setVideoFullscreen(false);
            return;
        }
        viewer.classList.add('is-video');
        playerControls.hidden = false;
        const mediaDuration = Number.isFinite(video.duration) ? video.duration : 0;
        const playedRatio = mediaDuration > 0 ? Math.min(1, video.currentTime / mediaDuration) : 0;
        const bufferedRatio = Math.max(playedRatio, getBufferedRatio(video));
        currentTime.textContent = formatDuration(video.currentTime);
        duration.textContent = `−${formatDuration(Math.max(0, mediaDuration - (video.currentTime || 0)))}`;
        seek.value = String(Math.round(playedRatio * 1000));
        seek.style.setProperty('--played', `${playedRatio * 100}%`);
        seek.style.setProperty('--buffered', `${bufferedRatio * 100}%`);
        playPause.classList.toggle('is-playing', !video.paused && !video.ended);
        playPause.setAttribute('aria-label', video.paused ? '播放' : '暂停');
        const muted = video.muted || video.volume === 0;
        volumeToggle.classList.toggle('is-muted', muted);
        volumeToggle.classList.toggle('is-low', !muted && video.volume < 0.5);
        volumeToggle.setAttribute('aria-label', muted ? '取消静音' : '静音');
        volume.value = String(video.volume);
        volume.style.setProperty('--volume', `${(muted ? 0 : video.volume) * 100}%`);
        const rate = Number(video.playbackRate) || 1;
        const speedText = `${rate}x`;
        speedBadge.textContent = speedText;
        speedBadge.hidden = Math.abs(rate - 1) < 0.01;
        for (const option of speedOptions) {
            option.classList.toggle('is-selected', Math.abs(Number(option.dataset.speed) - rate) < 0.01);
            option.setAttribute('aria-pressed', String(Math.abs(Number(option.dataset.speed) - rate) < 0.01));
        }
        const quality = getVideoQuality(video);
        qualityBadge.textContent = quality.badge;
        qualityBadge.hidden = !quality.badge;
        qualityLabel.textContent = quality.detail;
        pictureInPicture.hidden = false;
    }

    function unbindActiveVideo() {
        activeVideoCleanup?.();
        activeVideoCleanup = null;
    }

    function applyVideoPlaybackState(video, playbackState) {
        if (video?.tagName !== 'VIDEO' || !playbackState) {
            return false;
        }
        video.volume = playbackState.volume;
        video.muted = playbackState.muted;
        video.playbackRate = playbackState.playbackRate;
        if (Number.isFinite(video.duration) && video.duration > 0) {
            video.currentTime = Math.min(playbackState.currentTime, video.duration);
        } else {
            video.currentTime = playbackState.currentTime;
        }
        saveVolume(video.volume);
        savedPlaybackRate = video.playbackRate;
        try {
            localStorage.setItem('qqnt-toolbox-media-playback-rate', String(savedPlaybackRate));
        } catch {
        }
        if (playbackState.paused) {
            video.pause();
        } else {
            video.play().catch(() => updatePlayerControls());
        }
        updatePlayerControls();
        return true;
    }

    function bindActiveVideo(video, playbackState = null) {
        video.volume = savedVolume;
        video.playbackRate = savedPlaybackRate;
        const listeners = [];
        const on = (name, listener) => {
            video.addEventListener(name, listener);
            listeners.push([name, listener]);
        };
        const update = () => updatePlayerControls();
        on('timeupdate', update);
        on('durationchange', update);
        on('progress', update);
        on('volumechange', update);
        on('ratechange', update);
        on('play', () => {
            setLoading(false);
            update();
            scheduleControlsHide();
        });
        on('pause', () => {
            update();
            showControls(false);
        });
        on('waiting', () => setLoading(true));
        on('playing', () => setLoading(false));
        on('ended', () => {
            update();
            showControls(false);
        });
        on('click', event => {
            event.stopPropagation();
            togglePlayback();
        });
        activeVideoCleanup = () => {
            video.pause();
            for (const [name, listener] of listeners) {
                video.removeEventListener(name, listener);
            }
            playerControls.hidden = true;
        };
        update();
        if (!applyVideoPlaybackState(video, playbackState)) {
            video.play().catch(() => updatePlayerControls());
        }
    }

    function togglePlayback() {
        const video = activeMedia?.tagName === 'VIDEO' ? activeMedia : null;
        if (!video) {
            return;
        }
        if (video.paused || video.ended) {
            video.play().catch(() => {});
        } else {
            video.pause();
        }
        showControls(false);
    }

    function seekRelative(seconds) {
        const video = activeMedia?.tagName === 'VIDEO' ? activeMedia : null;
        if (!video || !Number.isFinite(video.duration)) {
            return;
        }
        video.currentTime = Math.min(Math.max(video.currentTime + seconds, 0), video.duration);
        updatePlayerControls();
        showControls();
    }

    function getRotationFit() {
        if (!activeMedia || Math.abs(mediaRotation / 90) % 2 !== 1) {
            return 1;
        }
        const width = activeMedia.offsetWidth || 1;
        const height = activeMedia.offsetHeight || 1;
        return Math.min(1, slot.clientWidth / height, slot.clientHeight / width);
    }

    function readViewerLength(name) {
        const value = Number.parseFloat(getComputedStyle(viewer).getPropertyValue(name));
        return Number.isFinite(value) ? value : 0;
    }

    function updateMediaStageGeometry() {
        const isVideo = activeMedia?.tagName === 'VIDEO';
        if (!isVideo || viewer.classList.contains('video-expanded')) {
            viewer.style.setProperty('--media-stage-top', '0px');
            return;
        }
        const bottomSkip = readViewerLength('--player-height') +
            2 * readViewerLength('--player-gap');
        const sourceHeight = Number(activeMedia.videoHeight) || 0;
        const topSkip = Math.min(
            Math.max(MEDIA_STAGE_MIN_TOP, viewer.clientHeight - sourceHeight - bottomSkip),
            bottomSkip
        );
        viewer.style.setProperty('--media-stage-top', `${topSkip}px`);
    }

    function fitMediaToStage() {
        if (!activeMedia) {
            return;
        }
        updateMediaStageGeometry();
        const isVideo = activeMedia.tagName === 'VIDEO';
        const sourceWidth = isVideo ? activeMedia.videoWidth : activeMedia.naturalWidth;
        const sourceHeight = isVideo ? activeMedia.videoHeight : activeMedia.naturalHeight;
        const availableWidth = slot.clientWidth;
        const availableHeight = slot.clientHeight;
        if (sourceWidth <= 0 || sourceHeight <= 0 || availableWidth <= 0 || availableHeight <= 0) {
            return;
        }
        const fitScale = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
        const scale = isVideo ? fitScale : Math.min(1, fitScale);
        activeMedia.style.width = `${sourceWidth * scale}px`;
        activeMedia.style.height = `${sourceHeight * scale}px`;
    }

    function getPanBounds() {
        if (!activeMedia) {
            return { x: 0, y: 0, pannable: false };
        }
        const effectiveScale = mediaScale * getRotationFit();
        const rotated = Math.abs(mediaRotation / 90) % 2 === 1;
        const width = (rotated ? activeMedia.offsetHeight : activeMedia.offsetWidth) * effectiveScale;
        const height = (rotated ? activeMedia.offsetWidth : activeMedia.offsetHeight) * effectiveScale;
        const x = Math.max(0, (width - slot.clientWidth) / 2);
        const y = Math.max(0, (height - slot.clientHeight) / 2);
        return { x, y, pannable: x > 0.5 || y > 0.5 };
    }

    function applyMediaTransform() {
        if (!activeMedia) {
            slot.classList.remove('is-pannable', 'is-panning');
            return;
        }
        const bounds = getPanBounds();
        mediaOffsetX = Math.min(Math.max(mediaOffsetX, -bounds.x), bounds.x);
        mediaOffsetY = Math.min(Math.max(mediaOffsetY, -bounds.y), bounds.y);
        const effectiveScale = mediaScale * getRotationFit();
        activeMedia.style.transform = `translate3d(${mediaOffsetX}px, ${mediaOffsetY}px, 0) rotate(${mediaRotation}deg) scale(${effectiveScale})`;
        slot.classList.toggle('is-pannable', bounds.pannable);
        if (!bounds.pannable) {
            panState = null;
            slot.classList.remove('is-panning');
        }
    }

    function zoomAt(nextScale, clientX = stage.clientWidth / 2, clientY = stage.clientHeight / 2) {
        if (!activeMedia) {
            return;
        }
        nextScale = Math.min(Math.max(nextScale, MIN_SCALE), MAX_SCALE);
        const ratio = nextScale / mediaScale;
        const rect = slot.getBoundingClientRect();
        const pointerX = clientX - rect.left - rect.width / 2;
        const pointerY = clientY - rect.top - rect.height / 2;
        mediaOffsetX = pointerX - (pointerX - mediaOffsetX) * ratio;
        mediaOffsetY = pointerY - (pointerY - mediaOffsetY) * ratio;
        mediaScale = nextScale;
        applyMediaTransform();
        showControls();
    }

    function resetZoom() {
        mediaScale = 1;
        mediaOffsetX = 0;
        mediaOffsetY = 0;
        applyMediaTransform();
    }

    function formatTimestamp(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return '';
        }
        const date = new Date(numeric < 1e12 ? numeric * 1000 : numeric);
        if (!Number.isFinite(date.getTime())) {
            return '';
        }
        const now = new Date();
        const sameDay = date.getFullYear() === now.getFullYear() &&
            date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
        const time = new Intl.DateTimeFormat('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).format(date);
        if (sameDay) {
            return `今天 ${time}`;
        }
        const options = date.getFullYear() === now.getFullYear()
            ? { month: 'numeric', day: 'numeric' }
            : { year: 'numeric', month: 'numeric', day: 'numeric' };
        return `${new Intl.DateTimeFormat('zh-CN', options).format(date)} ${time}`;
    }

    function updateMetadata() {
        const item = state.items[state.index];
        mediaCount.textContent = state.items.length
            ? `${state.index + 1} / ${state.items.length}`
            : '';
        mediaSender.textContent = item?.senderName || '';
        mediaSender.hidden = !item?.senderName;
        const dateText = formatTimestamp(item?.timestamp);
        mediaDate.textContent = dateText;
        mediaDate.hidden = !dateText;
        mediaDate.classList.toggle('can-jump', item?.canJump === true);
        if (item?.canJump && dateText) {
            mediaDate.setAttribute('aria-label', `${dateText}，定位到消息`);
        } else {
            mediaDate.removeAttribute('aria-label');
        }
        mediaSeparator.hidden = !item?.senderName || !dateText;
        rotate.hidden = !item;
        menuSave.hidden = !item;
        showInFolder.hidden = !item;
        openExternal.hidden = !item;
        copyImage.hidden = item?.type !== 'image';
        scanQr.hidden = item?.type !== 'image' || state.qrScanEnabled !== true;
        jumpToMessage.hidden = item?.canJump !== true;
    }

    function updateNavigation() {
        const multiple = state.items.length > 1;
        previous.hidden = !multiple;
        next.hidden = !multiple;
        previous.disabled = state.index <= 0;
        next.disabled = state.index >= state.items.length - 1;
    }

    function updateChrome() {
        updateNavigation();
        updateMetadata();
        updatePlayerControls();
    }

    function navigateTo(index) {
        index = Math.min(Math.max(Number(index) || 0, 0), state.items.length - 1);
        if (index === state.index || index < 0) {
            return false;
        }
        state.index = index;
        wheelDelta = 0;
        setLoadError(false);
        closeMoreMenu();
        closePlayerSettings();
        bridge.action({ type: 'select', galleryId: state.galleryId, index }).catch(() => {});
        renderSelected().catch(() => {});
        showControls();
        return true;
    }

    function navigate(delta) {
        return navigateTo(state.index + delta);
    }

    function hideControls() {
        if (menuOpen || settingsMenuOpen || panState || rangeAdjusting || activeMedia?.tagName === 'VIDEO' && activeMedia.paused) {
            return;
        }
        controlsHidden = true;
        viewer.classList.add('controls-hidden');
    }

    function scheduleControlsHide() {
        clearTimeout(controlsTimer);
        controlsTimer = window.setTimeout(hideControls, CONTROL_HIDE_DELAY_MS);
    }

    function showControls(schedule = true) {
        if (controlsHidden) {
            controlsHidden = false;
            viewer.classList.remove('controls-hidden');
        }
        clearTimeout(controlsTimer);
        if (schedule) {
            scheduleControlsHide();
        }
    }

    function resetMoreMenuPosition() {
        moreMenu.classList.remove('is-context');
        moreMenu.style.removeProperty('--context-menu-left');
        moreMenu.style.removeProperty('--context-menu-top');
        moreMenu.style.removeProperty('--media-menu-origin-x');
        moreMenu.style.removeProperty('--media-menu-origin-y');
    }

    function closeMoreMenu(restoreFocus = false) {
        menuOpen = false;
        moreMenu.hidden = true;
        more.setAttribute('aria-expanded', 'false');
        resetMoreMenuPosition();
        if (restoreFocus) {
            viewer.focus({ preventScroll: true });
        }
        scheduleControlsHide();
    }

    function closePlayerSettings() {
        settingsMenuOpen = false;
        playerSettingsMenu.hidden = true;
        playerSettings.classList.remove('is-active');
        playerSettings.setAttribute('aria-expanded', 'false');
        scheduleControlsHide();
    }

    function positionMoreMenuAt(clientX, clientY) {
        moreMenu.classList.add('is-context');
        moreMenu.style.setProperty('--context-menu-left', '0px');
        moreMenu.style.setProperty('--context-menu-top', '0px');
        const menuWidth = moreMenu.offsetWidth;
        const menuHeight = moreMenu.offsetHeight;
        const opensLeft = clientX + menuWidth + CONTEXT_MENU_MARGIN > window.innerWidth;
        const opensAbove = clientY + menuHeight + CONTEXT_MENU_MARGIN > window.innerHeight;
        const availableRight = Math.max(CONTEXT_MENU_MARGIN, window.innerWidth - menuWidth - CONTEXT_MENU_MARGIN);
        const availableBottom = Math.max(CONTEXT_MENU_MARGIN, window.innerHeight - menuHeight - CONTEXT_MENU_MARGIN);
        const left = Math.min(
            Math.max(CONTEXT_MENU_MARGIN, opensLeft ? clientX - menuWidth : clientX),
            availableRight
        );
        const top = Math.min(
            Math.max(CONTEXT_MENU_MARGIN, opensAbove ? clientY - menuHeight : clientY),
            availableBottom
        );
        moreMenu.style.setProperty('--context-menu-left', `${Math.round(left)}px`);
        moreMenu.style.setProperty('--context-menu-top', `${Math.round(top)}px`);
        moreMenu.style.setProperty('--media-menu-origin-x', opensLeft ? 'right' : 'left');
        moreMenu.style.setProperty('--media-menu-origin-y', opensAbove ? 'bottom' : 'top');
    }

    function openMoreMenu(position = null) {
        closePlayerSettings();
        resetMoreMenuPosition();
        menuOpen = true;
        moreMenu.hidden = false;
        more.setAttribute('aria-expanded', 'true');
        if (position) {
            positionMoreMenuAt(position.x, position.y);
        }
        showControls(false);
        moreMenu.querySelector('button:not([hidden])')?.focus({ preventScroll: true });
    }

    function toggleMoreMenu() {
        if (menuOpen) {
            closeMoreMenu(true);
        } else {
            openMoreMenu();
        }
    }

    function togglePlayerSettings() {
        closeMoreMenu();
        settingsMenuOpen = playerSettingsMenu.hidden;
        playerSettingsMenu.hidden = !settingsMenuOpen;
        playerSettings.classList.toggle('is-active', settingsMenuOpen);
        playerSettings.setAttribute('aria-expanded', String(settingsMenuOpen));
        showControls(false);
        if (settingsMenuOpen) {
            speedOptions.find(option => !option.hidden)?.focus({ preventScroll: true });
        }
    }

    function showToast(message) {
        message = normalizeText(message);
        if (!message) {
            return;
        }
        clearTimeout(toastTimer);
        toast.textContent = message;
        toast.hidden = false;
        toastTimer = window.setTimeout(() => {
            toast.hidden = true;
        }, 1800);
    }

    async function runAction(type, extra = {}) {
        if (type === 'scan-qr') {
            scanQr.setAttribute('aria-busy', 'true');
        }
        try {
            const result = await bridge.action({
                type,
                galleryId: state.galleryId,
                index: state.index,
                ...extra
            });
            if (type === 'scan-qr') {
                globalThis.qqntToolboxQrDialog?.show?.({
                    dark: true,
                    infos: result?.infos,
                    message: result?.message || (result?.ok === false ? '二维码识别失败' : ''),
                    onOpen: info => bridge.qrResultAction?.({
                        type: 'open',
                        url: info.url
                    }),
                    onCopy: content => bridge.qrResultAction?.({
                        type: 'copy',
                        text: content
                    })
                });
            } else if (result?.message) {
                showToast(result.message);
            }
            return result;
        } catch {
            if (type === 'scan-qr') {
                globalThis.qqntToolboxQrDialog?.show?.({
                    dark: true,
                    message: '二维码识别失败'
                });
            } else {
                showToast('操作失败');
            }
            return null;
        } finally {
            if (type === 'scan-qr') {
                scanQr.removeAttribute('aria-busy');
            }
        }
    }

    function applyState(payload) {
        if (payload?.hidden === true) {
            const presentationId = normalizeText(payload?.presentationId);
            resetMediaLifecycle({ clearStatus: true, conceal: true });
            state = createEmptyViewerState(state.background);
            globalThis.qqntToolboxQrDialog?.close?.();
            updateChrome();
            acknowledgePresentation(presentationId);
            return;
        }
        const presentationId = normalizeText(payload?.presentationId);
        const freshPresentation = Boolean(presentationId);
        if (freshPresentation) {
            resetMediaLifecycle({ clearStatus: true, conceal: true });
            state = createEmptyViewerState(state.background);
            globalThis.qqntToolboxQrDialog?.close?.();
        }
        const nextState = normalizeState(payload);
        const galleryChanged = nextState.galleryId !== state.galleryId;
        if (!freshPresentation && galleryChanged) {
            resetMediaLifecycle({ clearStatus: true, conceal: true });
        } else if (!freshPresentation) {
            const activeItemId = normalizeText(activeMedia?.dataset?.itemId);
            clearPreparedMedia();
            if (activeItemId) {
                const nextActiveIndex = nextState.items.findIndex(item => item.id === activeItemId);
                if (nextActiveIndex >= 0) {
                    activeIndex = nextActiveIndex;
                    activeMedia.dataset.index = String(nextActiveIndex);
                }
            }
        }
        state = nextState;
        viewer.dataset.background = state.background;
        updateChrome();
        acknowledgePresentation(presentationId);
        renderSelected(false, nextState.playback).catch(() => {});
        showControls();
        viewer.focus({ preventScroll: true });
    }

    previous.addEventListener('click', event => {
        event.stopPropagation();
        navigate(-1);
    });
    next.addEventListener('click', event => {
        event.stopPropagation();
        navigate(1);
    });
    minimize.addEventListener('click', event => {
        event.stopPropagation();
        concealMedia();
        activeMedia?.pause?.();
        runAction('minimize');
    });
    close.addEventListener('click', event => {
        event.stopPropagation();
        concealMedia();
        activeMedia?.pause?.();
        runAction('close');
    });
    retry.addEventListener('click', event => {
        event.stopPropagation();
        const item = state.items[state.index];
        if (item) {
            item.loadRevision += 1;
        }
        renderSelected(true).catch(() => {});
    });
    playPause.addEventListener('click', event => {
        event.stopPropagation();
        togglePlayback();
    });
    seek.addEventListener('input', () => {
        const video = activeMedia?.tagName === 'VIDEO' ? activeMedia : null;
        if (video && Number.isFinite(video.duration)) {
            video.currentTime = video.duration * Number(seek.value) / 1000;
            updatePlayerControls();
        }
    });
    videoFullscreen.addEventListener('click', event => {
        event.stopPropagation();
        if (activeMedia?.tagName !== 'VIDEO') {
            return;
        }
        setVideoFullscreen(!viewer.classList.contains('video-expanded'));
        showControls(false);
    });
    playerSettings.addEventListener('click', event => {
        event.stopPropagation();
        if (activeMedia?.tagName === 'VIDEO') {
            togglePlayerSettings();
        }
    });
    for (const option of speedOptions) {
        option.addEventListener('click', event => {
            event.stopPropagation();
            const video = activeMedia?.tagName === 'VIDEO' ? activeMedia : null;
            const rate = Number(option.dataset.speed);
            if (!video || !SPEEDS.includes(rate)) {
                return;
            }
            video.playbackRate = rate;
            savePlaybackRate(rate);
            updatePlayerControls();
            closePlayerSettings();
            showControls();
        });
    }
    volumeToggle.addEventListener('click', event => {
        event.stopPropagation();
        const video = activeMedia?.tagName === 'VIDEO' ? activeMedia : null;
        if (!video) {
            return;
        }
        if (video.muted || video.volume === 0) {
            video.muted = false;
            if (video.volume === 0) {
                video.volume = lastPositiveVolume;
            }
        } else {
            lastPositiveVolume = video.volume;
            video.muted = true;
        }
        updatePlayerControls();
    });
    volume.addEventListener('input', () => {
        const video = activeMedia?.tagName === 'VIDEO' ? activeMedia : null;
        if (!video) {
            return;
        }
        video.volume = Number(volume.value);
        video.muted = video.volume === 0;
        saveVolume(video.volume);
        updatePlayerControls();
    });
    pictureInPicture.addEventListener('click', async event => {
        event.stopPropagation();
        const video = activeMedia?.tagName === 'VIDEO' ? activeMedia : null;
        if (!video) {
            return;
        }
        const playback = {
            currentTime: video.currentTime,
            paused: video.paused,
            volume: video.volume,
            muted: video.muted,
            playbackRate: video.playbackRate
        };
        video.pause();
        const result = await runAction('open-pip', {
            playback,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight
        });
        if (result?.ok !== true && !playback.paused) {
            video.play().catch(() => {});
        }
    });
    for (const input of [seek, volume]) {
        input.addEventListener('pointerdown', () => {
            rangeAdjusting = true;
            showControls(false);
        });
        input.addEventListener('pointerup', () => {
            rangeAdjusting = false;
            scheduleControlsHide();
        });
    }
    save.addEventListener('click', event => {
        event.stopPropagation();
        runAction('save');
    });
    rotate.addEventListener('click', event => {
        event.stopPropagation();
        mediaRotation = (mediaRotation - 90) % 360;
        mediaScale = 1;
        mediaOffsetX = 0;
        mediaOffsetY = 0;
        applyMediaTransform();
        showControls();
    });
    more.addEventListener('click', event => {
        event.stopPropagation();
        toggleMoreMenu();
    });
    for (const [button, action] of [
        [jumpToMessage, 'jump-to-message'],
        [showInFolder, 'show-in-folder'],
        [openExternal, 'open-external'],
        [copyImage, 'copy-image'],
        [scanQr, 'scan-qr'],
        [menuSave, 'save']
    ]) {
        button.addEventListener('click', event => {
            event.stopPropagation();
            closeMoreMenu();
            runAction(action);
        });
    }
    moreMenu.addEventListener('keydown', event => {
        const items = Array.from(moreMenu.querySelectorAll('button:not([hidden])'));
        if (!items.length) {
            return;
        }
        const current = Math.max(0, items.indexOf(document.activeElement));
        let next = -1;
        if (event.key === 'ArrowDown') {
            next = (current + 1) % items.length;
        } else if (event.key === 'ArrowUp') {
            next = (current - 1 + items.length) % items.length;
        } else if (event.key === 'Home') {
            next = 0;
        } else if (event.key === 'End') {
            next = items.length - 1;
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            event.stopPropagation();
            return;
        } else {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        items[next].focus({ preventScroll: true });
    });
    mediaDate.addEventListener('click', event => {
        event.stopPropagation();
        if (state.items[state.index]?.canJump) {
            runAction('jump-to-message');
        }
    });

    slot.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.target !== activeMedia || !getPanBounds().pannable) {
            return;
        }
        panState = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            offsetX: mediaOffsetX,
            offsetY: mediaOffsetY,
            moved: false
        };
        slot.setPointerCapture?.(event.pointerId);
        slot.classList.add('is-panning');
        showControls(false);
        event.preventDefault();
        event.stopPropagation();
    });
    slot.addEventListener('pointermove', event => {
        if (!panState || panState.pointerId !== event.pointerId) {
            return;
        }
        const deltaX = event.clientX - panState.startX;
        const deltaY = event.clientY - panState.startY;
        if (!panState.moved && Math.hypot(deltaX, deltaY) < 4) {
            return;
        }
        panState.moved = true;
        mediaOffsetX = panState.offsetX + deltaX;
        mediaOffsetY = panState.offsetY + deltaY;
        applyMediaTransform();
        event.preventDefault();
        event.stopPropagation();
    });
    const finishPan = event => {
        if (!panState || panState.pointerId !== event.pointerId) {
            return;
        }
        const moved = panState.moved;
        try {
            slot.releasePointerCapture?.(event.pointerId);
        } catch {
        }
        panState = null;
        slot.classList.remove('is-panning');
        if (moved) {
            suppressCloseUntil = performance.now() + 300;
        }
        scheduleControlsHide();
        event.stopPropagation();
    };
    slot.addEventListener('pointerup', finishPan);
    slot.addEventListener('pointercancel', finishPan);
    viewer.addEventListener('pointermove', event => {
        const point = { x: event.clientX, y: event.clientY };
        if (!lastPointer || Math.hypot(point.x - lastPointer.x, point.y - lastPointer.y) >= 2) {
            lastPointer = point;
            showControls();
        }
    }, { passive: true });
    viewer.addEventListener('click', event => {
        const target = event.target instanceof Element ? event.target : null;
        if (settingsMenuOpen && !target?.closest('#player-settings-menu, #player-settings')) {
            closePlayerSettings();
            event.stopPropagation();
            return;
        }
        if (menuOpen && !target?.closest('#more-menu, #more')) {
            closeMoreMenu();
            event.stopPropagation();
            return;
        }
        if (performance.now() < suppressCloseUntil) {
            return;
        }
        const clickedMedia = target?.closest('.media-content');
        const interactiveTarget = target?.closest(
            '.chrome, .media-loading, .media-error, .media-toast'
        );
        if (clickedMedia?.tagName === 'VIDEO' || interactiveTarget) {
            return;
        }
        concealMedia();
        activeMedia?.pause?.();
        runAction('close');
    });
    viewer.addEventListener('wheel', event => {
        const control = event.target.closest?.('.player-controls, .media-menu, .media-actions');
        if (control) {
            return;
        }
        if (!Number.isFinite(event.deltaY) || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
            return;
        }
        event.preventDefault();
        if (event.ctrlKey) {
            wheelDelta = 0;
            const delta = Math.max(-160, Math.min(160, event.deltaY));
            zoomAt(mediaScale * Math.exp(-delta * 0.0018), event.clientX, event.clientY);
            return;
        }
        const now = performance.now();
        if (now < wheelLockedUntil) {
            wheelDelta = 0;
            return;
        }
        wheelDelta += event.deltaY;
        if (Math.abs(wheelDelta) < WHEEL_STEP) {
            return;
        }
        const direction = wheelDelta > 0 ? 1 : -1;
        wheelDelta = 0;
        if (navigate(direction)) {
            wheelLockedUntil = now + WHEEL_LOCK_MS;
        }
    }, { passive: false });
    viewer.addEventListener('contextmenu', event => {
        event.preventDefault();
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest('#more-menu')) {
            return;
        }
        const clickedMedia = target?.closest('.media-content');
        if (!activeMedia || clickedMedia !== activeMedia || !state.items[state.index]) {
            if (menuOpen) {
                closeMoreMenu();
            }
            return;
        }
        event.stopPropagation();
        openMoreMenu({ x: event.clientX, y: event.clientY });
    });
    viewer.addEventListener('dragstart', event => event.preventDefault());
    window.addEventListener('resize', () => {
        fitMediaToStage();
        applyMediaTransform();
    }, { passive: true });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            activeMedia?.pause?.();
        }
    });
    document.addEventListener('keydown', event => {
        if (event.defaultPrevented) {
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            if (settingsMenuOpen) {
                closePlayerSettings();
            } else if (menuOpen) {
                closeMoreMenu(true);
            } else if (viewer.classList.contains('video-expanded')) {
                setVideoFullscreen(false);
                showControls();
            } else {
                concealMedia();
                activeMedia?.pause?.();
                runAction('close');
            }
            return;
        }
        if (event.target instanceof HTMLInputElement) {
            return;
        }
        if (event.ctrlKey && event.key.toLowerCase() === 'f' && activeMedia?.tagName === 'VIDEO') {
            event.preventDefault();
            event.stopPropagation();
            setVideoFullscreen(!viewer.classList.contains('video-expanded'));
            showControls(false);
            return;
        }
        let handled = true;
        if (event.key === 'ArrowLeft') {
            navigate(-1);
        } else if (event.key === 'ArrowRight') {
            navigate(1);
        } else if (event.key === ' ' || event.key.toLowerCase() === 'k') {
            togglePlayback();
        } else if (event.key.toLowerCase() === 'j') {
            seekRelative(-10);
        } else if (event.key.toLowerCase() === 'l') {
            seekRelative(10);
        } else if (event.key.toLowerCase() === 'm') {
            volumeToggle.click();
        } else if (event.key === '+' || event.key === '=') {
            zoomAt(mediaScale * 1.25);
        } else if (event.key === '-') {
            zoomAt(mediaScale / 1.25);
        } else if (event.key === '0') {
            resetZoom();
        } else if (event.key.toLowerCase() === 'r' && activeMedia) {
            rotate.click();
        } else if (event.ctrlKey && event.key.toLowerCase() === 's') {
            runAction('save');
        } else if (event.key === 'Home') {
            navigateTo(0);
        } else if (event.key === 'End') {
            navigateTo(state.items.length - 1);
        } else {
            handled = false;
        }
        if (handled) {
            event.preventDefault();
            event.stopPropagation();
            showControls();
        }
    });
    window.addEventListener('beforeunload', () => {
        clearTimeout(controlsTimer);
        clearTimeout(toastTimer);
        resetMediaLifecycle();
    });

    bridge.onStateChanged(applyState);
    bridge.getState()
        .then(applyState)
        .catch(() => setLoadError(true));
})();
