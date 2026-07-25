'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'local-sticker-panel.js'),
    'utf8'
);

test('supports the three mutually exclusive local sticker entry modes', () => {
    assert.match(source, /new Set\(\['contextmenu', 'replace', 'separate'\]\)/);
    assert.match(source, /config\.entryMode === 'replace'/);
    assert.match(source, /config\.entryMode !== 'separate'/);
    assert.match(source, /\['contextmenu', 'replace'\]\.includes\(config\.entryMode\)/);
});

test('moves only the separate local sticker entry to the left toolbar', () => {
    assert.match(source, /iconOnLeft: source\.iconOnLeft === true/);
    assert.match(source, /findSeparateEntryTarget\(toolbar, config\.iconOnLeft\)/);
    assert.match(source, /target\.insertBefore\(separateEntry, target\.firstChild\)/);
});

test('keeps native emoji clicks intact in context-menu mode', () => {
    assert.match(source, /addEventListener\('contextmenu', handleContextMenu, true\)/);
    assert.match(source, /config\.entryMode !== 'replace'/);
    assert.doesNotMatch(source, /nativeEntry\.remove\(\)|nativeEntry\.replaceWith/);
});

test('inserts local stickers into both QQ editor implementations', () => {
    assert.match(source, /createElement\('msg-img'/);
    assert.match(source, /type: 'msgPic'/);
    assert.match(source, /picSubType/);
    assert.match(source, /function isDirectSendGesture\(config, event\)/);
    assert.match(source, /config\.directSendMode === 'click' \? !event\.altKey : event\.altKey/);
    assert.match(source, /if \(isDirectSendGesture\(config, event\)\)/);
});

test('direct-sends only image-style items from QQ non-default emoji panels with the selected gesture', () => {
    assert.match(source, /function handleNativeStickerDirectSend/);
    assert.match(source, /!isDirectSendGesture\(config, event\)/);
    assert.match(source, /watchNativeStickerInsertion\(composer, config\.directSendMode\)/);
    assert.match(source, /getConfig\(\)\.directSendMode === directSendMode/);
    assert.match(source, /isNativeDefaultEmojiPanel\(nativePanel\)/);
    assert.match(source, /visibleText\.includes\('\\u6700\\u8fd1\\u8868\\u60c5'\)[\s\S]*visibleText\.includes\('\\u8d85\\u7ea7\\u8868\\u60c5'\)/);
    assert.match(source, /countComposerMedia\(currentComposer\) <= mediaCount/);
    assert.match(source, /findNativeSendButton\(\)\?\.click\(\)/);
    assert.match(source, /new MutationObserver\(finish\)/);
});

test('keeps the first panel frame hidden until its stylesheet is ready', () => {
    assert.match(source, /root\.style\.position = 'fixed'/);
    assert.match(source, /root\.style\.visibility = 'hidden'/);
    assert.match(source, /function revealPanel[\s\S]*positionPanel\(nextAnchor\)[\s\S]*removeProperty\('visibility'\)/);
    assert.match(source, /if \(style\?\.sheet\)/);
    assert.match(source, /addEventListener\('load',[\s\S]*requestAnimationFrame\(reveal\)/);
    assert.match(source, /installed = true;\s*ensureStyle\(\);/);
});
