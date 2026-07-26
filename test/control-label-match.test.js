'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const moduleSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'control-label-match.js'),
    'utf8'
);
const modulePromise = import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);

test('matches exact control labels and common accessible suffixes', async () => {
    const { matchesControlLabelValue } = await modulePromise;
    assert.equal(matchesControlLabelValue('\u5e2e\u52a9', '\u5e2e\u52a9'), true);
    assert.equal(matchesControlLabelValue('\u5e2e\u52a9 \u6309\u94ae', '\u5e2e\u52a9'), true);
    assert.equal(matchesControlLabelValue('\u68c0\u67e5\u66f4\u65b0\u83dc\u5355\u9879', '\u68c0\u67e5\u66f4\u65b0'), true);
});

test('does not treat conversation content containing a label as the control itself', async () => {
    const { matchesControlLabelValue } = await modulePromise;
    assert.equal(matchesControlLabelValue('\u8fd9\u6761\u6d88\u606f\u9700\u8981\u5e2e\u52a9', '\u5e2e\u52a9'), false);
    assert.equal(matchesControlLabelValue('\u68c0\u67e5\u66f4\u65b0\u540e\u91cd\u542f QQ', '\u68c0\u67e5\u66f4\u65b0'), false);
    assert.equal(matchesControlLabelValue('\u6d88\u606f\u5217\u8868', '\u5e2e\u52a9'), false);
});

test('keeps sidebar labels stable while QQ notification counts change', async () => {
    const { normalizeDynamicControlLabel } = await modulePromise;
    assert.equal(normalizeDynamicControlLabel('\u8054\u7cfb\u4eba 6\u4e2a\u901a\u77e5'), '\u8054\u7cfb\u4eba');
    assert.equal(normalizeDynamicControlLabel('\u8054\u7cfb\u4eba 13\u4e2a\u901a\u77e5'), '\u8054\u7cfb\u4eba');
    assert.equal(normalizeDynamicControlLabel('\u6d88\u606f\uff0899+ \u6761\u672a\u8bfb\u6d88\u606f\uff09'), '\u6d88\u606f');
    assert.equal(normalizeDynamicControlLabel('\u5c0f\u7a0b\u5e8f'), '\u5c0f\u7a0b\u5e8f');
});
