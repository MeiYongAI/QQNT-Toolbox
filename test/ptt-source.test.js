'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    createPttSourceResolver,
    normalizeWaveAmplitudes,
    sanitizePttInfo
} = require('../src/voice/ptt-source');

function createTemporaryDirectory(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-toolbox-ptt-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return directory;
}

function createCachedPtt(baseDir, month, fileName) {
    const oriDir = path.join(baseDir, month, 'Ori');
    fs.mkdirSync(oriDir, { recursive: true });
    const filePath = path.join(oriDir, fileName);
    fs.writeFileSync(filePath, fileName);
    return filePath;
}

test('normalizes bounded PTT waveform values', () => {
    assert.deepEqual(normalizeWaveAmplitudes([-10, 12.6, 120, 'bad']), [0, 13, 99]);
    assert.deepEqual(normalizeWaveAmplitudes(null), []);
});

test('reads only canonical PTT fields', () => {
    const md5 = 'AABBCCDDEEFF00112233445566778899';
    assert.deepEqual(sanitizePttInfo({
        pttElement: {
            filePath: 'D:\\voice\\real.amr',
            sourcePath: 'D:\\voice\\source.amr',
            fileName: 'real.amr',
            md5HexStr: md5,
            duration: 149,
            waveAmplitudes: new Uint8Array([0, 25, 100]),
            fileUuid: 'uuid',
            fileSubId: 'sub-id',
            fileId: 'file-id'
        },
        metadata: {
            filePath: 'D:\\voice\\wrong.amr',
            durationMs: 1
        }
    }), {
        filePath: 'D:\\voice\\real.amr',
        sourcePath: 'D:\\voice\\source.amr',
        fileName: 'real.amr',
        md5HexStr: md5.toLowerCase(),
        duration: 149,
        waveAmplitudes: [0, 25, 99],
        fileUuid: 'uuid',
        fileSubId: 'sub-id',
        fileId: 'file-id'
    });
});

test('uses an existing canonical path without scanning the cache', t => {
    const directory = createTemporaryDirectory(t);
    const filePath = path.join(directory, 'direct.amr');
    fs.writeFileSync(filePath, 'voice');
    let scans = 0;
    const resolver = createPttSourceResolver(() => {
        scans += 1;
        return [];
    });

    assert.equal(resolver.resolve({ filePath }), filePath);
    assert.equal(scans, 0);
});

test('indexes canonical month and Ori directories once per cache window', t => {
    const directory = createTemporaryDirectory(t);
    const pttBaseDir = path.join(directory, 'Ptt');
    const md5 = 'aabbccddeeff00112233445566778899';
    const filePath = createCachedPtt(pttBaseDir, '2026-05', `${md5}.amr`);
    let scans = 0;
    const resolver = createPttSourceResolver(() => {
        scans += 1;
        return [pttBaseDir];
    }, { cacheTtlMs: 60_000 });

    assert.equal(resolver.resolve({ md5HexStr: md5 }), filePath);
    assert.equal(resolver.resolve({ fileName: `${md5}.amr` }), filePath);
    assert.equal(scans, 1);
});

test('does not guess when a non-hash file name is ambiguous', t => {
    const directory = createTemporaryDirectory(t);
    const pttBaseDir = path.join(directory, 'Ptt');
    createCachedPtt(pttBaseDir, '2026-05', 'voice.amr');
    createCachedPtt(pttBaseDir, '2026-06', 'voice.amr');
    const resolver = createPttSourceResolver(() => [pttBaseDir]);

    assert.equal(resolver.resolve({ fileName: 'voice.amr' }), '');
});

test('treats a hash file name as an unambiguous content identity', t => {
    const directory = createTemporaryDirectory(t);
    const pttBaseDir = path.join(directory, 'Ptt');
    const fileName = 'aabbccddeeff00112233445566778899.amr';
    const newestPath = createCachedPtt(pttBaseDir, '2026-06', fileName);
    createCachedPtt(pttBaseDir, '2026-05', fileName);
    const resolver = createPttSourceResolver(() => [pttBaseDir]);

    assert.equal(resolver.resolve({ fileName }), newestPath);
});
