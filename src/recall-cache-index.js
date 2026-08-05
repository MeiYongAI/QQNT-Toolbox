'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs').promises;
const path = require('node:path');
const { deserialize, serialize } = require('node:v8');
const { deflateSync, inflateSync } = require('node:zlib');
const {
    Worker,
    isMainThread,
    parentPort,
    workerData
} = require('node:worker_threads');

const INDEX_VERSION = 2;
const WORKER_TYPE = 'qqnt-toolbox:build-recall-cache-index';
const MAX_FRAME_BYTES = 256 * 1024 * 1024;
const DEFAULT_CHECKPOINT_DELAY_MS = 1000;
const DEFAULT_LOAD_BATCH_SIZE = 32;
const CACHE_FINGERPRINT_SAMPLE_BYTES = 4096;

function normalizeText(value) {
    return String(value ?? '').trim();
}

function getRecordKey(record) {
    return normalizeText(record?.msgId);
}

function getRecordAccount(record) {
    return normalizeText(record?.qqnt_toolbox_account_uin);
}

function isRecallRecordForAccount(record, accountUin) {
    const key = getRecordKey(record);
    const storedAccount = getRecordAccount(record);
    return Boolean(key && record?.qqnt_toolbox_recall &&
        (!storedAccount || storedAccount === normalizeText(accountUin)));
}

function decodePayload(payload) {
    return deserialize(inflateSync(payload));
}

function encodeRecord(record) {
    return deflateSync(serialize(record));
}

function isValidEntry(entry, fileSize) {
    const offset = Number(entry?.offset);
    const length = Number(entry?.length);
    return Number.isSafeInteger(offset) && Number.isSafeInteger(length) &&
        offset >= 4 && length > 0 && length <= MAX_FRAME_BYTES &&
        offset + length <= fileSize;
}

function readExactlySync(fileDescriptor, buffer, position) {
    let offset = 0;
    while (offset < buffer.length) {
        const bytesRead = fs.readSync(
            fileDescriptor,
            buffer,
            offset,
            buffer.length - offset,
            position + offset
        );
        if (!bytesRead) {
            return false;
        }
        offset += bytesRead;
    }
    return true;
}

function fingerprintCachePrefixSync(cachePath, prefixSize) {
    const size = Number(prefixSize);
    if (!Number.isSafeInteger(size) || size < 0) {
        return '';
    }
    let descriptor = null;
    try {
        const stat = fs.statSync(cachePath);
        if (!stat.isFile() || size > stat.size) {
            return '';
        }
        const digest = crypto.createHash('sha256');
        digest.update(`qqnt-toolbox:${size}:`);
        if (!size) {
            return digest.digest('hex');
        }
        descriptor = fs.openSync(cachePath, 'r');
        const sampleSize = Math.min(CACHE_FINGERPRINT_SAMPLE_BYTES, size);
        const positions = Array.from(new Set([
            0,
            Math.max(0, Math.floor((size - sampleSize) / 2)),
            size - sampleSize
        ]));
        for (const position of positions) {
            const sample = Buffer.allocUnsafe(sampleSize);
            if (!readExactlySync(descriptor, sample, position)) {
                return '';
            }
            digest.update(String(position));
            digest.update('\0');
            digest.update(sample);
        }
        return digest.digest('hex');
    } catch {
        return '';
    } finally {
        if (descriptor !== null) {
            try {
                fs.closeSync(descriptor);
            } catch {
            }
        }
    }
}

function readRecordAtSync(cachePath, entry, accountUin, expectedKey = '') {
    let descriptor = null;
    try {
        const stat = fs.statSync(cachePath);
        if (!stat.isFile() || !isValidEntry(entry, stat.size)) {
            return null;
        }
        descriptor = fs.openSync(cachePath, 'r');
        const header = Buffer.allocUnsafe(4);
        if (!readExactlySync(descriptor, header, entry.offset - 4) ||
            header.readUInt32BE(0) !== entry.length) {
            return null;
        }
        const payload = Buffer.allocUnsafe(entry.length);
        if (!readExactlySync(descriptor, payload, entry.offset)) {
            return null;
        }
        const record = decodePayload(payload);
        if (!isRecallRecordForAccount(record, accountUin) ||
            (expectedKey && getRecordKey(record) !== expectedKey)) {
            return null;
        }
        return record;
    } catch {
        return null;
    } finally {
        if (descriptor !== null) {
            try {
                fs.closeSync(descriptor);
            } catch {
            }
        }
    }
}

