'use strict';

const crypto = require('crypto');
const { gunzipSync, gzipSync } = require('zlib');

const MAX_FAKE_FORWARD_MESSAGES = 100;
const MAX_FAKE_FORWARD_TEXT_LENGTH = 10000;
const MAX_FAKE_FORWARD_IMAGES_PER_MESSAGE = 20;
const MIN_MESSAGE_TIME_SECONDS = 946684800;
const MAX_MESSAGE_TIME_SECONDS = 4133980800;
const MAX_UIN = 0xffffffffn;
const SUPPORTED_CHAT_TYPES = new Set([1, 2]);
const FAKE_FORWARD_UPLOAD_COMMAND = 'trpc.group.long_msg_interface.MsgService.SsoSendLongMsg';
const FAKE_FORWARD_SEND_COMMAND = 'MessageSvc.PbSendMsg';

let protocolPromise;

function normalizeText(value) {
    return String(value ?? '').trim();
}

function normalizeUin(value) {
    const uin = normalizeText(value);
    if (!/^\d{5,10}$/.test(uin)) {
        return '';
    }
    const numeric = BigInt(uin);
    return numeric > 0n && numeric <= MAX_UIN ? uin : '';
}

function normalizePeer(value) {
    const chatType = Number(value?.chatType);
    const peerUid = normalizeText(value?.peerUid);
    if (!SUPPORTED_CHAT_TYPES.has(chatType) || !peerUid) {
        throw new TypeError('当前会话不支持伪造合并转发。');
    }
    if (chatType === 2 && !normalizeUin(peerUid)) {
        throw new TypeError('无法获取当前群号。');
    }
    return {
        chatType,
        peerUid,
        peerUin: normalizeUin(value?.peerUin),
        guildId: normalizeText(value?.guildId)
    };
}

function buildFakeForwardImageUploadParams(peer, filePath) {
    const normalizedPeer = normalizePeer(peer);
    const normalizedPath = normalizeText(filePath);
    if (!normalizedPath) {
        throw new TypeError('Image path is required.');
    }
    return {
        filePath: normalizedPath,
        bizType: normalizedPeer.chatType === 2 ? 4 : 3,
        peerUid: normalizedPeer.peerUid,
        useNTV2: true
    };
}

function normalizeMessageTime(value, now = Date.now()) {
    const numeric = Number(value);
    const milliseconds = Number.isFinite(numeric) && numeric > 0 ? numeric : now;
    const seconds = Math.trunc(milliseconds > 100000000000 ? milliseconds / 1000 : milliseconds);
    return Math.min(Math.max(seconds, MIN_MESSAGE_TIME_SECONDS), MAX_MESSAGE_TIME_SECONDS);
}

function normalizeFakeForwardImage(image, messageIndex, imageIndex) {
    if (!image?.msgInfo || typeof image.msgInfo !== 'object') {
        throw new TypeError(`第 ${messageIndex + 1} 条消息的第 ${imageIndex + 1} 张图片尚未上传。`);
    }
    return {
        type: 'image',
        name: normalizeText(image.name) || `图片 ${imageIndex + 1}`,
        msgInfo: image.msgInfo
    };
}

function normalizeFakeForwardSegments(source, messageIndex) {
    const rawSegments = Array.isArray(source?.segments)
        ? source.segments
        : [
            ...(String(source?.content ?? '') ? [{ type: 'text', text: String(source.content) }] : []),
            ...(Array.isArray(source?.images)
                ? source.images.map(image => ({ type: 'image', ...image }))
                : [])
        ];
    const segments = [];
    let imageCount = 0;
    let textLength = 0;
    for (const segment of rawSegments) {
        if (segment?.type === 'text') {
            const text = String(segment.text ?? '');
            if (!text) {
                continue;
            }
            textLength += text.length;
            const previous = segments.at(-1);
            if (previous?.type === 'text') {
                previous.text += text;
            } else {
                segments.push({ type: 'text', text });
            }
            continue;
        }
        if (segment?.type === 'image') {
            imageCount += 1;
            if (imageCount > MAX_FAKE_FORWARD_IMAGES_PER_MESSAGE) {
                throw new RangeError(
                    `第 ${messageIndex + 1} 条消息最多包含 ${MAX_FAKE_FORWARD_IMAGES_PER_MESSAGE} 张图片。`
                );
            }
            segments.push(normalizeFakeForwardImage(segment, messageIndex, imageCount - 1));
            continue;
        }
        throw new TypeError(`第 ${messageIndex + 1} 条消息包含不支持的内容。`);
    }
    if (textLength > MAX_FAKE_FORWARD_TEXT_LENGTH) {
        throw new RangeError(`第 ${messageIndex + 1} 条消息超过 ${MAX_FAKE_FORWARD_TEXT_LENGTH} 个字符。`);
    }
    return segments;
}

