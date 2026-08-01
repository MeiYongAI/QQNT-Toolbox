'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { getImmediateRecallImageUrl } = require('./recall-image-url');

function normalizeText(value) {
    const text = String(value ?? '').trim();
    return text && text !== 'undefined' && text !== 'null' && text !== '0' ? text : '';
}

function normalizePathText(value) {
    const text = normalizeText(value);
    return text ? path.normalize(text) : '';
}

function collectNestedValues(values) {
    const candidates = [];
    const queue = [...values];
    const seen = new WeakSet();
    while (queue.length) {
        const value = queue.shift();
        if (typeof value === 'string') {
            candidates.push(value);
            continue;
        }
        if (ArrayBuffer.isView(value)) {
            continue;
        }
        if (value && typeof value === 'object') {
            if (seen.has(value)) {
                continue;
            }
            seen.add(value);
        }
        if (Array.isArray(value)) {
            queue.push(...value);
        } else if (value instanceof Map) {
            queue.push(...value.values());
        } else if (value && typeof value === 'object') {
            queue.push(...Object.values(value));
        }
    }
    return candidates;
}

function getViewerFileUrl(...values) {
    for (const candidate of collectNestedValues(values)) {
        if (/^https?:\/\//i.test(candidate)) {
            continue;
        }
        const filePath = normalizePathText(candidate);
        try {
            if (filePath && fs.statSync(filePath).isFile()) {
                return pathToFileURL(filePath).href;
            }
        } catch {
        }
    }
    return '';
}

