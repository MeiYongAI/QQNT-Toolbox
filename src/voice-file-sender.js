const { app, BrowserWindow, dialog, ipcMain } = require("electron");

const util = require('util');
const execFile = util.promisify(require("child_process").execFile);

const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { decode, encode } = require('silk-wasm');

const PLUGIN_SLUG = 'qqnt_toolbox';
const PLUGIN_NAME = 'QQNT Toolbox';
const VOICE_DATA_DIR_NAME = 'voice';
const AUDIO_FILE_EXTENSIONS = ['aac', 'amr', 'flac', 'm4a', 'mp3', 'ogg', 'opus', 'wav', 'weba', 'webm'];
const VIDEO_FILE_EXTENSIONS = ['3g2', '3gp', 'asf', 'avi', 'flv', 'm2ts', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'ogv', 'ts', 'webm', 'wmv'];
const MEDIA_FILE_EXTENSIONS = uniqueStrings([...AUDIO_FILE_EXTENSIONS, ...VIDEO_FILE_EXTENSIONS]);
const MEDIA_EXTENSION_SET = new Set(MEDIA_FILE_EXTENSIONS.map(extension => `.${extension}`));
const TARGET_SILK_SAMPLE_RATE = 24000;
let voiceFeatureEnabled = true;
let voiceSaveInContextMenuEnabled = true;

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

function getToolCandidates(toolName) {
    return [
        process.env[`${toolName.toUpperCase()}_PATH`],
        process.env[`${toolName.toLowerCase()}_PATH`],
        ['ffmpeg', 'ffprobe'].includes(toolName)
            ? `C:\\Program Files\\ffmpeg\\bin\\${toolName}.exe`
            : '',
        toolName
    ].filter(Boolean);
}

