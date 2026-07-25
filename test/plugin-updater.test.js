'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    TextReader,
    Uint8ArrayWriter,
    ZipWriter
} = require('@zip.js/zip.js');
const {
    compareVersions,
    createFetchUpdateTransport,
    createPluginUpdater,
    extractPluginArchive,
    normalizeArchiveEntryName,
    normalizeUpdateManifest
} = require('../src/plugin-updater');

function makeFetchResponse(status, body = '', headers = {}) {
    const bytes = Buffer.from(body);
    const normalizedHeaders = new Map(
        Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value)])
    );
    return {
        status,
        headers: {
            get: name => normalizedHeaders.get(String(name).toLowerCase()) || null,
            entries: () => normalizedHeaders.entries()
        },
        body: {
            getReader() {
                let consumed = false;
                return {
                    async read() {
                        if (consumed) {
                            return { done: true, value: undefined };
                        }
                        consumed = true;
                        return { done: false, value: bytes };
                    },
                    async cancel() {
                        consumed = true;
                    },
                    releaseLock() {}
                };
            },
            async cancel() {}
        },
        async arrayBuffer() {
            return bytes;
        }
    };
}

async function withTemporaryDirectory(callback) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qqnt-toolbox-updater-'));
    try {
        return await callback(directory);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
}

function makeRelease(version, bytes = Buffer.from('release-asset')) {
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    return {
        schemaVersion: 1,
        repository: 'MeiYongAI/QQNT-Toolbox',
        version,
        releaseUrl: `https://github.com/MeiYongAI/QQNT-Toolbox/releases/tag/v${version}`,
        asset: {
            name: `QQNT-Toolbox-v${version}.zip`,
            size: bytes.length,
            sha256,
            url: `https://github.com/MeiYongAI/QQNT-Toolbox/releases/download/v${version}/asset.zip`
        }
    };
}

test('compares plugin versions and accepts only the exact digested release asset', () => {
    assert.equal(compareVersions('0.7.1', '0.7.0'), 1);
    assert.equal(compareVersions('v0.7.1', '0.7.1'), 0);
    assert.equal(compareVersions('0.8.0-beta.1', '0.8.0'), -1);

    const release = normalizeUpdateManifest(makeRelease('0.8.0'));
    assert.equal(release.version, '0.8.0');
    assert.equal(release.asset.name, 'QQNT-Toolbox-v0.8.0.zip');
    assert.match(release.asset.sha256, /^[0-9a-f]{64}$/);

    const invalid = makeRelease('0.8.0');
    invalid.asset.sha256 = '';
    assert.throws(() => normalizeUpdateManifest(invalid), { reason: 'invalid-release-asset' });
});

test('rejects traversal and foreign roots in update archives', () => {
    assert.deepEqual(normalizeArchiveEntryName('QQNT-Toolbox/src/main.js'), [
        'QQNT-Toolbox', 'src', 'main.js'
    ]);
    assert.throws(() => normalizeArchiveEntryName('../manifest.json'), { reason: 'unsafe-archive-path' });
    assert.throws(() => normalizeArchiveEntryName('Other-Plugin/manifest.json'), {
        reason: 'invalid-archive-root'
    });
});

test('uses a bounded fetch transport for secure manifest and asset requests', async () => {
    await withTemporaryDirectory(async directory => {
        const release = makeRelease('0.8.0');
        const calls = [];
        const transport = createFetchUpdateTransport(async (url, options) => {
            calls.push({ url, options });
            if (url === 'https://updates.example/latest') {
                return makeFetchResponse(302, '', {
                    location: '/manifest.json'
                });
            }
            if (url === 'https://updates.example/manifest.json') {
                return makeFetchResponse(200, JSON.stringify(release), {
                    etag: 'fetch-etag'
                });
            }
            if (url === release.asset.url) {
                return makeFetchResponse(200, 'release-asset', {
                    'content-length': release.asset.size
                });
            }
            throw new Error(`Unexpected URL: ${url}`);
        });

        const manifestResult = await transport.requestUpdateManifest({
            manifestUrl: 'https://updates.example/latest'
        });
        assert.equal(manifestResult.etag, 'fetch-etag');
        assert.deepEqual(manifestResult.manifest, release);

        const destination = path.join(directory, release.asset.name);
        const download = await transport.downloadReleaseAsset({
            url: release.asset.url,
            destination
        });
        assert.equal(download.size, release.asset.size);
        assert.equal(download.sha256, release.asset.sha256);
        assert.equal(await fs.readFile(destination, 'utf8'), 'release-asset');
        assert.equal(calls.length, 3);
        assert.ok(calls.every(call => call.options.redirect === 'manual'));
        assert.ok(calls.every(call => call.options.bypassCustomProtocolHandlers === true));
    });
});

