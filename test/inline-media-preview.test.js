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
    normalizeInlineMediaSourceUrl,
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
        previewSource: 'appimg://D:/cache/video-cover.png',
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

test('keeps a renderer-readable image source when the original file is not local', () => {
    assert.deepEqual(extractInlineMediaPreview(makeCommand([{
        context: {
            sourcePath: 'appimg://chat/pending-image.webp',
            chatType: 2,
            peerUid: 'group-uid',
            msgId: 'message-id',
            elementId: 'image-element'
        }
    }])), {
        type: 'image',
        sourceUrl: 'appimg://chat/pending-image.webp',
        name: 'image.png',
        sourceIndex: 0,
        identity: {
            chatType: 2,
            peerUid: 'group-uid',
            msgId: 'message-id',
            msgSeq: '',
            elementId: 'image-element'
        }
    });
});

test('keeps the rendered image URL beside a pending original path', () => {
    const item = extractInlineMediaPreview(makeCommand([{
        context: {
            sourcePath: 'C:\\pending\\original.webp',
            originPath: 'appimg://chat/rendered-thumbnail.webp'
        }
    }]));

    assert.equal(item.filePath, 'C:\\pending\\original.webp');
    assert.equal(item.sourceUrl, 'appimg://chat/rendered-thumbnail.webp');
});

test('normalizes only renderer-safe media URLs', () => {
    assert.equal(normalizeInlineMediaSourceUrl('https://example.test/image'), 'https://example.test/image');
    assert.equal(normalizeInlineMediaSourceUrl('appimg://chat/image.webp'), 'appimg://chat/image.webp');
    assert.equal(normalizeInlineMediaSourceUrl('blob:https://example.test/id'), 'blob:https://example.test/id');
    assert.equal(normalizeInlineMediaSourceUrl('data:image/png;base64,AA=='), 'data:image/png;base64,AA==');
    assert.equal(normalizeInlineMediaSourceUrl('javascript:alert(1)'), '');
    assert.equal(normalizeInlineMediaSourceUrl('data:text/html,test'), '');
});

