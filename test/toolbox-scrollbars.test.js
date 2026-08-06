'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const readSource = relativePath => fs.readFileSync(
    path.join(__dirname, '..', relativePath),
    'utf8'
);

const sharedStyle = readSource('src/toolbox-scrollbars.css');
const sharedController = readSource('src/toolbox-scrollbars.js');

test('uses one overlay scrollbar without adding a native scrollbar gutter', () => {
    assert.match(sharedStyle, /scrollbar-gutter:\s*auto\s*!important/);
    assert.doesNotMatch(sharedStyle, /scrollbar-gutter:\s*stable|both-edges/);
    assert.match(sharedStyle, /scrollbar-width:\s*none\s*!important/);
    assert.match(sharedStyle, /\.qqnt-toolbox-scrollable::\-webkit-scrollbar\s*\{[\s\S]*?display:\s*none\s*!important[\s\S]*?width:\s*0\s*!important/);
    assert.match(sharedStyle, /\.qqnt-toolbox-scrollbar-overlay\.v-scrollbar-track\s*\{[\s\S]*?position:\s*fixed\s*!important/);
    assert.match(sharedStyle, /\.qqnt-toolbox-scrollbar-thumb\.v-scrollbar-thumb/);
    assert.match(sharedStyle, /--icon_secondary/);
    assert.match(sharedStyle, /prefers-reduced-motion:\s*reduce/);
});

test('shares one proportional draggable scrollbar controller across windows', () => {
    assert.match(sharedController, /const OVERLAY_ID = 'qqnt-toolbox-scrollbar-overlay'/);
    assert.match(sharedController, /document\.getElementById\(OVERLAY_ID\)/);
    assert.match(sharedController, /trackHeight \* element\.clientHeight \/ element\.scrollHeight/);
    assert.match(sharedController, /travel \* element\.scrollTop \/ maxScroll/);
    assert.match(sharedController, /overlay\.setPointerCapture\?\.\(event\.pointerId\)/);
    assert.match(sharedController, /current\.scrollTop = metrics\.maxScroll \* desiredTop \/ metrics\.travel/);
    assert.match(sharedController, /findScrollable\(event, view\)/);
    assert.match(sharedController, /className = 'qqnt-toolbox-scrollbar-overlay v-scrollbar-track'/);
});

test('marks every Toolbox-owned vertical scroll surface with the shared class', () => {
    const expectations = [
        ['src/renderer.js', /qqnt-toolbox-body qqnt-toolbox-scrollable/],
        ['src/auto-reaction-editor.js', /qqnt-toolbox-auto-reaction-grid qqnt-toolbox-scrollable/],
        ['src/recall-filter-editor.js', /qqnt-toolbox-recall-filter-list qqnt-toolbox-scrollable/],
        ['src/context-menu-order.js', /qqnt-toolbox-menu-order-list qqnt-toolbox-scrollable/],
        ['src/qr-result-dialog.js', /qr-result-body qqnt-toolbox-scrollable/],
        ['src/local-sticker-panel.js', /qls-content qqnt-toolbox-scrollable/],
        ['src/local-sticker-manager.js', /qlsm-pack-list qqnt-toolbox-scrollable/],
        ['src/local-sticker-manager.js', /qlsm-form qlsm-panel-form qqnt-toolbox-scrollable/],
        ['src/local-sticker-manager.js', /qlsm-form qqnt-toolbox-scrollable/],
        ['src/message-image-manager.js', /qmim-category-list qqnt-toolbox-scrollable/],
        ['src/message-image-manager.js', /qmim-category-menu qqnt-toolbox-scrollable/],
        ['src/message-image-manager.js', /qmim-grid qqnt-toolbox-scrollable/],
        ['src/fake-forward-editor.js', /qff-body qqnt-toolbox-scrollable/],
        ['src/fake-forward-editor.js', /qff-list qqnt-toolbox-scrollable/],
        ['src/fake-forward-editor.js', /qff-form qqnt-toolbox-scrollable/],
        ['src/fake-forward-editor.js', /qff-composer qqnt-toolbox-scrollable/],
        ['src/voice/library-panel.js', /qvlib-list qqnt-toolbox-scrollable/]
    ];
    for (const [file, pattern] of expectations) {
        assert.match(readSource(file), pattern, file);
    }
});

test('does not keep per-window vertical scrollbar implementations', () => {
    for (const file of [
        'src/renderer.js',
        'src/auto-reaction-editor.js',
        'src/context-menu-order.js',
        'src/fake-forward-editor.css',
        'src/local-sticker-manager.css',
        'src/message-image-manager.css',
        'src/qr-result-dialog.js',
        'src/recall-filter-editor.js',
        'src/recall-viewer.html',
        'src/voice/panel-style.js'
    ]) {
        assert.doesNotMatch(readSource(file), /scrollbar-width:|::\-webkit-scrollbar/, file);
    }
});

test('does not reserve a permanent scrollbar gutter in component styles', () => {
    for (const file of [
        'src/auto-reaction-editor.js',
        'src/context-menu-order.js',
        'src/fake-forward-editor.css',
        'src/local-sticker-manager.css',
        'src/message-image-manager.css',
        'src/recall-filter-editor.js'
    ]) {
        assert.doesNotMatch(readSource(file), /scrollbar-gutter:\s*(?:stable|both-edges)/, file);
    }
});

test('loads the shared treatment inside the standalone recall viewer', () => {
    const viewer = readSource('src/recall-viewer.html');
    assert.match(viewer, /href="\.\/toolbox-scrollbars\.css"/);
    assert.match(viewer, /type="module" src="\.\/toolbox-scrollbars\.js"/);
    assert.match(viewer, /chat-list qqnt-toolbox-scrollable/);
    assert.match(viewer, /messages qqnt-toolbox-scrollable/);
    assert.match(readSource('src/renderer.js'), /import '\.\/toolbox-scrollbars\.js';/);
});
