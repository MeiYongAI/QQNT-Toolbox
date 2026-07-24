'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'local-sticker-manager.js'),
    'utf8'
);

test('keeps common sticker management together and advanced download settings available', () => {
    assert.match(source, /\['packs', '贴纸集'\], \['panel', '面板'\], \['telegram', 'Telegram'\]/);
    assert.match(source, /options\.openDirectory/);
    assert.match(source, /options\.chooseDirectory/);
    assert.match(source, /stickersPerRow/);
    assert.match(source, /panelWidth/);
    assert.match(source, /panelHeight/);
    assert.match(source, /sendAsImage/);
    assert.match(source, /recentEnabled/);
    assert.match(source, /recentRows/);
    assert.match(source, /createElement\('details', 'qlsm-advanced'\)/);
    assert.match(source, /addEventListener\('pointermove'/);
    assert.doesNotMatch(source, /draggable\s*=|dragstart/);
    for (const setting of [
        'telegramBotToken',
        'ffmpegPath',
        'tgsToGifPath',
        'httpProxy'
    ]) {
        assert.match(source, new RegExp(setting));
    }
    assert.match(source, /options\.testProxy/);
    assert.match(source, /options\.inspectEnvironment/);
    assert.match(source, /options\.openToolDownload/);
    assert.match(source, /dataset\.downloadTool/);
    assert.match(source, /自动检测 PATH/);
    assert.match(source, /options\.download/);
    assert.match(source, /options\.saveOrder/);
});
