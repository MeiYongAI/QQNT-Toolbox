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
        'src/message-context-menu-order.js',
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
});
