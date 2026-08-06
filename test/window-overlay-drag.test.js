'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function readSource(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('Toolbox overlays exclude the QQ native title-bar drag region', () => {
    for (const relativePath of [
        'src/renderer.js',
        'src/voice/panel-style.js',
        'src/fake-forward-editor.css',
        'src/auto-reaction-editor.js',
        'src/recall-filter-editor.js',
        'src/context-menu-order.js',
        'src/local-sticker-manager.css',
        'src/local-sticker-panel.css'
    ]) {
        assert.match(
            readSource(relativePath),
            /-webkit-app-region:\s*no-drag/,
            relativePath
        );
    }
});

test('movable Toolbox panels keep pointer capture for their own drag lifecycle', () => {
    const renderer = readSource('src/renderer.js');
    const voicePanel = readSource('src/voice/library-panel.js');

    assert.match(renderer, /titlebar\.setPointerCapture\(event\.pointerId\)/);
    assert.match(renderer, /titlebar\.addEventListener\('pointermove'/);
    assert.match(voicePanel, /header\.setPointerCapture\?\.\(event\.pointerId\)/);
    assert.match(voicePanel, /header\.addEventListener\('pointermove'/);
    assert.match(voicePanel, /requestAnimationFrame\(applyDragPosition\)/);
    assert.match(voicePanel, /translate3d\(/);
    assert.match(voicePanel, /shell\.style\.transform = ''/);
    assert.match(voicePanel, /state\.dragging = true/);
    assert.match(voicePanel, /state\.dragging = false;[\s\S]*?schedulePendingLibraryFlush\(\)/);
});

test('close-button dialogs ignore backdrop clicks and support Escape', () => {
    const modalSources = [
        readSource('src/fake-forward-editor.js'),
        readSource('src/local-sticker-manager.js'),
        readSource('src/context-menu-order.js'),
        readSource('src/qr-result-dialog.js')
    ];

    for (const source of modalSources) {
        assert.match(source, /event\.key === 'Escape'/);
        assert.doesNotMatch(source, /event\.target === (?:root|layer)/);
    }
});

test('the floating Toolbox closes with Escape after higher modals handle it', () => {
    const renderer = readSource('src/renderer.js');

    assert.match(renderer, /function handleFloatingPanelEscape[\s\S]*?event\.key !== 'Escape'/);
    assert.match(renderer, /activeShortcutCapture/);
    assert.match(renderer, /\[role="dialog"\]/);
    assert.match(renderer, /element\.getClientRects\(\)\.length > 0/);
    assert.match(renderer, /window\.addEventListener\('keydown', handleFloatingPanelEscape, true\)/);
    assert.doesNotMatch(renderer, /function handleFloatingPanelEscape[\s\S]*?event\.defaultPrevented[\s\S]*?function installPanelEvents/);
});

test('Escape passes through when no rendered Toolbox surface handles it', () => {
    const renderer = readSource('src/renderer.js');
    const fakeForward = readSource('src/fake-forward-editor.js');
    const localStickers = readSource('src/local-sticker-panel.js');
    const voicePanel = readSource('src/voice/library-panel.js');
    const voiceController = readSource('src/voice/renderer-controller.js');
    const mediaViewer = readSource('src/media-viewer.js');

    assert.match(renderer, /panel\.getClientRects\(\)\.length === 0/);
    assert.match(renderer, /event\.key === 'Escape' \|\| activeShortcutCapture/);
    assert.match(fakeForward, /state\.root\.getClientRects\(\)\.length > 0/);
    assert.match(localStickers, /root\.getClientRects\(\)\.length > 0/);
    assert.match(voicePanel, /isOpen: \(\) => Boolean\([\s\S]*?getClientRects\(\)\.length > 0/);
    assert.match(
        voiceController,
        /if \(!libraryPanel\.handleEscape\(\)\) \{\s*return;\s*\}[\s\S]*?event\.preventDefault\(\)/
    );
    assert.match(
        mediaViewer,
        /if \(event\.key === 'Escape'\) \{\s*if \(viewer\.classList\.contains\('is-concealed'\)\) \{\s*return;/
    );
});

test('chat toolbar hover blocking targets only the three native expandable entries', () => {
    const renderer = readSource('src/renderer.js');
    const main = readSource('src/main.js');

    for (const id of [
        'id-func-bar-expression',
        'id-func-bar-screenshot',
        'id-func-bar-folder'
    ]) {
        assert.match(renderer, new RegExp(`['"]${id}['"]`));
    }
    assert.match(main, /preventChatToolbarHoverExpand: false/);
    assert.match(renderer, /禁止输入栏悬停展开/);
    assert.match(renderer, /function handleChatToolbarHover[\s\S]*?\.closest\('\.chat-func-bar'\)/);
    assert.match(renderer, /\['pointerover', 'pointerenter', 'mouseover', 'mouseenter'\]/);
    assert.match(renderer, /document\.addEventListener\(eventName, handleChatToolbarHover, true\)/);
    assert.doesNotMatch(renderer, /addEventListener\('click', handleChatToolbarHover/);
});
