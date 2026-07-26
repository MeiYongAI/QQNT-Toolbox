'use strict';

const MAX_MESSAGE_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_MESSAGE_IMAGE_COUNT = 100;
const DEFAULT_MESSAGE_IMAGE_FILE_NAME_PATTERN =
    '{source}-{yyyy}{MM}{dd}-{HH}{mm}{ss}';
const MAX_MESSAGE_IMAGE_FILE_NAME_PATTERN_LENGTH = 128;
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
    const normalizeName = value => String(value || '')
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
    const normalizeNumber = value => {
        const number = String(value || '').trim();
        return /^\d{5,20}$/.test(number) ? number : '';
    };
    return {
        data,
        count: Math.min(
            MAX_MESSAGE_IMAGE_COUNT,
            Math.max(1, Math.floor(Number(payload?.count) || 1))
        ),
        qqNumber: normalizeNumber(payload?.qqNumber),
        nickname: normalizeName(payload?.nickname),
        groupNumber: normalizeNumber(payload?.groupNumber),
        groupName: normalizeName(payload?.groupName)
    };
}

function normalizeMessageImageSettings(value = {}, pathApi = null) {
    const directory = String(value?.directory || '').trim().slice(0, 1024);
    const pattern = String(value?.fileNamePattern || '').trim().slice(
        0,
        MAX_MESSAGE_IMAGE_FILE_NAME_PATTERN_LENGTH
    );
    return {
        directory: directory && (!pathApi?.isAbsolute || pathApi.isAbsolute(directory))
            ? directory
            : '',
        fileNamePattern: pattern || DEFAULT_MESSAGE_IMAGE_FILE_NAME_PATTERN,
        autoCopy: value?.autoCopy === true
    };
}

function sanitizeMessageImageFileName(value) {
    let name = String(value || '')
        .trim()
        .replace(/\.png$/i, '')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
        .replace(/[. ]+$/g, '')
        .slice(0, 180);
    if (!name) {
        name = 'QQ消息';
    }
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
        name = `_${name}`;
    }
    return `${name}.png`;
}

function formatMessageImageFileName(
    now = new Date(),
    pattern = DEFAULT_MESSAGE_IMAGE_FILE_NAME_PATTERN,
    count = 1,
    metadata = {}
) {
    const pad = value => String(value).padStart(2, '0');
    const normalizedCount = Math.max(1, Math.floor(Number(count) || 1));
    const sourceNumber = String(metadata?.qqNumber || metadata?.groupNumber || '');
    const sourceName = String(metadata?.nickname || metadata?.groupName || '');
    const source = sourceName && sourceNumber
        ? `${sourceName}(${sourceNumber})`
        : sourceName || sourceNumber || (normalizedCount > 1 ? '多人消息' : '未知来源');
    const tokens = {
        yyyy: String(now.getFullYear()),
        MM: pad(now.getMonth() + 1),
        dd: pad(now.getDate()),
        HH: pad(now.getHours()),
        mm: pad(now.getMinutes()),
        ss: pad(now.getSeconds()),
        count: String(normalizedCount),
        source,
        qq_number: String(metadata?.qqNumber || ''),
        nickname: String(metadata?.nickname || ''),
        group_number: String(metadata?.groupNumber || ''),
        group_name: String(metadata?.groupName || '')
    };
    const template = String(pattern || '').trim() || DEFAULT_MESSAGE_IMAGE_FILE_NAME_PATTERN;
    const expanded = template.replace(
        /\{(yyyy|MM|dd|HH|mm|ss|count|source|qq_number|nickname|group_number|group_name)\}/g,
        (_match, token) => tokens[token]
    );
    return sanitizeMessageImageFileName(expanded);
}

function appendMessageImageFileNameCounter(fileName, counter, pathApi) {
    if (counter <= 1) {
        return fileName;
    }
    const extension = pathApi.extname(fileName) || '.png';
    return `${fileName.slice(0, -extension.length)} (${counter})${extension}`;
}

async function writeUniqueMessageImage(fsApi, pathApi, directory, fileName, data) {
    for (let counter = 1; counter <= 1000; counter += 1) {
        const filePath = pathApi.join(
            directory,
            appendMessageImageFileNameCounter(fileName, counter, pathApi)
        );
        try {
            await fsApi.writeFile(filePath, data, { flag: 'wx' });
            return filePath;
        } catch (error) {
            if (error?.code !== 'EEXIST') {
                throw error;
            }
        }
    }
    throw new Error('message-image-name-exhausted');
}

async function saveMessageImage({
    payload,
    settings,
    fs,
    app,
    path,
    clipboard,
    nativeImage
}) {
    const image = normalizeMessageImagePayload(payload);
    if (!image) {
        return { ok: false, reason: 'invalid-png' };
    }
    try {
        const normalizedSettings = normalizeMessageImageSettings(settings, path);
        const downloads = app?.getPath?.('downloads') || '';
        const directory = normalizedSettings.directory || downloads;
        if (!directory || !path?.isAbsolute?.(directory)) {
            throw new Error('message-image-directory-invalid');
        }
        if (directory && typeof fs?.mkdir === 'function') {
            await fs.mkdir(directory, { recursive: true });
        }
        const filePath = await writeUniqueMessageImage(
            fs,
            path,
            directory,
            formatMessageImageFileName(
                new Date(),
                normalizedSettings.fileNamePattern,
                image.count,
                image
            ),
            image.data
        );
        if (!normalizedSettings.autoCopy) {
            return { ok: true, filePath, count: image.count };
        }
        try {
            if (typeof nativeImage?.createFromBuffer !== 'function' ||
                typeof clipboard?.writeImage !== 'function') {
                throw new Error('clipboard-unavailable');
            }
            const clipboardImage = nativeImage.createFromBuffer(image.data);
            if (!clipboardImage || clipboardImage.isEmpty?.()) {
                throw new Error('clipboard-image-invalid');
            }
            clipboard.writeImage(clipboardImage);
            return { ok: true, filePath, count: image.count, copied: true };
        } catch (error) {
            return {
                ok: true,
                filePath,
                count: image.count,
                copied: false,
                copyError: error?.message || String(error)
            };
        }
    } catch (error) {
        return {
            ok: false,
            reason: 'save-failed',
            message: error?.message || String(error)
        };
    }
}

module.exports = {
    DEFAULT_MESSAGE_IMAGE_FILE_NAME_PATTERN,
    MAX_MESSAGE_IMAGE_BYTES,
    MAX_MESSAGE_IMAGE_COUNT,
    appendMessageImageFileNameCounter,
    formatMessageImageFileName,
    normalizeMessageImageSettings,
    normalizeMessageImagePayload,
    sanitizeMessageImageFileName,
    saveMessageImage,
    writeUniqueMessageImage
};
