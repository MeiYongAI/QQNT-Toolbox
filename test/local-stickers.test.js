'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    buildLocalStickerStore,
    isPathInside,
    normalizeLocalStickerConfig,
    readRecentStickerPaths,
    rememberRecentSticker,
    resolveLocalStickerPath,
    scanLocalStickerPacks,
    updateLocalStickerPackOrder
} = require('../src/local-stickers');

async function createTempDirectory(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qqnt-toolbox-stickers-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    return directory;
}

test('normalizes local sticker settings to bounded values', () => {
    assert.deepEqual(normalizeLocalStickerConfig({
        enabled: true,
        path: '  D:\\stickers  ',
        entryMode: 'invalid',
        iconOnLeft: true,
        stickersPerRow: 99,
        panelWidth: 10,
        panelHeight: 9000,
        sendAsImage: true,
        directSendMode: 'click',
        recentEnabled: false,
        recentRows: 0,
        telegramBotToken: '  123456:abcdefghijklmnopqrstuvwxyz  ',
        ffmpegPath: '  D:\\tools\\ffmpeg.exe  ',
        tgsToGifPath: '  D:\\tools\\tgs_to_gif.exe  '
    }), {
        enabled: true,
        path: 'D:\\stickers',
        entryMode: 'contextmenu',
        iconOnLeft: true,
        stickersPerRow: 10,
        panelWidth: 280,
        panelHeight: 640,
        sendAsImage: true,
        directSendMode: 'click',
        recentEnabled: false,
        recentRows: 1,
        telegramBotToken: '123456:abcdefghijklmnopqrstuvwxyz',
        ffmpegPath: 'D:\\tools\\ffmpeg.exe',
        tgsToGifPath: 'D:\\tools\\tgs_to_gif.exe'
    });
});

test('uses a supplied default directory only when no custom directory exists', () => {
    assert.equal(normalizeLocalStickerConfig({ directSendMode: 'invalid' }).directSendMode, 'alt');
    assert.equal(normalizeLocalStickerConfig({}, {
        defaultPath: '  D:\\toolbox\\data\\stickers  '
    }).path, 'D:\\toolbox\\data\\stickers');
    assert.equal(normalizeLocalStickerConfig({
        path: '  E:\\my-stickers  '
    }, {
        defaultPath: 'D:\\toolbox\\data\\stickers'
    }).path, 'E:\\my-stickers');
});

test('scans image packs and applies bounded sticker.json metadata', async t => {
    const root = await createTempDirectory(t);
    const first = path.join(root, 'first');
    const second = path.join(root, 'second');
    await fs.mkdir(first);
    await fs.mkdir(second);
    await Promise.all([
        fs.writeFile(path.join(first, 'a.png'), 'a'),
        fs.writeFile(path.join(first, 'b.webp'), 'b'),
        fs.writeFile(path.join(first, 'ignored.txt'), 'ignored'),
        fs.writeFile(path.join(second, 'c.gif'), 'c'),
        fs.writeFile(path.join(first, 'sticker.json'), JSON.stringify({
            label: '第二包',
            index: 20,
            icon: 'b.webp'
        })),
        fs.writeFile(path.join(second, 'sticker.json'), JSON.stringify({
            label: '第一包',
            index: 10,
            icon: '../first/a.png'
        }))
    ]);

    const result = await scanLocalStickerPacks(root);
    assert.equal(result.status, 'success');
    assert.deepEqual(result.stickerPacks.map(pack => pack.label), ['第一包', '第二包']);
    assert.deepEqual(result.stickerPacks.map(pack => pack.stickers.length), [1, 2]);
    assert.equal(result.stickerPacks[0].icon, result.stickerPacks[0].stickers[0].path);
    assert.equal(path.basename(result.stickerPacks[1].icon), 'b.webp');
});

test('recent stickers are deduplicated, bounded and limited to the selected root', async t => {
    const root = await createTempDirectory(t);
    const packDirectory = path.join(root, 'pack');
    const outsideDirectory = await createTempDirectory(t);
    const first = path.join(packDirectory, 'first.png');
    const second = path.join(packDirectory, 'second.jpg');
    const outside = path.join(outsideDirectory, 'outside.png');
    await fs.mkdir(packDirectory);
    await Promise.all([
        fs.writeFile(first, 'first'),
        fs.writeFile(second, 'second'),
        fs.writeFile(outside, 'outside')
    ]);

    assert.equal((await rememberRecentSticker(root, first, 3)).ok, true);
    assert.equal((await rememberRecentSticker(root, second, 3)).ok, true);
    assert.equal((await rememberRecentSticker(root, first, 3)).ok, true);
    assert.equal((await rememberRecentSticker(root, outside, 3)).ok, false);
    assert.deepEqual(
        (await readRecentStickerPaths(root)).map(filePath => path.basename(filePath)),
        ['first.png', 'second.jpg']
    );

    const scan = await scanLocalStickerPacks(root);
    const store = buildLocalStickerStore(scan, await readRecentStickerPaths(root), {
        enabled: true,
        recentEnabled: true,
        stickersPerRow: 3,
        recentRows: 1
    });
    assert.equal(store.status, 'success');
    assert.equal(store.stickerPacks[0].recent, true);
    assert.deepEqual(
        store.stickerPacks[0].stickers.map(sticker => path.basename(sticker.path)),
        ['first.png', 'second.jpg']
    );
});

test('resolves only supported files physically contained by the sticker root', async t => {
    const root = await createTempDirectory(t);
    const inside = path.join(root, 'inside.png');
    const unsupported = path.join(root, 'inside.txt');
    const outsideDirectory = await createTempDirectory(t);
    const outside = path.join(outsideDirectory, 'outside.png');
    await Promise.all([
        fs.writeFile(inside, 'inside'),
        fs.writeFile(unsupported, 'unsupported'),
        fs.writeFile(outside, 'outside')
    ]);

    assert.equal(await resolveLocalStickerPath(root, inside), await fs.realpath(inside));
    assert.equal(await resolveLocalStickerPath(root, unsupported), '');
    assert.equal(await resolveLocalStickerPath(root, outside), '');
    assert.equal(isPathInside(root, inside), true);
    assert.equal(isPathInside(root, path.join(root, '..', 'outside.png')), false);
});

test('persists sticker pack order without discarding existing metadata', async t => {
    const root = await createTempDirectory(t);
    const first = path.join(root, 'first');
    const second = path.join(root, 'second');
    await Promise.all([fs.mkdir(first), fs.mkdir(second)]);
    await Promise.all([
        fs.writeFile(path.join(first, 'one.png'), 'one'),
        fs.writeFile(path.join(second, 'two.png'), 'two'),
        fs.writeFile(path.join(first, 'sticker.json'), JSON.stringify({
            label: '第一包',
            index: 0,
            url: 'https://example.com/first'
        })),
        fs.writeFile(path.join(second, 'sticker.json'), JSON.stringify({
            label: '第二包',
            index: 1,
            custom: 'keep-me'
        }))
    ]);

    const result = await updateLocalStickerPackOrder(root, [second, first]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.order.map(item => path.basename(item)), ['second', 'first']);
    const firstMetadata = JSON.parse(await fs.readFile(path.join(first, 'sticker.json'), 'utf8'));
    const secondMetadata = JSON.parse(await fs.readFile(path.join(second, 'sticker.json'), 'utf8'));
    assert.equal(firstMetadata.index, 1);
    assert.equal(firstMetadata.url, 'https://example.com/first');
    assert.equal(secondMetadata.index, 0);
    assert.equal(secondMetadata.custom, 'keep-me');
});
