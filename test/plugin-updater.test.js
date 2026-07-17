'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { promisify } = require('node:util');
const {
    TextReader,
    Uint8ArrayWriter,
    ZipWriter
} = require('@zip.js/zip.js');
const {
    compareVersions,
    createPluginUpdater,
    extractPluginArchive,
    normalizeArchiveEntryName,
    normalizeUpdateManifest
} = require('../src/plugin-updater');

const execFile = promisify(childProcess.execFile);

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

test('checks, stages, and schedules one transactional installer', async () => {
    await withTemporaryDirectory(async directory => {
        const pluginRoot = path.join(directory, 'plugins', 'QQNT-Toolbox');
        const dataDir = path.join(directory, 'data');
        const helperSource = path.join(directory, 'update-helper.ps1');
        const bytes = Buffer.from('verified-release');
        const rawRelease = makeRelease('0.8.0', bytes);
        let requestCount = 0;
        let spawnCall = null;
        await fs.mkdir(pluginRoot, { recursive: true });
        await fs.writeFile(
            path.join(pluginRoot, 'manifest.json'),
            JSON.stringify({ slug: 'qqnt_toolbox', version: '0.7.1' })
        );
        await fs.writeFile(helperSource, 'param([string]$PlanPath)');

        const updater = createPluginUpdater({
            currentVersion: '0.7.1',
            pluginRoot,
            dataDir,
            helperSource,
            platform: 'win32',
            processId: 1234,
            hostExecutable: 'C:\\Program Files\\Tencent\\QQNT\\QQ.exe',
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
                return destination;
            },
            powershellPath: 'powershell.exe',
            spawnProcess(executable, args, options) {
                spawnCall = { executable, args, options };
                return { unref() {} };
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
        assert.equal(updater.launchPendingInstaller(), true);
        assert.equal(updater.launchPendingInstaller(), false);
        assert.equal(spawnCall.executable, 'powershell.exe');
        assert.equal(spawnCall.options.detached, true);
        const planPath = spawnCall.args.at(-1);
        const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
        assert.equal(plan.version, '0.8.0');
        assert.equal(plan.pluginRoot, pluginRoot);
    });
});

test('PowerShell helper replaces the staged plugin and preserves a backup', {
    skip: process.platform !== 'win32'
}, async () => {
    await withTemporaryDirectory(async directory => {
        const updateRoot = path.join(directory, 'data', 'updater');
        const pluginRoot = path.join(directory, 'plugins', 'QQNT-Toolbox');
        const stagedPluginRoot = path.join(updateRoot, 'staging', 'v0.8.0');
        const backupRoot = path.join(updateRoot, 'backups', 'v0.7.1');
        const pendingPath = path.join(updateRoot, 'pending-update.json');
        const statusPath = path.join(updateRoot, 'install-status.json');
        const planPath = path.join(updateRoot, 'install-plan.json');
        await fs.mkdir(pluginRoot, { recursive: true });
        await fs.mkdir(stagedPluginRoot, { recursive: true });
        await fs.writeFile(
            path.join(pluginRoot, 'manifest.json'),
            JSON.stringify({ slug: 'qqnt_toolbox', version: '0.7.1' })
        );
        await fs.writeFile(path.join(pluginRoot, 'old.txt'), 'old');
        await fs.writeFile(
            path.join(stagedPluginRoot, 'manifest.json'),
            JSON.stringify({ slug: 'qqnt_toolbox', version: '0.8.0' })
        );
        await fs.writeFile(path.join(stagedPluginRoot, 'new.txt'), 'new');
        await fs.writeFile(pendingPath, '{}');
        await fs.writeFile(planPath, JSON.stringify({
            version: '0.8.0',
            slug: 'qqnt_toolbox',
            processId: 999999,
            hostExecutable: 'C:\\QQNT-Toolbox-Test-Host.exe',
            pluginRoot,
            stagedPluginRoot,
            backupRoot,
            updateRoot,
            pendingPath,
            statusPath,
            nonce: '1000-2000'
        }));
        const powershell = path.join(
            process.env.SystemRoot || 'C:\\Windows',
            'System32',
            'WindowsPowerShell',
            'v1.0',
            'powershell.exe'
        );
        await execFile(powershell, [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            path.join(__dirname, '..', 'src', 'update-helper.ps1'),
            '-PlanPath',
            planPath
        ]);

        assert.equal(await fs.readFile(path.join(pluginRoot, 'new.txt'), 'utf8'), 'new');
        assert.equal(await fs.readFile(path.join(backupRoot, 'old.txt'), 'utf8'), 'old');
        assert.equal(JSON.parse(await fs.readFile(statusPath, 'utf8')).status, 'installed');
        await assert.rejects(fs.stat(pendingPath), { code: 'ENOENT' });
    });
});
