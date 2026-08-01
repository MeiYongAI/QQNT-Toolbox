'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    MAX_DOWNLOAD_TIMEOUT_MS,
    MIN_DOWNLOAD_TIMEOUT_MS,
    createPreservationDownloadPayload,
    getPreservationDownloadTimeout
} = require('../src/anti-recall-native-download');

test('builds the normal message download route even before QQ has assigned a local path', () => {
    assert.deepEqual(createPreservationDownloadPayload({
        msgId: 'message-1',
        chatType: 2,
        peerUid: '10086'
    }, {
        elementId: 'element-1'
    }, {
        fileName: 'sample.zip',
        filePath: ''
    }), [{
        getReq: {
            fileModelId: '0',
            downSourceType: 0,
            downloadSourceType: 0,
            triggerType: 1,
            msgId: 'message-1',
            chatType: 2,
            peerUid: '10086',
            elementId: 'element-1',
            thumbSize: 0,
            downloadType: 1,
            filePath: ''
        }
    }, null]);
});

test('forces a plugin-owned destination instead of reusing QQ or message paths', () => {
    const payload = createPreservationDownloadPayload({
        msgId: 'message-1',
        chatType: 2,
        peerUin: '10086'
    }, {
        elementId: 'element-1'
    }, {
        sourcePath: '/tmp/qq-download/sample.zip'
    }, '/tmp/plugin-staging/.acquiring/sample.zip');
    assert.equal(payload[0].getReq.filePath, '/tmp/plugin-staging/.acquiring/sample.zip');
});

test('keeps a real absolute existing path only when no owned destination was requested', () => {
    const payload = createPreservationDownloadPayload({
        msgId: 'message-1',
        chatType: 2,
        peerUin: '10086'
    }, {
        elementId: 'element-1'
    }, {
        sourcePath: '/tmp/qq-download/sample.zip'
    });
    assert.equal(payload[0].getReq.filePath, '/tmp/qq-download/sample.zip');
    assert.equal(createPreservationDownloadPayload({
        msgId: 'message-1', chatType: 2, peerUid: '10086'
    }, {
        elementId: 'element-1'
    }, {}, 'relative/sample.zip'), null);
    assert.equal(createPreservationDownloadPayload({ chatType: 2, peerUid: '10086' }, {
        elementId: 'element-1'
    }), null);
});

test('scales native download waiting time for large allowed files without waiting forever', () => {
    assert.equal(getPreservationDownloadTimeout(512), MIN_DOWNLOAD_TIMEOUT_MS);
    assert.ok(getPreservationDownloadTimeout(600 * 1024 * 1024) > 10 * 60 * 1000);
    assert.equal(getPreservationDownloadTimeout(Number.MAX_SAFE_INTEGER), MAX_DOWNLOAD_TIMEOUT_MS);
});
