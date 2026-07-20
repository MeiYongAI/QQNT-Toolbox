'use strict';

const path = require('path');
const { fileURLToPath } = require('url');

const RESOURCE_URL_PATTERN = /^(?:https?|appimg|local|blob|file):/i;
const FILE_URL_PATTERN = /^file:/i;
const DATA_IMAGE_URL_PATTERN = /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i;

function normalizeText(value) {
    const text = String(value ?? '').trim();
    return text && text !== 'undefined' && text !== 'null' && text !== '0' ? text : '';
}

function normalizeResourceUrl(value) {
    const text = normalizeText(value);
    return RESOURCE_URL_PATTERN.test(text) || DATA_IMAGE_URL_PATTERN.test(text) ? text : '';
}

function normalizeLocalPath(value) {
    const text = normalizeText(value);
    if (!text || (RESOURCE_URL_PATTERN.test(text) && !FILE_URL_PATTERN.test(text)) ||
        DATA_IMAGE_URL_PATTERN.test(text)) {
        return '';
    }
    try {
        return path.normalize(text.startsWith('file:') ? fileURLToPath(text) : text);
    } catch {
        return '';
    }
}

function isMarketFaceElement(element) {
    return Boolean(element?.marketFaceElement) || Number(element?.elementType) === 11;
}

function getMarketFaceData(element) {
    return element?.marketFaceElement || (Number(element?.elementType) === 11 ? element : null);
}

function collectEmojiImageSources(face, fallbackValues = []) {
    const data = face && typeof face === 'object' ? face : {};
    const values = [
        data.staticFacePath,
        data.dynamicFacePath,
        data.sourcePath,
        data.filePath,
        data.localPath,
        data.path,
        data.originImageUrl,
        data.emojiWebUrl,
        ...fallbackValues
    ];
    const localPaths = [];
    const remoteUrls = [];
    const seenLocal = new Set();
    const seenRemote = new Set();
    for (const value of values) {
        const text = normalizeText(value);
        if (!text) {
            continue;
        }
        const localPath = normalizeLocalPath(text);
        if (localPath && path.isAbsolute(localPath) && !seenLocal.has(localPath.toLowerCase())) {
            seenLocal.add(localPath.toLowerCase());
            localPaths.push(localPath);
            continue;
        }
        const resourceUrl = normalizeResourceUrl(text);
        if (resourceUrl && !seenRemote.has(resourceUrl)) {
            seenRemote.add(resourceUrl);
            remoteUrls.push(resourceUrl);
        }
    }
    return { localPaths, remoteUrls };
}

function sanitizeMarketFaceData(face) {
    const data = face && typeof face === 'object' ? face : {};
    return {
        emojiId: normalizeText(data.emojiId),
        emojiPackageId: Number(data.emojiPackageId) || 0,
        faceName: normalizeText(data.faceName),
        key: normalizeText(data.key),
        staticFacePath: normalizeLocalPath(data.staticFacePath) || normalizeResourceUrl(data.staticFacePath),
        dynamicFacePath: normalizeLocalPath(data.dynamicFacePath) || normalizeResourceUrl(data.dynamicFacePath),
        imageWidth: Number(data.imageWidth) || 0,
        imageHeight: Number(data.imageHeight) || 0
    };
}

function buildEmojiMediaViewerPayload({ sourcePath = '', sourceUrl = '', name = '', width = 0, height = 0 } = {}) {
    const localPath = normalizeLocalPath(sourcePath);
    const source = localPath || normalizeResourceUrl(sourcePath) || normalizeResourceUrl(sourceUrl);
    if (!source) {
        return null;
    }
    const context = {
        sourcePath: source,
        originPath: source,
        fileName: normalizeText(name) || 'emoji.png',
        picWidth: Number(width) || 0,
        picHeight: Number(height) || 0
    };
    return [{
        mediaList: [{
            context,
            originPath: source
        }],
        index: 0
    }];
}

module.exports = {
    buildEmojiMediaViewerPayload,
    collectEmojiImageSources,
    getMarketFaceData,
    isMarketFaceElement,
    normalizeResourceUrl,
    normalizeLocalPath,
    sanitizeMarketFaceData
};
