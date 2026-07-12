'use strict';

const MAX_UINT32 = 0xffffffffn;
const MAX_UINT64 = 0xffffffffffffffffn;

function normalizeUin(value) {
    const text = String(value ?? '').trim();
    if (!/^\d+$/.test(text)) {
        return '';
    }
    const number = BigInt(text);
    return number > 0n && number <= MAX_UINT32 ? number.toString() : '';
}

function encodeVarint(value) {
    let number = BigInt(value);
    if (number < 0n) {
        throw new RangeError('Protobuf varint cannot be negative.');
    }
    const bytes = [];
    do {
        let byte = Number(number & 0x7fn);
        number >>= 7n;
        if (number) {
            byte |= 0x80;
        }
        bytes.push(byte);
    } while (number);
    return Buffer.from(bytes);
}

function encodeUint32(fieldNumber, value) {
    return Buffer.concat([
        encodeVarint(BigInt(fieldNumber) << 3n),
        encodeVarint(value)
    ]);
}

function encodeBytes(fieldNumber, value) {
    const bytes = Buffer.from(value);
    return Buffer.concat([
        encodeVarint((BigInt(fieldNumber) << 3n) | 2n),
        encodeVarint(bytes.length),
        bytes
    ]);
}

function normalizeUint64(value) {
    const text = String(value ?? '').trim();
    if (!/^\d+$/.test(text)) {
        return '';
    }
    const number = BigInt(text);
    return number >= 0n && number <= MAX_UINT64 ? number.toString() : '';
}

function requireUint64(value, fieldName) {
    const normalized = normalizeUint64(value);
    if (!normalized || normalized === '0') {
        throw new TypeError(`A valid ${fieldName} is required.`);
    }
    return normalized;
}

function buildOidbPacket(command, serviceType, body) {
    return Buffer.concat([
        encodeUint32(1, command),
        encodeUint32(2, serviceType),
        encodeBytes(4, body),
        encodeUint32(12, 1)
    ]);
}

function buildPokeBody({ targetUin, groupUin = '' }) {
    targetUin = normalizeUin(targetUin);
    groupUin = normalizeUin(groupUin);
    if (!targetUin) {
        throw new TypeError('A valid target UIN is required.');
    }

    return Buffer.concat(groupUin
        ? [encodeUint32(1, targetUin), encodeUint32(2, groupUin), encodeUint32(6, 0)]
        : [encodeUint32(1, targetUin), encodeUint32(5, targetUin), encodeUint32(6, 0)]);
}

function buildPokePacket(params) {
    const body = buildPokeBody(params);
    return buildOidbPacket(0xed3, 1, body);
}

function buildPokeRecallPacket(params) {
    const chatType = Number(params?.chatType);
    const peerUin = normalizeUin(params?.peerUin);
    const msgType = requireUint64(params?.msgType, 'message type');
    const msgSeq = BigInt(requireUint64(params?.msgSeq, 'message sequence')) & 0xffffn;
    const msgTime = requireUint64(params?.msgTime, 'message time');
    const msgUid = requireUint64(params?.msgUid, 'message UID');
    const businessId = requireUint64(params?.businessId, 'business ID');
    const tipsSeqId = requireUint64(params?.tipsSeqId, 'tips sequence ID');
    if ((chatType !== 1 && chatType !== 2) || !peerUin) {
        throw new TypeError('A valid poke conversation is required.');
    }

    const messageInfo = chatType === 2
        ? Buffer.concat([
            encodeUint32(1, peerUin),
            encodeUint32(2, msgType),
            encodeUint32(3, msgSeq),
            encodeUint32(4, msgTime),
            encodeUint32(5, msgUid),
            encodeUint32(6, requireUint64(params?.msgId, 'message ID'))
        ])
        : Buffer.concat([
            encodeUint32(1, peerUin),
            encodeUint32(2, msgType),
            encodeUint32(3, msgSeq),
            encodeUint32(4, msgTime),
            encodeUint32(5, msgUid)
        ]);
    const grayTipInfo = Buffer.concat([
        encodeUint32(1, businessId),
        encodeUint32(2, tipsSeqId)
    ]);
    const body = Buffer.concat([
        encodeBytes(chatType === 2 ? 2 : 1, messageInfo),
        encodeBytes(3, grayTipInfo)
    ]);
    return buildOidbPacket(0xf51, 1, body);
}

function getMapValue(value, key) {
    if (value instanceof Map) {
        return value.get(key);
    }
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    if (Object.prototype.hasOwnProperty.call(value, key)) {
        return value[key];
    }
    if (Array.isArray(value.entries)) {
        return value.entries.find(entry => Array.isArray(entry) && entry[0] === key)?.[1];
    }
    return undefined;
}

function parseJson(value) {
    if (value && typeof value === 'object') {
        return value;
    }
    try {
        return JSON.parse(String(value || ''));
    } catch {
        return null;
    }
}

function extractPokeEvent(record) {
    for (const element of Array.isArray(record?.elements) ? record.elements : []) {
        const jsonTip = element?.grayTipElement?.jsonGrayTipElement;
        if (String(jsonTip?.busiId || '') !== '1061') {
            continue;
        }
        const templateParams = jsonTip?.xmlToJsonParam?.templParam;
        const json = parseJson(jsonTip?.jsonStr);
        const users = Array.isArray(json?.items)
            ? json.items.filter(item => item && typeof item === 'object' && item.uid)
            : [];
        return {
            initiatorUin: normalizeUin(getMapValue(templateParams, 'uin_str1')),
            targetUin: normalizeUin(getMapValue(templateParams, 'uin_str2')),
            initiatorUid: String(users[0]?.uid || ''),
            targetUid: String(users[1]?.uid || '')
        };
    }
    return null;
}

module.exports = {
    buildPokePacket,
    buildPokeRecallPacket,
    extractPokeEvent,
    normalizeUin
};
