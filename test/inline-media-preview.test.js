'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    classifyMediaFilePath,
    createInlineMediaDownloadPayload,
    createInlineMediaDownloadRequest,
    extractInlineMediaGallery,
    extractInlineMediaPreview,
    isNativeMediaViewerUrl,
    mergeInlineMediaItems,
    normalizeInlineMediaOpenItem,
    resolveInlineReplyPreview
} = require('../src/inline-media-preview');

function makeCommand(mediaList, index = 0) {
    return {
        cmdName: 'openMediaViewer',
        payload: [{ mediaList, index }]
    };
}

function createTemporaryFile(t, name) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-toolbox-preview-'));
    const filePath = path.join(directory, name);
    fs.writeFileSync(filePath, 'media');
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return filePath;
}

test('extracts the selected local image from openMediaViewer', t => {
    const filePath = createTemporaryFile(t, 'preview image.png');
    const preview = extractInlineMediaPreview(makeCommand([
        { context: { sourcePath: path.join(path.dirname(filePath), 'other.png') } },
        {
            context: { sourcePath: filePath }
        }
    ], 1));

    assert.deepEqual(preview, {
        type: 'image',
        filePath,
        name: 'preview image.png',
        sourceIndex: 1,
        identity: {
            chatType: 0,
            peerUid: '',
            msgId: '',
            msgSeq: '',
            elementId: ''
        }
    });
});

test('extracts a local video from openMediaViewer', t => {
    const filePath = createTemporaryFile(t, 'preview.mp4');
    assert.deepEqual(extractInlineMediaPreview(makeCommand([{
        context: {
            sourcePath: 'C:\\video-cover.png',
            video: { path: filePath }
        },
        originPath: 'appimg://D:/cache/video-cover.png'
    }])), {
        type: 'video',
        filePath,
        previewFilePath: 'C:\\video-cover.png',
        name: 'preview.mp4',
        sourceIndex: 0,
        identity: {
            chatType: 0,
            peerUid: '',
            msgId: '',
            msgSeq: '',
            elementId: ''
        }
    });
});

test('keeps QQ media ordering and maps the selected item after invalid entries', t => {
    const firstPath = createTemporaryFile(t, 'first.png');
    const selectedPath = createTemporaryFile(t, 'selected.mp4');
    const gallery = extractInlineMediaGallery(makeCommand([
        { context: { sourcePath: firstPath } },
        { context: { sourcePath: 'relative.png' } },
        { context: { sourcePath: 'C:\\cover.png', video: { path: selectedPath } } }
    ], 2));

    assert.equal(gallery.index, 1);
    assert.deepEqual(gallery.items.map(item => [item.type, item.sourceIndex]), [
        ['image', 0],
        ['video', 2]
    ]);
});

test('accepts pending local files and rejects invalid media payloads', () => {
    assert.equal(extractInlineMediaPreview(makeCommand([{
        context: { sourcePath: 'C:\\pending-preview.png' }
    }]))?.filePath, 'C:\\pending-preview.png');
    assert.equal(extractInlineMediaPreview(makeCommand([{
        context: { sourcePath: 'relative-preview.png' }
    }])), null);
    assert.equal(extractInlineMediaPreview(makeCommand([{}])), null);
});

test('classifies image and video file messages without accepting normal files', () => {
    assert.equal(classifyMediaFilePath('preview.PNG'), 'image');
    assert.equal(classifyMediaFilePath('', 'D:\\media\\clip.MP4'), 'video');
    assert.equal(classifyMediaFilePath('archive.zip'), '');
    assert.equal(classifyMediaFilePath('document.pdf'), '');
});

test('recognizes native image, video, and media viewer windows', () => {
    assert.equal(isNativeMediaViewerUrl('file:///app/index.html#/image-viewer'), true);
    assert.equal(isNativeMediaViewerUrl('file:///app/index.html#/video-viewer'), true);
    assert.equal(isNativeMediaViewerUrl('file:///app/index.html#/media-viewer'), true);
    assert.equal(isNativeMediaViewerUrl('file:///app/index.html#/main/message'), false);
});

test('normalizes file-message media for direct inline viewing', () => {
    assert.deepEqual(normalizeInlineMediaOpenItem({
        filePath: 'D:\\cache\\pending.MP4',
        previewFilePath: 'D:\\cache\\pending-cover.jpg',
        name: 'clip.MP4',
        fingerprint: 'AABB',
        sourceIndex: 2,
        identity: {
            chatType: 2,
            peerUid: 'group-uid',
            msgId: 'message-id',
            msgSeq: '100',
            elementId: 'element-id'
        }
    }), {
        type: 'video',
        filePath: 'D:\\cache\\pending.MP4',
        previewFilePath: 'D:\\cache\\pending-cover.jpg',
        fingerprint: 'aabb',
        name: 'clip.MP4',
        sourceIndex: 2,
        identity: {
            chatType: 2,
            peerUid: 'group-uid',
            msgId: 'message-id',
            msgSeq: '100',
            elementId: 'element-id'
        }
    });
    assert.equal(normalizeInlineMediaOpenItem({ filePath: 'relative.mp4' }), null);
    assert.equal(normalizeInlineMediaOpenItem({ filePath: 'D:\\cache\\document.pdf' }), null);
});

