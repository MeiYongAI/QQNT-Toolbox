'use strict';

const crypto = require('crypto');
const fs = require('fs').promises;
const fsSync = require('fs');
const https = require('https');
const path = require('path');
const {
    Uint8ArrayReader,
    Uint8ArrayWriter,
    ZipReader
} = require('@zip.js/zip.js');

const DEFAULT_REPOSITORY = 'MeiYongAI/QQNT-Toolbox';
const DEFAULT_UPDATE_MANIFEST_URL =
    'https://github.com/MeiYongAI/QQNT-Toolbox/releases/latest/download/update.json';
const DEFAULT_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
const MAX_API_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 512;
const INSTALLED_PLUGIN_DIRECTORY_PREFIX = 'QQNT-Toolbox-v';
const RETIRED_MANIFEST_PREFIX = '.qqnt-toolbox-retired-manifest-';
const REQUIRED_PLUGIN_FILES = Object.freeze([
    'manifest.json',
    'package.json',
    'src/main.js',
    'src/preload.js',
    'src/renderer.js'
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

function normalizeUpdateManifest(value, repository = DEFAULT_REPOSITORY) {
    if (!value || Number(value.schemaVersion) !== 1 || String(value.repository || '') !== repository) {
        throw createUpdaterError('invalid-update-manifest');
    }
    const version = normalizeVersion(value.version)?.value;
    if (!version) {
        throw createUpdaterError('invalid-update-version');
    }
    const assetName = `QQNT-Toolbox-v${version}.zip`;
    const asset = value.asset;
    const digestMatch = String(asset?.sha256 || '').match(/^([0-9a-f]{64})$/i);
    const downloadUrl = String(asset?.url || '');
    const size = Number(asset?.size);
    if (!asset || String(asset.name || '') !== assetName || !digestMatch || !downloadUrl.startsWith('https://') ||
        !Number.isSafeInteger(size) || size <= 0 || size > MAX_ARCHIVE_BYTES) {
        throw createUpdaterError('invalid-release-asset');
    }
    return {
        version,
        tag: `v${version}`,
        url: String(value.releaseUrl || ''),
        asset: {
            name: assetName,
            url: downloadUrl,
            size,
            sha256: digestMatch[1].toLowerCase()
        }
    };
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
        const request = https.get(parsedUrl, {
            headers: options.headers || {}
        }, response => {
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

async function requestUpdateManifest({ manifestUrl = DEFAULT_UPDATE_MANIFEST_URL, etag = '' } = {}) {
    const headers = {
        Accept: 'application/json',
        'User-Agent': 'QQNT-Toolbox-Updater'
    };
    if (etag) {
        headers['If-None-Match'] = etag;
    }
    const response = await requestBuffer(
        manifestUrl,
        { headers, maxBytes: MAX_API_BYTES }
    );
    if (response.statusCode === 304) {
        return { notModified: true, etag: String(response.headers.etag || etag) };
    }
    if (response.statusCode !== 200) {
        throw createUpdaterError('release-request-failed');
    }
    let manifest;
    try {
        manifest = JSON.parse(response.body.toString('utf8'));
    } catch {
        throw createUpdaterError('invalid-update-response');
    }
    return {
        notModified: false,
        etag: String(response.headers.etag || ''),
        manifest
    };
}

async function downloadReleaseAsset({ url, destination }) {
    const response = await requestBuffer(url, {
        headers: { 'User-Agent': 'QQNT-Toolbox-Updater' },
        maxBytes: MAX_ARCHIVE_BYTES,
        timeoutMs: 60000
    });
    if (response.statusCode !== 200) {
        throw createUpdaterError('asset-download-failed');
    }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const temporaryPath = `${destination}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, response.body);
    await fs.rm(destination, { force: true });
    await fs.rename(temporaryPath, destination);
    return {
        size: response.body.length,
        sha256: crypto.createHash('sha256').update(response.body).digest('hex')
    };
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
            const relativeSegments = segments.slice(1);
            const outputPath = assertPathInside(destination, path.join(destination, ...relativeSegments));
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
            const data = await entry.getData(new Uint8ArrayWriter());
            await fs.writeFile(outputPath, data);
        }
    } finally {
        await zipReader.close();
    }
    const manifestPath = path.join(destination, 'manifest.json');
    let manifest;
    try {
        manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    } catch {
        throw createUpdaterError('invalid-plugin-manifest');
    }
    if (manifest.slug !== expectedSlug || normalizeVersion(manifest.version)?.value !== expectedVersion) {
        throw createUpdaterError('plugin-identity-mismatch');
    }
    for (const relativePath of REQUIRED_PLUGIN_FILES) {
        const filePath = assertPathInside(destination, path.join(destination, relativePath));
        const stat = await fs.stat(filePath).catch(() => null);
        if (!stat?.isFile()) {
            throw createUpdaterError('incomplete-plugin-package');
        }
    }
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

function listPluginRoots(pluginParent, slug) {
    const roots = [];
    for (const entry of fsSync.readdirSync(pluginParent, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }
        const pluginRoot = path.join(pluginParent, entry.name);
        try {
            const manifest = JSON.parse(fsSync.readFileSync(path.join(pluginRoot, 'manifest.json'), 'utf8'));
            if (manifest.slug === slug) {
                roots.push(pluginRoot);
            }
        } catch {
        }
    }
    return roots;
}

function getSelectedPluginRoot(pluginParent, slug) {
    return listPluginRoots(pluginParent, slug).at(-1) || '';
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

async function retirePluginManifests(pluginRoots, nonce) {
    const retired = [];
    try {
        for (const pluginRoot of pluginRoots) {
            const manifestPath = path.join(pluginRoot, 'manifest.json');
            const retiredPath = path.join(pluginRoot, `${RETIRED_MANIFEST_PREFIX}${nonce}.json`);
            await fs.rename(manifestPath, retiredPath);
            retired.push({ manifestPath, retiredPath });
        }
        return retired;
    } catch (error) {
        await restorePluginManifests(retired);
        throw error;
    }
}

async function restorePluginManifests(retired) {
    let restored = true;
    for (const entry of [...retired].reverse()) {
        try {
            await fs.rename(entry.retiredPath, entry.manifestPath);
        } catch {
            restored = false;
        }
    }
    return restored;
}

function isUsableCachedRelease(value) {
    const version = normalizeVersion(value?.version)?.value;
    return Boolean(
        version && version === value.version &&
        value.asset?.name === `QQNT-Toolbox-v${version}.zip` &&
        String(value.asset?.url || '').startsWith('https://') &&
        /^[0-9a-f]{64}$/i.test(String(value.asset?.sha256 || '')) &&
        Number.isSafeInteger(Number(value.asset?.size)) && Number(value.asset.size) > 0
    );
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
    const activationPath = path.join(updateRoot, 'activation.json');
    const stagingRoot = path.join(updateRoot, 'staging');
    const pluginParent = path.dirname(pluginRoot);
    const pluginSlug = 'qqnt_toolbox';
    const repository = options.repository || DEFAULT_REPOSITORY;
    const manifestUrl = options.manifestUrl || DEFAULT_UPDATE_MANIFEST_URL;
    const platform = options.platform || process.platform;
    const requestManifest = options.requestUpdateManifest || requestUpdateManifest;
    const downloadAsset = options.downloadReleaseAsset || downloadReleaseAsset;
    const extractArchive = options.extractPluginArchive || extractPluginArchive;
    const now = options.now || Date.now;
    const checkIntervalMs = Number(options.checkIntervalMs) || DEFAULT_CHECK_INTERVAL_MS;
    let cache = null;
    let availableRelease = null;
    let initialized = false;
    let initializePromise = null;
    let operationPromise = null;
    let state = {
        status: 'idle',
        supported: platform === 'win32',
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

    async function removeLegacyInstallerArtifacts() {
        await Promise.all([
            'install-plan.json',
            'install-status.json',
            'update-helper.ps1'
        ].map(name => fs.rm(path.join(updateRoot, name), { force: true }).catch(() => {})));
        await fs.rm(path.join(updateRoot, 'install.lock'), { recursive: true, force: true }).catch(() => {});
        await fs.rm(path.join(updateRoot, 'backups'), { recursive: true, force: true }).catch(() => {});
    }

    async function finalizeActivatedUpdate() {
        const activation = await readJson(activationPath);
        if (!activation || activation.version !== currentVersion ||
            !pathsEqual(activation.installedPluginRoot, pluginRoot) ||
            !isDirectChildPath(pluginParent, activation.installedPluginRoot)) {
            return false;
        }
        await fs.rm(pendingPath, { force: true }).catch(() => {});
        await fs.rm(path.join(updateRoot, 'downloads'), { recursive: true, force: true }).catch(() => {});
        await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
        let cleanupComplete = true;
        for (const previousRoot of Array.isArray(activation.previousPluginRoots)
            ? activation.previousPluginRoots
            : []) {
            if (!isDirectChildPath(pluginParent, previousRoot) || pathsEqual(previousRoot, pluginRoot)) {
                continue;
            }
            try {
                await fs.rm(previousRoot, { recursive: true, force: true });
            } catch {
                cleanupComplete = false;
            }
        }
        if (cleanupComplete) {
            await fs.rm(activationPath, { force: true }).catch(() => {});
        }
        return true;
    }

    async function initialize() {
        if (initialized) {
            return;
        }
        await removeLegacyInstallerArtifacts();
        await finalizeActivatedUpdate();
        cache = await readJson(cachePath);
        const pending = await readJson(pendingPath);
        if (pending?.version && compareVersions(pending.version, currentVersion) > 0 &&
            fsSync.existsSync(path.join(String(pending.stagedPluginRoot || ''), 'manifest.json'))) {
            availableRelease = pending.release || null;
            emit({
                status: 'ready',
                latestVersion: pending.version,
                releaseUrl: String(pending.release?.url || ''),
                checkedAt: Number(pending.createdAt) || 0,
                pendingVersion: pending.version,
                reason: ''
            });
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
                const response = await requestManifest({
                    manifestUrl,
                    etag: cachedRelease ? String(cache?.etag || '') : ''
                });
                const release = response?.notModified
                    ? cachedRelease
                    : normalizeUpdateManifest(response?.manifest, repository);
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
            const stagedPluginRoot = path.join(updateRoot, 'staging', `v${release.version}`);
            try {
                const download = await downloadAsset({
                    url: release.asset.url,
                    destination: archivePath
                });
                if (Number(download?.size) !== release.asset.size ||
                    String(download?.sha256 || '').toLowerCase() !== release.asset.sha256) {
                    await fs.rm(archivePath, { force: true });
                    throw createUpdaterError('asset-verification-failed');
                }
                await extractArchive({
                    archivePath,
                    destination: stagedPluginRoot,
                    expectedVersion: release.version,
                    expectedSlug: 'qqnt_toolbox'
                });
                await fs.mkdir(updateRoot, { recursive: true });
                const pending = {
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

    async function activatePendingUpdate() {
        await ensureInitialized();
        if (state.status !== 'ready') {
            return { ok: false, ...cloneState(state), reason: 'update-not-ready' };
        }
        if (operationPromise) {
            return await operationPromise;
        }
        operationPromise = (async () => {
            const pending = await readJson(pendingPath);
            const version = normalizeVersion(pending?.version)?.value;
            const stagedPluginRoot = path.resolve(String(pending?.stagedPluginRoot || ''));
            const stagedIdentity = readPluginIdentity(stagedPluginRoot);
            if (!version || compareVersions(version, currentVersion) <= 0 ||
                !isPathInside(stagingRoot, stagedPluginRoot) ||
                stagedIdentity?.slug !== pluginSlug || stagedIdentity.version !== version) {
                return { ok: false, ...emit({ status: 'error', reason: 'invalid-pending-update' }) };
            }

            const existingActivation = await readJson(activationPath);
            if (existingActivation?.version === version &&
                isDirectChildPath(pluginParent, existingActivation.installedPluginRoot) &&
                readPluginIdentity(existingActivation.installedPluginRoot)?.version === version &&
                pathsEqual(
                    getSelectedPluginRoot(pluginParent, pluginSlug),
                    existingActivation.installedPluginRoot
                )) {
                return { ok: true, ...emit({ status: 'restarting', reason: '' }) };
            }

            const nonce = `${Number(now())}-${crypto.randomBytes(4).toString('hex')}`;
            const temporaryRoot = path.join(pluginParent, `.qqnt-toolbox-update-${nonce}`);
            const installedPluginRoot = path.join(
                pluginParent,
                `${INSTALLED_PLUGIN_DIRECTORY_PREFIX}${version}`
            );
            const previousPluginRoots = listPluginRoots(pluginParent, pluginSlug)
                .filter(root => !pathsEqual(root, installedPluginRoot));
            let retiredManifests = [];
            let activationWritten = false;
            try {
                if (pathsEqual(installedPluginRoot, pluginRoot)) {
                    throw createUpdaterError('activation-target-conflict');
                }
                if (fsSync.existsSync(installedPluginRoot)) {
                    const existingIdentity = readPluginIdentity(installedPluginRoot);
                    if (existingIdentity?.slug !== pluginSlug || existingIdentity.version !== version) {
                        throw createUpdaterError('activation-target-exists');
                    }
                    await fs.rm(installedPluginRoot, { recursive: true, force: true });
                }
                await fs.cp(stagedPluginRoot, temporaryRoot, {
                    recursive: true,
                    force: false,
                    errorOnExist: true
                });
                const copiedIdentity = readPluginIdentity(temporaryRoot);
                if (copiedIdentity?.slug !== pluginSlug || copiedIdentity.version !== version) {
                    throw createUpdaterError('copied-plugin-mismatch');
                }
                await fs.rename(temporaryRoot, installedPluginRoot);
                await writeJson(activationPath, {
                    version,
                    createdAt: Number(now()),
                    installedPluginRoot,
                    previousPluginRoots
                });
                activationWritten = true;
                retiredManifests = await retirePluginManifests(previousPluginRoots, nonce);
                if (!pathsEqual(getSelectedPluginRoot(pluginParent, pluginSlug), installedPluginRoot)) {
                    throw createUpdaterError('loader-selection-mismatch');
                }
                return { ok: true, ...emit({ status: 'restarting', reason: '' }) };
            } catch (error) {
                const restored = await restorePluginManifests(retiredManifests);
                await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => {});
                if (restored) {
                    await fs.rm(installedPluginRoot, { recursive: true, force: true }).catch(() => {});
                    if (activationWritten) {
                        await fs.rm(activationPath, { force: true }).catch(() => {});
                    }
                }
                const reason = restored
                    ? String(error?.reason || 'activation-failed')
                    : 'activation-rollback-failed';
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
    compareVersions,
    createPluginUpdater,
    extractPluginArchive,
    normalizeArchiveEntryName,
    normalizeUpdateManifest,
    normalizeVersion,
    requestUpdateManifest
};
