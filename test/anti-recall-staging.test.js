'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    AntiRecallStaging,
    createFileCandidateJournal
} = require('../src/anti-recall-staging');

function createMemoryJournal(seed = []) {
    const values = new Map(seed.map(value => [value.key, structuredClone(value)]));
    return {
        load: () => Array.from(values.values()).map(value => structuredClone(value)),
        write: value => values.set(value.key, structuredClone(value)),
        remove: key => values.delete(key),
        clear: () => values.clear(),
        values
    };
}

function createRecord(msgId = 'message-1') {
    return {
        chatType: 2,
        peerUid: '10086',
        msgId,
        elements: [{
            elementId: 'image-1',
            picElement: { fileName: 'sample.png', thumbPath: new Map() }
        }, {
            elementId: 'file-1',
            fileElement: { fileName: 'sample.zip', fileSize: 8 }
        }]
    };
}

function createManager(root, options = {}) {
    return new AntiRecallStaging({
        accountUin: '12345',
        rootDir: root,
        stagingDir: path.join(root, 'staging'),
        archiveDirs: {
            image: path.join(root, 'images'),
            file: path.join(root, 'files')
        },
        windowMs: 1000,
        capacityBytes: 1024,
        journal: createMemoryJournal(),
        ...options
    });
}

test('file journal atomically restores arbitrary message records and removes corrupt entries', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-journal-'));
    const journal = createFileCandidateJournal(path.join(root, 'candidates'));
    const candidate = {
        key: '12345:message-1',
        msgId: 'message-1',
        receivedAt: Date.now(),
        record: createRecord(),
        assets: {}
    };
    journal.write(candidate);
    fs.writeFileSync(path.join(root, 'candidates', 'broken.bin'), Buffer.from('broken'));
    const loaded = journal.load();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].record.elements[0].picElement.thumbPath instanceof Map, true);
    assert.equal(fs.existsSync(path.join(root, 'candidates', 'broken.bin')), false);
    journal.remove(candidate.key);
    assert.deepEqual(journal.load(), []);
});

test('startup removes legacy disk candidates that do not own any staged assets', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-empty-candidates-'));
    const journal = createMemoryJournal([{
        key: '12345:text-only',
        msgId: 'text-only',
        peerUid: '10086',
        receivedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        generation: 1,
        recalled: false,
        record: createRecord('text-only'),
        assets: {}
    }]);
    const manager = createManager(root, { journal });
    manager.initialize();
    assert.deepEqual(manager.listCandidates(), []);
    assert.equal(journal.values.size, 0);
});

