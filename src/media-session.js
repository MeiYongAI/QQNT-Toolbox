'use strict';

function clampIndex(value, length) {
    const index = Number(value);
    if (!Number.isInteger(index) || length <= 0) {
        return 0;
    }
    return Math.min(Math.max(index, 0), length - 1);
}

function normalizeGallery(gallery, id = '') {
    const items = Array.isArray(gallery?.items) ? gallery.items.slice() : [];
    if (!items.length) {
        return null;
    }
    return {
        id: String(id || gallery?.id || ''),
        index: clampIndex(gallery?.index, items.length),
        items
    };
}

function createMediaSessionController(options = {}) {
    const createId = options.createId;
    const isSameItem = options.isSameItem;
    if (typeof createId !== 'function' || typeof isSameItem !== 'function') {
        throw new TypeError('Media session controller requires createId and isSameItem functions.');
    }

    let active = null;
    let stagedForward = null;

    function get(sourceWindow = null, galleryId = '') {
        if (!active || (sourceWindow && active.sourceWindow !== sourceWindow) ||
            (galleryId && active.gallery.id !== String(galleryId))) {
            return null;
        }
        return active;
    }

    function begin(sourceWindow, gallery, sessionOptions = {}) {
        const normalized = normalizeGallery(gallery, sessionOptions.id || gallery?.id || createId());
        if (!sourceWindow || !normalized?.id) {
            return null;
        }
        active = {
            sourceWindow,
            gallery: normalized,
            viewerItems: Array.isArray(sessionOptions.viewerItems) &&
                sessionOptions.viewerItems.length === normalized.items.length
                ? sessionOptions.viewerItems.slice()
                : [],
            nativeFallback: sessionOptions.nativeFallback || null
        };
        if (stagedForward?.sourceWindow === sourceWindow) {
            stagedForward = null;
        }
        return active;
    }

    function clear(sourceWindow = null) {
        if (!active || (sourceWindow && active.sourceWindow !== sourceWindow)) {
            return false;
        }
        active = null;
        return true;
    }

    function clearAll() {
        active = null;
        stagedForward = null;
    }

    function setViewerItems(session, items) {
        if (!session || active !== session || !Array.isArray(items) ||
            items.length !== session.gallery.items.length) {
            return false;
        }
        session.viewerItems = items.slice();
        session.gallery.index = clampIndex(session.gallery.index, session.gallery.items.length);
        return true;
    }

    function patchViewerItem(sourceWindow, galleryId, index, patch) {
        const session = get(sourceWindow, galleryId);
        const itemIndex = Number(index);
        if (!session || !Number.isInteger(itemIndex) || !session.viewerItems[itemIndex] ||
            !patch || typeof patch !== 'object') {
            return false;
        }
        Object.assign(session.viewerItems[itemIndex], patch);
        return true;
    }

    function select(sourceWindow, galleryId, index) {
        const session = get(sourceWindow, galleryId);
        const itemIndex = Number(index);
        if (!session || !Number.isInteger(itemIndex) || itemIndex < 0 ||
            itemIndex >= session.gallery.items.length) {
            return false;
        }
        session.gallery.index = itemIndex;
        return true;
    }

    function getSelection(sourceWindow, galleryId, index) {
        const session = get(sourceWindow, galleryId);
        const itemIndex = Number(index);
        if (!session || !Number.isInteger(itemIndex) || itemIndex < 0 ||
            itemIndex >= session.gallery.items.length) {
            return null;
        }
        return {
            session,
            sourceWindow: session.sourceWindow,
            gallery: session.gallery,
            index: itemIndex,
            item: session.gallery.items[itemIndex],
            viewerItem: session.viewerItems[itemIndex] || null
        };
    }

    function findItem(sourceWindow, item) {
        const session = get(sourceWindow);
        if (!session) {
            return -1;
        }
        return session.gallery.items.findIndex(candidate => isSameItem(candidate, item));
    }

    function containsAll(sourceWindow, items) {
        const session = get(sourceWindow);
        return Boolean(session && Array.isArray(items) && items.every(item =>
            session.gallery.items.some(candidate => isSameItem(candidate, item))
        ));
    }

    function takeNativeFallback(sourceWindow, galleryId) {
        const session = get(sourceWindow, galleryId);
        if (!session) {
            return null;
        }
        const fallback = session.nativeFallback;
        session.nativeFallback = null;
        return fallback;
    }

    function stageForward(sourceWindow, gallery) {
        const normalized = normalizeGallery(gallery);
        stagedForward = sourceWindow && normalized
            ? { sourceWindow, gallery: normalized }
            : null;
        return Boolean(stagedForward);
    }

    function clearStagedForward(sourceWindow = null) {
        if (!stagedForward || (sourceWindow && stagedForward.sourceWindow !== sourceWindow)) {
            return false;
        }
        stagedForward = null;
        return true;
    }

    function consumeStagedForward(sourceWindow, selectedItem) {
        if (!stagedForward || stagedForward.sourceWindow !== sourceWindow) {
            return null;
        }
        const staged = stagedForward;
        stagedForward = null;
        return isSameItem(staged.gallery.items[staged.gallery.index], selectedItem)
            ? staged.gallery
            : null;
    }

    function getPublicState(background = 'black') {
        return active ? {
            galleryId: active.gallery.id,
            index: active.gallery.index,
            items: active.viewerItems.map(item => ({ ...item })),
            background
        } : {
            galleryId: '',
            index: 0,
            items: [],
            background
        };
    }

    return {
        begin,
        clear,
        clearAll,
        clearStagedForward,
        consumeStagedForward,
        containsAll,
        findItem,
        get,
        getPublicState,
        getSelection,
        patchViewerItem,
        select,
        setViewerItems,
        stageForward,
        takeNativeFallback
    };
}

