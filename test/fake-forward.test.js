'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    FAKE_FORWARD_SEND_COMMAND,
    FAKE_FORWARD_UPLOAD_COMMAND,
    MAX_FAKE_FORWARD_IMAGES_PER_MESSAGE,
    MAX_FAKE_FORWARD_MESSAGES,
    buildFakeForwardFileUploadParams,
    buildFakeForwardImageUploadParams,
    buildFakeForwardVideoUploadParams,
    buildFakeForwardSendRequest,
    buildFakeForwardUploadRequest,
    createFakeForwardImageMsgInfo,
    createFakeForwardVideoMsgInfo,
    decodeFakeForwardGroupFileElement,
    decodeFakeForwardImageMsgInfo,
    decodeFakeForwardPrivateFileContent,
    decodeFakeForwardSendRequest,
    decodeFakeForwardUploadRequest,
    normalizeFakeForwardMessages,
    parseFakeForwardSendResponse,
    parseFakeForwardUploadResponse
} = require('../src/fake-forward');

function composerText(value) {
    return { nodeType: 3, nodeValue: value };
}

function composerElement(tagName, childNodes = [], options = {}) {
    return {
        nodeType: 1,
        tagName,
        childNodes,
        dataset: options.dataset || {},
        classList: {
            contains: className => (options.classNames || []).includes(className)
        }
    };
}

test('builds the QQ native image upload parameters without an unsupported transfer id', () => {
    assert.deepEqual(buildFakeForwardImageUploadParams({
        chatType: 2,
        peerUid: '998877'
    }, 'D:\\Pictures\\sample.png'), {
        filePath: 'D:\\Pictures\\sample.png',
        bizType: 4,
        peerUid: '998877',
        useNTV2: true
    });
    assert.deepEqual(buildFakeForwardImageUploadParams({
        chatType: 1,
        peerUid: 'u_private_peer'
    }, 'D:\\Pictures\\sample.png'), {
        filePath: 'D:\\Pictures\\sample.png',
        bizType: 3,
        peerUid: 'u_private_peer',
        useNTV2: true
    });
});

test('builds native video and file upload parameters for each chat type', () => {
    assert.deepEqual(buildFakeForwardVideoUploadParams({
        chatType: 2,
        peerUid: '998877'
    }, 'D:\\Videos\\sample.mp4'), {
        filePath: 'D:\\Videos\\sample.mp4',
        bizType: 7,
        peerUid: '998877',
        useNTV2: true
    });
    assert.deepEqual(buildFakeForwardVideoUploadParams({
        chatType: 1,
        peerUid: 'u_private_peer'
    }, 'D:\\Videos\\sample.mp4'), {
        filePath: 'D:\\Videos\\sample.mp4',
        bizType: 6,
        peerUid: 'u_private_peer',
        useNTV2: true
    });
    assert.deepEqual(buildFakeForwardFileUploadParams({
        chatType: 2,
        peerUid: '998877',
        guildId: ''
    }, 'D:\\Files\\archive.zip', 'archive.zip', '123456'), {
        peer: { chatType: 2, peerUid: '998877', guildId: '' },
        files: [{
            fileName: 'archive.zip',
            filePath: 'D:\\Files\\archive.zip',
            fileModelId: '123456'
        }]
    });
});

test('normalizes fake forward entries without changing multiline text', () => {
    const [message] = normalizeFakeForwardMessages([{
        senderUin: '12345678',
        senderName: 'Alice',
        content: 'first line\nsecond line',
        timestamp: 1784630000000
    }]);
    assert.deepEqual(message, {
        senderUin: '12345678',
        senderName: 'Alice',
        content: 'first line\nsecond line',
        images: [],
        segments: [{ type: 'text', text: 'first line\nsecond line' }],
        timestamp: 1784630000
    });
});

test('reads native contenteditable block lines without joining the first two lines', async () => {
    const editorSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'fake-forward-editor.js'), 'utf8');
    const editor = await import(`data:text/javascript;base64,${Buffer.from(editorSource).toString('base64')}`);
    const root = composerElement('DIV', [
        composerText('今'),
        composerElement('DIV', [composerText('天')]),
        composerElement('DIV', [composerText('我')]),
        composerElement('DIV', [composerText('是')]),
        composerElement('DIV', [composerText('妈')]),
        composerElement('DIV', [composerText('妈')])
    ]);

    assert.deepEqual(editor.readFakeForwardComposerSegments(root), [{
        type: 'text',
        text: '今\n天\n我\n是\n妈\n妈'
    }]);
});

