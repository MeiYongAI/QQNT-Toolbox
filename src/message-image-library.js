'use strict';

const nodeFs = require('fs').promises;
const nodePath = require('path');
const crypto = require('crypto');

const METADATA_VERSION = 2;
const MAX_LIBRARIES = 32;
const MAX_CATEGORIES = 64;
const MAX_IMAGES = 5000;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;

function normalizeText(value) {
    return String(value ?? '').trim();
}

function normalizeDirectoryKey(directory, pathApi = nodePath) {
    const resolved = pathApi.resolve(normalizeText(directory));
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function normalizeFileKey(fileName) {
    const normalized = normalizeText(fileName).replace(/\\/g, '/');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function normalizeCategoryKey(name) {
    const normalized = normalizeText(name);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isPathInside(rootPath, candidatePath, pathApi = nodePath) {
    const root = pathApi.resolve(rootPath);
    const candidate = pathApi.resolve(candidatePath);
    const relative = pathApi.relative(root, candidate);
    return relative === '' || (
        relative !== '..' &&
        !relative.startsWith(`..${pathApi.sep}`) &&
        !pathApi.isAbsolute(relative)
    );
}

function sanitizeCategoryName(value) {
    let name = normalizeText(value)
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
        .replace(/[. ]+$/g, '')
        .slice(0, 40);
    if (!name || name === '.' || name === '..') {
        return '';
    }
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
        name = `_${name}`;
    }
    return name;
}

function sanitizeManagedImageName(value, pathApi = nodePath) {
    let name = normalizeText(value)
        .replace(/\.png$/i, '')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
        .replace(/[. ]+$/g, '')
        .slice(0, 180);
    if (!name) {
        return '';
    }
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
        name = `_${name}`;
    }
    const fileName = `${name}.png`;
    return pathApi.extname(fileName).toLowerCase() === '.png' ? fileName : '';
}

function normalizeImageId(value, pathApi = nodePath) {
    const portable = normalizeText(value).replace(/\\/g, '/');
    const parts = portable.split('/');
    if (!portable || parts.length < 1 || parts.length > 2 || parts.some(part => !part)) {
        return '';
    }
    const fileName = parts.at(-1);
    const extension = pathApi.extname(fileName);
    const stem = extension ? fileName.slice(0, -extension.length) : fileName;
    const sanitizedStem = sanitizeManagedImageName(stem, pathApi).replace(/\.png$/i, '');
    if (fileName !== pathApi.basename(fileName) || extension.toLowerCase() !== '.png' ||
        sanitizedStem !== stem) {
        return '';
    }
    if (parts.length === 2 && sanitizeCategoryName(parts[0]) !== parts[0]) {
        return '';
    }
    return parts.join('/');
}

function imageIdParts(value, pathApi = nodePath) {
    const id = normalizeImageId(value, pathApi);
    if (!id) {
        return null;
    }
    const parts = id.split('/');
    return {
        id,
        categoryName: parts.length === 2 ? parts[0] : '',
        fileName: parts.at(-1)
    };
}

function createImageId(categoryName, fileName, pathApi = nodePath) {
    return normalizeImageId(categoryName ? `${categoryName}/${fileName}` : fileName, pathApi);
}

function uniqueImageIds(values, pathApi = nodePath) {
    const result = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
        const id = normalizeImageId(value, pathApi);
        const key = normalizeFileKey(id);
        if (id && !seen.has(key)) {
            seen.add(key);
            result.push(id);
        }
    }
    return result;
}

function normalizeCategories(values) {
    const result = [];
    const ids = new Set();
    const names = new Set();
    for (const value of Array.isArray(values) ? values : []) {
        const id = normalizeText(value?.id).slice(0, 80);
        const name = sanitizeCategoryName(value?.name);
        const nameKey = normalizeCategoryKey(name);
        if (!id || !name || ids.has(id) || names.has(nameKey)) {
            continue;
        }
        ids.add(id);
        names.add(nameKey);
        result.push({ id, name });
        if (result.length >= MAX_CATEGORIES) {
            break;
        }
    }
    return result;
}

function normalizeAssignments(value, categories, pathApi) {
    const categoryIds = new Set(categories.map(category => category.id));
    const assignments = {};
    for (const [rawId, rawCategoryId] of Object.entries(value || {})) {
        const id = normalizeImageId(rawId, pathApi);
        const categoryId = normalizeText(rawCategoryId);
        if (id && !id.includes('/') && categoryIds.has(categoryId)) {
            assignments[id] = categoryId;
        }
    }
    return assignments;
}

