'use strict';

(() => {
    const bridge = window.qqntToolboxMediaPip;
    if (!bridge) {
        return;
    }

    const shell = document.getElementById('pip-shell');
    const video = document.getElementById('pip-video');
    const loading = document.getElementById('pip-loading');
    const error = document.getElementById('pip-error');
    const playPause = document.getElementById('play-pause');
    const volumeToggle = document.getElementById('volume-toggle');
    const volume = document.getElementById('volume');
    const seek = document.getElementById('seek');
    const currentTime = document.getElementById('current-time');
    const remainingTime = document.getElementById('remaining-time');
    const enlarge = document.getElementById('enlarge');
    const close = document.getElementById('close');

    let state = { galleryId: '', index: 0 };
    let pendingPlayback = null;
    let lastPositiveVolume = 1;
    let dragState = null;
    let dragFrame = 0;
    let pendingDragOffset = null;
    let suppressPlaybackClick = false;

    const DRAG_THRESHOLD = 4;

    function normalizeText(value) {
        return String(value ?? '').trim();
    }

    function normalizePlayback(value) {
        const time = Number(value?.currentTime);
        const volumeValue = Number(value?.volume);
        const rate = Number(value?.playbackRate);
        return {
            currentTime: Number.isFinite(time) && time >= 0 ? time : 0,
            paused: value?.paused !== false,
            volume: Number.isFinite(volumeValue) ? Math.min(Math.max(volumeValue, 0), 1) : 1,
            muted: value?.muted === true,
            playbackRate: Number.isFinite(rate) ? Math.min(Math.max(rate, 0.25), 4) : 1
        };
    }

    function formatDuration(value) {
        const total = Math.max(0, Math.floor(Number(value) || 0));
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const seconds = total % 60;
        return hours
            ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
            : `${minutes}:${String(seconds).padStart(2, '0')}`;
    }

    function getBufferedRatio() {
        if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.buffered.length) {
            return 0;
        }
        try {
            return Math.min(1, video.buffered.end(video.buffered.length - 1) / video.duration);
        } catch {
            return 0;
        }
    }

    function snapshotPlayback() {
        return {
            currentTime: Number(video.currentTime) || 0,
            paused: video.paused,
            volume: Number(video.volume) || 0,
            muted: video.muted,
            playbackRate: Number(video.playbackRate) || 1
        };
    }

    function updateControls() {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        const played = duration > 0 ? Math.min(1, video.currentTime / duration) : 0;
        const buffered = Math.max(played, getBufferedRatio());
        currentTime.textContent = formatDuration(video.currentTime);
        remainingTime.textContent = `−${formatDuration(Math.max(0, duration - video.currentTime))}`;
        seek.value = String(Math.round(played * 1000));
        seek.style.setProperty('--played', `${played * 100}%`);
        seek.style.setProperty('--buffered', `${buffered * 100}%`);
        playPause.classList.toggle('is-playing', !video.paused && !video.ended);
        playPause.setAttribute('aria-label', video.paused ? '播放' : '暂停');
        shell.classList.toggle('is-paused', video.paused);
        const muted = video.muted || video.volume === 0;
        volumeToggle.classList.toggle('is-muted', muted);
        volumeToggle.classList.toggle('is-low', !muted && video.volume < 0.5);
        volumeToggle.setAttribute('aria-label', muted ? '取消静音' : '静音');
        volume.value = String(video.volume);
        volume.style.setProperty('--value', `${(muted ? 0 : video.volume) * 100}%`);
    }

    function applyPlayback(playback) {
        video.volume = playback.volume;
        video.muted = playback.muted;
        video.playbackRate = playback.playbackRate;
        if (video.volume > 0) {
            lastPositiveVolume = video.volume;
        }
        if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
            video.currentTime = Number.isFinite(video.duration)
                ? Math.min(playback.currentTime, video.duration)
                : playback.currentTime;
            pendingPlayback = null;
            if (playback.paused) {
                video.pause();
            } else {
                video.play().catch(() => updateControls());
            }
        } else {
            pendingPlayback = playback;
        }
        updateControls();
    }

    function applyState(payload) {
        if (payload?.hidden === true) {
            video.pause();
            return;
        }
        const item = payload?.item;
        const src = normalizeText(item?.src);
        if (item?.type !== 'video' || !src) {
            return;
        }
        state = {
            galleryId: normalizeText(payload.galleryId),
            index: Number(payload.index) || 0
        };
        const changed = video.dataset.src !== src;
        pendingPlayback = normalizePlayback(payload.playback);
        error.hidden = true;
        if (changed) {
            loading.hidden = false;
            video.pause();
            video.dataset.src = src;
            video.poster = normalizeText(item.previewSrc);
            video.src = src;
            video.load();
        } else {
            loading.hidden = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
            applyPlayback(pendingPlayback);
        }
    }

    function togglePlayback() {
        if (video.paused || video.ended) {
            video.play().catch(() => {});
        } else {
            video.pause();
        }
    }

    async function runAction(type) {
        const playback = snapshotPlayback();
        video.pause();
        try {
            const result = await bridge.action({
                type,
                galleryId: state.galleryId,
                index: state.index,
                playback
            });
            if (result?.ok !== true && !playback.paused) {
                video.play().catch(() => {});
            }
        } catch {
            if (!playback.paused) {
                video.play().catch(() => {});
            }
        }
    }

    function isInteractiveTarget(target) {
        return target instanceof Element && Boolean(target.closest('button, input'));
    }

    function flushDragOffset() {
        dragFrame = 0;
        if (!pendingDragOffset) {
            return;
        }
        bridge.drag({ phase: 'move', ...pendingDragOffset });
        pendingDragOffset = null;
    }

    function queueDragOffset(dx, dy) {
        pendingDragOffset = { dx, dy };
        if (!dragFrame) {
            dragFrame = window.requestAnimationFrame(flushDragOffset);
        }
    }

    function stopDragging(pointerId = dragState?.pointerId) {
        if (!dragState || pointerId !== dragState.pointerId) {
            return;
        }
        const wasDragging = dragState.started;
        const capturedPointerId = dragState.pointerId;
        dragState = null;
        if (dragFrame) {
            window.cancelAnimationFrame(dragFrame);
            dragFrame = 0;
        }
        if (wasDragging) {
            flushDragOffset();
            bridge.drag({ phase: 'end' });
        } else {
            pendingDragOffset = null;
        }
        shell.classList.remove('is-dragging');
        if (shell.hasPointerCapture?.(capturedPointerId)) {
            shell.releasePointerCapture(capturedPointerId);
        }
        if (wasDragging) {
            suppressPlaybackClick = true;
            window.setTimeout(() => {
                suppressPlaybackClick = false;
            }, 0);
        }
    }

    shell.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !event.isPrimary || isInteractiveTarget(event.target)) {
            return;
        }
        dragState = {
            pointerId: event.pointerId,
            pointerX: event.screenX,
            pointerY: event.screenY,
            started: false
        };
        shell.setPointerCapture?.(event.pointerId);
    });

    shell.addEventListener('pointermove', event => {
        if (!dragState || event.pointerId !== dragState.pointerId) {
            return;
        }
        if ((event.buttons & 1) === 0) {
            stopDragging(event.pointerId);
            return;
        }
        const offsetX = event.screenX - dragState.pointerX;
        const offsetY = event.screenY - dragState.pointerY;
        if (!dragState.started) {
            if (Math.hypot(offsetX, offsetY) < DRAG_THRESHOLD) {
                return;
            }
            dragState.started = true;
            bridge.drag({ phase: 'start' });
            shell.classList.add('is-dragging');
        }
        queueDragOffset(offsetX, offsetY);
        event.preventDefault();
    });

    shell.addEventListener('pointerup', event => stopDragging(event.pointerId));
    shell.addEventListener('pointercancel', event => stopDragging(event.pointerId));
    shell.addEventListener('lostpointercapture', () => {
        stopDragging();
    });
    shell.addEventListener('click', event => {
        if (suppressPlaybackClick) {
            suppressPlaybackClick = false;
            return;
        }
        if (!isInteractiveTarget(event.target)) {
            togglePlayback();
        }
    });

    for (const eventName of ['timeupdate', 'durationchange', 'progress', 'play', 'pause', 'volumechange', 'ratechange', 'ended']) {
        video.addEventListener(eventName, updateControls);
    }
    video.addEventListener('loadedmetadata', () => {
        if (pendingPlayback) {
            applyPlayback(pendingPlayback);
        }
        if (video.videoWidth > 0 && video.videoHeight > 0) {
            bridge.action({
                type: 'metadata',
                galleryId: state.galleryId,
                index: state.index,
                videoWidth: video.videoWidth,
                videoHeight: video.videoHeight
            }).catch(() => {});
        }
    });
    for (const eventName of ['canplay', 'playing']) {
        video.addEventListener(eventName, () => {
            loading.hidden = true;
            error.hidden = true;
        });
    }
    video.addEventListener('waiting', () => {
        loading.hidden = false;
    });
    video.addEventListener('error', () => {
        loading.hidden = true;
        error.hidden = false;
    });

    playPause.addEventListener('click', togglePlayback);
    volumeToggle.addEventListener('click', () => {
        if (video.muted || video.volume === 0) {
            video.muted = false;
            if (video.volume === 0) {
                video.volume = lastPositiveVolume;
            }
        } else {
            lastPositiveVolume = video.volume;
            video.muted = true;
        }
        updateControls();
    });
    volume.addEventListener('input', () => {
        video.volume = Number(volume.value);
        video.muted = video.volume === 0;
        if (video.volume > 0) {
            lastPositiveVolume = video.volume;
        }
        updateControls();
    });
    seek.addEventListener('input', () => {
        if (Number.isFinite(video.duration)) {
            video.currentTime = video.duration * Number(seek.value) / 1000;
            updateControls();
        }
    });
    enlarge.addEventListener('click', () => runAction('enlarge'));
    close.addEventListener('click', () => runAction('close'));

    shell.addEventListener('contextmenu', event => event.preventDefault());
    window.addEventListener('blur', () => stopDragging());
    window.addEventListener('beforeunload', () => {
        stopDragging();
        video.pause();
    });

    bridge.onStateChanged(applyState);
    bridge.getState().then(applyState).catch(() => {
        loading.hidden = true;
        error.hidden = false;
    });
})();