function scanCacheFileSync(cachePath, accountUin, targetKey = '') {
    const entries = new Map();
    let descriptor = null;
    let targetRecord = null;
    let fileSize = 0;
    let indexedSize = 0;
    let frameCount = 0;
    let invalidCount = 0;
    try {
        const stat = fs.statSync(cachePath);
        if (!stat.isFile()) {
            return { entries: [], fileSize, indexedSize, frameCount, invalidCount, targetRecord };
        }
        fileSize = stat.size;
        descriptor = fs.openSync(cachePath, 'r');
        const header = Buffer.allocUnsafe(4);
        while (indexedSize + 4 <= fileSize) {
            if (!readExactlySync(descriptor, header, indexedSize)) {
                break;
            }
            const length = header.readUInt32BE(0);
            const payloadOffset = indexedSize + 4;
            const frameEnd = payloadOffset + length;
            if (!length || length > MAX_FRAME_BYTES || frameEnd > fileSize) {
                invalidCount += 1;
                break;
            }
            const payload = Buffer.allocUnsafe(length);
            if (!readExactlySync(descriptor, payload, payloadOffset)) {
                invalidCount += 1;
                break;
            }
            try {
                const record = decodePayload(payload);
                if (isRecallRecordForAccount(record, accountUin)) {
                    const key = getRecordKey(record);
                    entries.set(key, { offset: payloadOffset, length });
                    if (targetKey && key === targetKey) {
                        targetRecord = record;
                    }
                }
            } catch {
                invalidCount += 1;
            }
            frameCount += 1;
            indexedSize = frameEnd;
        }
    } catch {
    } finally {
        if (descriptor !== null) {
            try {
                fs.closeSync(descriptor);
            } catch {
            }
        }
    }
    return {
        entries: Array.from(entries.entries()),
        fileSize,
        indexedSize,
        frameCount,
        invalidCount,
        targetRecord
    };
}

function normalizeIndexSnapshot(value, accountUin, cachePath, cacheSize) {
    const cacheFingerprint = normalizeText(value?.cacheFingerprint);
    if (value?.version !== INDEX_VERSION ||
        normalizeText(value.accountUin) !== normalizeText(accountUin) ||
        !Number.isSafeInteger(value.cacheSize) ||
        value.cacheSize < 0 || value.cacheSize > cacheSize ||
        !Number.isSafeInteger(value.indexedSize) ||
        value.indexedSize < 0 || value.indexedSize > value.cacheSize ||
        !cacheFingerprint || cacheFingerprint !==
            fingerprintCachePrefixSync(cachePath, value.cacheSize) ||
        !Array.isArray(value.entries)) {
        return null;
    }
    const entries = new Map();
    for (const tuple of value.entries) {
        const key = normalizeText(tuple?.[0]);
        const entry = tuple?.[1];
        if (key && isValidEntry(entry, cacheSize)) {
            entries.set(key, {
                offset: Number(entry.offset),
                length: Number(entry.length)
            });
        }
    }
    return { entries, indexedSize: value.indexedSize };
}

class RecallCacheIndexStore {
    constructor(options = {}) {
        this.accountUin = normalizeText(options.accountUin);
        this.cachePath = path.resolve(options.cachePath || 'active-recall-cache.bin');
        this.indexPath = path.resolve(options.indexPath || `${this.cachePath}.index`);
        this.checkpointDelayMs = Math.max(
            0,
            Number(options.checkpointDelayMs) || DEFAULT_CHECKPOINT_DELAY_MS
        );
        this.onError = typeof options.onError === 'function' ? options.onError : () => {};
        this.onIndexed = typeof options.onIndexed === 'function' ? options.onIndexed : () => {};
        this.createWorker = typeof options.createWorker === 'function'
            ? options.createWorker
            : (filename, workerOptions) => new Worker(filename, workerOptions);
        this.entries = new Map();
        this.indexedSize = 0;
        this.cacheSize = 0;
        this.initialized = false;
        this.closing = false;
        this.closed = false;
        this.closeTask = null;
        this.revision = 0;
        this.generation = 1;
        this.pendingWrites = [];
        this.checkpointTimer = null;
        this.checkpointTask = null;
        this.worker = null;
        this.indexTask = null;
        this.indexCancel = null;
    }

