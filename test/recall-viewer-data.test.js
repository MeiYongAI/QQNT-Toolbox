'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { fileURLToPath } = require('node:url');

const { buildRecallViewerData } = require('../src/recall-viewer-data');

test('projects recalled text, archived images, and archived files into one viewer conversation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-recall-viewer-'));
    const imagePath = path.join(root, 'archived.png');
    const filePath = path.join(root, 'archived.zip');
    fs.writeFileSync(imagePath, Buffer.from('image'));
    fs.writeFileSync(filePath, Buffer.from('archive'));

    const chats = buildRecallViewerData([{
        msgId: 'message-1',
        chatType: 2,
        peerUid: '20001',
        peerUin: '20001',
        peerName: '测试群',
        senderUin: '30001',
        senderNick: '发送者',
        msgTime: 100,
        qqnt_toolbox_recall: { recallTime: 200, operatorNick: '管理员' },
        elements: [{
            elementId: 'text-1',
            textElement: { content: '撤回文本' }
        }, {
            elementId: 'image-1',
            picElement: { fileName: 'archived.png', filePath: imagePath }
        }, {
            elementId: 'file-1',
            fileElement: { fileName: 'archived.zip', fileSize: 7, filePath }
        }]
    }]);

    assert.equal(chats.length, 1);
    assert.equal(chats[0].peerName, '测试群');
    assert.deepEqual(chats[0].messages[0].parts.map(part => part.type), ['text', 'image', 'file']);
    assert.equal(fileURLToPath(chats[0].messages[0].parts[1].src), imagePath);
    assert.equal(fileURLToPath(chats[0].messages[0].parts[2].path), filePath);
    assert.equal(chats[0].messages[0].parts[2].elementIndex, 2);
    assert.doesNotThrow(() => structuredClone(chats));
});

test('uses an immediate CDN fallback instead of blocking viewer data on rkey lookup', () => {
    const chats = buildRecallViewerData([{
        msgId: 'message-2',
        chatType: 2,
        peerUid: '20002',
        msgTime: 100,
        qqnt_toolbox_recall: { recallTime: 200 },
        elements: [{
            picElement: {
                fileName: 'missing.jpg',
                originImageUrl: '/download?appid=1407&fileid=group-file&spec=0',
                md5HexStr: 'aabbccdd'
            }
        }]
    }]);

    assert.equal(
        chats[0].messages[0].parts[0].src,
        'https://gchat.qpic.cn/gchatpic_new/0/0-0-AABBCCDD/0'
    );
});

test('keeps voice, cards, notices, and unsupported elements visible beside new file records', () => {
    const chats = buildRecallViewerData([{
        msgId: 'message-3',
        chatType: 1,
        peerUid: '20003',
        qqnt_toolbox_recall: { recallTime: 300 },
        elements: [{ pttElement: { fileName: 'voice.amr', duration: 3 } },
            { arkElement: { bytesData: JSON.stringify({ prompt: '卡片标题' }) } },
            { grayTipElement: { content: '系统提示' } },
            { elementType: 99 }]
    }]);

    assert.deepEqual(
        chats[0].messages[0].parts.map(part => part.type),
        ['voice', 'card', 'notice', 'unsupported']
    );
});
