'use strict';

const path = require('path');
const { fileURLToPath } = require('url');
const IMAGE_EXTENSIONS = new Set(['.apng', '.bmp', '.gif', '.jfif', '.jpeg', '.jpg', '.png', '.webp']);
const VIDEO_EXTENSIONS = new Set([
    '.3g2', '.3gp', '.asf', '.avi', '.flv', '.m2ts', '.m4v', '.mkv', '.mov', '.mp4', '.mpeg', '.mpg',
    '.mts', '.ogv', '.ts', '.vob', '.webm', '.wmv'
]);
const NATIVE_MEDIA_VIEWER_ROUTES = ['/image-viewer', '/video-viewer', '/media-viewer'];

function isNativeMediaViewerUrl(value) {
    const url = String(value || '').toLowerCase();
    return NATIVE_MEDIA_VIEWER_ROUTES.some(route => url.includes(route));
}

function classifyMediaFilePath(...values) {
    for (const value of values) {
        const extension = path.extname(String(value || '').trim()).toLowerCase();
        if (IMAGE_EXTENSIONS.has(extension)) {
            return 'image';
        }
        if (VIDEO_EXTENSIONS.has(extension)) {
            return 'video';
        }
    }
    return '';
}

function resolveLocalFilePath(value) {
    const source = String(value || '').trim();
    if (!source) {
        return '';
    }
    try {
        return path.normalize(source.startsWith('file:') ? fileURLToPath(source) : source);
    } catch {
        return '';
    }
}

function extractInlineMediaItem(media, sourceIndex) {
    const context = media?.context;
    if (!context) {
        return null;
    }
    const type = context.video?.path ? 'video' : 'image';
    const filePath = resolveLocalFilePath(type === 'video' ? context.video.path : context.sourcePath);
    if (!filePath || !path.isAbsolute(filePath)) {
        return null;
    }
    return {
        type,
        filePath,
        name: path.basename(filePath),
        sourceIndex,
        identity: {
            chatType: Number(context.chatType) || 0,
            peerUid: String(context.peerUid || ''),
            msgId: String(context.msgId || ''),
            msgSeq: String(context.msgSeq || ''),
            elementId: String(context.elementId || '')
        }
    };
}

function extractInlineMediaGallery(command) {
    const viewerData = Array.isArray(command?.payload) ? command.payload[0] : null;
    const mediaList = Array.isArray(viewerData?.mediaList) ? viewerData.mediaList : [];
    const sourceIndex = Number(viewerData?.index);
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= mediaList.length) {
        return null;
    }
    const items = mediaList
        .map((media, index) => extractInlineMediaItem(media, index))
        .filter(Boolean);
    const index = items.findIndex(item => item.sourceIndex === sourceIndex);
    return index >= 0 ? { items, index } : null;
}

function extractInlineMediaPreview(command) {
    const gallery = extractInlineMediaGallery(command);
    return gallery?.items[gallery.index] || null;
}

function normalizeInlineMediaOpenItem(value) {
    const filePath = resolveLocalFilePath(value?.filePath);
    const type = classifyMediaFilePath(value?.name, filePath);
    if (!type || !filePath || !path.isAbsolute(filePath)) {
        return null;
    }
    const identity = value?.identity || {};
    return {
        type,
        filePath,
        fingerprint: String(value?.fingerprint || '').trim().toLowerCase(),
        name: String(value?.name || '').trim() || path.basename(filePath),
        sourceIndex: Number.isInteger(Number(value?.sourceIndex)) ? Number(value.sourceIndex) : 0,
        identity: {
            chatType: Number(identity.chatType) || 0,
            peerUid: String(identity.peerUid || '').trim(),
            msgId: String(identity.msgId || '').trim(),
            msgSeq: String(identity.msgSeq || '').trim(),
            elementId: String(identity.elementId || '').trim()
        }
    };
}

function createInlineMediaDownloadRequest(item) {
    const identity = item?.identity || {};
    const request = {
        fileModelId: '0',
        downSourceType: 0,
        triggerType: 1,
        msgId: String(identity.msgId || '').trim(),
        chatType: Number(identity.chatType) || 0,
        peerUid: String(identity.peerUid || '').trim(),
        elementId: String(identity.elementId || '').trim(),
        thumbSize: 0,
        downloadType: 1,
        filePath: String(item?.filePath || '').trim()
    };
    return request.msgId && request.chatType && request.peerUid && request.elementId
        ? request
        : null;
}

function createInlineMediaDownloadPayload(item) {
    const getReq = createInlineMediaDownloadRequest(item);
    return getReq ? [{ getReq }, null] : null;
}

