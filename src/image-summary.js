'use strict';

const SEND_MESSAGE_COMMAND = 'nodeIKernelMsgService/sendMsg';

function applyCustomImageSummary(command, config) {
    const summary = config?.customImageSummary;
    if (command?.cmdName !== SEND_MESSAGE_COMMAND ||
        config?.customImageSummaryEnabled !== true ||
        typeof summary !== 'string' || !summary) {
        return 0;
    }

    const request = Array.isArray(command.payload) ? command.payload[0] : null;
    const elements = Array.isArray(request?.msgElements) ? request.msgElements : [];
    let changed = 0;
    for (const element of elements) {
        if (!element || typeof element !== 'object') {
            continue;
        }
        let elementChanged = false;
        if (element.picElement && typeof element.picElement === 'object') {
            element.picElement.summary = summary;
            elementChanged = true;
        }
        const marketFace = element.marketFaceElement && typeof element.marketFaceElement === 'object'
            ? element.marketFaceElement
            : Number(element.elementType) === 11 ? element : null;
        if (marketFace) {
            marketFace.faceName = summary;
            elementChanged = true;
        }
        if (element.faceBubbleElement && typeof element.faceBubbleElement === 'object') {
            element.faceBubbleElement.content = summary;
            elementChanged = true;
        }
        if (element.faceElement && typeof element.faceElement === 'object') {
            element.faceElement.faceText = summary;
            elementChanged = true;
        }
        if (elementChanged) {
            changed += 1;
        }
    }
    return changed;
}

module.exports = {
    SEND_MESSAGE_COMMAND,
    applyCustomImageSummary
};