function normalizeFakeForwardMessages(messages, options = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
        throw new TypeError('至少需要一条消息。');
    }
    if (messages.length > MAX_FAKE_FORWARD_MESSAGES) {
        throw new RangeError(`一次最多生成 ${MAX_FAKE_FORWARD_MESSAGES} 条消息。`);
    }
    const now = Number(options.now) || Date.now();
    return messages.map((source, index) => {
        const senderUin = normalizeUin(source?.senderUin);
        const segments = normalizeFakeForwardSegments(source, index);
        const content = segments.filter(segment => segment.type === 'text').map(segment => segment.text).join('');
        const images = segments.filter(segment => segment.type === 'image').map(segment => ({
            name: segment.name,
            msgInfo: segment.msgInfo
        }));
        if (!senderUin) {
            throw new TypeError(`第 ${index + 1} 条消息的发送者 QQ 号无效。`);
        }
        if (!content.trim() && !images.length) {
            throw new TypeError(`第 ${index + 1} 条消息没有内容。`);
        }
        return {
            senderUin,
            senderName: normalizeText(source?.senderName) || senderUin,
            content,
            images,
            segments,
            timestamp: normalizeMessageTime(source?.timestamp, now + index * 1000)
        };
    });
}

async function getProtocol() {
    protocolPromise ||= import('@saltify/typeproto').then(({ ProtoField, ProtoMessage }) => {
        const TextElement = ProtoMessage.of({
            str: ProtoField(1, 'string')
        });
        const MediaFileInfo = ProtoMessage.of({
            fileSize: ProtoField(1, 'uint32'),
            md5HexStr: ProtoField(2, 'string'),
            sha1HexStr: ProtoField(3, 'string'),
            fileName: ProtoField(4, 'string'),
            fileType: ProtoField(5, {
                type: ProtoField(1, 'uint32'),
                picFormat: ProtoField(2, 'uint32')
            }),
            width: ProtoField(6, 'uint32'),
            height: ProtoField(7, 'uint32'),
            time: ProtoField(8, 'uint32'),
            original: ProtoField(9, 'uint32')
        });
        const MediaIndexNode = ProtoMessage.of({
            info: ProtoField(1, MediaFileInfo),
            fileUuid: ProtoField(2, 'string'),
            storeID: ProtoField(3, 'uint32'),
            uploadTime: ProtoField(4, 'uint32'),
            expire: ProtoField(5, 'uint32'),
            type: ProtoField(6, 'uint32')
        });
        const MediaExtBizInfo = ProtoMessage.of({
            pic: ProtoField(1, {
                bizType: ProtoField(1, 'uint32'),
                summary: ProtoField(2, 'string'),
                bytesPbReserveC2c: ProtoField(11, 'bytes', 'optional'),
                fromScene: ProtoField(1001, 'uint32'),
                toScene: ProtoField(1002, 'uint32'),
                oldFileId: ProtoField(1003, 'uint32')
            }),
            busiType: ProtoField(10, 'uint32')
        });
        const MediaMsgInfo = ProtoMessage.of({
            msgInfoBody: ProtoField(1, {
                index: ProtoField(1, MediaIndexNode),
                pic: ProtoField(2, {
                    urlPath: ProtoField(1, 'string'),
                    ext: ProtoField(2, {
                        originalParam: ProtoField(1, 'string'),
                        bigParam: ProtoField(2, 'string'),
                        thumbParam: ProtoField(3, 'string')
                    }),
                    domain: ProtoField(3, 'string')
                }, 'optional'),
                fileExist: ProtoField(5, 'bool'),
                hashSum: ProtoField(6, {
                    bytesPbReserveC2c: ProtoField(201, {
                        friendUid: ProtoField(2, 'string')
                    }, 'optional'),
                    troopSource: ProtoField(202, {
                        groupCode: ProtoField(1, 'uint32')
                    }, 'optional')
                })
            }, 'repeated'),
            extBizInfo: ProtoField(2, MediaExtBizInfo)
        });
        const Element = ProtoMessage.of({
            text: ProtoField(1, TextElement, 'optional'),
            commonElem: ProtoField(53, {
                serviceType: ProtoField(1, 'uint32'),
                pbElem: ProtoField(2, 'bytes'),
                businessType: ProtoField(3, 'uint32')
            }, 'optional')
        });
        const Message = ProtoMessage.of({
            responseHead: ProtoField(1, {
                fromUin: ProtoField(1, 'uint32'),
                fromUid: ProtoField(2, 'string', 'optional'),
                type: ProtoField(3, 'uint32'),
                sigMap: ProtoField(4, 'uint32'),
                toUin: ProtoField(5, 'uint32'),
                toUid: ProtoField(6, 'string', 'optional'),
                forward: ProtoField(7, {
                    friendName: ProtoField(6, 'string')
                }, 'optional'),
                grp: ProtoField(8, {
                    groupUin: ProtoField(1, 'uint32'),
                    memberName: ProtoField(4, 'string'),
                    unknown5: ProtoField(5, 'uint32')
                }, 'optional')
            }),
            contentHead: ProtoField(2, {
                type: ProtoField(1, 'uint32'),
                subType: ProtoField(2, 'uint32', 'optional'),
                sequence: ProtoField(5, 'uint32'),
                timeStamp: ProtoField(6, 'uint32'),
                divSeq: ProtoField(9, 'uint32'),
                autoReply: ProtoField(10, 'uint32'),
                forward: ProtoField(15, {
                    field1: ProtoField(1, 'uint32'),
                    field2: ProtoField(2, 'uint32'),
                    field3: ProtoField(3, 'uint32'),
                    unknownBase64: ProtoField(5, 'string'),
                    avatar: ProtoField(6, 'string')
                }, 'optional')
            }),
            body: ProtoField(3, {
                richText: ProtoField(1, {
                    elems: ProtoField(2, Element, 'repeated')
                })
            })
        });
        const MultiMsgItem = ProtoMessage.of({
            fileName: ProtoField(1, 'string'),
            buffer: ProtoField(2, {
                msg: ProtoField(1, Message, 'repeated')
            })
        });
        const MultiMsgTransmit = ProtoMessage.of({
            pbItemList: ProtoField(2, MultiMsgItem, 'repeated')
        });
        const LongMsgSettings = ProtoMessage.of({
            field1: ProtoField(1, 'uint32'),
            field2: ProtoField(2, 'uint32'),
            field3: ProtoField(3, 'uint32'),
            field4: ProtoField(4, 'uint32')
        });
        const SendLongMsgRequest = ProtoMessage.of({
            info: ProtoField(2, {
                type: ProtoField(1, 'uint32'),
                peer: ProtoField(2, {
                    uid: ProtoField(2, 'string')
                }),
                groupCode: ProtoField(3, 'uint32'),
                payload: ProtoField(4, 'bytes')
            }),
            settings: ProtoField(15, LongMsgSettings)
        });
        const SendLongMsgResponse = ProtoMessage.of({
            result: ProtoField(2, {
                resId: ProtoField(3, 'string')
            }, 'optional'),
            settings: ProtoField(15, LongMsgSettings, 'optional')
        });
        const SendMessageRequest = ProtoMessage.of({
            routingHead: ProtoField(1, {
                c2c: ProtoField(1, {
                    toUin: ProtoField(1, 'uint64')
                }, 'optional'),
                grp: ProtoField(2, {
                    groupCode: ProtoField(1, 'uint64')
                }, 'optional')
            }),
            contentHead: ProtoField(2, {
                pkgNum: ProtoField(1, 'uint32'),
                pkgIndex: ProtoField(2, 'uint32'),
                divSeq: ProtoField(3, 'uint32')
            }),
            msgBody: ProtoField(3, {
                richText: ProtoField(1, {
                    elems: ProtoField(2, {
                        richMsg: ProtoField(12, {
                            template1: ProtoField(1, 'bytes'),
                            serviceId: ProtoField(2, 'int32'),
                            msgResId: ProtoField(3, 'bytes')
                        }, 'optional')
                    }, 'repeated')
                })
            }),
            msgSeq: ProtoField(4, 'uint32'),
            msgRand: ProtoField(5, 'uint32'),
            msgVia: ProtoField(8, 'uint32')
        });
        const SendMessageResponse = ProtoMessage.of({
            result: ProtoField(1, 'uint32'),
            errMsg: ProtoField(2, 'string', 'optional')
        });
        return {
            MediaMsgInfo,
            MultiMsgTransmit,
            SendMessageRequest,
            SendMessageResponse,
            SendLongMsgRequest,
            SendLongMsgResponse
        };
    });
    return await protocolPromise;
}

