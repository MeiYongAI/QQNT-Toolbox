'use strict';

const crypto = require('crypto');
const fs = require('fs').promises;
const fsSync = require('fs');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');
const {
    Uint8ArrayReader,
    Uint8ArrayWriter,
    ZipReader
} = require('@zip.js/zip.js');

const DEFAULT_REPOSITORY = 'MeiYongAI/QQNT-Toolbox';
const DEFAULT_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
const MAX_API_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 512;
const INSTALL_PLAN_SCHEMA_VERSION = 4;
const INSTALLER_HANDSHAKE_TIMEOUT_MS = 8000;
const SUPPORTED_INSTALLER_PLATFORMS = new Set(['win32', 'linux', 'darwin']);
const REQUIRED_PLUGIN_FILES = Object.freeze([
    'manifest.json',
    'package.json',
    'src/main.js',
    'src/preload.js',
    'src/renderer.js',
    'src/update-helper.js'
]);

function createUpdaterError(reason, message = reason) {
    const error = new Error(message);
    error.reason = reason;
    return error;
}

function normalizeVersion(value) {
    const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9a-z.-]+))?$/i);
    if (!match) {
        return null;
    }
    return {
        value: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}${match[4] ? `-${match[4]}` : ''}`,
        parts: [Number(match[1]), Number(match[2]), Number(match[3])],
        prerelease: match[4] || ''
    };
}

function compareVersions(left, right) {
    const leftVersion = normalizeVersion(left);
    const rightVersion = normalizeVersion(right);
    if (!leftVersion || !rightVersion) {
        throw createUpdaterError('invalid-version');
    }
    for (let index = 0; index < 3; index += 1) {
        if (leftVersion.parts[index] !== rightVersion.parts[index]) {
            return leftVersion.parts[index] > rightVersion.parts[index] ? 1 : -1;
        }
    }
    if (leftVersion.prerelease === rightVersion.prerelease) {
        return 0;
    }
    if (!leftVersion.prerelease) {
        return 1;
    }
    if (!rightVersion.prerelease) {
        return -1;
    }
    return leftVersion.prerelease.localeCompare(rightVersion.prerelease, 'en', {
        numeric: true,
        sensitivity: 'base'
    });
}

function normalizeGitHubRelease(value, repository = DEFAULT_REPOSITORY) {
    if (!value || value.draft === true) {
        throw createUpdaterError('invalid-release-response');
    }
    const version = normalizeVersion(value.tag_name)?.value;
    if (!version) {
        throw createUpdaterError('invalid-update-version');
    }
    const assetName = `QQNT-Toolbox-v${version}.zip`;
    const asset = Array.isArray(value.assets)
        ? value.assets.find(entry => String(entry?.name || '') === assetName)
        : null;
    const size = Number(asset?.size);
    const downloadUrl = String(asset?.browser_download_url || '');
    if (!asset || !downloadUrl.startsWith('https://') || !Number.isSafeInteger(size) ||
        size <= 0 || size > MAX_ARCHIVE_BYTES) {
        throw createUpdaterError('invalid-release-asset');
    }
    const digestText = String(asset.digest || '').trim();
    const digestMatch = digestText.match(/^sha256:([0-9a-f]{64})$/i);
    if (digestText && !digestMatch) {
        throw createUpdaterError('invalid-release-digest');
    }
    return {
        version,
        tag: String(value.tag_name || `v${version}`),
        url: String(value.html_url || `https://github.com/${repository}/releases/tag/v${version}`),
        asset: {
            name: assetName,
            url: downloadUrl,
            size,
            sha256: digestMatch?.[1]?.toLowerCase() || ''
        }
    };
}

function normalizeMirrorUrl(value) {
    const input = String(value || '').trim();
    if (!input) {
        return '';
    }
    if (input.length > 2048 || /[\r\n]/.test(input)) {
        throw createUpdaterError('invalid-mirror-url');
    }
    if (input.includes('{url}')) {
        return input;
    }
    let parsed;
    try {
        parsed = new URL(input);
    } catch {
        throw createUpdaterError('invalid-mirror-url');
    }
    if (parsed.protocol !== 'https:') {
        throw createUpdaterError('invalid-mirror-url');
    }
    return input.endsWith('/') ? input : `${input}/`;
}

