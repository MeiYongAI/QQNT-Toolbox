'use strict';

const { getAutoReactionDecision } = require('./auto-reaction');

const DEFAULT_AUTO_POKE_TRIGGER_CONFIG = Object.freeze({
    poked: true,
    mentionSelf: false,
    replySelf: false,
    excludeAtAll: true
});

function normalizeText(value) {
    const text = String(value ?? '').trim();
    return text && text !== 'undefined' && text !== 'null' && text !== '0' ? text : '';
}

function normalizeAutoPokeTriggerConfig(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        poked: source.poked !== false,
        mentionSelf: source.mentionSelf === true,
        replySelf: source.replySelf === true,
        excludeAtAll: source.excludeAtAll !== false
    };
}

function getAutoPokeMessageDecision(record, identity, configValue) {
    const config = normalizeAutoPokeTriggerConfig(configValue);
    return getAutoReactionDecision(record, identity, {
        mentionSelf: config.mentionSelf,
        replySelf: config.replySelf,
        excludeAtAll: config.excludeAtAll,
        selfMessages: false
    });
}

function getAutoPokeMessageKey(record, scope = '') {
    const chatType = Math.trunc(Number(record?.chatType || record?.peer?.chatType));
    if (chatType !== 1 && chatType !== 2) {
        return '';
    }
    const peerUid = normalizeText(
        record?.peerUid || record?.peerUin || record?.peer?.peerUid || record?.peer?.peerUin ||
        record?.senderUid || record?.senderUin
    );
    if (!peerUid) {
        return '';
    }
    const msgId = normalizeText(record?.msgId);
    const msgSeq = normalizeText(record?.msgSeq);
    const identity = msgId || (/^\d+$/.test(msgSeq) ? `seq:${msgSeq}` : '');
    if (!identity) {
        return '';
    }
    return [normalizeText(scope) || 'default', 'message', chatType, peerUid, identity].join(':');
}

module.exports = {
    DEFAULT_AUTO_POKE_TRIGGER_CONFIG,
    getAutoPokeMessageDecision,
    getAutoPokeMessageKey,
    normalizeAutoPokeTriggerConfig
};