function createSequenceStart(value) {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 0xffffffff
        ? numeric
        : crypto.randomBytes(4).readUInt32LE();
}

function makePreviewText(message) {
    const content = message.segments.map(segment => segment.type === 'image'
        ? '[图片]'
        : segment.text
    ).join('').replace(/\s+/g, ' ').trim();
    return `${message.senderName}: ${content.slice(0, 70)}`;
}

function createProtocolMessage(peer, message, index, options = {}) {
    const group = peer.chatType === 2;
    const avatar = `https://q.qlogo.cn/headimg_dl?dst_uin=${message.senderUin}&spec=0&img_type=jpg`;
    const elems = [];
    for (const segment of message.segments) {
        if (segment.type === 'text') {
            elems.push({ text: { str: segment.text } });
        } else {
            elems.push({
                commonElem: {
                    serviceType: 48,
                    pbElem: options.MediaMsgInfo.encode(segment.msgInfo),
                    businessType: group ? 20 : 10
                }
            });
        }
    }
    return {
        responseHead: {
            fromUin: Number(message.senderUin),
            fromUid: '',
            type: 0,
            sigMap: 0,
            toUin: 0,
            toUid: group ? undefined : options.selfUid,
            forward: group ? undefined : { friendName: message.senderName },
            grp: group ? {
                groupUin: Number(peer.peerUid),
                memberName: message.senderName,
                unknown5: 2
            } : undefined
        },
        contentHead: {
            type: group ? 82 : 9,
            subType: group ? undefined : 4,
            sequence: (options.sequenceStart + index) >>> 0,
            timeStamp: message.timestamp,
            divSeq: group ? 0 : 4,
            autoReply: 0,
            forward: {
                field1: 0,
                field2: 0,
                field3: group ? 1 : 2,
                unknownBase64: avatar,
                avatar
            }
        },
        body: {
            richText: {
                elems
            }
        }
    };
}

