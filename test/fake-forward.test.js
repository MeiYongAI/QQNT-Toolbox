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
    buildFakeForwardImageUploadParams,
    buildFakeForwardSendRequest,
    buildFakeForwardUploadRequest,
    createFakeForwardImageMsgInfo,
    decodeFakeForwardImageMsgInfo,
    decodeFakeForwardSendRequest,
    decodeFakeForwardUploadRequest,
    normalizeFakeForwardMessages,
    parseFakeForwardSendResponse,
    parseFakeForwardUploadResponse
} = require('../src/fake-forward');

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
    assert.match(editorSource, /contentEditable\s*=\s*['"]true['"]/);
    assert.match(editorSource, /addEventListener\(['"]paste['"]/);
    assert.match(editorSource, /addEventListener\(['"]drop['"]/);
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