test('stages within capacity, pauses without eviction, and promotes by atomic rename', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-staging-'));
    const manager = createManager(root, { capacityBytes: 8 });
    manager.observeCandidate({
        key: '12345:message-1',
        msgId: 'message-1',
        peerUid: '10086',
        receivedAt: Date.now(),
        record: createRecord()
    });
    manager.registerAsset('12345:message-1', {
        id: 'image-1',
        kind: 'image',
        elementIndex: 0,
        elementId: 'image-1',
        fileName: 'sample.png'
    });
    manager.registerAsset('12345:message-1', {
        id: 'file-1',
        kind: 'file',
        elementIndex: 1,
        elementId: 'file-1',
        fileName: 'sample.zip'
    });
    const imageSource = path.join(root, 'source.png');
    const fileSource = path.join(root, 'source.zip');
    fs.writeFileSync(imageSource, Buffer.alloc(8, 1));
    fs.writeFileSync(fileSource, Buffer.alloc(8, 2));

    const admitted = manager.beginAssetAcquisition('12345:message-1', 'image-1');
    assert.equal(admitted.ok, true);
    assert.equal(admitted.acquisitionPath, '');
    assert.equal(manager.getCandidate('12345:message-1').assets['image-1'].acquisitionPath, '');
    assert.equal(manager.getStatus().reservedBytes, 0);
    const staged = await manager.stageAssetFromPath('12345:message-1', 'image-1', imageSource);
    assert.equal(staged.state, 'staged');
    const blocked = await manager.stageAssetFromPath('12345:message-1', 'file-1', fileSource);
    assert.equal(blocked.state, 'blocked-capacity');
    assert.equal(fs.existsSync(staged.path), true);
    assert.equal(manager.getStatus().blockedCount, 1);

    const promoted = manager.promoteCandidateSync('12345:message-1');
    const image = promoted.candidate.assets['image-1'];
    assert.equal(image.state, 'promoted');
    assert.equal(fs.existsSync(image.archivePath), true);
    assert.equal(fs.existsSync(staged.path), false);
    assert.equal(promoted.candidate.record.elements[0].picElement.filePath, image.archivePath);
    assert.deepEqual(promoted.pendingAssetIds, ['file-1']);

    const direct = await manager.stageAssetFromPath('12345:message-1', 'file-1', fileSource);
    assert.equal(direct.state, 'promoted');
    assert.equal(fs.existsSync(direct.path), true);
    const archivedFile = manager.getCandidate('12345:message-1').record.elements[1].fileElement;
    assert.equal(archivedFile.filePath, direct.path);
    assert.equal(archivedFile.qqnt_toolbox_archive_path, undefined);
    assert.equal(manager.getCandidate('12345:message-1').record.qqnt_toolbox_archived_files['file-1'], direct.path);
    assert.equal(manager.completeCandidate('12345:message-1'), true);
});

test('reserves declared file bytes before native acquisition and rejects mismatched content', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-admission-'));
    const manager = createManager(root, { capacityBytes: 8 });
    manager.observeCandidate({
        key: '12345:message-1',
        msgId: 'message-1',
        peerUid: '10086',
        receivedAt: Date.now(),
        record: createRecord()
    });
    manager.registerAsset('12345:message-1', {
        id: 'file-1', kind: 'file', elementIndex: 1, elementId: 'file-1', fileName: 'sample.zip',
        expectedBytes: 8
    });
    const admission = manager.beginAssetAcquisition('12345:message-1', 'file-1');
    assert.deepEqual(admission, {
        ok: true,
        reason: '',
        state: 'acquiring',
        direct: false,
        reservedBytes: 8,
        acquisitionPath: manager.getAcquisitionPath('12345:message-1', 'file-1')
    });
    assert.equal(manager.getStatus().reservedBytes, 8);
    const source = path.join(root, 'wrong-size.zip');
    fs.writeFileSync(source, Buffer.alloc(7));
    const result = await manager.stageAssetFromPath('12345:message-1', 'file-1', source);
    assert.equal(result.reason, 'size-mismatch');
    assert.equal(manager.getStatus().reservedBytes, 0);
    assert.equal(manager.getCandidate('12345:message-1').assets['file-1'].actualBytes, 7);
});

