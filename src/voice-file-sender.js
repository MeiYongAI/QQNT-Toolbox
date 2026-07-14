const { app, BrowserWindow, dialog } = require("electron");

const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const {
    addNativeRequestHandler,
    addNativeSendHandler,
    createNativeEventWaiter,
    isNativeFailure,
    qqNativeInvoke,
    unwrapNativeValue
} = require('./native-ipc');
const {
    VOICE_LIBRARY_PANEL_CSS,
    createVoiceLibraryPanel,
    injectedVoiceFileSenderUi
} = require('./voice/renderer-ui');
const {
    TARGET_SILK_SAMPLE_RATE,
    decodeSilkToPcm,
    encodeMediaFileToSilk,
    estimateSilkDurationMs,
    isSilkFile,
    makePcm16Wav,
    runTool
} = require('./voice/media');

const PLUGIN_SLUG = 'qqnt_toolbox';
const PLUGIN_NAME = 'QQNT Toolbox';
const VOICE_DATA_DIR_NAME = 'voice';
const AUDIO_FILE_EXTENSIONS = ['aac', 'amr', 'flac', 'm4a', 'mp3', 'ogg', 'opus', 'silk', 'slk', 'wav', 'weba', 'webm'];
const VIDEO_FILE_EXTENSIONS = ['3g2', '3gp', 'asf', 'avi', 'flv', 'm2ts', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'ogv', 'ts', 'webm', 'wmv'];
const MEDIA_FILE_EXTENSIONS = uniqueStrings([...AUDIO_FILE_EXTENSIONS, ...VIDEO_FILE_EXTENSIONS]);
const MEDIA_EXTENSION_SET = new Set(MEDIA_FILE_EXTENSIONS.map(extension => `.${extension}`));
let voiceFeatureEnabled = false;
let voiceSaveInContextMenuEnabled = false;
let voiceForwardInContextMenuEnabled = false;
let fakeVoiceDurationSeconds = 0;

function getPluginTempDir() {
    return path.join(os.tmpdir(), 'QQNT-Toolbox', VOICE_DATA_DIR_NAME);
}

function getLiteLoaderPluginDataDir(slug = PLUGIN_SLUG, name = PLUGIN_NAME) {
    const plugins = globalThis.LiteLoader?.plugins || global.LiteLoader?.plugins;
    if (!plugins) {
        return '';
    }
    for (const key of [slug, name]) {
        if (plugins[key]?.path?.data) {
            return plugins[key].path.data;
        }
    }
    for (const plugin of Object.values(plugins)) {
        if (plugin?.manifest?.slug === slug || plugin?.manifest?.name === name) {
            return plugin?.path?.data || '';
        }
    }
    return '';
}

function getDefaultLiteLoaderDataDir(slug) {
    return path.resolve(__dirname, '..', '..', '..', 'data', slug);
}

function getPluginDataDir() {
    return path.join(getLiteLoaderPluginDataDir() || getDefaultLiteLoaderDataDir(PLUGIN_SLUG), VOICE_DATA_DIR_NAME);
}

function getLibraryDir() {
    return path.join(getPluginDataDir(), 'library');
}

function getLibraryVoiceDir() {
    return path.join(getLibraryDir(), 'voices');
}

function getLibraryIndexPath() {
    return path.join(getLibraryDir(), 'library.json');
}

function safeFileStem(value) {
    return String(value || 'voice')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'voice';
}

async function makeTempSilkPath() {
    const tempDir = getPluginTempDir();
    await fs.mkdir(tempDir, { recursive: true });
    return path.join(tempDir, `${crypto.randomUUID()}.silk`);
}

async function getPreviewCacheDir() {
    const previewDir = path.join(getPluginTempDir(), 'preview');
    await fs.mkdir(previewDir, { recursive: true });
    return previewDir;
}

function uniqueStrings(values) {
    return Array.from(new Set(values.filter(Boolean)));
}

function getTencentFilesRoots() {
    return uniqueStrings([
        path.join(app.getPath('documents'), 'Tencent Files'),
        path.join(os.homedir(), 'Documents', 'Tencent Files'),
        path.join(process.env.USERPROFILE || os.homedir(), 'Documents', 'Tencent Files')
    ]);
}

function getDirectoryNewestMtimeMs(dirPath, depth = 0) {
    if (!fsSync.existsSync(dirPath) || depth > 3) {
        return 0;
    }
    let newest = 0;
    try {
        newest = fsSync.statSync(dirPath).mtimeMs;
        for (const entry of fsSync.readdirSync(dirPath, { withFileTypes: true })) {
            const entryPath = path.join(dirPath, entry.name);
            const entryStat = fsSync.statSync(entryPath);
            newest = Math.max(newest, entryStat.mtimeMs);
            if (entry.isDirectory()) {
                newest = Math.max(newest, getDirectoryNewestMtimeMs(entryPath, depth + 1));
            }
        }
    } catch {
    }
    return newest;
}

