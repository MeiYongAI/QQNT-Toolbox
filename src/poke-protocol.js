'use strict';

const MAX_UINT32 = 0xffffffffn;

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
    return Buffer.concat([
        encodeUint32(1, 0xed3),
        encodeUint32(2, 1),
        encodeBytes(4, body),
        encodeUint32(12, 1)
    ]);
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
    extractPokeEvent,
    normalizeUin
};