test('adopts a plugin-owned native download without copying and promotes the same inode on recall', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-owned-acquisition-'));
    const manager = createManager(root, { capacityBytes: 8 });
    manager.observeCandidate({
        key: '12345:message-1',
        msgId: 'message-1',
        peerUid: '10086',
        receivedAt: Date.now(),
        record: createRecord()
    });
    manager.registerAsset('12345:message-1', {
        id: 'file-1', kind: 'file', elementIndex: 1, elementId: 'file-1', fileName: 'sample.zip',
        expectedBytes: 8
    });
    const admission = manager.beginAssetAcquisition('12345:message-1', 'file-1');
    fs.writeFileSync(admission.acquisitionPath, Buffer.alloc(8, 7));
    const downloadedInode = fs.statSync(admission.acquisitionPath).ino;

    const staged = await manager.adoptOwnedAcquisition(
        '12345:message-1',
        'file-1',
        admission.acquisitionPath
    );
    assert.equal(staged.state, 'staged');
    assert.equal(fs.existsSync(admission.acquisitionPath), false);
    assert.equal(fs.statSync(staged.path).ino, downloadedInode);
    const stagedFile = manager.getCandidate('12345:message-1').record.elements[1].fileElement;
    assert.equal(stagedFile.filePath, staged.path);
    assert.equal(stagedFile.qqnt_toolbox_archive_path, undefined);
    assert.equal(manager.getCandidate('12345:message-1').record.qqnt_toolbox_archived_files['file-1'], staged.path);
    assert.equal(stagedFile.transferStatus, 4);
    assert.equal(stagedFile.progress, 0);
    assert.equal(stagedFile.invalidState, 0);

    const promoted = manager.promoteCandidateSync('12345:message-1').candidate.assets['file-1'];
    assert.equal(promoted.state, 'promoted');
    assert.equal(fs.existsSync(staged.path), false);
    assert.equal(fs.statSync(promoted.archivePath).ino, downloadedInode);
    const archivedFile = manager.getCandidate('12345:message-1').record.elements[1].fileElement;
    assert.equal(archivedFile.filePath, promoted.archivePath);
    assert.equal(archivedFile.qqnt_toolbox_archive_path, undefined);
    assert.equal(manager.getCandidate('12345:message-1').record.qqnt_toolbox_archived_files['file-1'], promoted.archivePath);
    assert.equal(archivedFile.transferStatus, 4);
});

test('promotes directly when recall arrives while the owned download is being adopted', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-owned-recall-race-'));
    const manager = createManager(root, { capacityBytes: 8 });
    manager.observeCandidate({
        key: '12345:message-1',
        msgId: 'message-1',
        peerUid: '10086',
        receivedAt: Date.now(),
        record: createRecord()
    });
    manager.registerAsset('12345:message-1', {
        id: 'file-1', kind: 'file', elementIndex: 1, elementId: 'file-1', fileName: 'sample.zip',
        expectedBytes: 8
    });
    const admission = manager.beginAssetAcquisition('12345:message-1', 'file-1');
    fs.writeFileSync(admission.acquisitionPath, Buffer.alloc(8, 9));
    const downloadedInode = fs.statSync(admission.acquisitionPath).ino;
    const originalRename = fs.promises.rename;
    let recallInjected = false;
    fs.promises.rename = async (sourcePath, targetPath) => {
        if (!recallInjected && sourcePath === admission.acquisitionPath) {
            recallInjected = true;
            manager.promoteCandidateSync('12345:message-1');
        }
        return await originalRename(sourcePath, targetPath);
    };
    let result;
    try {
        result = await manager.adoptOwnedAcquisition(
            '12345:message-1',
            'file-1',
            admission.acquisitionPath
        );
    } finally {
        fs.promises.rename = originalRename;
    }

    assert.equal(recallInjected, true);
    assert.equal(result.state, 'promoted');
    assert.equal(result.path.startsWith(path.join(root, 'files') + path.sep), true);
    assert.equal(fs.statSync(result.path).ino, downloadedInode);
    assert.equal(fs.existsSync(admission.acquisitionPath), false);
    assert.deepEqual(fs.readdirSync(path.join(root, 'staging')).filter(name => name !== '.acquiring'), []);
    assert.equal(manager.getStatus().usedBytes, 0);
    const archivedFile = manager.getCandidate('12345:message-1').record.elements[1].fileElement;
    assert.equal(archivedFile.filePath, result.path);
    assert.equal(archivedFile.qqnt_toolbox_archive_path, undefined);
    assert.equal(manager.getCandidate('12345:message-1').record.qqnt_toolbox_archived_files['file-1'], result.path);
    assert.equal(archivedFile.transferStatus, 4);
});