function normalizeLibrary(value, pathApi = nodePath, metadataVersion = 0) {
    const directory = normalizeText(value?.directory);
    const categories = normalizeCategories(value?.categories);
    const folderLayout = metadataVersion >= 2 && value?.layout === 'folders';
    return {
        directory,
        categories,
        order: uniqueImageIds(value?.order, pathApi).slice(0, MAX_IMAGES),
        layout: folderLayout ? 'folders' : 'logical',
        assignments: folderLayout ? {} : normalizeAssignments(value?.assignments, categories, pathApi)
    };
}

function normalizeMetadata(value, pathApi = nodePath) {
    const sourceVersion = Math.max(0, Math.floor(Number(value?.version) || 0));
    const libraries = [];
    const keys = new Set();
    for (const source of Array.isArray(value?.libraries) ? value.libraries : []) {
        const library = normalizeLibrary(source, pathApi, sourceVersion);
        if (!library.directory || !pathApi.isAbsolute(library.directory)) {
            continue;
        }
        const key = normalizeDirectoryKey(library.directory, pathApi);
        if (keys.has(key)) {
            continue;
        }
        keys.add(key);
        libraries.push(library);
        if (libraries.length >= MAX_LIBRARIES) {
            break;
        }
    }
    return { version: METADATA_VERSION, libraries };
}

async function readMetadata(fsApi, metadataPath, pathApi) {
    try {
        const stat = await fsApi.stat(metadataPath);
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_METADATA_BYTES) {
            return normalizeMetadata({}, pathApi);
        }
        return normalizeMetadata(JSON.parse(await fsApi.readFile(metadataPath, 'utf8')), pathApi);
    } catch {
        return normalizeMetadata({}, pathApi);
    }
}

async function writeMetadata(fsApi, metadataPath, metadata, pathApi) {
    const normalized = normalizeMetadata(metadata, pathApi);
    const serializable = {
        version: METADATA_VERSION,
        libraries: normalized.libraries.map(library => ({
            directory: library.directory,
            categories: library.categories,
            order: library.order,
            layout: library.layout,
            ...(library.layout === 'logical' && Object.keys(library.assignments).length
                ? { assignments: library.assignments }
                : {})
        }))
    };
    await fsApi.mkdir(pathApi.dirname(metadataPath), { recursive: true });
    await fsApi.writeFile(metadataPath, JSON.stringify(serializable, null, 2), 'utf8');
}

function getOrCreateLibrary(metadata, directory, pathApi) {
    const key = normalizeDirectoryKey(directory, pathApi);
    let library = metadata.libraries.find(item => normalizeDirectoryKey(item.directory, pathApi) === key);
    if (!library) {
        library = {
            directory: pathApi.resolve(directory),
            categories: [],
            order: [],
            layout: 'folders',
            assignments: {}
        };
        metadata.libraries.push(library);
        if (metadata.libraries.length > MAX_LIBRARIES) {
            metadata.libraries.splice(0, metadata.libraries.length - MAX_LIBRARIES);
        }
    }
    library.directory = pathApi.resolve(directory);
    return library;
}

function createCategoryId(library, createId) {
    const existing = new Set(library.categories.map(category => category.id));
    for (let attempt = 0; attempt < 32; attempt += 1) {
        const id = normalizeText(createId()).slice(0, 80);
        if (id && !existing.has(id)) {
            return id;
        }
    }
    return `category-${crypto.randomUUID()}`;
}

function replaceImageId(library, oldId, newId) {
    library.order = library.order.map(id =>
        normalizeFileKey(id) === normalizeFileKey(oldId) ? newId : id
    );
}