async function runTool(toolName, args, options = {}) {
    for (const command of getToolCandidates(toolName)) {
        if (path.isAbsolute(command) && !fsSync.existsSync(command)) {
            continue;
        }
        try {
            return await execFile(command, args, {
                windowsHide: true,
                maxBuffer: 512 * 1024 * 1024,
                ...options
            });
        } catch (error) {
            if (error.code === 'ENOENT') {
                continue;
            }
            error.message = `${toolName} failed (${command}): ${error.message}`;
            throw error;
        }
    }
    throw new Error(`${toolName} was not found. Put it in PATH or set ${toolName.toUpperCase()}_PATH.`);
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
            const decoded = await decode(toExactArrayBuffer(sourceData), TARGET_SILK_SAMPLE_RATE);
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

async function createPttPreviewItem(value) {
    const ptt = sanitizePttInfo(value);
    const sourcePath = resolvePttSourcePath(ptt);
    if (!sourcePath) {
        throw new Error('Voice file was not found in QQNT cache.');
    }
    return {
        title: normalizeFieldText(ptt?.fileName) || 'Voice message',
        duration: Number(ptt?.duration) || 0,
        previewPath: await createAudioPreviewFile(sourcePath, ptt?.md5HexStr || ptt?.fileName)
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
    const silkResult = await encodeMediaFileToSilk(filePath, {
        allowSilk: true
    });
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
    for (const filePath of filePaths.filter(isSupportedMediaPath)) {
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
    const duration = Number(ptt?.duration) || 0;
    const title = duration > 0 ? `语音 ${Math.ceil(duration)}s` : '语音消息';
    return await addFileToLibrary(sourcePath, {
        title,
        duration,
        originalName: ptt?.fileName || path.basename(sourcePath)
    });
}

function convertBufferToHexPreview(buffer, length) {
    return Buffer.from(buffer).toString('hex', 0, length);
}

function isSilkData(data) {
    return convertBufferToHexPreview(data, 7) === '02232153494c4b';
}

function isSilkFile(filePath) {
    let fd;
    try {
        fd = fsSync.openSync(filePath, 'r');
        const header = Buffer.alloc(10);
        const bytesRead = fsSync.readSync(fd, header, 0, header.length, 0);
        return bytesRead >= 7 && isSilkData(header.subarray(0, bytesRead));
    } catch {
        return false;
    } finally {
        if (fd !== undefined) {
            try {
                fsSync.closeSync(fd);
            } catch {
            }
        }
    }
}

function toExactArrayBuffer(data) {
    if (data instanceof ArrayBuffer) {
        return data;
    }
    if (ArrayBuffer.isView(data)) {
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    }
    const buffer = Buffer.from(data);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function makePcm16Wav(pcmData, sampleRate, channels = 1) {
    const pcm = Buffer.from(pcmData);
    const header = Buffer.alloc(44);
    const bytesPerSample = 2;
    const byteRate = sampleRate * channels * bytesPerSample;
    const blockAlign = channels * bytesPerSample;
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

function getSilkFrameStart(data) {
    const buffer = Buffer.from(data);
    if (buffer.length >= 10 && buffer[0] === 0x02 && buffer.subarray(1, 10).toString('latin1') === '#!SILK_V3') {
        return 10;
    }
    if (buffer.length >= 9 && buffer.subarray(0, 9).toString('latin1') === '#!SILK_V3') {
        return 9;
    }
    return -1;
}

function inspectSilkFrames(data) {
    const buffer = Buffer.from(data);
    const frameStart = getSilkFrameStart(buffer);
    if (frameStart < 0) {
        return {
            isSilk: false,
            bytes: buffer.length
        };
    }

    let offset = frameStart;
    let frameCount = 0;
    let nextFrameSize = null;
    while (offset + 2 <= buffer.length) {
        const frameSize = buffer.readUInt16LE(offset);
        nextFrameSize = frameSize;
        if (!frameSize) {
            break;
        }
        const nextOffset = offset + 2 + frameSize;
        if (nextOffset > buffer.length) {
            return {
                isSilk: true,
                bytes: buffer.length,
                frameStart,
                frameCount,
                consumedBytes: offset,
                tailBytes: buffer.length - offset,
                nextFrameSize,
                missingBytes: nextOffset - buffer.length
            };
        }
        frameCount += 1;
        offset = nextOffset;
        nextFrameSize = null;
    }

    return {
        isSilk: true,
        bytes: buffer.length,
        frameStart,
        frameCount,
        consumedBytes: offset,
        tailBytes: buffer.length - offset,
        nextFrameSize,
        missingBytes: 0
    };
}

function estimateSilkDurationMs(data) {
    const info = inspectSilkFrames(data);
    return info.isSilk && info.frameCount > 0 ? info.frameCount * 20 : 1000;
}

function repairSilkFrames(data) {
    const buffer = Buffer.from(data);
    const before = inspectSilkFrames(buffer);
    if (!before.isSilk || before.tailBytes === 0) {
        return {
            data: buffer,
            action: 'none',
            before,
            after: before
        };
    }

    if (before.missingBytes > 0 && before.missingBytes <= 2) {
        const repaired = Buffer.concat([buffer, Buffer.alloc(before.missingBytes)]);
        return {
            data: repaired,
            action: `pad:${before.missingBytes}`,
            before,
            after: inspectSilkFrames(repaired)
        };
    }

    const repaired = Buffer.from(buffer.subarray(0, before.consumedBytes));
    return {
        data: repaired,
        action: 'trim',
        before,
        after: inspectSilkFrames(repaired)
    };
}

async function encodeToSilk(inputData, sampleRate) {
    try {
        return {
            data: await encode(toExactArrayBuffer(inputData), sampleRate)
        };
    } catch (error) {
        return {
            error: `An error occurred while converting audio to silk. Details: ${ error?.message || error }`
        };
    }
}

async function convertMediaToPcm24k(mediaPath) {
    const { stdout, stderr } = await runTool('ffmpeg', [
        '-v', 'error',
        '-y',
        '-i', mediaPath,
        '-vn',
        '-ar', String(TARGET_SILK_SAMPLE_RATE),
        '-ac', '1',
        '-f', 's16le',
        'pipe:1'
    ], {
        encoding: 'buffer'
    });
    if (stderr?.length) {
        throw new Error(Buffer.from(stderr).toString('utf8'));
    }
    return stdout;
}

async function encodeMediaFileToSilk(mediaPath, options = {}) {
    const file = await fs.readFile(mediaPath);
    if (isSilkData(file)) {
        if (!options.allowSilk) {
            throw new Error('Direct .silk sending is disabled because it can freeze this QQNT version.');
        }
        const repaired = repairSilkFrames(file);
        return {
            data: repaired.data,
            duration: Number(options.durationMs) || estimateSilkDurationMs(repaired.data),
            directSilk: true,
            sampleRate: TARGET_SILK_SAMPLE_RATE,
            silkRepair: {
                action: repaired.action,
                before: repaired.before,
                after: repaired.after
            }
        };
    }

    const inputData = await convertMediaToPcm24k(mediaPath);

    const silkResult = await encodeToSilk(inputData, TARGET_SILK_SAMPLE_RATE);
    if (silkResult.error) {
        throw new Error(silkResult.error);
    }
    const repaired = repairSilkFrames(silkResult.data.data);

    return {
        ...silkResult.data,
        data: repaired.data,
        duration: Number(silkResult.data.duration) || estimateSilkDurationMs(repaired.data),
        sampleRate: TARGET_SILK_SAMPLE_RATE,
        silkRepair: {
            action: repaired.action,
            before: repaired.before,
            after: repaired.after
        }
    };
}

function unwrapNativeValue(value) {
    if (!value || typeof value !== 'object' || value instanceof Map || value instanceof Uint8Array) {
        return value;
    }
    for (const key of ['result', 'data', 'value', 'id']) {
        if (value[key] !== undefined) {
            return value[key];
        }
    }
    return value;
}

function getMsgAttrId(msgRecord) {
    const attrs = msgRecord?.msgAttrs;
    if (!attrs) {
        return undefined;
    }
    if (attrs instanceof Map) {
        return attrs.get(0)?.attrId;
    }
    return attrs[0]?.attrId || attrs['0']?.attrId;
}

function collectMsgRecords(value, records = [], depth = 0) {
    if (!value || depth > 4) {
        return records;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectMsgRecords(item, records, depth + 1);
        }
        return records;
    }
    if (typeof value !== 'object') {
        return records;
    }
    if (value.msgId !== undefined && value.msgAttrs !== undefined) {
        records.push(value);
        return records;
    }
    for (const key of ['payload', 'msgList', 'records', 'data', 'result']) {
        collectMsgRecords(value[key], records, depth + 1);
    }
    return records;
}

function normalizeComparablePath(filePath) {
    return String(filePath || '').replace(/\//g, '\\').toLowerCase();
}

function valueContainsPath(value, filePath, depth = 0) {
    if (!filePath || value === undefined || value === null || depth > 8) {
        return false;
    }
    const target = normalizeComparablePath(filePath);
    if (typeof value === 'string') {
        return normalizeComparablePath(value) === target;
    }
    if (Array.isArray(value)) {
        return value.some(item => valueContainsPath(item, filePath, depth + 1));
    }
    if (typeof value !== 'object' || value instanceof Uint8Array) {
        return false;
    }
    return Object.values(value).some(item => valueContainsPath(item, filePath, depth + 1));
}

function eventHasFilePath(response, result, filePath) {
    return valueContainsPath(response, filePath) || valueContainsPath(result, filePath);
}

function eventHasMessageAttr(response, result, attrId, sendStatus) {
    const records = [
        ...collectMsgRecords(response?.payload),
        ...collectMsgRecords(result?.payload),
        ...collectMsgRecords(result)
    ];
    return records.some(record => {
        const recordAttrId = getMsgAttrId(record);
        if (recordAttrId === undefined || String(recordAttrId) !== String(attrId)) {
            return false;
        }
        return sendStatus === undefined || Number(record.sendStatus) === Number(sendStatus);
    });
}

function matchesNativeResponse(waitResponse, callbackId, response, result) {
    if (waitResponse === true) {
        return response?.callbackId === callbackId;
    }
    if (typeof waitResponse === 'object' && waitResponse) {
        const cmdName = waitResponse.cmdName;
        const cmdMatched = !cmdName || response?.cmdName === cmdName || result?.cmdName === cmdName;
        if (!cmdMatched) {
            return false;
        }
        if (waitResponse.attrId !== undefined) {
            return eventHasMessageAttr(response, result, waitResponse.attrId, waitResponse.sendStatus);
        }
        if (waitResponse.filePath !== undefined) {
            return eventHasFilePath(response, result, waitResponse.filePath);
        }
        return true;
    }
    if (Array.isArray(waitResponse)) {
        return waitResponse.includes(response?.cmdName) || waitResponse.includes(result?.cmdName);
    }
    return response?.cmdName === waitResponse || result?.cmdName === waitResponse;
}

function isPlainEmptyObject(value) {
    return Boolean(value) &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !(value instanceof Map) &&
        !(value instanceof Uint8Array) &&
        Object.keys(value).length === 0;
}

function isNativeFailure(value) {
    return value?.promiseStatue === 'fail' ||
        value?.promiseStatus === 'fail' ||
        value?.result === false ||
        Number(value?.result) < 0 ||
        Number(value?.retCode) < 0 ||
        Number(value?.errCode) < 0;
}

function extractNativeResult(response, result) {
    if (isNativeFailure(response)) {
        return response;
    }
    if (result !== undefined && !isPlainEmptyObject(result)) {
        return result;
    }
    for (const item of [result, response]) {
        if (!item || typeof item !== 'object') {
            continue;
        }
        for (const key of ['payload', 'result', 'data', 'value', 'path', 'filePath', 'newPath']) {
            if (item[key] !== undefined) {
                return item[key];
            }
        }
    }
    return result;
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

const VOICE_LIBRARY_PANEL_CSS = String.raw`
#qqnt-toolbox-voice-library {
    --voice-bg: var(--bg_top_light, var(--background-05, var(--background-01, #ffffff)));
    --voice-layer: var(--fill_light_primary, var(--background-02, rgba(127, 127, 127, .06)));
    --voice-hover: var(--background-02, rgba(127, 127, 127, .12));
    --voice-active: var(--background-03, rgba(127, 127, 127, .18));
    --voice-border: var(--border-level-1-color, var(--divider, rgba(0, 0, 0, .08)));
    --voice-text: var(--text-primary, var(--text-01, #1f2329));
    --voice-muted: var(--text-secondary, var(--text-02, #6b7280));
    --voice-faint: var(--text-tertiary, var(--text-03, #8a8f99));
    --voice-accent: var(--brand_standard, var(--theme-color, #0099ff));
    --voice-danger: var(--text_error, #e84d4d);
    position: fixed;
    inset: 0;
    z-index: 2147483000;
    color: var(--voice-text);
    background: rgba(0, 0, 0, .28);
    font: 13px/1.45 var(--font-family, "Microsoft YaHei UI", "Microsoft YaHei", sans-serif);
    letter-spacing: 0;
}
#qqnt-toolbox-voice-library, #qqnt-toolbox-voice-library * {
    box-sizing: border-box;
}
#qqnt-toolbox-voice-library .qvlib-shell {
    position: absolute;
    left: var(--voice-left, 50%);
    top: var(--voice-top, 50%);
    width: min(360px, calc(100vw - 24px));
    height: min(400px, calc(100vh - 24px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transform: translate(-50%, -50%);
    border: 1px solid var(--voice-border);
    border-radius: 8px;
    background: var(--voice-bg);
    box-shadow: var(--shadow-bg-middle-primary, 0 18px 48px rgba(0, 0, 0, .18));
    will-change: left, top;
}
#qqnt-toolbox-voice-library .qvlib-header {
    flex: 0 0 44px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 7px 0 12px;
    border-bottom: 1px solid var(--voice-border);
    background: var(--voice-bg);
    cursor: grab;
    touch-action: none;
    user-select: none;
}
#qqnt-toolbox-voice-library .qvlib-shell.is-dragging .qvlib-header {
    cursor: grabbing;
}
#qqnt-toolbox-voice-library .qvlib-heading {
    min-width: 0;
    flex: 1;
    display: flex;
    align-items: baseline;
    gap: 6px;
}
#qqnt-toolbox-voice-library .qvlib-title {
    min-width: 0;
    overflow: hidden;
    color: var(--voice-text);
    font-size: 14px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#qqnt-toolbox-voice-library .qvlib-count {
    flex: none;
    color: var(--voice-muted);
    font-size: 11px;
    white-space: nowrap;
}
#qqnt-toolbox-voice-library button {
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 8px;
    border: 1px solid var(--voice-border);
    border-radius: 6px;
    color: var(--voice-text);
    background: var(--voice-layer);
    font: 500 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    letter-spacing: 0;
    white-space: nowrap;
    cursor: pointer;
}
#qqnt-toolbox-voice-library button:hover:not(:disabled) {
    background: var(--voice-hover);
}
#qqnt-toolbox-voice-library button:active:not(:disabled) {
    background: var(--voice-active);
}
#qqnt-toolbox-voice-library button:focus-visible,
#qqnt-toolbox-voice-library input:focus-visible,
#qqnt-toolbox-voice-library [role="slider"]:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--voice-accent) 72%, transparent);
    outline-offset: 1px;
}
#qqnt-toolbox-voice-library button:disabled {
    opacity: .42;
    cursor: default;
}
#qqnt-toolbox-voice-library .qvlib-icon-button {
    width: 30px;
    height: 30px;
    flex: none;
    padding: 0;
    border-color: transparent;
    background: transparent;
    font-size: 18px;
}
#qqnt-toolbox-voice-library .qvlib-close {
    color: var(--voice-muted);
    font-size: 19px;
}
#qqnt-toolbox-voice-library .qvlib-nav {
    flex: 0 0 38px;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 8px;
    border-bottom: 1px solid var(--voice-border);
    background: var(--voice-layer);
}
#qqnt-toolbox-voice-library .qvlib-nav[hidden] {
    display: none;
}
#qqnt-toolbox-voice-library .qvlib-back {
    width: 28px;
    flex: none;
    padding: 0;
    border-color: transparent;
    background: transparent;
    font-size: 16px;
}
#qqnt-toolbox-voice-library .qvlib-path {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
}
#qqnt-toolbox-voice-library .qvlib-path-current,
#qqnt-toolbox-voice-library .qvlib-path-parent {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#qqnt-toolbox-voice-library .qvlib-path-current {
    color: var(--voice-text);
    font-size: 12px;
}
#qqnt-toolbox-voice-library .qvlib-path-parent {
    color: var(--voice-muted);
    font-size: 10px;
}
#qqnt-toolbox-voice-library .qvlib-list {
    min-height: 0;
    flex: 1;
    overflow: auto;
    padding: 3px 8px;
    scrollbar-width: thin;
    scrollbar-color: var(--voice-border) transparent;
}
#qqnt-toolbox-voice-library .qvlib-list::-webkit-scrollbar {
    width: 4px;
}
#qqnt-toolbox-voice-library .qvlib-list::-webkit-scrollbar-track {
    background: transparent;
}
#qqnt-toolbox-voice-library .qvlib-list::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: var(--voice-border);
}
#qqnt-toolbox-voice-library .qvlib-empty {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--voice-faint);
}
#qqnt-toolbox-voice-library .qvlib-row {
    min-height: 55px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 7px;
    padding: 7px 3px;
    border-bottom: 1px solid var(--voice-border);
}
#qqnt-toolbox-voice-library .qvlib-row:last-child {
    border-bottom: 0;
}
#qqnt-toolbox-voice-library .qvlib-row:hover {
    background: var(--voice-layer);
}
#qqnt-toolbox-voice-library .qvlib-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
}
#qqnt-toolbox-voice-library .qvlib-name {
    overflow: hidden;
    color: var(--voice-text);
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#qqnt-toolbox-voice-library .qvlib-meta {
    overflow: hidden;
    color: var(--voice-muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#qqnt-toolbox-voice-library .qvlib-actions {
    display: flex;
    align-items: center;
    gap: 1px;
}
#qqnt-toolbox-voice-library .qvlib-row-action {
    height: 26px;
    padding: 0 4px;
    border-color: transparent;
    background: transparent;
}
#qqnt-toolbox-voice-library .qvlib-send {
    color: var(--voice-accent);
}
#qqnt-toolbox-voice-library .qvlib-delete {
    color: var(--voice-danger);
}
#qqnt-toolbox-voice-library .qvlib-player {
    flex: 0 0 56px;
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) auto;
    grid-template-rows: 19px 16px;
    align-items: center;
    gap: 3px 10px;
    padding: 7px 11px 8px;
    border-top: 1px solid var(--voice-border);
    background: var(--voice-bg);
}
#qqnt-toolbox-voice-library .qvlib-player-toggle {
    grid-column: 1;
    grid-row: 1 / 3;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    color: var(--voice-muted);
    background: var(--voice-layer);
    gap: 3px;
}
#qqnt-toolbox-voice-library .qvlib-player-toggle::before {
    content: "";
    width: 0;
    height: 0;
    border-top: 5px solid transparent;
    border-bottom: 5px solid transparent;
    border-left: 8px solid currentColor;
    transform: translateX(1px);
}
#qqnt-toolbox-voice-library .qvlib-player-toggle::after {
    content: "";
    display: none;
}
#qqnt-toolbox-voice-library .qvlib-player-toggle[data-playing="true"]::before,
#qqnt-toolbox-voice-library .qvlib-player-toggle[data-playing="true"]::after {
    width: 2px;
    height: 10px;
    flex: 0 0 2px;
    border: 0;
    border-radius: 1px;
    background: currentColor;
    transform: none;
}
#qqnt-toolbox-voice-library .qvlib-player-toggle[data-playing="true"]::after {
    display: block;
}
#qqnt-toolbox-voice-library .qvlib-player-title {
    grid-column: 2;
    grid-row: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--voice-muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#qqnt-toolbox-voice-library .qvlib-player-time {
    grid-column: 3;
    grid-row: 1;
    color: var(--voice-faint);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}
#qqnt-toolbox-voice-library .qvlib-track {
    grid-column: 2 / 4;
    grid-row: 2;
    position: relative;
    height: 16px;
    display: flex;
    align-items: center;
    cursor: pointer;
}
#qqnt-toolbox-voice-library .qvlib-track::before {
    content: "";
    width: 100%;
    height: 4px;
    border-radius: 999px;
    background: var(--voice-border);
}
#qqnt-toolbox-voice-library .qvlib-progress {
    position: absolute;
    left: 0;
    top: 50%;
    width: var(--voice-progress, 0%);
    height: 4px;
    transform: translateY(-50%);
    border-radius: 999px;
    background: var(--voice-accent);
}
#qqnt-toolbox-voice-library .qvlib-thumb {
    position: absolute;
    left: var(--voice-progress, 0%);
    top: 50%;
    width: 8px;
    height: 8px;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: var(--voice-accent);
    box-shadow: 0 0 0 2px var(--voice-bg);
    opacity: 0;
}
#qqnt-toolbox-voice-library .qvlib-player.is-ready .qvlib-track:hover .qvlib-thumb,
#qqnt-toolbox-voice-library .qvlib-player.is-ready .qvlib-track:focus-visible .qvlib-thumb {
    opacity: 1;
}
#qqnt-toolbox-voice-library audio {
    display: none;
}
#qqnt-toolbox-voice-library .qvlib-footer {
    flex: 0 0 44px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 7px;
    padding: 7px 9px;
    border-top: 1px solid var(--voice-border);
    background: var(--voice-bg);
}
#qqnt-toolbox-voice-library .qvlib-footer button {
    width: 100%;
    height: 30px;
}
#qqnt-toolbox-voice-library .qvlib-toast {
    position: absolute;
    left: 50%;
    top: 51px;
    z-index: 7;
    max-width: calc(100% - 24px);
    overflow: hidden;
    padding: 6px 10px;
    transform: translate(-50%, -7px);
    border: 1px solid var(--voice-border);
    border-radius: 6px;
    color: var(--voice-text);
    background: var(--voice-bg);
    box-shadow: 0 7px 20px rgba(0, 0, 0, .2);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity .14s ease, transform .14s ease;
}
#qqnt-toolbox-voice-library .qvlib-toast.is-visible {
    transform: translate(-50%, 0);
    opacity: 1;
}
#qqnt-toolbox-voice-library .qvlib-toast.is-error {
    color: var(--voice-danger);
    border-color: color-mix(in srgb, var(--voice-danger) 58%, var(--voice-border));
}
#qqnt-toolbox-voice-library .qvlib-dialog-layer {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 22px;
    background: rgba(0, 0, 0, .24);
}
#qqnt-toolbox-voice-library .qvlib-dialog {
    width: 100%;
    max-width: 310px;
    padding: 14px;
    border: 1px solid var(--voice-border);
    border-radius: 8px;
    background: var(--voice-bg);
    box-shadow: 0 12px 30px rgba(0, 0, 0, .24);
}
#qqnt-toolbox-voice-library .qvlib-dialog-title {
    margin-bottom: 8px;
    color: var(--voice-text);
    font-size: 14px;
    font-weight: 600;
}
#qqnt-toolbox-voice-library .qvlib-dialog-message {
    margin-bottom: 10px;
    color: var(--voice-muted);
    font-size: 12px;
    overflow-wrap: anywhere;
    white-space: pre-line;
}
#qqnt-toolbox-voice-library .qvlib-dialog input {
    width: 100%;
    height: 32px;
    padding: 0 8px;
    border: 1px solid var(--voice-border);
    border-radius: 6px;
    outline: 0;
    color: var(--voice-text) !important;
    -webkit-text-fill-color: var(--voice-text) !important;
    caret-color: var(--voice-text);
    background: var(--voice-layer) !important;
    font: 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    letter-spacing: 0;
}
#qqnt-toolbox-voice-library .qvlib-dialog input:focus {
    border-color: var(--voice-accent);
    background: var(--voice-hover) !important;
}
#qqnt-toolbox-voice-library .qvlib-dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 7px;
    margin-top: 12px;
}
#qqnt-toolbox-voice-library .qvlib-dialog-confirm.is-danger {
    color: var(--voice-danger);
}
@media (max-width: 390px) {
    #qqnt-toolbox-voice-library .qvlib-row-action {
        padding: 0 3px;
        font-size: 11px;
    }
    #qqnt-toolbox-voice-library .qvlib-row {
        gap: 5px;
    }
}
`;

function createVoiceLibraryPanel(options = {}) {
    const ROOT_ID = 'qqnt-toolbox-voice-library';
    const STYLE_ID = 'qqnt-toolbox-voice-library-style';
    const TEXT = {
        title: '\u8bed\u97f3\u6d88\u606f',
        library: '\u8bed\u97f3\u5e93',
        empty: '\u6682\u65e0\u8bed\u97f3',
        folderEmpty: '\u8be5\u6587\u4ef6\u5939\u6682\u65e0\u8bed\u97f3',
        item: '\u8bed\u97f3',
        items: '\u9879',
        folder: '\u6587\u4ef6\u5939',
        pending: '\u5f85\u8f6c\u6362',
        duration: '\u65f6\u957f',
        unknown: '\u672a\u77e5',
        back: '\u8fd4\u56de',
        refresh: '\u5237\u65b0',
        pick: '\u9009\u62e9\u53d1\u9001',
        add: '\u6dfb\u52a0\u5230\u8bed\u97f3\u5e93',
        open: '\u6253\u5f00',
        send: '\u53d1\u9001',
        play: '\u64ad\u653e',
        pause: '\u6682\u505c',
        rename: '\u91cd\u547d\u540d',
        remove: '\u5220\u9664',
        close: '\u5173\u95ed',
        cancel: '\u53d6\u6d88',
        confirm: '\u786e\u5b9a',
        notPlaying: '\u672a\u64ad\u653e',
        progress: '\u64ad\u653e\u8fdb\u5ea6',
        choose: '\u9009\u62e9\u4e2d',
        refreshing: '\u5237\u65b0\u4e2d',
        sending: '\u53d1\u9001\u4e2d',
        converting: '\u4e34\u65f6\u8f6c\u6362\u5e76\u53d1\u9001\u4e2d',
        loading: '\u52a0\u8f7d\u64ad\u653e\u4e2d',
        renaming: '\u91cd\u547d\u540d\u4e2d',
        deleting: '\u5220\u9664\u4e2d',
        missing: '\u672a\u627e\u5230\u6761\u76ee',
        emptyName: '\u540d\u79f0\u4e0d\u80fd\u4e3a\u7a7a',
        deleteTitle: '\u5220\u9664\u8bed\u97f3',
        deleteMessage: '\u5220\u9664\u540e\u65e0\u6cd5\u6062\u590d\uff0c\u786e\u5b9a\u7ee7\u7eed\u5417\uff1f'
    };
    const state = {
        root: null,
        host: null,
        items: [],
        folder: '',
        parent: '',
        busy: false,
        statusTimer: 0,
        moved: false,
        position: null
    };

    function createElement(tagName, className = '', textContent) {
        const element = document.createElement(tagName);
        if (className) {
            element.className = className;
        }
        if (textContent !== undefined) {
            element.textContent = textContent;
        }
        return element;
    }

    function createButton(label, action, className = '', title = label) {
        const button = createElement('button', className, label);
        button.type = 'button';
        button.dataset.voiceAction = action;
        if (title) {
            button.title = title;
            button.setAttribute('aria-label', title);
        }
        return button;
    }

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = String(options.cssText || '').replaceAll('${ROOT_ID}', ROOT_ID);
        document.head.append(style);
    }

    function formatDuration(seconds) {
        const value = Math.ceil(Number(seconds) || 0);
        if (value <= 0) {
            return TEXT.unknown;
        }
        const minutes = Math.floor(value / 60);
        const rest = value % 60;
        return minutes > 0 ? `${minutes}:${String(rest).padStart(2, '0')}` : `${value}\u79d2`;
    }

    function formatPlayerTime(seconds) {
        const value = Math.max(0, Math.floor(Number(seconds) || 0));
        const minutes = Math.floor(value / 60);
        const rest = value % 60;
        return `${minutes}:${String(rest).padStart(2, '0')}`;
    }

    function getFolderTitle(folder = '') {
        const parts = String(folder || '').split('/').filter(Boolean);
        return parts[parts.length - 1] || TEXT.library;
    }

    function getItem(itemId) {
        return state.items.find(item => String(item.id) === String(itemId)) || null;
    }

    function emit(action) {
        options.onAction?.({
            ...action,
            folder: action.folder ?? state.folder
        });
    }

    function updateDisabledState() {
        if (!state.root) {
            return;
        }
        state.root.querySelectorAll('[data-voice-action]').forEach(button => {
            const action = button.dataset.voiceAction;
            if (action === 'close') {
                button.disabled = false;
                return;
            }
            if (action === 'playerToggle') {
                const audio = state.root.querySelector('audio');
                button.disabled = state.busy || !audio?.src;
                return;
            }
            button.disabled = state.busy;
        });
    }

    function setStatus(message = '', statusOptions = {}) {
        if (!state.root) {
            return;
        }
        if (Object.prototype.hasOwnProperty.call(statusOptions, 'disabled')) {
            state.busy = Boolean(statusOptions.disabled);
            updateDisabledState();
        }
        clearTimeout(state.statusTimer);
        let toast = state.root.querySelector('.qvlib-toast');
        if (!message) {
            toast?.classList.remove('is-visible');
            if (toast) {
                setTimeout(() => {
                    if (!toast.classList.contains('is-visible')) {
                        toast.remove();
                    }
                }, 160);
            }
            return;
        }
        if (!toast) {
            toast = createElement('div', 'qvlib-toast');
            state.root.querySelector('.qvlib-shell')?.append(toast);
        }
        toast.textContent = message;
        toast.classList.toggle('is-error', Boolean(statusOptions.error));
        requestAnimationFrame(() => toast.classList.add('is-visible'));
        if (statusOptions.resetAfterMs) {
            state.statusTimer = setTimeout(() => setStatus(''), statusOptions.resetAfterMs);
        }
    }

    function closeDialog() {
        state.root?.querySelector('.qvlib-dialog-layer')?.remove();
    }

    function showDialog(dialogOptions = {}) {
        const shell = state.root?.querySelector('.qvlib-shell');
        if (!shell) {
            return;
        }
        closeDialog();
        const layer = createElement('div', 'qvlib-dialog-layer');
        const form = createElement('form', 'qvlib-dialog');
        const title = createElement('div', 'qvlib-dialog-title', dialogOptions.title || '');
        form.append(title);
        if (dialogOptions.message) {
            form.append(createElement('div', 'qvlib-dialog-message', dialogOptions.message));
        }
        let input = null;
        if (dialogOptions.inputValue !== undefined) {
            input = createElement('input');
            input.value = dialogOptions.inputValue || '';
            input.maxLength = 80;
            form.append(input);
        }
        const actions = createElement('div', 'qvlib-dialog-actions');
        const cancel = createElement('button', '', TEXT.cancel);
        cancel.type = 'button';
        cancel.addEventListener('click', closeDialog);
        const confirm = createElement(
            'button',
            `qvlib-dialog-confirm${dialogOptions.danger ? ' is-danger' : ''}`,
            dialogOptions.confirmText || TEXT.confirm
        );
        confirm.type = 'submit';
        form.addEventListener('submit', event => {
            event.preventDefault();
            event.stopPropagation();
            dialogOptions.onConfirm?.(input?.value.trim() ?? '');
        });
        actions.append(cancel, confirm);
        form.append(actions);
        layer.append(form);
        layer.addEventListener('pointerdown', event => {
            if (event.target === layer) {
                closeDialog();
            }
        });
        shell.append(layer);
        if (input) {
            input.focus();
            input.select?.();
        } else {
            cancel.focus();
        }
    }

    function showRenameDialog(item) {
        showDialog({
            title: TEXT.rename,
            inputValue: item.title || '',
            onConfirm: nextTitle => {
                if (!nextTitle) {
                    setStatus(TEXT.emptyName, { error: true, resetAfterMs: 1600 });
                    return;
                }
                closeDialog();
                setStatus(TEXT.renaming, { disabled: true });
                emit({ type: 'renameLibrary', id: item.id, title: nextTitle });
            }
        });
    }

    function showDeleteDialog(item) {
        showDialog({
            title: TEXT.deleteTitle,
            message: `${item.title || TEXT.item}\n${TEXT.deleteMessage}`,
            confirmText: TEXT.remove,
            danger: true,
            onConfirm: () => {
                closeDialog();
                setStatus(TEXT.deleting, { disabled: true });
                emit({ type: 'deleteLibrary', id: item.id });
            }
        });
    }

    function syncPlayer() {
        const player = state.root?.querySelector('.qvlib-player');
        const audio = player?.querySelector('audio');
        const track = player?.querySelector('.qvlib-track');
        const time = player?.querySelector('.qvlib-player-time');
        const toggle = player?.querySelector('[data-voice-action="playerToggle"]');
        if (!player || !audio || !track || !time || !toggle) {
            return;
        }
        const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
        const current = duration ? Math.min(audio.currentTime || 0, duration) : 0;
        const progress = duration ? Math.min(100, Math.max(0, current / duration * 100)) : 0;
        player.classList.toggle('is-ready', duration > 0);
        track.style.setProperty('--voice-progress', `${progress}%`);
        track.setAttribute('aria-valuenow', String(Math.round(progress)));
        track.setAttribute('aria-valuetext', duration ? `${formatPlayerTime(current)} / ${formatPlayerTime(duration)}` : '0:00');
        time.textContent = duration ? `${formatPlayerTime(current)} / ${formatPlayerTime(duration)}` : '0:00';
        toggle.dataset.playing = String(!audio.paused);
        toggle.title = audio.paused ? TEXT.play : TEXT.pause;
        toggle.setAttribute('aria-label', toggle.title);
        updateDisabledState();
    }

    function seekPlayer(event) {
        const player = state.root?.querySelector('.qvlib-player');
        const audio = player?.querySelector('audio');
        const track = player?.querySelector('.qvlib-track');
        const duration = Number.isFinite(audio?.duration) && audio.duration > 0 ? audio.duration : 0;
        const rect = track?.getBoundingClientRect?.();
        if (!audio || !track || !duration || !rect?.width) {
            return;
        }
        const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        audio.currentTime = duration * ratio;
        syncPlayer();
    }

    function createPlayer() {
        const player = createElement('div', 'qvlib-player');
        const title = createElement('div', 'qvlib-player-title', TEXT.notPlaying);
        const time = createElement('div', 'qvlib-player-time', '0:00');
        const toggle = createButton('', 'playerToggle', 'qvlib-player-toggle', TEXT.play);
        toggle.dataset.playing = 'false';
        const track = createElement('div', 'qvlib-track');
        track.setAttribute('role', 'slider');
        track.setAttribute('aria-label', TEXT.progress);
        track.setAttribute('aria-valuemin', '0');
        track.setAttribute('aria-valuemax', '100');
        track.tabIndex = 0;
        const progress = createElement('div', 'qvlib-progress');
        const thumb = createElement('div', 'qvlib-thumb');
        const audio = document.createElement('audio');
        audio.preload = 'metadata';
        track.append(progress, thumb);
        player.append(title, time, toggle, track, audio);
        for (const eventName of ['loadedmetadata', 'timeupdate', 'play', 'pause', 'ended']) {
            audio.addEventListener(eventName, syncPlayer);
        }
        track.addEventListener('pointerdown', event => {
            event.preventDefault();
            track.setPointerCapture?.(event.pointerId);
            seekPlayer(event);
        });
        track.addEventListener('pointermove', event => {
            if (event.buttons === 1) {
                seekPlayer(event);
            }
        });
        track.addEventListener('pointerup', event => {
            if (track.hasPointerCapture?.(event.pointerId)) {
                track.releasePointerCapture(event.pointerId);
            }
            syncPlayer();
        });
        track.addEventListener('keydown', event => {
            if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
                return;
            }
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                return;
            }
            event.preventDefault();
            if (event.key === 'Home') {
                audio.currentTime = 0;
            } else if (event.key === 'End') {
                audio.currentTime = audio.duration;
            } else {
                audio.currentTime = Math.min(
                    audio.duration,
                    Math.max(0, audio.currentTime + (event.key === 'ArrowRight' ? 5 : -5))
                );
            }
            syncPlayer();
        });
        return player;
    }

    function renderNavigation() {
        const nav = state.root?.querySelector('.qvlib-nav');
        if (!nav) {
            return;
        }
        nav.hidden = !state.folder;
        nav.replaceChildren();
        if (!state.folder) {
            return;
        }
        const back = createButton('\u2190', 'backFolder', 'qvlib-back', TEXT.back);
        const path = createElement('div', 'qvlib-path');
        path.append(
            createElement('div', 'qvlib-path-current', getFolderTitle(state.folder)),
            createElement('div', 'qvlib-path-parent', state.parent || TEXT.library)
        );
        nav.append(back, path);
    }

    function renderList(resetScroll = false) {
        const list = state.root?.querySelector('.qvlib-list');
        const count = state.root?.querySelector('.qvlib-count');
        if (!list) {
            return;
        }
        if (count) {
            count.textContent = `${state.items.length} ${TEXT.items}`;
        }
        renderNavigation();
        list.replaceChildren();
        if (!state.items.length) {
            list.append(createElement('div', 'qvlib-empty', state.folder ? TEXT.folderEmpty : TEXT.empty));
            return;
        }
        for (const item of state.items) {
            const row = createElement('div', 'qvlib-row');
            const main = createElement('div', 'qvlib-main');
            const name = createElement('div', 'qvlib-name', item.title || TEXT.item);
            name.title = item.title || TEXT.item;
            let metaText = '';
            if (item.kind === 'folder') {
                metaText = `${TEXT.folder} \u00b7 ${Number(item.count) || 0} ${TEXT.items}`;
            } else if (item.kind === 'media') {
                metaText = `${TEXT.pending} \u00b7 ${TEXT.duration}\uff1a${formatDuration(item.duration)}`;
            } else {
                metaText = `${TEXT.duration}\uff1a${formatDuration(item.duration)}`;
            }
            main.append(name, createElement('div', 'qvlib-meta', metaText));
            const actions = createElement('div', 'qvlib-actions');
            const specs = item.kind === 'folder'
                ? [
                    [TEXT.open, 'openFolder', ''],
                    [TEXT.rename, 'renameLibrary', '']
                ]
                : [
                    [TEXT.send, 'sendLibrary', 'qvlib-send'],
                    [TEXT.play, 'previewLibrary', ''],
                    [TEXT.rename, 'renameLibrary', ''],
                    [TEXT.remove, 'deleteLibrary', 'qvlib-delete']
                ];
            for (const [label, action, className] of specs) {
                const button = createButton(label, action, `qvlib-row-action ${className}`.trim());
                button.dataset.voiceItemId = item.id;
                actions.append(button);
            }
            row.append(main, actions);
            list.append(row);
        }
        if (resetScroll) {
            list.scrollTop = 0;
        }
        updateDisabledState();
    }

    function setLibrary(payload) {
        const previousFolder = state.folder;
        if (Array.isArray(payload)) {
            state.items = payload;
            state.folder = '';
            state.parent = '';
        } else {
            state.items = Array.isArray(payload?.items) ? payload.items : [];
            state.folder = payload?.folder || '';
            state.parent = payload?.parent || '';
        }
        renderList(previousFolder !== state.folder);
    }

    function playPreview(payload = {}) {
        const audio = state.root?.querySelector('audio');
        const title = state.root?.querySelector('.qvlib-player-title');
        if (!audio || !payload.previewUrl) {
            return;
        }
        if (title) {
            title.textContent = payload.previewTitle || TEXT.item;
        }
        audio.src = payload.previewUrl;
        audio.play?.().catch(() => {});
        syncPlayer();
    }

    function handleAction(action, itemId = '') {
        if (action === 'close') {
            close();
            return;
        }
        if (action === 'playerToggle') {
            const audio = state.root?.querySelector('audio');
            if (!audio?.src) {
                return;
            }
            if (audio.paused) {
                audio.play?.().catch(() => {});
            } else {
                audio.pause?.();
            }
            syncPlayer();
            return;
        }
        if (action === 'backFolder') {
            const folder = state.parent || '';
            setStatus(TEXT.refreshing, { disabled: true });
            emit({ type: 'list', folder });
            return;
        }
        if (action === 'list' || action === 'pick' || action === 'pickSave') {
            setStatus(action === 'list' ? TEXT.refreshing : TEXT.choose, { disabled: true });
            emit({ type: action });
            return;
        }
        const item = getItem(itemId);
        if (!item) {
            setStatus(TEXT.missing, { error: true, resetAfterMs: 1600 });
            return;
        }
        if (action === 'openFolder') {
            setStatus(TEXT.refreshing, { disabled: true });
            emit({ type: 'list', folder: item.relativePath || '' });
            return;
        }
        if (action === 'sendLibrary') {
            setStatus(item.kind === 'media' ? TEXT.converting : TEXT.sending, { disabled: true });
            emit({ type: 'sendLibrary', id: item.id });
            return;
        }
        if (action === 'previewLibrary') {
            setStatus(TEXT.loading, { disabled: true });
            emit({ type: 'previewLibrary', id: item.id });
            return;
        }
        if (action === 'renameLibrary') {
            showRenameDialog(item);
            return;
        }
        if (action === 'deleteLibrary') {
            showDeleteDialog(item);
        }
    }

    function setPosition(left, top, remember = false) {
        const shell = state.root?.querySelector('.qvlib-shell');
        if (!state.root || !shell) {
            return null;
        }
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const width = shell.offsetWidth || Math.min(360, Math.max(0, viewportWidth - 24));
        const height = shell.offsetHeight || Math.min(400, Math.max(0, viewportHeight - 24));
        const margin = 12;
        const minLeft = margin + width / 2;
        const maxLeft = Math.max(minLeft, viewportWidth - margin - width / 2);
        const minTop = margin + height / 2;
        const maxTop = Math.max(minTop, viewportHeight - margin - height / 2);
        const position = {
            left: Math.round(Math.min(maxLeft, Math.max(minLeft, Number(left) || viewportWidth / 2))),
            top: Math.round(Math.min(maxTop, Math.max(minTop, Number(top) || viewportHeight / 2)))
        };
        state.root.style.setProperty('--voice-left', `${position.left}px`);
        state.root.style.setProperty('--voice-top', `${position.top}px`);
        if (remember) {
            state.position = position;
            state.moved = true;
        }
        return position;
    }

    function updatePlacement() {
        if (!state.root) {
            return;
        }
        if (!state.host?.isConnected) {
            state.host = options.resolveHost?.() || null;
        }
        const hostRect = state.host?.getBoundingClientRect?.();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const left = state.moved && state.position
            ? state.position.left
            : (hostRect?.width > 0 ? hostRect.left + hostRect.width / 2 : viewportWidth / 2);
        const top = state.moved && state.position
            ? state.position.top
            : (hostRect?.height > 0 ? hostRect.top + hostRect.height / 2 : viewportHeight / 2);
        const position = setPosition(left, top);
        if (state.moved && position) {
            state.position = position;
        }
    }

    function installDrag(shell, header) {
        let dragState = null;
        const finish = event => {
            if (!dragState || dragState.pointerId !== event.pointerId) {
                return;
            }
            if (header.hasPointerCapture?.(event.pointerId)) {
                header.releasePointerCapture(event.pointerId);
            }
            dragState = null;
            shell.classList.remove('is-dragging');
        };
        header.addEventListener('pointerdown', event => {
            if (event.button !== 0 || event.target?.closest?.('button,input,a')) {
                return;
            }
            const rect = shell.getBoundingClientRect();
            dragState = {
                pointerId: event.pointerId,
                offsetX: event.clientX - (rect.left + rect.width / 2),
                offsetY: event.clientY - (rect.top + rect.height / 2)
            };
            header.setPointerCapture?.(event.pointerId);
            shell.classList.add('is-dragging');
            event.preventDefault();
        });
        header.addEventListener('pointermove', event => {
            if (!dragState || dragState.pointerId !== event.pointerId) {
                return;
            }
            setPosition(
                event.clientX - dragState.offsetX,
                event.clientY - dragState.offsetY,
                true
            );
        });
        header.addEventListener('pointerup', finish);
        header.addEventListener('pointercancel', finish);
    }

    function buildPanel() {
        const root = createElement('div');
        root.id = ROOT_ID;
        const shell = createElement('div', 'qvlib-shell');
        const header = createElement('div', 'qvlib-header');
        const heading = createElement('div', 'qvlib-heading');
        heading.append(
            createElement('div', 'qvlib-title', TEXT.title),
            createElement('div', 'qvlib-count', `0 ${TEXT.items}`)
        );
        const refresh = createButton('\u21bb', 'list', 'qvlib-icon-button', TEXT.refresh);
        const closeButton = createButton('\u00d7', 'close', 'qvlib-icon-button qvlib-close', TEXT.close);
        header.append(heading, refresh, closeButton);
        const nav = createElement('div', 'qvlib-nav');
        nav.hidden = true;
        const list = createElement('div', 'qvlib-list');
        const player = createPlayer();
        const footer = createElement('div', 'qvlib-footer');
        footer.append(
            createButton(TEXT.pick, 'pick'),
            createButton(TEXT.add, 'pickSave')
        );
        shell.append(header, nav, list, player, footer);
        root.append(shell);
        root.addEventListener('click', event => {
            const control = event.target?.closest?.('[data-voice-action]');
            if (!control || !root.contains(control)) {
                event.stopPropagation();
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            handleAction(control.dataset.voiceAction, control.dataset.voiceItemId || '');
        });
        for (const eventName of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'wheel', 'dragover', 'drop']) {
            root.addEventListener(eventName, event => {
                if (event.target === root) {
                    event.preventDefault();
                }
                event.stopPropagation();
            });
        }
        root.addEventListener('contextmenu', event => {
            event.preventDefault();
            event.stopPropagation();
        });
        installDrag(shell, header);
        return root;
    }

    function open() {
        ensureStyle();
        const host = options.resolveHost?.();
        if (!host) {
            return false;
        }
        close();
        state.host = host;
        state.root = buildPanel();
        document.body.append(state.root);
        updatePlacement();
        renderList(true);
        syncPlayer();
        emit({ type: 'list' });
        return true;
    }

    function close() {
        clearTimeout(state.statusTimer);
        const audio = state.root?.querySelector('audio');
        audio?.pause?.();
        state.root?.remove();
        state.root = null;
        state.host = null;
        state.busy = false;
    }

    function handleEscape() {
        if (!state.root) {
            return false;
        }
        if (state.root.querySelector('.qvlib-dialog-layer')) {
            closeDialog();
        } else {
            close();
        }
        return true;
    }

    return {
        open,
        close,
        isOpen: () => Boolean(state.root),
        contains: target => Boolean(state.root?.contains(target)),
        updatePlacement,
        setStatus,
        setLibrary,
        playPreview,
        handleEscape
    };
}

function injectedVoiceFileSenderUi(voiceLibraryPanelFactory, voiceLibraryPanelCss) {
    const VOICE_TEXTS = [
        '\u5f00\u59cb\u8bf4\u8bdd',
        '\u6309\u4f4f\u8bf4\u8bdd',
        '\u6309\u4f4f\u7a7a\u683c\u952e',
        '\u6309Esc\u952e',
        '\u70b9\u51fb\u9000\u51fa',
        '\u677e\u5f00\u53d1\u9001'
    ];
    const VOICE_SELECTORS = [
        '.audio-msg-input',
        '[class*="audio-msg-input"]',
        '[class*="record-panel"]',
        '[class*="recordPanel"]',
        '[class*="ptt-panel"]',
        '[class*="pttPanel"]'
    ];
    const MEDIA_EXTENSIONS = new Set([
        '.3g2', '.3gp', '.aac', '.amr', '.asf', '.avi', '.flac', '.flv', '.m2ts', '.m4a', '.m4v', '.mkv',
        '.mov', '.mp3', '.mp4', '.mpeg', '.mpg', '.ogg', '.ogv', '.opus', '.ts', '.wav', '.weba', '.webm', '.wmv'
    ]);
    let libraryPanel = null;

    function getBridge() {
        window.__voiceFileSenderBridge = window.__voiceFileSenderBridge || {};
        const bridge = window.__voiceFileSenderBridge;
        bridge.queue = bridge.queue || [];
        return bridge;
    }

    function isVoiceFeatureEnabled() {
        return getBridge().enabled !== false;
    }

    function isVoiceSaveInContextMenuEnabled() {
        const bridge = getBridge();
        return bridge.enabled !== false && bridge.saveInContextMenu !== false;
    }

    function getByPath(object, path) {
        return path.split('.').reduce((value, key) => value?.[key], object);
    }

    function findVueValue(element, path) {
        const instances = element?.__VUE__;
        if (!instances?.length) {
            return undefined;
        }
        for (const instance of new Set(instances)) {
            const value = getByPath(instance, path);
            if (value !== undefined) {
                return value;
            }
        }
        return undefined;
    }

    function getCurrentAioData() {
        return findVueValue(document.querySelector('.aio.vue-component'), 'proxy.commonAioStore.curAioData') ||
            findVueValue(document.querySelector('.aio'), 'proxy.commonAioStore.curAioData') ||
            getByPath(globalThis, 'app.__vue_app__.config.globalProperties.$store.state.common_Aio.curAioData');
    }

    function firstNonEmpty(values) {
        return values.find(value => value !== undefined && value !== null && String(value).trim());
    }

    function normalizePeerId(value) {
        const text = String(value ?? '').trim();
        if (!text || text === 'undefined' || text === 'null' || text === '0') {
            return '';
        }
        return text;
    }

    function pickPeerId(values) {
        return normalizePeerId(firstNonEmpty(values));
    }

    function normalizePeerFromAioData(aioData) {
        if (!aioData || typeof aioData !== 'object') {
            return null;
        }
        const header = aioData.header || {};
        const chatType = Number(firstNonEmpty([
            aioData.chatType,
            aioData.type,
            header.chatType,
            aioData.aioType,
            header.type
        ]));
        const isGroup = chatType === 2;
        const isC2c = chatType === 1 || chatType === 100;
        const peerUin = pickPeerId([
            aioData.peerUin,
            header.peerUin,
            aioData.chatUin,
            header.chatUin,
            aioData.uin,
            header.uin,
            aioData.userUin,
            header.userUin,
            aioData.contactUin,
            header.contactUin,
            aioData.targetUin,
            header.targetUin
        ]);
        const peerUid = isGroup
            ? pickPeerId([
                aioData.peerUid,
                header.peerUid,
                aioData.groupCode,
                header.groupCode,
                aioData.groupId,
                header.groupId,
                aioData.peerUin,
                header.peerUin,
                aioData.chatUin,
                header.chatUin,
                aioData.uin,
                header.uin
            ])
            : pickPeerId([
                aioData.peerUid,
                header.peerUid,
                aioData.peer?.peerUid,
                header.peer?.peerUid,
                aioData.peer?.uid,
                header.peer?.uid,
                aioData.peer?.ntUid,
                header.peer?.ntUid,
                aioData.contact?.peerUid,
                header.contact?.peerUid,
                aioData.contact?.uid,
                header.contact?.uid,
                aioData.contact?.ntUid,
                header.contact?.ntUid,
                aioData.buddy?.peerUid,
                header.buddy?.peerUid,
                aioData.buddy?.uid,
                header.buddy?.uid,
                aioData.friend?.peerUid,
                header.friend?.peerUid,
                aioData.friend?.uid,
                header.friend?.uid,
                aioData.target?.peerUid,
                header.target?.peerUid,
                aioData.target?.uid,
                header.target?.uid,
                aioData.uid,
                header.uid,
                aioData.contactUid,
                header.contactUid,
                aioData.userUid,
                header.userUid,
                aioData.targetUid,
                header.targetUid,
                aioData.friendUid,
                header.friendUid,
                aioData.peerUin,
                header.peerUin,
                aioData.chatUin,
                header.chatUin,
                aioData.uin,
                header.uin
            ]);
        if (!chatType || !peerUid || (isC2c && peerUid === 'self')) {
            return null;
        }
        return {
            chatType,
            peerUid,
            peerUin,
            guildId: String(aioData?.guildId || header.guildId || '')
        };
    }

    function getVueInstances(element) {
        if (!(element instanceof Element)) {
            return [];
        }
        const result = [];
        if (Array.isArray(element.__VUE__)) {
            result.push(...element.__VUE__);
        }
        if (element.__vueParentComponent) {
            result.push(element.__vueParentComponent);
        }
        return Array.from(new Set(result.filter(Boolean)));
    }

    function isMsgRecord(value) {
        return Boolean(value && typeof value === 'object' && (value.msgId || value.msgSeq) && Array.isArray(value.elements));
    }

    function findMsgRecordInValue(value, depth = 0, seen = new WeakSet()) {
        if (!value || depth > 4 || typeof value !== 'object') {
            return null;
        }
        if (value instanceof Element || value instanceof Uint8Array || value instanceof Map) {
            return null;
        }
        if (seen.has(value)) {
            return null;
        }
        seen.add(value);
        if (isMsgRecord(value)) {
            return value;
        }
        for (const key of ['props', 'setupState', 'ctx', 'proxy', 'msgRecord', 'message', 'record', 'msg']) {
            const found = findMsgRecordInValue(value[key], depth + 1, seen);
            if (found) {
                return found;
            }
        }
        return null;
    }

    function getMessageElementFromElement(element) {
        const vueMessage = element?.closest?.('.message.vue-component');
        if (vueMessage) {
            return vueMessage;
        }
        const item = element?.closest?.('.ml-item');
        if (item) {
            return item.querySelector?.('.message.vue-component') || item.querySelector?.('.message') || item;
        }
        const message = element?.closest?.('.message');
        return message?.closest?.('.message.vue-component') || message || null;
    }

    function findMessageRecordFromElement(element) {
        const messageElement = getMessageElementFromElement(element);
        if (!messageElement) {
            return null;
        }
        const candidates = [];
        const seen = new Set();
        const addCandidate = node => {
            if (node instanceof Element && !seen.has(node)) {
                seen.add(node);
                candidates.push(node);
            }
        };
        for (let node = element; node && node !== document.body; node = node.parentElement) {
            addCandidate(node);
            if (node === messageElement) {
                break;
            }
        }
        addCandidate(messageElement);
        for (const child of Array.from(messageElement.querySelectorAll?.('*') || []).slice(0, 80)) {
            addCandidate(child);
        }
        for (const candidate of candidates) {
            for (const instance of getVueInstances(candidate)) {
                const direct = instance?.props?.msgRecord ||
                    instance?.ctx?.msgRecord ||
                    instance?.proxy?.msgRecord ||
                    instance?.props?.message ||
                    instance?.ctx?.message ||
                    instance?.proxy?.message;
                if (isMsgRecord(direct)) {
                    return direct;
                }
                const found = findMsgRecordInValue(instance);
                if (found) {
                    return found;
                }
            }
        }
        return null;
    }

    function findMessageRecordFromContextEvent(event) {
        for (const item of event?.composedPath?.() || []) {
            if (!(item instanceof Element)) {
                continue;
            }
            const record = findMessageRecordFromElement(item);
            if (record) {
                return record;
            }
        }
        return findMessageRecordFromElement(event?.target);
    }

    function getCurrentPeerFromAioComponents() {
        const roots = Array.from(document.querySelectorAll('.aio.vue-component, .aio')).slice(0, 4);
        for (const root of roots) {
            for (const instance of getVueInstances(root)) {
                for (const source of [
                    instance.props,
                    instance.proxy,
                    instance.ctx,
                    instance.setupState,
                    instance.proxy?.commonAioStore?.curAioData,
                    instance.ctx?.commonAioStore?.curAioData,
                    instance.proxy?.aioStore?.curAioData,
                    instance.ctx?.aioStore?.curAioData
                ]) {
                    const peer = normalizePeerFromAioData(source);
                    if (peer) {
                        return peer;
                    }
                }
            }
        }
        return null;
    }

    function getCurrentPeer() {
        return normalizePeerFromAioData(getCurrentAioData()) || getCurrentPeerFromAioComponents();
    }

    function compactText(element) {
        return String(element?.innerText || element?.textContent || '').replace(/\s+/g, '');
    }

    function isVoicePanelOpen() {
        const text = compactText(document.body);
        return VOICE_TEXTS.some(item => text.includes(item.replace(/\s+/g, '')));
    }

    function isVisible(element) {
        const rect = element?.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) {
            return false;
        }
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
    }

    function hasVoicePanelText(element) {
        const text = compactText(element);
        return VOICE_TEXTS.some(item => text.includes(item.replace(/\s+/g, '')));
    }

    function findVoicePanelFrom(element) {
        if (!isVoicePanelOpen()) {
            return null;
        }
        let current = element;
        for (let depth = 0; current && current !== document.documentElement && depth < 12; depth += 1) {
            if (VOICE_SELECTORS.some(selector => current.matches?.(selector)) && isVisible(current) && hasVoicePanelText(current)) {
                return current;
            }
            const rect = current.getBoundingClientRect?.();
            const compactEnough = rect && rect.width > 0 && rect.height > 0 && rect.width <= 1200 && rect.height <= 760;
            if (compactEnough && hasVoicePanelText(current)) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }

    function findVoicePanel() {
        if (!isVoicePanelOpen()) {
            return null;
        }
        const selectorTarget = document.querySelector('.audio-msg-input');
        if (selectorTarget && isVisible(selectorTarget) && hasVoicePanelText(selectorTarget)) {
            return selectorTarget;
        }
        const candidates = Array.from(document.querySelectorAll('div, section, main')).filter(element => {
            const rect = element.getBoundingClientRect?.();
            if (!rect || rect.width < 260 || rect.height < 90 || rect.width > 1300 || rect.height > 780) {
                return false;
            }
            return isVisible(element) && hasVoicePanelText(element);
        });
        candidates.sort((a, b) => {
            const aRect = a.getBoundingClientRect();
            const bRect = b.getBoundingClientRect();
            return (aRect.width * aRect.height) - (bRect.width * bRect.height);
        });
        return candidates[0] || null;
    }

    function getVoiceDropTarget(event) {
        const activePanel = findVoicePanel();
        if (!activePanel) {
            return null;
        }
        const targets = [];
        if (event?.target instanceof Element) {
            targets.push(event.target);
        }
        const pointTarget = document.elementFromPoint?.(event.clientX, event.clientY);
        if (pointTarget) {
            targets.push(pointTarget);
        }
        for (const target of targets) {
            const panel = findVoicePanelFrom(target);
            if (panel && (panel === activePanel || activePanel.contains(panel) || panel.contains(activePanel))) {
                return panel;
            }
        }
        return null;
    }

    function isMediaPath(filePath) {
        const name = String(filePath || '').toLowerCase();
        const index = name.lastIndexOf('.');
        return index >= 0 && MEDIA_EXTENSIONS.has(name.slice(index));
    }

    function getDropMediaPaths(dataTransfer) {
        return Array.from(dataTransfer?.files || [])
            .map(file => file.path)
            .filter(filePath => filePath && isMediaPath(filePath));
    }

    function isLikelySidebarElement(element) {
        const text = [
            element.id || '',
            String(element.className || ''),
            element.getAttribute?.('role') || '',
            element.getAttribute?.('aria-label') || ''
        ].join(' ');
        return /side|sidebar|right|member|notice|announcement|profile|detail|drawer|contact/i.test(text);
    }

    function getLibraryHostScore(element, trigger) {
        const rect = element.getBoundingClientRect?.();
        if (!rect || rect.width < 360 || rect.height < 260 || !isVisible(element) || isLikelySidebarElement(element)) {
            return Infinity;
        }
        const text = [
            element.id || '',
            String(element.className || ''),
            element.getAttribute?.('role') || ''
        ].join(' ');
        let score = rect.width * rect.height;
        if (/chat|aio|message|conversation|main|content|panel/i.test(text)) {
            score -= 100000;
        }
        if (/input|editor|toolbar|operation/i.test(text)) {
            score += 1000000;
        }
        if (trigger && !element.contains(trigger)) {
            score += 1000000;
        }
        return score;
    }

    function pickLibraryHost(candidates, trigger = null) {
        return candidates
            .filter(Boolean)
            .map(element => ({
                element,
                score: getLibraryHostScore(element, trigger)
            }))
            .filter(item => Number.isFinite(item.score))
            .sort((a, b) => a.score - b.score)[0]?.element || null;
    }

    function findLibraryHostFromTrigger(trigger) {
        if (!(trigger instanceof Element)) {
            return null;
        }
        const candidates = [];
        let current = trigger;
        for (let depth = 0; current && current !== document.documentElement && depth < 18; depth += 1) {
            candidates.push(current);
            current = current.parentElement;
        }
        return pickLibraryHost(candidates, trigger);
    }

    function findLibraryHost() {
        const bridge = getBridge();
        const triggerHost = findLibraryHostFromTrigger(bridge.lastLibraryTrigger);
        if (triggerHost) {
            return triggerHost;
        }
        const selectors = [
            '.group-chat',
            '.c2c-chat',
            '[class*="chat-main"]',
            '[class*="chat-content"]',
            '[class*="message-panel"]',
            '[class*="message-list"]',
            '.chat-panel',
            '.message-panel',
            '.aio.vue-component',
            '.aio'
        ];
        const candidates = selectors.flatMap(selector => Array.from(document.querySelectorAll(selector)));
        return pickLibraryHost(candidates);
    }

    function openLibraryPanel() {
        return libraryPanel?.open();
    }

    function closeLibraryPanel() {
        libraryPanel?.close();
    }

    function updateLibraryPanelPlacement() {
        libraryPanel?.updatePlacement();
    }

    function blockDocumentWhileLibraryOpen(event) {
        if (!libraryPanel?.isOpen()) {
            return;
        }
        if (event.type === 'keydown' && event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            libraryPanel.handleEscape();
            return;
        }
        if (libraryPanel.contains(event.target)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
    }
    function isInputOrToolbarElement(element) {
        return Boolean(element?.closest?.('input,textarea,[contenteditable="true"],[class*="input"],[class*="editor"],[class*="toolbar"],[class*="operation"]'));
    }

    function isInsideNativeContextMenu(element) {
        return Boolean(element?.closest?.('.q-context-menu,[class*="context-menu"],[role="menu"]'));
    }

    function isLikelyMessageContentElement(element) {
        if (!(element instanceof Element) || isInputOrToolbarElement(element) || isInsideNativeContextMenu(element)) {
            return false;
        }
        let current = element;
        for (let depth = 0; current && current !== document.documentElement && depth < 12; depth += 1) {
            if (isInputOrToolbarElement(current) || isInsideNativeContextMenu(current)) {
                return false;
            }
            const className = String(current.className || '');
            const isMessageShell = /(messageitem|msgitem)|(^|\b)(message|msg)(\b|[-_])/i.test(className);
            const isMessagePayload = /bubble|normal-file|file-message|ptt|voice|audio/i.test(className);
            const isLayoutOnly = /input|editor|toolbar|operation|tool|bar|panel|root|list|icon|button|emoji|face/i.test(className);
            if ((isMessageShell || isMessagePayload) && !isLayoutOnly) {
                return true;
            }
            current = current.parentElement;
        }
        return false;
    }

    function isMessageContentEvent(event) {
        return (event.composedPath?.() || []).some(item => item instanceof Element && isLikelyMessageContentElement(item));
    }

    function stringifyIntentValue(value, depth = 0) {
        if (value === undefined || value === null || depth > 2) {
            return '';
        }
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        if (Array.isArray(value)) {
            return value.slice(0, 8).map(item => stringifyIntentValue(item, depth + 1)).join(' ');
        }
        if (typeof value !== 'object') {
            return '';
        }
        return [
            value.name,
            value.title,
            value.text,
            value.label,
            value.content,
            value.tooltip,
            value.tooltipText,
            value.tooltipParams,
            value.icon,
            value.iconName,
            value.svgName,
            value.svgUrl
        ].map(item => stringifyIntentValue(item, depth + 1)).join(' ');
    }

    function getVueIntentText(element) {
        const hints = [];
        for (const instance of getVueInstances(element)) {
            const type = instance.type || instance.$options || instance.proxy?.$options || {};
            hints.push(type.name, type.__name);
            for (const source of [instance.props, instance.setupState, instance.ctx, instance.proxy]) {
                if (!source || typeof source !== 'object') {
                    continue;
                }
                for (const key of [
                    'name',
                    'title',
                    'text',
                    'label',
                    'content',
                    'tooltip',
                    'tooltipText',
                    'tooltipParams',
                    'icon',
                    'iconName',
                    'svgName',
                    'svgUrl'
                ]) {
                    hints.push(stringifyIntentValue(source[key]));
                }
            }
        }
        return hints.filter(Boolean).join(' ');
    }

    function getElementIntentText(element, includeVisibleText = true) {
        if (!(element instanceof Element)) {
            return '';
        }
        const compactTarget = element.getBoundingClientRect?.();
        const shouldInspectIconChildren = compactTarget &&
            compactTarget.width > 0 &&
            compactTarget.height > 0 &&
            compactTarget.width <= 160 &&
            compactTarget.height <= 120;
        const iconHints = shouldInspectIconChildren
            ? Array.from(element.querySelectorAll?.('svg,use,img,i,[class*="icon"]') || [])
                .slice(0, 8)
                .flatMap(item => [
                    item.id || '',
                    item.getAttribute?.('href') || '',
                    item.getAttribute?.('xlink:href') || '',
                    item.getAttribute?.('name') || '',
                    item.getAttribute?.('data-name') || '',
                    item.getAttribute?.('data-icon') || '',
                    item.getAttribute?.('src') || '',
                    String(item.className || '')
                ])
            : [];
        const style = shouldInspectIconChildren ? getComputedStyle(element) : null;
        return [
            element.id || '',
            element.getAttribute?.('name') || '',
            element.getAttribute?.('href') || '',
            element.getAttribute?.('xlink:href') || '',
            includeVisibleText ? compactText(element).slice(0, 80) : '',
            element.getAttribute?.('aria-label') || '',
            element.getAttribute?.('title') || '',
            element.getAttribute?.('data-title') || '',
            element.getAttribute?.('data-tooltip') || '',
            element.getAttribute?.('data-name') || '',
            element.getAttribute?.('data-icon') || '',
            style?.maskImage || '',
            style?.webkitMaskImage || '',
            style?.backgroundImage || '',
            String(element.className || ''),
            getVueIntentText(element),
            ...iconHints
        ].join(' ');
    }

    function looksLikeVoiceLibraryTrigger(element) {
        if (!(element instanceof Element) || isInsideNativeContextMenu(element) || isLikelyMessageContentElement(element)) {
            return false;
        }
        const rect = element.getBoundingClientRect?.();
        const compactTarget = Boolean(rect && rect.width > 0 && rect.height > 0 && rect.width <= 120 && rect.height <= 80);
        const toolbarTarget = isInputOrToolbarElement(element) || Boolean(element.closest?.('button,[role="button"],[class*="toolbar"],[class*="operation"],[class*="tool"],[class*="icon"],[class*="record"]'));
        if (!compactTarget && !toolbarTarget) {
            return false;
        }
        const text = getElementIntentText(element, compactTarget);
        return /\u8bed\u97f3\u6d88\u606f|\u8bed\u97f3|voice|audio|ptt|microphone|micro-phone|\bmic\b|record/i.test(text);
    }

    function eventTargetLooksLikeToolIcon(element) {
        const tagName = String(element?.tagName || '').toLowerCase();
        const role = element?.getAttribute?.('role') || '';
        return tagName === 'button' ||
            role === 'button' ||
            Boolean(element?.closest?.('button,[role="button"],[class*="toolbar"],[class*="operation"],[class*="icon"]'));
    }

    function isSmallToolbarEvent(event) {
        if (isMessageContentEvent(event)) {
            return false;
        }
        return (event.composedPath?.() || [])
            .filter(item => item instanceof Element)
            .slice(0, 10)
            .some(element => {
                const rect = element.getBoundingClientRect?.();
                if (!rect || rect.width <= 0 || rect.height <= 0 || rect.width > 96 || rect.height > 96) {
                    return false;
                }
                return eventTargetLooksLikeToolIcon(element) ||
                    Boolean(element.closest?.('[class*="bar"],[class*="toolbar"],[class*="operation"],[class*="input"],[class*="editor"]'));
            });
    }

    function hasVoiceTooltipNearPoint(point) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
            return false;
        }
        const tooltipSelectors = [
            '[role="tooltip"]',
            '[class*="tooltip"]',
            '[class*="tool-tip"]',
            '[class*="popper"]',
            '[class*="popover"]',
            '[class*="tip"]',
            'div',
            'span'
        ];
        const seen = new Set();
        const candidates = [];
        for (const selector of tooltipSelectors) {
            for (const element of Array.from(document.querySelectorAll(selector))) {
                if (seen.has(element) || !isVisible(element)) {
                    continue;
                }
                seen.add(element);
                const text = compactText(element);
                if (text !== '\u8bed\u97f3\u6d88\u606f' && text !== '\u8bed\u97f3') {
                    continue;
                }
                const rect = element.getBoundingClientRect?.();
                if (!rect || rect.width <= 0 || rect.height <= 0 || rect.width > 180 || rect.height > 96) {
                    continue;
                }
                const distance = distanceToRect(point, rect);
                if (distance <= 180) {
                    candidates.push({ element, rect, distance });
                }
            }
        }
        return candidates
            .sort((a, b) => a.distance - b.distance || (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height))
            .length > 0;
    }

    function findVoiceLibraryTriggerFromEvent(event) {
        if (isInsideNativeContextMenu(event.target)) {
            return null;
        }
        const path = (event.composedPath?.() || [])
            .filter(item => item instanceof Element)
            .slice(0, 12);
        for (const item of path) {
            if (looksLikeVoiceLibraryTrigger(item)) {
                return item;
            }
            const clickable = item.closest?.('button,[role="button"],[class*="toolbar"],[class*="operation"],[class*="tool"],[class*="icon"]');
            if (looksLikeVoiceLibraryTrigger(clickable)) {
                return clickable;
            }
        }
        if (isMessageContentEvent(event)) {
            return null;
        }
        const point = { x: event.clientX, y: event.clientY };
        if (isSmallToolbarEvent(event) && hasVoiceTooltipNearPoint(point)) {
            return event.target instanceof Element ? event.target : path[0] || null;
        }
        return null;
    }

    function openLibraryPanelDebounced() {
        if (!isVoiceFeatureEnabled()) {
            closeLibraryPanel();
            return;
        }
        const bridge = getBridge();
        const now = Date.now();
        if (bridge.lastLibraryOpenAt && now - bridge.lastLibraryOpenAt < 350) {
            return;
        }
        bridge.lastLibraryOpenAt = now;
        openLibraryPanel();
    }

    function flushActionQueue() {
        const bridge = getBridge();
        if (!bridge.resolve || bridge.queue.length === 0) {
            return;
        }
        const resolve = bridge.resolve;
        bridge.resolve = null;
        resolve(bridge.queue.shift());
    }

    function enqueueAction(action) {
        const bridge = getBridge();
        bridge.queue.push(action);
        flushActionQueue();
    }

    const panelBridge = getBridge();
    libraryPanel = panelBridge.panelController || voiceLibraryPanelFactory({
        cssText: voiceLibraryPanelCss,
        resolveHost: findLibraryHost,
        onAction: action => {
            const nextAction = { ...action };
            if (action.type === 'pick' || action.type === 'sendLibrary') {
                nextAction.peer = getCurrentPeer();
            }
            enqueueAction(nextAction);
        }
    });
    panelBridge.panelController = libraryPanel;

    const PTT_PATH_KEYS = new Set([
        'filepath', 'sourcepath', 'path', 'localpath', 'originpath', 'originfilepath', 'srcpath',
        'downloadpath', 'realpath', 'absolutepath', 'audiopath', 'voicepath', 'pttpath',
        'url', 'audiourl', 'voiceurl', 'ptturl'
    ]);
    const PTT_NAME_KEYS = new Set(['filename', 'name', 'originfilename', 'originalname', 'audioname', 'voicename', 'pttfilename']);
    const PTT_MD5_KEYS = new Set(['md5hexstr', 'md5', 'filemd5', 'md5str', 'filemd5hex', 'originmd5', 'originalmd5']);
    const PTT_DURATION_KEYS = new Set(['duration', 'voiceduration', 'durationseconds', 'seconds', 'second', 'time', 'playtime']);
    const PTT_DURATION_MS_KEYS = new Set(['durationms', 'durationmilliseconds', 'timems', 'playtimems']);
    const PTT_ID_KEYS = new Set(['fileuuid', 'filesubid', 'uuid', 'fileid', 'storeid', 'resid', 'resourceid']);

    function normalizeFieldText(value) {
        const text = String(value ?? '').trim();
        return text && text !== 'undefined' && text !== 'null' && text !== '0' ? text : '';
    }

    function normalizeFieldKey(key) {
        return String(key || '').replace(/[_\-\s]/g, '').toLowerCase();
    }

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
        if (typeof value !== 'object' || value instanceof Element || value instanceof Uint8Array || value instanceof Map) {
            return results;
        }
        if (seen.has(value)) {
            return results;
        }
        seen.add(value);
        for (const [key, item] of Object.entries(value)) {
            if (!keySet.has(normalizeFieldKey(key)) || item === undefined || item === null || typeof item === 'object') {
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
            const msDuration = normalizeDurationSeconds(firstFieldValue([root], PTT_DURATION_MS_KEYS), true);
            if (msDuration) {
                return msDuration;
            }
            const duration = normalizeDurationSeconds(firstFieldValue([root], PTT_DURATION_KEYS));
            if (duration) {
                return duration;
            }
        }
        return 0;
    }

    function sanitizePttElement(pttElement) {
        if (!pttElement || typeof pttElement !== 'object') {
            return null;
        }
        const nested = pttElement.pttElement || pttElement;
        const roots = [nested, pttElement].filter(Boolean);
        const paths = [];
        const names = [];
        const ids = [];
        for (const root of roots) {
            collectFieldValues(root, PTT_PATH_KEYS, paths);
            collectFieldValues(root, PTT_NAME_KEYS, names);
            collectFieldValues(root, PTT_ID_KEYS, ids);
        }
        const ptt = {
            filePath: paths[0] || '',
            sourcePath: paths[1] || '',
            fileName: names[0] || '',
            md5HexStr: firstFieldValue(roots, PTT_MD5_KEYS),
            duration: firstDurationSeconds(roots),
            fileUuid: ids[0] || '',
            fileSubId: ids[1] || '',
            fileId: ids[2] || '',
            paths,
            names,
            ids
        };
        return ptt.filePath || ptt.fileName || ptt.md5HexStr || ptt.fileUuid || ptt.fileSubId || ptt.fileId ? ptt : null;
    }

    function getPttIdentity(ptt) {
        return ptt?.filePath ||
            ptt?.md5HexStr ||
            ptt?.fileName ||
            ptt?.fileUuid ||
            ptt?.fileSubId ||
            ptt?.fileId ||
            '';
    }

    function dedupePtts(items) {
        const result = [];
        const seen = new Set();
        for (const item of items || []) {
            const ptt = sanitizePttElement(item);
            const key = getPttIdentity(ptt);
            if (!key || seen.has(key)) {
                continue;
            }
            seen.add(key);
            result.push(ptt);
        }
        return result;
    }

    function collectPttElementsFromValue(value, results = [], depth = 0, seen = new WeakSet()) {
        if (!value || depth > 5 || results.length > 16) {
            return results;
        }
        if (Array.isArray(value)) {
            for (const item of value.slice(0, 32)) {
                collectPttElementsFromValue(item, results, depth + 1, seen);
            }
            return results;
        }
        if (typeof value !== 'object' || value instanceof Element || value instanceof Uint8Array || value instanceof Map) {
            return results;
        }
        if (seen.has(value)) {
            return results;
        }
        seen.add(value);
        if (Number(value.elementType) === 4 || value.pttElement) {
            const ptt = sanitizePttElement(value);
            if (ptt) {
                results.push(ptt);
            }
        }
        const priorityKeys = [
            'pttElement',
            'msgElements',
            'elements',
            'element',
            'msgElement',
            'records',
            'msgList',
            'payload',
            'message',
            'msg',
            'msgRecord',
            'item',
            'data',
            'result'
        ];
        for (const key of priorityKeys) {
            collectPttElementsFromValue(value[key], results, depth + 1, seen);
        }
        for (const [key, item] of Object.entries(value)) {
            if (priorityKeys.includes(key)) {
                continue;
            }
            collectPttElementsFromValue(item, results, depth + 1, seen);
        }
        return results;
    }

    function collectVuePttsFromElement(element, ptts) {
        if (!(element instanceof Element)) {
            return;
        }
        for (const instance of getVueInstances(element)) {
            for (const source of [instance.props, instance.setupState, instance.ctx, instance.proxy]) {
                collectPttElementsFromValue(source, ptts);
            }
        }
    }

    function collectPttsFromContextEvent(event) {
        const record = findMessageRecordFromContextEvent(event);
        if (record) {
            const recordPtts = [];
            collectPttElementsFromValue(record.elements, recordPtts);
            if (recordPtts.length) {
                return dedupePtts(recordPtts);
            }
        }
        const ptts = [];
        const candidates = [];
        const seen = new Set();
        const addCandidate = element => {
            if (!(element instanceof Element) || seen.has(element)) {
                return;
            }
            seen.add(element);
            candidates.push(element);
        };
        for (const element of (event.composedPath?.() || []).filter(item => item instanceof Element).slice(0, 28)) {
            addCandidate(element);
            addCandidate(element.closest?.('.message.vue-component'));
            addCandidate(element.closest?.('.message'));
            addCandidate(element.closest?.('.ml-item'));
        }
        for (const messageElement of candidates.filter(element => element.matches?.('.message,.ml-item')).slice(0, 1)) {
            for (const element of Array.from(messageElement.querySelectorAll?.('*') || []).slice(0, 100)) {
                addCandidate(element);
            }
        }
        for (const element of candidates) {
            collectVuePttsFromElement(element, ptts);
        }
        return dedupePtts(ptts);
    }

    function distanceToRect(point, rect) {
        const dx = point.x < rect.left ? rect.left - point.x : point.x > rect.right ? point.x - rect.right : 0;
        const dy = point.y < rect.top ? rect.top - point.y : point.y > rect.bottom ? point.y - rect.bottom : 0;
        return Math.hypot(dx, dy);
    }

    function getNativeMenuItemElements(menu) {
        const selectors = ['.q-context-menu-item', '[class*="context-menu-item"]', '[role="menuitem"]', 'li', 'button'];
        const candidates = [];
        for (const selector of selectors) {
            candidates.push(...Array.from(menu.querySelectorAll(selector)));
        }
        const seen = new Set();
        return candidates
            .filter(item => {
                if (!item || seen.has(item) || item.classList?.contains('qqnt-toolbox-voice-save-item')) {
                    return false;
                }
                seen.add(item);
                return !candidates.some(parent => parent !== item && parent.contains?.(item));
            })
            .slice(0, 24);
    }

    function findNativeContextMenuNear(point) {
        const menus = Array.from(document.querySelectorAll('.q-context-menu, [class*="context-menu"]'))
            .filter(menu => {
                if (!isVisible(menu)) {
                    return false;
                }
                const rect = menu.getBoundingClientRect?.();
                return rect && rect.width >= 40 && rect.height >= 24 && getNativeMenuItemElements(menu).length > 0;
            });
        return menus
            .map(menu => {
                const rect = menu.getBoundingClientRect();
                return { menu, rect, distance: distanceToRect(point, rect) };
            })
            .filter(item => item.distance <= 220 || (
                point.x >= item.rect.left - 48 &&
                point.x <= item.rect.right + 48 &&
                point.y >= item.rect.top - 48 &&
                point.y <= item.rect.bottom + 48
            ))
            .sort((a, b) => a.distance - b.distance || (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height))[0]?.menu || null;
    }

    function menuLooksLikeVoiceContextMenu(menu) {
        const text = compactText(menu);
        return /\u8f6c\u6587\u5b57|\u8bed\u97f3|voice|audio|ptt/i.test(text);
    }

    function menuLooksLikeFileContextMenu(menu) {
        const text = compactText(menu);
        return /\u53e6\u5b58\u4e3a|\u6253\u5f00\u6587\u4ef6\u5939|openfolder|saveas/i.test(text) && !menuLooksLikeVoiceContextMenu(menu);
    }

    function setNativeMenuItemLabel(item, label) {
        const text = item.querySelector?.('.q-context-menu-item__text,[class*="context-menu-item__text"]');
        if (text) {
            text.textContent = label;
            return;
        }
        const textNode = Array.from(item.childNodes || [])
            .find(node => node.nodeType === Node.TEXT_NODE && node.nodeValue.trim());
        if (textNode) {
            textNode.nodeValue = label;
            return;
        }
        item.append(document.createTextNode(label));
    }

    function setNativeMenuItemSaveIcon(item) {
        const icon = item.querySelector?.('.q-context-menu-item__icon,[class*="context-menu-item__icon"]');
        if (!icon) {
            return;
        }
        icon.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v10"/><path d="M8 9l4 4 4-4"/><path d="M5 19h14"/></svg>';
        icon.style.display = icon.style.display || 'flex';
        icon.style.alignItems = 'center';
        icon.style.justifyContent = 'center';
        icon.style.background = 'transparent';
        icon.style.backgroundImage = 'none';
        icon.style.maskImage = 'none';
        icon.style.webkitMaskImage = 'none';
        icon.querySelector('svg')?.setAttribute('aria-hidden', 'true');
    }

    function createPttSaveMenuItem(menu, ptt) {
        const template = getNativeMenuItemElements(menu)[0];
        const item = template?.cloneNode(true) || document.createElement('div');
        item.classList?.add('qqnt-toolbox-voice-save-item');
        item.removeAttribute('id');
        item.setAttribute('role', item.getAttribute('role') || 'menuitem');
        item.setAttribute('tabindex', '-1');
        setNativeMenuItemLabel(item, '\u4fdd\u5b58');
        setNativeMenuItemSaveIcon(item);
        const stop = event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
        };
        item.addEventListener('pointerdown', stop, true);
        item.addEventListener('mousedown', stop, true);
        item.addEventListener('click', event => {
            stop(event);
            enqueueAction({ type: 'savePtt', ptt });
            menu.remove();
        }, true);
        return item;
    }

    function removePttSaveMenuItems() {
        document.querySelectorAll('.qqnt-toolbox-voice-save-item').forEach(item => item.remove());
    }

    function insertPttSaveMenu(point, ptt, menu = null, options = {}) {
        if (!isVoiceSaveInContextMenuEnabled()) {
            return false;
        }
        menu = menu || findNativeContextMenuNear(point);
        if (!menu || menu.querySelector('.qqnt-toolbox-voice-save-item')) {
            return Boolean(menu);
        }
        if (!options.allowUnhintedMenu && !menuLooksLikeVoiceContextMenu(menu)) {
            return true;
        }
        const items = getNativeMenuItemElements(menu);
        const afterItem = items.find(item => compactText(item) === '\u6536\u85cf') || items[items.length - 1];
        const saveItem = createPttSaveMenuItem(menu, ptt);
        if (afterItem?.parentElement) {
            afterItem.parentElement.insertBefore(saveItem, afterItem.nextSibling);
        } else {
            menu.append(saveItem);
        }
        return true;
    }

    function schedulePttSaveMenu(event) {
        if (!isVoiceSaveInContextMenuEnabled()) {
            return;
        }
        const point = { x: event.clientX, y: event.clientY };
        let directPtt = null;
        let scannedDirect = false;
        const run = () => {
            if (!isVoiceSaveInContextMenuEnabled()) {
                removePttSaveMenuItems();
                return true;
            }
            const menu = findNativeContextMenuNear(point);
            if (!menu) {
                return Boolean(menu);
            }
            if (menuLooksLikeFileContextMenu(menu)) {
                return true;
            }
            if (!scannedDirect) {
                scannedDirect = true;
                directPtt = collectPttsFromContextEvent(event)[0] || null;
            }
            return directPtt ? insertPttSaveMenu(point, directPtt, menu, { allowUnhintedMenu: true }) : true;
        };
        setTimeout(run, 0);
        setTimeout(run, 48);
        setTimeout(run, 140);
    }

    function install() {
        if (window.__voiceFileSenderInstalled) {
            return;
        }
        window.__voiceFileSenderInstalled = true;
        document.addEventListener('dragover', event => {
            if (!isVoiceFeatureEnabled()) {
                return;
            }
            if (!getVoiceDropTarget(event) || getDropMediaPaths(event.dataTransfer).length === 0) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'copy';
        }, true);
        document.addEventListener('drop', event => {
            if (!isVoiceFeatureEnabled()) {
                return;
            }
            const panel = getVoiceDropTarget(event);
            const paths = getDropMediaPaths(event.dataTransfer);
            if (!panel || paths.length === 0) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            enqueueAction({
                type: 'drop',
                paths,
                peer: getCurrentPeer()
            });
        }, true);
        document.addEventListener('contextmenu', event => {
            if (!isVoiceFeatureEnabled()) {
                return;
            }
            const trigger = findVoiceLibraryTriggerFromEvent(event);
            if (trigger) {
                getBridge().lastLibraryTrigger = trigger;
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                openLibraryPanelDebounced();
                return;
            }
            schedulePttSaveMenu(event);
        }, true);
        for (const eventName of ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'contextmenu', 'wheel', 'dragover', 'drop', 'keydown', 'keyup']) {
            document.addEventListener(eventName, blockDocumentWhileLibraryOpen, true);
        }
        window.addEventListener('resize', () => updateLibraryPanelPlacement(), true);
        window.addEventListener('scroll', () => updateLibraryPanelPlacement(), true);
    }

    const bridge = getBridge();
    bridge.enabled = window.__voiceFileSenderEnabled !== false;
    bridge.saveInContextMenu = window.__voiceFileSenderSaveInContextMenuEnabled !== false;
    bridge.setEnabled = enabled => {
        bridge.enabled = enabled !== false;
        if (!bridge.enabled) {
            closeLibraryPanel();
            removePttSaveMenuItems();
        }
    };
    bridge.setSaveInContextMenuEnabled = enabled => {
        bridge.saveInContextMenu = enabled !== false;
        if (!bridge.saveInContextMenu) {
            removePttSaveMenuItems();
        }
    };
    bridge.setStatus = (text, options = {}) => libraryPanel.setStatus(text, options);
    bridge.setLibrary = payload => libraryPanel.setLibrary(payload);
    bridge.playPreview = payload => libraryPanel.playPreview(payload);
    install();

    return new Promise(resolve => {
        const nextBridge = getBridge();
        nextBridge.resolve = resolve;
        flushActionQueue();
    });
}

