'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
    formatMessageImageFileName,
    normalizeMessageImagePayload,
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

test('writes the renderer-generated PNG without recapturing the window', async () => {
    const bytes = createPngBytes([9, 8, 7]);
    let written = null;
    const browserWindow = { id: 1 };
    const result = await saveMessageImage({
        browserWindow,
        payload: { data: bytes, count: 3 },
        dialog: {
            async showSaveDialog(owner, options) {
                assert.equal(owner, browserWindow);
                assert.equal(options.filters[0].extensions[0], 'png');
                return { canceled: false, filePath: 'D:\\output.png' };
            }
        },
        fs: {
            async writeFile(filePath, data) {
                written = { filePath, data };
            }
        },
        app: { getPath: () => 'D:\\Downloads' },
        path
    });

    assert.deepEqual(result, { ok: true, filePath: 'D:\\output.png', count: 3 });
    assert.equal(written.filePath, 'D:\\output.png');
    assert.deepEqual(written.data, bytes);
});

test('does not write a file when the save dialog is canceled', async () => {
    let writes = 0;
    const result = await saveMessageImage({
        browserWindow: null,
        payload: { data: createPngBytes(), count: 1 },
        dialog: { showSaveDialog: async () => ({ canceled: true }) },
        fs: { writeFile: async () => { writes += 1; } },
        app: { getPath: () => 'D:\\Downloads' },
        path
    });

    assert.equal(result.canceled, true);
    assert.equal(writes, 0);
});