async function buildFakeForwardUploadRequest(payload, options = {}) {
    const peer = normalizePeer(payload?.peer);
    const messages = normalizeFakeForwardMessages(payload?.messages, options);
    const selfUid = normalizeText(options.selfUid);
    if (peer.chatType === 1 && !selfUid) {
        throw new Error('无法获取当前账号 UID。');
    }
    const sequenceStart = createSequenceStart(options.sequenceStart);
    const { MediaMsgInfo, MultiMsgTransmit, SendLongMsgRequest } = await getProtocol();
    const protocolMessages = messages.map((message, index) => createProtocolMessage(
        peer,
        message,
        index,
        { ...options, selfUid, sequenceStart, MediaMsgInfo }
    ));
    const transmit = MultiMsgTransmit.encode({
        pbItemList: [{
            fileName: 'MultiMsg',
            buffer: { msg: protocolMessages }
        }]
    });
    const group = peer.chatType === 2;
    const packet = SendLongMsgRequest.encode({
        info: {
            type: group ? 3 : 1,
            peer: { uid: group ? peer.peerUid : selfUid },
            groupCode: group ? Number(peer.peerUid) : 0,
            payload: gzipSync(transmit)
        },
        settings: { field1: 4, field2: 1, field3: 7, field4: 0 }
    });
    return {
        command: FAKE_FORWARD_UPLOAD_COMMAND,
        packet,
        peer,
        messages,
        count: messages.length,
        uuid: crypto.randomUUID(),
        source: group ? '群聊的聊天记录' : '聊天记录',
        summary: `查看${messages.length}条转发消息`,
        news: messages.slice(0, 4).map(message => ({ text: makePreviewText(message) }))
    };
}

function normalizeHexDigest(value, length, label) {
    const digest = normalizeText(value).toLowerCase();
    if (!new RegExp(`^[0-9a-f]{${length}}$`).test(digest)) {
        throw new TypeError(`${label} 无效。`);
    }
    return digest;
}

