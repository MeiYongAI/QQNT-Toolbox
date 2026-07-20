'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    buildEmojiMediaViewerPayload,
    collectEmojiImageSources,
    getMarketFaceData,
    isMarketFaceElement,
    normalizeResourceUrl,
    sanitizeMarketFaceData
} = require('../src/emoji-image-preview');

test('recognizes market face message elements and unwraps their data', () => {
    const element = {
        elementType: 11,
        faceName: '表情',
        staticFacePath: 'C:\\QQ\\emoji.png'
    };
    assert.equal(isMarketFaceElement(element), true);
    assert.equal(getMarketFaceData(element), element);
    assert.equal(isMarketFaceElement({ elementType: 2, picElement: {} }), false);
});

test('collects local market face paths before remote URLs', () => {
    const sources = collectEmojiImageSources({
        staticFacePath: 'C:\\QQ\\static.png',
        dynamicFacePath: 'C:\\QQ\\dynamic.gif',
        emojiWebUrl: 'https://example.test/emoji.png'
    }, ['C:\\QQ\\static.png', 'https://example.test/emoji.png']);

    assert.deepEqual(sources.localPaths, ['C:\\QQ\\static.png', 'C:\\QQ\\dynamic.gif']);
    assert.deepEqual(sources.remoteUrls, ['https://example.test/emoji.png']);
});

test('keeps QQ internal image URLs instead of treating them as local paths', () => {
    const sources = collectEmojiImageSources({
        staticFacePath: 'appimg://emoji/static.webp',
        dynamicFacePath: 'local://emoji/dynamic.gif',
        emojiWebUrl: 'https://example.test/emoji.png',
        ignored: 'javascript:alert(1)'
    });

    assert.deepEqual(sources.localPaths, []);
    assert.deepEqual(sources.remoteUrls, [
        'appimg://emoji/static.webp',
        'local://emoji/dynamic.gif',
        'https://example.test/emoji.png'
    ]);
    assert.equal(normalizeResourceUrl('javascript:alert(1)'), '');
});

test('sanitizes only the market face fields needed for a download', () => {
    assert.deepEqual(sanitizeMarketFaceData({
        emojiId: '123',
        emojiPackageId: '456',
        faceName: '测试',
        key: 'secret',
        staticFacePath: 'C:\\QQ\\emoji.png',
        dynamicFacePath: 'C:\\QQ\\emoji.gif',
        imageWidth: '240',
        imageHeight: '180',
        ignored: { cyclic: true }
    }), {
        emojiId: '123',
        emojiPackageId: 456,
        faceName: '测试',
        key: 'secret',
        staticFacePath: 'C:\\QQ\\emoji.png',
        dynamicFacePath: 'C:\\QQ\\emoji.gif',
        imageWidth: 240,
        imageHeight: 180
    });
});

test('builds the native openMediaViewer payload for a local image', () => {
    assert.deepEqual(buildEmojiMediaViewerPayload({
        sourcePath: 'C:\\QQ\\emoji.png',
        name: '开心',
        width: 240,
        height: 180
    }), [{
        mediaList: [{
            context: {
                sourcePath: 'C:\\QQ\\emoji.png',
                originPath: 'C:\\QQ\\emoji.png',
                fileName: '开心',
                picWidth: 240,
                picHeight: 180
            },
            originPath: 'C:\\QQ\\emoji.png'
        }],
        index: 0
    }]);
});

test('builds a remote image payload when no local path is available', () => {
    const payload = buildEmojiMediaViewerPayload({ sourceUrl: 'https://example.test/emoji.webp' });
    assert.equal(payload?.[0]?.mediaList?.[0]?.context?.sourcePath, 'https://example.test/emoji.webp');
});

test('builds a native payload for a QQ internal image URL', () => {
    const payload = buildEmojiMediaViewerPayload({
        sourceUrl: 'appimg://emoji/123.webp',
        name: 'emoji.webp'
    });
    assert.equal(payload?.[0]?.mediaList?.[0]?.context?.sourcePath, 'appimg://emoji/123.webp');
});

test('preserves an internal URL in sanitized market-face data', () => {
    assert.equal(
        sanitizeMarketFaceData({ staticFacePath: 'local://emoji/123.webp' }).staticFacePath,
        'local://emoji/123.webp'
    );
});
