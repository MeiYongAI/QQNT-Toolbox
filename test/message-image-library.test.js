'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createMessageImageLibrary } = require('../src/message-image-library');

const managerSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'message-image-manager.js'),
    'utf8'
);
const managerStyle = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'message-image-manager.css'),
    'utf8'
);

async function createFixture() {
    const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'qqnt-message-images-'));
    const directory = path.join(root, 'images');
    const metadataPath = path.join(root, 'library.json');
    await fsPromises.mkdir(directory);
    await fsPromises.writeFile(path.join(directory, 'older.png'), Buffer.from('older'));
    await fsPromises.writeFile(path.join(directory, 'newer.png'), Buffer.from('newer'));
    await fsPromises.writeFile(path.join(directory, 'ignored.jpg'), Buffer.from('ignored'));
    const oldDate = new Date('2026-07-24T10:00:00Z');
    const newDate = new Date('2026-07-25T10:00:00Z');
    await fsPromises.utimes(path.join(directory, 'older.png'), oldDate, oldDate);
    await fsPromises.utimes(path.join(directory, 'newer.png'), newDate, newDate);
    let id = 0;
    const calls = { copied: [], revealed: [] };
    const library = createMessageImageLibrary({
        metadataPath,
        createId: () => `category-${++id}`,
        copyImage: async filePath => calls.copied.push(filePath),
        revealImage: async (rootPath, filePath) => calls.revealed.push([rootPath, filePath])
    });
    return { root, directory, metadataPath, library, calls };
}

test('manages logical categories, manual order, rename, copy and delete without moving images', async t => {
    const fixture = await createFixture();
    t.after(() => fsPromises.rm(fixture.root, { recursive: true, force: true }));

    let state = await fixture.library.getState(fixture.directory);
    assert.deepEqual(state.images.map(image => image.id), ['newer.png', 'older.png']);
    assert.equal(state.totalCount, 2);
    assert.equal(state.uncategorizedCount, 2);

    const firstCategory = await fixture.library.action(fixture.directory, {
        type: 'create-category',
        name: '收藏'
    });
    const secondCategory = await fixture.library.action(fixture.directory, {
        type: 'create-category',
        name: '稍后处理'
    });
    assert.equal(firstCategory.categoryId, 'category-1');
    assert.equal(secondCategory.categoryId, 'category-2');

    state = await fixture.library.action(fixture.directory, {
        type: 'assign',
        categoryId: firstCategory.categoryId,
        imageIds: ['newer.png']
    });
    assert.equal(state.images.find(image => image.id === 'newer.png').categoryId, 'category-1');
    assert.equal(await fsPromises.readFile(path.join(fixture.directory, 'newer.png'), 'utf8'), 'newer');

    state = await fixture.library.action(fixture.directory, {
        type: 'reorder-categories',
        categoryIds: ['category-2', 'category-1']
    });
    assert.deepEqual(state.categories.map(category => category.id), ['category-2', 'category-1']);

    state = await fixture.library.action(fixture.directory, {
        type: 'reorder-images',
        categoryId: 'all',
        imageIds: ['older.png', 'newer.png']
    });
    assert.deepEqual(state.images.map(image => image.id), ['older.png', 'newer.png']);

    state = await fixture.library.action(fixture.directory, {
        type: 'rename-image',
        imageId: 'newer.png',
        name: '已收藏图片'
    });
    assert.equal(state.imageId, '已收藏图片.png');
    assert.equal(state.images.find(image => image.id === '已收藏图片.png').categoryId, 'category-1');
    await assert.rejects(fsPromises.access(path.join(fixture.directory, 'newer.png')));

    await fixture.library.action(fixture.directory, {
        type: 'copy-image',
        imageId: '已收藏图片.png'
    });
    await fixture.library.action(fixture.directory, {
        type: 'open-directory',
        imageId: '已收藏图片.png'
    });
    assert.equal(path.basename(fixture.calls.copied[0]), '已收藏图片.png');
    assert.equal(path.basename(fixture.calls.revealed[0][1]), '已收藏图片.png');

    state = await fixture.library.action(fixture.directory, {
        type: 'delete-category',
        categoryId: 'category-1'
    });
    assert.equal(state.images.find(image => image.id === '已收藏图片.png').categoryId, '');

    state = await fixture.library.action(fixture.directory, {
        type: 'delete-images',
        imageIds: ['older.png']
    });
    assert.equal(state.deletedCount, 1);
    assert.deepEqual(state.images.map(image => image.id), ['已收藏图片.png']);
    assert.equal(JSON.parse(await fsPromises.readFile(fixture.metadataPath, 'utf8')).version, 1);
});

test('keeps image ordering scoped to the active category', async t => {
    const fixture = await createFixture();
    t.after(() => fsPromises.rm(fixture.root, { recursive: true, force: true }));
    await fsPromises.writeFile(path.join(fixture.directory, 'third.png'), Buffer.from('third'));
    const category = await fixture.library.action(fixture.directory, {
        type: 'create-category',
        name: '一组'
    });
    await fixture.library.action(fixture.directory, {
        type: 'assign',
        categoryId: category.categoryId,
        imageIds: ['newer.png', 'older.png']
    });

    const state = await fixture.library.action(fixture.directory, {
        type: 'reorder-images',
        categoryId: category.categoryId,
        imageIds: ['older.png', 'newer.png']
    });
    const grouped = state.images.filter(image => image.categoryId === category.categoryId);
    assert.deepEqual(grouped.map(image => image.id), ['older.png', 'newer.png']);
    assert.equal(state.images.filter(image => !image.categoryId).length, 1);
});

test('rejects duplicate names and paths outside the managed image directory', async t => {
    const fixture = await createFixture();
    t.after(() => fsPromises.rm(fixture.root, { recursive: true, force: true }));

    const conflict = await fixture.library.action(fixture.directory, {
        type: 'rename-image',
        imageId: 'newer.png',
        name: 'older.png'
    });
    assert.deepEqual(conflict, { ok: false, reason: 'image-name-conflict' });
    const outside = await fixture.library.action(fixture.directory, {
        type: 'delete-images',
        imageIds: ['..\\outside.png']
    });
    assert.deepEqual(outside, { ok: false, reason: 'image-selection-empty' });
});

test('uses a compact standalone manager with selection, preview and pointer sorting', () => {
    assert.match(managerSource, /createMessageImageManager/);
    assert.match(managerSource, /type: 'assign'/);
    assert.match(managerSource, /type: 'rename-image'/);
    assert.match(managerSource, /type: 'copy-image'/);
    assert.match(managerSource, /type: 'delete-images'/);
    assert.match(managerSource, /type: 'reorder-images'/);
    assert.match(managerSource, /addEventListener\('pointermove'/);
    assert.match(managerSource, /addEventListener\('dblclick'/);
    assert.match(managerSource, /event\.key !== 'Escape'/);
    assert.doesNotMatch(managerSource, /\bprompt\s*\(|\bconfirm\s*\(/);
    assert.match(managerStyle, /width:\s*min\(760px,/);
    assert.match(managerStyle, /height:\s*min\(540px,/);
    assert.match(managerStyle, /grid-template-columns:\s*158px minmax\(0, 1fr\)/);
    assert.match(managerStyle, /grid-template-columns:\s*repeat\(auto-fill, minmax\(128px, 1fr\)\)/);
});
