'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { applyCustomImageSummary } = require('../src/image-summary');

function createSendCommand(msgElements, chatType = 2) {
    return {
        cmdName: 'nodeIKernelMsgService/sendMsg',
        payload: [{ peer: { chatType }, msgElements }, null]
    };
}

test('leaves image summaries unchanged when disabled or empty', () => {
    const disabled = createSendCommand([{ picElement: { summary: '[图片]' } }]);
    const empty = createSendCommand([{ picElement: { summary: '[图片]' } }]);
    const disabledFace = createSendCommand([{ marketFaceElement: { faceName: '[表情]' } }]);

    assert.equal(applyCustomImageSummary(disabled, {
        customImageSummaryEnabled: false,
        customImageSummary: '[自定义图片]'
    }), 0);
    assert.equal(applyCustomImageSummary(empty, {
        customImageSummaryEnabled: true,
        customImageSummary: ''
    }), 0);
    assert.equal(applyCustomImageSummary(disabledFace, {
        customImageSummaryEnabled: false,
        customImageSummary: '[自定义图片]'
    }), 0);
    assert.equal(disabled.payload[0].msgElements[0].picElement.summary, '[图片]');
    assert.equal(empty.payload[0].msgElements[0].picElement.summary, '[图片]');
    assert.equal(disabledFace.payload[0].msgElements[0].marketFaceElement.faceName, '[表情]');
});

test('changes all top-level image and face summaries in mixed messages', () => {
    const nestedPicture = { picElement: { summary: '[嵌套图片]' } };
    const textElement = { textElement: { content: '正文' } };
    const firstPicture = { elementType: 2, picElement: { summary: '[图片]', picSubType: 0 } };
    const animatedPicture = { elementType: 2, picElement: { summary: '[动画图片]', picSubType: 1 } };
    const marketFace = { elementType: 11, marketFaceElement: { faceName: '[动画表情]' } };
    const flattenedMarketFace = { elementType: 11, faceName: '[商城表情]' };
    const faceBubble = { faceBubbleElement: { content: '[平底锅]' } };
    const face = { faceElement: { faceText: '[微笑]' } };
    const command = createSendCommand([
        textElement,
        firstPicture,
        { elementType: 10, arkElement: { elements: [nestedPicture] } },
        animatedPicture,
        marketFace,
        flattenedMarketFace,
        faceBubble,
        face
    ]);

    assert.equal(applyCustomImageSummary(command, {
        customImageSummaryEnabled: true,
        customImageSummary: '[猫猫图]'
    }), 6);
    assert.equal(firstPicture.picElement.summary, '[猫猫图]');
    assert.equal(firstPicture.picElement.picSubType, 0);
    assert.equal(animatedPicture.picElement.summary, '[猫猫图]');
    assert.equal(animatedPicture.picElement.picSubType, 1);
    assert.equal(marketFace.marketFaceElement.faceName, '[猫猫图]');
    assert.equal(flattenedMarketFace.faceName, '[猫猫图]');
    assert.equal(faceBubble.faceBubbleElement.content, '[猫猫图]');
    assert.equal(face.faceElement.faceText, '[猫猫图]');
    assert.equal(nestedPicture.picElement.summary, '[嵌套图片]');
    assert.deepEqual(textElement, { textElement: { content: '正文' } });
});

test('keeps picture subtypes unchanged in every chat type', () => {
    for (const chatType of [1, 2, 4]) {
        const picture = { picElement: { summary: '[图片]', picSubType: 4 } };
        const command = createSendCommand([picture], chatType);

        assert.equal(applyCustomImageSummary(command, {
            customImageSummaryEnabled: true,
            customImageSummary: '[自定义图片]'
        }), 1);
        assert.equal(picture.picElement.summary, '[自定义图片]');
        assert.equal(picture.picElement.picSubType, 4);
    }
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
