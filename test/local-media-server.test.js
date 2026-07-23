'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createLocalMediaServer, parseByteRange } = require('../src/local-media-server');

test('parses normal, open-ended, and suffix byte ranges', () => {
    assert.deepEqual(parseByteRange('bytes=2-5', 10), { start: 2, end: 5 });
    assert.deepEqual(parseByteRange('bytes=7-', 10), { start: 7, end: 9 });
    assert.deepEqual(parseByteRange('bytes=-3', 10), { start: 7, end: 9 });
    assert.equal(parseByteRange('bytes=10-12', 10), null);
});

test('streams local media with HTTP range support', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-toolbox-media-'));
    const filePath = path.join(directory, 'sample.mp4');
    fs.writeFileSync(filePath, Buffer.from('0123456789'));
    const server = createLocalMediaServer();
    t.after(() => {
        server.close();
        fs.rmSync(directory, { recursive: true, force: true });
    });

    const url = await server.getUrl(filePath);
    const response = await fetch(url, { headers: { Range: 'bytes=2-5' } });

    assert.equal(response.status, 206);
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.equal(response.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(await response.text(), '2345');
});

test('serves images with a browser-decodable content type and cache policy', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-toolbox-media-'));
    const filePath = path.join(directory, 'sample.webp');
    fs.writeFileSync(filePath, Buffer.from('image'));
    const server = createLocalMediaServer();
    t.after(() => {
        server.close();
        fs.rmSync(directory, { recursive: true, force: true });
    });

    const response = await fetch(await server.getUrl(filePath));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/webp');
    assert.equal(response.headers.get('cache-control'), 'private, max-age=300');
    assert.equal(await response.text(), 'image');
});

test('does not guess whether a missing media file has finished downloading', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-toolbox-media-'));
    const filePath = path.join(directory, 'pending.jpg');
    const server = createLocalMediaServer();
    t.after(() => {
        server.close();
        fs.rmSync(directory, { recursive: true, force: true });
    });

    const url = await server.getUrl(filePath);
    assert.equal((await fetch(url)).status, 404);

    fs.writeFileSync(filePath, Buffer.from('ready'));
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.equal(await response.text(), 'ready');
});

test('evicts the least recently used media URL from its bounded registry', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-toolbox-media-'));
    const paths = ['first.png', 'second.png', 'third.png'].map(name => {
        const filePath = path.join(directory, name);
        fs.writeFileSync(filePath, name);
        return filePath;
    });
    const server = createLocalMediaServer({ maxEntries: 2 });
    t.after(() => {
        server.close();
        fs.rmSync(directory, { recursive: true, force: true });
    });

    const firstUrl = await server.getUrl(paths[0]);
    const secondUrl = await server.getUrl(paths[1]);
    assert.equal((await fetch(firstUrl)).status, 200);
    await server.getUrl(paths[2]);

    assert.equal((await fetch(firstUrl)).status, 200);
    assert.equal((await fetch(secondUrl)).status, 404);
});
