'use strict';

const RepeatRoute = Object.freeze({
    VOICE: 'voice',
    NESTED_FORWARD: 'nested-forward',
    FORWARD_DETAIL_REBUILD: 'forward-detail-rebuild',
    SEND_COPY: 'send-copy',
    NATIVE_FORWARD: 'native-forward'
});

async function mapWithConcurrency(values, limit, mapper) {
    const items = Array.from(values || []);
    if (!items.length) {
        return [];
    }
    const results = new Array(items.length);
    const workerCount = Math.min(items.length, Math.max(1, Math.trunc(Number(limit)) || 1));
    let nextIndex = 0;
    let stopped = false;
    const runWorker = async () => {
        while (!stopped && nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            try {
                results[index] = await mapper(items[index], index);
            } catch (error) {
                stopped = true;
                throw error;
            }
        }
    };
    await Promise.all(Array.from({ length: workerCount }, runWorker));
    return results;
}

function getElements(record) {
    return Array.isArray(record?.elements) ? record.elements : [];
}

function hasVoiceElement(record) {
    return getElements(record).some(element =>
        Number(element?.elementType) === 4 || Boolean(element?.pttElement)
    );
}

function isNestedForwardCard(record) {
    return getElements(record).some(element => Boolean(element?.multiForwardMsgElement));
}

function requiresForwardDetailRebuild(record) {
    return getElements(record).some(element =>
        Number(element?.elementType) === 2 ||
        Number(element?.elementType) === 3 ||
        Boolean(element?.picElement) ||
        Boolean(element?.fileElement)
    );
}

function shouldUseNativeForward(record) {
    const elements = getElements(record);
    const hasMedia = elements.some(element =>
        Number(element?.elementType) === 2 ||
        Number(element?.elementType) === 3 ||
        Number(element?.elementType) === 5 ||
        Boolean(element?.picElement) ||
        Boolean(element?.fileElement) ||
        Boolean(element?.videoElement)
    );
    if (hasMedia) {
        return true;
    }
    const hasMention = elements.some(element =>
        Number(element?.elementType) === 1 && Number(element?.textElement?.atType) > 0
    );
    if (hasMention) {
        return false;
    }
    return elements.some(element =>
        Number(element?.elementType) === 10 ||
        Number(element?.elementType) === 11 ||
        Number(element?.elementType) === 13 ||
        Number(element?.elementType) === 16 ||
        Boolean(element?.marketFaceElement) ||
        Boolean(element?.structMsgElement) ||
        Boolean(element?.structLongMsgElement) ||
        Boolean(element?.multiForwardMsgElement) ||
        Boolean(element?.arkElement)
    );
}

function classifyRepeatRoute(record, fromForwardDetail = false) {
    if (hasVoiceElement(record)) {
        return RepeatRoute.VOICE;
    }
    if (fromForwardDetail && isNestedForwardCard(record)) {
        return RepeatRoute.NESTED_FORWARD;
    }
    if (fromForwardDetail && requiresForwardDetailRebuild(record)) {
        return RepeatRoute.FORWARD_DETAIL_REBUILD;
    }
    return shouldUseNativeForward(record)
        ? RepeatRoute.NATIVE_FORWARD
        : RepeatRoute.SEND_COPY;
}

function createRepeatMessageHandler({
    isEnabled,
    normalizeText,
    resolveSourcePeer,
    resolveDestinationPeer,
    loadSourceRecord,
    repeatVoice,
    repeatNestedForward,
    prepareForwardDetail,
    repeatBySend,
    repeatByNativeForward
}) {
    return async function repeatMessage(browserWindow, payload = {}) {
        if (!isEnabled()) {
            throw new Error('Repeat message is disabled.');
        }
        const sourcePeer = resolveSourcePeer(browserWindow, payload);
        const destinationPeer = resolveDestinationPeer(browserWindow, payload, sourcePeer);
        const msgId = normalizeText(payload.msgId || payload.record?.msgId);
        if (!msgId) {
            throw new Error('The source message has no valid message ID.');
        }

        const rendererRecord = payload.recordSource === 'forward-detail' &&
            Array.isArray(payload.record?.elements)
            ? payload.record
            : null;
        const record = rendererRecord || await loadSourceRecord(browserWindow, sourcePeer, msgId);
        const route = classifyRepeatRoute(record, Boolean(rendererRecord));

        switch (route) {
            case RepeatRoute.VOICE:
                return await repeatVoice(browserWindow, destinationPeer, record);
            case RepeatRoute.NESTED_FORWARD:
                return await repeatNestedForward(
                    browserWindow,
                    destinationPeer,
                    record,
                    payload.forwardContext
                );
            case RepeatRoute.FORWARD_DETAIL_REBUILD: {
                const preparedRecord = await prepareForwardDetail(browserWindow, record);
                return await repeatBySend(browserWindow, destinationPeer, preparedRecord, {
                    confirm: true,
                    detached: true
                });
            }
            case RepeatRoute.NATIVE_FORWARD:
                return await repeatByNativeForward(browserWindow, sourcePeer, destinationPeer, record);
            default:
                return await repeatBySend(browserWindow, destinationPeer, record);
        }
    };
}

module.exports = {
    RepeatRoute,
    classifyRepeatRoute,
    createRepeatMessageHandler,
    hasVoiceElement,
    isNestedForwardCard,
    mapWithConcurrency,
    requiresForwardDetailRebuild,
    shouldUseNativeForward
};
