'use strict';

// Telegram sticker download behavior is adapted from xiyuesaves/lite-tools (AGPL-3.0-only).

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const { isPathInside } = require('./local-stickers');

const MAX_STICKERS_PER_PACK = 300;
const MAX_STICKER_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_CONCURRENT_DOWNLOADS = 6;
const REQUEST_TIMEOUT_MS = 30000;
const CONVERSION_TIMEOUT_MS = 90000;

class LocalStickerDownloadError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'LocalStickerDownloadError';
        this.code = code;
    }
}

function parseTelegramStickerSetUrl(value) {
    try {
        const url = new URL(String(value || '').trim());
        const hostname = url.hostname.toLowerCase();
        const segments = url.pathname.split('/').filter(Boolean);
        if (url.protocol !== 'https:' ||
            !['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'].includes(hostname) ||
            segments.length !== 2 ||
            segments[0].toLowerCase() !== 'addstickers' ||
            !/^[a-z0-9_]{1,64}$/i.test(segments[1])) {
            return null;
        }
        return {
            name: segments[1],
            url: `https://t.me/addstickers/${segments[1]}`
        };
    } catch {
        return null;
    }
}

function normalizeTelegramBotToken(value) {
    const token = String(value || '').trim();
    return /^\d{5,16}:[a-z0-9_-]{20,}$/i.test(token) && token.length <= 256
        ? token
        : '';
}

function normalizeHttpProxyUrl(value) {
    const input = String(value || '').trim();
    if (!input) {
        return '';
    }
    try {
        const url = new URL(input);
        if (url.protocol !== 'http:' || !url.hostname || url.username || url.password ||
            (url.pathname && url.pathname !== '/') || url.search || url.hash) {
            return '';
        }
        const port = url.port || '80';
        const hostname = url.hostname.includes(':') && !url.hostname.startsWith('[')
            ? `[${url.hostname}]`
            : url.hostname;
        return `http://${hostname}:${port}`;
    } catch {
        return '';
    }
}

function getEnvironmentHttpProxy(environment = process.env) {
    const source = environment && typeof environment === 'object' ? environment : {};
    for (const name of [
        'HTTPS_PROXY', 'https_proxy',
        'HTTP_PROXY', 'http_proxy',
        'ALL_PROXY', 'all_proxy'
    ]) {
        const url = normalizeHttpProxyUrl(source[name]);
        if (url) {
            return { url, source: name };
        }
    }
    return { url: '', source: '' };
}

function getPathEnvironment(environment) {
    const source = environment && typeof environment === 'object' ? environment : {};
    return String(source.PATH || source.Path || source.path || '');
}

function getExecutableExtensions(platform, environment) {
    if (platform !== 'win32') {
        return [''];
    }
    const source = environment && typeof environment === 'object' ? environment : {};
    const extensions = String(source.PATHEXT || '.COM;.EXE;.BAT;.CMD')
        .split(';')
        .map(value => value.trim().toLowerCase())
        .filter(Boolean);
    return Array.from(new Set(extensions.length ? extensions : ['.exe']));
}

async function findExecutableOnPath(commands, options = {}) {
    const platform = String(options.platform || process.platform);
    const environment = options.environment || process.env;
    const directories = getPathEnvironment(environment)
        .split(path.delimiter)
        .map(value => value.trim().replace(/^"|"$/g, ''))
        .filter(Boolean);
    const extensions = getExecutableExtensions(platform, environment);
    for (const rawCommand of Array.isArray(commands) ? commands : [commands]) {
        const command = String(rawCommand || '').trim();
        if (!command) {
            continue;
        }
        const hasPath = path.isAbsolute(command) || /[\\/]/.test(command);
        const roots = hasPath ? [''] : directories;
        const commandExtension = path.extname(command).toLowerCase();
        const suffixes = platform === 'win32' && !extensions.includes(commandExtension)
            ? extensions
            : [''];
        for (const directory of roots) {
            for (const suffix of suffixes) {
                const candidate = hasPath ? `${command}${suffix}` : path.join(directory, `${command}${suffix}`);
                try {
                    const stat = await fs.stat(candidate);
                    if (stat.isFile()) {
                        return await fs.realpath(candidate);
                    }
                } catch {
                }
            }
        }
    }
    return '';
}

function sanitizeFilePart(value, fallback = 'sticker') {
    const result = String(value || '')
        .normalize('NFKC')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
        .replace(/[. ]+$/g, '')
        .trim()
        .slice(0, 80);
    return result && !['.', '..'].includes(result) ? result : fallback;
}