const windowStates = new WeakMap();

function getWindowState(browserWindow) {
    let state = windowStates.get(browserWindow);
    if (!state) {
        state = {
            nativeWaiters: new Set(),
            nativeSendPatched: false,
            originalSend: null,
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

function notifyNativeWaiters(browserWindow, channel, args) {
    rememberNativePeerAliases(browserWindow, args);
    const state = getWindowState(browserWindow);
    for (const waiter of Array.from(state.nativeWaiters)) {
        if (waiter.channel !== channel) {
            continue;
        }
        const [response, result] = args;
        if (!matchesNativeResponse(waiter.waitResponse, waiter.callbackId, response, result)) {
            continue;
        }
        clearTimeout(waiter.timer);
        state.nativeWaiters.delete(waiter);
        waiter.resolve(extractNativeResult(response, result));
    }
}

function installNativeSendInterceptor(browserWindow) {
    const state = getWindowState(browserWindow);
    if (state.nativeSendPatched || browserWindow.isDestroyed()) {
        return;
    }
    const webContents = browserWindow.webContents;
    state.originalSend = webContents.send.bind(webContents);
    webContents.send = function(channel, ...args) {
        notifyNativeWaiters(browserWindow, channel, args);
        return state.originalSend(channel, ...args);
    };
    state.nativeSendPatched = true;
}

function createNativeEventWaiter(browserWindow, waitResponse, timeoutMs = 10000) {
    installNativeSendInterceptor(browserWindow);
    const webContentId = browserWindow.webContents.id;
    const responseChannel = `RM_IPCFROM_MAIN${webContentId}`;
    const state = getWindowState(browserWindow);
    let waiter;
    const promise = new Promise((resolve, reject) => {
        waiter = {
            channel: responseChannel,
            callbackId: null,
            cmdName: waitResponse?.cmdName || 'nativeEvent',
            waitResponse,
            resolve,
            reject,
            timer: setTimeout(() => {
                state.nativeWaiters.delete(waiter);
                reject(new Error(`Timed out waiting for native event: ${safeJson(waitResponse)}`));
            }, timeoutMs)
        };
        state.nativeWaiters.add(waiter);
    });
    return {
        promise,
        cancel: () => {
            if (!waiter) {
                return;
            }
            clearTimeout(waiter.timer);
            state.nativeWaiters.delete(waiter);
        }
    };
}

async function nativeInvoke(browserWindow, eventName, cmdName, payload = [], waitResponse = true, timeoutMs = 10000) {
    installNativeSendInterceptor(browserWindow);
    const webContentId = browserWindow.webContents.id;
    const callbackId = crypto.randomUUID();
    const requestChannel = `RM_IPCFROM_RENDERER${webContentId}`;
    const responseChannel = `RM_IPCFROM_MAIN${webContentId}`;
    const request = {
        peerId: webContentId,
        callbackId,
        type: 'request',
        eventName
    };
    const command = {
        cmdName,
        cmdType: 'invoke',
        payload
    };
    const listeners = ipcMain.listeners(requestChannel);
    if (listeners.length === 0) {
        throw new Error(`No QQNT native IPC listener was found for ${requestChannel}.`);
    }

    return await new Promise((resolve, reject) => {
        const state = getWindowState(browserWindow);
        let waiter;
        if (waitResponse) {
            waiter = {
                channel: responseChannel,
                callbackId,
                cmdName,
                waitResponse,
                resolve,
                reject,
                timer: setTimeout(() => {
                    state.nativeWaiters.delete(waiter);
                    reject(new Error(`Timed out waiting for native response: ${cmdName}`));
                }, timeoutMs)
            };
            state.nativeWaiters.add(waiter);
        }

        const fakeEvent = {
            sender: browserWindow.webContents,
            reply: (channel, ...args) => browserWindow.webContents.send(channel, ...args)
        };

        try {
            for (const listener of listeners) {
                listener(fakeEvent, request, command);
            }
            if (!waitResponse) {
                resolve(null);
            }
        } catch (error) {
            if (waiter) {
                clearTimeout(waiter.timer);
                state.nativeWaiters.delete(waiter);
            }
            reject(error);
        }
    });
}

async function qqNativeInvoke(browserWindow, eventName, cmdName, payload = [], waitResponse = true, timeoutMs = 10000) {
    return await nativeInvoke(browserWindow, eventName, cmdName, payload, waitResponse, timeoutMs);
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

async function createPttElement(silkPath, durationSeconds) {
    const fileInfo = await createNativePttCacheFile(silkPath);
    return {
        elementType: 4,
        elementId: '',
        pttElement: {
            fileName: fileInfo.fileName,
            filePath: fileInfo.filePath,
            md5HexStr: fileInfo.md5HexStr,
            fileSize: fileInfo.fileSize,
            duration: Math.max(1, Math.ceil(Number(durationSeconds) || 1)),
            formatType: 1,
            voiceType: 1,
            voiceChangeType: 0,
            canConvert2Text: true,
            waveAmplitudes: [0, 18, 9, 23, 16, 17, 16, 15, 44, 17, 24, 20, 14, 15, 17],
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
    if (!isSupportedMediaPath(mediaPath)) {
        throw new Error(`Unsupported audio or video file: ${mediaPath}`);
    }
    const silkResult = await encodeMediaFileToSilk(mediaPath, options);
    const silkPath = await makeTempSilkPath();
    await fs.writeFile(silkPath, silkResult.data);
    try {
        const pttElement = await createPttElement(silkPath, silkResult.duration / 1000);
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
    peer = normalizeSendPeer(browserWindow, peer);
    if (!silkPath || !fsSync.existsSync(silkPath)) {
        throw new Error(`Voice file was not found: ${silkPath}`);
    }
    if (!isSilkFile(silkPath)) {
        return await sendMediaPathAsPtt(browserWindow, peer, silkPath);
    }
    const pttElement = await createPttElement(silkPath, durationSeconds);
    const attrId = await generateMsgUniqueId(browserWindow, peer.chatType);
    const msgAttributeInfos = makeSendAttributeInfos(attrId);
    return await sendPttElement(browserWindow, peer, pttElement, msgAttributeInfos, attrId);
}

async function waitForInjectedAction(browserWindow) {
    const source = `window.__voiceFileSenderEnabled = ${JSON.stringify(voiceFeatureEnabled)};` +
        `window.__voiceFileSenderSaveInContextMenuEnabled = ${JSON.stringify(voiceSaveInContextMenuEnabled)};` +
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
        allowSilk: item.kind === 'ptt',
        durationMs: Number(item.duration) > 0 ? Number(item.duration) * 1000 : undefined
    });
}

async function sendPttInfoAsPtt(browserWindow, peer, ptt) {
    const sourcePath = resolvePttSourcePath(ptt);
    if (!sourcePath) {
        throw new Error('The voice file was not found in QQNT cache. Play it once, then try again.');
    }
    return await sendMediaPathAsPtt(browserWindow, peer, sourcePath, {
        allowSilk: true,
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
    installNativeSendInterceptor(browserWindow);
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

function setEnabled(enabled) {
    voiceFeatureEnabled = enabled !== false;
    for (const browserWindow of BrowserWindow.getAllWindows()) {
        setInjectedEnabled(browserWindow, voiceFeatureEnabled);
    }
    if (voiceFeatureEnabled) {
        setTimeout(setupAllWindows, 300);
    }
}

function setSaveInContextMenuEnabled(enabled) {
    voiceSaveInContextMenuEnabled = enabled !== false;
    for (const browserWindow of BrowserWindow.getAllWindows()) {
        setInjectedSaveInContextMenuEnabled(browserWindow, voiceSaveInContextMenuEnabled);
    }
}

module.exports = {
    onBrowserWindowCreated,
    setEnabled,
    setSaveInContextMenuEnabled,
    createPttPreviewItem,
    sendPttInfoAsPtt,
    sanitizePttInfo,
    runTool
};