test('drops only the browser placeholder break after a compound image', async () => {
    const editorSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'fake-forward-editor.js'), 'utf8');
    const editor = await import(`data:text/javascript;base64,${Buffer.from(editorSource).toString('base64')}`);
    const root = composerElement('DIV', [
        composerText('我喜欢这个'),
        composerElement('SPAN', [], {
            classNames: ['qff-composer-image'],
            dataset: { path: 'D:\\Pictures\\sample.png', name: 'sample.png', pending: 'false' }
        }),
        composerElement('DIV', [composerElement('BR')])
    ]);

    assert.deepEqual(editor.readFakeForwardComposerSegments(root), [
        { type: 'text', text: '我喜欢这个' },
        { type: 'image', path: 'D:\\Pictures\\sample.png', name: 'sample.png', pending: false }
    ]);
});

test('reads a standalone video card without keeping the contenteditable placeholder', async () => {
    const editorSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'fake-forward-editor.js'), 'utf8');
    const editor = await import(`data:text/javascript;base64,${Buffer.from(editorSource).toString('base64')}`);
    const root = composerElement('DIV', [
        composerElement('SPAN', [], {
            classNames: ['qff-composer-attachment'],
            dataset: {
                type: 'video',
                path: 'D:\\Videos\\sample.mp4',
                name: 'sample.mp4',
                size: '1024',
                pending: 'false'
            }
        }),
        composerElement('DIV', [composerElement('BR')])
    ]);

    assert.deepEqual(editor.readFakeForwardComposerSegments(root), [{
        type: 'video',
        path: 'D:\\Videos\\sample.mp4',
        name: 'sample.mp4',
        size: 1024,
        pending: false
    }]);
});

test('rejects invalid senders, empty content, unsupported peers, and oversized lists', async () => {
    assert.throws(() => normalizeFakeForwardMessages([{ senderUin: 'abc', content: 'x' }]), /QQ/);
    assert.throws(() => normalizeFakeForwardMessages([{ senderUin: '12345', content: ' ' }]), /内容/);
    await assert.rejects(() => buildFakeForwardUploadRequest({
        peer: { chatType: 99, peerUid: 'temporary' },
        messages: [{ senderUin: '12345', content: 'x' }]
    }), /不支持/);
    assert.throws(() => normalizeFakeForwardMessages(Array.from(
        { length: MAX_FAKE_FORWARD_MESSAGES + 1 },
        () => ({ senderUin: '12345', content: 'x' })
    )), /最多/);
    assert.throws(() => normalizeFakeForwardMessages([{
        senderUin: '12345',
        images: Array.from({ length: MAX_FAKE_FORWARD_IMAGES_PER_MESSAGE + 1 }, () => ({ msgInfo: {} }))
    }]), /图片/);
    assert.throws(() => normalizeFakeForwardMessages([{
        senderUin: '12345',
        segments: [
            { type: 'text', text: 'caption' },
            { type: 'video', name: 'sample.mp4', msgInfo: {} }
        ]
    }]), /单独发送/);
    assert.throws(() => normalizeFakeForwardMessages([{
        senderUin: '12345',
        segments: [
            {
                type: 'file',
                name: 'one.zip',
                fileId: '/one',
                fileSize: 1,
                md5: '0123456789abcdef0123456789abcdef'
            },
            {
                type: 'file',
                name: 'two.zip',
                fileId: '/two',
                fileSize: 1,
                md5: '0123456789abcdef0123456789abcdef'
            }
        ]
    }]), /单独发送/);
});

test('encodes fake text nodes into QQ long-message upload protobuf', async () => {
    const built = await buildFakeForwardUploadRequest({
        peer: { chatType: 2, peerUid: '998877', guildId: '' },
        messages: [{
            senderUin: '12345678',
            senderName: 'Display Name',
            content: 'hello',
            timestamp: 1784630000000
        }]
    }, {
        sequenceStart: 1000
    });
    const decoded = await decodeFakeForwardUploadRequest(built.packet);
    const [record] = decoded.transmit.pbItemList[0].buffer.msg;
    assert.equal(built.command, FAKE_FORWARD_UPLOAD_COMMAND);
    assert.equal(decoded.request.info.type, 3);
    assert.equal(decoded.request.info.peer.uid, '998877');
    assert.equal(decoded.request.info.groupCode, 998877);
    assert.equal(record.responseHead.fromUin, 12345678);
    assert.equal(record.responseHead.grp.memberName, 'Display Name');
    assert.equal(record.responseHead.grp.unknown5, 2);
    assert.equal(record.contentHead.timeStamp, 1784630000);
    assert.equal(record.contentHead.sequence, 1000);
    assert.equal(record.contentHead.forward.field3, 1);
    assert.match(record.contentHead.forward.avatar, /dst_uin=12345678/);
    assert.equal(record.body.richText.elems[0].text.str, 'hello');
});