function getNativePttBaseDirs() {
    const candidates = [];
    for (const root of getTencentFilesRoots()) {
        if (!fsSync.existsSync(root)) {
            continue;
        }
        let entries = [];
        try {
            entries = fsSync.readdirSync(root, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            const pttBaseDir = path.join(root, entry.name, 'nt_qq', 'nt_data', 'Ptt');
            if (fsSync.existsSync(pttBaseDir)) {
                candidates.push({
                    pttBaseDir,
                    newest: getDirectoryNewestMtimeMs(pttBaseDir)
                });
            }
        }
    }
    candidates.sort((a, b) => b.newest - a.newest);
    return candidates.map(candidate => candidate.pttBaseDir);
}

function findNativePttBaseDir() {
    return getNativePttBaseDirs()[0] || '';
}

function formatPttMonth(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

async function getNativePttOriDir() {
    const pttBaseDir = findNativePttBaseDir();
    if (!pttBaseDir) {
        throw new Error('QQ native Ptt cache directory was not found.');
    }
    const oriDir = path.join(pttBaseDir, formatPttMonth(), 'Ori');
    await fs.mkdir(oriDir, { recursive: true });
    return oriDir;
}

function safeJson(value) {
    return JSON.stringify(value, (key, item) => {
        if (item instanceof Map) {
            return Object.fromEntries(item);
        }
        if (Buffer.isBuffer(item)) {
            return {
                type: 'Buffer',
                length: item.length
            };
        }
        if (item instanceof Uint8Array) {
            return {
                type: 'Uint8Array',
                length: item.length
            };
        }
        return item;
    });
}

async function getFileMd5(filePath) {
    const hash = crypto.createHash('md5');
    const stream = fsSync.createReadStream(filePath);
    return await new Promise((resolve, reject) => {
        stream.on('data', chunk => hash.update(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

function getBufferMd5(data) {
    return crypto.createHash('md5').update(Buffer.from(data)).digest('hex');
}

async function ensureLibraryDirs() {
    await fs.mkdir(getLibraryVoiceDir(), { recursive: true });
}

function normalizeStoredPath(filePath) {
    return String(filePath || '').replace(/\//g, path.sep);
}

function normalizeFieldText(value) {
    const text = String(value ?? '').trim();
    return text && text !== 'undefined' && text !== 'null' && text !== '0' ? text : '';
}

function normalizeFieldKey(key) {
    return String(key || '').replace(/[_\-\s]/g, '').toLowerCase();
}

const PTT_PATH_KEYS = new Set([
    'filepath',
    'sourcepath',
    'path',
    'localpath',
    'originpath',
    'originfilepath',
    'srcpath',
    'downloadpath',
    'realpath',
    'absolutepath',
    'audiopath',
    'voicepath',
    'pttpath',
    'url',
    'audiourl',
    'voiceurl',
    'ptturl'
]);
const PTT_NAME_KEYS = new Set(['filename', 'name', 'originfilename', 'originalname', 'audioname', 'voicename', 'pttfilename']);
const PTT_MD5_KEYS = new Set(['md5hexstr', 'md5', 'filemd5', 'md5str', 'filemd5hex', 'originmd5', 'originalmd5']);
const PTT_DURATION_KEYS = new Set(['duration', 'voiceduration', 'durationseconds', 'seconds', 'second', 'time', 'playtime']);
const PTT_DURATION_MS_KEYS = new Set(['durationms', 'durationmilliseconds', 'timems', 'playtimems']);
const PTT_ID_KEYS = new Set(['fileuuid', 'filesubid', 'uuid', 'fileid', 'storeid', 'resid', 'resourceid']);

function addUniqueText(list, value) {
    const text = normalizeFieldText(value);
    if (text && !list.includes(text)) {
        list.push(text);
    }
}

function collectFieldValues(value, keySet, results = [], depth = 0, seen = new WeakSet()) {
    if (value === undefined || value === null || depth > 7 || results.length > 24) {
        return results;
    }
    if (Array.isArray(value)) {
        for (const item of value.slice(0, 64)) {
            collectFieldValues(item, keySet, results, depth + 1, seen);
        }
        return results;
    }
    if (typeof value !== 'object' || value instanceof Uint8Array || value instanceof Map) {
        return results;
    }
    if (seen.has(value)) {
        return results;
    }
    seen.add(value);

    for (const [key, item] of Object.entries(value)) {
        if (!keySet.has(normalizeFieldKey(key))) {
            continue;
        }
        if (item === undefined || item === null || typeof item === 'object') {
            continue;
        }
        addUniqueText(results, item);
    }
    for (const item of Object.values(value)) {
        collectFieldValues(item, keySet, results, depth + 1, seen);
    }
    return results;
}

function firstFieldValue(roots, keySet) {
    for (const root of roots) {
        const values = collectFieldValues(root, keySet);
        if (values.length) {
            return values[0];
        }
    }
    return '';
}

function normalizeDurationSeconds(value, isMilliseconds = false) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        return 0;
    }
    if (isMilliseconds || number > 1000) {
        return Math.max(1, Math.ceil(number / 1000));
    }
    return Math.max(1, Math.ceil(number));
}

function firstDurationSeconds(roots) {
    for (const root of roots) {
        const msValue = firstFieldValue([root], PTT_DURATION_MS_KEYS);
        const msDuration = normalizeDurationSeconds(msValue, true);
        if (msDuration) {
            return msDuration;
        }
        const value = firstFieldValue([root], PTT_DURATION_KEYS);
        const duration = normalizeDurationSeconds(value);
        if (duration) {
            return duration;
        }
    }
    return 0;
}

function sanitizePttInfo(value) {
    const nested = value?.pttElement || value;
    if (!nested || typeof nested !== 'object') {
        return null;
    }
    const roots = [nested, value].filter(Boolean);
    const paths = [];
    const names = [];
    const ids = [];
    for (const root of roots) {
        collectFieldValues(root, PTT_PATH_KEYS, paths);
        collectFieldValues(root, PTT_NAME_KEYS, names);
        collectFieldValues(root, PTT_ID_KEYS, ids);
    }
    const md5HexStr = firstFieldValue(roots, PTT_MD5_KEYS);
    const duration = firstDurationSeconds(roots);
    const ptt = {
        filePath: paths[0] || '',
        sourcePath: paths[1] || '',
        fileName: names[0] || '',
        md5HexStr,
        duration,
        fileUuid: ids[0] || '',
        fileSubId: ids[1] || '',
        fileId: ids[2] || '',
        paths,
        names,
        ids
    };
    return ptt.filePath || ptt.fileName || ptt.md5HexStr || ptt.fileUuid || ptt.fileSubId || ptt.fileId ? ptt : null;
}

function normalizeLibraryRelativePath(relativePath = '') {
    const normalized = String(relativePath || '')
        .replace(/\\/g, '/')
        .split('/')
        .filter(part => part && part !== '.' && part !== '..')
        .join('/');
    return normalized;
}

function getLibraryAbsolutePath(relativePath = '') {
    return path.join(getLibraryVoiceDir(), ...normalizeLibraryRelativePath(relativePath).split('/').filter(Boolean));
}

function getLibraryRelativePath(filePath) {
    const relativePath = path.relative(getLibraryVoiceDir(), normalizeStoredPath(filePath));
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return '';
    }
    return relativePath.replace(/\\/g, '/');
}

function encodeLibraryItemId(kind, relativePath) {
    return `${kind}:${Buffer.from(normalizeLibraryRelativePath(relativePath), 'utf8').toString('base64url')}`;
}

function decodeLibraryItemId(itemId) {
    const match = String(itemId || '').match(/^(file|folder):(.+)$/);
    if (!match) {
        return null;
    }
    try {
        return {
            kind: match[1],
            relativePath: normalizeLibraryRelativePath(Buffer.from(match[2], 'base64url').toString('utf8'))
        };
    } catch {
        return null;
    }
}

function getLibraryParentFolder(relativePath = '') {
    const normalized = normalizeLibraryRelativePath(relativePath);
    const parent = path.posix.dirname(normalized);
    return parent === '.' ? '' : parent;
}

function getLibraryFileKind(filePath) {
    if (isSilkFile(filePath)) {
        return 'ptt';
    }
    return isSupportedMediaPath(filePath) ? 'media' : '';
}

async function readLibraryIndex() {
    await ensureLibraryDirs();
    const indexPath = getLibraryIndexPath();
    try {
        const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
        return {
            version: 1,
            items: Array.isArray(index.items) ? index.items : []
        };
    } catch {
        try {
            if (fsSync.existsSync(indexPath)) {
                await fs.copyFile(indexPath, `${indexPath}.broken-${Date.now()}.bak`);
                await fs.writeFile(indexPath, JSON.stringify({ version: 1, items: [] }, null, 2), 'utf8');
            }
        } catch {
        }
        return {
            version: 1,
            items: []
        };
    }
}

async function writeLibraryIndex(index) {
    await ensureLibraryDirs();
    await fs.writeFile(getLibraryIndexPath(), JSON.stringify({
        version: 1,
        items: index.items || []
    }, null, 2), 'utf8');
}

function findIndexedItemByPath(index, filePath) {
    const comparablePath = normalizeComparablePath(filePath);
    return (index.items || []).find(item => normalizeComparablePath(normalizeStoredPath(item.path)) === comparablePath) || null;
}

function hasConvertedVoiceForSource(index, sourcePath) {
    const comparablePath = normalizeComparablePath(sourcePath);
    return (index.items || []).some(item =>
        item.kind === 'ptt' &&
        normalizeComparablePath(normalizeStoredPath(item.sourcePath)) === comparablePath &&
        fsSync.existsSync(normalizeStoredPath(item.path))
    );
}

function countSupportedLibraryEntries(dirPath) {
    let count = 0;
    let entries = [];
    try {
        entries = fsSync.readdirSync(dirPath, { withFileTypes: true });
    } catch {
        return 0;
    }
    for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            count += 1;
            continue;
        }
        if (entry.isFile() && getLibraryFileKind(entryPath)) {
            count += 1;
        }
    }
    return count;
}

function parseFfmpegDuration(text = '') {
    const match = String(text).match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
    if (!match) {
        return 0;
    }
    const hours = Number(match[1]) || 0;
    const minutes = Number(match[2]) || 0;
    const seconds = Number(match[3]) || 0;
    const total = hours * 3600 + minutes * 60 + seconds;
    return Number.isFinite(total) && total > 0 ? Math.ceil(total) : 0;
}

async function probeMediaDurationSeconds(filePath) {
    try {
        const result = await runTool('ffmpeg', [
            '-hide_banner',
            '-i', filePath,
            '-t', '0.001',
            '-f', 'null',
            '-'
        ]);
        return parseFfmpegDuration(`${result.stdout || ''}\n${result.stderr || ''}`);
    } catch (error) {
        return parseFfmpegDuration(`${error?.stdout || ''}\n${error?.stderr || ''}`);
    }
}

async function detectLibraryDurationSeconds(filePath) {
    if (!filePath || !fsSync.existsSync(filePath)) {
        return 0;
    }
    if (isSilkFile(filePath)) {
        const data = await fs.readFile(filePath);
        return Math.max(1, Math.ceil(estimateSilkDurationMs(data) / 1000));
    }
    return await probeMediaDurationSeconds(filePath);
}

function upsertIndexedLibraryItem(index, item) {
    const comparablePath = normalizeComparablePath(normalizeStoredPath(item.path));
    const existing = (index.items || []).find(entry =>
        entry.id === item.id ||
        normalizeComparablePath(normalizeStoredPath(entry.path)) === comparablePath
    );
    if (existing) {
        Object.assign(existing, item);
        return;
    }
    index.items = index.items || [];
    index.items.unshift(item);
}

async function getLibraryItems(relativeFolder = '') {
    await ensureLibraryDirs();
    const folder = normalizeLibraryRelativePath(relativeFolder);
    const folderPath = getLibraryAbsolutePath(folder);
    if (!fsSync.existsSync(folderPath)) {
        return [];
    }
    const index = await readLibraryIndex();
    let indexDirty = false;
    const items = [];
    let entries = [];
    try {
        entries = await fs.readdir(folderPath, { withFileTypes: true });
    } catch {
        return [];
    }
    for (const entry of entries) {
        const entryPath = path.join(folderPath, entry.name);
        const relativePath = getLibraryRelativePath(entryPath);
        if (!relativePath) {
            continue;
        }
        if (entry.isDirectory()) {
            items.push({
                id: encodeLibraryItemId('folder', relativePath),
                kind: 'folder',
                title: entry.name,
                path: entryPath,
                relativePath,
                parentPath: getLibraryParentFolder(relativePath),
                count: countSupportedLibraryEntries(entryPath),
                createdAt: ''
            });
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }
        const kind = getLibraryFileKind(entryPath);
        if (!kind || (kind === 'media' && hasConvertedVoiceForSource(index, entryPath))) {
            continue;
        }
        const indexed = findIndexedItemByPath(index, entryPath);
        const duration = Number(indexed?.duration) || await detectLibraryDurationSeconds(entryPath);
        const item = {
            ...(indexed || {}),
            id: indexed?.id || encodeLibraryItemId('file', relativePath),
            kind: indexed?.kind || kind,
            title: indexed?.title || path.basename(entry.name, path.extname(entry.name)),
            path: entryPath,
            relativePath,
            parentPath: folder,
            originalName: indexed?.originalName || entry.name,
            duration,
            createdAt: indexed?.createdAt || ''
        };
        items.push(item);
        if (duration > 0 && (!indexed || Number(indexed.duration) !== duration)) {
            upsertIndexedLibraryItem(index, {
                ...item,
                relativePath: undefined,
                parentPath: undefined
            });
            indexDirty = true;
        }
    }
    if (indexDirty) {
        await writeLibraryIndex(index);
    }
    return items.sort((a, b) => {
        if (a.kind === 'folder' && b.kind !== 'folder') {
            return -1;
        }
        if (a.kind !== 'folder' && b.kind === 'folder') {
            return 1;
        }
        return String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hans-CN');
    });
}

function toLibraryViewItems(items) {
    return items.map(item => ({
        id: item.id,
        title: item.title || path.basename(item.path),
        kind: item.kind || 'ptt',
        duration: Number(item.duration) || 0,
        count: Number(item.count) || 0,
        relativePath: item.relativePath || '',
        parentPath: item.parentPath || '',
        createdAt: item.createdAt || ''
    }));
}

async function createAudioPreviewFile(sourcePath, cacheKey = '') {
    sourcePath = normalizeStoredPath(sourcePath);
    if (!sourcePath || !fsSync.existsSync(sourcePath)) {
        throw new Error(`Voice file was not found: ${sourcePath}`);
    }
    const stat = await fs.stat(sourcePath);
    const previewDir = await getPreviewCacheDir();
    const previewId = getBufferMd5(Buffer.from(`${cacheKey}|${sourcePath}`));
    const previewPath = path.join(previewDir, `${previewId}-${stat.size}-${Math.floor(stat.mtimeMs)}.wav`);
    if (!fsSync.existsSync(previewPath)) {
        if (isSilkFile(sourcePath)) {
            const sourceData = await fs.readFile(sourcePath);
            const decoded = await decodeSilkToPcm(sourceData);
            await fs.writeFile(previewPath, makePcm16Wav(decoded.data, TARGET_SILK_SAMPLE_RATE, 1));
        } else {
            await runTool('ffmpeg', [
                '-v', 'error',
                '-y',
                '-i', sourcePath,
                '-vn',
                '-ac', '2',
                '-ar', '48000',
                '-f', 'wav',
                previewPath
            ]);
        }
    }
    return previewPath;
}

async function createLibraryPreviewItem(itemId) {
    const item = await getLibraryItem(itemId);
    if (!item) {
        throw new Error(`Voice library item was not found: ${itemId}`);
    }
    const sourcePath = normalizeStoredPath(item.path);
    const previewPath = await createAudioPreviewFile(sourcePath, item.id);

    return {
        id: item.id,
        title: item.title || path.basename(item.path),
        kind: item.kind || 'ptt',
        duration: Number(item.duration) || 0,
        createdAt: item.createdAt || '',
        previewPath
    };
}

function getSilkDurationSeconds(silkResult) {
    const durationMs = Number(silkResult?.duration) || estimateSilkDurationMs(silkResult?.data || Buffer.alloc(0));
    return Math.max(1, Math.ceil(durationMs / 1000));
}

async function addVoiceDataToLibrary(voiceData, metadata = {}) {
    await ensureLibraryDirs();
    const md5 = getBufferMd5(voiceData);
    const index = await readLibraryIndex();
    const existing = index.items.find(item => item.md5 === md5 && fsSync.existsSync(normalizeStoredPath(item.path)));
    if (existing) {
        return existing;
    }

    const id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const title = safeFileStem(metadata.title || 'voice');
    const targetPath = await makeUniqueLibraryPath(path.join(metadata.targetDir || getLibraryVoiceDir(), `${title}.amr`));
    await fs.writeFile(targetPath, Buffer.from(voiceData));

    const item = {
        id,
        kind: 'ptt',
        title,
        path: targetPath,
        originalName: metadata.originalName || `${title}.amr`,
        sourcePath: metadata.sourcePath || '',
        sourceMd5: metadata.sourceMd5 || '',
        md5,
        duration: Number(metadata.duration) || 0,
        createdAt: new Date().toISOString()
    };
    index.items.unshift(item);
    await writeLibraryIndex(index);
    return item;
}

async function addFileToLibrary(sourcePath, metadata = {}) {
    if (!fsSync.existsSync(sourcePath)) {
        throw new Error(`File does not exist: ${sourcePath}`);
    }
    await ensureLibraryDirs();
    const md5 = await getFileMd5(sourcePath);
    const index = await readLibraryIndex();
    const existing = index.items.find(item => item.md5 === md5 && fsSync.existsSync(normalizeStoredPath(item.path)));
    if (existing) {
        return existing;
    }

    const sourceExt = path.extname(sourcePath).toLowerCase() || '.amr';
    const id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const title = safeFileStem(metadata.title || path.basename(sourcePath, sourceExt));
    const targetPath = await makeUniqueLibraryPath(path.join(getLibraryVoiceDir(), `${title}${sourceExt}`));
    await fs.copyFile(sourcePath, targetPath);

    const item = {
        id,
        kind: 'ptt',
        title,
        path: targetPath,
        originalName: metadata.originalName || path.basename(sourcePath),
        sourcePath,
        md5,
        duration: Number(metadata.duration) || 0,
        createdAt: new Date().toISOString()
    };
    index.items.unshift(item);
    await writeLibraryIndex(index);
    return item;
}

async function addMediaFileToLibrary(filePath, targetFolder = '') {
    if (!fsSync.existsSync(filePath)) {
        throw new Error(`File does not exist: ${filePath}`);
    }
    const sourceExt = path.extname(filePath).toLowerCase();
    const title = safeFileStem(path.basename(filePath, sourceExt));
    const sourceMd5 = await getFileMd5(filePath);
    const index = await readLibraryIndex();
    const existing = index.items.find(item =>
        item.sourceMd5 === sourceMd5 &&
        item.kind === 'ptt' &&
        fsSync.existsSync(normalizeStoredPath(item.path))
    );
    if (existing) {
        return existing;
    }

    const targetDir = getLibraryAbsolutePath(targetFolder);
    await fs.mkdir(targetDir, { recursive: true });
    const silkResult = await encodeMediaFileToSilk(filePath);
    return await addVoiceDataToLibrary(silkResult.data, {
        title,
        originalName: path.basename(filePath),
        sourcePath: filePath,
        sourceMd5,
        duration: getSilkDurationSeconds(silkResult),
        targetDir
    });
}

async function addMediaFilesToLibrary(filePaths, targetFolder = '') {
    const items = [];
    for (const filePath of filePaths.filter(filePath => isSupportedMediaPath(filePath) || isSilkFile(filePath))) {
        items.push(await addMediaFileToLibrary(filePath, targetFolder));
    }
    return items;
}

async function deleteLibraryItem(itemId) {
    const index = await readLibraryIndex();
    const decoded = decodeLibraryItemId(itemId);
    const item = index.items.find(entry => entry.id === itemId) || (decoded ? {
        id: itemId,
        kind: decoded.kind,
        path: getLibraryAbsolutePath(decoded.relativePath)
    } : null);
    if (!item) {
        return false;
    }
    const itemPath = normalizeStoredPath(item.path);
    const relativePath = getLibraryRelativePath(itemPath);
    if (relativePath && fsSync.existsSync(itemPath)) {
        const stat = await fs.stat(itemPath);
        if (stat.isDirectory()) {
            const folderPrefix = normalizeComparablePath(itemPath + path.sep);
            index.items = index.items.filter(entry => {
                const entryPath = normalizeComparablePath(normalizeStoredPath(entry.path));
                return entry.id !== itemId && entryPath !== normalizeComparablePath(itemPath) && !entryPath.startsWith(folderPrefix);
            });
        } else {
            index.items = index.items.filter(entry => entry.id !== itemId && normalizeComparablePath(normalizeStoredPath(entry.path)) !== normalizeComparablePath(itemPath));
        }
        await writeLibraryIndex(index);
        if (stat.isDirectory()) {
            await fs.rm(itemPath, { recursive: true, force: true });
        } else {
            await fs.unlink(itemPath).catch(() => {});
        }
    } else {
        index.items = index.items.filter(entry => entry.id !== itemId);
        await writeLibraryIndex(index);
    }
    return true;
}

async function makeUniqueLibraryPath(filePath) {
    const parsed = path.parse(filePath);
    let candidate = filePath;
    let suffix = 2;
    while (fsSync.existsSync(candidate)) {
        candidate = path.join(parsed.dir, `${parsed.name}-${suffix}${parsed.ext}`);
        suffix += 1;
    }
    return candidate;
}

async function renameLibraryItem(itemId, title) {
    const nextTitle = safeFileStem(title);
    if (!nextTitle) {
        throw new Error('The new name is empty.');
    }
    const decoded = decodeLibraryItemId(itemId);
    const index = await readLibraryIndex();
    const item = index.items.find(entry => entry.id === itemId) || (decoded ? {
        id: itemId,
        kind: decoded.kind === 'folder' ? 'folder' : getLibraryFileKind(getLibraryAbsolutePath(decoded.relativePath)),
        path: getLibraryAbsolutePath(decoded.relativePath),
        title: path.basename(decoded.relativePath, path.extname(decoded.relativePath)),
        originalName: path.basename(decoded.relativePath)
    } : null);
    if (!item) {
        throw new Error(`Voice library item was not found: ${itemId}`);
    }

    const oldPath = normalizeStoredPath(item.path);
    const oldStat = oldPath && fsSync.existsSync(oldPath) ? await fs.stat(oldPath) : null;
    const oldExt = oldStat?.isDirectory() ? '' : (path.extname(oldPath) || path.extname(item.originalName || '') || '.dat');
    let nextPath = oldPath;
    if (oldPath && fsSync.existsSync(oldPath)) {
        const preferredPath = path.join(path.dirname(oldPath), `${nextTitle}${oldExt}`);
        if (normalizeComparablePath(preferredPath) !== normalizeComparablePath(oldPath)) {
            nextPath = await makeUniqueLibraryPath(preferredPath);
            await fs.rename(oldPath, nextPath);
        }
    }

    item.title = nextTitle;
    item.path = nextPath;
    if (oldStat?.isDirectory()) {
        const oldPrefix = normalizeComparablePath(oldPath + path.sep);
        for (const entry of index.items) {
            const entryPath = normalizeStoredPath(entry.path);
            const comparableEntryPath = normalizeComparablePath(entryPath);
            if (comparableEntryPath === normalizeComparablePath(oldPath) || comparableEntryPath.startsWith(oldPrefix)) {
                entry.path = path.join(nextPath, path.relative(oldPath, entryPath));
            }
            const sourcePath = normalizeStoredPath(entry.sourcePath);
            const comparableSourcePath = normalizeComparablePath(sourcePath);
            if (comparableSourcePath === normalizeComparablePath(oldPath) || comparableSourcePath.startsWith(oldPrefix)) {
                entry.sourcePath = path.join(nextPath, path.relative(oldPath, sourcePath));
            }
        }
    }
    if (item.kind !== 'folder' && !index.items.some(entry => entry.id === item.id) && item.kind) {
        item.createdAt = new Date().toISOString();
        item.md5 = fsSync.existsSync(nextPath) ? await getFileMd5(nextPath) : '';
        index.items.unshift(item);
    }
    await writeLibraryIndex(index);
    return item;
}

async function getLibraryItem(itemId) {
    const index = await readLibraryIndex();
    const indexed = index.items.find(item => item.id === itemId && fsSync.existsSync(normalizeStoredPath(item.path)));
    if (indexed) {
        return {
            ...indexed,
            path: normalizeStoredPath(indexed.path),
            relativePath: getLibraryRelativePath(indexed.path)
        };
    }
    const decoded = decodeLibraryItemId(itemId);
    if (!decoded) {
        return null;
    }
    const itemPath = getLibraryAbsolutePath(decoded.relativePath);
    if (!fsSync.existsSync(itemPath)) {
        return null;
    }
    const stat = await fs.stat(itemPath);
    if (stat.isDirectory()) {
        return {
            id: itemId,
            kind: 'folder',
            title: path.basename(itemPath),
            path: itemPath,
            relativePath: decoded.relativePath,
            count: countSupportedLibraryEntries(itemPath)
        };
    }
    const kind = getLibraryFileKind(itemPath);
    if (!kind) {
        return null;
    }
    return {
        id: itemId,
        kind,
        title: path.basename(itemPath, path.extname(itemPath)),
        path: itemPath,
        relativePath: decoded.relativePath,
        duration: 0,
        originalName: path.basename(itemPath)
    };
}

function findFileInDirectory(rootDir, fileName, depth = 0) {
    if (!rootDir || !fileName || depth > 7 || !fsSync.existsSync(rootDir)) {
        return '';
    }
    let entries = [];
    try {
        entries = fsSync.readdirSync(rootDir, { withFileTypes: true });
    } catch {
        return '';
    }
    for (const entry of entries) {
        const entryPath = path.join(rootDir, entry.name);
        if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
            return entryPath;
        }
    }
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        const found = findFileInDirectory(path.join(rootDir, entry.name), fileName, depth + 1);
        if (found) {
            return found;
        }
    }
    return '';
}

function getBasenameFromPathText(value) {
    const text = normalizeFieldText(value);
    if (!text) {
        return '';
    }
    try {
        if (/^https?:\/\//i.test(text)) {
            return path.basename(new URL(text).pathname);
        }
    } catch {
    }
    return path.basename(text.split(/[?#]/)[0]);
}

function addPttCandidateFileName(candidates, value) {
    const fileName = getBasenameFromPathText(value);
    if (!fileName || fileName === '.' || fileName === path.sep) {
        return;
    }
    addUniqueText(candidates, fileName);
    const stem = fileName.replace(/\.(amr|silk|slk|audio)$/i, '');
    if (/^[a-f0-9]{32}$/i.test(stem)) {
        addUniqueText(candidates, `${stem}.amr`);
    }
    if (!path.extname(fileName) && /^[a-z0-9_\-]{8,}$/i.test(fileName)) {
        addUniqueText(candidates, `${fileName}.amr`);
    }
}

function getPttCandidateFileNames(ptt) {
    const candidates = [];
    for (const value of [
        ptt?.fileName,
        ptt?.md5HexStr,
        ptt?.fileUuid,
        ptt?.fileSubId,
        ptt?.fileId,
        ...(Array.isArray(ptt?.names) ? ptt.names : []),
        ...(Array.isArray(ptt?.ids) ? ptt.ids : []),
        ptt?.filePath,
        ptt?.sourcePath,
        ...(Array.isArray(ptt?.paths) ? ptt.paths : [])
    ]) {
        addPttCandidateFileName(candidates, value);
    }
    return candidates;
}

function resolvePttSourcePath(ptt) {
    ptt = sanitizePttInfo(ptt) || ptt || {};
    const directPaths = [
        ptt?.filePath,
        ptt?.sourcePath,
        ...(Array.isArray(ptt?.paths) ? ptt.paths : [])
    ];
    for (const item of directPaths) {
        const directPath = normalizeStoredPath(item);
        if (directPath && fsSync.existsSync(directPath)) {
            return directPath;
        }
    }
    const fileNames = getPttCandidateFileNames(ptt);
    for (const pttBaseDir of getNativePttBaseDirs()) {
        for (const fileName of fileNames) {
            const currentMonthPath = path.join(pttBaseDir, formatPttMonth(), 'Ori', fileName);
            if (fsSync.existsSync(currentMonthPath)) {
                return currentMonthPath;
            }
            const found = findFileInDirectory(pttBaseDir, fileName);
            if (found) {
                return found;
            }
        }
    }
    return '';
}

async function addPttToLibrary(ptt) {
    const sourcePath = resolvePttSourcePath(ptt);
    if (!sourcePath) {
        throw new Error('The voice file was not found in QQNT cache. Play it once, then try again.');
    }
    const duration = await detectLibraryDurationSeconds(sourcePath) || Number(ptt?.duration) || 0;
    const title = duration > 0 ? `语音 ${Math.ceil(duration)}s` : '语音消息';
    return await addFileToLibrary(sourcePath, {
        title,
        duration,
        originalName: ptt?.fileName || path.basename(sourcePath)
    });
}

function normalizeComparablePath(filePath) {
    return String(filePath || '').replace(/\//g, '\\').toLowerCase();
}

function makeSendAttributeInfos(attrId) {
    const msgAttributeInfos = new Map();
    msgAttributeInfos.set(0, {
        attrType: 0,
        attrId,
        vasMsgInfo: {
            msgNamePlateInfo: {},
            bubbleInfo: {},
            avatarPendantInfo: {},
            vasFont: {},
            iceBreakInfo: {}
        }
    });
    return msgAttributeInfos;
}

async function showMediaOpenDialog(browserWindow) {
    const result = await dialog.showOpenDialog(browserWindow || undefined, {
        title: 'Select audio or video file',
        properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
        filters: [{
            name: 'Audio and Video',
            extensions: MEDIA_FILE_EXTENSIONS
        }, {
            name: 'Audio',
            extensions: AUDIO_FILE_EXTENSIONS
        }, {
            name: 'Video',
            extensions: VIDEO_FILE_EXTENSIONS
        }]
    });
    return result;
}

function isSupportedMediaPath(filePath) {
    return MEDIA_EXTENSION_SET.has(path.extname(filePath).toLowerCase());
}

const windowStates = new WeakMap();
const PTT_FORWARD_TTL_MS = 2 * 60 * 1000;

function getWindowState(browserWindow) {
    let state = windowStates.get(browserWindow);
    if (!state) {
        state = {
            uiLoopRunning: false,
            peerUidByUin: new Map()
        };
        windowStates.set(browserWindow, state);
    }
    return state;
}

async function setInjectedStatus(browserWindow, label, options = {}) {
    if (browserWindow.isDestroyed()) {
        return;
    }
    const script = `window.__voiceFileSenderBridge?.setStatus(${JSON.stringify(label)}, ${JSON.stringify(options)});`;
    await browserWindow.webContents.executeJavaScript(script, true).catch(() => {});
}

async function setInjectedLibrary(browserWindow, folder = '') {
    if (browserWindow.isDestroyed()) {
        return;
    }
    const normalizedFolder = normalizeLibraryRelativePath(folder);
    const payload = {
        folder: normalizedFolder,
        parent: getLibraryParentFolder(normalizedFolder),
        items: toLibraryViewItems(await getLibraryItems(normalizedFolder))
    };
    const script = `window.__voiceFileSenderBridge?.setLibrary(${JSON.stringify(payload)});`;
    await browserWindow.webContents.executeJavaScript(script, true).catch(() => {});
}

async function setInjectedPreview(browserWindow, payload = {}) {
    if (browserWindow.isDestroyed()) {
        return;
    }
    const script = `window.__voiceFileSenderBridge?.playPreview(${JSON.stringify(payload)});`;
    await browserWindow.webContents.executeJavaScript(script, true).catch(() => {});
}

function normalizePeerText(value) {
    const text = String(value ?? '').trim();
    return text && text !== 'undefined' && text !== 'null' && text !== '0' ? text : '';
}

function collectNativePeerAliases(value, results = [], depth = 0, seen = new WeakSet()) {
    if (!value || depth > 7 || results.length > 80) {
        return results;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectNativePeerAliases(item, results, depth + 1, seen);
        }
        return results;
    }
    if (typeof value !== 'object' || value instanceof Uint8Array || value instanceof Map) {
        return results;
    }
    if (seen.has(value)) {
        return results;
    }
    seen.add(value);

    const chatType = Number(value.chatType || value.type || value.aioType || value.peer?.chatType || value.header?.chatType) || 0;
    const addAlias = (peerUid, peerUin) => {
        peerUid = normalizePeerText(peerUid);
        peerUin = normalizePeerText(peerUin);
        if ((chatType === 1 || chatType === 100 || !chatType) && peerUid.startsWith('u_') && /^\d+$/.test(peerUin)) {
            results.push({ peerUin, peerUid });
        }
    };
    addAlias(value.peerUid || value.peer?.peerUid || value.header?.peerUid, value.peerUin || value.peer?.peerUin || value.header?.peerUin);
    addAlias(value.senderUid || value.sender?.uid || value.sender?.peerUid, value.senderUin || value.sender?.uin || value.sender?.peerUin);
    addAlias(value.uid || value.peer?.uid || value.header?.uid, value.uin || value.chatUin || value.peer?.uin || value.header?.uin);

    for (const key of ['payload', 'msgList', 'elements', 'records', 'data', 'result', 'msgElements', 'peer', 'header', 'sender', 'sendMember']) {
        collectNativePeerAliases(value[key], results, depth + 1, seen);
    }
    return results;
}

function rememberNativePeerAliases(browserWindow, args) {
    const state = getWindowState(browserWindow);
    for (const arg of args) {
        for (const alias of collectNativePeerAliases(arg)) {
            state.peerUidByUin.set(alias.peerUin, alias.peerUid);
        }
    }
}

function handleVoiceNativeSend(browserWindow, _channel, args) {
    rememberNativePeerAliases(browserWindow, args);
    return false;
}

function findForwardRequestPayload(value, sourceMsgId, depth = 0, seen = new WeakSet()) {
    if (!value || depth > 8 || typeof value !== 'object' || value instanceof Uint8Array || value instanceof Map) {
        return null;
    }
    if (seen.has(value)) {
        return null;
    }
    seen.add(value);
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findForwardRequestPayload(item, sourceMsgId, depth + 1, seen);
            if (found) {
                return found;
            }
        }
        return null;
    }
    if (Array.isArray(value.msgIds) && value.msgIds.some(msgId => String(msgId) === sourceMsgId)) {
        return value;
    }
    for (const item of Object.values(value)) {
        const found = findForwardRequestPayload(item, sourceMsgId, depth + 1, seen);
        if (found) {
            return found;
        }
    }
    return null;
}

function replyToBlockedNativeRequest(event, request, result = { result: 0 }) {
    const sender = event?.sender;
    if (!sender || sender.isDestroyed?.() || !request?.callbackId) {
        return;
    }
    const peerId = Number(request.peerId) || sender.id;
    setImmediate(() => {
        if (!sender.isDestroyed?.()) {
            sender.send(`RM_IPCFROM_MAIN${peerId}`, {
                callbackId: request.callbackId,
                promiseStatue: 'full',
                promiseStatus: 'full',
                type: 'response',
                eventName: request.eventName,
                peerId
            }, result);
        }
    });
}

function handleVoiceNativeRequest(browserWindow, channel, args) {
    const state = getWindowState(browserWindow);
    const pending = state.pendingNativePttForward;
    if (!pending) {
        return false;
    }
    if (pending.expiresAt < Date.now()) {
        state.pendingNativePttForward = null;
        return false;
    }
    const command = args.find(value => value?.cmdName && value?.payload !== undefined);
    if (!command || !/forward/i.test(String(command.cmdName || ''))) {
        return false;
    }
    const payload = findForwardRequestPayload(command.payload, pending.sourceMsgId);
    if (!payload) {
        return false;
    }
    const peers = normalizeForwardTargets(payload.dstContacts);
    state.pendingNativePttForward = null;
    replyToBlockedNativeRequest(args[0], args.find(value => value?.callbackId), { result: 0 });
    if (!peers.length) {
        setInjectedStatus(browserWindow, '\u8f6c\u53d1\u76ee\u6807\u8bfb\u53d6\u5931\u8d25', {
            disabled: false,
            error: true,
            resetAfterMs: 2200
        }).catch(() => {});
        return true;
    }
    Promise.resolve().then(async () => {
        for (const peer of peers) {
            await sendPttInfoAsPtt(browserWindow, peer, pending.ptt);
        }
    }).catch(error => setInjectedStatus(browserWindow, error?.message || String(error), {
        disabled: false,
        error: true,
        resetAfterMs: 2600
    }));
    return true;
}

function prepareNativePttForward(browserWindow, ptt, sourceMsgId) {
    if (!voiceForwardInContextMenuEnabled) {
        return;
    }
    ptt = sanitizePttInfo(ptt);
    sourceMsgId = normalizePeerText(sourceMsgId);
    if (!ptt || !sourceMsgId) {
        throw new Error('\u65e0\u6cd5\u8bfb\u53d6\u5f85\u8f6c\u53d1\u7684\u8bed\u97f3\u6d88\u606f\u3002');
    }
    getWindowState(browserWindow).pendingNativePttForward = {
        expiresAt: Date.now() + PTT_FORWARD_TTL_MS,
        ptt,
        sourceMsgId
    };
}

function normalizeForwardTargets(dstContacts) {
    const seen = new Set();
    return (Array.isArray(dstContacts) ? dstContacts : [])
        .map(contact => ({
            chatType: Number(contact?.chatType) || 0,
            peerUid: normalizePeerText(contact?.peerUid),
            peerUin: normalizePeerText(contact?.peerUin),
            guildId: normalizePeerText(contact?.guildId)
        }))
        .filter(peer => {
            const key = `${peer.chatType}:${peer.peerUid}`;
            if (![1, 2, 100].includes(peer.chatType) || !peer.peerUid || seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
}

async function generateMsgUniqueId(browserWindow, chatType) {
    const serverTimeResult = await qqNativeInvoke(browserWindow, 'ntApi', 'nodeIKernelMSFService/getServerTime', [], true);
    const serverTime = unwrapNativeValue(serverTimeResult);
    const uniqueIdResult = await qqNativeInvoke(
        browserWindow,
        'ntApi',
        'nodeIKernelMsgService/generateMsgUniqueId',
        [chatType, serverTime],
        true
    );
    const uniqueId = unwrapNativeValue(uniqueIdResult);
    if (uniqueId === undefined || uniqueId === null || typeof uniqueId === 'object') {
        throw new Error(`QQNT returned an invalid unique id: ${safeJson(uniqueIdResult)}`);
    }
    return uniqueId;
}

async function createNativePttCacheFile(silkPath) {
    const [md5, stat, oriDir] = await Promise.all([
        getFileMd5(silkPath),
        fs.stat(silkPath),
        getNativePttOriDir()
    ]);
    const fileName = `${md5}.amr`;
    const filePath = path.join(oriDir, fileName);
    await fs.copyFile(silkPath, filePath);
    const result = {
        fileName,
        filePath,
        md5HexStr: md5,
        fileSize: String(stat.size)
    };
    return result;
}

async function createPttElement(silkPath, durationSeconds, waveAmplitudes) {
    const fileInfo = await createNativePttCacheFile(silkPath);
    const actualDuration = Math.max(1, Math.ceil(Number(durationSeconds) || 1));
    return {
        elementType: 4,
        elementId: '',
        pttElement: {
            fileName: fileInfo.fileName,
            filePath: fileInfo.filePath,
            md5HexStr: fileInfo.md5HexStr,
            fileSize: fileInfo.fileSize,
            duration: fakeVoiceDurationSeconds || actualDuration,
            formatType: 1,
            voiceType: 1,
            voiceChangeType: 0,
            canConvert2Text: true,
            waveAmplitudes,
            fileUuid: '',
            fileSubId: '',
            playState: 1,
            autoConvertText: 0,
            storeID: 0,
            otherBusinessInfo: {
                aiVoiceType: 0
            }
        }
    };
}

async function sendPttElement(browserWindow, peer, pttElement, msgAttributeInfos, attrId) {
    const sendAttempts = [
        {
            name: 'array',
            payload: [
                '0',
                peer,
                [pttElement],
                msgAttributeInfos
            ]
        },
        {
            name: 'object',
            payload: [{
                msgId: '0',
                peer,
                msgElements: [pttElement],
                msgAttributeInfos
            }, null]
        }
    ];
    let lastResult;
    for (const attempt of sendAttempts) {
        const sentMsgWaiter = createNativeEventWaiter(browserWindow, {
            cmdName: 'nodeIKernelMsgListener/onMsgInfoListUpdate',
            attrId,
            sendStatus: 2
        }, 30000);
        const uploadWaiter = createNativeEventWaiter(browserWindow, {
            cmdName: 'nodeIKernelMsgListener/onRichMediaUploadComplete',
            filePath: pttElement?.pttElement?.filePath
        }, 30000);
        let result;
        try {
            result = await qqNativeInvoke(
                browserWindow,
                'ntApi',
                'nodeIKernelMsgService/sendMsg',
                attempt.payload,
                true,
                15000
            );
        } catch (error) {
            sentMsgWaiter.cancel();
            uploadWaiter.cancel();
            throw error;
        }
        lastResult = result;
        if (!isNativeFailure(result)) {
            sentMsgWaiter.promise.catch(() => {});
            uploadWaiter.promise.catch(() => {});
            return {
                shape: attempt.name,
                result
            };
        }
        sentMsgWaiter.cancel();
        uploadWaiter.cancel();
    }
    throw new Error(`QQNT rejected sendMsg: ${safeJson(lastResult)}`);
}

function normalizeSendPeer(browserWindow, peer) {
    const chatType = Number(peer?.chatType) || 0;
    let peerUid = normalizePeerText(peer?.peerUid);
    const peerUin = normalizePeerText(peer?.peerUin);
    if (!chatType) {
        throw new Error('未找到当前聊天类型。');
    }
    if ((chatType === 1 || chatType === 100) && !peerUid.startsWith('u_')) {
        const mappedUid = getWindowState(browserWindow).peerUidByUin.get(peerUid) ||
            getWindowState(browserWindow).peerUidByUin.get(peerUin);
        if (mappedUid) {
            peerUid = mappedUid;
        }
    }
    if (!peerUid) {
        throw new Error('未找到当前聊天对象。');
    }
    if ((chatType === 1 || chatType === 100) && !peerUid.startsWith('u_')) {
        throw new Error('未取到私聊 NT UID，请切换一次会话或等待消息加载后重试。');
    }
    return {
        chatType,
        peerUid,
        guildId: normalizePeerText(peer?.guildId)
    };
}

async function sendMediaPathAsPtt(browserWindow, peer, mediaPath, options = {}) {
    peer = normalizeSendPeer(browserWindow, peer);
    if (!isSupportedMediaPath(mediaPath) && !isSilkFile(mediaPath)) {
        throw new Error(`Unsupported audio or video file: ${mediaPath}`);
    }
    const silkResult = await encodeMediaFileToSilk(mediaPath, options);
    const silkPath = await makeTempSilkPath();
    await fs.writeFile(silkPath, silkResult.data);
    try {
        const pttElement = await createPttElement(
            silkPath,
            silkResult.duration / 1000,
            silkResult.waveAmplitudes
        );
        const attrId = await generateMsgUniqueId(browserWindow, peer.chatType);
        const msgAttributeInfos = makeSendAttributeInfos(attrId);
        return await sendPttElement(browserWindow, peer, pttElement, msgAttributeInfos, attrId);
    } finally {
        setTimeout(() => {
            fs.unlink(silkPath).catch(() => {});
        }, 24 * 60 * 60 * 1000);
    }
}

async function sendSilkPathAsPtt(browserWindow, peer, silkPath, durationSeconds = 0) {
    if (!silkPath || !fsSync.existsSync(silkPath)) {
        throw new Error(`Voice file was not found: ${silkPath}`);
    }
    return await sendMediaPathAsPtt(browserWindow, peer, silkPath, {
        durationMs: Number(durationSeconds) > 0 ? Number(durationSeconds) * 1000 : undefined
    });
}

async function waitForInjectedAction(browserWindow) {
    const source = `window.__voiceFileSenderEnabled = ${JSON.stringify(voiceFeatureEnabled)};` +
        `window.__voiceFileSenderSaveInContextMenuEnabled = ${JSON.stringify(voiceSaveInContextMenuEnabled)};` +
        `window.__voiceFileSenderForwardInContextMenuEnabled = ${JSON.stringify(voiceForwardInContextMenuEnabled)};` +
        `(${injectedVoiceFileSenderUi.toString()})((${createVoiceLibraryPanel.toString()}), ${JSON.stringify(VOICE_LIBRARY_PANEL_CSS)})`;
    return await browserWindow.webContents.executeJavaScript(source, true);
}

async function sendLibraryItemAsPtt(browserWindow, peer, itemId) {
    let item = await getLibraryItem(itemId);
    if (!item) {
        throw new Error(`Voice library item was not found: ${itemId}`);
    }
    if (item.kind === 'ptt') {
        return await sendSilkPathAsPtt(browserWindow, peer, item.path, Number(item.duration) || 0);
    }
    return await sendMediaPathAsPtt(browserWindow, peer, item.path, {
        durationMs: Number(item.duration) > 0 ? Number(item.duration) * 1000 : undefined
    });
}

async function sendPttInfoAsPtt(browserWindow, peer, ptt) {
    const sourcePath = resolvePttSourcePath(ptt);
    if (!sourcePath) {
        throw new Error('The voice file was not found in QQNT cache. Play it once, then try again.');
    }
    return await sendMediaPathAsPtt(browserWindow, peer, sourcePath, {
        durationMs: Number(ptt?.duration) > 0 ? Number(ptt.duration) * 1000 : undefined
    });
}

async function refreshInjectedLibrary(browserWindow, message = '', folder = '') {
    await setInjectedLibrary(browserWindow, folder);
    await setInjectedStatus(browserWindow, message, {
        disabled: false,
        resetAfterMs: message ? 1800 : undefined
    });
}

async function handleInjectedAction(browserWindow, action) {
    if (!voiceFeatureEnabled) {
        return;
    }
    if (!action?.type) {
        return;
    }
    if (action.type === 'list') {
        await refreshInjectedLibrary(browserWindow, '', action.folder || '');
        return;
    }
    if (action.type === 'savePtt') {
        if (!voiceSaveInContextMenuEnabled) {
            return;
        }
        await addPttToLibrary(action.ptt);
        await refreshInjectedLibrary(browserWindow, '已保存', action.folder || '');
        return;
    }
    if (action.type === 'prepareNativePttForward') {
        if (!voiceForwardInContextMenuEnabled) {
            return;
        }
        prepareNativePttForward(browserWindow, action.ptt, action.sourceMsgId);
        return;
    }
    if (action.type === 'pickSave') {
        const result = await showMediaOpenDialog(browserWindow);
        if (result.canceled) {
            await setInjectedStatus(browserWindow, '', { disabled: false });
            return;
        }
        const savedItems = await addMediaFilesToLibrary(result.filePaths || [], action.folder || '');
        await refreshInjectedLibrary(browserWindow, savedItems.length ? '已添加' : '无音视频', action.folder || '');
        return;
    }
    if (action.type === 'deleteLibrary') {
        await deleteLibraryItem(action.id);
        await refreshInjectedLibrary(browserWindow, '已删除', action.folder || '');
        return;
    }
    if (action.type === 'renameLibrary') {
        await renameLibraryItem(action.id, action.title);
        await refreshInjectedLibrary(browserWindow, '已重命名', action.folder || '');
        return;
    }
    if (action.type === 'previewLibrary') {
        const previewItem = await createLibraryPreviewItem(action.id);
        const previewData = await fs.readFile(previewItem.previewPath);
        await setInjectedPreview(browserWindow, {
            previewUrl: `data:audio/wav;base64,${previewData.toString('base64')}`,
            previewTitle: previewItem.title || '语音'
        });
        await setInjectedStatus(browserWindow, '已加载播放', {
            disabled: false,
            resetAfterMs: 1200
        });
        return;
    }
    if (action.type === 'sendLibrary') {
        if (!action.peer) {
            throw new Error('No active chat peer was found.');
        }
        await sendLibraryItemAsPtt(browserWindow, action.peer, action.id);
        await refreshInjectedLibrary(browserWindow, '已发送', action.folder || '');
        return;
    }
    if (action.type === 'sendPtt') {
        if (!action.peer) {
            throw new Error('No active chat peer was found.');
        }
        await sendPttInfoAsPtt(browserWindow, action.peer, action.ptt);
        await refreshInjectedLibrary(browserWindow, '已发送', action.folder || '');
        return;
    }

    let filePaths = [];
    if (action.type === 'drop') {
        filePaths = action.paths || [];
    } else if (action.type === 'pick') {
        const result = await showMediaOpenDialog(browserWindow);
        if (result.canceled) {
            await setInjectedStatus(browserWindow, '', { disabled: false });
            return;
        }
        filePaths = result.filePaths || [];
    } else {
        return;
    }

    filePaths = filePaths.filter(isSupportedMediaPath);
    if (filePaths.length === 0) {
        await setInjectedStatus(browserWindow, '无音视频', {
            disabled: false,
            resetAfterMs: 1600
        });
        return;
    }
    if (!action.peer) {
        throw new Error('No active chat peer was found.');
    }
    for (const filePath of filePaths) {
        await sendMediaPathAsPtt(browserWindow, action.peer, filePath);
    }
    await refreshInjectedLibrary(browserWindow, '已发送', action.folder || '');
}

async function runInjectedUiLoop(browserWindow) {
    const state = getWindowState(browserWindow);
    if (!voiceFeatureEnabled || state.uiLoopRunning || browserWindow.isDestroyed()) {
        return;
    }
    state.uiLoopRunning = true;
    while (!browserWindow.isDestroyed()) {
        try {
            const action = await waitForInjectedAction(browserWindow);
            await handleInjectedAction(browserWindow, action);
        } catch (error) {
            if (!browserWindow.isDestroyed()) {
                await setInjectedStatus(browserWindow, error?.message || String(error), {
                    disabled: false,
                    error: true,
                    resetAfterMs: 2600
                });
                await new Promise(resolve => setTimeout(resolve, 1200));
            }
        }
    }
    state.uiLoopRunning = false;
}

function setupBrowserWindow(browserWindow) {
    if (!voiceFeatureEnabled || !browserWindow || browserWindow.isDestroyed()) {
        return;
    }
    addNativeSendHandler(browserWindow, handleVoiceNativeSend);
    addNativeRequestHandler(browserWindow, handleVoiceNativeRequest);
    const start = () => runInjectedUiLoop(browserWindow).catch(() => {});
    browserWindow.webContents.once('dom-ready', () => setTimeout(start, 500));
    browserWindow.webContents.on('did-finish-load', () => setTimeout(start, 500));
    setTimeout(start, 1200);
}

function onBrowserWindowCreated(browserWindow) {
    setupBrowserWindow(browserWindow);
}

function setupAllWindows() {
    for (const browserWindow of BrowserWindow.getAllWindows()) {
        setupBrowserWindow(browserWindow);
    }
}

async function setInjectedEnabled(browserWindow, enabled) {
    if (!browserWindow || browserWindow.isDestroyed()) {
        return;
    }
    const source = `window.__voiceFileSenderEnabled = ${JSON.stringify(enabled)}; window.__voiceFileSenderBridge?.setEnabled?.(${JSON.stringify(enabled)});`;
    await browserWindow.webContents.executeJavaScript(source, true).catch(() => {});
}

async function setInjectedSaveInContextMenuEnabled(browserWindow, enabled) {
    if (!browserWindow || browserWindow.isDestroyed()) {
        return;
    }
    const source = `window.__voiceFileSenderSaveInContextMenuEnabled = ${JSON.stringify(enabled)}; window.__voiceFileSenderBridge?.setSaveInContextMenuEnabled?.(${JSON.stringify(enabled)});`;
    await browserWindow.webContents.executeJavaScript(source, true).catch(() => {});
}

async function setInjectedForwardInContextMenuEnabled(browserWindow, enabled) {
    if (!browserWindow || browserWindow.isDestroyed()) {
        return;
    }
    const source = `window.__voiceFileSenderForwardInContextMenuEnabled = ${JSON.stringify(enabled)}; window.__voiceFileSenderBridge?.setForwardInContextMenuEnabled?.(${JSON.stringify(enabled)});`;
    await browserWindow.webContents.executeJavaScript(source, true).catch(() => {});
}

function setEnabled(enabled) {
    voiceFeatureEnabled = enabled === true;
    for (const browserWindow of BrowserWindow.getAllWindows()) {
        setInjectedEnabled(browserWindow, voiceFeatureEnabled);
    }
    if (voiceFeatureEnabled) {
        setTimeout(setupAllWindows, 300);
    }
}

function setSaveInContextMenuEnabled(enabled) {
    voiceSaveInContextMenuEnabled = enabled === true;
    for (const browserWindow of BrowserWindow.getAllWindows()) {
        setInjectedSaveInContextMenuEnabled(browserWindow, voiceSaveInContextMenuEnabled);
    }
}

function setForwardInContextMenuEnabled(enabled) {
    voiceForwardInContextMenuEnabled = enabled === true;
    for (const browserWindow of BrowserWindow.getAllWindows()) {
        setInjectedForwardInContextMenuEnabled(browserWindow, voiceForwardInContextMenuEnabled);
    }
}

function setFakeDurationSeconds(value) {
    const seconds = Math.trunc(Number(value));
    fakeVoiceDurationSeconds = Number.isFinite(seconds) && seconds > 0
        ? Math.min(seconds, 300)
        : 0;
}

module.exports = {
    onBrowserWindowCreated,
    setEnabled,
    setSaveInContextMenuEnabled,
    setForwardInContextMenuEnabled,
    setFakeDurationSeconds,
    sendPttInfoAsPtt,
    sanitizePttInfo,
    runTool
};
