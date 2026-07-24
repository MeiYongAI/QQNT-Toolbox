'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    MAX_AUTO_REACTION_EMOJI_IDS,
    getAutoReactionDecision,
    getAutoReactionMessageKey,
    isAutoReactionRecordReady,
    isRecentAutoReactionRecord,
    normalizeAutoReactionConfig
} = require('../src/auto-reaction');
const { loadAutoReactionEmojiCatalog } = require('../src/reaction-catalog');

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

const identity = { selfUin: '10001', selfUid: 'u_self' };
const enabledConfig = {
    enabled: true,
    emojiIds: ['14'],
    mentionSelf: true,
    replySelf: true,
    excludeAtAll: true,
    selfMessages: false
};

test('normalizes auto-reaction settings and bounds selected emoji IDs', () => {
    const emojiIds = Array.from({ length: MAX_AUTO_REACTION_EMOJI_IDS + 5 }, (_, index) => String(index));
    const config = normalizeAutoReactionConfig({
        enabled: 1,
        emojiIds: ['14', '14', '../1', ...emojiIds],
        mentionSelf: false,
        replySelf: false,
        excludeAtAll: false,
        selfMessages: true
    });

    assert.equal(config.enabled, false);
    assert.equal(config.emojiIds.length, MAX_AUTO_REACTION_EMOJI_IDS);
    assert.deepEqual(config.emojiIds.slice(0, 3), ['14', '0', '1']);
    assert.equal(config.mentionSelf, false);
    assert.equal(config.replySelf, false);
    assert.equal(config.excludeAtAll, false);
    assert.equal(config.selfMessages, true);
});

test('matches mentions and replies to the current account by UIN or UID', () => {
    const mention = getAutoReactionDecision(makeRecord([{
        textElement: { atType: 2, atUid: '10001' }
    }]), identity, enabledConfig);
    assert.equal(mention.matched, true);
    assert.deepEqual(mention.reasons, ['mention-self']);

    const mentionUid = getAutoReactionDecision(makeRecord([{
        textElement: { atType: 2, atNtUid: 'u_self' }
    }]), identity, enabledConfig);
    assert.equal(mentionUid.matched, true);

    const reply = getAutoReactionDecision(makeRecord([{
        replyElement: { senderUin: '10001', senderUidStr: 'u_self' }
    }]), identity, enabledConfig);
    assert.equal(reply.matched, true);
    assert.deepEqual(reply.reasons, ['reply-self']);
});

test('uses OR matching while the at-all exclusion takes priority', () => {
    const decision = getAutoReactionDecision(makeRecord([
        { textElement: { atType: 2, atNtUid: 'u_self' } },
        { replyElement: { senderUin: '10001' } }
    ]), identity, enabledConfig);
    assert.deepEqual(decision.reasons, ['mention-self', 'reply-self']);

    const excluded = getAutoReactionDecision(makeRecord([
        { textElement: { atType: 1 } },
        { textElement: { atType: 2, atNtUid: 'u_self' } }
    ], { sendType: 1 }), identity, {
        ...enabledConfig,
        selfMessages: true
    });
    assert.equal(excluded.matched, false);
    assert.equal(excluded.excluded, true);
    assert.equal(excluded.selfMessage, true);
});

test('matches every self-sent message only when that condition is enabled', () => {
    const record = makeRecord([], {
        sendType: 1,
        senderUin: '10001',
        senderUid: 'u_self'
    });
    assert.equal(getAutoReactionDecision(record, identity, enabledConfig).matched, false);
    const enabled = getAutoReactionDecision(record, identity, {
        ...enabledConfig,
        selfMessages: true
    });
    assert.equal(enabled.matched, true);
    assert.deepEqual(enabled.reasons, ['self-message']);
});

test('builds stable group-message keys and rejects unsupported records', () => {
    assert.equal(
        getAutoReactionMessageKey(makeRecord(), '10001'),
        '10001:2:998877:message-id'
    );
    assert.equal(
        getAutoReactionMessageKey(makeRecord([], { msgId: '0' }), '10001'),
        '10001:2:998877:seq:123'
    );
    assert.equal(getAutoReactionMessageKey(makeRecord([], { chatType: 1 }), '10001'), '');
    assert.equal(getAutoReactionMessageKey(makeRecord([], { msgId: '', msgSeq: '' }), '10001'), '');
});

test('filters old records', () => {
    const now = Date.now();
    assert.equal(isRecentAutoReactionRecord(makeRecord([], { msgTime: now }), now), true);
    assert.equal(isRecentAutoReactionRecord(makeRecord([], { msgTime: now / 1000 - 120 }), now), false);
});

test('waits for a finalized send event before reacting to own messages', () => {
    const ownDecision = { selfMessage: true };
    assert.equal(isAutoReactionRecordReady(
        makeRecord([], { sendStatus: 2 }),
        ownDecision,
        { sendComplete: true }
    ), true);
    assert.equal(isAutoReactionRecordReady(
        makeRecord([], { sendStatus: 2 }),
        ownDecision,
        { received: true }
    ), false);
    assert.equal(isAutoReactionRecordReady(
        makeRecord([], { sendStatus: 1 }),
        ownDecision,
        { sendComplete: true }
    ), false);
});