test('normalizes a video selected directly from its message record', () => {
    assert.deepEqual(normalizeInlineMediaOpenItem({
        type: 'video',
        filePath: 'D:\\cache\\pending.mp4',
        previewSource: 'D:\\cache\\pending-cover.jpg',
        name: 'pending.mp4',
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
        filePath: 'D:\\cache\\pending.mp4',
        previewSource: 'D:\\cache\\pending-cover.jpg',
        fingerprint: '',
        name: 'pending.mp4',
        sourceIndex: 2,
        identity: {
            chatType: 2,
            peerUid: 'group-uid',
            msgId: 'message-id',
            msgSeq: '100',
            elementId: 'element-id'
        }
    });
    assert.equal(normalizeInlineMediaOpenItem({ type: 'video', filePath: 'relative.mp4' }), null);
});

test('accepts a source-less file media item only while QQ is downloading it', () => {
    const identity = {
        chatType: 2,
        peerUid: 'group-uid',
        msgId: 'message-id',
        msgSeq: '100',
        elementId: 'element-id'
    };
    assert.deepEqual(normalizeInlineMediaOpenItem({
        type: 'video',
        name: 'pending.mp4',
        pendingFile: true,
        identity
    }), {
        type: 'video',
        fingerprint: '',
        name: 'pending.mp4',
        sourceIndex: 0,
        identity,
        pendingFile: true
    });
    assert.equal(normalizeInlineMediaOpenItem({ type: 'video', pendingFile: true }), null);
});

test('builds the QQ rich-media request used by one-click video download', () => {
    const item = {
        filePath: 'D:\\cache\\pending.mp4',
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
        filePath: 'D:\\cache\\pending.mp4'
    };

    assert.deepEqual(createInlineMediaDownloadRequest(item), request);
    assert.deepEqual(createInlineMediaDownloadPayload(item), [{ getReq: request }, null]);
    assert.equal(createInlineMediaDownloadPayload({ identity: item.identity }), null);
});

test('activates the QQ video control before opening the inline preview', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

    assert.match(rendererSource, /item\.recordSource\s*=\s*'forward-detail'/);
    assert.match(rendererSource, /if \(target\.isVideo && !target\.isFileMedia\) \{[\s\S]*dispatchNativeMediaOpen\(target, sourceEvent\)/);
    assert.doesNotMatch(rendererSource, /target\.isVideo\s*&&\s*payload\.recordSource/);
    assert.match(rendererSource, /payload\.nativeDownloadStarted\s*=\s*true/);
    assert.match(mainSource, /item\.type === 'video'\s*&&\s*payload\?\.nativeDownloadStarted === true/);
    assert.match(mainSource, /nativeDownloadStarted[\s\S]*getAbsoluteFilePathCandidate\(\[item\.filePath\]\)/);
    assert.doesNotMatch(mainSource, /requestForwardDetailInlineMediaDownload/);
    assert.match(mainSource, /nodeIKernelRichMediaService\/downloadRichMediaInVisit'[\s\S]*?\}\],\s*false\s*\)/);
});

test('opens file media first and resolves it from QQ file-assistant status', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

    assert.match(rendererSource, /target\.isFileMedia && payload\.pendingFile === true[\s\S]*openInlineMedia\?\.\(payload\)[\s\S]*dispatchNativeMediaOpen\(target, sourceEvent\)/);
    assert.match(rendererSource, /inlineMedia: resolvedIsVideo \|\| isFileImage/);
    assert.match(mainSource, /nodeIKernelFileAssistantService\\\/downloadFile/);
    assert.match(mainSource, /nodeIKernelFileAssistantListener\\\/onFileStatusChanged/);
    assert.match(mainSource, /state\.pendingInlineFileDownload/);
    assert.doesNotMatch(mainSource, /onRichMediaDownloadComplete[\s\S]*pendingInlineMediaDownloads/);
});

test('shows a loading state for every media load', () => {
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

    assert.match(rendererSource, /stage\.classList\.add\('is-loading'\)/);
    assert.match(rendererSource, /stage\.classList\.remove\('is-loading'\)/);
});

test('resolves an unopened gallery item through QQ when navigation first reaches it', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

    assert.match(mainSource, /CHANNEL_PREPARE_INLINE_MEDIA/);
    assert.match(mainSource, /prepareInlineMedia[\s\S]*requestInlineMediaDownload\(browserWindow, item\)/);
    assert.match(rendererSource, /prepareInlineMedia\?\.\(\{ galleryId, index: mediaIndex \}\)/);
    assert.match(rendererSource, /if \(item\.needsResolve\) \{\s*item\.src = '';/);
    assert.doesNotMatch(mainSource, /inlineMediaDownloads|MEDIA_PREVIEW_DOWNLOAD_WAIT_MS/);
});

test('keeps the displayed media until the navigated item is ready', () => {
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

    assert.match(rendererSource, /if \(!activeMedia\) \{\s*stage\.replaceChildren\(\);\s*\}/);
    assert.match(rendererSource, /const previousMedia = activeMedia;\s*activeMedia = media;[\s\S]*stage\.replaceChildren\(media\);[\s\S]*releaseMedia\(previousMedia\)/);
    assert.doesNotMatch(rendererSource, /activeMedia = null;\s*clearLoadingPlaceholder\(\);\s*stage\.replaceChildren\(\);/);
});

test('preloads only the adjacent images in the inline gallery', () => {
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

    assert.match(rendererSource, /const retained = new Set\(\[index - 1, index \+ 1\]\)/);
    assert.match(rendererSource, /items\[mediaIndex\]\?\.type !== 'image'/);
    assert.match(rendererSource, /scheduleAdjacentPreload\(\);/);
    assert.doesNotMatch(rendererSource, /for \(let mediaIndex = 0; mediaIndex < items\.length/);
});

test('uses an inline swatch group for media background selection', () => {
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    const settingsCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings.css'), 'utf8');

    assert.match(rendererSource, /createSwatchItem\(text\('媒体查看背景'\)/);
    assert.match(rendererSource, /setAttribute\('role', 'radiogroup'\)/);
    assert.match(rendererSource, /setAttribute\('role', 'radio'\)/);
    assert.match(settingsCss, /qqnt-toolbox-swatch\[data-value="transparent"\]/);
    assert.doesNotMatch(rendererSource, /createSelectItem|qqnt-toolbox-select|HTMLSelectElement/);
    assert.doesNotMatch(settingsCss, /qqnt-toolbox-select/);
});

test('keeps native video playback while removing redundant viewer controls', () => {
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

    assert.match(rendererSource, /media\.controls = true/);
    assert.match(rendererSource, /controlsList', 'nodownload nofullscreen noremoteplayback'/);
    assert.match(rendererSource, /media\.disablePictureInPicture = true/);
    assert.match(rendererSource, /webkit-media-controls-fullscreen-button/);
    assert.match(rendererSource, /webkit-media-controls-overflow-button/);
    assert.doesNotMatch(rendererSource, /qqnt-toolbox-video-controls/);
});

test('keeps an undownloaded native media item only with a download destination', () => {
    assert.deepEqual(extractInlineMediaPreview(makeCommand([{
        context: {
            video: {
                path: 'C:\\pending-video.mp4',
                fileName: 'pending-video.mp4'
            },
            chatType: 2,
            peerUid: 'group-uid',
            msgId: 'message-id',
            msgSeq: '100',
            elementId: 'element-id'
        }
    }])), {
        type: 'video',
        filePath: 'C:\\pending-video.mp4',
        name: 'pending-video.mp4',
        sourceIndex: 0,
        identity: {
            chatType: 2,
            peerUid: 'group-uid',
            msgId: 'message-id',
            msgSeq: '100',
            elementId: 'element-id'
        }
    });
    assert.equal(extractInlineMediaPreview(makeCommand([{
        context: { video: { fileName: 'pending-video.mp4' } }
    }])), null);
});

test('does not attach transient request state to gallery items', () => {
    const gallery = extractInlineMediaGallery(makeCommand([
        {
            context: {
                sourcePath: 'C:\\pending-image.png',
                chatType: 2,
                peerUid: 'group-uid',
                msgId: 'message-id',
                elementId: 'image-element'
            }
        },
        {
            context: {
                video: {
                    path: 'C:\\pending-video.mp4',
                    fileName: 'pending-video.mp4'
                },
                chatType: 2,
                peerUid: 'group-uid',
                msgId: 'video-message-id',
                elementId: 'video-element'
            }
        }
    ], 1));

    assert.equal(gallery.items.length, 2);
    assert.equal(gallery.items.some(item => 'downloadRequested' in item || 'nativeDownload' in item), false);
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

test('keeps different rendered URLs without local paths as separate gallery items', () => {
    const merged = mergeInlineMediaItems([{
        type: 'image',
        sourceUrl: 'appimg://chat/first.webp',
        identity: { msgId: 'message-1', elementId: 'element-1' }
    }], [{
        type: 'image',
        sourceUrl: 'appimg://chat/second.webp',
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