function getViewerRemoteUrl(...values) {
    return collectNestedValues(values).find(value => /^https?:\/\//i.test(value)) || '';
}

function getRecordElements(record) {
    return Array.isArray(record?.elements) ? record.elements : [];
}

function getMessageContentText(value) {
    if (value === undefined || value === null) {
        return '';
    }
    const content = String(value);
    return content === 'undefined' || content === 'null' ? '' : content;
}

function getQqNumber(...values) {
    for (const value of values) {
        const number = normalizeText(value);
        if (/^[1-9]\d+$/.test(number)) {
            return number;
        }
    }
    return '';
}

function getUserAvatarUrl(...values) {
    const uin = getQqNumber(...values);
    return uin ? `https://q.qlogo.cn/headimg_dl?dst_uin=${uin}&spec=100` : '';
}

function getRecallDisplayName(record) {
    const mark = record?.qqnt_toolbox_recall || {};
    return normalizeText(mark.origMsgSenderRemark) ||
        normalizeText(mark.origMsgSenderMemRemark) ||
        normalizeText(mark.origMsgSenderNick) ||
        normalizeText(record?.sendRemarkName) ||
        normalizeText(record?.sendMemberName) ||
        normalizeText(record?.sendNickName) ||
        normalizeText(record?.senderNick) ||
        normalizeText(record?.senderUid) ||
        normalizeText(record?.senderUin) ||
        '未知发送者';
}

function getRecallOperatorName(record) {
    const mark = record?.qqnt_toolbox_recall || {};
    return normalizeText(mark.operatorRemark) ||
        normalizeText(mark.operatorMemRemark) ||
        normalizeText(mark.operatorNick) ||
        '未知用户';
}

function getRecallPeerName(record) {
    const chatType = Number(record?.chatType);
    if (chatType === 2) {
        return normalizeText(record?.peerName) || normalizeText(record?.peerUin) ||
            normalizeText(record?.peerUid) || '未知群聊';
    }
    return normalizeText(record?.peerName) ||
        normalizeText(record?.sendRemarkName) ||
        normalizeText(record?.sendNickName) ||
        normalizeText(record?.peerUin) ||
        normalizeText(record?.peerUid) ||
        '未知会话';
}

function getRecallPeerAvatarUrl(record) {
    const peerUin = getQqNumber(record?.peerUin, record?.peer?.peerUin, record?.peerUid);
    if (!peerUin) {
        return '';
    }
    if (Number(record?.chatType) === 2) {
        return `https://p.qlogo.cn/gh/${peerUin}/${peerUin}/100/`;
    }
    return getUserAvatarUrl(peerUin);
}

function getReplyPreview(reply) {
    const direct = getMessageContentText(reply?.sourceMsgText);
    if (direct.trim()) {
        return direct;
    }
    return (Array.isArray(reply?.sourceMsgTextElems) ? reply.sourceMsgTextElems : [])
        .map(item => getMessageContentText(item?.textElemContent) || (item?.picElem ? '[图片]' : ''))
        .filter(Boolean)
        .join(' ');
}

function getArkViewerCard(arkElement) {
    let data = {};
    try {
        data = JSON.parse(normalizeText(arkElement?.bytesData));
    } catch {
    }
    const metadata = data?.meta && typeof data.meta === 'object'
        ? Object.values(data.meta).find(value => value && typeof value === 'object') || {}
        : {};
    return {
        type: 'card',
        title: normalizeText(metadata.title) || normalizeText(data.prompt) ||
            normalizeText(arkElement?.prompt) || '卡片消息',
        subtitle: normalizeText(metadata.desc) || normalizeText(data.desc) ||
            normalizeText(arkElement?.appName) || normalizeText(arkElement?.appView),
        image: getViewerRemoteUrl(metadata.preview, metadata.icon)
    };
}

function getRecallViewerContent(record) {
    const parts = [];
    for (const [elementIndex, element] of getRecordElements(record).entries()) {
        const textContent = getMessageContentText(element?.textElement?.content);
        if (textContent) {
            const atType = Number(element?.textElement?.atType) || 0;
            parts.push({
                type: atType ? 'mention' : 'text',
                text: textContent,
                atType,
                atUid: normalizeText(element.textElement.atUid),
                atNtUid: normalizeText(element.textElement.atNtUid)
            });
            continue;
        }
        if (element?.picElement) {
            const localUrl = getViewerFileUrl(
                element.picElement.sourcePath,
                element.picElement.filePath,
                element.picElement.originPath,
                element.picElement.localPath,
                element.picElement.path,
                element.picElement.thumbPath
            );
            parts.push({
                type: 'image',
                src: localUrl || getImmediateRecallImageUrl(element.picElement),
                name: normalizeText(element.picElement.summary) ||
                    normalizeText(element.picElement.fileName) || '图片',
                width: Number(element.picElement.picWidth) || 0,
                height: Number(element.picElement.picHeight) || 0
            });
            continue;
        }
        if (element?.pttElement) {
            parts.push({
                type: 'voice',
                elementIndex,
                name: normalizeText(element.pttElement.fileName) || '语音消息',
                duration: Number(element.pttElement.duration) || 0,
                transcript: getMessageContentText(element.pttElement.text),
                waves: (Array.isArray(element.pttElement.waveAmplitudes)
                    ? element.pttElement.waveAmplitudes
                    : [])
                    .slice(0, 36)
                    .map(value => Math.abs(Number(value) || 0))
            });
            continue;
        }
        if (element?.fileElement) {
            parts.push({
                type: 'file',
                elementIndex,
                name: normalizeText(element.fileElement.fileName) || '文件',
                size: Number(element.fileElement.fileSize) || 0,
                path: getViewerFileUrl(element.fileElement.filePath, element.fileElement.sourcePath)
            });
            continue;
        }
        if (element?.videoElement) {
            parts.push({
                type: 'video',
                name: normalizeText(element.videoElement.fileName) || '视频',
                size: Number(element.videoElement.fileSize) || 0,
                duration: Number(element.videoElement.duration || element.videoElement.fileTime) || 0,
                width: Number(element.videoElement.thumbWidth) || 0,
                height: Number(element.videoElement.thumbHeight) || 0,
                src: getViewerFileUrl(element.videoElement.filePath, element.videoElement.sourcePath),
                poster: getViewerFileUrl(element.videoElement.thumbPath, element.videoElement.coverPath)
            });
            continue;
        }
        if (element?.replyElement) {
            parts.push({
                type: 'reply',
                text: getReplyPreview(element.replyElement) || '[消息]',
                sender: normalizeText(element.replyElement.senderUid) ||
                    normalizeText(element.replyElement.anonymousNickName)
            });
            continue;
        }
        if (element?.marketFaceElement) {
            parts.push({
                type: 'face',
                name: normalizeText(element.marketFaceElement.faceName) || '表情',
                src: getViewerFileUrl(
                    element.marketFaceElement.staticFacePath,
                    element.marketFaceElement.dynamicFacePath
                ) || getViewerRemoteUrl(element.marketFaceElement)
            });
            continue;
        }
        if (element?.faceElement) {
            parts.push({
                type: 'face',
                name: normalizeText(element.faceElement.faceName) ||
                    normalizeText(element.faceElement.faceText) || 'QQ 表情',
                src: ''
            });
            continue;
        }
        if (element?.arkElement) {
            parts.push(getArkViewerCard(element.arkElement));
            continue;
        }
        if (element?.markdownElement) {
            const flash = element.markdownElement.mdExtInfo?.flashTransferInfo;
            parts.push({
                type: 'card',
                title: normalizeText(flash?.name) ||
                    normalizeText(element.markdownElement.mdSummary) || 'Markdown 消息',
                subtitle: flash?.fileSize ? `${Number(flash.fileSize) || 0}` : '',
                image: getViewerRemoteUrl(flash?.thnumbnail, flash?.thumbnail)
            });
            continue;
        }
        if (element?.multiForwardMsgElement) {
            parts.push({
                type: 'forward',
                xml: normalizeText(element.multiForwardMsgElement.xmlContent),
                name: normalizeText(element.multiForwardMsgElement.fileName)
            });
            continue;
        }
        if (element?.grayTipElement) {
            parts.push({
                type: 'notice',
                text: getMessageContentText(element.grayTipElement.content) || '系统消息'
            });
            continue;
        }
        parts.push({
            type: 'unsupported',
            text: `暂不支持的消息类型 (${Number(element?.elementType) || 0})`
        });
    }
    return { parts };
}

function buildRecallViewerData(records) {
    const chats = new Map();
    for (const record of Array.isArray(records) ? records : []) {
        const peerUid = normalizeText(record?.peerUid || record?.peer?.peerUid);
        if (!peerUid) {
            continue;
        }
        const chatType = Number(record?.chatType) || 0;
        const key = `${chatType}:${peerUid}`;
        const mark = record?.qqnt_toolbox_recall || {};
        const message = {
            msgId: normalizeText(record?.msgId),
            peerUid,
            peerUin: normalizeText(record?.peerUin),
            chatType,
            sender: getRecallDisplayName(record),
            senderUin: getQqNumber(record?.senderUin),
            senderUid: normalizeText(record?.senderUid),
            avatarUrl: getUserAvatarUrl(record?.senderUin),
            operator: getRecallOperatorName(record),
            msgTime: Number(record?.msgTime) || 0,
            recallTime: Number(mark.recallTime || record?.recallTime) || 0,
            ...getRecallViewerContent(record)
        };
        let chat = chats.get(key);
        if (!chat) {
            chat = {
                key,
                peerUid,
                peerUin: message.peerUin,
                peerName: getRecallPeerName(record),
                avatarUrl: getRecallPeerAvatarUrl(record),
                chatType,
                latestTime: 0,
                messages: []
            };
            chats.set(key, chat);
        }
        chat.latestTime = Math.max(chat.latestTime, message.recallTime || message.msgTime);
        chat.messages.push(message);
    }
    for (const chat of chats.values()) {
        chat.messages.sort((left, right) =>
            (right.recallTime || right.msgTime) - (left.recallTime || left.msgTime)
        );
    }
    return Array.from(chats.values()).sort((left, right) => right.latestTime - left.latestTime);
}

module.exports = {
    buildRecallViewerData,
    getRecallViewerContent,
    getViewerFileUrl,
    getViewerRemoteUrl
};