test('rejects acquisition paths outside plugin ownership without touching the external file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-owned-reject-'));
    const manager = createManager(root, { capacityBytes: 8 });
    manager.observeCandidate({
        key: '12345:message-1', msgId: 'message-1', receivedAt: Date.now(), record: createRecord()
    });
    manager.registerAsset('12345:message-1', {
        id: 'file-1', kind: 'file', elementIndex: 1, elementId: 'file-1', fileName: 'sample.zip',
        expectedBytes: 8
    });
    manager.beginAssetAcquisition('12345:message-1', 'file-1');
    const external = path.join(root, 'user-download.zip');
    fs.writeFileSync(external, Buffer.alloc(8));
    const result = await manager.adoptOwnedAcquisition('12345:message-1', 'file-1', external);
    assert.equal(result.reason, 'acquisition-path-not-owned');
    assert.equal(fs.existsSync(external), true);
    assert.equal(manager.getStatus().reservedBytes, 0);
});

test('accepts file actions only for paths inside the plugin archive directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-owned-archive-path-'));
    const manager = createManager(root);
    const archived = path.join(root, 'files', 'sample.zip');
    const sibling = path.join(root, 'files-other', 'sample.zip');
    assert.equal(manager.isOwnedArchivePath('file', archived), true);
    assert.equal(manager.isOwnedArchivePath('file', sibling), false);
    assert.equal(manager.isOwnedArchivePath('image', archived), false);
    assert.equal(manager.isOwnedArchivePath('file', 'sample.zip'), false);
});

test('failure, expiry, and startup sweep remove plugin-owned acquisition files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-owned-cleanup-'));
    let now = 1000;
    const deferred = [];
    const manager = createManager(root, {
        now: () => now,
        windowMs: 100,
        defer: callback => deferred.push(callback)
    });
    manager.observeCandidate({
        key: '12345:message-1', msgId: 'message-1', receivedAt: now, record: createRecord()
    });
    manager.registerAsset('12345:message-1', {
        id: 'file-1', kind: 'file', elementIndex: 1, elementId: 'file-1', fileName: 'sample.zip',
        expectedBytes: 8
    });
    const first = manager.beginAssetAcquisition('12345:message-1', 'file-1');
    fs.writeFileSync(first.acquisitionPath, Buffer.alloc(3));
    manager.failAssetAcquisition('12345:message-1', 'file-1', 'native-failed');
    assert.equal(fs.existsSync(first.acquisitionPath), false);

    const second = manager.beginAssetAcquisition('12345:message-1', 'file-1');
    fs.writeFileSync(second.acquisitionPath, Buffer.alloc(3));
    now = 1200;
    manager.drainExpired();
    while (deferred.length) deferred.shift()();
    assert.equal(fs.existsSync(second.acquisitionPath), false);

    const orphanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-owned-orphan-'));
    const orphanDir = path.join(orphanRoot, 'staging', '.acquiring');
    fs.mkdirSync(orphanDir, { recursive: true });
    const orphan = path.join(orphanDir, 'orphan.zip');
    fs.writeFileSync(orphan, Buffer.alloc(1));
    createManager(orphanRoot).initialize();
    assert.equal(fs.existsSync(orphan), false);
});

test('capacity admission blocks before acquisition and recalled assets bypass staging capacity', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-capacity-admission-'));
    const manager = createManager(root, { capacityBytes: 4 });
    manager.observeCandidate({
        key: '12345:message-1',
        msgId: 'message-1',
        peerUid: '10086',
        receivedAt: Date.now(),
        record: createRecord()
    });
    manager.registerAsset('12345:message-1', {
        id: 'file-1', kind: 'file', elementIndex: 1, elementId: 'file-1', fileName: 'sample.zip',
        expectedBytes: 8
    });
    const blocked = manager.beginAssetAcquisition('12345:message-1', 'file-1');
    assert.equal(blocked.state, 'blocked-capacity');
    assert.equal(manager.getStatus().reservedBytes, 0);
    manager.promoteCandidateSync('12345:message-1');
    const direct = manager.beginAssetAcquisition('12345:message-1', 'file-1');
    assert.equal(direct.ok, true);
    assert.equal(direct.direct, true);
    assert.equal(manager.getStatus().reservedBytes, 0);
});

