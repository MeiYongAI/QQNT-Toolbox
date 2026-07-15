'use strict';

const MAX_RECORDS = 400;
const MAX_ALIASES = 200;
const MAX_DEPTH = 7;
const UPDATE_NOTICE_GROUPS = new Set(['100084', '100243']);
const CHILD_KEYS = [
    'payload',
    'msgList',
    'elements',
    'records',
    'data',
    'result',
    'msgElements',
    'peer',
    'header',
    'sender',
    'sendMember',
    'msgRecords',
    'msgRecord'
];

function normalizeText(value) {
    const text = String(value ?? '').trim();
    return text && text !== 'undefined' && text !== 'null' && text !== '0' ? text : '';
}

function isMessageRecord(value) {
    return Boolean(
        value &&
        typeof value === 'object' &&
        (value.msgId !== undefined || value.msgSeq !== undefined) &&
        Array.isArray(value.elements)
    );
}

function isNativeMainChannel(channel) {
    return /^RM_IPCFROM_MAIN\d*$/.test(String(channel || ''));
}

function addCommandName(commandNames, value) {
    const commandName = normalizeText(value?.cmdName);
    if (commandName) {
        commandNames.add(commandName);
    }
}

function getChildren(value, inspectAllProperties) {
    try {
        return inspectAllProperties
            ? Object.values(value)
            : CHILD_KEYS.map(key => value[key]);
    } catch {
        return [];
    }
}

function createNativeEventContext(args, options = {}) {
    const roots = Array.isArray(args) ? args : [args];
    const commandNames = new Set();
    for (const root of roots) {
        addCommandName(commandNames, root);
        addCommandName(commandNames, root?.payload);
    }

    const records = [];
    const aliases = [];
    const seen = new WeakSet();
    const recordSet = new WeakSet();
    const aliasSet = new Set();
    const inspectAllProperties = options.detectUnitedConfigGroup === true;
    let hasUnitedConfigGroup = false;
    const stack = [];
    for (let index = roots.length - 1; index >= 0; index--) {
        stack.push({ depth: 0, value: roots[index] });
    }

    while (stack.length) {
        const { depth, value } = stack.pop();
        if (!value || depth > MAX_DEPTH) {
            continue;
        }
        if (Array.isArray(value)) {
            for (let index = value.length - 1; index >= 0; index--) {
                stack.push({ depth: depth + 1, value: value[index] });
            }
            continue;
        }
        if (typeof value !== 'object' || value instanceof Uint8Array || value instanceof Map || seen.has(value)) {
            continue;
        }
        seen.add(value);

        if (records.length < MAX_RECORDS && isMessageRecord(value) && !recordSet.has(value)) {
            recordSet.add(value);
            records.push(value);
        }

        if (aliases.length < MAX_ALIASES) {
            const chatType = Number(
                value.chatType || value.type || value.aioType || value.peer?.chatType || value.header?.chatType
            ) || 0;
            const addAlias = (peerUid, peerUin) => {
                peerUid = normalizeText(peerUid);
                peerUin = normalizeText(peerUin);
                const key = `${peerUin}:${peerUid}`;
                if ((chatType === 1 || chatType === 100 || !chatType) &&
                    peerUid.startsWith('u_') && /^\d+$/.test(peerUin) && !aliasSet.has(key)) {
                    aliasSet.add(key);
                    aliases.push({ peerUin, peerUid });
                }
            };
            addAlias(
                value.peerUid || value.peer?.peerUid || value.header?.peerUid,
                value.peerUin || value.peer?.peerUin || value.header?.peerUin
            );
            addAlias(
                value.senderUid || value.sender?.uid || value.sender?.peerUid,
                value.senderUin || value.sender?.uin || value.sender?.peerUin
            );
            addAlias(
                value.uid || value.peer?.uid || value.header?.uid,
                value.uin || value.chatUin || value.peer?.uin || value.header?.uin
            );
        }

        if (inspectAllProperties && !hasUnitedConfigGroup) {
            const group = String(value?.configData?.group || value?.group || '');
            hasUnitedConfigGroup = UPDATE_NOTICE_GROUPS.has(group);
            if (hasUnitedConfigGroup) {
                break;
            }
        }

        if (depth >= MAX_DEPTH) {
            continue;
        }
        const children = getChildren(value, inspectAllProperties);
        for (let index = children.length - 1; index >= 0; index--) {
            stack.push({ depth: depth + 1, value: children[index] });
        }
    }

    return {
        aliases,
        args: roots,
        commandNames,
        hasUnitedConfigGroup,
        records
    };
}

module.exports = {
    createNativeEventContext,
    isMessageRecord,
    isNativeMainChannel
};
