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

test('uses real folders for categories and keeps manual ordering metadata', async t => {
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
    assert.equal((await fsPromises.stat(path.join(fixture.directory, '收藏'))).isDirectory(), true);

    state = await fixture.library.action(fixture.directory, {
        type: 'assign',
        categoryId: firstCategory.categoryId,
        imageIds: ['newer.png']
    });
    assert.equal(state.images.find(image => image.id === '收藏/newer.png').categoryId, 'category-1');
    assert.equal(await fsPromises.readFile(path.join(fixture.directory, '收藏', 'newer.png'), 'utf8'), 'newer');
    await assert.rejects(fsPromises.access(path.join(fixture.directory, 'newer.png')));

    state = await fixture.library.action(fixture.directory, {
        type: 'reorder-categories',
        categoryIds: ['category-2', 'category-1']
    });
    assert.deepEqual(state.categories.map(category => category.id), ['category-2', 'category-1']);

    state = await fixture.library.action(fixture.directory, {
        type: 'reorder-images',
        categoryId: 'all',
        imageIds: ['older.png', '收藏/newer.png']
    });
    assert.deepEqual(state.images.map(image => image.id), ['older.png', '收藏/newer.png']);

    state = await fixture.library.action(fixture.directory, {
        type: 'rename-image',
        imageId: '收藏/newer.png',
        name: '已收藏图片'
    });
    assert.equal(state.imageId, '收藏/已收藏图片.png');
    assert.equal(state.images.find(image => image.id === state.imageId).categoryId, 'category-1');

    state = await fixture.library.action(fixture.directory, {
        type: 'rename-category',
        categoryId: firstCategory.categoryId,
        name: '珍藏'
    });
    assert.equal(state.categories.find(category => category.id === firstCategory.categoryId).name, '珍藏');
    assert.equal(state.images.find(image => image.id === '珍藏/已收藏图片.png').categoryId, 'category-1');
    await assert.rejects(fsPromises.access(path.join(fixture.directory, '收藏')));

    await fixture.library.action(fixture.directory, {
        type: 'copy-image',
        imageId: '珍藏/已收藏图片.png'
    });
    await fixture.library.action(fixture.directory, {
        type: 'open-directory',
        imageId: '珍藏/已收藏图片.png'
    });
    assert.equal(path.basename(fixture.calls.copied[0]), '已收藏图片.png');
    assert.equal(path.basename(fixture.calls.revealed[0][1]), '已收藏图片.png');

    state = await fixture.library.action(fixture.directory, {
        type: 'delete-category',
        categoryId: firstCategory.categoryId
    });
    assert.equal(state.images.find(image => image.id === '已收藏图片.png').categoryId, '');
    assert.equal(await fsPromises.readFile(path.join(fixture.directory, '已收藏图片.png'), 'utf8'), 'newer');
    await assert.rejects(fsPromises.access(path.join(fixture.directory, '珍藏')));

    state = await fixture.library.action(fixture.directory, {
        type: 'delete-images',
        imageIds: ['older.png']
    });
    assert.equal(state.deletedCount, 1);
    assert.deepEqual(state.images.map(image => image.id), ['已收藏图片.png']);

    const metadata = JSON.parse(await fsPromises.readFile(fixture.metadataPath, 'utf8'));
    assert.equal(metadata.version, 2);
    assert.equal(metadata.libraries[0].layout, 'folders');
    assert.equal('assignments' in metadata.libraries[0], false);
});

test('keeps image ordering scoped to the active folder category', async t => {
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
        imageIds: ['一组/older.png', '一组/newer.png']
    });
    const grouped = state.images.filter(image => image.categoryId === category.categoryId);
    assert.deepEqual(grouped.map(image => image.id), ['一组/older.png', '一组/newer.png']);
    assert.equal(state.images.filter(image => !image.categoryId).length, 1);
});

test('discovers folder categories and supports equal file names in different folders', async t => {
    const fixture = await createFixture();
    t.after(() => fsPromises.rm(fixture.root, { recursive: true, force: true }));
    await fsPromises.mkdir(path.join(fixture.directory, '表情'));
    await fsPromises.mkdir(path.join(fixture.directory, '收藏'));
    await fsPromises.writeFile(path.join(fixture.directory, '表情', 'same.png'), Buffer.from('first'));
    await fsPromises.writeFile(path.join(fixture.directory, '收藏', 'same.png'), Buffer.from('second'));
    await fsPromises.writeFile(path.join(fixture.directory, '收藏', 'upper.PNG'), Buffer.from('upper'));

    const state = await fixture.library.getState(fixture.directory);
    assert.deepEqual(state.categories.map(category => category.name), ['表情', '收藏']);
    assert.ok(state.images.some(image => image.id === '表情/same.png'));
    assert.ok(state.images.some(image => image.id === '收藏/same.png'));
    assert.ok(state.images.some(image => image.id === '收藏/upper.PNG'));
});

test('migrates version 1 logical assignments into category folders', async t => {
    const fixture = await createFixture();
    t.after(() => fsPromises.rm(fixture.root, { recursive: true, force: true }));
    await fsPromises.writeFile(fixture.metadataPath, JSON.stringify({
        version: 1,
        libraries: [{
            directory: fixture.directory,
            categories: [{ id: 'legacy-category', name: '旧分类' }],
            order: ['newer.png', 'older.png'],
            assignments: { 'newer.png': 'legacy-category' }
        }]
    }));

    const state = await fixture.library.getState(fixture.directory);
    assert.equal(state.images.find(image => image.id === '旧分类/newer.png').categoryId, 'legacy-category');
    assert.equal(await fsPromises.readFile(path.join(fixture.directory, '旧分类', 'newer.png'), 'utf8'), 'newer');
    const metadata = JSON.parse(await fsPromises.readFile(fixture.metadataPath, 'utf8'));
    assert.equal(metadata.version, 2);
    assert.equal(metadata.libraries[0].layout, 'folders');
});

test('rejects duplicate names, unsafe paths and category deletion with foreign files', async t => {
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

    const category = await fixture.library.action(fixture.directory, {
        type: 'create-category',
        name: '不可删除'
    });
    await fsPromises.writeFile(path.join(fixture.directory, '不可删除', 'note.txt'), 'keep');
    const deletion = await fixture.library.action(fixture.directory, {
        type: 'delete-category',
        categoryId: category.categoryId
    });
    assert.deepEqual(deletion, { ok: false, reason: 'category-directory-not-empty' });
    assert.equal(await fsPromises.readFile(path.join(fixture.directory, '不可删除', 'note.txt'), 'utf8'), 'keep');
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