test('discarding a queued asset releases its reservation without deleting the candidate snapshot', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-discard-'));
    const manager = createManager(root, { capacityBytes: 8 });
    manager.observeCandidate({
        key: '12345:message-1',
        msgId: 'message-1',
        peerUid: '10086',
        receivedAt: Date.now(),
        record: createRecord()
    });
    manager.registerAsset('12345:message-1', {
        id: 'file-1', kind: 'file', elementIndex: 1, elementId: 'file-1', fileName: 'sample.zip',
        expectedBytes: 8
    });
    manager.beginAssetAcquisition('12345:message-1', 'file-1');
    assert.equal(manager.getStatus().reservedBytes, 8);
    assert.equal(manager.discardAsset('12345:message-1', 'file-1'), true);
    assert.equal(manager.getStatus().reservedBytes, 0);
    assert.deepEqual(manager.getCandidate('12345:message-1').assets, {});
});

test('releasing a failed reservation wakes a blocked asset that now fits', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-resume-after-failure-'));
    const resumed = [];
    const manager = createManager(root, {
        capacityBytes: 8,
        onCapacityAvailable: ({ asset }) => resumed.push(asset.id)
    });
    manager.observeCandidate({
        key: '12345:message-1',
        msgId: 'message-1',
        peerUid: '10086',
        receivedAt: Date.now(),
        record: createRecord()
    });
    manager.registerAsset('12345:message-1', {
        id: 'image-1',
        kind: 'image',
        elementIndex: 0,
        elementId: 'image-1',
        fileName: 'sample.png',
        expectedBytes: 8
    });
    manager.registerAsset('12345:message-1', {
        id: 'file-1',
        kind: 'file',
        elementIndex: 1,
        elementId: 'file-1',
        fileName: 'sample.zip',
        expectedBytes: 8
    });
    assert.equal(manager.beginAssetAcquisition('12345:message-1', 'image-1').ok, true);
    assert.equal(manager.beginAssetAcquisition('12345:message-1', 'file-1').state, 'blocked-capacity');
    assert.deepEqual(resumed, []);
    manager.failAssetAcquisition('12345:message-1', 'image-1', 'native-failed');
    assert.deepEqual(resumed, ['file-1']);
});

test('startup removes interrupted archive temporary files without touching promoted assets', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-archive-sweep-'));
    const imageDir = path.join(root, 'images');
    const fileDir = path.join(root, 'files');
    fs.mkdirSync(imageDir, { recursive: true });
    fs.mkdirSync(fileDir, { recursive: true });
    const imageTemporary = path.join(imageDir, 'image.jpg.tmp-1-deadbeef');
    const fileTemporary = path.join(fileDir, 'file.zip.tmp-1-deadbeef');
    const promoted = path.join(fileDir, 'kept.zip');
    const promotedWithTmpName = path.join(fileDir, 'kept.tmp-report.zip');
    fs.writeFileSync(imageTemporary, Buffer.alloc(1));
    fs.writeFileSync(fileTemporary, Buffer.alloc(1));
    fs.writeFileSync(promoted, Buffer.alloc(1));
    fs.writeFileSync(promotedWithTmpName, Buffer.alloc(1));
    const manager = createManager(root);
    manager.initialize();
    assert.equal(fs.existsSync(imageTemporary), false);
    assert.equal(fs.existsSync(fileTemporary), false);
    assert.equal(fs.existsSync(promoted), true);
    assert.equal(fs.existsSync(promotedWithTmpName), true);
});

