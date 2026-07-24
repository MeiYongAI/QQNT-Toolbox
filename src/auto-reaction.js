'use strict';

const MAX_AUTO_REACTION_EMOJI_IDS = 64;
const AUTO_REACTION_MAX_AGE_MS = 60 * 1000;

const DEFAULT_AUTO_REACTION_CONFIG = Object.freeze({
    enabled: false,
    emojiIds: Object.freeze([]),
    mentionSelf: true,
    replySelf: true,
    excludeAtAll: true,
    selfMessages: false
});

function normalizeText(value) {
    const text = String(value ?? '').trim();
    return text && text !== 'undefined' && text !== 'null' && text !== '0' ? text : '';
}

function normalizeEmojiId(value) {
    const id = String(value ?? '').trim();
    return /^\d{1,16}$/.test(id) ? id : '';
}

function normalizeAutoReactionConfig(value) {
    const source = value && typeof value === 'object' ? value : {};
    const emojiIds = [];
    const seen = new Set();
    for (const value of Array.isArray(source.emojiIds) ? source.emojiIds : []) {
        const id = normalizeEmojiId(value);
        if (!id || seen.has(id) || emojiIds.length >= MAX_AUTO_REACTION_EMOJI_IDS) {
            continue;
        }
        seen.add(id);
        emojiIds.push(id);
    }
    return {
        enabled: source.enabled === true,
        emojiIds,
        mentionSelf: source.mentionSelf !== false,
        replySelf: source.replySelf !== false,
        excludeAtAll: source.excludeAtAll !== false,
        selfMessages: source.selfMessages === true
    };
}

function normalizeIdentitySet(identity) {
    const result = new Set();
    for (const value of [identity?.selfUin, identity?.selfUid]) {
        const normalized = normalizeText(value);
        if (normalized) {
            result.add(normalized);
        }
    }
    return result;
}

function matchesIdentity(values, identities) {
    for (const value of values) {
        const normalized = normalizeText(value);
        if (normalized && identities.has(normalized)) {
            return true;
        }
    }
    return false;
}

function getAutoReactionDecision(record, identity, configValue) {
    const config = normalizeAutoReactionConfig(configValue);
    const identities = normalizeIdentitySet(identity);
    const senderMatches = matchesIdentity([
        record?.senderUin,
        record?.senderUid,
        record?.senderUidStr,
        record?.sender?.uin,
        record?.sender?.uid
    ], identities);
    const selfMessage = Number(record?.sendType) === 1 || senderMatches;
    let hasAtAll = false;
    let mentionsSelf = false;
    let repliesToSelf = false;

    for (const element of Array.isArray(record?.elements) ? record.elements : []) {
        const textElement = element?.textElement;
        if (textElement) {
            const atType = Number(textElement.atType);
            if (atType === 1) {
                hasAtAll = true;
            }
            if (atType === 2 || textElement.atUid || textElement.atNtUid || textElement.atTinyId) {
                mentionsSelf ||= matchesIdentity([
                    textElement.atUid,
                    textElement.atNtUid,
                    textElement.atTinyId
                ], identities);
            }
        }
        const replyElement = element?.replyElement;
        if (replyElement) {
            repliesToSelf ||= matchesIdentity([
                replyElement.senderUin,
                replyElement.senderUid,
                replyElement.senderUidStr
            ], identities);
        }
    }

    if (config.excludeAtAll && hasAtAll) {
        return {
            matched: false,
            excluded: true,
            reasons: [],
            selfMessage,
            hasAtAll,
            mentionsSelf,
            repliesToSelf
        };
    }

    const reasons = [];
    if (config.selfMessages && selfMessage) {
        reasons.push('self-message');
    }
    if (config.mentionSelf && mentionsSelf) {
        reasons.push('mention-self');
    }
    if (config.replySelf && repliesToSelf) {
        reasons.push('reply-self');
    }
    return {
        matched: reasons.length > 0,
        excluded: false,
        reasons,
        selfMessage,
        hasAtAll,
        mentionsSelf,
        repliesToSelf
    };
}

function getAutoReactionMessageKey(record, scope = '') {
    const chatType = Math.trunc(Number(record?.chatType || record?.peer?.chatType));
    const peerUid = normalizeText(
        record?.peerUid || record?.peerUin || record?.peer?.peerUid || record?.peer?.peerUin
    );
    if (chatType !== 2 || !peerUid) {
        return '';
    }
    const msgId = normalizeText(record?.msgId);
    const msgSeq = normalizeText(record?.msgSeq);
    const identity = msgId || (/^\d+$/.test(msgSeq) ? `seq:${msgSeq}` : '');
    if (!identity) {
        return '';
    }
    return [normalizeText(scope) || 'default', chatType, peerUid, identity].join(':');
}

function isRecentAutoReactionRecord(record, now = Date.now()) {
    const msgTime = Number(record?.msgTime);
    if (!Number.isFinite(msgTime) || msgTime <= 0) {
        return true;
    }
    const timestamp = msgTime > 1e12 ? msgTime : msgTime * 1000;
    return Math.abs(Number(now) - timestamp) <= AUTO_REACTION_MAX_AGE_MS;
}

function isAutoReactionRecordReady(record, decision, events = {}) {
    if (decision?.selfMessage === true) {
        return events.sendComplete === true && Number(record?.sendStatus) === 2;
    }
    return events.received === true;
}

module.exports = {
    AUTO_REACTION_MAX_AGE_MS,
    DEFAULT_AUTO_REACTION_CONFIG,
    MAX_AUTO_REACTION_EMOJI_IDS,
    getAutoReactionDecision,
    getAutoReactionMessageKey,
    isAutoReactionRecordReady,
    isRecentAutoReactionRecord,
    normalizeAutoReactionConfig
};
