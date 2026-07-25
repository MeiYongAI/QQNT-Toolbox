'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
    DEFAULT_MESSAGE_IMAGE_FILE_NAME_PATTERN,
    appendMessageImageFileNameCounter,
    formatMessageImageFileName,
    normalizeMessageImageSettings,
    normalizeMessageImagePayload,
    sanitizeMessageImageFileName,
    saveMessageImage
} = require('../src/message-image');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function createPngBytes(extra = [1, 2, 3, 4]) {
    return Buffer.concat([PNG_SIGNATURE, Buffer.from(extra)]);
}

test('accepts PNG bytes from renderer and normalizes the message count', () => {
    const bytes = createPngBytes();
    const payload = normalizeMessageImagePayload({
        data: new Uint8Array(bytes),
        count: 2.9
    });

    assert.ok(payload);
    assert.deepEqual(payload.data, bytes);
    assert.equal(payload.count, 2);
});

test('rejects invalid image payloads', () => {
    assert.equal(normalizeMessageImagePayload({ data: Buffer.from('not-png') }), null);
    assert.equal(normalizeMessageImagePayload({ data: null }), null);
});

test('uses a stable timestamped PNG file name', () => {
    assert.equal(
        formatMessageImageFileName(new Date(2026, 6, 25, 9, 8, 7)),
        'QQ消息-20260725-090807.png'
    );
});

test('expands custom filename tokens and sanitizes Windows filenames', () => {
    const now = new Date(2026, 6, 25, 9, 8, 7);
    assert.equal(
        formatMessageImageFileName(now, '{yyyy}-{MM}-{dd}_{HH}:{mm}:{ss}_{count}', 12),
        '2026-07-25_09_08_07_12.png'
    );
    assert.equal(sanitizeMessageImageFileName('CON.png'), '_CON.png');
    assert.equal(sanitizeMessageImageFileName('bad<name>?'), 'bad_name__.png');
    assert.equal(appendMessageImageFileNameCounter('消息.png', 2, path), '消息 (2).png');
});

test('normalizes message image save settings', () => {
    assert.deepEqual(normalizeMessageImageSettings({
        directory: 'D:\\Pictures',
        fileNamePattern: '',
        autoCopy: true
    }, path), {
        directory: 'D:\\Pictures',
        fileNamePattern: DEFAULT_MESSAGE_IMAGE_FILE_NAME_PATTERN,
        autoCopy: true
    });
    assert.equal(normalizeMessageImageSettings({ directory: 'relative' }, path).directory, '');
});

test('writes the renderer-generated PNG directly to the configured directory', async () => {
    const bytes = createPngBytes([9, 8, 7]);
    let written = null;
    let createdDirectory = null;
    const result = await saveMessageImage({
        payload: { data: bytes, count: 3 },
        settings: {
            directory: 'D:\\Exports',
            fileNamePattern: 'output'
        },
        fs: {
            mkdir: async (directory, options) => { createdDirectory = { directory, options }; },
            writeFile: async (filePath, data, options) => { written = { filePath, data, options }; }
        },
        path
    });

    assert.deepEqual(result, { ok: true, filePath: 'D:\\Exports\\output.png', count: 3 });
    assert.deepEqual(createdDirectory, {
        directory: 'D:\\Exports',
        options: { recursive: true }
    });
    assert.equal(written.filePath, 'D:\\Exports\\output.png');
    assert.deepEqual(written.data, bytes);
    assert.deepEqual(written.options, { flag: 'wx' });
});

test('adds a numeric suffix instead of overwriting an existing image', async () => {
    const attempts = [];
    const result = await saveMessageImage({
        payload: { data: createPngBytes(), count: 1 },
        settings: { directory: 'D:\\Exports', fileNamePattern: '消息' },
        fs: {
            mkdir: async () => {},
            writeFile: async filePath => {
                attempts.push(filePath);
                if (attempts.length === 1) {
                    throw Object.assign(new Error('exists'), { code: 'EEXIST' });
                }
            }
        },
        path
    });

    assert.equal(result.filePath, 'D:\\Exports\\消息 (2).png');
    assert.deepEqual(attempts, [
        'D:\\Exports\\消息.png',
        'D:\\Exports\\消息 (2).png'
    ]);
});

test('uses the configured directory and copies the saved PNG when enabled', async () => {
    const bytes = createPngBytes([4, 5, 6]);
    const clipboardImage = { isEmpty: () => false };
    let copied = null;
    let createdDirectory = null;
    const result = await saveMessageImage({
        payload: { data: bytes, count: 4 },
        settings: {
            directory: 'D:\\Exports',
            fileNamePattern: '消息-{count}',
            autoCopy: true
        },
        fs: {
            mkdir: async (directory, options) => { createdDirectory = { directory, options }; },
            writeFile: async () => {}
        },
        app: { getPath: () => 'D:\\Downloads' },
        path,
        nativeImage: { createFromBuffer: data => {
            assert.deepEqual(data, bytes);
            return clipboardImage;
        } },
        clipboard: { writeImage: image => { copied = image; } }
    });

    assert.equal(result.ok, true);
    assert.equal(result.copied, true);
    assert.equal(copied, clipboardImage);
    assert.deepEqual(createdDirectory, {
        directory: 'D:\\Exports',
        options: { recursive: true }
    });
});

test('keeps a successful save successful when clipboard copying fails', async () => {
    const result = await saveMessageImage({
        payload: { data: createPngBytes(), count: 1 },
        settings: { directory: 'D:\\Exports', fileNamePattern: 'output', autoCopy: true },
        fs: { mkdir: async () => {}, writeFile: async () => {} },
        path,
        nativeImage: { createFromBuffer: () => ({ isEmpty: () => false }) },
        clipboard: { writeImage: () => { throw new Error('clipboard busy'); } }
    });

    assert.equal(result.ok, true);
    assert.equal(result.copied, false);
    assert.equal(result.copyError, 'clipboard busy');
});
