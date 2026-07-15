'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const {
    classifyMediaFilePath,
    extractInlineMediaGallery,
    extractInlineMediaPreview
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
            context: { sourcePath: filePath },
            originPath: 'appimg://D:/cache/preview%20image.png'
        }
    ], 1));

    assert.deepEqual(preview, {
        type: 'image',
        filePath,
        src: 'appimg://D:/cache/preview%20image.png',
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
        src: `local:///${filePath.replace(/\\/g, '/')}`,
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
