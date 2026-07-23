'use strict';

const path = require('path');
const { fileURLToPath } = require('url');
const IMAGE_EXTENSIONS = new Set(['.apng', '.bmp', '.gif', '.jfif', '.jpeg', '.jpg', '.png', '.webp']);
const VIDEO_EXTENSIONS = new Set([
    '.3g2', '.3gp', '.asf', '.avi', '.flv', '.m2ts', '.m4v', '.mkv', '.mov', '.mp4', '.mpeg', '.mpg',
    '.mts', '.ogv', '.ts', '.vob', '.webm', '.wmv'
]);
const INLINE_PREVIEW_VIDEO_EXTENSIONS = new Set(['.m4v', '.mov', '.mp4', '.ogv', '.webm']);
const NATIVE_MEDIA_VIEWER_ROUTES = ['/image-viewer', '/video-viewer', '/media-viewer'];
const SOURCE_URL_PATTERN = /^(?:https?|appimg|local|blob):/i;
const DATA_IMAGE_URL_PATTERN = /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i;

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

function getMediaExtension(value) {
    const source = String(value || '').trim().split(/[?#]/, 1)[0];
    return source ? path.extname(source).toLowerCase() : '';
}

function isInlineMediaItemSupported(item) {
    const type = item?.type === 'video' || item?.type === 'image' ? item.type : '';
    if (!type) {
        return false;
    }
    const extension = [item?.filePath, item?.sourceUrl, item?.name]
        .map(getMediaExtension)
        .find(Boolean);
    return type === 'video'
        ? INLINE_PREVIEW_VIDEO_EXTENSIONS.has(extension)
        : IMAGE_EXTENSIONS.has(extension) || /^data:image\//i.test(String(item?.sourceUrl || ''));
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

function normalizeInlineMediaSourceUrl(value) {
    const source = String(value || '').trim();
    return SOURCE_URL_PATTERN.test(source) || DATA_IMAGE_URL_PATTERN.test(source)
        ? source
        : '';
}

function firstSourceUrl(...values) {
    for (const value of values) {
        const sourceUrl = normalizeInlineMediaSourceUrl(value);
        if (sourceUrl) {
            return sourceUrl;
        }
    }
    return '';
}

function firstAbsoluteFilePath(...values) {
    for (const value of values) {
        const filePath = resolveLocalFilePath(value);
        if (filePath && path.isAbsolute(filePath)) {
            return filePath;
        }
    }
    return '';
}

function normalizeInlineMediaVisit(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const element = value.element || value.ele;
    const msgId = String(value.msgId || '').trim();
    const chatType = Number(value.chatType) || 0;
    if (!msgId || !chatType || !element || typeof element !== 'object') {
        return null;
    }
    return {
        msgId,
        msgRandom: String(value.msgRandom || '').trim(),
        msgSeq: String(value.msgSeq || '').trim(),
        msgTime: String(value.msgTime || '').trim(),
        chatType,
        senderUid: String(value.senderUid || '').trim(),
        peerUid: String(value.peerUid || '').trim(),
        guildId: String(value.guildId || '').trim(),
        element
    };
}

function createInlineMediaVisitDownloadPayload(item) {
    const visit = normalizeInlineMediaVisit(item?.visit);
    if (!visit) {
        return null;
    }
    const { element, ...context } = visit;
    return [{
        downloadType: 1,
        thumbSize: 0,
        ...context,
        ele: element,
        useHttps: true
    }];
}

function extractInlineMediaItem(media, sourceIndex) {
    const context = media?.context;
    if (!context) {
        return null;
    }
    const identity = {
        chatType: Number(context.chatType || media?.chatType) || 0,
        peerUid: String(context.peerUid || media?.peerUid || '').trim(),
        msgId: String(context.msgId || media?.msgId || '').trim(),
        msgSeq: String(context.msgSeq || media?.msgSeq || '').trim(),
        msgTime: String(context.msgTime || media?.msgTime || '').trim(),
        guildId: String(context.guildId || media?.guildId || '').trim(),
        elementId: String(context.elementId || media?.elementId || '').trim()
    };
    const senderName = String(
        context.sendRemarkName || context.sendMemberName || context.sendNickName ||
        context.senderNick || context.senderName || context.senderUid || context.senderUin ||
        media?.sendRemarkName || media?.sendMemberName || media?.sendNickName ||
        media?.senderNick || media?.senderName || media?.senderUid || media?.senderUin || ''
    ).trim();
    const timestamp = Number(context.msgTime || context.timestamp || media?.msgTime || media?.timestamp);
    const fileSize = Number(
        context.video?.fileSize || context.fileSize || media?.fileSize
    );
    const hasVideo = Boolean(context.video && typeof context.video === 'object');
    const type = hasVideo ? 'video' : 'image';
    const sourceValues = hasVideo
        ? [
            context.video.path,
            context.video.filePath,
            context.video.sourcePath,
            context.video.originPath,
            context.video.localPath,
            context.video.remoteUrl,
            context.video.originUrl
        ]
        : [
            context.sourcePath,
            context.filePath,
            context.originPath,
            context.localPath,
            context.path,
            media?.sourcePath,
            media?.originPath,
            context.remoteUrl,
            context.originUrl,
            context.url,
            media?.remoteUrl,
            media?.originUrl
        ];
    const filePath = firstAbsoluteFilePath(...sourceValues);
    const sourceUrl = firstSourceUrl(...sourceValues);
    if (!filePath && !sourceUrl) {
        return null;
    }
    const previewValues = type === 'video' ? [
        context.sourcePath,
        context.coverPath,
        context.previewPath,
        context.coverUrl,
        context.previewUrl,
        media?.originPath
    ] : [];
    const previewSource = firstSourceUrl(...previewValues) || firstAbsoluteFilePath(...previewValues);
    const explicitName = String(
        context.video?.fileName || context.fileName || context.name || media?.fileName || media?.name || ''
    ).trim();
    return {
        type,
        ...(filePath ? { filePath } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(previewSource ? { previewSource } : {}),
        name: explicitName || path.basename(filePath) || (type === 'video' ? 'video.mp4' : 'image.png'),
        sourceIndex,
        identity,
        ...(senderName ? { senderName } : {}),
        ...(Number.isFinite(timestamp) && timestamp > 0 ? { timestamp } : {}),
        ...(Number.isFinite(fileSize) && fileSize > 0 ? { fileSize } : {})
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
    const candidatePath = resolveLocalFilePath(value?.filePath);
    const filePath = candidatePath && path.isAbsolute(candidatePath) ? candidatePath : '';
    const sourceUrl = normalizeInlineMediaSourceUrl(value?.sourceUrl) ||
        normalizeInlineMediaSourceUrl(value?.filePath);
    const identity = value?.identity || {};
    const normalizedIdentity = {
        chatType: Number(identity.chatType) || 0,
        peerUid: String(identity.peerUid || '').trim(),
        msgId: String(identity.msgId || '').trim(),
        msgSeq: String(identity.msgSeq || '').trim(),
        msgTime: String(identity.msgTime || '').trim(),
        guildId: String(identity.guildId || '').trim(),
        elementId: String(identity.elementId || '').trim()
    };
    const explicitType = value?.type === 'video' || value?.type === 'image' ? value.type : '';
    const type = explicitType || classifyMediaFilePath(value?.name, filePath, sourceUrl);
    const pendingFile = value?.pendingFile === true && normalizedIdentity.msgId && normalizedIdentity.elementId;
    if (!type || (!filePath && !sourceUrl && !pendingFile)) {
        return null;
    }
    const previewValue = value?.previewSource || value?.previewFilePath;
    const previewPath = resolveLocalFilePath(previewValue);
    const previewSource = normalizeInlineMediaSourceUrl(previewValue) ||
        (previewPath && path.isAbsolute(previewPath) ? previewPath : '');
    const senderName = String(value?.senderName || '').trim();
    const timestamp = Number(value?.timestamp);
    const fileSize = Number(value?.fileSize);
    return {
        type,
        ...(filePath ? { filePath } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(previewSource ? { previewSource } : {}),
        fingerprint: String(value?.fingerprint || '').trim().toLowerCase(),
        name: String(value?.name || '').trim() || path.basename(filePath) ||
            (type === 'video' ? 'video.mp4' : 'image.png'),
        sourceIndex: Number.isInteger(Number(value?.sourceIndex)) ? Number(value.sourceIndex) : 0,
        identity: normalizedIdentity,
        ...(senderName ? { senderName } : {}),
        ...(Number.isFinite(timestamp) && timestamp > 0 ? { timestamp } : {}),
        ...(Number.isFinite(fileSize) && fileSize > 0 ? { fileSize } : {}),
        ...(pendingFile ? { pendingFile: true } : {})
    };
}

function createInlineMediaDownloadRequest(item, triggerType = 0) {
    const identity = item?.identity || {};
    const filePath = resolveLocalFilePath(item?.filePath);
    const request = {
        fileModelId: '0',
        downSourceType: 0,
        triggerType: Number(triggerType) === 1 ? 1 : 0,
        msgId: String(identity.msgId || '').trim(),
        chatType: Number(identity.chatType) || 0,
        peerUid: String(identity.peerUid || '').trim(),
        elementId: String(identity.elementId || '').trim(),
        thumbSize: 0,
        downloadType: 1,
        filePath
    };
    return request.msgId && request.chatType && request.peerUid && request.elementId &&
        path.isAbsolute(request.filePath)
        ? request
        : null;
}

function createInlineMediaDownloadPayload(item, triggerType = 0) {
    const getReq = createInlineMediaDownloadRequest(item, triggerType);
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
    const leftPathValue = String(left.filePath || '').trim();
    const rightPathValue = String(right.filePath || '').trim();
    const leftPath = leftPathValue ? path.normalize(leftPathValue).toLowerCase() : '';
    const rightPath = rightPathValue ? path.normalize(rightPathValue).toLowerCase() : '';
    if (leftPath && rightPath && leftPath === rightPath) {
        return true;
    }
    const leftSourceUrl = normalizeInlineMediaSourceUrl(left.sourceUrl);
    const rightSourceUrl = normalizeInlineMediaSourceUrl(right.sourceUrl);
    if (leftSourceUrl && rightSourceUrl && leftSourceUrl === rightSourceUrl) {
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
    createInlineMediaVisitDownloadPayload,
    extractInlineMediaGallery,
    extractInlineMediaPreview,
    getInlineMediaMessageKeys,
    hasSameInlineMediaContent,
    isInlineMediaItemSupported,
    isNativeMediaViewerUrl,
    isSameInlineMediaItem,
    mergeInlineMediaItems,
    normalizeInlineMediaOpenItem,
    normalizeInlineMediaSourceUrl,
    normalizeInlineMediaVisit,
    resolveInlineReplyPreview
};
