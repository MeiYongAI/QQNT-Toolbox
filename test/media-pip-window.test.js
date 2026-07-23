'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    PIP_BORDER_SKIP,
    constrainPipResize,
    fitPipBounds,
    getPipOuterSize,
    movePipBounds,
    snapPipBounds
} = require('../src/media-pip-window');

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

test('uses the Telegram 320px default long side and preserves aspect ratio', () => {
    assert.deepEqual(fitPipBounds(null, workArea, 16 / 9), {
        x: PIP_BORDER_SKIP,
        y: PIP_BORDER_SKIP,
        width: 340,
        height: 200
    });
    assert.deepEqual(getPipOuterSize(workArea, 9 / 16, 320), {
        width: 200,
        height: 340
    });
});

test('keeps the Telegram 120px minimum short side', () => {
    assert.deepEqual(getPipOuterSize(workArea, 16 / 9, 1), {
        width: 233,
        height: 140
    });
    assert.deepEqual(getPipOuterSize(workArea, 9 / 16, 1), {
        width: 140,
        height: 233
    });
});

test('constrains native edge resizing to the video aspect ratio', () => {
    assert.deepEqual(constrainPipResize(
        { x: 100, y: 100, width: 340, height: 200 },
        { x: 100, y: 100, width: 500, height: 200 },
        'right',
        workArea,
        16 / 9
    ), {
        x: 100,
        y: 100,
        width: 500,
        height: 290
    });
});

test('keeps the opposite edge anchored while resizing from the left', () => {
    const resized = constrainPipResize(
        { x: 100, y: 100, width: 340, height: 200 },
        { x: 20, y: 100, width: 420, height: 200 },
        'left',
        workArea,
        16 / 9
    );
    assert.equal(resized.x + resized.width, 440);
    assert.equal(resized.width, 420);
    assert.equal(resized.height, 245);
});

test('snaps a dragged PiP window to Telegram-style screen margins', () => {
    assert.deepEqual(snapPipBounds(
        { x: 9, y: 25, width: 340, height: 200 },
        workArea
    ), {
        x: 20,
        y: 20,
        width: 340,
        height: 200
    });
    assert.deepEqual(snapPipBounds(
        { x: 1568, y: 821, width: 340, height: 200 },
        workArea
    ), {
        x: 1560,
        y: 820,
        width: 340,
        height: 200
    });
});

test('moves a PiP window without changing its locked size', () => {
    assert.deepEqual(movePipBounds(
        { x: 920, y: 176, width: 340, height: 200 },
        -275.5,
        180.25
    ), {
        x: 645,
        y: 356,
        width: 340,
        height: 200
    });
});
