'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { serialize } = require('node:v8');
const { deflateSync } = require('node:zlib');

const {
    createRecallCacheIndexStore,
    scanCacheFileSync
} = require('../src/recall-cache-index');

function createRecord(msgId, marker, accountUin = '10001') {
    return {
        msgId,
        msgSeq: marker,
        qqnt_toolbox_account_uin: accountUin,
        qqnt_toolbox_recall: { recallTime: marker },
        elements: [{ textElement: { content: marker } }]
    };
}

function encodeFrame(value) {
    const payload = Buffer.isBuffer(value)
        ? value
        : deflateSync(serialize(value));
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(payload.length);
    return Buffer.concat([header, payload]);
}

function appendFrame(cachePath, value) {
    fs.appendFileSync(cachePath, encodeFrame(value));
}

function createPaths(prefix) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    return {
        root,
        cachePath: path.join(root, 'active-recall-cache.bin'),
        indexPath: path.join(root, 'active-recall-cache.bin.index')
    };
}

class ControlledWorker extends EventEmitter {
    constructor() {
        super();
        this.terminateCalls = 0;
        this.terminateTask = Promise.resolve(1);
    }

    terminate() {
        this.terminateCalls += 1;
        return this.terminateTask;
    }
}

test('missing sidecar leaves legacy payloads cold until background indexing', async () => {
    const paths = createPaths('qqnt-recall-index-cold-');
    fs.writeFileSync(paths.cachePath, Buffer.alloc(0));
    appendFrame(paths.cachePath, createRecord('message-1', 'old'));
    appendFrame(paths.cachePath, createRecord('message-1', 'new'));
    appendFrame(paths.cachePath, createRecord('message-2', 'second'));

    const store = createRecallCacheIndexStore({
        ...paths,
        accountUin: '10001',
        checkpointDelayMs: 1
    });
    const initial = store.initializeSync();
    assert.equal(initial.recordCount, 0);
    assert.equal(initial.indexedSize, 0);
    assert.equal(initial.complete, false);

    const indexed = await store.startIndexing();
    assert.equal(indexed.recordCount, 2);
    assert.equal(indexed.complete, true);
    assert.equal(store.getSync('message-1').msgSeq, 'new');
    assert.equal(store.getSync('message-2').msgSeq, 'second');
    await store.checkpoint();
    await store.close();

    const reopened = createRecallCacheIndexStore({ ...paths, accountUin: '10001' });
    const reopenedStatus = reopened.initializeSync();
    assert.equal(reopenedStatus.recordCount, 2);
    assert.equal(reopenedStatus.complete, true);
    assert.equal(reopened.getSync('message-1').msgSeq, 'new');
    reopened.closeSync({ cancel: true });
});

test('foreground legacy lookup preserves recall behavior before the worker runs', () => {
    const paths = createPaths('qqnt-recall-index-foreground-');
    fs.writeFileSync(paths.cachePath, Buffer.alloc(0));
    appendFrame(paths.cachePath, createRecord('message-1', 'first'));
    appendFrame(paths.cachePath, createRecord('message-1', 'latest'));

    const store = createRecallCacheIndexStore({ ...paths, accountUin: '10001' });
    store.initializeSync();
    assert.equal(store.getSync('message-1').msgSeq, 'latest');
    assert.equal(store.getStatus().complete, true);
    assert.equal(store.getStatus().recordCount, 1);
    store.closeSync();
});

test('same-size cache replacement invalidates the sidecar fingerprint', async () => {
    const paths = createPaths('qqnt-recall-index-identity-');
    const originalFrame = encodeFrame(createRecord('message-1', 'first'));
    const replacementFrame = encodeFrame(createRecord('message-2', 'other'));
    assert.equal(replacementFrame.length, originalFrame.length);
    fs.writeFileSync(paths.cachePath, originalFrame);

    const store = createRecallCacheIndexStore({ ...paths, accountUin: '10001' });
    assert.equal(store.getSync('message-1').msgSeq, 'first');
    await store.checkpoint();
    await store.close({ cancel: true });
    fs.writeFileSync(paths.cachePath, replacementFrame);

    const reopened = createRecallCacheIndexStore({ ...paths, accountUin: '10001' });
    const initial = reopened.initializeSync();
    assert.equal(initial.recordCount, 0);
    assert.equal(initial.complete, false);
    await reopened.startIndexing();
    assert.equal(reopened.getSync('message-1'), null);
    assert.equal(reopened.getSync('message-2').msgSeq, 'other');
    await reopened.close({ cancel: true });
});

