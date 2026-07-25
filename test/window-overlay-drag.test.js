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

test('close-button dialogs ignore backdrop clicks and support Escape', () => {
    const modalSources = [
        readSource('src/fake-forward-editor.js'),
        readSource('src/local-sticker-manager.js'),
        readSource('src/message-context-menu-order.js'),
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