test('encodes image-only and text-plus-image nodes as native service-48 elements', async () => {
    const peer = { chatType: 2, peerUid: '998877', guildId: '' };
    const image = createFakeForwardImageMsgInfo({
        peer,
        fileUuid: '/11111111-2222-3333-4444-555555555555',
        fileSize: 123456,
        width: 800,
        height: 600,
        extension: 'png',
        fileName: 'sample.png',
        md5: '0123456789abcdef0123456789abcdef',
        sha1: '0123456789abcdef0123456789abcdef01234567'
    });
    const built = await buildFakeForwardUploadRequest({
        peer,
        messages: [{
            senderUin: '12345678',
            senderName: 'Alice',
            content: '',
            images: [{ name: 'sample.png', msgInfo: image }]
        }, {
            senderUin: '87654321',
            senderName: 'Bob',
            content: 'caption',
            images: [
                { name: 'one.png', msgInfo: image },
                { name: 'two.png', msgInfo: image }
            ]
        }]
    }, { sequenceStart: 2000 });
    const decoded = await decodeFakeForwardUploadRequest(built.packet);
    const [imageOnly, mixed] = decoded.transmit.pbItemList[0].buffer.msg;
    assert.equal(imageOnly.body.richText.elems.length, 1);
    assert.equal(imageOnly.body.richText.elems[0].commonElem.serviceType, 48);
    assert.equal(imageOnly.body.richText.elems[0].commonElem.businessType, 20);
    assert.equal(mixed.body.richText.elems[0].text.str, 'caption');
    assert.equal(mixed.body.richText.elems[1].commonElem.businessType, 20);
    assert.equal(mixed.body.richText.elems[2].commonElem.businessType, 20);
    assert.equal(built.news[0].text, 'Alice: [图片]');

    const decodedImage = await decodeFakeForwardImageMsgInfo(
        imageOnly.body.richText.elems[0].commonElem.pbElem
    );
    assert.equal(decodedImage.msgInfoBody[0].index.fileUuid, '/11111111-2222-3333-4444-555555555555');
    assert.equal(decodedImage.msgInfoBody[0].index.info.width, 800);
    assert.equal(decodedImage.msgInfoBody[0].index.info.height, 600);
    assert.equal(decodedImage.msgInfoBody[0].pic.domain, 'multimedia.nt.qq.com.cn');
    assert.equal(decodedImage.msgInfoBody[0].hashSum.troopSource.groupCode, 998877);
    assert.equal(decodedImage.extBizInfo.pic.summary, '[图片]');
});

test('preserves text and image segment order in compound messages', async () => {
    const peer = { chatType: 2, peerUid: '998877', guildId: '' };
    const image = createFakeForwardImageMsgInfo({
        peer,
        fileUuid: '/11111111-2222-3333-4444-555555555555',
        fileSize: 123456,
        width: 800,
        height: 600,
        extension: 'png',
        fileName: 'sample.png',
        md5: '0123456789abcdef0123456789abcdef',
        sha1: '0123456789abcdef0123456789abcdef01234567'
    });
    const built = await buildFakeForwardUploadRequest({
        peer,
        messages: [{
            senderUin: '12345678',
            senderName: 'Alice',
            segments: [
                { type: 'text', text: 'before' },
                { type: 'image', name: 'one.png', msgInfo: image },
                { type: 'text', text: 'between' },
                { type: 'image', name: 'two.png', msgInfo: image },
                { type: 'text', text: 'after' }
            ]
        }]
    }, { sequenceStart: 3000 });
    const decoded = await decodeFakeForwardUploadRequest(built.packet);
    const elems = decoded.transmit.pbItemList[0].buffer.msg[0].body.richText.elems;
    assert.equal(elems.length, 5);
    assert.equal(elems[0].text.str, 'before');
    assert.equal(elems[1].commonElem.businessType, 20);
    assert.equal(elems[2].text.str, 'between');
    assert.equal(elems[3].commonElem.businessType, 20);
    assert.equal(elems[4].text.str, 'after');
    assert.equal(built.news[0].text, 'Alice: before[图片]between[图片]after');
});

