'use strict';

const GCHAT_IMAGE_HOST = 'https://gchat.qpic.cn';
const NT_IMAGE_HOST = 'https://multimedia.nt.qq.com.cn';
const DEFAULT_RKEY_ENDPOINT = 'https://rkey.furrycloud.top';

function normalizeRkey(value) {
    return String(value || '').trim().replace(/^&?rkey=/, '');
}

function collectUrlCandidates(picElement) {
    const candidates = [picElement?.originImageUrl, picElement?.emojiWebUrl];
    const thumbPath = picElement?.thumbPath;
    if (typeof thumbPath === 'string') {
        candidates.push(thumbPath);
    } else if (thumbPath instanceof Map) {
        candidates.push(...thumbPath.values());
    } else if (Array.isArray(thumbPath)) {
        candidates.push(...thumbPath);
    } else if (thumbPath && typeof thumbPath === 'object') {
        candidates.push(...Object.values(thumbPath));
    }
    return candidates.map(value => String(value || '').trim()).filter(Boolean);
}

function parseHttpUrl(value) {
    try {
        const parsed = new URL(value, GCHAT_IMAGE_HOST);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
    } catch {
        return null;
    }
}

function createRecallImageUrlResolver({
    fetchImpl = globalThis.fetch,
    now = Date.now,
    rkeyEndpoint = DEFAULT_RKEY_ENDPOINT
} = {}) {
    const cache = {
        privateRkey: '',
        groupRkey: '',
        expiresAt: 0
    };
    let pendingRkeys = null;

    async function getRkeys() {
        if (now() < cache.expiresAt - 30_000 && (cache.privateRkey || cache.groupRkey)) {
            return cache;
        }
        if (pendingRkeys) {
            return await pendingRkeys;
        }
        pendingRkeys = (async () => {
            if (typeof fetchImpl !== 'function') {
                throw new Error('Fetch is unavailable.');
            }
            const response = await fetchImpl(rkeyEndpoint);
            if (!response?.ok) {
                throw new Error(`Rkey request failed: HTTP ${response?.status || 0}`);
            }
            const data = await response.json();
            cache.privateRkey = normalizeRkey(data?.private_rkey);
            cache.groupRkey = normalizeRkey(data?.group_rkey);
            cache.expiresAt = Number(data?.expired_time) * 1000 || 0;
            if (!cache.privateRkey && !cache.groupRkey) {
                throw new Error('Rkey response was empty.');
            }
            return cache;
        })();
        try {
            return await pendingRkeys;
        } finally {
            pendingRkeys = null;
        }
    }

    async function resolve(picElement) {
        let parsed = null;
        for (const candidate of collectUrlCandidates(picElement)) {
            parsed = parseHttpUrl(candidate);
            if (parsed) {
                break;
            }
        }
        if (!parsed) {
            const md5 = String(picElement?.md5HexStr || picElement?.originImageMd5 || '')
                .replace(/[^a-f0-9]/gi, '')
                .toUpperCase();
            return md5 ? `${GCHAT_IMAGE_HOST}/gchatpic_new/0/0-0-${md5}/0` : '';
        }

        const appid = parsed.searchParams.get('appid');
        if (appid !== '1406' && appid !== '1407') {
            return parsed.toString();
        }
        parsed.host = new URL(NT_IMAGE_HOST).host;
        if (!parsed.searchParams.get('rkey')) {
            let keys;
            try {
                keys = await getRkeys();
            } catch {
                return '';
            }
            const rkey = appid === '1406' ? keys.privateRkey : keys.groupRkey;
            if (!rkey) {
                return '';
            }
            parsed.searchParams.set('rkey', rkey);
        }
        return parsed.toString();
    }

    return { resolve };
}

const defaultResolver = createRecallImageUrlResolver();

module.exports = {
    createRecallImageUrlResolver,
    resolveRecallImageUrl: picElement => defaultResolver.resolve(picElement)
};