async function readLimitedResponseBuffer(response, maximumBytes) {
    const contentLength = Number(response?.headers?.get?.('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
        throw new LocalStickerDownloadError('response-too-large', 'Telegram 返回的数据超过大小限制');
    }
    if (!response?.body?.getReader) {
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > maximumBytes) {
            throw new LocalStickerDownloadError('response-too-large', 'Telegram 返回的数据超过大小限制');
        }
        return buffer;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        const chunk = Buffer.from(value);
        size += chunk.length;
        if (size > maximumBytes) {
            await reader.cancel().catch(() => {});
            throw new LocalStickerDownloadError('response-too-large', 'Telegram 返回的数据超过大小限制');
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
}

async function fetchWithTimeout(fetchFn, url, maximumBytes, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchFn(url, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal
        });
        if (!response?.ok) {
            throw new LocalStickerDownloadError('telegram-http-error', `Telegram 请求失败 (${response?.status || 0})`);
        }
        return await readLimitedResponseBuffer(response, maximumBytes);
    } catch (error) {
        if (error instanceof LocalStickerDownloadError) {
            throw error;
        }
        if (error?.name === 'AbortError') {
            throw new LocalStickerDownloadError('telegram-timeout', '连接 Telegram 超时');
        }
        throw new LocalStickerDownloadError('telegram-network-error', '无法连接 Telegram，请检查网络或代理');
    } finally {
        clearTimeout(timer);
    }
}

async function callTelegramApi(fetchFn, token, method, parameters) {
    const url = new URL(`https://api.telegram.org/bot${token}/${method}`);
    for (const [key, value] of Object.entries(parameters || {})) {
        url.searchParams.set(key, String(value));
    }
    const buffer = await fetchWithTimeout(fetchFn, url, MAX_JSON_BYTES);
    let payload;
    try {
        payload = JSON.parse(buffer.toString('utf8'));
    } catch {
        throw new LocalStickerDownloadError('telegram-invalid-response', 'Telegram 返回了无效数据');
    }
    if (payload?.ok !== true) {
        const description = String(payload?.description || 'Telegram API 请求失败').slice(0, 200);
        throw new LocalStickerDownloadError('telegram-api-error', description);
    }
    return payload.result;
}

async function downloadTelegramFile(fetchFn, token, filePath) {
    const normalizedPath = String(filePath || '').replace(/^\/+/, '');
    if (!normalizedPath || !/^[a-z0-9_./-]+$/i.test(normalizedPath)) {
        throw new LocalStickerDownloadError('telegram-invalid-file', 'Telegram 返回了无效文件路径');
    }
    return await fetchWithTimeout(
        fetchFn,
        `https://api.telegram.org/file/bot${token}/${normalizedPath}`,
        MAX_STICKER_BYTES
    );
}

async function inspectLocalStickerTool(configuredPath, commands, label, options = {}) {
    const configured = String(configuredPath || '').trim();
    if (configured) {
        try {
            const realPath = await fs.realpath(path.resolve(configured));
            const stat = await fs.stat(realPath);
            if (stat.isFile()) {
                return { available: true, path: realPath, source: 'configured', label };
            }
        } catch {
        }
        return { available: false, path: '', source: 'configured', label, reason: 'path-invalid' };
    }
    const executablePath = await findExecutableOnPath(commands, options);
    return executablePath
        ? { available: true, path: executablePath, source: 'path', label }
        : { available: false, path: '', source: 'path', label, reason: 'not-found' };
}

async function inspectLocalStickerTools(options = {}) {
    const lookupOptions = {
        environment: options.environment || process.env,
        platform: options.platform || process.platform
    };
    const [ffmpeg, tgsToGif] = await Promise.all([
        inspectLocalStickerTool(options.ffmpegPath, ['ffmpeg'], 'FFmpeg', lookupOptions),
        inspectLocalStickerTool(options.tgsToGifPath, ['tgs_to_gif', 'tgsToGif'], 'tgsToGif', lookupOptions)
    ]);
    return { ffmpeg, tgsToGif };
}

function runProcessWithInput(command, args, input, timeoutMs = CONVERSION_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let stderr = '';
        const child = spawn(command, args, {
            windowsHide: true,
            stdio: ['pipe', 'ignore', 'pipe']
        });
        const finish = (error = null) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            error ? reject(error) : resolve();
        };
        const timer = setTimeout(() => {
            child.kill();
            finish(new LocalStickerDownloadError('conversion-timeout', '贴纸转换超时'));
        }, timeoutMs);
        child.stderr?.on('data', chunk => {
            if (stderr.length < 32768) {
                stderr += String(chunk).slice(0, 32768 - stderr.length);
            }
        });
        child.once('error', () => {
            finish(new LocalStickerDownloadError('converter-unavailable', '无法启动贴纸转换工具'));
        });
        child.once('close', code => {
            finish(code === 0
                ? null
                : new LocalStickerDownloadError(
                    'conversion-failed',
                    stderr.trim().split(/\r?\n/).pop()?.slice(0, 180) || '贴纸转换失败'
                ));
        });
        child.stdin?.on('error', () => {});
        child.stdin?.end(input);
    });
}

