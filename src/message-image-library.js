'use strict';

const nodeFs = require('fs').promises;
const nodePath = require('path');
const crypto = require('crypto');

const METADATA_VERSION = 1;
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
    const normalized = normalizeText(fileName);
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

function normalizeImageId(value, pathApi = nodePath) {
    const fileName = normalizeText(value);
    if (!fileName || fileName !== pathApi.basename(fileName) || pathApi.extname(fileName).toLowerCase() !== '.png') {
        return '';
    }
    return fileName;
}

function sanitizeCategoryName(value) {
    return normalizeText(value).replace(/[\u0000-\u001f]/g, '').slice(0, 40);
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
    return normalizeImageId(`${name}.png`, pathApi);
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
        const nameKey = name.toLocaleLowerCase('zh-CN');
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

function normalizeLibrary(value, pathApi = nodePath) {
    const directory = normalizeText(value?.directory);
    const categories = normalizeCategories(value?.categories);
    const categoryIds = new Set(categories.map(category => category.id));
    const assignments = {};
    for (const [rawId, rawCategoryId] of Object.entries(value?.assignments || {})) {
        const id = normalizeImageId(rawId, pathApi);
        const categoryId = normalizeText(rawCategoryId);
        if (id && categoryIds.has(categoryId)) {
            assignments[id] = categoryId;
        }
    }
    return {
        directory,
        categories,
        order: uniqueImageIds(value?.order, pathApi).slice(0, MAX_IMAGES),
        assignments
    };
}

function normalizeMetadata(value, pathApi = nodePath) {
    const libraries = [];
    const keys = new Set();
    for (const source of Array.isArray(value?.libraries) ? value.libraries : []) {
        const library = normalizeLibrary(source, pathApi);
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
    await fsApi.mkdir(pathApi.dirname(metadataPath), { recursive: true });
    await fsApi.writeFile(metadataPath, JSON.stringify(normalizeMetadata(metadata, pathApi), null, 2), 'utf8');
}

function getOrCreateLibrary(metadata, directory, pathApi) {
    const key = normalizeDirectoryKey(directory, pathApi);
    let library = metadata.libraries.find(item => normalizeDirectoryKey(item.directory, pathApi) === key);
    if (!library) {
        library = { directory: pathApi.resolve(directory), categories: [], order: [], assignments: {} };
        metadata.libraries.push(library);
        if (metadata.libraries.length > MAX_LIBRARIES) {
            metadata.libraries.splice(0, metadata.libraries.length - MAX_LIBRARIES);
        }
    }
    library.directory = pathApi.resolve(directory);
    return library;
}

async function scanImages(fsApi, directory, pathApi) {
    await fsApi.mkdir(directory, { recursive: true });
    const entries = await fsApi.readdir(directory, { withFileTypes: true });
    const images = [];
    const candidates = entries.filter(entry =>
        entry.isFile() && !entry.isSymbolicLink?.() && normalizeImageId(entry.name, pathApi)
    ).slice(0, MAX_IMAGES);
    for (let index = 0; index < candidates.length; index += 32) {
        const batch = await Promise.all(candidates.slice(index, index + 32).map(async entry => {
            const id = normalizeImageId(entry.name, pathApi);
            const filePath = pathApi.join(directory, id);
            try {
                const stat = await fsApi.stat(filePath);
                return stat.isFile() ? {
                    id,
                    name: id.replace(/\.png$/i, ''),
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
    return images.sort((left, right) =>
        right.modifiedAt - left.modifiedAt || left.id.localeCompare(right.id, 'zh-CN', {
            numeric: true,
            sensitivity: 'base'
        })
    );
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
    const categoryIds = new Set(library.categories.map(category => category.id));
    const assignments = {};
    for (const [rawId, categoryId] of Object.entries(library.assignments)) {
        const image = byKey.get(normalizeFileKey(rawId));
        if (image && categoryIds.has(categoryId)) {
            assignments[image.id] = categoryId;
        }
    }
    library.assignments = assignments;
    return byKey;
}

function buildState(directory, library, byKey) {
    const images = library.order.map(id => byKey.get(normalizeFileKey(id))).filter(Boolean).map(image => ({
        ...image,
        categoryId: library.assignments[image.id] || ''
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
    const normalizedId = normalizeImageId(id, pathApi);
    if (!normalizedId) {
        throw new Error('image-not-found');
    }
    const filePath = pathApi.resolve(directory, normalizedId);
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
    return { id: normalizedId, filePath };
}

function replaceImageId(library, oldId, newId) {
    library.order = library.order.map(id =>
        normalizeFileKey(id) === normalizeFileKey(oldId) ? newId : id
    );
    const categoryId = Object.entries(library.assignments)
        .find(([id]) => normalizeFileKey(id) === normalizeFileKey(oldId))?.[1] || '';
    for (const id of Object.keys(library.assignments)) {
        if (normalizeFileKey(id) === normalizeFileKey(oldId)) {
            delete library.assignments[id];
        }
    }
    if (categoryId) {
        library.assignments[newId] = categoryId;
    }
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
        const scannedImages = await scanImages(fsApi, resolvedDirectory, pathApi);
        const byKey = syncLibraryWithImages(library, scannedImages);
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
                category.name.localeCompare(name, 'zh-CN', { sensitivity: 'accent' }) === 0
            )) {
                return { ok: false, reason: 'category-name-conflict' };
            }
            const category = { id: normalizeText(createId()).slice(0, 80), name };
            if (!category.id || library.categories.some(item => item.id === category.id)) {
                return { ok: false, reason: 'category-id-conflict' };
            }
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
                item.name.localeCompare(name, 'zh-CN', { sensitivity: 'accent' }) === 0)) {
                return { ok: false, reason: 'category-name-conflict' };
            }
            category.name = name;
            return saveAndReload(loaded);
        }
        if (type === 'delete-category') {
            const categoryId = normalizeText(request.categoryId);
            const index = library.categories.findIndex(item => item.id === categoryId);
            if (index < 0) {
                return { ok: false, reason: 'category-not-found' };
            }
            library.categories.splice(index, 1);
            for (const [id, assignedId] of Object.entries(library.assignments)) {
                if (assignedId === categoryId) {
                    delete library.assignments[id];
                }
            }
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
            if (categoryId && !library.categories.some(category => category.id === categoryId)) {
                return { ok: false, reason: 'category-not-found' };
            }
            const ids = uniqueImageIds(request.imageIds, pathApi).filter(id => byKey.has(normalizeFileKey(id)));
            if (!ids.length) {
                return { ok: false, reason: 'image-selection-empty' };
            }
            for (const id of ids) {
                const actualId = byKey.get(normalizeFileKey(id)).id;
                if (categoryId) {
                    library.assignments[actualId] = categoryId;
                } else {
                    delete library.assignments[actualId];
                }
            }
            return saveAndReload(loaded);
        }
        if (type === 'reorder-images') {
            const categoryId = normalizeText(request.categoryId);
            const visible = library.order.filter(id => {
                const assigned = library.assignments[id] || '';
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
            const newId = sanitizeManagedImageName(request.name, pathApi);
            if (!newId) {
                return { ok: false, reason: 'image-name-empty' };
            }
            const targetPath = pathApi.resolve(loaded.directory, newId);
            if (!isPathInside(loaded.directory, targetPath, pathApi)) {
                return { ok: false, reason: 'path-outside-library' };
            }
            if (normalizeFileKey(source.id) !== normalizeFileKey(newId)) {
                try {
                    await fsApi.access(targetPath);
                    return { ok: false, reason: 'image-name-conflict' };
                } catch {
                    // The target name is available.
                }
            }
            await fsApi.rename(source.filePath, targetPath);
            replaceImageId(library, source.id, newId);
            return { ...(await saveAndReload(loaded)), imageId: newId };
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
                for (const id of Object.keys(library.assignments)) {
                    if (normalizeFileKey(id) === normalizeFileKey(file.id)) {
                        delete library.assignments[id];
                    }
                }
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
