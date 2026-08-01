'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    BYTE_UNITS,
    MAX_FILE_BYTES,
    DEFAULT_FILE_SIZE_RANGE,
    parseExactBytes,
    parseStagingWindow,
    normalizeFileSizeRange,
    normalizeReceivedFileAutoDownloadConfig,
    collectReceivedFileTargets
} = require('../src/anti-recall-preservation-config');

const GROUP = { chatType: 2, peerUid: '10086', label: '测试群' };

function config(overrides = {}) {
    return {
        enabled: true,
        groups: [GROUP],
        sizeRange: {
            min: { ...DEFAULT_FILE_SIZE_RANGE.min },
            max: { ...DEFAULT_FILE_SIZE_RANGE.max }
        },
        ...overrides
    };
}

function record(fileSize, fileName = 'sample.bin', overrides = {}) {
    return {
        chatType: 2,
        peerUid: '10086',
        msgId: 'message-1',
        elements: [{
            elementId: 'element-1',
            elementType: 3,
            fileElement: { fileName, fileSize }
        }],
        ...overrides
    };
}

test('converts B, KB, MB, and GB decimal strings exactly', () => {
    assert.equal(parseExactBytes({ value: '1', unit: 'B' }).bytes, 1);
    assert.equal(parseExactBytes({ value: '0.5', unit: 'KB' }).bytes, 512);
    assert.equal(parseExactBytes({ value: '1', unit: 'MB' }).bytes, BYTE_UNITS.MB);
    assert.equal(parseExactBytes({ value: '0.5', unit: 'GB' }).bytes, 512 * BYTE_UNITS.MB);
    assert.equal(parseExactBytes({ value: '0.1', unit: 'KB' }).reason, 'partial-byte');
    assert.equal(parseExactBytes({ value: '1.0000', unit: 'KB' }).reason, 'invalid-decimal');
});

test('uses a 5 minute to 30 day shared staging window', () => {
    assert.equal(parseStagingWindow({ value: 5, unit: 'MINUTE' }).ok, true);
    assert.equal(parseStagingWindow({ value: 24, unit: 'HOUR' }).ok, true);
    assert.equal(parseStagingWindow({ value: 30, unit: 'DAY' }).ok, true);
    assert.equal(parseStagingWindow({ value: 4, unit: 'MINUTE' }).ok, false);
    assert.equal(parseStagingWindow({ value: 31, unit: 'DAY' }).ok, false);
});

test('enforces the closed default interval from 0.5 KB through 600 MB', () => {
    const range = normalizeFileSizeRange(DEFAULT_FILE_SIZE_RANGE);
    assert.equal(range.ok, true);
    assert.equal(range.min.bytes, 512);
    assert.equal(range.max.bytes, MAX_FILE_BYTES);
    assert.equal(collectReceivedFileTargets(config(), record(511)).length, 0);
    assert.equal(collectReceivedFileTargets(config(), record(512)).length, 1);
    assert.equal(collectReceivedFileTargets(config(), record(MAX_FILE_BYTES)).length, 1);
    assert.equal(collectReceivedFileTargets(config(), record(MAX_FILE_BYTES + 1)).length, 0);
});

test('allows exact cross-unit ranges and rejects invalid or inverted ranges', () => {
    const exact = normalizeFileSizeRange({
        min: { value: '1024', unit: 'KB' },
        max: { value: '1', unit: 'MB' }
    });
    assert.equal(exact.ok, true);
    assert.equal(exact.min.bytes, exact.max.bytes);
    assert.equal(normalizeFileSizeRange({
        min: { value: '2', unit: 'MB' },
        max: { value: '1', unit: 'MB' }
    }).reason, 'inverted-range');
    assert.equal(normalizeFileSizeRange({
        min: { value: '0.1', unit: 'KB' },
        max: { value: '600', unit: 'MB' }
    }).ok, false);
});

test('fails closed when a manually damaged range is normalized', () => {
    const normalized = normalizeReceivedFileAutoDownloadConfig(config({
        sizeRange: {
            min: { value: 'broken', unit: 'KB' },
            max: { value: '600', unit: 'MB' }
        }
    }));
    assert.equal(normalized.enabled, false);
    assert.deepEqual(normalized.sizeRange, DEFAULT_FILE_SIZE_RANGE);
});

test('only selects real-time caller-provided group records on the independent whitelist', () => {
    assert.equal(collectReceivedFileTargets(config({ groups: [] }), record(1024)).length, 0);
    assert.equal(collectReceivedFileTargets(config(), record(1024, 'a.zip', {
        chatType: 1,
        peerUid: '10086'
    })).length, 0);
    assert.equal(collectReceivedFileTargets(config(), record(1024, 'a.js')).length, 1);
    assert.equal(collectReceivedFileTargets(config(), record(1024, 'a.txt')).length, 1);
    assert.equal(collectReceivedFileTargets(config(), record(1024, '')).length, 1);
});

test('rejects zero, unknown, fractional, or identity-less files', () => {
    assert.equal(collectReceivedFileTargets(config(), record(0)).length, 0);
    assert.equal(collectReceivedFileTargets(config(), record(undefined)).length, 0);
    assert.equal(collectReceivedFileTargets(config(), record(512.5)).length, 0);
    assert.equal(collectReceivedFileTargets(config(), record(1024, 'a.txt', { msgId: '' })).length, 0);
});
