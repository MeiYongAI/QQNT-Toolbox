'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    getAutoPokeMessageDecision,
    getAutoPokeMessageKey,
    normalizeAutoPokeTriggerConfig
} = require('../src/auto-poke');

const identity = { selfUin: '10001', selfUid: 'u_self' };

function makeRecord(elements = [], overrides = {}) {
    return {
        chatType: 2,
        peerUid: '998877',
        msgId: 'message-id',
        msgSeq: '123',
        msgTime: Math.floor(Date.now() / 1000),
        sendType: 2,
        senderUin: '20002',
        senderUid: 'u_other',
        elements,
        ...overrides
    };
}

test('keeps message-triggered auto-poke conditions opt-in', () => {
    assert.deepEqual(normalizeAutoPokeTriggerConfig(), {
        poked: true,
        mentionSelf: false,
        replySelf: false,
        excludeAtAll: true
    });
    assert.deepEqual(normalizeAutoPokeTriggerConfig({
        poked: false,
        mentionSelf: 1,
        replySelf: true,
        excludeAtAll: false
    }), {
        poked: false,
        mentionSelf: false,
        replySelf: true,
        excludeAtAll: false
    });
});

test('matches direct mentions and replies while excluding at-all first', () => {
    const config = { mentionSelf: true, replySelf: true, excludeAtAll: true };
    const decision = getAutoPokeMessageDecision(makeRecord([
        { textElement: { atType: 2, atNtUid: 'u_self' } },
        { replyElement: { senderUin: '10001' } }
    ]), identity, config);
    assert.equal(decision.matched, true);
    assert.deepEqual(decision.reasons, ['mention-self', 'reply-self']);

    const excluded = getAutoPokeMessageDecision(makeRecord([
        { textElement: { atType: 1 } },
        { replyElement: { senderUin: '10001' } }
    ]), identity, config);
    assert.equal(excluded.matched, false);
    assert.equal(excluded.excluded, true);

    const allowedAtAll = getAutoPokeMessageDecision(makeRecord([
        { textElement: { atType: 1 } }
    ]), identity, { ...config, excludeAtAll: false });
    assert.equal(allowedAtAll.matched, true);
    assert.deepEqual(allowedAtAll.reasons, ['mention-self']);
});

test('builds distinct message keys for group and private auto-pokes', () => {
    assert.equal(
        getAutoPokeMessageKey(makeRecord(), '10001'),
        '10001:message:2:998877:message-id'
    );
    assert.equal(
        getAutoPokeMessageKey(makeRecord([], {
            chatType: 1,
            peerUid: 'u_other',
            msgId: '0'
        }), '10001'),
        '10001:message:1:u_other:seq:123'
    );
    assert.equal(getAutoPokeMessageKey(makeRecord([], { chatType: 4 }), '10001'), '');
});

test('wires auto-poke message triggers to the received-message path', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    assert.match(mainSource, /processAutoPokeMessageUpdates\(browserWindow, context\)/);
    assert.match(mainSource, /entertainment\.autoPokeBack !== true \|\| !triggers\.poked/);
    assert.match(mainSource, /getAutoPokeMessageDecision\(record,/);
    assert.match(mainSource, /decision\.selfMessage/);
    assert.match(mainSource, /trigger:\s*decision\.reasons\.join\(','\)/);
    assert.match(mainSource, /source:\s*'auto-message',[\s\S]*?enforceLimit:\s*false/);
    assert.match(mainSource, /trigger:\s*'poke',[\s\S]*?enforceLimit:\s*true/);
    assert.match(rendererSource, /text\('被 @ 时回戳'\)/);
    assert.match(rendererSource, /text\('被戳时回戳'\)/);
    assert.match(rendererSource, /text\('被回复时回戳'\)/);
    assert.match(rendererSource, /entertainment\.autoPokeBackTriggers\.excludeAtAll/);
});
