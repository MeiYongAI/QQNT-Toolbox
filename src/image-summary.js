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
        if (!element?.picElement || typeof element.picElement !== 'object') {
            continue;
        }
        element.picElement.summary = summary;
        changed += 1;
    }
    return changed;
}

module.exports = {
    SEND_MESSAGE_COMMAND,
    applyCustomImageSummary
};
