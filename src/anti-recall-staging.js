'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs').promises;
const path = require('node:path');
const { deserialize, serialize } = require('node:v8');

const JOURNAL_VERSION = 1;
const DEFAULT_EXPIRY_BATCH_SIZE = 64;
const DEFAULT_RESTORE_BATCH_SIZE = 32;

function normalizeText(value) {
    return String(value ?? '').trim();
}

function cloneRecord(value) {
    return deserialize(serialize(value));
}

function hash(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function sanitizeFileName(value, fallback) {
    const name = path.basename(normalizeText(value))
        .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_')
        .replace(/^\.+$/, '')
        .slice(0, 120);
    return name || fallback;
}

function isPathInside(directory, filePath) {
    const relative = path.relative(path.resolve(directory), path.resolve(filePath));
    return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function isSamePath(firstPath, secondPath) {
    return path.relative(path.resolve(firstPath), path.resolve(secondPath)) === '';
}

function isDirectChildPath(directory, filePath) {
    return isPathInside(directory, filePath) && isSamePath(path.dirname(filePath), directory);
}

function getRegularFileStat(filePath) {
    try {
        const stat = fs.lstatSync(filePath);
        return stat.isFile() && !stat.isSymbolicLink() ? stat : null;
    } catch {
        return null;
    }
}

function createFileCandidateJournal(directory) {
    const root = path.resolve(directory);

    function getPath(key) {
        return path.join(root, `${hash(key)}.bin`);
    }

    function readCandidateSync(filePath, expectedKey = '') {
        let data;
        try {
            data = fs.readFileSync(filePath);
        } catch {
            return null;
        }
        try {
            const envelope = deserialize(data);
            if (envelope?.version === JOURNAL_VERSION && envelope.candidate?.key &&
                (!expectedKey || normalizeText(envelope.candidate.key) === expectedKey)) {
                return envelope.candidate;
            }
        } catch {
        }
        try {
            fs.rmSync(filePath, { force: true });
        } catch {
        }
        return null;
    }

    async function readCandidate(filePath) {
        let data;
        try {
            data = await fsp.readFile(filePath);
        } catch (error) {
            return {
                candidate: null,
                error: error?.code === 'ENOENT' ? null : error
            };
        }
        try {
            const envelope = deserialize(data);
            if (envelope?.version === JOURNAL_VERSION && envelope.candidate?.key) {
                return { candidate: envelope.candidate, error: null };
            }
        } catch {
        }
        // Do not unlink from an asynchronous read path. A transient I/O failure or
        // a concurrent atomic replacement must never delete a newer valid journal.
        return {
            candidate: null,
            error: new Error(`Invalid anti-recall candidate journal: ${path.basename(filePath)}`)
        };
    }

    return {
        load() {
            fs.mkdirSync(root, { recursive: true });
            const candidates = [];
            for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
                const filePath = path.join(root, entry.name);
                if (entry.isFile() && entry.name.includes('.tmp-')) {
                    fs.rmSync(filePath, { force: true });
                    continue;
                }
                if (!entry.isFile() || !entry.name.endsWith('.bin')) {
                    continue;
                }
                const candidate = readCandidateSync(filePath);
                if (candidate) {
                    candidates.push(candidate);
                }
            }
            return candidates;
        },
        async *loadBatches(batchSize = DEFAULT_RESTORE_BATCH_SIZE) {
            await fsp.mkdir(root, { recursive: true });
            const size = Math.max(1, Number(batchSize) || DEFAULT_RESTORE_BATCH_SIZE);
            let pending = [];
            let firstError = null;
            const readBatch = async filePaths => {
                const results = await Promise.all(filePaths.map(readCandidate));
                for (const result of results) {
                    firstError ||= result.error;
                }
                return results.map(result => result.candidate).filter(Boolean);
            };
            for await (const entry of await fsp.opendir(root)) {
                const filePath = path.join(root, entry.name);
                if (entry.isFile() && entry.name.includes('.tmp-')) {
                    await fsp.rm(filePath, { force: true }).catch(() => {});
                    continue;
                }
                if (!entry.isFile() || !entry.name.endsWith('.bin')) {
                    continue;
                }
                pending.push(filePath);
                if (pending.length < size) {
                    continue;
                }
                const candidates = await readBatch(pending);
                pending = [];
                if (candidates.length) {
                    yield candidates;
                }
            }
            if (pending.length) {
                const candidates = await readBatch(pending);
                if (candidates.length) {
                    yield candidates;
                }
            }
            if (firstError) {
                throw firstError;
            }
        },
        loadOne(key) {
            const normalizedKey = normalizeText(key);
            if (!normalizedKey) {
                return null;
            }
            return readCandidateSync(getPath(normalizedKey), normalizedKey);
        },
        write(candidate) {
            fs.mkdirSync(root, { recursive: true });
            const targetPath = getPath(candidate.key);
            const temporaryPath = `${targetPath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
            try {
                fs.writeFileSync(temporaryPath, serialize({
                    version: JOURNAL_VERSION,
                    candidate
                }));
                fs.renameSync(temporaryPath, targetPath);
            } finally {
                fs.rmSync(temporaryPath, { force: true });
            }
        },
        remove(key) {
            fs.rmSync(getPath(key), { force: true });
        },
        clear() {
            fs.rmSync(root, { recursive: true, force: true });
            fs.mkdirSync(root, { recursive: true });
        }
    };
}

function heapPush(heap, item) {
    heap.push(item);
    let index = heap.length - 1;
    while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (heap[parent].expiresAt <= item.expiresAt) {
            break;
        }
        heap[index] = heap[parent];
        index = parent;
    }
    heap[index] = item;
}

function heapPop(heap) {
    if (!heap.length) {
        return null;
    }
    const first = heap[0];
    const last = heap.pop();
    if (heap.length && last) {
        let index = 0;
        while (true) {
            const left = index * 2 + 1;
            const right = left + 1;
            if (left >= heap.length) {
                break;
            }
            const child = right < heap.length && heap[right].expiresAt < heap[left].expiresAt
                ? right
                : left;
            if (heap[child].expiresAt >= last.expiresAt) {
                break;
            }
            heap[index] = heap[child];
            index = child;
        }
        heap[index] = last;
    }
    return first;
}

function applyAssetPath(record, asset, targetPath) {
    const elements = Array.isArray(record?.elements) ? record.elements : [];
    const element = elements.find(item => asset.elementId && normalizeText(item?.elementId) === asset.elementId) ||
        elements[asset.elementIndex];
    if (!element || !targetPath) {
        return false;
    }
    const media = asset.kind === 'image' ? element.picElement : element.fileElement;
    if (!media) {
        return false;
    }
    if (asset.kind === 'image') {
        media.sourcePath = targetPath;
        media.filePath = targetPath;
        media.originPath = targetPath;
        media.localPath = targetPath;
        media.path = targetPath;
        if (media.thumbPath instanceof Map) {
            const keys = media.thumbPath.size ? Array.from(media.thumbPath.keys()) : [0, 198, 720];
            keys.forEach(key => media.thumbPath.set(key, targetPath));
        } else if (Array.isArray(media.thumbPath)) {
            media.thumbPath = media.thumbPath.length ? media.thumbPath.map(() => targetPath) : [targetPath];
        } else if (media.thumbPath && typeof media.thumbPath === 'object') {
            const keys = Object.keys(media.thumbPath);
            (keys.length ? keys : ['0']).forEach(key => {
                media.thumbPath[key] = targetPath;
            });
        } else {
            media.thumbPath = new Map([[0, targetPath], [198, targetPath], [720, targetPath]]);
        }
    } else {
        // Keep the plugin path in one QQ-native local-file field so the recovered
        // bubble renders exactly like a completed download. Writing the same path
        // into every native path field previously made QQ reject the recovered
        // record, so filePath is the single projection and plugin metadata remains
        // the ownership source of truth.
        const managedPaths = new Set([
            targetPath,
            asset.acquisitionPath,
            asset.stagingPath,
            asset.archivePath,
            asset.previousManagedPath,
            media.qqnt_toolbox_archive_path
        ].map(normalizeText).filter(Boolean));
        for (const key of ['sourcePath', 'filePath', 'originPath', 'localPath', 'path']) {
            if (managedPaths.has(normalizeText(media[key]))) {
                media[key] = '';
            }
        }
        delete media.qqnt_toolbox_archive_path;
        record.qqnt_toolbox_archived_files ||= {};
        record.qqnt_toolbox_archived_files[normalizeText(element.elementId) || String(asset.elementIndex)] = targetPath;
        media.filePath = targetPath;
        // Reuse QQ's native completed-transfer presentation for a file that is
        // already available in plugin-owned storage. Live QQ records use status
        // 4 for the "已下载" state; the physical archive path remains plugin
        // metadata so QQ never creates a second download copy.
        media.transferStatus = 4;
        media.progress = 0;
        media.invalidState = 0;
    }
    return true;
}

class AntiRecallStaging {
    constructor(options = {}) {
        this.accountUin = normalizeText(options.accountUin);
        this.rootDir = path.resolve(options.rootDir || '.');
        this.stagingDir = path.resolve(options.stagingDir || path.join(this.rootDir, 'staging'));
        this.acquisitionDir = path.resolve(options.acquisitionDir || path.join(this.stagingDir, '.acquiring'));
        this.archiveDirs = {
            image: path.resolve(options.archiveDirs?.image || path.join(this.rootDir, 'images')),
            file: path.resolve(options.archiveDirs?.file || path.join(this.rootDir, 'files'))
        };
        this.windowMs = Math.max(1, Number(options.windowMs) || 1);
        this.capacityBytes = Math.max(1, Number(options.capacityBytes) || 1);
        this.now = typeof options.now === 'function' ? options.now : Date.now;
        this.setTimer = options.setTimer || setTimeout;
        this.clearTimer = options.clearTimer || clearTimeout;
        this.defer = options.defer || setImmediate;
        this.batchSize = Math.max(1, Number(options.batchSize) || DEFAULT_EXPIRY_BATCH_SIZE);
        this.restoreBatchSize = Math.max(1, Number(options.restoreBatchSize) || DEFAULT_RESTORE_BATCH_SIZE);
        this.deferredRestore = options.deferredRestore === true;
        this.restoreYield = typeof options.restoreYield === 'function'
            ? options.restoreYield
            : callback => setImmediate(callback);
        this.onExpire = typeof options.onExpire === 'function' ? options.onExpire : () => {};
        this.onRestore = typeof options.onRestore === 'function' ? options.onRestore : null;
        this.onRestoreComplete = typeof options.onRestoreComplete === 'function'
            ? options.onRestoreComplete
            : null;
        this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : null;
        this.onCapacityAvailable = typeof options.onCapacityAvailable === 'function'
            ? options.onCapacityAvailable
            : null;
        this.journal = options.journal || createFileCandidateJournal(path.join(this.rootDir, 'candidates'));
        this.candidates = new Map();
        this.heap = [];
        this.reservations = new Map();
        this.inFlight = new Map();
        this.usedBytes = 0;
        this.timer = null;
        this.timerDueAt = 0;
        this.statusScheduled = false;
        this.initialized = false;
        this.closed = false;
        this.restoring = false;
        this.restoreTask = null;
        this.restoreError = null;
        this.restoreScanIncomplete = false;
        this.restoreSkipKeys = new Set();
        this.runtimeCandidateKeys = new Set();
        this.restoreStartedAt = 0;
        this.restoreAssetCount = 0;
    }

    initialize() {
        if (this.initialized) {
            return this.listCandidates();
        }
        this.initialized = true;
        fs.mkdirSync(this.stagingDir, { recursive: true });
        fs.mkdirSync(this.acquisitionDir, { recursive: true });
        fs.mkdirSync(this.archiveDirs.image, { recursive: true });
        fs.mkdirSync(this.archiveDirs.file, { recursive: true });
        if (this.deferredRestore && typeof this.journal.loadBatches === 'function') {
            this.restoring = true;
            this.restoreStartedAt = Date.now();
            this.restoreTask = this.restoreFromJournal();
            this.emitStatus();
            return this.listCandidates();
        }
        this.restoreSynchronously();
        return this.listCandidates();
    }

    restoreSynchronously() {
        const now = this.now();
        for (const source of this.journal.load()) {
            this.restoreCandidateSource(source, now);
        }
        this.sweepOrphanStagingFiles();
        this.sweepOrphanAcquisitionFiles();
        this.sweepTemporaryArchiveFiles();
        this.scheduleNext();
        this.emitStatus();
    }

    restoreCandidateSource(source, now = this.now(), foreground = false, notify = false) {
        const candidate = this.normalizeCandidate(source);
        if (!candidate || (!foreground && this.restoreSkipKeys.has(candidate.key))) {
            return null;
        }
        const existing = this.candidates.get(candidate.key);
        if (existing) {
            if (this.runtimeCandidateKeys.has(candidate.key)) {
                this.mergeRestoredCandidate(existing, candidate);
                this.runtimeCandidateKeys.delete(candidate.key);
            }
            return existing;
        }
        if (!Object.keys(candidate.assets).length) {
            this.journal.remove(candidate.key);
            return null;
        }
        const reconciled = this.reconcileCandidateFiles(candidate);
        if (!candidate.recalled && candidate.receivedAt + this.windowMs <= now) {
            this.deleteCandidateFiles(candidate);
            this.journal.remove(candidate.key);
            return null;
        }
        this.candidates.set(candidate.key, candidate);
        if (this.restoring) {
            this.restoreAssetCount += Object.keys(candidate.assets).length;
        }
        if (reconciled) {
            try {
                this.journal.write(candidate);
            } catch (error) {
                if (!notify) {
                    throw error;
                }
                this.restoreError ||= error;
            }
        }
        if (!candidate.recalled) {
            this.queueExpiry(candidate);
        }
        if (notify) {
            this.notifyRestoredCandidate(candidate);
        }
        return candidate;
    }

    mergeRestoredCandidate(target, source) {
        let changed = false;
        for (const [assetId, sourceAsset] of Object.entries(source.assets)) {
            const targetAsset = target.assets[assetId];
            if (!targetAsset) {
                this.reconcileCandidateAsset(target, sourceAsset);
                target.assets[assetId] = sourceAsset;
                if (this.restoring) {
                    this.restoreAssetCount += 1;
                }
                changed = true;
                continue;
            }
            // Keep the live record/metadata, but retain a valid staged/promoted file
            // found in the startup snapshot if the foreground event has not replaced it.
            if (['observed', 'failed', 'blocked-capacity'].includes(targetAsset.state) &&
                ['staged', 'promoted'].includes(sourceAsset.state)) {
                this.reconcileCandidateAsset(target, sourceAsset);
                if (['staged', 'promoted'].includes(sourceAsset.state)) {
                    Object.assign(targetAsset, sourceAsset);
                    changed = true;
                }
            }
        }
        if (changed) {
            this.journal.write(target);
        }
    }

    async restoreFromJournal() {
        let scanCompleted = false;
        try {
            for await (const sources of this.journal.loadBatches(this.restoreBatchSize)) {
                if (this.closed) {
                    break;
                }
                const now = this.now();
                for (const source of sources) {
                    if (this.closed) {
                        break;
                    }
                    try {
                        this.restoreCandidateSource(source, now, false, true);
                    } catch (error) {
                        this.restoreError ||= error;
                        const sourceKey = normalizeText(source?.key);
                        if (!sourceKey || !this.candidates.has(sourceKey)) {
                            this.restoreScanIncomplete = true;
                        }
                    }
                }
                if (!this.closed) {
                    await new Promise(resolve => this.restoreYield(resolve));
                }
            }
            scanCompleted = true;
            if (!this.closed) {
                await this.sweepOrphanFilesInBackground();
            }
        } catch (error) {
            this.restoreError ||= error;
            this.restoreScanIncomplete ||= !scanCompleted;
        } finally {
            this.restoring = false;
            this.restoreSkipKeys.clear();
            if (!this.restoreScanIncomplete) {
                this.runtimeCandidateKeys.clear();
            }
            if (!this.closed) {
                this.scheduleNext();
                try {
                    this.onRestoreComplete?.({
                        accountUin: this.accountUin,
                        candidateCount: this.candidates.size,
                        assetCount: this.restoreAssetCount,
                        usedBytes: this.usedBytes,
                        capacityBytes: this.capacityBytes,
                        restoring: false,
                        incomplete: Boolean(this.restoreError)
                    });
                } catch {
                }
            }
            this.emitStatus();
        }
    }

    async whenReady() {
        await this.restoreTask;
        if (this.restoreError) {
            throw this.restoreError;
        }
        return this.listCandidates();
    }

    notifyRestoredCandidate(candidate) {
        if (!this.onRestore) {
            return;
        }
        try {
            this.onRestore(cloneRecord(candidate));
        } catch {
            // A renderer/window may disappear while startup restoration is running.
        }
    }

    async sweepOrphanFilesInBackground() {
        const removeOldFile = async filePath => {
            try {
                const stat = await fsp.lstat(filePath);
                if (stat.isFile() && !stat.isSymbolicLink() && stat.mtimeMs < this.restoreStartedAt) {
                    await fsp.rm(filePath, { force: true });
                }
            } catch {
            }
        };
        const yieldBatch = () => new Promise(resolve => this.restoreYield(resolve));
        const ownedStaging = new Set();
        let candidateIndex = 0;
        for (const candidate of this.candidates.values()) {
            for (const asset of Object.values(candidate.assets)) {
                if (asset.stagingPath) {
                    ownedStaging.add(path.resolve(asset.stagingPath));
                }
            }
            candidateIndex += 1;
            if (candidateIndex % this.restoreBatchSize === 0) {
                await yieldBatch();
                if (this.closed) {
                    return;
                }
            }
        }
        const stagingEntries = await fsp.readdir(this.stagingDir, { withFileTypes: true }).catch(() => []);
        for (let index = 0; index < stagingEntries.length; index += this.restoreBatchSize) {
            if (this.closed) {
                return;
            }
            const batch = stagingEntries.slice(index, index + this.restoreBatchSize);
            await Promise.all(batch.filter(entry => entry.isFile()).map(entry => {
                const filePath = path.resolve(this.stagingDir, entry.name);
                if (!ownedStaging.has(filePath)) {
                    return removeOldFile(filePath);
                }
                return null;
            }));
            if (index + this.restoreBatchSize < stagingEntries.length) {
                await yieldBatch();
            }
        }
        const acquisitionEntries = await fsp.readdir(this.acquisitionDir, { withFileTypes: true }).catch(() => []);
        for (let index = 0; index < acquisitionEntries.length; index += this.restoreBatchSize) {
            if (this.closed) {
                return;
            }
            await Promise.all(acquisitionEntries.slice(index, index + this.restoreBatchSize)
                .filter(entry => entry.isFile())
                .map(entry => removeOldFile(path.join(this.acquisitionDir, entry.name))));
            if (index + this.restoreBatchSize < acquisitionEntries.length) {
                await yieldBatch();
            }
        }
        for (const directory of Object.values(this.archiveDirs)) {
            const entries = await fsp.readdir(directory, { withFileTypes: true }).catch(() => []);
            for (let index = 0; index < entries.length; index += this.restoreBatchSize) {
                if (this.closed) {
                    return;
                }
                await Promise.all(entries.slice(index, index + this.restoreBatchSize)
                    .filter(entry => entry.isFile() && /\.tmp-\d+-[0-9a-f]{8}$/i.test(entry.name))
                    .map(entry => removeOldFile(path.join(directory, entry.name))));
                if (index + this.restoreBatchSize < entries.length) {
                    await yieldBatch();
                }
            }
        }
    }

    normalizeCandidate(source) {
        const key = normalizeText(source?.key);
        const msgId = normalizeText(source?.msgId || source?.record?.msgId);
        const receivedAt = Number(source?.receivedAt);
        if (!key || !msgId || !Number.isFinite(receivedAt) || !source?.record) {
            return null;
        }
        const assets = {};
        for (const [assetId, value] of Object.entries(source.assets || {})) {
            const id = normalizeText(value?.id || assetId);
            if (!id || !['image', 'file'].includes(value?.kind)) {
                continue;
            }
            assets[id] = {
                id,
                kind: value.kind,
                elementIndex: Math.max(0, Number(value.elementIndex) || 0),
                elementId: normalizeText(value.elementId),
                fileName: normalizeText(value.fileName),
                expectedBytes: Math.max(0, Number(value.expectedBytes) || 0),
                actualBytes: Math.max(0, Number(value.actualBytes) || 0),
                state: normalizeText(value.state) || 'observed',
                acquisitionPath: normalizeText(value.acquisitionPath),
                stagingPath: normalizeText(value.stagingPath),
                archivePath: normalizeText(value.archivePath),
                sourcePath: normalizeText(value.sourcePath),
                failureReason: normalizeText(value.failureReason)
            };
        }
        return {
            key,
            msgId,
            peerUid: normalizeText(source.peerUid),
            receivedAt,
            generation: Math.max(1, Number(source.generation) || 1),
            recalled: source.recalled === true,
            record: source.record,
            assets
        };
    }

    reconcileCandidateFiles(candidate) {
        let changed = false;
        for (const asset of Object.values(candidate.assets)) {
            if (this.reconcileCandidateAsset(candidate, asset)) {
                changed = true;
            }
        }
        return changed;
    }

    reconcileCandidateAsset(candidate, asset) {
        let changed = false;
        if (asset.acquisitionPath) {
            const expectedPath = this.getAcquisitionPathForAsset(candidate, asset);
            if (isSamePath(asset.acquisitionPath, expectedPath) && getRegularFileStat(asset.acquisitionPath)) {
                this.removeOwnedAcquisitionFile(asset.acquisitionPath);
            }
            asset.acquisitionPath = '';
            changed = true;
            if (asset.state === 'acquiring') {
                asset.state = 'observed';
                asset.failureReason = '';
            }
        }
        if (asset.state === 'staged') {
            if (asset.archivePath) {
                asset.archivePath = '';
                changed = true;
            }
            const stat = this.getOwnedStagingFileStat(candidate, asset, asset.stagingPath);
            if (stat) {
                changed ||= asset.actualBytes !== stat.size;
                asset.actualBytes = stat.size;
                this.usedBytes += stat.size;
                applyAssetPath(candidate.record, asset, asset.stagingPath);
                return changed;
            }
            asset.state = 'observed';
            asset.stagingPath = '';
            asset.actualBytes = 0;
            asset.failureReason = '';
            return true;
        }
        if (asset.state === 'promoted') {
            if (asset.stagingPath) {
                asset.stagingPath = '';
                changed = true;
            }
            const stat = this.getOwnedArchiveFileStat(candidate, asset, asset.archivePath);
            if (stat) {
                changed ||= asset.actualBytes !== stat.size;
                asset.actualBytes = stat.size;
                applyAssetPath(candidate.record, asset, asset.archivePath);
                return changed;
            }
            asset.state = 'observed';
            asset.archivePath = '';
            asset.actualBytes = 0;
            asset.failureReason = '';
            return true;
        }
        if (asset.stagingPath || asset.archivePath) {
            asset.stagingPath = '';
            asset.archivePath = '';
            asset.actualBytes = 0;
            return true;
        }
        return changed;
    }

    sweepOrphanStagingFiles() {
        const owned = new Set();
        for (const candidate of this.candidates.values()) {
            for (const asset of Object.values(candidate.assets)) {
                if (asset.stagingPath) {
                    owned.add(path.resolve(asset.stagingPath));
                }
            }
        }
        for (const entry of fs.readdirSync(this.stagingDir, { withFileTypes: true })) {
            if (!entry.isFile()) {
                continue;
            }
            const filePath = path.resolve(this.stagingDir, entry.name);
            if (!owned.has(filePath)) {
                fs.rmSync(filePath, { force: true });
            }
        }
    }

    sweepOrphanAcquisitionFiles() {
        fs.mkdirSync(this.acquisitionDir, { recursive: true });
        for (const entry of fs.readdirSync(this.acquisitionDir, { withFileTypes: true })) {
            const filePath = path.join(this.acquisitionDir, entry.name);
            if (entry.isDirectory()) {
                fs.rmSync(filePath, { recursive: true, force: true });
            } else {
                fs.rmSync(filePath, { force: true });
            }
        }
    }

    sweepTemporaryArchiveFiles() {
        for (const directory of Object.values(this.archiveDirs)) {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                if (entry.isFile() && /\.tmp-\d+-[0-9a-f]{8}$/i.test(entry.name)) {
                    fs.rmSync(path.join(directory, entry.name), { force: true });
                }
            }
        }
    }

    listCandidates() {
        return Array.from(this.candidates.values()).map(cloneRecord);
    }

    hasCandidate(key, loadFromJournal = false) {
        const normalizedKey = normalizeText(key);
        if (!normalizedKey) {
            return false;
        }
        return Boolean(loadFromJournal
            ? this.ensureCandidateLoaded(normalizedKey)
            : this.candidates.get(normalizedKey));
    }

    isRestoring() {
        return this.restoring;
    }

    listPendingAssets() {
        return Array.from(this.iteratePendingAssets());
    }

    *iteratePendingAssets() {
        let remainingCandidates = this.candidates.size;
        for (const candidate of this.candidates.values()) {
            if (this.closed || remainingCandidates <= 0) {
                return;
            }
            remainingCandidates -= 1;
            for (const asset of Object.values(candidate.assets)) {
                if (this.closed) {
                    return;
                }
                if (!['staged', 'promoted'].includes(asset.state) &&
                    (asset.state !== 'failed' || candidate.recalled)) {
                    yield {
                        candidateKey: candidate.key,
                        assetId: asset.id
                    };
                }
            }
        }
    }

    ensureCandidateLoaded(key) {
        const normalizedKey = normalizeText(key);
        const existing = this.candidates.get(normalizedKey) || null;
        if (this.closed) {
            return existing;
        }
        const mayNeedDiskCandidate = this.restoring || this.restoreScanIncomplete;
        const needsRuntimeMerge = !this.restoring && this.restoreScanIncomplete &&
            this.runtimeCandidateKeys.has(normalizedKey);
        if (!normalizedKey || !mayNeedDiskCandidate ||
            typeof this.journal.loadOne !== 'function' ||
            (existing && !needsRuntimeMerge)) {
            return existing;
        }
        // A foreground message event has priority over a not-yet-read startup snapshot.
        // Loading one deterministic journal entry is bounded and keeps recall handling
        // correct while the rest of the directory is restored in the background.
        const source = this.journal.loadOne(normalizedKey);
        if (!source) {
            if (!this.restoring) {
                this.runtimeCandidateKeys.delete(normalizedKey);
            }
            return existing;
        }
        const candidate = this.restoreCandidateSource(source, this.now(), true);
        if (!candidate) {
            this.restoreSkipKeys.add(normalizedKey);
        }
        if (!this.restoring) {
            this.scheduleNext();
        }
        return candidate;
    }

    getCandidate(key) {
        const candidate = this.ensureCandidateLoaded(key);
        return candidate ? cloneRecord(candidate) : null;
    }

    updateCandidateRecord(key, record) {
        if (this.closed) {
            return false;
        }
        const candidate = this.ensureCandidateLoaded(key);
        if (!candidate || !record) {
            return false;
        }
        candidate.record = cloneRecord(record);
        for (const asset of Object.values(candidate.assets)) {
            const ownedPath = asset.archivePath || asset.stagingPath;
            if (ownedPath) {
                applyAssetPath(candidate.record, asset, ownedPath);
            }
        }
        this.journal.write(candidate);
        return true;
    }

    observeCandidate(value) {
        if (this.closed) {
            return null;
        }
        if (!this.initialized) {
            this.initialize();
        }
        const key = normalizeText(value?.key);
        const msgId = normalizeText(value?.msgId || value?.record?.msgId);
        if (!key || !msgId || !value?.record) {
            return null;
        }
        this.ensureCandidateLoaded(key);
        if (this.restoring) {
            this.runtimeCandidateKeys.add(key);
        }
        let candidate = this.candidates.get(key);
        let needsExpiry = false;
        if (!candidate) {
            candidate = {
                key,
                msgId,
                peerUid: normalizeText(value.peerUid),
                receivedAt: Number(value.receivedAt) || this.now(),
                generation: 1,
                recalled: false,
                record: cloneRecord(value.record),
                assets: {}
            };
            this.candidates.set(key, candidate);
            needsExpiry = true;
        } else if (!candidate.recalled) {
            candidate.record = cloneRecord(value.record);
            for (const asset of Object.values(candidate.assets)) {
                const ownedPath = asset.archivePath || asset.stagingPath;
                if (ownedPath) {
                    applyAssetPath(candidate.record, asset, ownedPath);
                }
            }
        }
        this.journal.write(candidate);
        if (!candidate.recalled && needsExpiry) {
            this.queueExpiry(candidate);
            this.scheduleNext();
        }
        this.emitStatus();
        return cloneRecord(candidate);
    }

    registerAsset(key, value) {
        if (this.closed) {
            return null;
        }
        const candidate = this.ensureCandidateLoaded(key);
        const id = normalizeText(value?.id);
        if (!candidate || !id || !['image', 'file'].includes(value?.kind)) {
            return null;
        }
        const existing = candidate.assets[id];
        if (existing) {
            existing.elementIndex = Math.max(0, Number(value.elementIndex) || existing.elementIndex || 0);
            existing.elementId = normalizeText(value.elementId) || existing.elementId;
            existing.fileName = normalizeText(value.fileName) || existing.fileName;
            existing.expectedBytes = Math.max(0, Number(value.expectedBytes) || existing.expectedBytes || 0);
            if (value.sourcePath) {
                existing.sourcePath = normalizeText(value.sourcePath);
            }
            this.journal.write(candidate);
            return cloneRecord(existing);
        }
        const asset = {
            id,
            kind: value.kind,
            elementIndex: Math.max(0, Number(value.elementIndex) || 0),
            elementId: normalizeText(value.elementId),
            fileName: normalizeText(value.fileName),
            expectedBytes: Math.max(0, Number(value.expectedBytes) || 0),
            actualBytes: 0,
            state: 'observed',
            acquisitionPath: '',
            stagingPath: '',
            archivePath: '',
            sourcePath: normalizeText(value.sourcePath),
            failureReason: ''
        };
        candidate.assets[id] = asset;
        if (this.restoring) {
            this.restoreAssetCount += 1;
        }
        this.journal.write(candidate);
        return cloneRecord(asset);
    }

    getAssetPath(candidate, asset, archive = false, sourcePath = '') {
        const extension = path.extname(sourcePath || asset.fileName).slice(0, 20);
        const digest = hash(`${candidate.key}:${asset.id}`).slice(0, 20);
        if (!archive) {
            return path.join(this.stagingDir, `${digest}${extension}`);
        }
        const fallback = asset.kind === 'image' ? `image-${digest}${extension || '.jpg'}` : `file-${digest}${extension}`;
        const fileName = sanitizeFileName(asset.fileName, fallback);
        const parsed = path.parse(fileName);
        const archiveName = `${parsed.name.slice(0, 90) || asset.kind}-${digest.slice(0, 8)}${parsed.ext || extension}`;
        return path.join(this.archiveDirs[asset.kind], archiveName);
    }

    getAcquisitionPath(key, assetId) {
        const normalizedKey = normalizeText(key);
        const normalizedAssetId = normalizeText(assetId);
        const candidate = this.ensureCandidateLoaded(normalizedKey);
        const asset = candidate?.assets?.[normalizedAssetId];
        if (!candidate || !asset) {
            return '';
        }
        return this.getAcquisitionPathForAsset(candidate, asset);
    }

    getAcquisitionPathForAsset(candidate, asset) {
        const extension = path.extname(asset.fileName).slice(0, 20);
        const digest = hash(`${candidate.key}:${asset.id}:acquisition`).slice(0, 24);
        return path.join(this.acquisitionDir, `${digest}${extension}`);
    }

    getOwnedStagingFileStat(candidate, asset, filePath) {
        const normalized = normalizeText(filePath);
        if (!normalized || !path.isAbsolute(normalized)) {
            return null;
        }
        const expectedPath = this.getAssetPath(candidate, asset, false, asset.sourcePath);
        return isSamePath(normalized, expectedPath) ? getRegularFileStat(normalized) : null;
    }

    getOwnedArchiveFileStat(candidate, asset, filePath) {
        const normalized = normalizeText(filePath);
        if (!normalized || !path.isAbsolute(normalized)) {
            return null;
        }
        const expectedPath = this.getAssetPath(candidate, asset, true, asset.sourcePath);
        return isSamePath(normalized, expectedPath) ? getRegularFileStat(normalized) : null;
    }

    isOwnedAcquisitionPath(filePath) {
        const normalized = normalizeText(filePath);
        return Boolean(normalized && path.isAbsolute(normalized) && isDirectChildPath(this.acquisitionDir, normalized));
    }

    isOwnedArchivePath(kind, filePath) {
        const directory = this.archiveDirs[kind];
        const normalized = normalizeText(filePath);
        return Boolean(directory && normalized && path.isAbsolute(normalized) && isDirectChildPath(directory, normalized));
    }

    removeOwnedAcquisitionFile(filePath) {
        if (!this.isOwnedAcquisitionPath(filePath)) {
            return false;
        }
        try {
            fs.rmSync(filePath, { recursive: true, force: true });
            return true;
        } catch {
            return false;
        }
    }

    reserve(assetKey, bytes) {
        const normalizedBytes = Math.max(0, Number(bytes) || 0);
        const previous = this.reservations.get(assetKey) || 0;
        if (!normalizedBytes ||
            this.usedBytes + this.getReservedBytes() - previous + normalizedBytes > this.capacityBytes) {
            return false;
        }
        this.reservations.set(assetKey, normalizedBytes);
        return true;
    }

    getReservedBytes() {
        let total = 0;
        for (const bytes of this.reservations.values()) {
            total += bytes;
        }
        return total;
    }

    releaseReservation(assetKey) {
        this.reservations.delete(assetKey);
    }

    beginAssetAcquisition(key, assetId) {
        if (this.closed) {
            return { ok: false, reason: 'manager-closed', state: 'canceled', direct: false };
        }
        if (!this.initialized) {
            this.initialize();
        }
        const normalizedKey = normalizeText(key);
        const normalizedAssetId = normalizeText(assetId);
        const candidate = this.ensureCandidateLoaded(normalizedKey);
        const asset = candidate?.assets?.[normalizedAssetId];
        const assetKey = `${normalizedKey}:${normalizedAssetId}`;
        if (!candidate || !asset) {
            return { ok: false, reason: 'candidate-missing', state: 'missing', direct: false };
        }
        if (asset.state === 'promoted' && asset.archivePath) {
            return { ok: true, reason: '', state: 'promoted', direct: false, path: asset.archivePath };
        }
        if (asset.state === 'staged' && asset.stagingPath) {
            return { ok: true, reason: '', state: 'staged', direct: false, path: asset.stagingPath };
        }
        const acquisitionPath = asset.kind === 'file'
            ? this.getAcquisitionPath(normalizedKey, normalizedAssetId)
            : '';
        if (acquisitionPath) {
            fs.mkdirSync(this.acquisitionDir, { recursive: true });
        }
        this.removeOwnedAcquisitionFile(asset.acquisitionPath);
        if (acquisitionPath && acquisitionPath !== asset.acquisitionPath) {
            this.removeOwnedAcquisitionFile(acquisitionPath);
        }
        asset.acquisitionPath = acquisitionPath;
        if (candidate.recalled) {
            this.releaseReservation(assetKey);
            asset.state = 'acquiring';
            asset.failureReason = '';
            this.journal.write(candidate);
            this.emitStatus();
            return {
                ok: true,
                reason: '',
                state: asset.state,
                direct: true,
                reservedBytes: 0,
                acquisitionPath
            };
        }
        const expectedBytes = Math.max(0, Number(asset.expectedBytes || asset.actualBytes) || 0);
        if (expectedBytes && !this.reserve(assetKey, expectedBytes)) {
            asset.state = 'blocked-capacity';
            asset.failureReason = 'capacity-full';
            this.journal.write(candidate);
            this.emitStatus();
            return { ok: false, reason: asset.failureReason, state: asset.state, direct: false };
        }
        asset.state = 'acquiring';
        asset.failureReason = '';
        this.journal.write(candidate);
        this.emitStatus();
        return {
            ok: true,
            reason: '',
            state: asset.state,
            direct: false,
            reservedBytes: this.reservations.get(assetKey) || 0,
            acquisitionPath
        };
    }

    failAssetAcquisition(key, assetId, reason = 'acquisition-failed') {
        if (this.closed) {
            return false;
        }
        const normalizedKey = normalizeText(key);
        const normalizedAssetId = normalizeText(assetId);
        const candidate = this.ensureCandidateLoaded(normalizedKey);
        const asset = candidate?.assets?.[normalizedAssetId];
        this.releaseReservation(`${normalizedKey}:${normalizedAssetId}`);
        if (asset?.acquisitionPath) {
            this.removeOwnedAcquisitionFile(asset.acquisitionPath);
            asset.acquisitionPath = '';
        }
        if (!candidate || !asset || ['staged', 'promoted'].includes(asset.state)) {
            this.notifyCapacityAvailable();
            this.emitStatus();
            return false;
        }
        asset.state = 'failed';
        asset.failureReason = normalizeText(reason) || 'acquisition-failed';
        this.journal.write(candidate);
        this.notifyCapacityAvailable();
        this.emitStatus();
        return true;
    }

    discardAsset(key, assetId) {
        if (this.closed) {
            return false;
        }
        const normalizedKey = normalizeText(key);
        const normalizedAssetId = normalizeText(assetId);
        const candidate = this.ensureCandidateLoaded(normalizedKey);
        const asset = candidate?.assets?.[normalizedAssetId];
        if (!candidate || !asset || ['staged', 'promoted'].includes(asset.state)) {
            return false;
        }
        this.releaseReservation(`${normalizedKey}:${normalizedAssetId}`);
        if (asset.acquisitionPath) {
            this.removeOwnedAcquisitionFile(asset.acquisitionPath);
            asset.acquisitionPath = '';
        }
        delete candidate.assets[normalizedAssetId];
        if (this.restoring) {
            this.restoreAssetCount = Math.max(0, this.restoreAssetCount - 1);
        }
        this.journal.write(candidate);
        this.notifyCapacityAvailable();
        this.emitStatus();
        return true;
    }

    async stageAssetFromPath(key, assetId, sourcePath) {
        if (this.closed) {
            return { ok: false, reason: 'manager-closed', state: 'canceled', path: '' };
        }
        if (!this.initialized) {
            this.initialize();
        }
        const normalizedKey = normalizeText(key);
        const normalizedAssetId = normalizeText(assetId);
        this.ensureCandidateLoaded(normalizedKey);
        if (this.isOwnedAcquisitionPath(sourcePath)) {
            return await this.adoptOwnedAcquisition(normalizedKey, normalizedAssetId, sourcePath);
        }
        const assetKey = `${normalizedKey}:${normalizedAssetId}`;
        if (this.inFlight.has(assetKey)) {
            return await this.inFlight.get(assetKey);
        }
        const task = this.stageAssetFromPathInner(normalizedKey, normalizedAssetId, sourcePath)
            .finally(() => this.inFlight.delete(assetKey));
        this.inFlight.set(assetKey, task);
        return await task;
    }

    async stageAssetFromPathInner(key, assetId, sourcePath) {
        const candidate = this.candidates.get(key);
        const asset = candidate?.assets?.[assetId];
        if (!candidate || !asset) {
            return { ok: false, reason: 'candidate-missing', state: 'missing', path: '' };
        }
        if (asset.state === 'promoted' && asset.archivePath) {
            return { ok: true, reason: '', state: 'promoted', path: asset.archivePath };
        }
        if (asset.state === 'staged' && asset.stagingPath) {
            return { ok: true, reason: '', state: 'staged', path: asset.stagingPath };
        }
        let stat;
        try {
            stat = await fsp.stat(sourcePath);
        } catch {
            stat = null;
        }
        if (!stat?.isFile() || stat.size <= 0) {
            this.releaseReservation(`${key}:${assetId}`);
            asset.state = 'failed';
            asset.failureReason = 'source-missing';
            this.journal.write(candidate);
            this.notifyCapacityAvailable();
            this.emitStatus();
            return { ok: false, reason: asset.failureReason, state: asset.state, path: '' };
        }
        asset.sourcePath = normalizeText(sourcePath);
        if (asset.kind === 'file' && asset.expectedBytes > 0 && stat.size !== asset.expectedBytes) {
            this.releaseReservation(`${key}:${assetId}`);
            asset.state = 'failed';
            asset.actualBytes = stat.size;
            asset.failureReason = 'size-mismatch';
            this.journal.write(candidate);
            this.notifyCapacityAvailable();
            this.emitStatus();
            return { ok: false, reason: asset.failureReason, state: asset.state, path: '' };
        }
        if (candidate.recalled) {
            this.releaseReservation(`${key}:${assetId}`);
            return await this.copyDirectToArchive(candidate, asset, sourcePath, stat.size);
        }
        if (!this.reserve(`${key}:${assetId}`, stat.size)) {
            asset.state = 'blocked-capacity';
            asset.actualBytes = stat.size;
            asset.failureReason = 'capacity-full';
            this.journal.write(candidate);
            this.emitStatus();
            return { ok: false, reason: asset.failureReason, state: asset.state, path: '' };
        }
        asset.state = 'acquiring';
        asset.failureReason = '';
        this.journal.write(candidate);
        const targetPath = this.getAssetPath(candidate, asset, false, sourcePath);
        const temporaryPath = `${targetPath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
        try {
            await fsp.mkdir(path.dirname(targetPath), { recursive: true });
            await fsp.copyFile(sourcePath, temporaryPath);
            const copied = await fsp.stat(temporaryPath);
            if (!copied.isFile() || copied.size !== stat.size) {
                throw new Error('copied-size-mismatch');
            }
            await fsp.rm(targetPath, { force: true });
            await fsp.rename(temporaryPath, targetPath);
            const current = this.candidates.get(key);
            const currentAsset = current?.assets?.[assetId];
            if (!current || !currentAsset) {
                await fsp.rm(targetPath, { force: true });
                this.notifyCapacityAvailable();
                return { ok: false, reason: 'candidate-expired', state: 'expired', path: '' };
            }
            this.releaseReservation(`${key}:${assetId}`);
            this.usedBytes += copied.size;
            currentAsset.state = 'staged';
            currentAsset.actualBytes = copied.size;
            currentAsset.stagingPath = targetPath;
            currentAsset.sourcePath = sourcePath;
            applyAssetPath(current.record, currentAsset, targetPath);
            if (current.recalled) {
                const result = this.promoteAssetSync(current, currentAsset);
                this.journal.write(current);
                this.notifyCapacityAvailable();
                this.emitStatus();
                return result;
            }
            this.journal.write(current);
            this.notifyCapacityAvailable();
            this.emitStatus();
            return { ok: true, reason: '', state: 'staged', path: targetPath };
        } catch (error) {
            this.releaseReservation(`${key}:${assetId}`);
            await fsp.rm(temporaryPath, { force: true }).catch(() => {});
            const current = this.candidates.get(key);
            const currentAsset = current?.assets?.[assetId];
            if (currentAsset) {
                currentAsset.state = 'failed';
                currentAsset.failureReason = normalizeText(error?.message || error) || 'copy-failed';
                this.journal.write(current);
            }
            this.notifyCapacityAvailable();
            this.emitStatus();
            return { ok: false, reason: currentAsset?.failureReason || 'copy-failed', state: 'failed', path: '' };
        }
    }

    async adoptOwnedAcquisition(key, assetId, sourcePath) {
        if (this.closed) {
            return { ok: false, reason: 'manager-closed', state: 'canceled', path: '' };
        }
        if (!this.initialized) {
            this.initialize();
        }
        const normalizedKey = normalizeText(key);
        const normalizedAssetId = normalizeText(assetId);
        this.ensureCandidateLoaded(normalizedKey);
        const assetKey = `${normalizedKey}:${normalizedAssetId}`;
        if (this.inFlight.has(assetKey)) {
            return await this.inFlight.get(assetKey);
        }
        const task = this.adoptOwnedAcquisitionInner(normalizedKey, normalizedAssetId, sourcePath)
            .finally(() => this.inFlight.delete(assetKey));
        this.inFlight.set(assetKey, task);
        return await task;
    }

    async adoptOwnedAcquisitionInner(key, assetId, sourcePath) {
        const candidate = this.candidates.get(key);
        const asset = candidate?.assets?.[assetId];
        const fail = (reason, state = 'failed') => {
            this.releaseReservation(`${key}:${assetId}`);
            if (asset) {
                this.removeOwnedAcquisitionFile(asset.acquisitionPath);
                asset.state = state;
                asset.failureReason = reason;
                asset.acquisitionPath = '';
                this.journal.write(candidate);
            }
            this.notifyCapacityAvailable();
            this.emitStatus();
            return { ok: false, reason, state, path: '' };
        };
        if (!candidate || !asset) {
            this.removeOwnedAcquisitionFile(sourcePath);
            return { ok: false, reason: 'candidate-missing', state: 'missing', path: '' };
        }
        const expectedPath = this.getAcquisitionPath(key, assetId);
        if (!this.isOwnedAcquisitionPath(sourcePath) ||
            path.resolve(sourcePath) !== path.resolve(expectedPath) ||
            (asset.acquisitionPath && path.resolve(sourcePath) !== path.resolve(asset.acquisitionPath))) {
            return fail('acquisition-path-not-owned');
        }
        let stat;
        try {
            stat = await fsp.lstat(sourcePath);
        } catch {
            stat = null;
        }
        if (!stat?.isFile() || stat.isSymbolicLink() || stat.size <= 0) {
            this.removeOwnedAcquisitionFile(sourcePath);
            return fail('source-missing');
        }
        if (asset.kind === 'file' && asset.expectedBytes > 0 && stat.size !== asset.expectedBytes) {
            asset.actualBytes = stat.size;
            this.removeOwnedAcquisitionFile(sourcePath);
            return fail('size-mismatch');
        }
        const current = this.candidates.get(key);
        const currentAsset = current?.assets?.[assetId];
        if (!current || !currentAsset) {
            this.removeOwnedAcquisitionFile(sourcePath);
            return { ok: false, reason: 'candidate-expired', state: 'expired', path: '' };
        }
        const recalledBeforeRename = current.recalled === true;
        const targetPath = this.getAssetPath(current, currentAsset, recalledBeforeRename, sourcePath);
        try {
            await fsp.mkdir(path.dirname(targetPath), { recursive: true });
            await fsp.rm(targetPath, { force: true });
            if (!this.candidates.has(key)) {
                this.removeOwnedAcquisitionFile(sourcePath);
                return { ok: false, reason: 'candidate-expired', state: 'expired', path: '' };
            }
            await fsp.rename(sourcePath, targetPath);
            const latest = this.candidates.get(key);
            const latestAsset = latest?.assets?.[assetId];
            if (!latest || !latestAsset) {
                await fsp.rm(targetPath, { force: true });
                this.releaseReservation(`${key}:${assetId}`);
                this.notifyCapacityAvailable();
                this.emitStatus();
                return { ok: false, reason: 'candidate-expired', state: 'expired', path: '' };
            }
            this.releaseReservation(`${key}:${assetId}`);
            latestAsset.acquisitionPath = '';
            latestAsset.actualBytes = stat.size;
            latestAsset.failureReason = '';
            latestAsset.sourcePath = targetPath;
            if (recalledBeforeRename) {
                latestAsset.state = 'promoted';
                latestAsset.archivePath = targetPath;
                latestAsset.stagingPath = '';
            } else {
                latestAsset.state = 'staged';
                latestAsset.stagingPath = targetPath;
                latestAsset.archivePath = '';
                this.usedBytes += stat.size;
            }
            applyAssetPath(latest.record, latestAsset, targetPath);
            if (!recalledBeforeRename && latest.recalled) {
                const result = this.promoteAssetSync(latest, latestAsset);
                this.journal.write(latest);
                this.notifyCapacityAvailable();
                this.emitStatus();
                return result;
            }
            this.journal.write(latest);
            this.notifyCapacityAvailable();
            this.emitStatus();
            return { ok: true, reason: '', state: latestAsset.state, path: targetPath };
        } catch (error) {
            this.removeOwnedAcquisitionFile(sourcePath);
            return fail(normalizeText(error?.message || error) || 'acquisition-adopt-failed');
        }
    }

    async copyDirectToArchive(candidate, asset, sourcePath, size) {
        this.releaseReservation(`${candidate.key}:${asset.id}`);
        const targetPath = this.getAssetPath(candidate, asset, true, sourcePath);
        const temporaryPath = `${targetPath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
        try {
            await fsp.mkdir(path.dirname(targetPath), { recursive: true });
            await fsp.copyFile(sourcePath, temporaryPath);
            const copied = await fsp.stat(temporaryPath);
            if (!copied.isFile() || copied.size !== size) {
                throw new Error('copied-size-mismatch');
            }
            await fsp.rm(targetPath, { force: true });
            await fsp.rename(temporaryPath, targetPath);
            asset.state = 'promoted';
            asset.actualBytes = copied.size;
            asset.acquisitionPath = '';
            asset.archivePath = targetPath;
            asset.stagingPath = '';
            asset.failureReason = '';
            applyAssetPath(candidate.record, asset, targetPath);
            this.journal.write(candidate);
            this.emitStatus();
            return { ok: true, reason: '', state: 'promoted', path: targetPath };
        } catch (error) {
            await fsp.rm(temporaryPath, { force: true }).catch(() => {});
            asset.state = 'failed';
            asset.failureReason = normalizeText(error?.message || error) || 'archive-copy-failed';
            this.journal.write(candidate);
            this.emitStatus();
            return { ok: false, reason: asset.failureReason, state: asset.state, path: '' };
        }
    }

    promoteAssetSync(candidate, asset) {
        if (asset.state === 'promoted' && asset.archivePath) {
            if (this.getOwnedArchiveFileStat(candidate, asset, asset.archivePath)) {
                return { ok: true, reason: '', state: 'promoted', path: asset.archivePath };
            }
            asset.state = 'observed';
            asset.archivePath = '';
            asset.actualBytes = 0;
            asset.failureReason = '';
            return { ok: false, reason: 'archive-path-not-owned', state: asset.state, path: '' };
        }
        if (asset.state !== 'staged' || !asset.stagingPath) {
            return { ok: false, reason: 'asset-not-staged', state: asset.state, path: '' };
        }
        if (!this.getOwnedStagingFileStat(candidate, asset, asset.stagingPath)) {
            asset.state = 'observed';
            asset.stagingPath = '';
            asset.actualBytes = 0;
            asset.failureReason = '';
            return { ok: false, reason: 'staging-path-not-owned', state: asset.state, path: '' };
        }
        const previousManagedPath = asset.stagingPath;
        const targetPath = this.getAssetPath(candidate, asset, true, previousManagedPath);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.rmSync(targetPath, { force: true });
        fs.renameSync(asset.stagingPath, targetPath);
        this.usedBytes = Math.max(0, this.usedBytes - asset.actualBytes);
        asset.state = 'promoted';
        asset.acquisitionPath = '';
        asset.archivePath = targetPath;
        asset.stagingPath = '';
        asset.failureReason = '';
        applyAssetPath(candidate.record, { ...asset, previousManagedPath }, targetPath);
        return { ok: true, reason: '', state: 'promoted', path: targetPath };
    }

    promoteCandidateSync(key) {
        if (this.closed) {
            return null;
        }
        if (!this.initialized) {
            this.initialize();
        }
        const candidate = this.ensureCandidateLoaded(key);
        if (!candidate) {
            return null;
        }
        candidate.recalled = true;
        candidate.generation += 1;
        const pendingAssetIds = [];
        for (const asset of Object.values(candidate.assets)) {
            if (asset.state === 'staged' || asset.state === 'promoted') {
                try {
                    const result = this.promoteAssetSync(candidate, asset);
                    if (!result.ok && asset.state !== 'promoted') {
                        pendingAssetIds.push(asset.id);
                    }
                } catch (error) {
                    asset.state = 'failed';
                    asset.failureReason = normalizeText(error?.message || error) || 'promotion-failed';
                    pendingAssetIds.push(asset.id);
                }
            } else if (asset.state !== 'promoted') {
                this.releaseReservation(`${candidate.key}:${asset.id}`);
                pendingAssetIds.push(asset.id);
            }
        }
        this.journal.write(candidate);
        this.scheduleNext();
        this.emitStatus();
        this.notifyCapacityAvailable();
        return {
            candidate: cloneRecord(candidate),
            pendingAssetIds
        };
    }

    completeCandidate(key) {
        if (this.closed) {
            return false;
        }
        const normalized = normalizeText(key);
        const candidate = this.ensureCandidateLoaded(normalized);
        if (!candidate?.recalled) {
            return false;
        }
        const pending = Object.values(candidate.assets).some(asset => asset.state !== 'promoted');
        if (pending) {
            return false;
        }
        if (this.restoring) {
            this.restoreAssetCount = Math.max(0,
                this.restoreAssetCount - Object.keys(candidate.assets).length);
        }
        this.restoreSkipKeys.add(normalized);
        this.candidates.delete(normalized);
        this.journal.remove(normalized);
        this.emitStatus();
        return true;
    }

    queueExpiry(candidate) {
        heapPush(this.heap, {
            key: candidate.key,
            generation: candidate.generation,
            expiresAt: candidate.receivedAt + this.windowMs
        });
    }

    getNextValidExpiry() {
        while (this.heap.length) {
            const first = this.heap[0];
            const candidate = this.candidates.get(first.key);
            if (!candidate || candidate.recalled || candidate.generation !== first.generation ||
                candidate.receivedAt + this.windowMs !== first.expiresAt) {
                heapPop(this.heap);
                continue;
            }
            return first;
        }
        return null;
    }

    scheduleNext(force = false) {
        if (this.closed) {
            return;
        }
        const next = this.getNextValidExpiry();
        if (!next) {
            if (this.timer !== null) {
                this.clearTimer(this.timer);
                this.timer = null;
            }
            this.timerDueAt = 0;
            return;
        }
        if (!force && this.timer !== null && this.timerDueAt > 0 && this.timerDueAt <= next.expiresAt) {
            return;
        }
        if (this.timer !== null) {
            this.clearTimer(this.timer);
            this.timer = null;
        }
        const delay = Math.max(0, next.expiresAt - this.now());
        this.timerDueAt = next.expiresAt;
        this.timer = this.setTimer(() => {
            this.timer = null;
            this.timerDueAt = 0;
            this.drainExpired();
        }, delay);
        this.timer?.unref?.();
    }

    drainExpired() {
        if (this.closed) {
            return;
        }
        let processed = 0;
        const now = this.now();
        while (processed < this.batchSize) {
            const next = this.getNextValidExpiry();
            if (!next || next.expiresAt > now) {
                break;
            }
            heapPop(this.heap);
            const candidate = this.candidates.get(next.key);
            if (!candidate || candidate.recalled) {
                continue;
            }
            this.expireCandidate(candidate);
            processed += 1;
        }
        const next = this.getNextValidExpiry();
        if (next && next.expiresAt <= this.now()) {
            this.defer(() => this.drainExpired());
        } else {
            this.scheduleNext();
        }
        if (processed) {
            this.notifyCapacityAvailable();
            this.emitStatus();
        }
    }

    expireCandidate(candidate) {
        this.deleteCandidateFiles(candidate);
        if (this.restoring) {
            this.restoreAssetCount = Math.max(0,
                this.restoreAssetCount - Object.keys(candidate.assets).length);
        }
        this.restoreSkipKeys.add(candidate.key);
        this.candidates.delete(candidate.key);
        this.journal.remove(candidate.key);
        this.onExpire(cloneRecord(candidate));
    }

    deleteCandidateFiles(candidate) {
        for (const asset of Object.values(candidate.assets)) {
            if (asset.acquisitionPath) {
                this.removeOwnedAcquisitionFile(asset.acquisitionPath);
                asset.acquisitionPath = '';
            }
            if (asset.stagingPath) {
                const stat = this.getOwnedStagingFileStat(candidate, asset, asset.stagingPath);
                if (stat) {
                    try {
                        fs.rmSync(asset.stagingPath, { force: true });
                        this.usedBytes = Math.max(0, this.usedBytes - stat.size);
                    } catch {
                    }
                }
                asset.stagingPath = '';
            }
            this.releaseReservation(`${candidate.key}:${asset.id}`);
        }
    }

    updateConfig(options = {}) {
        if (this.closed) {
            return;
        }
        if (Number.isFinite(options.windowMs) && options.windowMs > 0) {
            this.windowMs = options.windowMs;
        }
        if (Number.isFinite(options.capacityBytes) && options.capacityBytes > 0) {
            this.capacityBytes = options.capacityBytes;
        }
        this.heap = [];
        for (const candidate of this.candidates.values()) {
            candidate.generation += 1;
            if (!candidate.recalled) {
                this.queueExpiry(candidate);
            }
        }
        this.scheduleNext(true);
        this.defer(() => this.drainExpired());
        this.notifyCapacityAvailable();
        this.emitStatus();
    }

    notifyCapacityAvailable() {
        if (this.closed || !this.onCapacityAvailable ||
            this.usedBytes + this.getReservedBytes() >= this.capacityBytes) {
            return;
        }
        const blocked = [];
        for (const candidate of this.candidates.values()) {
            for (const asset of Object.values(candidate.assets)) {
                if (asset.state === 'blocked-capacity') {
                    blocked.push({ candidate, asset });
                }
            }
        }
        blocked.sort((left, right) =>
            Number(right.candidate.recalled) - Number(left.candidate.recalled) ||
            left.candidate.receivedAt - right.candidate.receivedAt
        );
        let availableBytes = this.capacityBytes - this.usedBytes - this.getReservedBytes();
        for (const item of blocked) {
            const requiredBytes = Math.max(0, Number(item.asset.actualBytes || item.asset.expectedBytes) || 0);
            if (!item.candidate.recalled && (!requiredBytes || requiredBytes > availableBytes)) {
                continue;
            }
            if (!item.candidate.recalled) {
                availableBytes -= requiredBytes;
            }
            this.onCapacityAvailable({
                candidate: cloneRecord(item.candidate),
                asset: cloneRecord(item.asset)
            });
        }
    }

    getStatus() {
        let blockedCount = 0;
        let assetCount = 0;
        let nextExpiryAt = 0;
        for (const candidate of this.candidates.values()) {
            if (!candidate.recalled) {
                const expiresAt = candidate.receivedAt + this.windowMs;
                nextExpiryAt = !nextExpiryAt ? expiresAt : Math.min(nextExpiryAt, expiresAt);
            }
            for (const asset of Object.values(candidate.assets)) {
                assetCount += 1;
                blockedCount += Number(asset.state === 'blocked-capacity');
            }
        }
        return {
            accountUin: this.accountUin,
            candidateCount: this.candidates.size,
            assetCount,
            blockedCount,
            usedBytes: this.usedBytes,
            reservedBytes: this.getReservedBytes(),
            capacityBytes: this.capacityBytes,
            nextExpiryAt,
            paused: blockedCount > 0,
            restoring: this.restoring
        };
    }

    emitStatus() {
        if (!this.onStatus || this.statusScheduled) {
            return;
        }
        this.statusScheduled = true;
        this.defer(() => {
            this.statusScheduled = false;
            if (!this.closed) {
                this.onStatus(this.getStatus());
            }
        });
    }

    async clear() {
        this.close();
        await this.restoreTask;
        await Promise.allSettled(Array.from(this.inFlight.values()));
        for (const candidate of this.candidates.values()) {
            this.deleteCandidateFiles(candidate);
        }
        this.candidates.clear();
        this.heap = [];
        this.reservations.clear();
        this.restoreAssetCount = 0;
        this.restoreScanIncomplete = false;
        this.runtimeCandidateKeys.clear();
        this.journal.clear();
        this.sweepOrphanAcquisitionFiles();
        this.emitStatus();
    }

    close() {
        this.closed = true;
        if (this.timer !== null) {
            this.clearTimer(this.timer);
            this.timer = null;
        }
        this.timerDueAt = 0;
    }
}

module.exports = {
    JOURNAL_VERSION,
    DEFAULT_EXPIRY_BATCH_SIZE,
    createFileCandidateJournal,
    applyAssetPath,
    AntiRecallStaging
};
