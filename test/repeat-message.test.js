'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    RepeatRoute,
    classifyRepeatRoute,
    createRepeatMessageHandler
} = require('../src/repeat-message');

test('classifies repeat routes without changing established send behavior', () => {
    const cases = [
        {
            name: 'plain text',
            record: { elements: [{ elementType: 1, textElement: { content: 'hello' } }] },
            route: RepeatRoute.SEND_COPY
        },
        {
            name: 'mention text',
            record: { elements: [{ elementType: 1, textElement: { atType: 2 } }] },
            route: RepeatRoute.SEND_COPY
        },
        {
            name: 'voice',
            record: { elements: [{ elementType: 4, pttElement: {} }] },
            route: RepeatRoute.VOICE
        },
        {
            name: 'image',
            record: { elements: [{ elementType: 2, picElement: {} }] },
            route: RepeatRoute.NATIVE_FORWARD
        },
        {
            name: 'video',
            record: { elements: [{ elementType: 5, videoElement: {} }] },
            route: RepeatRoute.NATIVE_FORWARD
        },
        {
            name: 'nested forward outside detail',
            record: { elements: [{ elementType: 16, multiForwardMsgElement: {} }] },
            route: RepeatRoute.NATIVE_FORWARD
        }
    ];

    for (const item of cases) {
        assert.equal(classifyRepeatRoute(item.record), item.route, item.name);
    }
    assert.equal(
        classifyRepeatRoute({ elements: [{ elementType: 2, picElement: {} }] }, true),
        RepeatRoute.FORWARD_DETAIL_REBUILD
    );
    assert.equal(
        classifyRepeatRoute({ elements: [{ elementType: 3, fileElement: {} }] }, true),
        RepeatRoute.FORWARD_DETAIL_REBUILD
    );
    assert.equal(
        classifyRepeatRoute({ elements: [{ elementType: 16, multiForwardMsgElement: {} }] }, true),
        RepeatRoute.NESTED_FORWARD
    );
});

test('dispatches a forward-detail nested card without reloading the source record', async () => {
    const calls = [];
    const sourcePeer = { chatType: 2, peerUid: 'source', guildId: '' };
    const destinationPeer = { chatType: 1, peerUid: 'destination', guildId: '' };
    const record = {
        msgId: '42',
        elements: [{ elementType: 16, multiForwardMsgElement: { fileName: 'MultiMsg' } }]
    };
    const handler = createRepeatMessageHandler({
        isEnabled: () => true,
        normalizeText: value => String(value || ''),
        resolveSourcePeer: () => sourcePeer,
        resolveDestinationPeer: () => destinationPeer,
        loadSourceRecord: async () => {
            throw new Error('forward-detail records must not be reloaded');
        },
        repeatVoice: async () => calls.push('voice'),
        repeatNestedForward: async (...args) => {
            calls.push(['nested', ...args]);
            return 'nested-result';
        },
        prepareForwardDetail: async () => calls.push('prepare'),
        repeatBySend: async () => calls.push('send'),
        repeatByNativeForward: async () => calls.push('forward')
    });
    const browserWindow = {};
    const forwardContext = { rootMsg: { msgId: '1' } };

    const result = await handler(browserWindow, {
        msgId: record.msgId,
        peer: sourcePeer,
        destinationPeer,
        recordSource: 'forward-detail',
        forwardContext,
        record
    });

    assert.equal(result, 'nested-result');
    assert.deepEqual(calls, [[
        'nested',
        browserWindow,
        destinationPeer,
        record,
        forwardContext
    ]]);
});

test('loads normal records and keeps mention messages on the send-copy route', async () => {
    const calls = [];
    const sourcePeer = { chatType: 2, peerUid: 'source', guildId: '' };
    const record = {
        msgId: '84',
        elements: [{ elementType: 1, textElement: { atType: 2, content: '@user' } }]
    };
    const handler = createRepeatMessageHandler({
        isEnabled: () => true,
        normalizeText: value => String(value || ''),
        resolveSourcePeer: () => sourcePeer,
        resolveDestinationPeer: (_window, _payload, peer) => peer,
        loadSourceRecord: async (...args) => {
            calls.push(['load', ...args]);
            return record;
        },
        repeatVoice: async () => calls.push('voice'),
        repeatNestedForward: async () => calls.push('nested'),
        prepareForwardDetail: async () => calls.push('prepare'),
        repeatBySend: async (...args) => {
            calls.push(['send', ...args]);
            return 'send-result';
        },
        repeatByNativeForward: async () => calls.push('forward')
    });
    const browserWindow = {};

    const result = await handler(browserWindow, { msgId: record.msgId, peer: sourcePeer });

    assert.equal(result, 'send-result');
    assert.deepEqual(calls, [
        ['load', browserWindow, sourcePeer, record.msgId],
        ['send', browserWindow, sourcePeer, record]
    ]);
});

test('dispatches voice, forward-detail media, and native-forward routes independently', async () => {
    const sourcePeer = { chatType: 2, peerUid: 'source', guildId: '' };
    const destinationPeer = { chatType: 1, peerUid: 'destination', guildId: '' };
    const scenarios = [
        {
            name: 'voice',
            record: { msgId: '1', elements: [{ elementType: 4, pttElement: {} }] },
            expected: ['voice']
        },
        {
            name: 'forward-detail media',
            record: { msgId: '2', elements: [{ elementType: 2, picElement: {} }] },
            forwardDetail: true,
            expected: ['prepare', 'send-confirmed']
        },
        {
            name: 'native forward',
            record: { msgId: '3', elements: [{ elementType: 5, videoElement: {} }] },
            expected: ['forward']
        }
    ];

    for (const scenario of scenarios) {
        const calls = [];
        const preparedRecord = { ...scenario.record, prepared: true };
        const handler = createRepeatMessageHandler({
            isEnabled: () => true,
            normalizeText: value => String(value || ''),
            resolveSourcePeer: () => sourcePeer,
            resolveDestinationPeer: () => destinationPeer,
            loadSourceRecord: async () => scenario.record,
            repeatVoice: async () => calls.push('voice'),
            repeatNestedForward: async () => calls.push('nested'),
            prepareForwardDetail: async () => {
                calls.push('prepare');
                return preparedRecord;
            },
            repeatBySend: async (_window, _peer, record, confirm) => {
                assert.equal(record, preparedRecord);
                calls.push(confirm ? 'send-confirmed' : 'send');
            },
            repeatByNativeForward: async () => calls.push('forward')
        });
        const payload = {
            msgId: scenario.record.msgId,
            peer: sourcePeer
        };
        if (scenario.forwardDetail) {
            payload.destinationPeer = destinationPeer;
            payload.recordSource = 'forward-detail';
            payload.record = scenario.record;
        }

        await handler({}, payload);
        assert.deepEqual(calls, scenario.expected, scenario.name);
    }
});
