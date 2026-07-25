'use strict';

const MAX_MESSAGE_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_MESSAGE_IMAGE_COUNT = 100;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function toBuffer(value) {
    if (Buffer.isBuffer(value)) {
        return Buffer.from(value);
    }
    if (value instanceof ArrayBuffer) {
        return Buffer.from(value);
    }
    if (ArrayBuffer.isView(value)) {
        return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }
    return null;
}

function normalizeMessageImagePayload(payload) {
    const data = toBuffer(payload?.data);
    if (!data || data.length < PNG_SIGNATURE.length || data.length > MAX_MESSAGE_IMAGE_BYTES ||
        !data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
        return null;
    }
    return {
        data,
        count: Math.min(
            MAX_MESSAGE_IMAGE_COUNT,
            Math.max(1, Math.floor(Number(payload?.count) || 1))
        )
    };
}

function formatMessageImageFileName(now = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    return `QQ消息-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
        `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`;
}

async function saveMessageImage({ browserWindow, payload, dialog, fs, app, path }) {
    const image = normalizeMessageImagePayload(payload);
    if (!image) {
        return { ok: false, reason: 'invalid-png' };
    }
    try {
        const downloads = app?.getPath?.('downloads') || '';
        const result = await dialog.showSaveDialog(browserWindow, {
            title: '保存消息图片',
            defaultPath: path.join(downloads, formatMessageImageFileName()),
            properties: ['dontAddToRecent'],
            filters: [{ name: 'PNG 图片', extensions: ['png'] }]
        });
        if (result.canceled || !result.filePath) {
            return { ok: false, canceled: true, reason: 'canceled' };
        }
        await fs.writeFile(result.filePath, image.data);
        return { ok: true, filePath: result.filePath, count: image.count };
    } catch (error) {
        return {
            ok: false,
            reason: 'save-failed',
            message: error?.message || String(error)
        };
    }
}

module.exports = {
    MAX_MESSAGE_IMAGE_BYTES,
    MAX_MESSAGE_IMAGE_COUNT,
    formatMessageImageFileName,
    normalizeMessageImagePayload,
    saveMessageImage
};
