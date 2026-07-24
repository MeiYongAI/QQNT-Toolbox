'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    LocalStickerDownloadError,
    downloadTelegramStickerPack,
    findExecutableOnPath,
    getEnvironmentHttpProxy,
    inspectLocalStickerTools,
    normalizeHttpProxyUrl,
    normalizeTelegramBotToken,
    parseTelegramStickerSetUrl,
    readLimitedResponseBuffer
} = require('../src/local-sticker-downloader');

async function createTempDirectory(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qqnt-toolbox-tg-stickers-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    return directory;
}

function jsonResponse(value) {
    return new Response(JSON.stringify(value), {
        status: 200,
        headers: { 'content-type': 'application/json' }
    });
}

test('parses only Telegram sticker-set links and validates download credentials', () => {
    assert.deepEqual(parseTelegramStickerSetUrl('https://t.me/addstickers/Test_pack?single'), {
        name: 'Test_pack',
        url: 'https://t.me/addstickers/Test_pack'
    });
    assert.equal(parseTelegramStickerSetUrl('http://t.me/addstickers/Test_pack'), null);
    assert.equal(parseTelegramStickerSetUrl('https://example.com/addstickers/Test_pack'), null);
    assert.equal(parseTelegramStickerSetUrl('https://t.me/Test_pack'), null);

    assert.equal(
        normalizeTelegramBotToken(' 123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef '),
        '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef'
    );
    assert.equal(normalizeTelegramBotToken('not-a-token'), '');
    assert.equal(normalizeHttpProxyUrl('http://127.0.0.1:7890/'), 'http://127.0.0.1:7890');
    assert.equal(normalizeHttpProxyUrl('https://127.0.0.1:7890'), '');
    assert.equal(normalizeHttpProxyUrl('http://user:pass@127.0.0.1:7890'), '');
    assert.deepEqual(getEnvironmentHttpProxy({
        HTTP_PROXY: 'http://127.0.0.1:7890'
    }), {
        url: 'http://127.0.0.1:7890',
        source: 'HTTP_PROXY'
    });
    assert.deepEqual(getEnvironmentHttpProxy({
        HTTPS_PROXY: 'socks5://127.0.0.1:1080'
    }), { url: '', source: '' });
});

test('finds optional sticker converters from PATH without requiring saved paths', async t => {
    const directory = await createTempDirectory(t);
    const executable = process.platform === 'win32' ? 'test_sticker_tool.exe' : 'test_sticker_tool';
    const executablePath = path.join(directory, executable);
    await fs.writeFile(executablePath, 'tool');
    const environment = {
        PATH: directory,
        PATHEXT: '.EXE'
    };
    const resolved = await findExecutableOnPath('test_sticker_tool', {
        environment,
        platform: process.platform
    });
    assert.equal(resolved, await fs.realpath(executablePath));

    const tools = await inspectLocalStickerTools({
        environment,
        platform: process.platform,
        ffmpegPath: executablePath
    });
    assert.equal(tools.ffmpeg.available, true);
    assert.equal(tools.ffmpeg.source, 'configured');
    assert.equal(tools.tgsToGif.available, false);
});

test('rejects a response before reading a declared oversized body', async () => {
    const response = new Response('small', {
        headers: { 'content-length': '1000' }
    });
    await assert.rejects(
        readLimitedResponseBuffer(response, 100),
        error => error instanceof LocalStickerDownloadError && error.code === 'response-too-large'
    );
});

test('downloads a bounded static Telegram sticker pack into its configured root', async t => {
    const root = await createTempDirectory(t);
    const token = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef';
    const requests = [];
    const fakeFetch = async value => {
        const url = new URL(String(value));
        requests.push(url.pathname);
        if (url.pathname.endsWith('/getStickerSet')) {
            return jsonResponse({
                ok: true,
                result: {
                    name: 'Test_pack',
                    title: '测试贴纸',
                    sticker_type: 'regular',
                    stickers: [
                        { file_id: 'file-one', file_unique_id: 'unique-one' },
                        { file_id: 'file-two', file_unique_id: 'unique-two' }
                    ]
                }
            });
        }
        if (url.pathname.endsWith('/getFile')) {
            const id = url.searchParams.get('file_id');
            return jsonResponse({
                ok: true,
                result: { file_path: `stickers/${id}.webp` }
            });
        }
        if (url.pathname.includes('/file/bot')) {
            return new Response(Buffer.from(`image:${path.basename(url.pathname)}`), {
                status: 200,
                headers: { 'content-type': 'image/webp' }
            });
        }
        throw new Error('unexpected request');
    };

    const result = await downloadTelegramStickerPack({
        url: 'https://t.me/addstickers/Test_pack',
        rootPath: root,
        botToken: token,
        fetch: fakeFetch
    });
    assert.equal(result.ok, true);
    assert.equal(result.downloaded, 2);
    assert.equal(result.failed, 0);
    assert.equal(requests.filter(item => item.endsWith('/getFile')).length, 2);

    const packDirectory = path.join(root, 'Test_pack');
    const files = (await fs.readdir(packDirectory)).sort();
    assert.deepEqual(files, ['sticker.json', 'unique-one.webp', 'unique-two.webp']);
    const metadata = JSON.parse(await fs.readFile(path.join(packDirectory, 'sticker.json'), 'utf8'));
    assert.equal(metadata.label, '测试贴纸');
    assert.equal(metadata.icon, 'unique-one.webp');
    assert.equal(metadata.url, 'https://t.me/addstickers/Test_pack');
});
