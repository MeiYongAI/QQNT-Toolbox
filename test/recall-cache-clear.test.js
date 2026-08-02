'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { clearRecallAccountCache } = require('../src/recall-cache-clear');
const {
    AntiRecallStaging,
    createFileCandidateJournal
} = require('../src/anti-recall-staging');

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

test('waits for in-flight staging before deleting the account cache', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-recall-clear-flight-'));
    const account = path.join(root, '10001');
    const cachePath = path.join(account, 'active-recall-cache.bin');
    const staging = new AntiRecallStaging({
        accountUin: '10001',
        rootDir: account,
        stagingDir: path.join(account, 'staging'),
        archiveDirs: {
            image: path.join(account, 'images'),
            file: path.join(account, 'files')
        },
        windowMs: 60_000,
        capacityBytes: 1024,
        journal: createFileCandidateJournal(path.join(account, 'candidates'))
    });
    staging.initialize();
    const key = '10001:message-1';
    staging.observeCandidate({
        key,
        msgId: 'message-1',
        receivedAt: Date.now(),
        record: {
            msgId: 'message-1',
            qqnt_toolbox_recall: { recallTime: String(Date.now()) },
            elements: [{
                elementId: 'image-1',
                picElement: { fileName: 'sample.png', thumbPath: new Map() }
            }]
        }
    });
    staging.registerAsset(key, {
        id: 'image-1',
        kind: 'image',
        elementIndex: 0,
        elementId: 'image-1',
        fileName: 'sample.png'
    });
    staging.promoteCandidateSync(key);

    const source = path.join(root, 'source.png');
    fs.writeFileSync(source, Buffer.alloc(16, 7));
    const originalCopyFile = fs.promises.copyFile;
    let releaseCopy;
    let copyStartedResolve;
    const copyStarted = new Promise(resolve => {
        copyStartedResolve = resolve;
    });
    fs.promises.copyFile = async (...args) => {
        copyStartedResolve();
        await new Promise(resolve => {
            releaseCopy = resolve;
        });
        return await originalCopyFile(...args);
    };

    let clearSettled = false;
    try {
        const stageTask = staging.stageAssetFromPath(key, 'image-1', source);
        await copyStarted;
        const state = {
            generation: 1,
            liveMessages: populatedMap(),
            recalledMessages: populatedMap(),
            persistedIds: new Set(['message-1']),
            imageDownloads: populatedMap(),
            staging
        };
        const clearTask = clearRecallAccountCache({
            rootDirectory: root,
            accountDirectory: account,
            cachePath,
            state
        }).then(result => {
            clearSettled = true;
            return result;
        });

        await new Promise(resolve => setImmediate(resolve));
        assert.equal(clearSettled, false);
        releaseCopy();
        const [stageResult, clearResult] = await Promise.all([stageTask, clearTask]);
        assert.equal(stageResult.ok, true);
        assert.deepEqual(clearResult, { success: true, generation: 2 });
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(fs.readdirSync(account), ['active-recall-cache.bin']);
        assert.equal(fs.statSync(cachePath).size, 0);
    } finally {
        releaseCopy?.();
        fs.promises.copyFile = originalCopyFile;
    }
});