function createFakeForwardImageMsgInfo(input) {
    const peer = normalizePeer(input?.peer);
    const fileUuid = normalizeText(input?.fileUuid);
    const fileSize = Number(input?.fileSize);
    const width = Number(input?.width);
    const height = Number(input?.height);
    if (!fileUuid) {
        throw new TypeError('图片资源 ID 无效。');
    }
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > 0xffffffff) {
        throw new TypeError('图片文件大小无效。');
    }
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
        throw new TypeError('图片尺寸无效。');
    }
    const md5 = normalizeHexDigest(input?.md5, 32, '图片 MD5');
    const sha1 = normalizeHexDigest(input?.sha1, 40, '图片 SHA1');
    const extension = normalizeText(input?.extension).replace(/^\./, '').toLowerCase();
    const picFormat = extension === 'gif' ? 2000 : 1000;
    const fileName = normalizeText(input?.fileName) || `${md5}.${extension || 'jpg'}`;
    const group = peer.chatType === 2;
    const appId = group ? 1407 : 1406;
    return {
        msgInfoBody: [{
            index: {
                info: {
                    fileSize,
                    md5HexStr: md5,
                    sha1HexStr: sha1,
                    fileName,
                    fileType: { type: 1, picFormat },
                    width,
                    height,
                    time: 0,
                    original: 1
                },
                fileUuid,
                storeID: 1,
                uploadTime: 0,
                expire: 0,
                type: 0
            },
            pic: {
                urlPath: `/download?appid=${appId}&fileid=${fileUuid}&spec=0`,
                ext: { originalParam: '', bigParam: '', thumbParam: '' },
                domain: 'multimedia.nt.qq.com.cn'
            },
            fileExist: true,
            hashSum: group
                ? { troopSource: { groupCode: Number(peer.peerUid) } }
                : { bytesPbReserveC2c: { friendUid: peer.peerUid } }
        }],
        extBizInfo: {
            pic: {
                bizType: 0,
                summary: '[图片]',
                bytesPbReserveC2c: Buffer.from([
                    0x08, 0x00, 0x18, 0x00, 0x20, 0x00, 0x4a, 0x00,
                    0x50, 0x00, 0x62, 0x00, 0x92, 0x01, 0x00, 0x9a,
                    0x01, 0x00, 0xaa, 0x01, 0x0c, 0x08, 0x00, 0x12,
                    0x00, 0x18, 0x00, 0x20, 0x00, 0x28, 0x00, 0x3a, 0x00
                ]),
                fromScene: 0,
                toScene: 0,
                oldFileId: 0
            },
            busiType: 0
        }
    };
}

async function decodeFakeForwardImageMsgInfo(packet) {
    const { MediaMsgInfo } = await getProtocol();
    return MediaMsgInfo.decode(packet);
}

function asBuffer(value) {
    if (Buffer.isBuffer(value)) {
        return value;
    }
    if (value instanceof Uint8Array) {
        return Buffer.from(value);
    }
    if (value?.type === 'Buffer' && Array.isArray(value.data)) {
        return Buffer.from(value.data);
    }
    if (typeof value !== 'string' || !value) {
        return null;
    }
    if (/^(?:[0-9a-f]{2})+$/i.test(value)) {
        return Buffer.from(value, 'hex');
    }
    if (value.length % 4 === 0 && /^[a-z0-9+/]+={0,2}$/i.test(value)) {
        return Buffer.from(value, 'base64');
    }
    return Buffer.from(value, 'latin1');
}

function extractResponseBuffer(response, depth = 0) {
    const direct = asBuffer(response);
    if (direct || !response || typeof response !== 'object' || depth > 3) {
        return direct;
    }
    for (const key of ['rspbuffer', 'rspBuffer', 'rsp', 'payload', 'data', 'value']) {
        const bytes = extractResponseBuffer(response[key], depth + 1);
        if (bytes) {
            return bytes;
        }
    }
    return null;
}

async function parseFakeForwardUploadResponse(response) {
    const bytes = extractResponseBuffer(response);
    if (!bytes?.length) {
        throw new Error('QQ 未返回合并转发资源数据。');
    }
    const { SendLongMsgResponse } = await getProtocol();
    const decoded = SendLongMsgResponse.decode(bytes);
    const resId = normalizeText(decoded?.result?.resId);
    if (!resId) {
        throw new Error('QQ 未返回合并转发资源 ID。');
    }
    return resId;
}

