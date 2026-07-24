'use strict';

const FILTER_MODES = new Set(['all', 'blacklist', 'whitelist']);
const MARKER_STYLES = new Set(['badge', 'outline']);
const MAX_FILTER_PEERS = 256;
const MAX_CONTACTS = 2000;

const RECOVERED_RECORD_ACTIONS = Object.freeze({
    CACHE: 'cache',
    PRESERVE: 'preserve',
    RECOVER: 'recover'
});

function normalizeText(value) {
    return String(value ?? '').trim();
}

function getRecallInfo(record) {
    if (!record || !Array.isArray(record.elements) || record.elements.length !== 1) {
        return null;
    }
    const grayTip = record.elements[0]?.grayTipElement;
    return grayTip?.subElementType === 1 ? grayTip.revokeElement || null : null;
}

function getRecoveredRecordAction(record, hasRecoveredRecord = false) {
    if (getRecallInfo(record)) {
        return RECOVERED_RECORD_ACTIONS.RECOVER;
    }
    if (!hasRecoveredRecord) {
        return RECOVERED_RECORD_ACTIONS.CACHE;
    }
    const elements = Array.isArray(record?.elements) ? record.elements : [];
    const isGrayTipOnly = elements.length > 0 && elements.every(element => element?.grayTipElement);
    return elements.length > 0 && !isGrayTipOnly
        ? RECOVERED_RECORD_ACTIONS.PRESERVE
        : RECOVERED_RECORD_ACTIONS.RECOVER;
}

function getRecallPeerDescriptor(value) {
    const chatType = Number(value?.chatType || value?.peer?.chatType || value?.contact?.chatType) || 0;
    const peerUid = normalizeText(
        value?.peerUid || value?.peerUin || value?.peer?.peerUid || value?.peer?.peerUin ||
        value?.contact?.peerUid || value?.contact?.peerUin
    );
    if (!chatType || !peerUid) {
        return null;
    }
    return {
        key: `${chatType}:${peerUid}`,
        chatType,
        peerUid
    };
}

function visitNestedValues(values, callback) {
    const seen = new WeakSet();
    let visited = 0;
    const visit = (value, depth = 0, entryKey = '') => {
        if (value === null || value === undefined || depth > 6 || visited >= 10000) {
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(item => visit(item, depth + 1));
            return;
        }
        if (value instanceof Map) {
            value.forEach((item, key) => visit(item, depth + 1, normalizeText(key)));
            return;
        }
        if (typeof value !== 'object' || ArrayBuffer.isView(value) || seen.has(value)) {
            return;
        }
        visited += 1;
        seen.add(value);
        callback(value, entryKey);
        for (const [key, child] of Object.entries(value)) {
            visit(child, depth + 1, normalizeText(key));
        }
    };
    visit(values);
}

function normalizeRecallBuddyContacts(buddyValues, profileValues) {
    const buddyUids = new Set();
    const profiles = new Map();
    const collectProfile = (value, entryKey = '') => {
        const coreInfo = value?.coreInfo && typeof value.coreInfo === 'object' ? value.coreInfo : value;
        const uid = normalizeText(value?.uid || coreInfo?.uid || (entryKey.startsWith('u_') ? entryKey : ''));
        if (!uid.startsWith('u_')) {
            return;
        }
        buddyUids.add(uid);
        const previous = profiles.get(uid) || {};
        profiles.set(uid, {
            uid,
            uin: normalizeText(value?.uin || coreInfo?.uin) || previous.uin || '',
            remark: normalizeText(value?.remark || coreInfo?.remark) || previous.remark || '',
            nick: normalizeText(value?.nick || value?.nickName || coreInfo?.nick || coreInfo?.nickName) || previous.nick || ''
        });
    };
    visitNestedValues(buddyValues, value => {
        for (const sourceUid of Array.isArray(value?.buddyUids) ? value.buddyUids : []) {
            const uid = normalizeText(sourceUid);
            if (uid.startsWith('u_')) {
                buddyUids.add(uid);
            }
        }
        collectProfile(value);
    });
    visitNestedValues(profileValues, collectProfile);

    return Array.from(buddyUids).slice(0, MAX_CONTACTS).map(uid => {
        const profile = profiles.get(uid) || {};
        const peerUin = normalizeText(profile.uin);
        return {
            key: `1:${uid}`,
            chatType: 1,
            peerUid: uid,
            peerUin,
            label: (normalizeText(profile.remark) || normalizeText(profile.nick) || peerUin || uid).slice(0, 80),
            avatarUrl: peerUin ? `https://q1.qlogo.cn/g?b=qq&nk=${peerUin}&s=100` : '',
            msgTime: 0
        };
    });
}

function normalizeRecallGroupContacts(values) {
    const contacts = new Map();
    visitNestedValues(values, value => {
        const groupCode = normalizeText(value?.groupCode);
        if (!/^\d+$/.test(groupCode) || contacts.has(groupCode) || contacts.size >= MAX_CONTACTS) {
            return;
        }
        contacts.set(groupCode, {
            key: `2:${groupCode}`,
            chatType: 2,
            peerUid: groupCode,
            peerUin: groupCode,
            label: (normalizeText(value?.remarkName) || normalizeText(value?.groupName) || groupCode).slice(0, 80),
            avatarUrl: `https://p.qlogo.cn/gh/${groupCode}/${groupCode}/100/`,
            msgTime: 0
        });
    });
    return Array.from(contacts.values());
}

function normalizeRecallFilterPeers(values) {
    const peers = new Map();
    for (const source of Array.isArray(values) ? values : []) {
        const descriptor = getRecallPeerDescriptor(source);
        if (!descriptor || peers.has(descriptor.key)) {
            continue;
        }
        peers.set(descriptor.key, {
            ...descriptor,
            label: normalizeText(source?.label).slice(0, 80)
        });
        if (peers.size >= MAX_FILTER_PEERS) {
            break;
        }
    }
    return Array.from(peers.values());
}

function normalizePreventRecallConfig(config = {}) {
    return {
        ...config,
        markerStyle: MARKER_STYLES.has(config.markerStyle) ? config.markerStyle : 'badge',
        filterMode: FILTER_MODES.has(config.filterMode) ? config.filterMode : 'all',
        filterPeers: normalizeRecallFilterPeers(config.filterPeers)
    };
}

function shouldPreventRecallForPeer(config, record) {
    const normalized = normalizePreventRecallConfig(config);
    if (normalized.filterMode === 'all') {
        return true;
    }
    const descriptor = getRecallPeerDescriptor(record);
    if (!descriptor) {
        return normalized.filterMode === 'blacklist';
    }
    const listed = normalized.filterPeers.some(peer => peer.key === descriptor.key);
    return normalized.filterMode === 'whitelist' ? listed : !listed;
}

function shouldHandlePreventRecallRecord(config, record, hasRecoveredRecord = false) {
    return hasRecoveredRecord || (config?.enabled === true && shouldPreventRecallForPeer(config, record));
}

module.exports = {
    FILTER_MODES,
    MARKER_STYLES,
    RECOVERED_RECORD_ACTIONS,
    getRecallPeerDescriptor,
    getRecallInfo,
    getRecoveredRecordAction,
    normalizeRecallBuddyContacts,
    normalizeRecallGroupContacts,
    normalizePreventRecallConfig,
    normalizeRecallFilterPeers,
    shouldHandlePreventRecallRecord,
    shouldPreventRecallForPeer
};
