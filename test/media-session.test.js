'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    createMediaSessionController,
    createMediaTaskRegistry
} = require('../src/media-session');

function createController() {
    let id = 0;
    return createMediaSessionController({
        createId: () => `gallery-${++id}`,
        isSameItem: (left, right) => left?.id === right?.id
    });
}

test('keeps one active media session as the gallery source of truth', () => {
    const controller = createController();
    const source = {};
    const first = controller.begin(source, {
        items: [{ id: 'a' }, { id: 'b' }],
        index: 1
    });

    assert.equal(first.gallery.id, 'gallery-1');
    assert.equal(controller.select(source, first.gallery.id, 0), true);
    assert.equal(controller.getPublicState('transparent').index, 0);
    assert.equal(controller.getSelection(source, first.gallery.id, 0).item.id, 'a');

    const replacement = controller.begin(source, { items: [{ id: 'c' }], index: 0 });
    assert.equal(controller.setViewerItems(first, [{ src: 'stale' }]), false);
    assert.equal(controller.setViewerItems(replacement, []), false);
    assert.equal(controller.setViewerItems(replacement, [{ src: 'current' }]), true);
    assert.deepEqual(controller.getPublicState('black').items, [{ src: 'current' }]);
});

test('stages a forward gallery once and only for its matching native activation', () => {
    const controller = createController();
    const source = {};
    const otherSource = {};
    const gallery = { items: [{ id: 'a' }, { id: 'b' }], index: 1 };

    assert.equal(controller.stageForward(source, gallery), true);
    assert.equal(controller.consumeStagedForward(otherSource, { id: 'b' }), null);
    assert.equal(controller.consumeStagedForward(source, { id: 'a' }), null);
    assert.equal(controller.consumeStagedForward(source, { id: 'b' }), null);

    controller.stageForward(source, gallery);
    assert.deepEqual(controller.consumeStagedForward(source, { id: 'b' }).items, gallery.items);
    assert.equal(controller.consumeStagedForward(source, { id: 'b' }), null);
});

test('keeps media tasks isolated, cancels them by source, and removes settled work', async () => {
    const registry = createMediaTaskRegistry();
    const source = {};
    const rejected = [];
    let resolveRich;
    const rich = {
        promise: new Promise(resolve => {
            resolveRich = resolve;
        })
    };
    const firstFile = { reject: error => rejected.push(error.message) };
    let rejectNextFile;
    const nextFile = {
        promise: new Promise((_resolve, reject) => {
            rejectNextFile = reject;
        }),
        reject: error => rejectNextFile(error)
    };
    const nextFileRejected = assert.rejects(nextFile.promise, /source closed/);

    registry.set(source, 'rich', 'item', rich);
    registry.replaceKind(source, 'file', 'first', firstFile);
    registry.replaceKind(source, 'file', 'next', nextFile, new Error('replaced'));

    assert.equal(registry.get(source, 'rich', 'item'), rich);
    assert.equal(registry.get(source, 'file', 'first'), null);
    assert.equal(registry.get(source, 'file', 'next'), nextFile);
    assert.deepEqual(rejected, ['replaced']);

    resolveRich('rich');
    await rich.promise;
    await Promise.resolve();
    assert.equal(registry.get(source, 'rich', 'item'), null);

    assert.equal(registry.clear(source, new Error('source closed')), 1);
    await nextFileRejected;
    assert.equal(registry.get(source, 'file', 'next'), null);
});