test('only reacts to other users from a receive event', () => {
    const otherDecision = { selfMessage: false };
    assert.equal(isAutoReactionRecordReady(
        makeRecord(),
        otherDecision,
        { received: true }
    ), true);
    assert.equal(isAutoReactionRecordReady(
        makeRecord([], { sendStatus: 2 }),
        otherDecision,
        { sendComplete: true }
    ), false);
});

test('loads classic QQ faces and available Unicode reactions on demand', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-toolbox-auto-reaction-'));
    const defaultDirectory = path.join(root, 'default-emojis');
    const emojiDirectory = path.join(
        root,
        'Tencent Files',
        'nt_qq',
        'global',
        'nt_data',
        'Emoji',
        'emoji-resource'
    );
    fs.mkdirSync(defaultDirectory, { recursive: true });
    fs.mkdirSync(path.join(emojiDirectory, 'emoji_res'), { recursive: true });
    fs.writeFileSync(path.join(defaultDirectory, 'default_config.json'), JSON.stringify({
        normalPanelResult: {
            SysEmojiGroupList: [{
                groupName: '小黄脸表情',
                SysEmojiList: [
                    { emojiId: '14', describe: '/微笑', emojiType: 0 },
                    { emojiId: '😊', describe: '/嘿嘿', emojiType: 4, qcid: 128522 }
                ]
            }]
        }
    }));
    fs.writeFileSync(path.join(defaultDirectory, '14.png'), Buffer.from([1, 2, 3]));
    fs.writeFileSync(path.join(emojiDirectory, 'face_config.json'), JSON.stringify({
        emoji: [
            { QCid: '128522', AQLid: '0', QDes: '/嘿嘿' },
            { QCid: '128521', AQLid: '9', QDes: '/媚眼', QHide: '1' },
            { QCid: '128078', AQLid: '26', QDes: '/鄙视', QHide: '1' }
        ]
    }));
    fs.writeFileSync(
        path.join(emojiDirectory, 'emoji_res', 'emoji_000.png'),
        Buffer.from([4, 5, 6])
    );
    fs.writeFileSync(
        path.join(emojiDirectory, 'emoji_res', 'emoji_009.png'),
        Buffer.from([7, 8, 9])
    );
    fs.writeFileSync(
        path.join(emojiDirectory, 'emoji_res', 'emoji_026.png'),
        Buffer.from([10, 11, 12])
    );

    try {
        const catalog = loadAutoReactionEmojiCatalog({
            defaultEmojiDirectories: [defaultDirectory],
            tencentFilesRoots: [path.join(root, 'Tencent Files')]
        });
        assert.deepEqual(catalog.map(item => [item.id, item.category, item.label]), [
            ['14', 'qq', '微笑'],
            ['128522', 'unicode', '嘿嘿'],
            ['128078', 'unicode', '鄙视']
        ]);
        assert.ok(catalog.every(item => item.src.startsWith('data:image/png;base64,')));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('wires the independent feature to settings and both real-time message events', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    assert.match(mainSource, /nodeIKernelMsgListener\/onRecvMsg/);
    assert.match(mainSource, /nodeIKernelMsgListener\/onMsgInfoListUpdate/);
    assert.match(mainSource, /processAutoReactionUpdates\(browserWindow, context\)/);
    assert.match(mainSource, /isAutoReactionRecordReady\(record, decision, events\)/);
    assert.match(mainSource, /for \(const emojiId of config\.emojiIds\)[\s\S]*?setMessageReaction\(browserWindow,[\s\S]*?source: 'auto'/);
    assert.match(rendererSource, /entertainment\.autoReaction\.enabled/);
    assert.match(rendererSource, /entertainment\.autoReaction\.mentionSelf/);
    assert.match(rendererSource, /entertainment\.autoReaction\.replySelf/);
    assert.match(rendererSource, /entertainment\.autoReaction\.excludeAtAll/);
    assert.match(rendererSource, /entertainment\.autoReaction\.selfMessages/);
    assert.match(rendererSource, /getAutoReactionEmojiCatalog/);
});

test('normalizes selectable editor entries and keeps category metadata', async () => {
    const editorSource = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'auto-reaction-editor.js'),
        'utf8'
    );
    const module = await import(`data:text/javascript;base64,${Buffer.from(editorSource).toString('base64')}`);
    assert.deepEqual(module.normalizeAutoReactionCatalog([
        { id: '14', label: '微笑', category: 'qq', src: 'data:image/png;base64,AQ==' },
        { id: '128522', label: '嘿嘿', category: 'unicode', src: 'data:image/png;base64,Ag==' },
        { id: '14', label: '重复', category: 'qq', src: 'data:image/png;base64,Aw==' },
        { id: '../1', label: '无效', src: 'file:///invalid.png' }
    ]), [
        { id: '14', label: '微笑', category: 'qq', src: 'data:image/png;base64,AQ==' },
        { id: '128522', label: '嘿嘿', category: 'unicode', src: 'data:image/png;base64,Ag==' }
    ]);
});
