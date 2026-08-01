'use strict';

const path = require('node:path');

const MIN_DOWNLOAD_TIMEOUT_MS = 65 * 1000;
const MAX_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;
const ESTIMATED_BYTES_PER_SECOND = 512 * 1024;

function normalizeText(value) {
    return value === undefined || value === null ? '' : String(value).trim();
}

function getExistingAbsolutePath(value) {
    const filePath = normalizeText(value);
    return filePath && path.isAbsolute(filePath) ? filePath : '';
}

function createPreservationDownloadPayload(record, element, media = {}, destinationPath = '') {
    const msgId = normalizeText(record?.msgId);
    const chatType = Number(record?.chatType) || 0;
    const peerUid = normalizeText(record?.peerUid || record?.peerUin);
    const elementId = normalizeText(element?.elementId);
    if (!msgId || !chatType || !peerUid || !elementId) {
        return null;
    }
    const requestedDestination = normalizeText(destinationPath);
    if (requestedDestination && !path.isAbsolute(requestedDestination)) {
        return null;
    }
    const filePath = requestedDestination || [
        media?.filePath,
        media?.sourcePath,
        media?.originPath,
        media?.localPath,
        media?.path
    ].map(getExistingAbsolutePath).find(Boolean) || '';
    return [{
        getReq: {
            fileModelId: '0',
            downSourceType: 0,
            downloadSourceType: 0,
            triggerType: 1,
            msgId,
            chatType,
            peerUid,
            elementId,
            thumbSize: 0,
            downloadType: 1,
            filePath
        }
    }, null];
}

function getPreservationDownloadTimeout(expectedBytes) {
    const bytes = Math.max(0, Number(expectedBytes) || 0);
    const estimate = Math.ceil(bytes / ESTIMATED_BYTES_PER_SECOND) * 1000 + 30 * 1000;
    return Math.min(MAX_DOWNLOAD_TIMEOUT_MS, Math.max(MIN_DOWNLOAD_TIMEOUT_MS, estimate));
}

module.exports = {
    MAX_DOWNLOAD_TIMEOUT_MS,
    MIN_DOWNLOAD_TIMEOUT_MS,
    createPreservationDownloadPayload,
    getPreservationDownloadTimeout
};
