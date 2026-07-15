'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
    createNativeEventContext,
    isMessageRecord,
    isNativeMainChannel
} = require('../src/native-event-context');

test('collects commands, records, and peer aliases in one context', () => {
    const record = {
        chatType: 1,
        peerUid: 'u_peer',
        peerUin: '10001',
        senderUid: 'u_sender',
        senderUin: '10002',
        msgId: 'message-1',
        elements: [{ elementType: 1 }]
    };
    const context = createNativeEventContext([{
        cmdName: 'nodeIKernelMsgListener/onMsgInfoListUpdate',
        payload: {
            msgList: [record, record]
        }
    }]);

    assert.deepEqual(context.records, [record]);
    assert.deepEqual(context.aliases, [
        { peerUin: '10001', peerUid: 'u_peer' },
        { peerUin: '10002', peerUid: 'u_sender' }
    ]);
    assert.equal(context.commandNames.has('nodeIKernelMsgListener/onMsgInfoListUpdate'), true);
});

test('detects update notice groups without changing the normal traversal contract', () => {
    const payload = {
        unrelatedBranch: {
            nested: {
                configData: { group: '100084' }
            }
        }
    };

    assert.equal(createNativeEventContext([payload]).hasUnitedConfigGroup, false);
    assert.equal(createNativeEventContext([payload], {
        detectUnitedConfigGroup: true
    }).hasUnitedConfigGroup, true);
});

test('preserves native argument and message encounter order', () => {
    const first = { msgId: 'first', elements: [] };
    const second = { msgId: 'second', elements: [] };
    const context = createNativeEventContext([
        { payload: { msgList: [first] } },
        { payload: { msgList: [second] } }
    ]);

    assert.deepEqual(context.records, [first, second]);
});

test('ignores binary and map payloads and recognizes supported channels', () => {
    const hiddenRecord = { msgId: 'hidden', elements: [] };
    const context = createNativeEventContext([{
        payload: {
            binary: new Uint8Array([1, 2, 3]),
            mapped: new Map([['record', hiddenRecord]])
        }
    }], { detectUnitedConfigGroup: true });

    assert.deepEqual(context.records, []);
    assert.equal(isMessageRecord(hiddenRecord), true);
    assert.equal(isNativeMainChannel('RM_IPCFROM_MAIN42'), true);
    assert.equal(isNativeMainChannel('RM_IPCFROM_RENDERER42'), false);
    assert.equal(isNativeMainChannel('unrelated-channel'), false);
});

test('main and voice features consume the shared native context', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const voiceSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'voice-file-sender.js'), 'utf8');

    assert.equal((mainSource.match(/createNativeEventContext\(args/g) || []).length, 1);
    assert.doesNotMatch(mainSource, /function collect(?:MsgRecords|NativePeerAliases)/);
    assert.doesNotMatch(voiceSource, /addNativeSendHandler|function collectNativePeerAliases/);
    assert.match(voiceSource, /function rememberNativePeerAliases\(browserWindow, aliases\)/);
});
