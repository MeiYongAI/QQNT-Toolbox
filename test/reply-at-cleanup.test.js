'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const moduleSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'reply-at-cleanup.js'),
    'utf8'
);
const rendererSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer.js'),
    'utf8'
);
const modulePromise = import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);

test('allows cleanup only once for each reply element', async () => {
    const { createReplyAtCleanupTracker } = await modulePromise;
    const tracker = createReplyAtCleanupTracker();
    const editor = {};
    const firstReply = {};
    const secondReply = {};

    assert.equal(tracker.shouldCleanup(editor, null, true), false);
    assert.equal(tracker.shouldCleanup(editor, firstReply, true), true);
    assert.equal(tracker.shouldCleanup(editor, firstReply, true), false);
    assert.equal(tracker.shouldCleanup(editor, secondReply, true), true);
    assert.equal(tracker.shouldCleanup(editor, secondReply, true), false);
    assert.equal(tracker.shouldCleanup(editor, null, true), false);
    assert.equal(tracker.shouldCleanup(editor, firstReply, true), true);
});

test('tracks replies while disabled so enabling cannot remove a later manual mention', async () => {
    const { createReplyAtCleanupTracker } = await modulePromise;
    const tracker = createReplyAtCleanupTracker();
    const editor = {};
    const reply = {};

    assert.equal(tracker.shouldCleanup(editor, reply, false), false);
    assert.equal(tracker.shouldCleanup(editor, reply, true), false);
});

test('keeps cleanup state isolated when QQ replaces the editor', async () => {
    const { createReplyAtCleanupTracker } = await modulePromise;
    const tracker = createReplyAtCleanupTracker();
    const firstEditor = {};
    const secondEditor = {};
    const firstReply = {};
    const secondReply = {};

    assert.equal(tracker.shouldCleanup(firstEditor, firstReply, true), true);
    assert.equal(tracker.shouldCleanup(secondEditor, secondReply, true), true);
    assert.equal(tracker.shouldCleanup(firstEditor, firstReply, true), false);
    assert.equal(tracker.shouldCleanup(secondEditor, secondReply, true), false);
});

test('renderer gates reply mention cleanup by reply element identity', () => {
    assert.match(rendererSource, /createReplyAtCleanupTracker\(\)/);
    assert.match(rendererSource, /replyAtCleanupTracker\.shouldCleanup\([\s\S]*?replyElement/);
    assert.match(rendererSource, /doc\?\.getRoot\?\.\(\)/);
    assert.match(rendererSource, /child\.is\?\.\('element', 'msg-reply'\)/);
});
