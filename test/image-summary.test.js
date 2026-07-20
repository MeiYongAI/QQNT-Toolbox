'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { applyCustomImageSummary } = require('../src/image-summary');

function createSendCommand(msgElements) {
    return {
        cmdName: 'nodeIKernelMsgService/sendMsg',
        payload: [{ msgElements }, null]
    };
}

test('leaves image summaries unchanged when disabled or empty', () => {
    const disabled = createSendCommand([{ picElement: { summary: '[图片]' } }]);
    const empty = createSendCommand([{ picElement: { summary: '[图片]' } }]);

    assert.equal(applyCustomImageSummary(disabled, {
        customImageSummaryEnabled: false,
        customImageSummary: '[自定义图片]'
    }), 0);
    assert.equal(applyCustomImageSummary(empty, {
        customImageSummaryEnabled: true,
        customImageSummary: ''
    }), 0);
    assert.equal(disabled.payload[0].msgElements[0].picElement.summary, '[图片]');
    assert.equal(empty.payload[0].msgElements[0].picElement.summary, '[图片]');
});

test('changes only top-level picture elements in mixed messages', () => {
    const nestedPicture = { picElement: { summary: '[嵌套图片]' } };
    const textElement = { textElement: { content: '正文' } };
    const firstPicture = { elementType: 2, picElement: { summary: '[图片]' } };
    const secondPicture = { elementType: 2, picElement: {} };
    const command = createSendCommand([
        textElement,
        firstPicture,
        { elementType: 10, arkElement: { elements: [nestedPicture] } },
        secondPicture
    ]);

    assert.equal(applyCustomImageSummary(command, {
        customImageSummaryEnabled: true,
        customImageSummary: '[猫猫图]'
    }), 2);
    assert.equal(firstPicture.picElement.summary, '[猫猫图]');
    assert.equal(secondPicture.picElement.summary, '[猫猫图]');
    assert.equal(nestedPicture.picElement.summary, '[嵌套图片]');
    assert.deepEqual(textElement, { textElement: { content: '正文' } });
});

test('ignores unrelated native commands and malformed payloads', () => {
    const picture = { picElement: { summary: '[图片]' } };
    const config = {
        customImageSummaryEnabled: true,
        customImageSummary: '[自定义图片]'
    };

    assert.equal(applyCustomImageSummary({
        cmdName: 'nodeIKernelMsgService/forwardMsg',
        payload: [{ msgElements: [picture] }, null]
    }, config), 0);
    assert.equal(applyCustomImageSummary({
        cmdName: 'nodeIKernelMsgService/sendMsg',
        payload: null
    }, config), 0);
    assert.equal(picture.picElement.summary, '[图片]');
});