    initializeSync() {
        if (this.initialized) {
            return this.getStatus();
        }
        if (this.closing || this.closed) {
            return this.getStatus();
        }
        this.initialized = true;
        fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
        if (!fs.existsSync(this.cachePath)) {
            fs.writeFileSync(this.cachePath, Buffer.alloc(0));
        }
        this.cacheSize = fs.statSync(this.cachePath).size;
        try {
            const snapshot = normalizeIndexSnapshot(
                deserialize(fs.readFileSync(this.indexPath)),
                this.accountUin,
                this.cachePath,
                this.cacheSize
            );
            if (snapshot) {
                this.entries = snapshot.entries;
                this.indexedSize = snapshot.indexedSize;
            }
        } catch {
        }
        return this.getStatus();
    }

    getStatus() {
        return {
            accountUin: this.accountUin,
            recordCount: this.entries.size,
            indexedSize: this.indexedSize,
            cacheSize: this.cacheSize,
            indexing: Boolean(this.worker),
            complete: this.indexedSize === this.cacheSize
        };
    }

    getKeys() {
        this.initializeSync();
        return Array.from(this.entries.keys());
    }

    has(key) {
        this.initializeSync();
        if (this.closing || this.closed) {
            return false;
        }
        return this.entries.has(normalizeText(key));
    }

    getSync(key) {
        this.initializeSync();
        if (this.closing || this.closed) {
            return null;
        }
        const normalizedKey = normalizeText(key);
        if (!normalizedKey) {
            return null;
        }
        const indexed = this.entries.get(normalizedKey);
        const record = indexed
            ? readRecordAtSync(this.cachePath, indexed, this.accountUin, normalizedKey)
            : null;
        if (record) {
            return record;
        }
        if (!indexed && this.indexedSize >= this.cacheSize) {
            return null;
        }

        // A legacy cache has no visible message IDs outside its compressed payloads.
        // Only an early lookup before the worker finishes pays this one-time scan.
        const scan = scanCacheFileSync(this.cachePath, this.accountUin, normalizedKey);
        this.applyScanResult(scan);
        this.scheduleCheckpoint();
        return scan.targetRecord;
    }

    appendSync(record) {
        if (this.closing || this.closed) {
            throw new Error('Recall cache store is closed.');
        }
        this.initializeSync();
        const key = getRecordKey(record);
        if (!key || !isRecallRecordForAccount(record, this.accountUin)) {
            throw new Error('Invalid recall cache record.');
        }
        const payload = encodeRecord(record);
        if (!payload.length || payload.length > MAX_FRAME_BYTES) {
            throw new Error('Recall cache record is too large.');
        }
        const frameStart = fs.statSync(this.cachePath).size;
        const header = Buffer.allocUnsafe(4);
        header.writeUInt32BE(payload.length);
        fs.appendFileSync(this.cachePath, Buffer.concat([header, payload]));
        const entry = {
            offset: frameStart + 4,
            length: payload.length
        };
        this.entries.set(key, entry);
        if (this.indexTask || this.indexedSize !== frameStart) {
            this.pendingWrites.push({ key, entry });
        }
        this.cacheSize = frameStart + 4 + payload.length;
        if (this.indexedSize === frameStart) {
            this.indexedSize = this.cacheSize;
        }
        this.revision += 1;
        this.scheduleCheckpoint();
        return entry;
    }

    applyScanResult(scan) {
        const currentEntries = this.entries;
        this.entries = new Map(scan.entries || []);
        // A worker scans a fixed cache snapshot. Foreground fallback scans and
        // appendSync() may advance the live index before that worker replies, so
        // merge by append offset instead of allowing the older snapshot to win.
        for (const [key, entry] of currentEntries) {
            const scannedEntry = this.entries.get(key);
            if (!scannedEntry || entry.offset > scannedEntry.offset) {
                this.entries.set(key, entry);
            }
        }
        const pending = this.pendingWrites.splice(0);
        for (const { key, entry } of pending) {
            const scannedEntry = this.entries.get(key);
            if (!scannedEntry || entry.offset >= scannedEntry.offset) {
                this.entries.set(key, entry);
            }
        }
        let contiguousSize = Math.max(
            Number(scan.indexedSize) || 0,
            this.indexedSize
        );
        for (const { entry } of pending.sort((left, right) => left.entry.offset - right.entry.offset)) {
            const frameStart = entry.offset - 4;
            const frameEnd = entry.offset + entry.length;
            if (frameEnd <= contiguousSize) {
                continue;
            }
            if (frameStart === contiguousSize) {
                contiguousSize = frameEnd;
            }
        }
        this.cacheSize = Math.max(Number(scan.fileSize) || 0, this.cacheSize);
        this.indexedSize = Math.min(contiguousSize, this.cacheSize);
        this.revision += 1;
    }