test('builds a version-compatible native rich-media download request', () => {
    const item = {
        filePath: 'D:\\cache\\pending.webp',
        identity: {
            chatType: 2,
            peerUid: 'group-uid',
            msgId: 'message-id',
            elementId: 'element-id'
        }
    };
    const request = {
        fileModelId: '0',
        downSourceType: 0,
        triggerType: 1,
        msgId: 'message-id',
        chatType: 2,
        peerUid: 'group-uid',
        elementId: 'element-id',
        thumbSize: 0,
        downloadType: 1,
        filePath: 'D:\\cache\\pending.webp'
    };

    assert.deepEqual(createInlineMediaDownloadRequest(item), request);
    assert.deepEqual(createInlineMediaDownloadPayload(item), [{ getReq: request }, null]);
    assert.equal(createInlineMediaDownloadRequest({ identity: { msgId: 'incomplete' } }), null);
    assert.equal(createInlineMediaDownloadPayload({ identity: { msgId: 'incomplete' } }), null);
});

test('deduplicates one media item described by native viewer and message records', () => {
    const filePath = 'D:\\cache\\AABBCCDDEEFF00112233445566778899.webp';
    const merged = mergeInlineMediaItems([{
        type: 'image',
        filePath,
        name: 'remembered',
        identity: { msgId: 'message-1', elementId: 'element-1' },
        fingerprint: 'aabbccddeeff00112233445566778899'
    }], [{
        type: 'image',
        filePath,
        name: 'viewer',
        identity: { msgId: 'message-1', elementId: '' }
    }]);

    assert.equal(merged.length, 1);
    assert.equal(merged[0].name, 'viewer');
    assert.equal(merged[0].fingerprint, 'aabbccddeeff00112233445566778899');
});

test('keeps identical media sent in different messages as separate gallery items', () => {
    const filePath = 'D:\\cache\\AABBCCDDEEFF00112233445566778899.webp';
    const merged = mergeInlineMediaItems([{
        type: 'image',
        filePath,
        identity: { msgId: 'message-1', elementId: 'element-1' }
    }], [{
        type: 'image',
        filePath,
        identity: { msgId: 'message-2', elementId: 'element-2' }
    }]);

    assert.equal(merged.length, 2);
});

test('keeps identical media from different sequences under one parent record', () => {
    const merged = mergeInlineMediaItems([{
        type: 'image',
        filePath: 'D:\\cache\\AABBCCDDEEFF00112233445566778899.webp',
        identity: { msgId: 'parent-message', msgSeq: '100', elementId: 'element-1' }
    }], [{
        type: 'image',
        filePath: 'D:\\cache\\AABBCCDDEEFF00112233445566778899_720.webp',
        identity: { msgId: 'parent-message', msgSeq: '101', elementId: 'element-2' }
    }]);

    assert.equal(merged.length, 2);
});

test('resolves a reply thumbnail to the original media without adding a duplicate', () => {
    const original = {
        type: 'image',
        filePath: 'D:\\cache\\AABBCCDDEEFF00112233445566778899.webp',
        identity: { msgId: 'source-message', msgSeq: '100', elementId: 'source-element' }
    };
    const replyThumbnail = {
        type: 'image',
        filePath: 'D:\\cache\\AABBCCDDEEFF00112233445566778899_720.webp',
        identity: { msgId: 'reply-message', msgSeq: '101', elementId: 'reply-element' }
    };
    const replySources = new Map([
        ['id:reply-message', { msgId: 'source-message', msgSeq: '100' }]
    ]);

    const resolved = resolveInlineReplyPreview(replyThumbnail, [original], replySources);
    const merged = mergeInlineMediaItems([original], [resolved]);

    assert.equal(resolved, original);
    assert.equal(merged.length, 1);
});

test('does not collapse a genuinely repeated image that is not a reply preview', () => {
    const original = {
        type: 'image',
        filePath: 'D:\\cache\\AABBCCDDEEFF00112233445566778899.webp',
        identity: { msgId: 'message-1', msgSeq: '100', elementId: 'element-1' }
    };
    const repeated = {
        type: 'image',
        filePath: 'D:\\cache\\AABBCCDDEEFF00112233445566778899_720.webp',
        identity: { msgId: 'message-2', msgSeq: '101', elementId: 'element-2' }
    };

    const resolved = resolveInlineReplyPreview(repeated, [original], new Map());
    const merged = mergeInlineMediaItems([original], [resolved]);

    assert.equal(resolved, repeated);
    assert.equal(merged.length, 2);
});
