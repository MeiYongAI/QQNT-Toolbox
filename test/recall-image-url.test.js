'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createRecallImageUrlResolver } = require('../src/recall-image-url');

test('resolves QQ relative image paths without an rkey request', async () => {
    const resolver = createRecallImageUrlResolver({
        fetchImpl: () => assert.fail('rkey should not be requested')
    });
    const url = await resolver.resolve({
        originImageUrl: '/gchatpic_new/1/2-3-AABB/0?term=255'
    });
    assert.equal(url, 'https://gchat.qpic.cn/gchatpic_new/1/2-3-AABB/0?term=255');
});

test('adds the cached group rkey to NT image downloads', async () => {
    let requests = 0;
    const resolver = createRecallImageUrlResolver({
        now: () => 1_000_000,
        fetchImpl: async () => {
            requests += 1;
            return {
                ok: true,
                json: async () => ({
                    private_rkey: '&rkey=private-key',
                    group_rkey: '&rkey=group-key',
                    expired_time: 10_000
                })
            };
        }
    });
    const pic = { originImageUrl: '/download?appid=1407&fileid=file-id&spec=0' };
    const first = new URL(await resolver.resolve(pic));
    const second = new URL(await resolver.resolve(pic));

    assert.equal(first.host, 'multimedia.nt.qq.com.cn');
    assert.equal(first.searchParams.get('rkey'), 'group-key');
    assert.equal(second.searchParams.get('rkey'), 'group-key');
    assert.equal(requests, 1);
});

test('uses the private rkey for appid 1406 and preserves an existing rkey', async () => {
    let requests = 0;
    const resolver = createRecallImageUrlResolver({
        fetchImpl: async () => {
            requests += 1;
            return {
                ok: true,
                json: async () => ({
                    private_rkey: 'private-key',
                    group_rkey: 'group-key',
                    expired_time: Math.floor(Date.now() / 1000) + 3600
                })
            };
        }
    });
    const privateUrl = new URL(await resolver.resolve({
        originImageUrl: '/download?appid=1406&fileid=private-file'
    }));
    const existingUrl = new URL(await resolver.resolve({
        originImageUrl: '/download?appid=1407&fileid=group-file&rkey=existing-key'
    }));

    assert.equal(privateUrl.searchParams.get('rkey'), 'private-key');
    assert.equal(existingUrl.searchParams.get('rkey'), 'existing-key');
    assert.equal(requests, 1);
});

test('builds a legacy group image URL from an MD5 when no URL exists', async () => {
    const resolver = createRecallImageUrlResolver();
    assert.equal(
        await resolver.resolve({ md5HexStr: 'aabbccdd' }),
        'https://gchat.qpic.cn/gchatpic_new/0/0-0-AABBCCDD/0'
    );
});
