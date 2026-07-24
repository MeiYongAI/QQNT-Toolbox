'use strict';

const fs = require('fs');
const path = require('path');

const MAX_EMOJI_ID_LENGTH = 16;

// These are the Unicode reactions restored by QAuxiliary's filter bypass.
// AQLid identifies the matching image in QQ's emoji_res directory.
const UNFILTERED_REACTION_AQL_IDS = Object.freeze([
    '26', '27', '31', '33', '57', '67', '80', '81',
    '91', '106', '107', '108', '111', '121', '143', '162'
]);
const REACTION_LABEL_OVERRIDES = Object.freeze({
    31: '中指'
});

function normalizeText(value) {
    const text = String(value ?? '').trim();
    return text && text !== 'undefined' && text !== 'null' && text !== '0' ? text : '';
}

function normalizeEmojiId(value) {
    const id = String(value ?? '').trim();
    return /^\d+$/.test(id) && id.length <= MAX_EMOJI_ID_LENGTH ? id : '';
}

function getEmojiResourceDirectory(tencentFilesRoot) {
    return path.join(
        tencentFilesRoot,
        'nt_qq',
        'global',
        'nt_data',
        'Emoji',
        'emoji-resource'
    );
}

function normalizeEmojiLabel(value, id) {
    return normalizeText(value).replace(/^\/+/, '') || `Emoji ${id}`;
}

function readPngDataUrl(filePath) {
    try {
        if (!fs.statSync(filePath).isFile()) {
            return '';
        }
        return `data:image/png;base64,${fs.readFileSync(filePath).toString('base64')}`;
    } catch {
        return '';
    }
}

function loadCatalogFromEmojiResource(directory) {
    const configPath = path.join(directory, 'face_config.json');
    let config;
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
        return [];
    }
    const emojiList = Array.isArray(config?.emoji) ? config.emoji : [];
    const byAqlId = new Map(emojiList.map(emoji => [String(emoji?.AQLid ?? ''), emoji]));
    const entries = [];
    for (const assetId of UNFILTERED_REACTION_AQL_IDS) {
        const emoji = byAqlId.get(assetId);
        const id = normalizeEmojiId(emoji?.QCid);
        if (!id) {
            continue;
        }
        const imagePath = path.join(
            directory,
            'emoji_res',
            `emoji_${assetId.padStart(3, '0')}.png`
        );
        const src = readPngDataUrl(imagePath);
        if (!src) {
            continue;
        }
        entries.push({
            id,
            assetId,
            label: REACTION_LABEL_OVERRIDES[assetId] || normalizeEmojiLabel(emoji?.QDes, id),
            src
        });
    }
    return entries;
}

function loadAutoCatalogFromEmojiResource(directory) {
    const configPath = path.join(directory, 'face_config.json');
    let config;
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
        return [];
    }
    const entries = [];
    for (const emoji of Array.isArray(config?.emoji) ? config.emoji : []) {
        const id = normalizeEmojiId(emoji?.QCid);
        const assetId = normalizeEmojiId(emoji?.AQLid);
        const hidden = String(emoji?.QHide ?? '') === '1';
        if (!id || !assetId || (hidden && !UNFILTERED_REACTION_AQL_IDS.includes(assetId))) {
            continue;
        }
        const src = readPngDataUrl(path.join(
            directory,
            'emoji_res',
            `emoji_${assetId.padStart(3, '0')}.png`
        ));
        if (!src) {
            continue;
        }
        entries.push({
            id,
            assetId,
            category: 'unicode',
            label: REACTION_LABEL_OVERRIDES[assetId] || normalizeEmojiLabel(emoji?.QDes, id),
            src
        });
    }
    return entries;
}

function loadAutoCatalogFromDefaultEmojis(directory) {
    let config;
    try {
        config = JSON.parse(fs.readFileSync(path.join(directory, 'default_config.json'), 'utf8'));
    } catch {
        return [];
    }
    const groups = Array.isArray(config?.normalPanelResult?.SysEmojiGroupList)
        ? config.normalPanelResult.SysEmojiGroupList
        : [];
    const entries = [];
    const seen = new Set();
    for (const group of groups) {
        for (const emoji of Array.isArray(group?.SysEmojiList) ? group.SysEmojiList : []) {
            if (Number(emoji?.emojiType) === 4 || emoji?.isHide === true) {
                continue;
            }
            const id = normalizeEmojiId(emoji?.emojiId);
            if (!id || seen.has(id)) {
                continue;
            }
            const src = readPngDataUrl(path.join(directory, `${id}.png`));
            if (!src) {
                continue;
            }
            seen.add(id);
            entries.push({
                id,
                category: 'qq',
                label: normalizeEmojiLabel(emoji?.describe, id),
                src
            });
        }
    }
    return entries;
}

function loadReactionEmojiCatalog(tencentFilesRoots) {
    const roots = Array.isArray(tencentFilesRoots) ? tencentFilesRoots : [tencentFilesRoots];
    for (const root of roots) {
        const normalizedRoot = normalizeText(root);
        if (!normalizedRoot) {
            continue;
        }
        const entries = loadCatalogFromEmojiResource(getEmojiResourceDirectory(normalizedRoot));
        if (entries.length) {
            return entries;
        }
    }
    return [];
}

function loadAutoReactionEmojiCatalog(options = {}) {
    const defaultEmojiDirectories = Array.isArray(options.defaultEmojiDirectories)
        ? options.defaultEmojiDirectories
        : [options.defaultEmojiDirectories];
    const tencentFilesRoots = Array.isArray(options.tencentFilesRoots)
        ? options.tencentFilesRoots
        : [options.tencentFilesRoots];
    const entries = [];
    for (const directory of defaultEmojiDirectories) {
        const normalizedDirectory = normalizeText(directory);
        if (!normalizedDirectory) {
            continue;
        }
        const catalog = loadAutoCatalogFromDefaultEmojis(normalizedDirectory);
        if (catalog.length) {
            entries.push(...catalog);
            break;
        }
    }
    for (const root of tencentFilesRoots) {
        const normalizedRoot = normalizeText(root);
        if (!normalizedRoot) {
            continue;
        }
        const catalog = loadAutoCatalogFromEmojiResource(
            getEmojiResourceDirectory(normalizedRoot)
        );
        if (catalog.length) {
            entries.push(...catalog);
            break;
        }
    }
    const unique = new Map();
    for (const entry of entries) {
        if (!unique.has(entry.id)) {
            unique.set(entry.id, entry);
        }
    }
    return Array.from(unique.values());
}

function normalizeReactionRequest(payload) {
    const peer = payload?.peer;
    const chatType = Math.trunc(Number(peer?.chatType));
    const peerUid = normalizeText(peer?.peerUid);
    const msgSeq = normalizeText(payload?.msgSeq);
    const emojiId = normalizeEmojiId(payload?.emojiId);
    if (!Number.isFinite(chatType) || chatType <= 0 || chatType === 1 || !peerUid ||
        !/^\d+$/.test(msgSeq) || !emojiId || typeof payload?.setEmoji !== 'boolean') {
        return null;
    }
    return {
        peer: {
            chatType,
            peerUid,
            guildId: normalizeText(peer?.guildId)
        },
        msgSeq,
        emojiId,
        emojiType: emojiId.length > 3 ? '2' : '1',
        setEmoji: payload.setEmoji
    };
}

module.exports = {
    UNFILTERED_REACTION_AQL_IDS,
    getEmojiResourceDirectory,
    loadAutoReactionEmojiCatalog,
    loadReactionEmojiCatalog,
    normalizeReactionRequest
};