async function replaceFileAtomic(temporaryPath, targetPath) {
    try {
        await fs.rename(temporaryPath, targetPath);
    } catch {
        await fs.unlink(targetPath).catch(() => {});
        await fs.rename(temporaryPath, targetPath);
    }
}

async function writeFileAtomic(targetPath, buffer) {
    const temporaryPath = path.join(
        path.dirname(targetPath),
        `.qqnt-toolbox-download-${process.pid}-${crypto.randomUUID()}.tmp`
    );
    try {
        await fs.writeFile(temporaryPath, buffer);
        await replaceFileAtomic(temporaryPath, targetPath);
    } catch (error) {
        await fs.unlink(temporaryPath).catch(() => {});
        throw error;
    }
}

async function convertSticker(command, args, input, targetPath) {
    const extension = path.extname(targetPath);
    const temporaryPath = path.join(
        path.dirname(targetPath),
        `.qqnt-toolbox-convert-${process.pid}-${crypto.randomUUID()}${extension}`
    );
    try {
        await runProcessWithInput(command, [...args, temporaryPath], input);
        const stat = await fs.stat(temporaryPath);
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_STICKER_BYTES * 4) {
            throw new LocalStickerDownloadError('conversion-invalid-output', '贴纸转换结果无效');
        }
        await replaceFileAtomic(temporaryPath, targetPath);
    } catch (error) {
        await fs.unlink(temporaryPath).catch(() => {});
        throw error;
    }
}

async function ensureStickerPackDirectory(rootPath, packName) {
    let root;
    try {
        root = await fs.realpath(path.resolve(String(rootPath || '')));
        const stat = await fs.stat(root);
        if (!stat.isDirectory()) {
            throw new Error('not-directory');
        }
    } catch {
        throw new LocalStickerDownloadError('sticker-root-invalid', '请先选择有效的本地贴纸目录');
    }
    const candidate = path.join(root, sanitizeFilePart(packName, 'telegram-stickers'));
    await fs.mkdir(candidate, { recursive: true });
    const directory = await fs.realpath(candidate);
    if (!isPathInside(root, directory)) {
        throw new LocalStickerDownloadError('sticker-pack-path-invalid', '贴纸包目录超出本地贴纸目录');
    }
    return { root, directory };
}

async function readExistingMetadata(directory) {
    try {
        const filePath = path.join(directory, 'sticker.json');
        const stat = await fs.stat(filePath);
        if (!stat.isFile() || stat.size <= 0 || stat.size > 64 * 1024) {
            return {};
        }
        const value = JSON.parse(await fs.readFile(filePath, 'utf8'));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
        return {};
    }
}