function getInlineMediaFingerprint(item) {
    const fingerprint = String(item?.fingerprint || '').replace(/[^a-f0-9]/gi, '').toLowerCase();
    if (fingerprint.length === 32) {
        return fingerprint;
    }
    return path.basename(String(item?.filePath || ''))
        .match(/[a-f0-9]{32}/i)?.[0]
        ?.toLowerCase() || '';
}

function getInlineMediaMessageKeys(value) {
    const identity = value?.identity || value || {};
    const keys = [];
    const msgId = String(identity.msgId || '').trim();
    const msgSeq = String(identity.msgSeq || '').trim();
    if (msgId && msgId !== '0') {
        keys.push(`id:${msgId}`);
    }
    if (msgSeq && msgSeq !== '0') {
        keys.push(`seq:${msgSeq}`);
    }
    return keys;
}

function isSameInlineMediaMessage(left, right) {
    const leftKeys = new Set(getInlineMediaMessageKeys(left));
    return getInlineMediaMessageKeys(right).some(key => leftKeys.has(key));
}

function hasSameInlineMediaContent(left, right) {
    if (!left || !right || left.type !== right.type) {
        return false;
    }
    const leftPath = path.normalize(String(left.filePath || '')).toLowerCase();
    const rightPath = path.normalize(String(right.filePath || '')).toLowerCase();
    if (leftPath && rightPath && leftPath === rightPath) {
        return true;
    }
    const leftFingerprint = getInlineMediaFingerprint(left);
    const rightFingerprint = getInlineMediaFingerprint(right);
    return Boolean(leftFingerprint && leftFingerprint === rightFingerprint);
}

function isSameInlineMediaItem(left, right) {
    if (!left || !right || left.type !== right.type) {
        return false;
    }
    const leftIdentity = left.identity || {};
    const rightIdentity = right.identity || {};
    const leftMsgId = String(leftIdentity.msgId || '').trim();
    const rightMsgId = String(rightIdentity.msgId || '').trim();
    if (leftMsgId && rightMsgId && leftMsgId !== rightMsgId) {
        return false;
    }
    const leftMsgSeq = String(leftIdentity.msgSeq || '').trim();
    const rightMsgSeq = String(rightIdentity.msgSeq || '').trim();
    if (leftMsgSeq && rightMsgSeq && leftMsgSeq !== rightMsgSeq) {
        return false;
    }
    const leftElementId = String(leftIdentity.elementId || '').trim();
    const rightElementId = String(rightIdentity.elementId || '').trim();
    if (leftMsgId && leftMsgId === rightMsgId && leftElementId && rightElementId &&
        leftElementId === rightElementId) {
        return true;
    }
    return hasSameInlineMediaContent(left, right);
}

function resolveInlineReplyPreview(item, rememberedItems, replySources) {
    let sourceIdentity = null;
    for (const key of getInlineMediaMessageKeys(item)) {
        sourceIdentity = replySources?.get?.(key) || null;
        if (sourceIdentity) {
            break;
        }
    }
    if (!sourceIdentity) {
        return item;
    }

    const remembered = Array.isArray(rememberedItems) ? rememberedItems : [];
    const ownMedia = remembered.find(candidate =>
        isSameInlineMediaMessage(candidate, item) && isSameInlineMediaItem(candidate, item)
    );
    if (ownMedia) {
        return item;
    }

    const sourceCandidates = remembered.filter(candidate =>
        candidate?.type === item?.type && isSameInlineMediaMessage(candidate, sourceIdentity)
    );
    return sourceCandidates.find(candidate => hasSameInlineMediaContent(candidate, item)) ||
        (sourceCandidates.length === 1 ? sourceCandidates[0] : item);
}

function mergeInlineMediaItems(baseItems, overlayItems) {
    const merged = [];
    for (const item of [...(baseItems || []), ...(overlayItems || [])]) {
        const index = merged.findIndex(existing => isSameInlineMediaItem(existing, item));
        if (index < 0) {
            merged.push(item);
            continue;
        }
        const existing = merged[index];
        merged[index] = {
            ...existing,
            ...item,
            fingerprint: item.fingerprint || existing.fingerprint || ''
        };
    }
    return merged;
}

module.exports = {
    classifyMediaFilePath,
    createInlineMediaDownloadPayload,
    createInlineMediaDownloadRequest,
    extractInlineMediaGallery,
    extractInlineMediaPreview,
    getInlineMediaMessageKeys,
    hasSameInlineMediaContent,
    isNativeMediaViewerUrl,
    isSameInlineMediaItem,
    mergeInlineMediaItems,
    normalizeInlineMediaOpenItem,
    resolveInlineReplyPreview
};