function applyDownloadMirror(downloadUrl, mirrorUrl) {
    const mirror = normalizeMirrorUrl(mirrorUrl);
    if (!mirror) {
        return downloadUrl;
    }
    const mirrored = mirror.includes('{url}')
        ? mirror.replaceAll('{url}', downloadUrl)
        : `${mirror}${downloadUrl}`;
    let parsed;
    try {
        parsed = new URL(mirrored);
    } catch {
        throw createUpdaterError('invalid-mirror-url');
    }
    if (parsed.protocol !== 'https:') {
        throw createUpdaterError('invalid-mirror-url');
    }
    return parsed.toString();
}

function requestBuffer(url, options = {}, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        let parsedUrl;
        try {
            parsedUrl = new URL(url);
        } catch {
            reject(createUpdaterError('invalid-url'));
            return;
        }
        if (parsedUrl.protocol !== 'https:' || redirectCount > 5) {
            reject(createUpdaterError(redirectCount > 5 ? 'too-many-redirects' : 'insecure-url'));
            return;
        }
        const request = https.get(parsedUrl, { headers: options.headers || {} }, response => {
            const statusCode = Number(response.statusCode) || 0;
            if ([301, 302, 303, 307, 308].includes(statusCode)) {
                const location = response.headers.location;
                response.resume();
                if (!location) {
                    reject(createUpdaterError('invalid-redirect'));
                    return;
                }
                requestBuffer(new URL(location, parsedUrl).toString(), options, redirectCount + 1)
                    .then(resolve, reject);
                return;
            }
            const maxBytes = Number(options.maxBytes) || MAX_API_BYTES;
            const chunks = [];
            let size = 0;
            response.on('data', chunk => {
                size += chunk.length;
                if (size > maxBytes) {
                    request.destroy(createUpdaterError('response-too-large'));
                    return;
                }
                chunks.push(chunk);
            });
            response.once('end', () => resolve({
                statusCode,
                headers: response.headers,
                body: Buffer.concat(chunks)
            }));
        });
        request.setTimeout(Number(options.timeoutMs) || 20000, () => {
            request.destroy(createUpdaterError('request-timeout'));
        });
        request.once('error', reject);
    });
}

function getFetchHeader(response, name) {
    const headers = response?.headers;
    if (typeof headers?.get === 'function') {
        return String(headers.get(name) || '');
    }
    const normalizedName = String(name || '').toLowerCase();
    const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === normalizedName);
    return String(entry?.[1] || '');
}

function normalizeFetchHeaders(response) {
    const headers = {};
    if (typeof response?.headers?.entries === 'function') {
        for (const [name, value] of response.headers.entries()) {
            headers[String(name).toLowerCase()] = String(value);
        }
    }
    for (const name of ['etag', 'location', 'content-length', 'x-ratelimit-remaining']) {
        const value = getFetchHeader(response, name);
        if (value) {
            headers[name] = value;
        }
    }
    return headers;
}

async function readFetchBody(response, maxBytes, controller) {
    const declaredSize = Number(getFetchHeader(response, 'content-length'));
    if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
        controller.abort();
        throw createUpdaterError('response-too-large');
    }
    const reader = response?.body?.getReader?.();
    if (!reader) {
        const body = Buffer.from(await response.arrayBuffer());
        if (body.length > maxBytes) {
            controller.abort();
            throw createUpdaterError('response-too-large');
        }
        return body;
    }
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            const chunk = Buffer.from(value || []);
            size += chunk.length;
            if (size > maxBytes) {
                controller.abort();
                await reader.cancel().catch(() => {});
                throw createUpdaterError('response-too-large');
            }
            chunks.push(chunk);
        }
    } finally {
        reader.releaseLock?.();
    }
    return Buffer.concat(chunks, size);
}

async function requestBufferWithFetch(fetchImpl, url, options = {}, redirectCount = 0) {
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch {
        throw createUpdaterError('invalid-url');
    }
    if (parsedUrl.protocol !== 'https:' || redirectCount > 5) {
        throw createUpdaterError(redirectCount > 5 ? 'too-many-redirects' : 'insecure-url');
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, Number(options.timeoutMs) || 20000);
    timer.unref?.();
    try {
        const response = await fetchImpl(parsedUrl.toString(), {
            method: 'GET',
            headers: options.headers || {},
            redirect: 'manual',
            signal: controller.signal,
            bypassCustomProtocolHandlers: true
        });
        const statusCode = Number(response?.status) || 0;
        if ([301, 302, 303, 307, 308].includes(statusCode)) {
            const location = getFetchHeader(response, 'location');
            await response?.body?.cancel?.().catch(() => {});
            if (!location) {
                throw createUpdaterError('invalid-redirect');
            }
            return requestBufferWithFetch(
                fetchImpl,
                new URL(location, parsedUrl).toString(),
                options,
                redirectCount + 1
            );
        }
        return {
            statusCode,
            headers: normalizeFetchHeaders(response),
            body: await readFetchBody(
                response,
                Number(options.maxBytes) || MAX_API_BYTES,
                controller
            )
        };
    } catch (error) {
        if (error?.reason) {
            throw error;
        }
        throw createUpdaterError(
            timedOut ? 'request-timeout' : 'network-request-failed',
            String(error?.message || error || 'network-request-failed')
        );
    } finally {
        clearTimeout(timer);
    }
}