async function pathExists(fsApi, filePath) {
    try {
        await fsApi.lstat(filePath);
        return true;
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

function appendImageCounter(fileName, counter, pathApi) {
    if (counter <= 1) {
        return fileName;
    }
    const extension = pathApi.extname(fileName) || '.png';
    return `${fileName.slice(0, -extension.length)} (${counter})${extension}`;
}

async function findMoveTarget(fsApi, targetDirectory, fileName, sourcePath, pathApi) {
    for (let counter = 1; counter <= 1000; counter += 1) {
        const targetName = appendImageCounter(fileName, counter, pathApi);
        const targetPath = pathApi.resolve(targetDirectory, targetName);
        if (normalizeDirectoryKey(targetPath, pathApi) === normalizeDirectoryKey(sourcePath, pathApi) ||
            !(await pathExists(fsApi, targetPath))) {
            return { fileName: targetName, filePath: targetPath };
        }
    }
    throw new Error('image-name-exhausted');
}

async function migrateLogicalLibrary(fsApi, directory, library, pathApi) {
    if (library.layout === 'folders') {
        return false;
    }
    await fsApi.mkdir(directory, { recursive: true });
    const categories = new Map(library.categories.map(category => [category.id, category]));
    for (const category of library.categories) {
        await fsApi.mkdir(pathApi.join(directory, category.name), { recursive: true });
    }
    for (const [rawId, categoryId] of Object.entries(library.assignments)) {
        const parts = imageIdParts(rawId, pathApi);
        const category = categories.get(categoryId);
        if (!parts || parts.categoryName || !category) {
            continue;
        }
        const sourcePath = pathApi.resolve(directory, parts.fileName);
        if (!(await pathExists(fsApi, sourcePath))) {
            continue;
        }
        const sourceStat = await fsApi.lstat(sourcePath);
        if (!sourceStat.isFile() || sourceStat.isSymbolicLink?.()) {
            continue;
        }
        const targetDirectory = pathApi.resolve(directory, category.name);
        const target = await findMoveTarget(fsApi, targetDirectory, parts.fileName, sourcePath, pathApi);
        await fsApi.rename(sourcePath, target.filePath);
        replaceImageId(library, parts.id, createImageId(category.name, target.fileName, pathApi));
    }
    library.layout = 'folders';
    library.assignments = {};
    return true;
}

async function scanImages(fsApi, directory, pathApi) {
    await fsApi.mkdir(directory, { recursive: true });
    const rootEntries = await fsApi.readdir(directory, { withFileTypes: true });
    const categoryNames = rootEntries
        .filter(entry => entry.isDirectory() && !entry.isSymbolicLink?.() &&
            sanitizeCategoryName(entry.name) === entry.name)
        .map(entry => entry.name)
        .sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' }))
        .slice(0, MAX_CATEGORIES);
    const sources = [{ categoryName: '', entries: rootEntries }];
    const nested = await Promise.all(categoryNames.map(async categoryName => ({
        categoryName,
        entries: await fsApi.readdir(pathApi.join(directory, categoryName), { withFileTypes: true })
    })));
    sources.push(...nested);
    const candidates = [];
    for (const source of sources) {
        for (const entry of source.entries) {
            if (candidates.length >= MAX_IMAGES) {
                break;
            }
            const id = createImageId(source.categoryName, entry.name, pathApi);
            if (entry.isFile() && !entry.isSymbolicLink?.() && id) {
                candidates.push({ id, categoryName: source.categoryName, fileName: entry.name });
            }
        }
    }
    const images = [];
    for (let index = 0; index < candidates.length; index += 32) {
        const batch = await Promise.all(candidates.slice(index, index + 32).map(async candidate => {
            const filePath = pathApi.join(directory, ...candidate.id.split('/'));
            try {
                const stat = await fsApi.lstat(filePath);
                return stat.isFile() && !stat.isSymbolicLink?.() ? {
                    id: candidate.id,
                    name: candidate.fileName.replace(/\.png$/i, ''),
                    categoryName: candidate.categoryName,
                    filePath,
                    size: Math.max(0, Number(stat.size) || 0),
                    modifiedAt: Math.max(0, Number(stat.mtimeMs) || 0)
                } : null;
            } catch {
                return null;
            }
        }));
        images.push(...batch.filter(Boolean));
    }
    images.sort((left, right) =>
        right.modifiedAt - left.modifiedAt || left.id.localeCompare(right.id, 'zh-CN', {
            numeric: true,
            sensitivity: 'base'
        })
    );
    return { categoryNames, images };
}

function syncCategoriesWithFolders(library, categoryNames, createId) {
    const folderNames = new Map(categoryNames.map(name => [normalizeCategoryKey(name), name]));
    const categories = [];
    const used = new Set();
    for (const category of library.categories) {
        const key = normalizeCategoryKey(category.name);
        const actualName = folderNames.get(key);
        if (actualName && !used.has(key)) {
            categories.push({ id: category.id, name: actualName });
            used.add(key);
        }
    }
    for (const name of categoryNames) {
        const key = normalizeCategoryKey(name);
        if (!used.has(key)) {
            const temporaryLibrary = { categories };
            categories.push({ id: createCategoryId(temporaryLibrary, createId), name });
            used.add(key);
        }
    }
    library.categories = categories;
}

function syncLibraryWithImages(library, scannedImages) {
    const byKey = new Map(scannedImages.map(image => [normalizeFileKey(image.id), image]));
    const existingOrder = [];
    const seen = new Set();
    for (const rawId of library.order) {
        const image = byKey.get(normalizeFileKey(rawId));
        const key = normalizeFileKey(image?.id);
        if (image && !seen.has(key)) {
            seen.add(key);
            existingOrder.push(image.id);
        }
    }
    const newImages = scannedImages.filter(image => !seen.has(normalizeFileKey(image.id)));
    library.order = [...newImages.map(image => image.id), ...existingOrder];
    return byKey;
}

function categoryIdForImage(library, image) {
    if (!image?.categoryName) {
        return '';
    }
    const key = normalizeCategoryKey(image.categoryName);
    return library.categories.find(category => normalizeCategoryKey(category.name) === key)?.id || '';
}

function buildState(directory, library, byKey) {
    const images = library.order.map(id => byKey.get(normalizeFileKey(id))).filter(Boolean).map(image => ({
        ...image,
        categoryId: categoryIdForImage(library, image)
    }));
    const counts = new Map(library.categories.map(category => [category.id, 0]));
    let uncategorizedCount = 0;
    for (const image of images) {
        if (image.categoryId && counts.has(image.categoryId)) {
            counts.set(image.categoryId, counts.get(image.categoryId) + 1);
        } else {
            uncategorizedCount += 1;
        }
    }
    return {
        ok: true,
        directory,
        totalCount: images.length,
        uncategorizedCount,
        categories: library.categories.map(category => ({
            ...category,
            count: counts.get(category.id) || 0
        })),
        images
    };
}

async function resolveManagedFile(fsApi, directory, id, pathApi) {
    const parts = imageIdParts(id, pathApi);
    if (!parts) {
        throw new Error('image-not-found');
    }
    const filePath = pathApi.resolve(directory, ...parts.id.split('/'));
    if (!isPathInside(directory, filePath, pathApi)) {
        throw new Error('path-outside-library');
    }
    const stat = await fsApi.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink?.()) {
        throw new Error('image-not-found');
    }
    const [realDirectory, realFile] = await Promise.all([
        fsApi.realpath(directory),
        fsApi.realpath(filePath)
    ]);
    if (!isPathInside(realDirectory, realFile, pathApi)) {
        throw new Error('path-outside-library');
    }
    return { ...parts, filePath };
}

async function moveManagedImage(fsApi, loaded, source, category, pathApi) {
    const targetCategoryName = category?.name || '';
    if (normalizeCategoryKey(source.categoryName) === normalizeCategoryKey(targetCategoryName)) {
        return source.id;
    }
    const targetDirectory = pathApi.resolve(loaded.directory, targetCategoryName);
    await fsApi.mkdir(targetDirectory, { recursive: true });
    const target = await findMoveTarget(fsApi, targetDirectory, source.fileName, source.filePath, pathApi);
    await fsApi.rename(source.filePath, target.filePath);
    const newId = createImageId(targetCategoryName, target.fileName, pathApi);
    replaceImageId(loaded.library, source.id, newId);
    return newId;
}

function createMessageImageLibrary(options = {}) {
    const fsApi = options.fs || nodeFs;
    const pathApi = options.path || nodePath;
    const metadataPath = pathApi.resolve(options.metadataPath || 'message-image-library.json');
    const createId = options.createId || (() => `category-${crypto.randomUUID()}`);
    const copyImage = options.copyImage;
    const revealImage = options.revealImage;

    async function load(directory) {
        const sourceDirectory = normalizeText(directory);
        if (!sourceDirectory || !pathApi.isAbsolute(sourceDirectory)) {
            throw new Error('library-directory-invalid');
        }
        const resolvedDirectory = pathApi.resolve(sourceDirectory);
        const metadata = await readMetadata(fsApi, metadataPath, pathApi);
        const library = getOrCreateLibrary(metadata, resolvedDirectory, pathApi);
        const before = JSON.stringify(library);
        await migrateLogicalLibrary(fsApi, resolvedDirectory, library, pathApi);
        const scanned = await scanImages(fsApi, resolvedDirectory, pathApi);
        syncCategoriesWithFolders(library, scanned.categoryNames, createId);
        const byKey = syncLibraryWithImages(library, scanned.images);
        if (JSON.stringify(library) !== before) {
            await writeMetadata(fsApi, metadataPath, metadata, pathApi);
        }
        return { directory: resolvedDirectory, metadata, library, byKey };
    }

    async function getState(directory) {
        const loaded = await load(directory);
        return buildState(loaded.directory, loaded.library, loaded.byKey);
    }

    async function saveAndReload(loaded) {
        await writeMetadata(fsApi, metadataPath, loaded.metadata, pathApi);
        return getState(loaded.directory);
    }

    async function action(directory, request = {}) {
        const loaded = await load(directory);
        const { library, byKey } = loaded;
        const type = normalizeText(request.type);
        if (type === 'create-category') {
            const name = sanitizeCategoryName(request.name);
            if (!name) {
                return { ok: false, reason: 'category-name-empty' };
            }
            if (library.categories.length >= MAX_CATEGORIES || library.categories.some(category =>
                normalizeCategoryKey(category.name) === normalizeCategoryKey(name)
            )) {
                return { ok: false, reason: 'category-name-conflict' };
            }
            const category = { id: createCategoryId(library, createId), name };
            const categoryPath = pathApi.resolve(loaded.directory, name);
            if (await pathExists(fsApi, categoryPath)) {
                return { ok: false, reason: 'category-name-conflict' };
            }
            await fsApi.mkdir(categoryPath);
            library.categories.push(category);
            return { ...(await saveAndReload(loaded)), categoryId: category.id };
        }
        if (type === 'rename-category') {
            const category = library.categories.find(item => item.id === normalizeText(request.categoryId));
            const name = sanitizeCategoryName(request.name);
            if (!category || !name) {
                return { ok: false, reason: category ? 'category-name-empty' : 'category-not-found' };
            }
            if (library.categories.some(item => item !== category &&
                normalizeCategoryKey(item.name) === normalizeCategoryKey(name))) {
                return { ok: false, reason: 'category-name-conflict' };
            }
            if (category.name === name) {
                return buildState(loaded.directory, library, byKey);
            }
            const oldName = category.name;
            const sourcePath = pathApi.resolve(loaded.directory, oldName);
            const targetPath = pathApi.resolve(loaded.directory, name);
            if (normalizeDirectoryKey(sourcePath, pathApi) !== normalizeDirectoryKey(targetPath, pathApi) &&
                await pathExists(fsApi, targetPath)) {
                return { ok: false, reason: 'category-name-conflict' };
            }
            await fsApi.rename(sourcePath, targetPath);
            category.name = name;
            library.order = library.order.map(id => {
                const parts = imageIdParts(id, pathApi);
                return parts && normalizeCategoryKey(parts.categoryName) === normalizeCategoryKey(oldName)
                    ? createImageId(name, parts.fileName, pathApi)
                    : id;
            });
            return saveAndReload(loaded);
        }
        if (type === 'delete-category') {
            const categoryId = normalizeText(request.categoryId);
            const index = library.categories.findIndex(item => item.id === categoryId);
            if (index < 0) {
                return { ok: false, reason: 'category-not-found' };
            }
            const category = library.categories[index];
            const categoryPath = pathApi.resolve(loaded.directory, category.name);
            const entries = await fsApi.readdir(categoryPath, { withFileTypes: true });
            if (entries.some(entry => !entry.isFile() || entry.isSymbolicLink?.() ||
                !createImageId(category.name, entry.name, pathApi))) {
                return { ok: false, reason: 'category-directory-not-empty' };
            }
            for (const entry of entries) {
                const source = await resolveManagedFile(
                    fsApi,
                    loaded.directory,
                    createImageId(category.name, entry.name, pathApi),
                    pathApi
                );
                await moveManagedImage(fsApi, loaded, source, null, pathApi);
            }
            await fsApi.rmdir(categoryPath);
            library.categories.splice(index, 1);
            return saveAndReload(loaded);
        }
        if (type === 'reorder-categories') {
            const requestedIds = Array.from(new Set((request.categoryIds || []).map(normalizeText).filter(Boolean)));
            const byId = new Map(library.categories.map(category => [category.id, category]));
            if (requestedIds.length !== byId.size || requestedIds.some(id => !byId.has(id))) {
                return { ok: false, reason: 'category-order-invalid' };
            }
            library.categories = requestedIds.map(id => byId.get(id));
            return saveAndReload(loaded);
        }
        if (type === 'assign') {
            const categoryId = normalizeText(request.categoryId);
            const category = categoryId ? library.categories.find(item => item.id === categoryId) : null;
            if (categoryId && !category) {
                return { ok: false, reason: 'category-not-found' };
            }
            const ids = uniqueImageIds(request.imageIds, pathApi).filter(id => byKey.has(normalizeFileKey(id)));
            if (!ids.length) {
                return { ok: false, reason: 'image-selection-empty' };
            }
            for (const id of ids) {
                const source = await resolveManagedFile(fsApi, loaded.directory, byKey.get(normalizeFileKey(id)).id, pathApi);
                await moveManagedImage(fsApi, loaded, source, category, pathApi);
            }
            return saveAndReload(loaded);
        }
        if (type === 'reorder-images') {
            const categoryId = normalizeText(request.categoryId);
            const visible = library.order.filter(id => {
                const image = byKey.get(normalizeFileKey(id));
                const assigned = categoryIdForImage(library, image);
                return categoryId === 'all' || (categoryId === 'uncategorized' ? !assigned : assigned === categoryId);
            });
            const requestedIds = uniqueImageIds(request.imageIds, pathApi);
            const visibleKeys = new Set(visible.map(normalizeFileKey));
            if (requestedIds.length !== visible.length || requestedIds.some(id => !visibleKeys.has(normalizeFileKey(id)))) {
                return { ok: false, reason: 'image-order-invalid' };
            }
            let cursor = 0;
            library.order = library.order.map(id =>
                visibleKeys.has(normalizeFileKey(id)) ? requestedIds[cursor++] : id
            );
            return saveAndReload(loaded);
        }
        if (type === 'rename-image') {
            const source = await resolveManagedFile(fsApi, loaded.directory, request.imageId, pathApi);
            const newName = sanitizeManagedImageName(request.name, pathApi);
            if (!newName) {
                return { ok: false, reason: 'image-name-empty' };
            }
            const targetId = createImageId(source.categoryName, newName, pathApi);
            const targetPath = pathApi.resolve(loaded.directory, ...targetId.split('/'));
            if (normalizeFileKey(source.id) !== normalizeFileKey(targetId) && await pathExists(fsApi, targetPath)) {
                return { ok: false, reason: 'image-name-conflict' };
            }
            await fsApi.rename(source.filePath, targetPath);
            replaceImageId(library, source.id, targetId);
            return { ...(await saveAndReload(loaded)), imageId: targetId };
        }
        if (type === 'delete-images') {
            const ids = uniqueImageIds(request.imageIds, pathApi);
            if (!ids.length) {
                return { ok: false, reason: 'image-selection-empty' };
            }
            const files = [];
            for (const id of ids) {
                files.push(await resolveManagedFile(fsApi, loaded.directory, id, pathApi));
            }
            for (const file of files) {
                await fsApi.unlink(file.filePath);
                library.order = library.order.filter(id => normalizeFileKey(id) !== normalizeFileKey(file.id));
            }
            return { ...(await saveAndReload(loaded)), deletedCount: files.length };
        }
        if (type === 'copy-image') {
            const file = await resolveManagedFile(fsApi, loaded.directory, request.imageId, pathApi);
            if (typeof copyImage !== 'function') {
                return { ok: false, reason: 'clipboard-unavailable' };
            }
            await copyImage(file.filePath);
            return { ok: true, copied: true };
        }
        if (type === 'open-directory') {
            let filePath = '';
            if (request.imageId) {
                filePath = (await resolveManagedFile(fsApi, loaded.directory, request.imageId, pathApi)).filePath;
            }
            if (typeof revealImage !== 'function') {
                return { ok: false, reason: 'shell-unavailable' };
            }
            await revealImage(loaded.directory, filePath);
            return { ok: true };
        }
        return { ok: false, reason: 'action-unsupported' };
    }

    return Object.freeze({ action, getState });
}

module.exports = {
    MAX_CATEGORIES,
    MAX_IMAGES,
    createMessageImageLibrary,
    isPathInside,
    normalizeImageId,
    normalizeMetadata,
    sanitizeCategoryName,
    sanitizeManagedImageName
};