test('fetch update transport rejects insecure redirects and oversized responses', async () => {
    const insecure = createFetchUpdateTransport(async () => makeFetchResponse(302, '', {
        location: 'http://updates.example/manifest.json'
    }));
    await assert.rejects(
        insecure.requestUpdateManifest({ manifestUrl: 'https://updates.example/latest' }),
        { reason: 'insecure-url' }
    );

    const oversized = createFetchUpdateTransport(async () => makeFetchResponse(200, '', {
        'content-length': 2 * 1024 * 1024 + 1
    }));
    await assert.rejects(
        oversized.requestUpdateManifest({ manifestUrl: 'https://updates.example/latest' }),
        { reason: 'response-too-large' }
    );
});

test('extracts a complete package only when its plugin identity matches', async () => {
    await withTemporaryDirectory(async directory => {
        const archivePath = path.join(directory, 'update.zip');
        const outputPath = path.join(directory, 'staged');
        const writer = new ZipWriter(new Uint8ArrayWriter());
        await writer.add('QQNT-Toolbox\\node_modules\\', new TextReader(''));
        await writer.add('QQNT-Toolbox\\node_modules\\runtime.txt', new TextReader('runtime'));
        const files = {
            'manifest.json': JSON.stringify({ slug: 'qqnt_toolbox', version: '0.8.0' }),
            'package.json': JSON.stringify({ name: 'qqnt-toolbox', version: '0.8.0' }),
            'src/main.js': 'module.exports = {};',
            'src/preload.js': 'module.exports = {};',
            'src/renderer.js': 'export {};'
        };
        for (const [name, content] of Object.entries(files)) {
            await writer.add(`QQNT-Toolbox/${name}`, new TextReader(content));
        }
        await fs.writeFile(archivePath, Buffer.from(await writer.close()));

        await extractPluginArchive({
            archivePath,
            destination: outputPath,
            expectedVersion: '0.8.0'
        });
        assert.equal(
            JSON.parse(await fs.readFile(path.join(outputPath, 'manifest.json'), 'utf8')).version,
            '0.8.0'
        );
        await assert.rejects(
            extractPluginArchive({
                archivePath,
                destination: outputPath,
                expectedVersion: '0.8.1'
            }),
            { reason: 'plugin-identity-mismatch' }
        );
    });
});