test('uses the private image business type and peer UID metadata', async () => {
    const peer = { chatType: 1, peerUid: 'u_private_peer', peerUin: '87654321' };
    const image = createFakeForwardImageMsgInfo({
        peer,
        fileUuid: '/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        fileSize: 42,
        width: 10,
        height: 20,
        extension: 'gif',
        md5: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        sha1: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    });
    const built = await buildFakeForwardUploadRequest({
        peer,
        messages: [{
            senderUin: '12345678',
            content: '',
            images: [{ msgInfo: image }]
        }]
    }, { selfUid: 'u_self', sequenceStart: 1 });
    const decoded = await decodeFakeForwardUploadRequest(built.packet);
    const common = decoded.transmit.pbItemList[0].buffer.msg[0].body.richText.elems[0].commonElem;
    const decodedImage = await decodeFakeForwardImageMsgInfo(common.pbElem);
    assert.equal(common.businessType, 10);
    assert.equal(decodedImage.msgInfoBody[0].index.info.fileType.picFormat, 2000);
    assert.equal(decodedImage.msgInfoBody[0].hashSum.bytesPbReserveC2c.friendUid, 'u_private_peer');
    assert.match(decodedImage.msgInfoBody[0].pic.urlPath, /appid=1406/);
});

test('encodes a standalone video as the native service-48 video element', async () => {
    const peer = { chatType: 2, peerUid: '998877', guildId: '' };
    const thumbMsgInfo = createFakeForwardImageMsgInfo({
        peer,
        fileUuid: '/thumb-1111-2222-3333-444444444444',
        fileSize: 4096,
        width: 640,
        height: 360,
        extension: 'jpg',
        md5: '11111111111111111111111111111111',
        sha1: '2222222222222222222222222222222222222222'
    });
    const videoMsgInfo = createFakeForwardVideoMsgInfo({
        peer,
        fileUuid: '/video-1111-2222-3333-444444444444',
        fileSize: 1234567,
        width: 1920,
        height: 1080,
        duration: 42.9,
        extension: 'mp4',
        md5: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        sha1: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        thumbMsgInfo
    });
    const built = await buildFakeForwardUploadRequest({
        peer,
        messages: [{
            senderUin: '12345678',
            senderName: 'Alice',
            segments: [{ type: 'video', name: 'sample.mp4', msgInfo: videoMsgInfo }]
        }]
    }, { sequenceStart: 4000 });
    const decoded = await decodeFakeForwardUploadRequest(built.packet);
    const common = decoded.transmit.pbItemList[0].buffer.msg[0].body.richText.elems[0].commonElem;
    assert.equal(common.businessType, 21);
    const video = await decodeFakeForwardImageMsgInfo(common.pbElem);
    assert.equal(video.msgInfoBody.length, 2);
    assert.equal(video.msgInfoBody[0].index.info.fileType.type, 2);
    assert.equal(video.msgInfoBody[0].index.info.time, 42);
    assert.equal(video.msgInfoBody[0].index.fileUuid, '/video-1111-2222-3333-444444444444');
    assert.equal(video.msgInfoBody[1].index.fileUuid, '/thumb-1111-2222-3333-444444444444');
    assert.deepEqual(Buffer.from(video.extBizInfo.video.pbReserve), Buffer.from([0x80, 0x01, 0x00]));
    assert.equal(built.news[0].text, 'Alice: [视频]');
});

