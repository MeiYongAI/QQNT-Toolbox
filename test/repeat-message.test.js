'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    RepeatRoute,
    classifyRepeatRoute,
    createRepeatMessageHandler,
    mapWithConcurrency
} = require('../src/repeat-message');

test('mounts side repeat controls lazily without a body-wide repeat observer', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

    assert.doesNotMatch(source, /repeatObserver\s*=\s*new MutationObserver/);
    assert.doesNotMatch(source, /addEventListener\('scroll',\s*scheduleRepeatEntrypointRefresh/);
    assert.match(source, /repeatResizeObserver\s*=\s*new ResizeObserver/);
    assert.match(source, /addEventListener\('pointerover',\s*handleRepeatMessagePointerOver/);
    assert.match(source, /addEventListener\('pointerout',\s*handleRepeatMessagePointerOut/);
    assert.match(source, /getMessageContextTargetFromEvent\(sourceEvent\)/);
    assert.match(source, /!isSearchChatRecordWindow\(\)[\s\S]*repeatMessage\.showInContextMenu/);
    assert.match(source, /isForwardRecordWindow\(\)[\s\S]*elementType\) === 16[\s\S]*showFallbackRepeatMenu/);
    assert.doesNotMatch(source, /openFromElement/);
});

test('maps repeat resources with bounded concurrency while preserving order', async () => {
    let active = 0;
    let peak = 0;
    const result = await mapWithConcurrency([30, 5, 15, 1], 2, async (delay, index) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, delay));
        active -= 1;
        return `item-${index}`;
    });

    assert.equal(peak, 2);
    assert.deepEqual(result, ['item-0', 'item-1', 'item-2', 'item-3']);
});

test('prepares forward-detail videos without applying the NoSeq thumbnail blur', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

    assert.match(source, /mapWithConcurrency\(\s*sourceElements,\s*2,/);
    assert.match(source, /downloadForwardDetailVideo\(browserWindow, record, element\)/);
    assert.match(source, /blurThumbnail:\s*false/);
});

test('uses QQ native sub-message forwarding for nested detail cards', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

    assert.match(mainSource, /forwardSubMsgWithComment/);
    assert.doesNotMatch(mainSource, /forwardRichMsgInVist/);
    assert.doesNotMatch(mainSource, /SsoRecvLongMsg|SsoSendLongMsg/);
    assert.doesNotMatch(mainSource, /com\.tencent\.multimsg/);
    assert.match(rendererSource, /payload\.forwardContext\s*=\s*getForwardRouteContext\(\)/);
});

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
    assert.equal(
        classifyRepeatRoute({ elements: [{ elementType: 5, videoElement: {} }] }, true),
        RepeatRoute.NATIVE_FORWARD
    );
    assert.equal(
        classifyRepeatRoute({
            elements: [
                { elementType: 2, picElement: {} },
                { elementType: 5, videoElement: {} }
            ]
        }, true),
        RepeatRoute.FORWARD_DETAIL_REBUILD
    );
});

test('dispatches a detail-window nested card through QQ native sub-message forwarding', async () => {
    const calls = [];
    const sourcePeer = { chatType: 2, peerUid: 'source', guildId: '' };
    const destinationPeer = { chatType: 1, peerUid: 'destination', guildId: '' };
    const record = {
        msgId: '42',
        senderUid: 'original-sender',
        elements: [{
            elementType: 16,
            elementId: 'received-id',
            multiForwardMsgElement: {
                xmlContent: '<msg><item><title>Chat history</title>' +
                    '<title>Alice: hello</title><summary>View 1 message</summary></item></msg>',
                resId: 'resource-id',
                fileName: 'MultiMsg'
            }
        }]
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
            prepareForwardDetail: async () => {
                calls.push('prepare');
                return preparedRecord;
            },
            repeatBySend: async (_window, _peer, record, options = {}) => {
                assert.equal(record, preparedRecord);
                assert.deepEqual(options, { confirm: true, detached: true });
                calls.push(options.confirm ? 'send-confirmed' : 'send');
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