    startIndexing() {
        if (this.closing || this.closed) {
            return Promise.resolve(this.getStatus());
        }
        this.initializeSync();
        if (this.indexedSize === this.cacheSize) {
            return Promise.resolve(this.getStatus());
        }
        if (this.indexTask) {
            return this.indexTask;
        }
        const generation = this.generation;
        let cancelTask = null;
        const task = new Promise((resolve, reject) => {
            let worker = null;
            let settled = false;
            this.worker = worker;
            const finish = () => {
                if (this.worker === worker) {
                    this.worker = null;
                }
            };
            const resolveOnce = value => {
                if (settled) {
                    return false;
                }
                settled = true;
                finish();
                resolve(value);
                return true;
            };
            const rejectOnce = error => {
                if (settled) {
                    return false;
                }
                settled = true;
                finish();
                reject(error);
                return true;
            };
            const fail = error => {
                if (this.closing || this.closed || this.generation !== generation) {
                    resolveOnce(this.getStatus());
                    return;
                }
                this.reportError(error);
                rejectOnce(error);
            };
            cancelTask = () => resolveOnce(this.getStatus());
            this.indexCancel = cancelTask;
            try {
                worker = this.createWorker(__filename, {
                    workerData: {
                        type: WORKER_TYPE,
                        cachePath: this.cachePath,
                        accountUin: this.accountUin
                    }
                });
                this.worker = worker;
            } catch (error) {
                fail(error);
                return;
            }
            worker.once('message', message => {
                if (settled) {
                    return;
                }
                if (this.closing || this.closed || this.generation !== generation) {
                    resolveOnce(this.getStatus());
                    return;
                }
                if (!message?.ok) {
                    const error = new Error(message?.error || 'Recall cache indexing failed.');
                    fail(error);
                    return;
                }
                try {
                    this.applyScanResult(message.result || {});
                    this.scheduleCheckpoint(0);
                    finish();
                    const status = {
                        ...this.getStatus(),
                        frameCount: Number(message.result?.frameCount) || 0,
                        invalidCount: Number(message.result?.invalidCount) || 0
                    };
                    this.onIndexed(status);
                    resolveOnce(status);
                } catch (error) {
                    fail(error);
                }
            });
            worker.once('error', error => {
                fail(error);
            });
            worker.once('exit', code => {
                if (settled) {
                    return;
                }
                const error = new Error(code === 0
                    ? 'Recall cache index worker exited before sending a result.'
                    : `Recall cache index worker exited with code ${code}.`);
                fail(error);
            });
        });
        const finalTask = task.finally(() => {
            if (this.indexTask === finalTask) {
                this.indexTask = null;
            }
            if (this.indexCancel === cancelTask) {
                this.indexCancel = null;
            }
            if (this.indexedSize === this.cacheSize) {
                this.pendingWrites.length = 0;
            }
        });
        this.indexTask = finalTask;
        return finalTask;
    }

    async loadAll(options = {}) {
        if (this.closing || this.closed) {
            return [];
        }
        this.initializeSync();
        if (this.indexedSize < this.cacheSize) {
            await this.startIndexing();
        }
        const batchSize = Math.max(1, Number(options.batchSize) || DEFAULT_LOAD_BATCH_SIZE);
        const records = [];
        const entries = Array.from(this.entries.entries());
        for (let index = 0; index < entries.length; index += batchSize) {
            for (const [key, entry] of entries.slice(index, index + batchSize)) {
                const record = readRecordAtSync(this.cachePath, entry, this.accountUin, key);
                if (record) {
                    records.push(record);
                }
            }
            if (index + batchSize < entries.length) {
                await new Promise(resolve => setImmediate(resolve));
            }
        }
        return records;
    }

    scheduleCheckpoint(delay = this.checkpointDelayMs) {
        if (this.closing || this.closed) {
            return;
        }
        clearTimeout(this.checkpointTimer);
        this.checkpointTimer = setTimeout(() => {
            this.checkpointTimer = null;
            this.checkpoint().catch(error => this.reportError(error));
        }, Math.max(0, Number(delay) || 0));
        this.checkpointTimer.unref?.();
    }

    createSnapshot() {
        return {
            version: INDEX_VERSION,
            accountUin: this.accountUin,
            cacheSize: this.cacheSize,
            cacheFingerprint: fingerprintCachePrefixSync(this.cachePath, this.cacheSize),
            indexedSize: this.indexedSize,
            entries: Array.from(this.entries.entries())
        };
    }