test('encodes group and private files using their native long-message fields', async () => {
    const file = {
        type: 'file',
        name: 'archive.zip',
        fileId: '/file-1111-2222-3333-444444444444',
        fileSize: 987654,
        md5: '0123456789abcdef0123456789abcdef',
        md510m: 'fedcba9876543210fedcba9876543210',
        fileHash: 'file-crc'
    };
    const groupBuilt = await buildFakeForwardUploadRequest({
        peer: { chatType: 2, peerUid: '998877', guildId: '' },
        messages: [{ senderUin: '12345678', senderName: 'Alice', segments: [file] }]
    }, { sequenceStart: 5000 });
    const groupDecoded = await decodeFakeForwardUploadRequest(groupBuilt.packet);
    const trans = groupDecoded.transmit.pbItemList[0].buffer.msg[0].body.richText.elems[0].transElemInfo;
    assert.equal(trans.elemType, 24);
    const groupFile = await decodeFakeForwardGroupFileElement(trans.elemValue);
    assert.equal(groupFile.inner.info.busId, 102);
    assert.equal(groupFile.inner.info.fileId, file.fileId);
    assert.equal(String(groupFile.inner.info.fileSize), String(file.fileSize));
    assert.deepEqual(Buffer.from(groupFile.inner.info.fileMd5), Buffer.from(file.md5, 'hex'));
    assert.equal(groupBuilt.news[0].text, 'Alice: [文件] archive.zip');

    const privateBuilt = await buildFakeForwardUploadRequest({
        peer: { chatType: 1, peerUid: 'u_private_peer', peerUin: '87654321' },
        messages: [{ senderUin: '12345678', senderName: 'Alice', segments: [file] }]
    }, { selfUid: 'u_self', sequenceStart: 5001 });
    const privateDecoded = await decodeFakeForwardUploadRequest(privateBuilt.packet);
    const privateRecord = privateDecoded.transmit.pbItemList[0].buffer.msg[0];
    assert.equal(privateRecord.body.richText.elems.length, 0);
    const privateFile = await decodeFakeForwardPrivateFileContent(privateRecord.body.msgContent);
    assert.equal(privateFile.file.fileUuid, file.fileId);
    assert.equal(privateFile.file.fileName, file.name);
    assert.deepEqual(Buffer.from(privateFile.file.fileMd5), Buffer.from(file.md510m, 'hex'));
    assert.equal(privateFile.file.fileIdCrcMedia, file.fileHash);
});

test('parses the resource id and builds the desktop service-35 send packet', async () => {
    const response = Buffer.concat([
        Buffer.from([0x12, 0x09, 0x1a, 0x07]),
        Buffer.from('res-123')
    ]);
    const bufferResId = await parseFakeForwardUploadResponse({ result: 0, rspbuffer: response });
    const binaryResId = await parseFakeForwardUploadResponse({ result: 0, rsp: response.toString('latin1') });
    const base64ResId = await parseFakeForwardUploadResponse({ result: 0, rsp: response.toString('base64') });
    assert.equal(bufferResId, 'res-123');
    assert.equal(binaryResId, 'res-123');
    assert.equal(base64ResId, 'res-123');
    const built = await buildFakeForwardSendRequest({
        peer: { chatType: 2, peerUid: '998877' },
        count: 2,
        source: '群聊的聊天记录',
        summary: '查看2条转发消息',
        news: [{ text: 'Alice: hello' }]
    }, bufferResId, { msgSeq: 123, msgRand: 456 });
    const decoded = await decodeFakeForwardSendRequest(built.packet);
    const richMsg = decoded.msgBody.richText.elems[0].richMsg;
    assert.equal(built.command, FAKE_FORWARD_SEND_COMMAND);
    assert.equal(String(decoded.routingHead.grp.groupCode), '998877');
    assert.equal(decoded.msgSeq, 123);
    assert.equal(decoded.msgRand, 456);
    assert.equal(richMsg.serviceId, 35);
    assert.equal(Buffer.from(richMsg.msgResId).toString(), 'res-123');
    const xml = Buffer.from(richMsg.template1).toString();
    assert.match(xml, /serviceID="35"/);
    assert.match(xml, /action="viewMultiMsg"/);
    assert.match(xml, /m_resid="res-123"/);
    assert.match(xml, /Alice: hello/);
    assert.deepEqual(await parseFakeForwardSendResponse({
        rspbuffer: Buffer.from([0x08, 0x00])
    }), { result: 0, errMsg: '' });
});