test('recovers staged candidates and accounts actual bytes after restart', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-restart-'));
    const journal = createFileCandidateJournal(path.join(root, 'candidates'));
    const first = createManager(root, { journal, capacityBytes: 1024 });
    first.observeCandidate({
        key: '12345:message-1',
        msgId: 'message-1',
        receivedAt: Date.now(),
        record: createRecord()
    });
    first.registerAsset('12345:message-1', {
        id: 'image-1', kind: 'image', elementIndex: 0, elementId: 'image-1', fileName: 'sample.png'
    });
    const source = path.join(root, 'source.png');
    fs.writeFileSync(source, Buffer.alloc(9, 3));
    await first.stageAssetFromPath('12345:message-1', 'image-1', source);
    first.close();

    const second = createManager(root, { journal, capacityBytes: 1024 });
    const recovered = second.initialize();
    assert.equal(recovered.length, 1);
    assert.equal(second.getStatus().usedBytes, 9);
    assert.equal(recovered[0].record.elements[0].picElement.filePath.endsWith('.png'), true);
});

test('ten thousand candidates still use one active timer and expire in bounded batches', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-timer-'));
    const journal = {
        load: () => [],
        write: () => {},
        remove: () => {},
        clear: () => {}
    };
    let now = 1000;
    let nextTimerId = 0;
    const active = new Map();
    const deferred = [];
    const expired = [];
    const manager = createManager(root, {
        journal,
        windowMs: 100,
        batchSize: 64,
        now: () => now,
        setTimer: callback => {
            const id = ++nextTimerId;
            active.set(id, callback);
            return id;
        },
        clearTimer: id => active.delete(id),
        defer: callback => deferred.push(callback),
        onExpire: candidate => expired.push(candidate.key)
    });
    for (let index = 0; index < 10000; index++) {
        manager.observeCandidate({
            key: `12345:message-${index}`,
            msgId: `message-${index}`,
            receivedAt: now,
            record: createRecord(`message-${index}`)
        });
        assert.equal(active.size <= 1, true);
    }
    assert.equal(active.size, 1);
    assert.equal(nextTimerId, 1);
    now = 1200;
    const callback = active.values().next().value;
    active.clear();
    callback();
    assert.equal(expired.length, 64);
    while (deferred.length) {
        deferred.shift()();
    }
    assert.equal(expired.length, 10000);
    assert.equal(active.size, 0);
});

test('repeated snapshots for one candidate do not duplicate expiry heap entries or timers', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-update-timer-'));
    let nextTimerId = 0;
    const active = new Map();
    const manager = createManager(root, {
        setTimer: callback => {
            const id = ++nextTimerId;
            active.set(id, callback);
            return id;
        },
        clearTimer: id => active.delete(id)
    });
    for (let index = 0; index < 10000; index++) {
        const record = createRecord('message-1');
        record.msgSeq = String(index);
        manager.observeCandidate({
            key: '12345:message-1',
            msgId: 'message-1',
            receivedAt: 1000,
            record
        });
    }
    assert.equal(manager.heap.length, 1);
    assert.equal(active.size, 1);
    assert.equal(nextTimerId, 1);
    assert.equal(manager.getCandidate('12345:message-1').record.msgSeq, '9999');
});

test('shortening a window schedules async expiry and lowering capacity never deletes candidates', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-update-'));
    let now = 1000;
    const deferred = [];
    const manager = createManager(root, {
        now: () => now,
        defer: callback => deferred.push(callback)
    });
    manager.observeCandidate({
        key: '12345:message-1',
        msgId: 'message-1',
        receivedAt: now,
        record: createRecord()
    });
    manager.registerAsset('12345:message-1', {
        id: 'image-1', kind: 'image', elementIndex: 0, elementId: 'image-1', fileName: 'sample.png'
    });
    const source = path.join(root, 'source.png');
    fs.writeFileSync(source, Buffer.alloc(8));
    await manager.stageAssetFromPath('12345:message-1', 'image-1', source);
    manager.updateConfig({ capacityBytes: 1, windowMs: 50 });
    assert.equal(manager.getStatus().candidateCount, 1);
    assert.equal(manager.getStatus().usedBytes, 8);
    now = 1100;
    while (deferred.length) {
        deferred.shift()();
    }
    assert.equal(manager.getStatus().candidateCount, 0);
});