function createMediaTaskRegistry() {
    const tasksBySource = new WeakMap();

    function getTasks(sourceWindow, create = false) {
        let tasks = sourceWindow && tasksBySource.get(sourceWindow);
        if (!tasks && create && sourceWindow) {
            tasks = new Map();
            tasksBySource.set(sourceWindow, tasks);
        }
        return tasks || null;
    }

    function taskKey(kind, itemKey) {
        return `${kind}:${itemKey}`;
    }

    function get(sourceWindow, kind, itemKey) {
        return getTasks(sourceWindow)?.get(taskKey(kind, itemKey)) || null;
    }

    function set(sourceWindow, kind, itemKey, entry) {
        if (!sourceWindow || !kind || !itemKey || !entry) {
            return false;
        }
        getTasks(sourceWindow, true).set(taskKey(kind, itemKey), entry);
        if (entry.promise && typeof entry.promise.then === 'function') {
            entry.promise.then(
                () => remove(sourceWindow, kind, itemKey, entry),
                () => remove(sourceWindow, kind, itemKey, entry)
            );
        }
        return true;
    }

    function remove(sourceWindow, kind, itemKey, expectedEntry = null) {
        const tasks = getTasks(sourceWindow);
        const key = taskKey(kind, itemKey);
        if (!tasks || (expectedEntry && tasks.get(key) !== expectedEntry)) {
            return false;
        }
        const removed = tasks.delete(key);
        if (!tasks.size) {
            tasksBySource.delete(sourceWindow);
        }
        return removed;
    }

    function disposeEntry(entry, error) {
        entry?.cancel?.(error);
        entry?.reject?.(error);
    }

    function clearKind(sourceWindow, kind, error = null) {
        const tasks = getTasks(sourceWindow);
        if (!tasks) {
            return 0;
        }
        const reason = error || new Error(`Pending ${kind} task was replaced.`);
        let removed = 0;
        for (const [key, entry] of tasks) {
            if (!key.startsWith(`${kind}:`)) {
                continue;
            }
            tasks.delete(key);
            disposeEntry(entry, reason);
            removed += 1;
        }
        if (!tasks.size) {
            tasksBySource.delete(sourceWindow);
        }
        return removed;
    }

    function clear(sourceWindow, error = null) {
        const tasks = getTasks(sourceWindow);
        if (!tasks) {
            return 0;
        }
        const entries = Array.from(new Set(tasks.values()));
        tasksBySource.delete(sourceWindow);
        const reason = error || new Error('Pending media tasks were cancelled.');
        for (const entry of entries) {
            disposeEntry(entry, reason);
        }
        return entries.length;
    }

    function replaceKind(sourceWindow, kind, itemKey, entry, error = null) {
        clearKind(sourceWindow, kind, error);
        return set(sourceWindow, kind, itemKey, entry);
    }

    return { clear, clearKind, get, replaceKind, set };
}

module.exports = {
    createMediaSessionController,
    createMediaTaskRegistry
};