test('indexing skips a corrupt framed payload and ignores a truncated tail', async () => {
    const paths = createPaths('qqnt-recall-index-corrupt-');
    fs.writeFileSync(paths.cachePath, Buffer.alloc(0));
    appendFrame(paths.cachePath, createRecord('message-1', 'before'));
    appendFrame(paths.cachePath, Buffer.from('not-a-deflate-stream'));
    appendFrame(paths.cachePath, createRecord('message-2', 'after'));
    const truncatedHeader = Buffer.allocUnsafe(4);
    truncatedHeader.writeUInt32BE(100);
    fs.appendFileSync(paths.cachePath, Buffer.concat([truncatedHeader, Buffer.alloc(3)]));

    const scan = scanCacheFileSync(paths.cachePath, '10001');
    assert.equal(scan.entries.length, 2);
    assert.equal(scan.invalidCount, 2);
    assert.equal(scan.indexedSize < scan.fileSize, true);

    const store = createRecallCacheIndexStore({ ...paths, accountUin: '10001' });
    store.initializeSync();
    const indexed = await store.startIndexing();
    assert.equal(indexed.recordCount, 2);
    assert.equal(indexed.invalidCount, 2);
    assert.equal(indexed.complete, false);
    assert.equal(store.getSync('message-2').msgSeq, 'after');
    await store.close({ cancel: true });
});

test('appends update the lazy index and account isolation rejects foreign records', async () => {
    const paths = createPaths('qqnt-recall-index-append-');
    const store = createRecallCacheIndexStore({
        ...paths,
        accountUin: '10001',
        checkpointDelayMs: 1
    });
    store.initializeSync();
    store.appendSync(createRecord('message-1', 'first'));
    store.appendSync(createRecord('message-1', 'latest'));
    assert.equal(store.pendingWrites.length, 0);
    assert.throws(
        () => store.appendSync(createRecord('foreign', 'foreign', '20002')),
        /Invalid recall cache record/
    );
    assert.equal(store.getSync('message-1').msgSeq, 'latest');
    assert.equal(store.getStatus().recordCount, 1);
    await store.checkpoint();
    await store.close();

    const foreign = createRecallCacheIndexStore({ ...paths, accountUin: '20002' });
    foreign.initializeSync();
    assert.equal(foreign.getSync('message-1'), null);
    await foreign.close({ cancel: true });
});

test('loadAll returns latest unique records in bounded asynchronous batches', async () => {
    const paths = createPaths('qqnt-recall-index-all-');
    fs.writeFileSync(paths.cachePath, Buffer.alloc(0));
    for (let index = 0; index < 20; index += 1) {
        appendFrame(paths.cachePath, createRecord(`message-${index}`, `value-${index}`));
    }
    appendFrame(paths.cachePath, createRecord('message-3', 'updated'));

    const store = createRecallCacheIndexStore({ ...paths, accountUin: '10001' });
    store.initializeSync();
    const records = await store.loadAll({ batchSize: 3 });
    assert.equal(records.length, 20);
    assert.equal(records.find(record => record.msgId === 'message-3').msgSeq, 'updated');
    await store.close({ cancel: true });
});

test('an older worker snapshot cannot replace a newer foreground index', async () => {
    const paths = createPaths('qqnt-recall-index-stale-worker-');
    fs.writeFileSync(paths.cachePath, Buffer.alloc(0));
    appendFrame(paths.cachePath, createRecord('message-1', 'old'));
    const staleScan = scanCacheFileSync(paths.cachePath, '10001');
    const worker = new ControlledWorker();
    const store = createRecallCacheIndexStore({
        ...paths,
        accountUin: '10001',
        createWorker: () => worker,
        checkpointDelayMs: 60_000
    });
    const indexing = store.startIndexing();

    store.appendSync(createRecord('message-1', 'new'));
    assert.equal(store.getSync('missing-message'), null);
    worker.emit('message', { ok: true, result: staleScan });
    await indexing;

    assert.equal(store.getSync('message-1').msgSeq, 'new');
    assert.equal(store.getStatus().complete, true);
    await store.close({ cancel: true });
});

test('background rebuild preserves indexed appends beyond a truncated tail', async () => {
    const paths = createPaths('qqnt-recall-index-truncated-append-');
    fs.writeFileSync(paths.cachePath, Buffer.alloc(0));
    appendFrame(paths.cachePath, createRecord('message-1', 'before-tail'));
    const truncatedHeader = Buffer.allocUnsafe(4);
    truncatedHeader.writeUInt32BE(100);
    fs.appendFileSync(paths.cachePath, Buffer.concat([truncatedHeader, Buffer.alloc(3)]));

    const store = createRecallCacheIndexStore({
        ...paths,
        accountUin: '10001',
        checkpointDelayMs: 60_000
    });
    assert.equal(store.getSync('message-1').msgSeq, 'before-tail');
    store.appendSync(createRecord('message-2', 'after-tail'));
    await store.checkpoint();
    await store.close({ cancel: true });

    const reopened = createRecallCacheIndexStore({ ...paths, accountUin: '10001' });
    const initial = reopened.initializeSync();
    assert.equal(initial.complete, false);
    assert.equal(reopened.getSync('message-2').msgSeq, 'after-tail');
    await reopened.startIndexing();
    assert.equal(reopened.getSync('message-2').msgSeq, 'after-tail');
    await reopened.close({ cancel: true });
});