test('wires the editor through local IPC without the retired third-party builder', () => {
    const root = path.join(__dirname, '..');
    const mainSource = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
    const rendererSource = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
    const editorSource = fs.readFileSync(path.join(root, 'src', 'fake-forward-editor.js'), 'utf8');
    const editorStyle = fs.readFileSync(path.join(root, 'src', 'fake-forward-editor.css'), 'utf8');

    assert.match(mainSource, /sendFakeForwardFromRenderer/);
    assert.match(mainSource, /getRichMediaService\?\.\(\)/);
    assert.match(mainSource, /createFakeForwardImageUploadWaiters/);
    assert.match(mainSource, /onlyUploadFile\(request\.peer, request\.files\)/);
    assert.match(mainSource, /uploadFakeForwardVideo/);
    assert.match(mainSource, /prepareFakeForwardMedia/);
    assert.match(mainSource, /getUserDetailInfoByUin\(senderUin\)/);
    assert.match(mainSource, /CHANNEL_RESOLVE_FAKE_FORWARD_SENDER_NAME/);
    assert.match(mainSource, /BrowserWindow\.getAllWindows\(\)/);
    assert.match(mainSource, /CHANNEL_STAGE_FAKE_FORWARD_IMAGE/);
    assert.match(mainSource, /sendSsoThroughWrapperSession\(request\.command, request\.packet\)/);
    assert.match(mainSource, /buildFakeForwardSendRequest\(upload, resId/);
    assert.match(mainSource, /parseFakeForwardSendResponse/);
    assert.doesNotMatch(mainSource, /repeatBySendMsg\(browserWindow, upload\.peer/);
    assert.match(rendererSource, /fakeForward\.enabled/);
    assert.match(rendererSource, /createFakeForwardEditor/);
    assert.match(editorSource, /qqnt-toolbox-fake-forward-draft/);
    assert.match(editorSource, /normalizeDraftSegments/);
    assert.match(editorSource, /createButton\('qff-list-action', '上移'\)/);
    assert.match(editorSource, /createButton\('qff-list-action', '下移'\)/);
    assert.match(editorSource, /createButton\('qff-list-action qff-list-delete', '删除'\)/);
    assert.doesNotMatch(editorSource, /qff-message-drag/);
    assert.match(editorSource, /let senderName = state\.fields\.senderName\.value\.trim\(\);/);
    assert.match(editorSource, /await options\.resolveSenderName\?\.\(senderUin\)/);
    assert.match(editorSource, /contentEditable\s*=\s*['"]true['"]/);
    assert.doesNotMatch(editorSource, /composer\.addEventListener\(['"]beforeinput['"]/);
    assert.match(editorSource, /addEventListener\(['"]paste['"]/);
    assert.match(editorSource, /addEventListener\(['"]drop['"]/);
    assert.match(editorSource, /VIDEO_FILE_PATTERN/);
    assert.match(editorSource, /视频或文件必须单独作为一条消息/);
    assert.match(editorSource, /template\.cloneNode\(true\)/);
    assert.match(editorSource, /applyEntryGlyph\(glyph\)/);
    assert.match(editorSource, /entries\.find\(element => element\.querySelector\(['"]svg['"]\)\)/);
    assert.match(editorSource, /setAttribute\(['"]role['"], ['"]button['"]\)/);
    assert.match(editorSource, /\.icon-item\[aria-label\], \[aria-label\], \[data-title\]/);
    assert.match(editorSource, /labelTarget\.setAttribute\(['"]aria-label['"], ['"]伪造转发['"]\)/);
    assert.match(editorSource, /q-tooltips-v2 q-tooltips-v2--pos-bottom q-tooltips-v2--small q-float-card/);
    assert.match(editorSource, /tooltip\.style\.top\s*=\s*\(-tooltipRect\.height - 4\)/);
    assert.doesNotMatch(editorSource, /qff-entry-native-tooltip|qff-entry-tooltip|showEntryTooltip|entryTooltip/);
    assert.doesNotMatch(editorSource, /添加图片|selectImages/);
    assert.doesNotMatch(editorSource, /createButton\(['"]qff-entry-button/);
    assert.doesNotMatch(editorSource, /entry\.title\s*=/);
    assert.match(editorSource, /disconnectObserver\(\)/);
    assert.match(editorSource, /fields\.commit\.type\s*=\s*['"]submit['"]/);
    assert.match(editorStyle, /--qff-bg:\s*var\(--bg_top_light/);
    assert.match(editorStyle, /--qff-text:\s*var\(--text-primary/);
    assert.match(editorStyle, /grid-template-columns:\s*minmax\(0, 1fr\) auto/);
    assert.doesNotMatch(editorStyle, /\.qqnt-toolbox-fake-forward-entry\s*\{|\.qqnt-toolbox-fake-forward-entry:(?:hover|active)\s*\{/);
    assert.doesNotMatch(editorStyle, /\.qff-entry-native-tooltip\s*\{/);
    assert.doesNotMatch(editorStyle, /tooltip_background|tooltip_text/);
    assert.match(editorSource, /state\.status\.title\s*=\s*message/);
    assert.doesNotMatch(mainSource + rendererSource + editorSource, /api\..*\/api\/wzlt|multiForwardMsg\(built\.records/);
});
