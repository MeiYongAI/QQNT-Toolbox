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
    createInlineMediaVisitDownloadPayload,
    extractInlineMediaGallery,
    extractInlineMediaPreview,
    isInlineMediaItemSupported,
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
            msgTime: '',
            guildId: '',
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
            msgTime: '',
            guildId: '',
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
            msgTime: '1784659200',
            guildId: 'guild-id',
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
            msgTime: '1784659200',
            guildId: 'guild-id',
            elementId: 'image-element'
        },
        timestamp: 1784659200
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
            msgTime: '',
            guildId: '',
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
            msgTime: '',
            guildId: '',
            elementId: 'element-id'
        }
    });
    assert.equal(normalizeInlineMediaOpenItem({ type: 'video', filePath: 'relative.mp4' }), null);
});

test('preserves sender and timestamp metadata for the standalone footer', () => {
    const item = normalizeInlineMediaOpenItem({
        type: 'image',
        filePath: 'D:\\cache\\image.png',
        senderName: 'Alice',
        timestamp: 1784659200
    });

    assert.equal(item.senderName, 'Alice');
    assert.equal(item.timestamp, 1784659200);
});

test('accepts a source-less file media item only while QQ is downloading it', () => {
    const identity = {
        chatType: 2,
        peerUid: 'group-uid',
        msgId: 'message-id',
        msgSeq: '100',
        msgTime: '',
        guildId: '',
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
        triggerType: 0,
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
    assert.equal(createInlineMediaDownloadRequest(item, 1).triggerType, 1);
    assert.equal(createInlineMediaDownloadPayload({ identity: item.identity }), null);
});

test('keeps visit downloads isolated from the media viewer item contract', () => {
    const element = { elementType: 5, elementId: 'video-element', videoElement: { fileName: 'clip.mp4' } };
    const visit = {
        msgId: 'message-id',
        msgRandom: '123',
        msgSeq: '100',
        msgTime: '1784659200',
        chatType: 2,
        senderUid: 'sender-uid',
        peerUid: 'group-uid',
        guildId: '',
        element
    };
    assert.deepEqual(createInlineMediaVisitDownloadPayload({ visit }), [{
        downloadType: 1,
        thumbSize: 0,
        msgId: 'message-id',
        msgRandom: '123',
        msgSeq: '100',
        msgTime: '1784659200',
        chatType: 2,
        senderUid: 'sender-uid',
        peerUid: 'group-uid',
        guildId: '',
        ele: element,
        useHttps: true
    }]);
    assert.equal(normalizeInlineMediaOpenItem({ type: 'image', visit }), null);
    assert.equal(normalizeInlineMediaOpenItem({
        type: 'video',
        filePath: 'D:\\cache\\pending.mp4',
        visit
    }).visit, undefined);
    assert.equal(createInlineMediaVisitDownloadPayload({ visit: { msgId: 'message-id' } }), null);
});

test('waits for QQ rich-media completion events before previewing downloads', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

    assert.doesNotMatch(rendererSource, /function createInlineMediaVisit\(/);
    assert.doesNotMatch(rendererSource, /nativeDownloadStarted|directForwardDownload/);
    assert.match(rendererSource, /decision = await getBridge\(\)\?\.openMediaViewer\?\.\(payload\)[\s\S]*if \(!handled \|\| decision\?\.activateNative === true\) \{\s*dispatchNativeMediaOpen\(target, sourceEvent\)/);
    assert.match(mainSource, /function resolveInlineMediaDownload[\s\S]*onRichMediaDownloadComplete/);
    assert.match(mainSource, /function downloadInlineMedia[\s\S]*nodeIKernelMsgService\/downloadRichMedia/);
    assert.doesNotMatch(mainSource, /function resolveInlineMediaVisitDownload\(/);
    assert.match(mainSource, /function canResolveInlineMediaItem[\s\S]*createInlineMediaDownloadPayload/);
    assert.match(mainSource, /async function invokeForwardDetailMediaDownload[\s\S]*nodeIKernelRichMediaService\/downloadRichMediaInVisit/);
    assert.doesNotMatch(mainSource, /waitForReady:\s*true|pendingFileStableMs/);
});

test('keeps the single-click gesture independent from the selected media viewer', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    const handlerSource = rendererSource.slice(
        rendererSource.indexOf('function handleSingleClickMedia'),
        rendererSource.indexOf('function isImageAllInViewport')
    );

    assert.match(rendererSource, /inlineMedia: createInlineMediaOpenItem\(/);
    assert.match(rendererSource, /source: 'message-native',[\s\S]*inlineMedia: null/);
    assert.match(handlerSource, /if \(!singleClickEnabled \|\| event\.button !== 0 \|\|/);
    assert.match(handlerSource, /const openToolboxViewer = inlineViewerEnabled && Boolean\(target\.inlineMedia\);/);
    assert.doesNotMatch(handlerSource, /!inlineViewerEnabled|clickedOpenControl|target\.isFileMedia/);
    assert.match(mainSource, /if \(isInlineMediaViewerEnabled\(tweaks\) && isInlineMediaHost\(browserWindow\)\) \{[\s\S]*showMediaViewer\(browserWindow, gallery, \{ nativeFallback \}\)/);
});

test('uses QQ native media activation and gallery scope inside forward details', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    const openTargetSource = rendererSource.slice(
        rendererSource.indexOf('async function openToolboxMediaTarget'),
        rendererSource.indexOf('function handleEmojiImageClick')
    );
    const openFromRendererSource = mainSource.slice(
        mainSource.indexOf('async function openMediaViewerFromRenderer'),
        mainSource.indexOf('function buildNativeMediaViewerPayload')
    );
    const rememberSource = mainSource.slice(
        mainSource.indexOf('function rememberInlineMediaRecords'),
        mainSource.indexOf('function completeInlineMediaGallery')
    );
    const completeSource = mainSource.slice(
        mainSource.indexOf('function completeInlineMediaGallery'),
        mainSource.indexOf('function isGeneratedRepairPath')
    );

    assert.match(rendererSource, /function getForwardInlineMediaGallery[\s\S]*getVisibleMessageElements\(\)[\s\S]*createInlineMediaOpenItem/);
    assert.match(openTargetSource, /if \(isForwardRecordWindow\(\)\) \{[\s\S]*getForwardInlineMediaGallery\(payload\)[\s\S]*payload = \{ \.\.\.payload, gallery \}/);
    assert.match(openTargetSource, /const handled = decision\?\.handled === true;[\s\S]*decision\?\.activateNative === true[\s\S]*dispatchNativeMediaOpen\(target, sourceEvent\)/);
    assert.match(openFromRendererSource, /if \(item\.pendingFile === true\) \{[\s\S]*return \{ handled, activateNative: true \};[\s\S]*getWindowRoute\(browserWindow\.webContents\.getURL\(\)\) === 'forward'[\s\S]*mediaViewerSession\.stageForward\(browserWindow, gallery\)[\s\S]*return \{ handled, activateNative: true \}/);
    assert.doesNotMatch(openTargetSource, /pendingFile|forwardWindow|waitForNativeActivation/);
    assert.match(rememberSource, /getWindowRoute\(browserWindow\?\.webContents\?\.getURL\(\)\) === 'forward'/);
    assert.match(completeSource, /getWindowRoute\(browserWindow\?\.webContents\?\.getURL\(\)\) === 'forward'\) \{\s*return gallery;/);
});

test('remembers chat media after anti-recall restores the native records', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const handlerSource = mainSource.slice(
        mainSource.indexOf('function handleNativeSend'),
        mainSource.indexOf('function installNativeSendHandler')
    );

    assert.ok(
        handlerSource.indexOf('processPreventRecall(browserWindow, context)') <
        handlerSource.indexOf('rememberInlineMediaRecords(browserWindow, context)')
    );
});

test('falls back to QQ native viewer when an intercepted media load fails', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const viewerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.js'), 'utf8');

    assert.match(mainSource, /function openNativeMediaViewerFallback[\s\S]*OPEN_MEDIA_VIEWER_COMMAND/);
    assert.match(mainSource, /type === 'fallback-native'[\s\S]*openNativeMediaViewerFallback/);
    assert.match(viewerSource, /setLoadError\(true\);\s*requestNativeFallback\(galleryId, index\)/);
    assert.match(viewerSource, /runAction\('fallback-native', \{ galleryId, index \}\)/);
});

test('opens file media first and resolves it from QQ file-assistant status', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

    assert.match(rendererSource, /decision = await getBridge\(\)\?\.openMediaViewer\?\.\(payload\)[\s\S]*decision\?\.activateNative === true[\s\S]*dispatchNativeMediaOpen\(target, sourceEvent\)/);
    assert.match(rendererSource, /inlineMedia: createInlineMediaOpenItem\(/);
    assert.match(rendererSource, /openControl: resolvedIsVideo \|\| isFileMessage[\s\S]*getVideoOpenControl\(element\)/);
    assert.match(rendererSource, /if \(\(target\.isVideo \|\| target\.isFileMedia\) && target\.openControl\)[\s\S]*new MouseEvent\('click'/);
    assert.match(mainSource, /nodeIKernelFileAssistantService\\\/downloadFile/);
    assert.match(mainSource, /nodeIKernelFileAssistantListener\\\/onFileStatusChanged/);
    assert.match(mainSource, /mediaDownloadTasks\.replaceKind\([\s\S]*'file'/);
    assert.match(mainSource, /mediaDownloadTasks\.get\(browserWindow, 'file', itemKey\)/);
    assert.match(mainSource, /item\.pendingFile === true[\s\S]*deferPresentation: true[\s\S]*activateNative: true/);
    assert.match(mainSource, /function bindPendingInlineFileDownload[\s\S]*presentMediaViewer\(browserWindow\)/);
    assert.match(mainSource, /if \(options\.deferPresentation !== true\) \{\s*await presentMediaViewer\(browserWindow\);/);
    assert.match(mainSource, /function resolveInlineMediaDownload[\s\S]*mediaDownloadTasks\.get\(browserWindow, 'rich', key\)[\s\S]*onRichMediaDownloadComplete/);
});

test('delays the standalone viewer loading indicator to avoid a flash on cached media', () => {
    const viewerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.js'), 'utf8');

    assert.match(viewerSource, /const LOAD_INDICATOR_DELAY_MS = 140/);
    assert.match(viewerSource, /loadingTimer = window\.setTimeout\(show, LOAD_INDICATOR_DELAY_MS\)/);
    assert.match(viewerSource, /loading\.hidden = true/);
});

test('conceals stale media until the reopened viewer has rendered its requested item', () => {
    const viewerHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.html'), 'utf8');
    const viewerCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.css'), 'utf8');
    const viewerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.js'), 'utf8');

    assert.match(viewerHtml, /class="media-viewer is-concealed"/);
    assert.match(viewerCss, /\.media-viewer\.is-concealed \.media-slot \{\s*visibility: hidden;/);
    assert.match(viewerSource, /function resetMediaLifecycle[\s\S]*clearPreparedMedia\(\);[\s\S]*clearActiveMedia\(\);[\s\S]*concealMedia\(\);/);
    assert.match(viewerSource, /if \(payload\?\.hidden === true\) \{\s*const presentationId = normalizeText\(payload\?\.presentationId\);\s*resetMediaLifecycle\(\{ clearStatus: true, conceal: true \}\);\s*state = createEmptyViewerState\(state\.background\);/);
    assert.match(viewerSource, /const freshPresentation = Boolean\(presentationId\);\s*if \(freshPresentation\) \{\s*resetMediaLifecycle\(\{ clearStatus: true, conceal: true \}\);\s*state = createEmptyViewerState\(state\.background\);/);
    assert.match(viewerSource, /function revealSelectedMedia[\s\S]*activeGalleryId !== galleryId[\s\S]*activeIndex !== index[\s\S]*classList\.remove\('is-concealed'\)/);
    assert.match(viewerSource, /async function renderSelected[\s\S]*slot\.replaceChildren\(media\)[\s\S]*revealSelectedMedia\(galleryId, index\)/);
    assert.doesNotMatch(viewerSource, /renderSelected\(false, nextState\.playback\)\.then/);
});

test('presents a reused media window only after the renderer commits a cleared frame', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const viewerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.js'), 'utf8');

    assert.match(mainSource, /const presented = waitForMediaViewerPresentation\(presentationId\)/);
    assert.match(mainSource, /setOpacity\(0\)[\s\S]*showInactive\(\)[\s\S]*const didPresent = await presented[\s\S]*if \(!didPresent\)[\s\S]*setOpacity\(WINDOWS_MEDIA_VIEWER_OPACITY\)/);
    assert.match(mainSource, /async function hideMediaViewer\(\) \{[\s\S]*const cleared = waitForMediaViewerPresentation\(presentationId\)[\s\S]*setOpacity\(0\);[\s\S]*sendMediaViewerState\(\{ hidden: true, presentationId \}\)[\s\S]*const didClear = await cleared[\s\S]*viewerWindow\.hide\(\);/);
    assert.match(mainSource, /mediaViewerVisibilityRevision \+= 1;[\s\S]*const presented = waitForMediaViewerPresentation\(presentationId\)/);
    assert.match(mainSource, /if \(type === 'presented'\) \{\s*return \{ ok: completeMediaViewerPresentation\(payload\.presentationId\) \};/);
    assert.match(viewerSource, /function acknowledgePresentation[\s\S]*requestAnimationFrame\(\(\) => \{\s*requestAnimationFrame\(\(\) => \{[\s\S]*type: 'presented'/);
    assert.match(viewerSource, /if \(payload\?\.hidden === true\) \{[\s\S]*acknowledgePresentation\(presentationId\);\s*return;/);
    assert.match(viewerSource, /if \(freshPresentation\) \{\s*resetMediaLifecycle\(\{ clearStatus: true, conceal: true \}\);/);
});

test('cancels pending rendering and clears the session when the viewer closes', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const viewerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.js'), 'utf8');
    const closeActionSource = mainSource.slice(
        mainSource.indexOf('async function handleMediaViewerAction'),
        mainSource.indexOf('async function selectExistingMediaViewerItem')
    );
    const hiddenStateSource = viewerSource.slice(
        viewerSource.indexOf('function applyState'),
        viewerSource.indexOf("previous.addEventListener('click'")
    );

    assert.match(closeActionSource, /if \(type === 'close'\) \{\s*const hidden = hideMediaViewer\(\);\s*clearMediaViewerSession\(\);\s*await hidden;/);
    assert.match(mainSource, /function clearMediaViewerSession\(\) \{\s*mediaViewerSession\.clearAll\(\);\s*\}/);
    assert.doesNotMatch(mainSource, /mediaViewerGallery|pendingForwardMediaGallery/);
    assert.match(hiddenStateSource, /if \(payload\?\.hidden === true\) \{[\s\S]*state = createEmptyViewerState\(state\.background\);[\s\S]*updateChrome\(\);\s*acknowledgePresentation\(presentationId\);\s*return;/);
});

test('resolves an unopened gallery item through QQ when navigation first reaches it', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const viewerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.js'), 'utf8');

    assert.match(mainSource, /CHANNEL_MEDIA_VIEWER_PREPARE/);
    assert.match(mainSource, /prepareMediaViewerItem[\s\S]*triggerType: preload \? 1 : 0/);
    assert.match(viewerSource, /bridge\.prepare\(\{ galleryId, index, preload \}\)/);
    assert.match(viewerSource, /if \(item\?\.needsResolve\) \{[\s\S]*resolveMediaItem/);
    assert.doesNotMatch(mainSource, /waitForReady:\s*true|MEDIA_PREVIEW_DOWNLOAD_WAIT_MS/);
});

test('starts the selected download before the standalone viewer takes focus', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const showSource = mainSource.slice(
        mainSource.indexOf('async function showMediaViewer'),
        mainSource.indexOf('function findInlineMediaDownloadInfo')
    );

    assert.match(showSource, /downloadInlineMedia\(browserWindow, selectedItem, \{[\s\S]*triggerType: 0,[\s\S]*source: 'chat'/);
    assert.match(showSource, /await presentMediaViewer\(browserWindow\)/);
    assert.match(mainSource, /media\.download-complete-signaled[\s\S]*waitForCompletedInlineMediaFile\([\s\S]*deadline - Date\.now\(\)/);
});

test('stages the complete forward gallery before QQ starts a native media download', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

    assert.match(mainSource, /function openForwardMediaViewerFromDownloadRequest[\s\S]*watchInlineMediaDownload\(browserWindow, item,[\s\S]*mediaViewerSession\.consumeStagedForward\(browserWindow, item\)[\s\S]*showMediaViewer\(browserWindow, stagedGallery\)[\s\S]*showMediaViewer\(browserWindow, \{ items: \[item\], index: 0 \}\)/);
    assert.match(mainSource, /media\.native-viewer-coalesced/);
    assert.match(mainSource, /mediaViewerSession\.containsAll\([\s\S]*if \(activeGalleryContainsIncoming && activeItem/);
    assert.match(mainSource, /const requestedItems = Array\.isArray\(payload\?\.gallery\?\.items\)[\s\S]*getWindowRoute\(browserWindow\.webContents\.getURL\(\)\) === 'forward'[\s\S]*mediaViewerSession\.stageForward\(browserWindow, gallery\)[\s\S]*activateNative: true/);
    assert.doesNotMatch(rendererSource, /waitForNativeActivation/);
    assert.doesNotMatch(mainSource, /pendingForwardMediaGallery/);
    assert.doesNotMatch(rendererSource, /awaitNativeDownload|media\.forward-preview-failed/);
});

test('validates completed media when QQ reports an inaccurate total size', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

    assert.match(mainSource, /function isDecodableInlineImage[\s\S]*nativeImage\.createFromPath\(filePath\)[\s\S]*image\?\.getSize/);
    assert.match(mainSource, /item\?\.type === 'image' && isDecodableInlineImage\(filePath\)/);
    assert.match(mainSource, /function hasCompleteIsoMediaStructure[\s\S]*boxType === 'moov'[\s\S]*boxType === 'mdat'/);
    assert.match(mainSource, /media\.download-size-mismatch-accepted/);
    assert.match(mainSource, /item\.fileSize = \(await fs\.stat\(filePath\)\)\.size/);
});

test('keeps the displayed media until the navigated item is ready', () => {
    const viewerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.js'), 'utf8');
    const renderSelectedSource = viewerSource.slice(
        viewerSource.indexOf('async function renderSelected'),
        viewerSource.indexOf('function scheduleAdjacentPreload')
    );

    assert.match(renderSelectedSource, /const previousMedia = activeMedia;[\s\S]*activeMedia = media;[\s\S]*slot\.replaceChildren\(media\);[\s\S]*cachePreviousMedia\(previousMedia/);
    assert.doesNotMatch(renderSelectedSource, /slot\.replaceChildren\(\)|clearActiveMedia\(\)/);
});

test('preloads only adjacent media in the standalone gallery', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const viewerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.js'), 'utf8');

    assert.match(viewerSource, /const retained = new Set\(\[index - 1, index \+ 1\]\.filter/);
    assert.match(viewerSource, /if \(item\?\.src \|\| item\?\.type === 'image'\) \{\s*getPreparedMedia\(mediaIndex, false, true\)\?\.promise/);
    assert.match(mainSource, /if \(preload && item\.type === 'video'\) \{\s*return null;/);
    assert.match(viewerSource, /scheduleAdjacentPreload\(\);/);
    assert.doesNotMatch(viewerSource, /for \(let mediaIndex = 0; mediaIndex < state\.items\.length/);
});

test('keeps media counting local and sorts known chat media from oldest to newest', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const viewerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.js'), 'utf8');

    assert.doesNotMatch(mainSource, /getAioFirstViewLatestMsgs|queryPicOrVideoMsgs(?:Desktop)?/);
    assert.doesNotMatch(mainSource, /inlineMediaHistory|media-history|countComplete/);
    assert.match(mainSource, /mergeInlineMediaItems\([\s\S]*rememberedItems,[\s\S]*viewerItems[\s\S]*\)\.sort\(compareInlineMediaItems\)/);
    assert.match(mainSource, /const difference = BigInt\(leftSeq\) - BigInt\(rightSeq\)/);
    assert.match(mainSource, /previewItems = items\.map\(createDeferredMediaViewerDisplayItem\)/);
    assert.doesNotMatch(mainSource, /Promise\.all\(items\.map\(createMediaViewerDisplayItem\)\)/);
    assert.match(viewerSource, /previousById\.get\(normalizeText\(item\?\.id\)\)/);
    assert.match(viewerSource, /`\$\{state\.index \+ 1\} \/ \$\{state\.items\.length\}`/);
    assert.doesNotMatch(viewerSource, /countComplete|'\.\.\.'/);
});

test('uses a swatch group for the fullscreen media background', () => {
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    const settingsCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings.css'), 'utf8');
    const viewerCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.css'), 'utf8');

    assert.match(rendererSource, /createSwatchItem\(text\('媒体预览背景'\)/);
    assert.match(rendererSource, /setAttribute\('role', 'radiogroup'\)/);
    assert.match(rendererSource, /setAttribute\('role', 'radio'\)/);
    assert.match(settingsCss, /qqnt-toolbox-swatch\[data-value="transparent"\]/);
    assert.match(settingsCss, /linear-gradient\(#222222eb, #222222eb\)/);
    assert.match(rendererSource, /linear-gradient\(#222222eb, #222222eb\)/);
    assert.match(viewerCss, /data-background="semi"[\s\S]*--viewer-background: #222222eb/);
    assert.match(viewerCss, /\.media-viewer\.video-expanded \{\s*--viewer-background: #000;/);
    assert.doesNotMatch(rendererSource, /createSelectItem|qqnt-toolbox-select|HTMLSelectElement/);
    assert.doesNotMatch(settingsCss, /qqnt-toolbox-select/);
});

test('uses Telegram-style custom video controls in the standalone viewer', () => {
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    const viewerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.js'), 'utf8');
    const viewerHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.html'), 'utf8');

    assert.match(viewerSource, /media\.controls = false/);
    assert.match(viewerSource, /runAction\('open-pip'/);
    assert.doesNotMatch(viewerSource, /requestPictureInPicture|exitPictureInPicture/);
    assert.match(viewerSource, /const SPEEDS = \[0\.5, 1, 1\.5, 2\]/);
    assert.match(viewerSource, /duration\.textContent = `−\$\{formatDuration/);
    assert.match(viewerSource, /function setVideoFullscreen\(enabled\)/);
    assert.match(viewerHtml, /id="player-controls"/);
    assert.match(viewerHtml, /id="seek"/);
    assert.match(viewerHtml, /id="video-fullscreen"/);
    assert.match(viewerHtml, /id="player-settings-menu"/);
    assert.doesNotMatch(viewerHtml, /id="thumbnail-strip"/);
    assert.doesNotMatch(viewerSource, /renderThumbnails|thumbnailStrip/);
    assert.ok(viewerHtml.indexOf('id="volume-toggle"') < viewerHtml.indexOf('id="play-pause"'));
    assert.ok(viewerHtml.indexOf('id="play-pause"') < viewerHtml.indexOf('id="video-fullscreen"'));
    assert.ok(viewerHtml.indexOf('id="rotate"') < viewerHtml.indexOf('id="more"'));
    assert.match(viewerSource, /rotate\.hidden = !item/);
    assert.match(viewerSource, /event\.key\.toLowerCase\(\) === 'r' && activeMedia/);
    assert.doesNotMatch(rendererSource, /qqnt-toolbox-inline-media-preview|qqnt-toolbox-media-stage/);
});

test('does not show native hover tooltips on media viewer controls', () => {
    const viewerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.js'), 'utf8');
    const viewerHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.html'), 'utf8');

    assert.doesNotMatch(viewerHtml, /\btitle=/);
    assert.doesNotMatch(viewerSource, /\.title\s*=|setAttribute\(['"]title/);
});

test('opens the shared Telegram media menu at the right-click position', () => {
    const viewerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.js'), 'utf8');
    const viewerHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.html'), 'utf8');
    const viewerCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.css'), 'utf8');
    const contextHandlerSource = viewerSource.slice(
        viewerSource.indexOf("viewer.addEventListener('contextmenu'"),
        viewerSource.indexOf("viewer.addEventListener('dragstart'")
    );

    assert.match(viewerHtml, /id="more"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
    assert.match(viewerHtml, /id="menu-save"[\s\S]*<span>另存为<\/span>/);
    assert.match(viewerSource, /function openMoreMenu\(position = null\)[\s\S]*positionMoreMenuAt\(position\.x, position\.y\)/);
    assert.match(viewerSource, /const menuWidth = moreMenu\.offsetWidth/);
    assert.match(viewerSource, /const menuHeight = moreMenu\.offsetHeight/);
    assert.match(viewerSource, /const opensLeft = clientX \+ menuWidth \+ CONTEXT_MENU_MARGIN > window\.innerWidth/);
    assert.match(viewerSource, /const opensAbove = clientY \+ menuHeight \+ CONTEXT_MENU_MARGIN > window\.innerHeight/);
    assert.match(viewerSource, /\[menuSave, 'save'\]/);
    assert.match(contextHandlerSource, /clickedMedia !== activeMedia/);
    assert.match(contextHandlerSource, /openMoreMenu\(\{ x: event\.clientX, y: event\.clientY \}\)/);
    assert.doesNotMatch(contextHandlerSource, /event => event\.preventDefault\(\)/);
    assert.match(viewerCss, /\.media-menu\.is-context \{[\s\S]*position: fixed;[\s\S]*top: var\(--context-menu-top\);[\s\S]*left: var\(--context-menu-left\);/);
    assert.match(viewerCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.media-menu:not\(\[hidden\]\)/);
});

test('closes the Telegram image viewer when its image or blank area is clicked', () => {
    const viewerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.js'), 'utf8');
    const clickHandlerSource = viewerSource.slice(
        viewerSource.indexOf("viewer.addEventListener('click'"),
        viewerSource.indexOf("viewer.addEventListener('wheel'")
    );

    assert.match(clickHandlerSource, /const clickedMedia = target\?\.closest\('\.media-content'\)/);
    assert.match(clickHandlerSource, /\.chrome, \.media-loading, \.media-error, \.media-toast/);
    assert.match(clickHandlerSource, /if \(clickedMedia\?\.tagName === 'VIDEO' \|\| interactiveTarget\) \{\s*return;\s*\}/);
    assert.match(clickHandlerSource, /activeMedia\?\.pause\?\.\(\);\s*runAction\('close'\);/);
    assert.doesNotMatch(clickHandlerSource, /'\.media-content, \.chrome/);
});

test('labels image viewer optimization as native-QQ-only', () => {
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

    assert.ok(rendererSource.includes(
        "createSwitchItem(text('图片查看器优化'), text('仅优化 QQ 原生查看器：点击空白关闭、拖动窗口')"
    ));
    assert.match(rendererSource, /imageViewerOptimization'\) \|\| !isImageViewerWindow\(\)/);
});

test('honors hidden state for every standalone viewer control and status layer', () => {
    const viewerCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.css'), 'utf8');

    assert.match(viewerCss, /\.media-viewer \[hidden\] \{\s*display: none !important;/);
    assert.doesNotMatch(viewerCss, /\.media-error\[hidden\]|\.player-controls\[hidden\]|\.media-menu\[hidden\]/);
});

test('keeps the translucent viewer background uniform around its controls', () => {
    const viewerHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.html'), 'utf8');
    const viewerCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.css'), 'utf8');

    assert.doesNotMatch(viewerHtml, /window-shadow/);
    assert.doesNotMatch(viewerCss, /\.window-shadow|\.media-footer::before/);
});

test('fits large media without upscaling small images', () => {
    const viewerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.js'), 'utf8');
    const viewerCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.css'), 'utf8');

    assert.match(viewerCss, /\.media-stage \{[\s\S]*inset: var\(--media-stage-top\) 0 var\(--media-stage-bottom\);/);
    assert.match(viewerCss, /\.media-viewer\.is-video \{\s*--media-stage-bottom: calc\(var\(--player-height\)/);
    assert.match(viewerCss, /--player-height: 72px/);
    assert.match(viewerCss, /border-radius: 9px/);
    assert.match(viewerSource, /const MEDIA_STAGE_MIN_TOP = 11/);
    assert.match(viewerSource, /const topSkip = Math\.min\([\s\S]*Math\.max\(MEDIA_STAGE_MIN_TOP, viewer\.clientHeight - sourceHeight - bottomSkip\),[\s\S]*bottomSkip/);
    assert.match(viewerSource, /updateMediaStageGeometry\(\);\s*const isVideo/);
    assert.match(viewerSource, /const fitScale = Math\.min\(availableWidth \/ sourceWidth, availableHeight \/ sourceHeight\)/);
    assert.match(viewerSource, /const scale = isVideo \? fitScale : Math\.min\(1, fitScale\)/);
    assert.match(viewerSource, /activeMedia\.style\.width = `\$\{sourceWidth \* scale\}px`/);
    assert.match(viewerSource, /activeMedia\.style\.height = `\$\{sourceHeight \* scale\}px`/);
    assert.match(viewerSource, /window\.addEventListener\('resize',[\s\S]*fitMediaToStage\(\);[\s\S]*applyMediaTransform\(\)/);
    assert.match(viewerCss, /\.media-viewer\.video-expanded \{[\s\S]*--media-stage-top: 0px !important;[\s\S]*--media-stage-bottom: 0px;/);
    assert.match(viewerCss, /\.media-viewer\.is-video\.video-expanded \{[\s\S]*--media-stage-bottom: 0px;/);
    assert.match(viewerCss, /\.media-nav \{[\s\S]*top: 47px;[\s\S]*bottom: 47px;[\s\S]*width: 90px;/);
    assert.doesNotMatch(viewerCss, /\.media-viewer\.is-video \.media-nav|\.media-viewer\.video-expanded \.media-nav/);
    assert.doesNotMatch(viewerCss, /\.media-stage \{\s*(?:right|left):/);
});

test('creates one reusable true-fullscreen frameless media viewer', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const viewerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.js'), 'utf8');
    const viewerCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-viewer.css'), 'utf8');
    const viewerWindowSource = mainSource.slice(
        mainSource.indexOf('async function ensureMediaViewerWindow'),
        mainSource.indexOf('function bindMediaViewerSourceWindow')
    );

    assert.match(mainSource, /let mediaViewerWindow = null/);
    assert.match(mainSource, /browserWindow !== mediaViewerWindow && browserWindow\.webContents !== sender/);
    assert.match(mainSource, /new BrowserWindow\(\{[\s\S]*frame: false,[\s\S]*resizable: false,[\s\S]*maximizable: false,[\s\S]*thickFrame: false,[\s\S]*transparent: true,[\s\S]*skipTaskbar: true,[\s\S]*fullscreen: false,[\s\S]*fullscreenable: true/);
    assert.match(mainSource, /const WINDOWS_MEDIA_VIEWER_OPACITY = 254 \/ 255/);
    assert.match(mainSource, /process\.platform === 'win32'[\s\S]*viewerWindow\.setOpacity\(WINDOWS_MEDIA_VIEWER_OPACITY\)/);
    assert.doesNotMatch(viewerWindowSource, /backgroundThrottling:\s*false/);
    assert.match(mainSource, /media-viewer-preload\.js/);
    assert.match(mainSource, /media-viewer\.html/);
    assert.match(mainSource, /function positionMediaViewerWindow[\s\S]*viewerWindow\.isFullScreen\(\)[\s\S]*currentDisplay\.id === display\.id[\s\S]*viewerWindow\.setBounds\(display\.bounds\);\s*viewerWindow\.setFullScreen\(true\);/);
    assert.match(viewerWindowSource, /await mediaViewerWindowReady;\s*await positionMediaViewerWindow\(viewerWindow, sourceWindow\);/);
    assert.doesNotMatch(viewerWindowSource, /setAlwaysOnTop/);
    assert.match(viewerSource, /const CONTROL_HIDE_DELAY_MS = 1100/);
    assert.match(viewerSource, /event\.ctrlKey && event\.key\.toLowerCase\(\) === 'f'[\s\S]*setVideoFullscreen/);
    assert.match(viewerSource, /else if \(viewer\.classList\.contains\('video-expanded'\)\) \{\s*setVideoFullscreen\(false\)/);
    assert.doesNotMatch(viewerSource, /media\.addEventListener\('dblclick'/);
    assert.match(viewerSource, /function clearActiveMedia\(\)[\s\S]*activeMedia = null;[\s\S]*releaseMedia\(media\)/);
    assert.match(viewerSource, /if \(freshPresentation\) \{\s*resetMediaLifecycle\(\{ clearStatus: true, conceal: true \}\);/);
    assert.match(viewerCss, /transition: opacity 200ms linear/);
    assert.match(viewerCss, /transition-duration: 600ms/);
    assert.match(viewerCss, /width: 90px/);
});

test('uses a Telegram-style custom PiP window instead of Chromium PiP', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const nativeSource = fs.readFileSync(path.join(__dirname, '..', 'native', 'poke-bridge.cpp'), 'utf8');
    const pipSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-pip.js'), 'utf8');
    const pipHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-pip.html'), 'utf8');
    const pipCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-pip.css'), 'utf8');
    const presentViewerSource = mainSource.slice(
        mainSource.indexOf('async function presentMediaViewer'),
        mainSource.indexOf('function isInlineMediaHost')
    );
    const pointerDownSource = pipSource.slice(
        pipSource.indexOf("shell.addEventListener('pointerdown'"),
        pipSource.indexOf("shell.addEventListener('pointermove'")
    );
    const stopDraggingSource = pipSource.slice(
        pipSource.indexOf('function stopDragging'),
        pipSource.indexOf("shell.addEventListener('pointerdown'")
    );

    assert.match(mainSource, /let mediaPipWindow = null/);
    assert.match(mainSource, /media-pip-preload\.js/);
    assert.match(mainSource, /media-pip\.html/);
    assert.doesNotMatch(mainSource, /alwaysOnTop: true/);
    assert.match(mainSource, /skipTaskbar: true/);
    assert.match(mainSource, /hideMediaViewer\(\);\s*pipWindow\.showInactive\(\);\s*pipWindow\.setAlwaysOnTop\(\s*true,\s*process\.platform === 'win32' \? 'pop-up-menu' : 'floating'\s*\);\s*pipWindow\.moveTop\(\);/);
    assert.doesNotMatch(presentViewerSource, /hideMediaPipWindow|clearMediaPipSession/);
    assert.match(mainSource, /mediaPipSession\.active = \{[\s\S]*sourceWindow: selection\.sourceWindow,[\s\S]*gallery: cloneMediaViewerGallery\(selection\.gallery, selection\.index\),[\s\S]*viewerItems: selection\.session\.viewerItems\.map/);
    assert.match(mainSource, /mediaViewerSession\.begin\(sourceWindow, gallery, \{ viewerItems \}\)[\s\S]*activateMediaViewerWindow\(viewerWindow, \{ playback \}\);\s*closeMediaPipSession\(\);/);
    assert.doesNotMatch(mainSource, /mediaPipNativeMoveAvailable/);
    assert.doesNotMatch(mainSource, /viewerWindow\.on\('hide', \(\) => sendMediaPipState/);
    assert.match(mainSource, /constrainPipResize/);
    assert.match(mainSource, /snapPipBounds/);
    assert.match(pipSource, /runAction\('enlarge'\)/);
    assert.match(pipSource, /const DRAG_THRESHOLD = 4/);
    assert.match(pipSource, /shell\.setPointerCapture\?\.\(event\.pointerId\)/);
    assert.match(pipSource, /bridge\.drag\(\{ phase: 'start' \}\)/);
    assert.match(pipSource, /queueDragOffset\(offsetX, offsetY\)/);
    assert.match(pipSource, /bridge\.drag\(\{ phase: 'end' \}\)/);
    assert.doesNotMatch(pointerDownSource, /bridge\.drag/);
    assert.match(stopDraggingSource, /if \(wasDragging\) \{\s*flushDragOffset\(\);\s*bridge\.drag\(\{ phase: 'end' \}\);/);
    assert.match(pipSource, /shell\.addEventListener\('click',[\s\S]*suppressPlaybackClick[\s\S]*!isInteractiveTarget\(event\.target\)[\s\S]*togglePlayback\(\)/);
    assert.match(pipSource, /const wasDragging = dragState\.started;[\s\S]*if \(wasDragging\) \{[\s\S]*suppressPlaybackClick = true;/);
    assert.doesNotMatch(pipSource, /window\.moveTo|window\.resizeTo/);
    assert.match(mainSource, /mediaPipDragOrigin = mediaPipWindow\.getBounds\(\)/);
    assert.match(mainSource, /moveMediaPipWindow\(dx, dy\)/);
    assert.match(mainSource, /setMediaPipBounds\(mediaPipWindow, movePipBounds\(mediaPipDragOrigin, dx, dy\)\)/);
    assert.doesNotMatch(mainSource, /mediaPipWindow\.setPosition/);
    assert.match(mainSource, /beginMediaPipNativeMove\(\)/);
    assert.match(mainSource, /endMediaPipNativeMove\(\)/);
    assert.match(mainSource, /getWindowsNativeBridge\(\)\?\.moveWindow\?\.\(/);
    assert.match(nativeSource, /GetDpiForWindow\(window\)/);
    assert.match(nativeSource, /SetWindowPos\(window, nullptr, physicalX, physicalY, 0, 0, flags\)/);
    assert.match(nativeSource, /SWP_NOSIZE \| SWP_NOZORDER \| SWP_NOACTIVATE/);
    assert.match(pipHtml, /id="play-pause"/);
    assert.match(pipHtml, /id="volume-toggle"/);
    assert.match(pipHtml, /id="seek"/);
    assert.doesNotMatch(pipHtml, /\btitle=/);
    assert.doesNotMatch(pipSource, /\.title\s*=/);
    assert.match(pipCss, /\.pip-shell:hover \.pip-controls/);
    assert.match(pipCss, /\.pip-root::before \{[\s\S]*box-shadow:[\s\S]*0 3px 8px rgba\(0, 0, 0, \.24\)/);
    assert.match(pipCss, /\.pip-shell \{[\s\S]*border-radius: 8px;[\s\S]*clip-path: inset\(0 round 8px\);/);
    assert.match(pipCss, /\.pip-video \{[\s\S]*clip-path: inset\(0 round 8px\);/);
    assert.doesNotMatch(pipCss, /-webkit-app-region/);
    assert.match(pipCss, /\.pip-volume-group,[\s\S]*top: 0;/);
    assert.match(pipCss, /\.pip-volume-group \{\s*left: 0;/);
    assert.match(pipCss, /\.pip-window-actions \{\s*right: 0;/);
});

test('keeps Telegram-style PiP mode active until the video is enlarged', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const pipSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'media-pip.js'), 'utf8');
    const openPipSource = mainSource.slice(
        mainSource.indexOf('async function openMediaPip(selection, payload)'),
        mainSource.indexOf('async function openMediaPipForStickyMode')
    );
    const stickyPipSource = mainSource.slice(
        mainSource.indexOf('async function openMediaPipForStickyMode'),
        mainSource.indexOf('async function restoreMediaViewerFromPip')
    );
    const pipActionSource = mainSource.slice(
        mainSource.indexOf('async function handleMediaPipAction'),
        mainSource.indexOf('async function handleMediaViewerAction')
    );

    assert.match(mainSource, /const mediaPipSession = \{\s*active: null,\s*sticky: false\s*\}/);
    assert.match(openPipSource, /await ensureMediaPipWindow[\s\S]*mediaPipSession\.sticky = true;/);
    assert.doesNotMatch(openPipSource, /mediaPipSession\.sticky = true;[\s\S]*await ensureMediaPipWindow/);
    assert.match(stickyPipSource, /!mediaPipSession\.sticky \|\| item\?\.type !== 'video'/);
    assert.match(stickyPipSource, /playback: \{ paused: false \}/);
    assert.match(stickyPipSource, /catch \(error\) \{[\s\S]*return false;/);
    assert.match(mainSource, /if \(selection && await openMediaPipForStickyMode\(selection\)\) \{/);
    assert.match(mainSource, /if \(type === 'select'\) \{[\s\S]*await openMediaPipForStickyMode\(selection\);/);
    assert.match(pipActionSource, /if \(type === 'close'\) \{\s*closeMediaPipSession\(\);\s*return \{ ok: true \};\s*\}/);
    assert.doesNotMatch(
        pipActionSource.match(/if \(type === 'close'\)[\s\S]*?\n    \}/)?.[0] || '',
        /mediaPipSession\.sticky = false/
    );
    assert.match(pipActionSource, /if \(type === 'enlarge'\) \{\s*mediaPipSession\.sticky = false;/);
    assert.match(mainSource, /if \(!isInlineMediaViewerEnabled\(\)\) \{\s*mediaPipSession\.sticky = false;/);
    assert.match(pipSource, /type: 'metadata',[\s\S]*videoWidth: video\.videoWidth,[\s\S]*videoHeight: video\.videoHeight/);
    assert.match(pipActionSource, /if \(type === 'metadata'\)[\s\S]*configureMediaPipGeometry\(mediaPipWindow, pip\.sourceWindow, width \/ height\)/);
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
            msgTime: '',
            guildId: '',
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
            msgTime: '',
            guildId: '',
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

test('intercepts only media containers supported by the standalone viewer', () => {
    assert.equal(isInlineMediaItemSupported({ type: 'video', filePath: 'D:\\media\\clip.mp4' }), true);
    assert.equal(isInlineMediaItemSupported({ type: 'video', filePath: 'D:\\media\\clip.webm' }), true);
    assert.equal(isInlineMediaItemSupported({ type: 'video', filePath: 'D:\\media\\clip.mkv' }), false);
    assert.equal(isInlineMediaItemSupported({ type: 'video', filePath: 'D:\\media\\clip.avi' }), false);
    assert.equal(isInlineMediaItemSupported({ type: 'image', sourceUrl: 'appimg://chat/photo.webp' }), true);
});

test('preserves the expected file size used to reject partial downloads', () => {
    const item = normalizeInlineMediaOpenItem({
        type: 'video',
        filePath: 'D:\\cache\\pending.mp4',
        fileSize: '4096'
    });

    assert.equal(item.fileSize, 4096);
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