async function requestLatestReleaseWith(request, {
    repository = DEFAULT_REPOSITORY,
    token = '',
    etag = ''
} = {}) {
    const headers = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'QQNT-Toolbox-Updater',
        'X-GitHub-Api-Version': '2022-11-28'
    };
    if (String(token || '').trim()) {
        headers.Authorization = `Bearer ${String(token).trim()}`;
    }
    if (etag) {
        headers['If-None-Match'] = etag;
    }
    const response = await request(
        `https://api.github.com/repos/${repository}/releases/latest`,
        { headers, maxBytes: MAX_API_BYTES }
    );
    if (response.statusCode === 304) {
        return { notModified: true, etag: String(response.headers.etag || etag) };
    }
    if (response.statusCode === 401) {
        throw createUpdaterError('invalid-github-token');
    }
    if (response.statusCode === 403 && String(response.headers['x-ratelimit-remaining'] || '') === '0') {
        throw createUpdaterError('github-rate-limited');
    }
    if (response.statusCode !== 200) {
        throw createUpdaterError('release-request-failed');
    }
    let release;
    try {
        release = JSON.parse(response.body.toString('utf8'));
    } catch {
        throw createUpdaterError('invalid-release-response');
    }
    return {
        notModified: false,
        etag: String(response.headers.etag || ''),
        release
    };
}

async function downloadPluginArchiveWith(request, {
    url,
    destination,
    mirrorUrl = ''
}) {
    const mirroredUrl = applyDownloadMirror(url, mirrorUrl);
    const attempts = mirroredUrl === url
        ? [{ url, route: 'direct' }]
        : [{ url: mirroredUrl, route: 'mirror' }, { url, route: 'direct' }];
    let lastError = null;
    for (const attempt of attempts) {
        try {
            const response = await request(attempt.url, {
                headers: { 'User-Agent': 'QQNT-Toolbox-Updater' },
                maxBytes: MAX_ARCHIVE_BYTES,
                timeoutMs: 60000
            });
            if (response.statusCode !== 200) {
                throw createUpdaterError('asset-download-failed');
            }
            await fs.mkdir(path.dirname(destination), { recursive: true });
            const temporaryPath = `${destination}.${process.pid}.tmp`;
            try {
                await fs.writeFile(temporaryPath, response.body);
                await fs.rm(destination, { force: true });
                await fs.rename(temporaryPath, destination);
            } catch (error) {
                await fs.rm(temporaryPath, { force: true }).catch(() => {});
                throw error;
            }
            return {
                size: response.body.length,
                sha256: crypto.createHash('sha256').update(response.body).digest('hex'),
                route: attempt.route
            };
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError?.reason
        ? lastError
        : createUpdaterError('asset-download-failed');
}

function requestLatestRelease(options) {
    return requestLatestReleaseWith(requestBuffer, options);
}

function downloadPluginArchive(options) {
    return downloadPluginArchiveWith(requestBuffer, options);
}

function createFetchUpdateTransport(fetchImpl) {
    if (typeof fetchImpl !== 'function') {
        throw createUpdaterError('invalid-fetch-transport');
    }
    const request = (url, options) => requestBufferWithFetch(fetchImpl, url, options);
    return Object.freeze({
        requestLatestRelease: options => requestLatestReleaseWith(request, options),
        downloadPluginArchive: options => downloadPluginArchiveWith(request, options)
    });
}

function normalizeArchiveEntryName(value) {
    const normalized = String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.includes('\0')) {
        throw createUpdaterError('unsafe-archive-path');
    }
    const segments = normalized.split('/');
    if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
        throw createUpdaterError('unsafe-archive-path');
    }
    if (segments[0] !== 'QQNT-Toolbox') {
        throw createUpdaterError('invalid-archive-root');
    }
    return segments;
}