    async checkpoint(options = {}) {
        if (this.closed || (this.closing && options.allowClosing !== true)) {
            return;
        }
        this.initializeSync();
        if (this.checkpointTask) {
            return await this.checkpointTask;
        }
        const revision = this.revision;
        const generation = this.generation;
        const temporaryPath = `${this.indexPath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
        const payload = serialize(this.createSnapshot());
        this.checkpointTask = (async () => {
            await fsp.mkdir(path.dirname(this.indexPath), { recursive: true });
            try {
                await fsp.writeFile(temporaryPath, payload);
                if (this.closed || this.generation !== generation) {
                    return;
                }
                await fsp.rename(temporaryPath, this.indexPath).catch(async error => {
                    if (!['EEXIST', 'EPERM'].includes(error?.code)) {
                        throw error;
                    }
                    if (this.closed || this.generation !== generation) {
                        return;
                    }
                    await fsp.rm(this.indexPath, { force: true });
                    if (this.closed || this.generation !== generation) {
                        return;
                    }
                    await fsp.rename(temporaryPath, this.indexPath);
                });
            } finally {
                await fsp.rm(temporaryPath, { force: true }).catch(() => {});
            }
        })().finally(() => {
            this.checkpointTask = null;
            if (!this.closing && !this.closed && this.revision !== revision) {
                this.scheduleCheckpoint();
            }
        });
        return await this.checkpointTask;
    }

    checkpointSync(options = {}) {
        if (this.closed || (this.closing && options.allowClosing !== true)) {
            return;
        }
        this.initializeSync();
        clearTimeout(this.checkpointTimer);
        this.checkpointTimer = null;
        const temporaryPath = `${this.indexPath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
        fs.mkdirSync(path.dirname(this.indexPath), { recursive: true });
        try {
            fs.writeFileSync(temporaryPath, serialize(this.createSnapshot()));
            try {
                fs.renameSync(temporaryPath, this.indexPath);
            } catch (error) {
                if (!['EEXIST', 'EPERM'].includes(error?.code)) {
                    throw error;
                }
                fs.rmSync(this.indexPath, { force: true });
                fs.renameSync(temporaryPath, this.indexPath);
            }
        } finally {
            fs.rmSync(temporaryPath, { force: true });
        }
    }

    async close(options = {}) {
        if (this.closeTask) {
            return await this.closeTask;
        }
        if (this.closed) {
            return;
        }
        const cancel = options.cancel === true;
        this.closing = true;
        this.generation += 1;
        clearTimeout(this.checkpointTimer);
        this.checkpointTimer = null;
        const worker = this.worker;
        const indexTask = this.indexTask;
        this.indexCancel?.();
        this.closeTask = (async () => {
            if (worker) {
                await worker.terminate().catch(() => {});
            }
            await indexTask?.catch(() => {});
            const activeCheckpoint = this.checkpointTask;
            if (activeCheckpoint) {
                await activeCheckpoint.catch(error => this.reportError(error));
            }
            if (!cancel && this.initialized) {
                await this.checkpoint({ allowClosing: true })
                    .catch(error => this.reportError(error));
            }
        })().finally(() => {
            this.closed = true;
            this.closing = false;
            clearTimeout(this.checkpointTimer);
            this.checkpointTimer = null;
        });
        return await this.closeTask;
    }

    closeSync(options = {}) {
        if (this.closing || this.closed) {
            return;
        }
        this.closing = true;
        this.generation += 1;
        clearTimeout(this.checkpointTimer);
        this.checkpointTimer = null;
        const hasActiveCheckpoint = Boolean(this.checkpointTask);
        const worker = this.worker;
        this.indexCancel?.();
        worker?.terminate().catch(() => {});
        this.worker = null;
        if (options.cancel !== true && this.initialized && !hasActiveCheckpoint) {
            try {
                this.checkpointSync({ allowClosing: true });
            } catch (error) {
                this.reportError(error);
            }
        }
        this.closed = true;
        this.closing = false;
    }

    reportError(error) {
        try {
            this.onError(error);
        } catch {
        }
    }
}

function createRecallCacheIndexStore(options) {
    return new RecallCacheIndexStore(options);
}

if (!isMainThread && workerData?.type === WORKER_TYPE) {
    try {
        parentPort.postMessage({
            ok: true,
            result: scanCacheFileSync(workerData.cachePath, workerData.accountUin)
        });
    } catch (error) {
        parentPort.postMessage({
            ok: false,
            error: error?.message || String(error)
        });
    }
} else {
    module.exports = {
        INDEX_VERSION,
        MAX_FRAME_BYTES,
        RecallCacheIndexStore,
        createRecallCacheIndexStore,
        getRecordKey,
        readRecordAtSync,
        scanCacheFileSync
    };
}
