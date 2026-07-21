'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    PRESERVE_KIND,
    createFileRetryPlan,
    getRepairKinds,
    isPreservedElement
} = require('../src/file-retry');

const image = { elementType: 2, picElement: { sourcePath: 'C:\\image.png' } };
const describeRepair = element => element.picElement
    ? { kind: 'image', element, sourcePath: element.picElement.sourcePath }
    : null;
const config = { image: true, archivePassword: '' };

test('preserves text around a repaired image in its original order', () => {
    const before = { elementType: 1, elementId: 'old-1', textElement: { content: 'before' } };
    const after = { elementType: 1, elementId: 'old-2', textElement: { content: 'after' } };
    const plan = createFileRetryPlan(
        [before, image, after],
        describeRepair,
        () => false,
        config
    );

    assert.deepEqual(plan.map(item => item.kind), [PRESERVE_KIND, 'image', PRESERVE_KIND]);
    assert.equal(plan[0].element, before);
    assert.equal(plan[2].element, after);
    assert.deepEqual(getRepairKinds(plan), ['image']);
});

test('recognizes mention text and reply elements as safe companions', () => {
    assert.equal(isPreservedElement({ textElement: { atType: 2 } }), true);
    assert.equal(isPreservedElement({ elementType: 7, replyElement: { replayMsgId: '1' } }), true);
});

test('does not retry pure text or an unknown mixed element', () => {
    const text = { elementType: 1, textElement: { content: 'text' } };
    const unknown = { elementType: 16, multiForwardMsgElement: {} };

    assert.equal(createFileRetryPlan([text], describeRepair, () => false, config), null);
    assert.equal(createFileRetryPlan([unknown, image], describeRepair, () => false, config), null);
});

test('still honors generated-path and feature configuration guards', () => {
    assert.equal(createFileRetryPlan([image], describeRepair, () => true, config), null);
    assert.equal(createFileRetryPlan(
        [image],
        describeRepair,
        () => false,
        { ...config, image: false }
    ), null);
});