test('stages a clean loader-selected copy and removes the old copy after the new version starts', async () => {
    await withTemporaryDirectory(async directory => {
        const pluginRoot = path.join(
            directory,
            'plugins',
            '~qqnt_toolbox-0.7.1-1000-deadbeef'
        );
        const dataDir = path.join(directory, 'data');
        const updateRoot = path.join(dataDir, 'updater');
        const bytes = Buffer.from('verified-release');
        const rawRelease = makeRelease('0.8.0', bytes);
        let requestCount = 0;
        await fs.mkdir(pluginRoot, { recursive: true });
        await fs.mkdir(updateRoot, { recursive: true });
        await fs.writeFile(
            path.join(pluginRoot, 'manifest.json'),
            JSON.stringify({ slug: 'qqnt_toolbox', version: '0.7.1' })
        );
        await fs.writeFile(path.join(pluginRoot, 'old.txt'), 'old');
        await fs.writeFile(path.join(updateRoot, 'install-plan.json'), '{}');
        await fs.writeFile(path.join(updateRoot, 'install-status.json'), '{}');
        await fs.writeFile(path.join(updateRoot, 'update-helper.ps1'), 'legacy');

        const updater = createPluginUpdater({
            currentVersion: '0.7.1',
            pluginRoot,
            dataDir,
            platform: 'win32',
            now: () => 1000,
            requestUpdateManifest: async () => {
                requestCount += 1;
                return { manifest: rawRelease, etag: 'release-etag' };
            },
            downloadReleaseAsset: async ({ destination }) => {
                await fs.mkdir(path.dirname(destination), { recursive: true });
                await fs.writeFile(destination, bytes);
                return {
                    size: bytes.length,
                    sha256: crypto.createHash('sha256').update(bytes).digest('hex')
                };
            },
            extractPluginArchive: async ({ destination, expectedVersion }) => {
                await fs.mkdir(destination, { recursive: true });
                await fs.writeFile(
                    path.join(destination, 'manifest.json'),
                    JSON.stringify({ slug: 'qqnt_toolbox', version: expectedVersion })
                );
                await fs.writeFile(path.join(destination, 'new.txt'), 'new');
                return destination;
            }
        });

        const checked = await updater.checkForUpdates({ force: true });
        assert.equal(checked.ok, true);
        assert.equal(checked.status, 'available');
        assert.equal(checked.latestVersion, '0.8.0');
        assert.equal(requestCount, 1);

        const prepared = await updater.prepareUpdate();
        assert.equal(prepared.ok, true);
        assert.equal(prepared.status, 'ready');
        assert.equal(prepared.pendingVersion, '0.8.0');

        const activated = await updater.activatePendingUpdate();
        assert.equal(activated.ok, true);
        assert.equal(activated.status, 'restarting');
        const activationPath = path.join(updateRoot, 'activation.json');
        const activation = JSON.parse(await fs.readFile(activationPath, 'utf8'));
        assert.equal(activation.version, '0.8.0');
        assert.equal(path.basename(activation.installedPluginRoot), 'QQNT-Toolbox-v0.8.0');
        assert.equal(await fs.readFile(path.join(activation.installedPluginRoot, 'new.txt'), 'utf8'), 'new');
        assert.equal(await fs.readFile(path.join(pluginRoot, 'old.txt'), 'utf8'), 'old');
        await assert.rejects(fs.stat(path.join(pluginRoot, 'manifest.json')), { code: 'ENOENT' });
        assert.equal(
            (await fs.readdir(pluginRoot)).filter(name => name.startsWith('.qqnt-toolbox-retired-manifest-')).length,
            1
        );

        const selectedRoot = (await fs.readdir(path.dirname(pluginRoot), { withFileTypes: true }))
            .filter(entry => entry.isDirectory())
            .map(entry => path.join(path.dirname(pluginRoot), entry.name))
            .filter(root => {
                try {
                    return require(path.join(root, 'manifest.json')).slug === 'qqnt_toolbox';
                } catch {
                    return false;
                }
            })
            .at(-1);
        assert.equal(path.resolve(selectedRoot), path.resolve(activation.installedPluginRoot));
        await assert.rejects(fs.stat(path.join(updateRoot, 'install-plan.json')), { code: 'ENOENT' });
        await assert.rejects(fs.stat(path.join(updateRoot, 'install-status.json')), { code: 'ENOENT' });
        await assert.rejects(fs.stat(path.join(updateRoot, 'update-helper.ps1')), { code: 'ENOENT' });

        const restartedUpdater = createPluginUpdater({
            currentVersion: '0.8.0',
            pluginRoot: activation.installedPluginRoot,
            dataDir,
            platform: 'win32'
        });
        const restartedState = await restartedUpdater.getState();
        assert.equal(restartedState.currentVersion, '0.8.0');
        await assert.rejects(fs.stat(pluginRoot), { code: 'ENOENT' });
        await assert.rejects(fs.stat(path.join(updateRoot, 'pending-update.json')), { code: 'ENOENT' });
        await assert.rejects(fs.stat(path.join(updateRoot, 'downloads')), { code: 'ENOENT' });
        await assert.rejects(fs.stat(path.join(updateRoot, 'staging')), { code: 'ENOENT' });
        await assert.rejects(fs.stat(activationPath), { code: 'ENOENT' });
        assert.equal(await fs.readFile(path.join(activation.installedPluginRoot, 'new.txt'), 'utf8'), 'new');
    });
});