function escapeXml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function buildFakeForwardXml(upload, resId) {
    const titleNodes = upload.news.slice(0, 4).map(item =>
        `<title color="#777777" size="26"> ${escapeXml(item.text)} </title>`
    ).join('');
    return `<?xml version='1.0' encoding='UTF-8' standalone="yes"?> ` +
        `<msg serviceID="35" templateID="1" action="viewMultiMsg" brief="[聊天记录]" ` +
        `m_fileName="MultiMsg" m_resid="${escapeXml(resId)}" tSum="${upload.count}" flag="3">` +
        `<item layout="1"><title color="#000000" size="34">${escapeXml(upload.source)}</title>` +
        `${titleNodes}<hr></hr><summary color="#808080">${escapeXml(upload.summary)}</summary></item>` +
        `<source name="${escapeXml(upload.source)}"></source></msg>`;
}

function normalizeRandomUInt32(value, byteLength) {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 0xffffffff
        ? numeric
        : byteLength === 2
            ? crypto.randomBytes(2).readUInt16BE()
            : crypto.randomBytes(4).readUInt32BE();
}

async function buildFakeForwardSendRequest(upload, resId, options = {}) {
    const resourceId = normalizeText(resId);
    if (!resourceId) {
        throw new TypeError('合并转发资源 ID 无效。');
    }
    const group = upload?.peer?.chatType === 2;
    const targetUin = normalizeUin(group ? upload?.peer?.peerUid : options.peerUin || upload?.peer?.peerUin);
    if (!targetUin) {
        throw new TypeError(group ? '无法获取当前群号。' : '无法获取当前好友 QQ 号。');
    }
    const xmlContent = buildFakeForwardXml(upload, resourceId);
    const { SendMessageRequest } = await getProtocol();
    const packet = SendMessageRequest.encode({
        routingHead: group
            ? { grp: { groupCode: BigInt(targetUin) } }
            : { c2c: { toUin: BigInt(targetUin) } },
        contentHead: {
            pkgNum: 1,
            pkgIndex: 0,
            divSeq: 0
        },
        msgBody: {
            richText: {
                elems: [{
                    richMsg: {
                        template1: Buffer.from(xmlContent, 'utf8'),
                        serviceId: 35,
                        msgResId: Buffer.from(resourceId, 'utf8')
                    }
                }]
            }
        },
        msgSeq: normalizeRandomUInt32(options.msgSeq, 2),
        msgRand: normalizeRandomUInt32(options.msgRand, 4),
        msgVia: 0
    });
    return {
        command: FAKE_FORWARD_SEND_COMMAND,
        packet,
        xmlContent
    };
}

async function decodeFakeForwardUploadRequest(packet) {
    const { MultiMsgTransmit, SendLongMsgRequest } = await getProtocol();
    const request = SendLongMsgRequest.decode(packet);
    return {
        request,
        transmit: MultiMsgTransmit.decode(gunzipSync(request.info.payload))
    };
}

async function decodeFakeForwardSendRequest(packet) {
    const { SendMessageRequest } = await getProtocol();
    return SendMessageRequest.decode(packet);
}

async function parseFakeForwardSendResponse(response) {
    const bytes = extractResponseBuffer(response);
    if (!bytes?.length) {
        throw new Error('QQ 未返回合并转发发送结果。');
    }
    const { SendMessageResponse } = await getProtocol();
    const decoded = SendMessageResponse.decode(bytes);
    return {
        result: Number(decoded?.result) || 0,
        errMsg: normalizeText(decoded?.errMsg)
    };
}

module.exports = {
    FAKE_FORWARD_SEND_COMMAND,
    FAKE_FORWARD_UPLOAD_COMMAND,
    MAX_FAKE_FORWARD_IMAGES_PER_MESSAGE,
    MAX_FAKE_FORWARD_MESSAGES,
    MAX_FAKE_FORWARD_TEXT_LENGTH,
    buildFakeForwardImageUploadParams,
    buildFakeForwardSendRequest,
    buildFakeForwardUploadRequest,
    createFakeForwardImageMsgInfo,
    decodeFakeForwardImageMsgInfo,
    decodeFakeForwardSendRequest,
    decodeFakeForwardUploadRequest,
    normalizeFakeForwardMessages,
    normalizePeer,
    parseFakeForwardSendResponse,
    parseFakeForwardUploadResponse
};