function assertPathInside(rootPath, targetPath) {
    const root = path.resolve(rootPath);
    const target = path.resolve(targetPath);
    const prefix = `${root}${path.sep}`;
    if (target !== root && !target.startsWith(prefix)) {
        throw createUpdaterError('unsafe-output-path');
    }
    return target;
}

async function extractPluginArchive({ archivePath, destination, expectedVersion, expectedSlug = 'qqnt_toolbox' }) {
    const archiveBytes = await fs.readFile(archivePath);
    if (!archiveBytes.length || archiveBytes.length > MAX_ARCHIVE_BYTES) {
        throw createUpdaterError('invalid-archive-size');
    }
    const zipReader = new ZipReader(new Uint8ArrayReader(archiveBytes));
    try {
        const entries = await zipReader.getEntries();
        if (!entries.length || entries.length > MAX_ARCHIVE_ENTRIES) {
            throw createUpdaterError('invalid-archive-entry-count');
        }
        let extractedBytes = 0;
        await fs.rm(destination, { recursive: true, force: true });
        await fs.mkdir(destination, { recursive: true });
        for (const entry of entries) {
            const isDirectory = entry.directory || /[\\\/]$/.test(String(entry.filename || ''));
            const segments = normalizeArchiveEntryName(entry.filename);
            if (segments.length === 1) {
                continue;
            }
            const outputPath = assertPathInside(destination, path.join(destination, ...segments.slice(1)));
            if (isDirectory) {
                await fs.mkdir(outputPath, { recursive: true });
                continue;
            }
            const size = Number(entry.uncompressedSize) || 0;
            extractedBytes += size;
            if (size > MAX_ARCHIVE_BYTES || extractedBytes > MAX_EXTRACTED_BYTES) {
                throw createUpdaterError('archive-content-too-large');
            }
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, await entry.getData(new Uint8ArrayWriter()));
        }
    } finally {
        await zipReader.close();
    }
    await assertCompletePluginDirectory(destination, expectedVersion, expectedSlug);
    return destination;
}

async function readJson(filePath) {
    try {
        return JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch {
        return null;
    }
}

async function writeJson(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
    await fs.rm(filePath, { force: true });
    await fs.rename(temporaryPath, filePath);
}

function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
}

