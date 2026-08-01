'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { clearRecallAccountCache } = require('../src/recall-cache-clear');

function populatedMap() {
    return new Map([['value', {}]]);
}

test('clears only the selected account across messages, journal, acquiring, staging, images, and files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-recall-clear-'));
    const account = path.join(root, '10001');
    const sibling = path.join(root, '10002');
    const cachePath = path.join(account, 'active-recall-cache.bin');
    for (const relative of [
        'candidates/item.bin',
        'staging/.acquiring/download.tmp',
        'staging/staged.bin',
        'images/image.png',
        'files/file.zip'
    ]) {
        const filePath = path.join(account, relative);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, relative);
    }
    fs.writeFileSync(cachePath, 'records');
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(path.join(sibling, 'keep.bin'), 'keep');

    let stagingClearCount = 0;
    let stagingCloseCount = 0;
    const state = {
        generation: 4,
        liveMessages: populatedMap(),
        recalledMessages: populatedMap(),
        persistedIds: new Set(['message']),
        imageDownloads: populatedMap(),
        staging: {
            clear: () => stagingClearCount++,
            close: () => stagingCloseCount++
        }
    };

    const result = await clearRecallAccountCache({
        rootDirectory: root,
        accountDirectory: account,
        cachePath,
        state
    });

    assert.deepEqual(result, { success: true, generation: 5 });
    assert.equal(state.liveMessages.size, 0);
    assert.equal(state.recalledMessages.size, 0);
    assert.equal(state.persistedIds.size, 0);
    assert.equal(state.imageDownloads.size, 0);
    assert.equal(stagingClearCount, 1);
    assert.equal(stagingCloseCount, 1);
    assert.deepEqual(fs.readdirSync(account), ['active-recall-cache.bin']);
    assert.equal(fs.statSync(cachePath).size, 0);
    assert.equal(fs.readFileSync(path.join(sibling, 'keep.bin'), 'utf8'), 'keep');
});

test('rejects a cache path outside the selected account directory', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-recall-clear-invalid-'));
    const account = path.join(root, '10001');
    fs.mkdirSync(account);
    await assert.rejects(() => clearRecallAccountCache({
        rootDirectory: root,
        accountDirectory: account,
        cachePath: path.join(root, 'outside.bin'),
        state: {}
    }), /Invalid recall cache directory/);
});