async function downloadTelegramStickerPack(options = {}) {
    const parsedUrl = parseTelegramStickerSetUrl(options.url);
    if (!parsedUrl) {
        throw new LocalStickerDownloadError('invalid-sticker-url', '请输入有效的 Telegram 贴纸包链接');
    }
    const token = normalizeTelegramBotToken(options.botToken);
    if (!token) {
        throw new LocalStickerDownloadError('invalid-bot-token', '请填写有效的 Telegram Bot Token');
    }
    if (typeof options.fetch !== 'function') {
        throw new LocalStickerDownloadError('fetch-unavailable', '当前环境无法访问 Telegram');
    }

    const stickerSet = await callTelegramApi(options.fetch, token, 'getStickerSet', {
        name: parsedUrl.name
    });
    if (!stickerSet || stickerSet.sticker_type !== 'regular') {
        throw new LocalStickerDownloadError('unsupported-sticker-set', '仅支持普通 Telegram 贴纸包');
    }
    const stickers = Array.isArray(stickerSet.stickers)
        ? stickerSet.stickers.slice(0, MAX_STICKERS_PER_PACK)
        : [];
    if (!stickers.length) {
        throw new LocalStickerDownloadError('empty-sticker-set', '这个 Telegram 贴纸包没有可下载内容');
    }

    const { directory } = await ensureStickerPackDirectory(options.rootPath, stickerSet.name || parsedUrl.name);
    const tools = await inspectLocalStickerTools({
        ffmpegPath: options.ffmpegPath,
        tgsToGifPath: options.tgsToGifPath,
        environment: options.environment,
        platform: options.platform
    });
    const ffmpeg = tools.ffmpeg.available ? tools.ffmpeg.path : '';
    const tgsToGif = tools.tgsToGif.available ? tools.tgsToGif.path : '';
    const results = new Array(stickers.length);
    let cursor = 0;
    let totalBytes = 0;

    const downloadOne = async (sticker, index) => {
        if (sticker?.is_video && !ffmpeg) {
            return { status: 'skipped', reason: 'ffmpeg-not-configured' };
        }
        if (sticker?.is_animated && !tgsToGif) {
            return { status: 'skipped', reason: 'tgs-tool-not-configured' };
        }
        const fileInfo = await callTelegramApi(options.fetch, token, 'getFile', {
            file_id: sticker?.file_id || ''
        });
        const buffer = await downloadTelegramFile(options.fetch, token, fileInfo?.file_path);
        totalBytes += buffer.length;
        if (totalBytes > MAX_TOTAL_BYTES) {
            throw new LocalStickerDownloadError('pack-too-large', '贴纸包累计大小超过限制');
        }
        const baseName = sanitizeFilePart(sticker?.file_unique_id, `sticker-${index + 1}`);
        if (sticker?.is_video) {
            const fileName = `${baseName}.gif`;
            await convertSticker(ffmpeg, [
                '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
                '-vf', 'fps=20,scale=min(512\\,iw):-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
                '-loop', '0', '-y'
            ], buffer, path.join(directory, fileName));
            return { status: 'downloaded', fileName };
        }
        if (sticker?.is_animated) {
            const fileName = `${baseName}.gif`;
            await convertSticker(tgsToGif, [], buffer, path.join(directory, fileName));
            return { status: 'downloaded', fileName };
        }
        const fileName = `${baseName}.webp`;
        await writeFileAtomic(path.join(directory, fileName), buffer);
        return { status: 'downloaded', fileName };
    };

    const worker = async () => {
        while (true) {
            const index = cursor;
            cursor += 1;
            if (index >= stickers.length) {
                return;
            }
            try {
                results[index] = await downloadOne(stickers[index], index);
            } catch (error) {
                results[index] = {
                    status: 'failed',
                    reason: error?.code || 'download-failed'
                };
            }
        }
    };
    await Promise.all(Array.from(
        { length: Math.min(MAX_CONCURRENT_DOWNLOADS, stickers.length) },
        () => worker()
    ));

    const downloaded = results.filter(result => result?.status === 'downloaded');
    const failed = results.filter(result => result?.status === 'failed').length;
    const skipped = results.filter(result => result?.status === 'skipped').length;
    if (!downloaded.length) {
        const skippedReasons = new Set(results
            .filter(result => result?.status === 'skipped')
            .map(result => result.reason));
        const message = skipped === stickers.length && skippedReasons.size === 1
            ? skippedReasons.has('ffmpeg-not-configured')
                ? '这个贴纸包只有视频贴纸，请安装 FFmpeg 或选择其路径'
                : '这个贴纸包只有 TGS 动画，请安装 tgsToGif 或选择其路径'
            : 'Telegram 贴纸下载失败，请检查网络与转换工具';
        throw new LocalStickerDownloadError('sticker-download-failed', message);
    }

    const metadataPath = path.join(directory, 'sticker.json');
    const existing = await readExistingMetadata(directory);
    const metadata = {
        ...existing,
        label: String(stickerSet.title || existing.label || parsedUrl.name).trim().slice(0, 80),
        index: Number.isFinite(Number(existing.index)) ? Math.trunc(Number(existing.index)) : 0,
        icon: downloaded[0].fileName,
        url: parsedUrl.url
    };
    await writeFileAtomic(metadataPath, Buffer.from(JSON.stringify(metadata, null, 2), 'utf8'));
    return {
        ok: true,
        packName: metadata.label,
        directory,
        total: stickers.length,
        downloaded: downloaded.length,
        failed,
        skipped,
        msg: failed || skipped
            ? `已下载 ${downloaded.length} 个，跳过 ${skipped} 个，失败 ${failed} 个`
            : `已下载 ${downloaded.length} 个贴纸`
    };
}

module.exports = {
    CONVERSION_TIMEOUT_MS,
    LocalStickerDownloadError,
    MAX_CONCURRENT_DOWNLOADS,
    MAX_STICKER_BYTES,
    MAX_STICKERS_PER_PACK,
    MAX_TOTAL_BYTES,
    REQUEST_TIMEOUT_MS,
    downloadTelegramStickerPack,
    findExecutableOnPath,
    getEnvironmentHttpProxy,
    inspectLocalStickerTools,
    normalizeHttpProxyUrl,
    normalizeTelegramBotToken,
    parseTelegramStickerSetUrl,
    readLimitedResponseBuffer,
    sanitizeFilePart
};