test('index worker exit without a result rejects once instead of leaving the task pending', async () => {
    const paths = createPaths('qqnt-recall-index-worker-exit-');
    fs.writeFileSync(paths.cachePath, Buffer.alloc(0));
    appendFrame(paths.cachePath, createRecord('message-1', 'value'));
    const errors = [];
    const worker = new ControlledWorker();
    const store = createRecallCacheIndexStore({
        ...paths,
        accountUin: '10001',
        createWorker: () => {
            setImmediate(() => worker.emit('exit', 0));
            return worker;
        },
        onError: error => errors.push(error)
    });

    await assert.rejects(
        store.startIndexing(),
        /exited before sending a result/
    );
    assert.equal(errors.length, 1);
    assert.equal(store.getStatus().indexing, false);
    await store.close({ cancel: true });
});

test('index worker error wins over its follow-up exit and reports once', async () => {
    const paths = createPaths('qqnt-recall-index-worker-error-');
    fs.writeFileSync(paths.cachePath, Buffer.alloc(0));
    appendFrame(paths.cachePath, createRecord('message-1', 'value'));
    const failure = new Error('worker failed');
    const errors = [];
    const worker = new ControlledWorker();
    const store = createRecallCacheIndexStore({
        ...paths,
        accountUin: '10001',
        createWorker: () => {
            setImmediate(() => {
                worker.emit('error', failure);
                worker.emit('exit', 1);
            });
            return worker;
        },
        onError: error => errors.push(error)
    });

    await assert.rejects(store.startIndexing(), failure);
    assert.deepEqual(errors, [failure]);
    assert.equal(store.getStatus().indexing, false);
    await store.close({ cancel: true });
});

test('canceling close settles indexing and waits for worker termination', async () => {
    const paths = createPaths('qqnt-recall-index-worker-close-');
    fs.writeFileSync(paths.cachePath, Buffer.alloc(0));
    appendFrame(paths.cachePath, createRecord('message-1', 'value'));
    let releaseTermination;
    const worker = new ControlledWorker();
    worker.terminateTask = new Promise(resolve => {
        releaseTermination = () => {
            worker.emit('exit', 1);
            resolve(1);
        };
    });
    const store = createRecallCacheIndexStore({
        ...paths,
        accountUin: '10001',
        createWorker: () => worker
    });
    const indexing = store.startIndexing();
    let closeSettled = false;
    const closing = store.close({ cancel: true }).then(() => {
        closeSettled = true;
    });

    await indexing;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closeSettled, false);
    releaseTermination();
    await closing;
    assert.equal(store.getStatus().indexing, false);
    assert.equal(worker.terminateCalls, 1);
});

test('synchronous close terminates an indexing worker after settling its task', async () => {
    const paths = createPaths('qqnt-recall-index-worker-close-sync-');
    fs.writeFileSync(paths.cachePath, Buffer.alloc(0));
    appendFrame(paths.cachePath, createRecord('message-1', 'value'));
    const worker = new ControlledWorker();
    const store = createRecallCacheIndexStore({
        ...paths,
        accountUin: '10001',
        createWorker: () => worker
    });
    const indexing = store.startIndexing();

    store.closeSync({ cancel: true });
    await indexing;
    assert.equal(worker.terminateCalls, 1);
    assert.equal(store.getStatus().indexing, false);
});

test('canceling close drains an active checkpoint before cache deletion', async () => {
    const paths = createPaths('qqnt-recall-index-checkpoint-close-');
    const store = createRecallCacheIndexStore({
        ...paths,
        accountUin: '10001',
        checkpointDelayMs: 60_000
    });
    store.appendSync(createRecord('message-1', 'value'));

    const originalWriteFile = fs.promises.writeFile;
    let checkpointStartedResolve;
    let releaseCheckpoint;
    const checkpointStarted = new Promise(resolve => {
        checkpointStartedResolve = resolve;
    });
    const checkpointGate = new Promise(resolve => {
        releaseCheckpoint = resolve;
    });
    fs.promises.writeFile = async (filePath, ...args) => {
        if (String(filePath).startsWith(`${paths.indexPath}.tmp-`)) {
            checkpointStartedResolve();
            await checkpointGate;
        }
        return await originalWriteFile.call(fs.promises, filePath, ...args);
    };

    try {
        const checkpoint = store.checkpoint();
        await checkpointStarted;
        let closeSettled = false;
        const closing = store.close({ cancel: true }).then(() => {
            closeSettled = true;
        });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(closeSettled, false);

        releaseCheckpoint();
        await Promise.all([checkpoint, closing]);
        await fs.promises.rm(paths.root, { recursive: true, force: true });

        assert.deepEqual(store.getKeys(), ['message-1']);
        assert.equal(store.has('message-1'), false);
        assert.equal(store.getSync('message-1'), null);
        await store.checkpoint();
        await store.startIndexing();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(fs.existsSync(paths.root), false);
    } finally {
        releaseCheckpoint?.();
        fs.promises.writeFile = originalWriteFile;
    }
});