function normalizeComparablePath(value, platform = process.platform) {
    const resolved = path.resolve(String(value || ''));
    return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function pathsEqual(left, right, platform = process.platform) {
    return normalizeComparablePath(left, platform) === normalizeComparablePath(right, platform);
}

function isPathInside(root, candidate) {
    if (!root || !candidate) {
        return false;
    }
    const relative = path.relative(path.resolve(String(root)), path.resolve(String(candidate)));
    return Boolean(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function isDirectChildPath(root, candidate) {
    return Boolean(root && candidate && pathsEqual(path.dirname(path.resolve(String(candidate))), root));
}

function readPluginIdentity(pluginRoot) {
    try {
        const manifest = JSON.parse(fsSync.readFileSync(path.join(pluginRoot, 'manifest.json'), 'utf8'));
        return {
            slug: String(manifest.slug || ''),
            version: normalizeVersion(manifest.version)?.value || ''
        };
    } catch {
        return null;
    }
}

async function assertCompletePluginDirectory(pluginDirectory, expectedVersion, expectedSlug) {
    const identity = readPluginIdentity(pluginDirectory);
    if (identity?.slug !== expectedSlug || identity.version !== expectedVersion) {
        throw createUpdaterError('plugin-identity-mismatch');
    }
    for (const relativePath of REQUIRED_PLUGIN_FILES) {
        const filePath = assertPathInside(pluginDirectory, path.join(pluginDirectory, relativePath));
        const stat = await fs.stat(filePath).catch(() => null);
        if (!stat?.isFile()) {
            throw createUpdaterError('incomplete-plugin-package');
        }
    }
    return pluginDirectory;
}

function normalizeProcessIds(values) {
    return [...new Set((Array.isArray(values) ? values : [])
        .map(Number)
        .filter(value => Number.isSafeInteger(value) && value > 0))];
}

async function launchUpdateInstaller({
    runtimeExecutable,
    helperPath,
    planPath,
    platform = process.platform,
    spawnProcess = spawn
}) {
    if (!SUPPORTED_INSTALLER_PLATFORMS.has(platform)) {
        throw createUpdaterError('unsupported-platform');
    }
    const child = spawnProcess(runtimeExecutable, [helperPath, planPath], {
        cwd: path.dirname(runtimeExecutable),
        detached: true,
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            QQNT_TOOLBOX_UPDATE_HELPER: '1'
        },
        stdio: 'ignore',
        windowsHide: true
    });
    if (typeof child.once === 'function') {
        await new Promise((resolve, reject) => {
            const onSpawn = () => {
                child.removeListener?.('error', onError);
                resolve();
            };
            const onError = error => {
                child.removeListener?.('spawn', onSpawn);
                reject(error);
            };
            child.once('spawn', onSpawn);
            child.once('error', onError);
        });
    }
    child.unref?.();
    return child;
}

function isUsableCachedRelease(value) {
    const version = normalizeVersion(value?.version)?.value;
    return Boolean(
        version && version === value.version &&
        value.asset?.name === `QQNT-Toolbox-v${version}.zip` &&
        String(value.asset?.url || '').startsWith('https://') &&
        (!value.asset?.sha256 || /^[0-9a-f]{64}$/i.test(String(value.asset.sha256))) &&
        Number.isSafeInteger(Number(value.asset?.size)) && Number(value.asset.size) > 0
    );
}

function isUpdaterTemporaryDirectoryName(name) {
    return /^\.qqnt-toolbox-(?:update|backup)-\d+-[0-9a-f]{8}(?:-old)?$/i.test(String(name || ''));
}

async function waitForInstallerHandshake(statusPath, version, deadlineAt, options = {}) {
    const sleep = options.sleep || (delay => new Promise(resolve => setTimeout(resolve, delay)));
    while (Date.now() < deadlineAt) {
        const status = await readJson(statusPath);
        if (Number(status?.schemaVersion) === INSTALL_PLAN_SCHEMA_VERSION && status.version === version) {
            if (['waiting', 'installing', 'installed'].includes(status.status)) {
                return status;
            }
            if (status.status === 'failed') {
                throw createUpdaterError(String(status.reason || 'installer-failed'));
            }
        }
        await sleep(50);
    }
    throw createUpdaterError('installer-start-timeout');
}

function createPluginUpdater(options = {}) {
    const currentVersion = normalizeVersion(options.currentVersion)?.value;
    const pluginRoot = path.resolve(String(options.pluginRoot || ''));
    const dataDir = path.resolve(String(options.dataDir || ''));
    if (!currentVersion || !pluginRoot || !dataDir) {
        throw createUpdaterError('invalid-updater-options');
    }
    const updateRoot = path.join(dataDir, 'updater');
    const cachePath = path.join(updateRoot, 'release-cache.json');
    const pendingPath = path.join(updateRoot, 'pending-update.json');
    const helperPath = path.join(updateRoot, 'update-helper.js');
    const planPath = path.join(updateRoot, 'install-plan.json');
    const statusPath = path.join(updateRoot, 'install-status.json');
    const stagingRoot = path.join(updateRoot, 'staging');
    const pluginParent = path.dirname(pluginRoot);
    const pluginSlug = 'qqnt_toolbox';
    const repository = options.repository || DEFAULT_REPOSITORY;
    const platform = options.platform || process.platform;
    const requestRelease = options.requestLatestRelease || requestLatestRelease;
    const downloadArchive = options.downloadPluginArchive || downloadPluginArchive;
    const extractArchive = options.extractPluginArchive || extractPluginArchive;
    const spawnProcess = options.spawnProcess || spawn;
    const now = options.now || Date.now;
    const getRequestOptions = typeof options.getRequestOptions === 'function'
        ? options.getRequestOptions
        : () => ({});
    const checkIntervalMs = Number(options.checkIntervalMs) || DEFAULT_CHECK_INTERVAL_MS;
    const handshakeTimeoutMs = Number(options.handshakeTimeoutMs) || INSTALLER_HANDSHAKE_TIMEOUT_MS;
    let cache = null;
    let availableRelease = null;
    let initialized = false;
    let initializePromise = null;
    let operationPromise = null;
    let installerLaunched = false;
    let state = {
        status: 'idle',
        supported: SUPPORTED_INSTALLER_PLATFORMS.has(platform),
        currentVersion,
        latestVersion: '',
        releaseUrl: '',
        checkedAt: 0,
        pendingVersion: '',
        reason: ''
    };

    function emit(patch = {}) {
        state = { ...state, ...patch };
        try {
            options.onStateChange?.(cloneState(state));
        } catch {
        }
        return cloneState(state);
    }

    function applyRelease(release, checkedAt) {
        availableRelease = release;
        const newer = compareVersions(release.version, currentVersion) > 0;
        return emit({
            status: newer ? 'available' : 'current',
            latestVersion: release.version,
            releaseUrl: release.url,
            checkedAt,
            pendingVersion: '',
            reason: ''
        });
    }

    async function cleanupTemporaryPluginDirectories(activeBackupRoot = '') {
        const entries = await fs.readdir(pluginParent, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            if (!entry.isDirectory() || !isUpdaterTemporaryDirectoryName(entry.name)) {
                continue;
            }
            const candidate = path.join(pluginParent, entry.name);
            if (activeBackupRoot && pathsEqual(candidate, activeBackupRoot)) {
                continue;
            }
            if (readPluginIdentity(candidate)?.slug !== pluginSlug || !fsSync.existsSync(pluginRoot)) {
                continue;
            }
            await fs.rm(candidate, { recursive: true, force: true }).catch(() => {});
        }
    }

    async function cleanupUpdateArtifacts({ keepPending = false } = {}) {
        const files = [
            planPath,
            statusPath,
            helperPath,
            path.join(updateRoot, 'update-helper.ps1')
        ];
        if (!keepPending) {
            files.push(pendingPath);
        }
        await Promise.all(files.map(filePath => fs.rm(filePath, { force: true }).catch(() => {})));
        await fs.rm(path.join(updateRoot, 'install.lock'), { recursive: true, force: true }).catch(() => {});
        if (!keepPending) {
            await fs.rm(path.join(updateRoot, 'downloads'), { recursive: true, force: true }).catch(() => {});
            await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
        }
    }

    async function finalizeInstallerRun() {
        const [plan, status] = await Promise.all([readJson(planPath), readJson(statusPath)]);
        if (Number(plan?.schemaVersion) !== INSTALL_PLAN_SCHEMA_VERSION ||
            Number(status?.schemaVersion) !== INSTALL_PLAN_SCHEMA_VERSION ||
            plan.version !== status.version) {
            await cleanupUpdateArtifacts({ keepPending: true });
            await cleanupTemporaryPluginDirectories();
            return '';
        }
        const backupPluginRoot = path.resolve(String(plan.backupPluginRoot || ''));
        if (status.status === 'installed' && status.version === currentVersion &&
            pathsEqual(plan.pluginRoot, pluginRoot) && pathsEqual(status.installedPluginRoot, pluginRoot)) {
            if (isDirectChildPath(pluginParent, backupPluginRoot) &&
                isUpdaterTemporaryDirectoryName(path.basename(backupPluginRoot))) {
                await fs.rm(backupPluginRoot, { recursive: true, force: true }).catch(() => {});
            }
            await cleanupUpdateArtifacts();
            await cleanupTemporaryPluginDirectories();
            return '';
        }
        if (status.status === 'failed') {
            await cleanupTemporaryPluginDirectories(backupPluginRoot);
            return String(status.reason || 'installer-failed');
        }
        if (status.status === 'queued' && Number(plan.launchDeadlineAt) < Date.now()) {
            await cleanupTemporaryPluginDirectories();
            await cleanupUpdateArtifacts({ keepPending: true });
            return 'installer-start-expired';
        }
        return '';
    }

    async function readUsablePendingUpdate() {
        const pending = await readJson(pendingPath);
        const version = normalizeVersion(pending?.version)?.value;
        const stagedPluginRoot = path.resolve(String(pending?.stagedPluginRoot || ''));
        if (pending?.kind !== 'version-update' || !version ||
            compareVersions(version, currentVersion) <= 0 || !isPathInside(stagingRoot, stagedPluginRoot)) {
            return null;
        }
        try {
            await assertCompletePluginDirectory(stagedPluginRoot, version, pluginSlug);
        } catch {
            return null;
        }
        return { ...pending, version, stagedPluginRoot };
    }

    async function initialize() {
        if (initialized) {
            return;
        }
        const installerFailure = await finalizeInstallerRun();
        cache = await readJson(cachePath);
        const pending = await readUsablePendingUpdate();
        if (pending) {
            availableRelease = pending.release || null;
            emit({
                status: 'ready',
                latestVersion: pending.version,
                releaseUrl: String(pending.release?.url || ''),
                checkedAt: Number(pending.createdAt) || 0,
                pendingVersion: pending.version,
                reason: installerFailure
            });
        } else {
            const stalePending = await readJson(pendingPath);
            if (stalePending) {
                await cleanupUpdateArtifacts();
            }
            if (installerFailure) {
                emit({ status: 'error', reason: installerFailure });
            }
        }
        initialized = true;
    }

    function ensureInitialized() {
        initializePromise ||= initialize();
        return initializePromise;
    }

    async function checkForUpdates({ force = false } = {}) {
        await ensureInitialized();
        if (state.status === 'ready') {
            return { ok: true, ...cloneState(state) };
        }
        if (operationPromise) {
            return await operationPromise;
        }
        operationPromise = (async () => {
            const currentTime = Number(now());
            const cachedRelease = isUsableCachedRelease(cache?.release) ? cache.release : null;
            const cachedAt = Number(cache?.checkedAt) || 0;
            if (!force && cachedRelease && currentTime - cachedAt < checkIntervalMs) {
                return { ok: true, ...applyRelease(cachedRelease, cachedAt) };
            }
            emit({ status: 'checking', reason: '' });
            try {
                const network = getRequestOptions() || {};
                const response = await requestRelease({
                    repository,
                    token: String(network.githubToken || ''),
                    etag: cachedRelease ? String(cache?.etag || '') : ''
                });
                const release = response?.notModified
                    ? cachedRelease
                    : normalizeGitHubRelease(response?.release, repository);
                if (!release) {
                    throw createUpdaterError('missing-release-cache');
                }
                cache = {
                    etag: String(response?.etag || cache?.etag || ''),
                    checkedAt: currentTime,
                    release
                };
                await writeJson(cachePath, cache);
                return { ok: true, ...applyRelease(release, currentTime) };
            } catch (error) {
                const reason = String(error?.reason || 'check-failed');
                return { ok: false, ...emit({ status: 'error', reason }) };
            }
        })();
        try {
            return await operationPromise;
        } finally {
            operationPromise = null;
        }
    }

    async function prepareUpdate() {
        await ensureInitialized();
        if (state.status === 'ready') {
            return { ok: true, ...cloneState(state) };
        }
        if (!state.supported) {
            return { ok: false, ...emit({ status: 'error', reason: 'unsupported-platform' }) };
        }
        if (!availableRelease || compareVersions(availableRelease.version, currentVersion) <= 0) {
            const checked = await checkForUpdates({ force: false });
            if (!checked.ok || checked.status !== 'available') {
                return checked.ok
                    ? { ok: false, ...emit({ status: checked.status, reason: 'no-update' }) }
                    : checked;
            }
        }
        if (operationPromise) {
            return await operationPromise;
        }
        operationPromise = (async () => {
            const release = availableRelease;
            emit({ status: 'downloading', latestVersion: release.version, reason: '' });
            const archivePath = path.join(updateRoot, 'downloads', release.asset.name);
            const stagedPluginRoot = path.join(stagingRoot, `v${release.version}`);
            try {
                const network = getRequestOptions() || {};
                const download = await downloadArchive({
                    url: release.asset.url,
                    destination: archivePath,
                    mirrorUrl: String(network.githubMirror || '')
                });
                if (Number(download?.size) !== release.asset.size ||
                    (release.asset.sha256 && String(download?.sha256 || '').toLowerCase() !== release.asset.sha256)) {
                    await fs.rm(archivePath, { force: true });
                    throw createUpdaterError('asset-verification-failed');
                }
                await extractArchive({
                    archivePath,
                    destination: stagedPluginRoot,
                    expectedVersion: release.version,
                    expectedSlug: pluginSlug
                });
                const pending = {
                    schemaVersion: 1,
                    kind: 'version-update',
                    version: release.version,
                    createdAt: Number(now()),
                    stagedPluginRoot,
                    release
                };
                await writeJson(pendingPath, pending);
                return {
                    ok: true,
                    ...emit({
                        status: 'ready',
                        latestVersion: release.version,
                        releaseUrl: release.url,
                        pendingVersion: release.version,
                        reason: ''
                    })
                };
            } catch (error) {
                await fs.rm(stagedPluginRoot, { recursive: true, force: true }).catch(() => {});
                const reason = String(error?.reason || 'prepare-failed');
                return { ok: false, ...emit({ status: 'error', reason }) };
            }
        })();
        try {
            return await operationPromise;
        } finally {
            operationPromise = null;
        }
    }

    async function getState() {
        await ensureInitialized();
        return cloneState(state);
    }

    async function activatePendingUpdate(runtime = {}) {
        await ensureInitialized();
        if (state.status !== 'ready') {
            return { ok: false, ...cloneState(state), reason: 'update-not-ready' };
        }
        if (installerLaunched) {
            return { ok: true, ...emit({ status: 'restarting', reason: '' }) };
        }
        if (operationPromise) {
            return await operationPromise;
        }
        operationPromise = (async () => {
            const pending = await readUsablePendingUpdate();
            if (!pending) {
                return { ok: false, ...emit({ status: 'error', reason: 'invalid-pending-update' }) };
            }
            const nonce = `${Number(now())}-${crypto.randomBytes(4).toString('hex')}`;
            const preparedPluginRoot = path.join(pluginParent, `.qqnt-toolbox-update-${nonce}`);
            const backupPluginRoot = path.join(pluginParent, `.qqnt-toolbox-backup-${nonce}`);
            try {
                if (!isDirectChildPath(pluginParent, pluginRoot) ||
                    readPluginIdentity(pluginRoot)?.slug !== pluginSlug) {
                    throw createUpdaterError('installed-plugin-missing');
                }
                const helperSource = path.resolve(String(options.helperSource || ''));
                if (!options.helperSource || !fsSync.existsSync(helperSource)) {
                    throw createUpdaterError('installer-helper-missing');
                }
                await fs.rm(preparedPluginRoot, { recursive: true, force: true });
                await fs.cp(pending.stagedPluginRoot, preparedPluginRoot, {
                    recursive: true,
                    force: false,
                    errorOnExist: true
                });
                await assertCompletePluginDirectory(preparedPluginRoot, pending.version, pluginSlug);
                await fs.mkdir(updateRoot, { recursive: true });
                await fs.copyFile(helperSource, helperPath);
                const processIds = normalizeProcessIds(runtime.processIds);
                if (!processIds.length) {
                    throw createUpdaterError('installer-processes-missing');
                }
                const hostExecutable = path.resolve(String(runtime.hostExecutable || ''));
                if (!runtime.hostExecutable) {
                    throw createUpdaterError('installer-host-missing');
                }
                const runtimeExecutable = path.resolve(String(
                    runtime.runtimeExecutable || runtime.hostExecutable
                ));
                const launchDeadlineAt = Number(now()) + handshakeTimeoutMs;
                const plan = {
                    schemaVersion: INSTALL_PLAN_SCHEMA_VERSION,
                    version: pending.version,
                    createdAt: Number(now()),
                    launchDeadlineAt,
                    slug: pluginSlug,
                    nonce,
                    pluginParent,
                    pluginRoot,
                    preparedPluginRoot,
                    backupPluginRoot,
                    updateRoot,
                    pendingPath,
                    statusPath,
                    processIds,
                    hostExecutable,
                    relaunch: runtime.relaunch !== false,
                    requiredFiles: [...REQUIRED_PLUGIN_FILES]
                };
                await writeJson(planPath, plan);
                await writeJson(statusPath, {
                    schemaVersion: INSTALL_PLAN_SCHEMA_VERSION,
                    status: 'queued',
                    reason: '',
                    version: pending.version,
                    updatedAt: Number(now())
                });
                await launchUpdateInstaller({
                    runtimeExecutable,
                    helperPath,
                    planPath,
                    platform,
                    spawnProcess
                });
                if (typeof options.waitForInstallerHandshake === 'function') {
                    await options.waitForInstallerHandshake({
                        planPath,
                        statusPath,
                        version: pending.version,
                        launchDeadlineAt
                    });
                } else {
                    await waitForInstallerHandshake(
                        statusPath,
                        pending.version,
                        launchDeadlineAt,
                        { sleep: options.sleep }
                    );
                }
                installerLaunched = true;
                return { ok: true, ...emit({ status: 'restarting', reason: '' }) };
            } catch (error) {
                const reason = String(error?.reason || 'activation-failed');
                if (reason !== 'installer-start-timeout') {
                    await fs.rm(preparedPluginRoot, { recursive: true, force: true }).catch(() => {});
                }
                return { ok: false, ...emit({ status: 'error', reason }) };
            }
        })();
        try {
            return await operationPromise;
        } finally {
            operationPromise = null;
        }
    }

    return Object.freeze({
        activatePendingUpdate,
        checkForUpdates,
        getState,
        prepareUpdate
    });
}

module.exports = {
    applyDownloadMirror,
    compareVersions,
    createFetchUpdateTransport,
    createPluginUpdater,
    extractPluginArchive,
    launchUpdateInstaller,
    normalizeArchiveEntryName,
    normalizeGitHubRelease,
    normalizeVersion,
    requestLatestRelease
};
