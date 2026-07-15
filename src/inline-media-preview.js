'use strict';

const path = require('path');
const { fileURLToPath } = require('url');
const IMAGE_EXTENSIONS = new Set(['.apng', '.bmp', '.gif', '.jfif', '.jpeg', '.jpg', '.png', '.webp']);
const VIDEO_EXTENSIONS = new Set([
    '.3g2', '.3gp', '.asf', '.avi', '.flv', '.m2ts', '.m4v', '.mkv', '.mov', '.mp4', '.mpeg', '.mpg',
    '.mts', '.ogv', '.ts', '.vob', '.webm', '.wmv'
]);

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
    const originPath = String(media.originPath || '').trim();
    const localUrl = `local:///${filePath.replace(/\\/g, '/')}`;
    const imageUrl = /^(?:appimg|local):\/\//i.test(originPath) ? originPath : localUrl;
    return {
        type,
        filePath,
        src: type === 'video' ? localUrl : imageUrl,
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

module.exports = {
    classifyMediaFilePath,
    extractInlineMediaGallery,
    extractInlineMediaPreview
};
