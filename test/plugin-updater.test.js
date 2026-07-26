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
    applyDownloadMirror,
    compareVersions,
    createFetchUpdateTransport,
    createPluginUpdater,
    extractPluginArchive,
    launchPowerShellInstaller,
    normalizeArchiveEntryName,
    normalizeGitHubRelease
} = require('../src/plugin-updater');

const execFile = promisify(childProcess.execFile);
const REQUIRED_TEST_PLUGIN_FILES = [
    'manifest.json',
    'package.json',
    'src/main.js',
    'src/preload.js',
    'src/renderer.js',
    'src/update-helper.ps1'
];

function makeFetchResponse(status, body = '', headers = {}) {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const normalizedHeaders = new Map(
        Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value)])
    );
    return {
        status,
        headers: {
            get: name => normalizedHeaders.get(String(name).toLowerCase()) || null,
            entries: () => normalizedHeaders.entries()
        },
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    };
}

function makeGitHubRelease(version, bytes = Buffer.from('release-asset'), overrides = {}) {
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    return {
        tag_name: `v${version}`,
        html_url: `https://github.com/MeiYongAI/QQNT-Toolbox/releases/tag/v${version}`,
        draft: false,
        assets: [{
            name: `QQNT-Toolbox-v${version}.zip`,
            browser_download_url:
                `https://github.com/MeiYongAI/QQNT-Toolbox/releases/download/v${version}/QQNT-Toolbox-v${version}.zip`,
            size: bytes.length,
            digest: `sha256:${sha256}`
        }],
        ...overrides
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

async function writeTestPlugin(pluginRoot, version, marker = '') {
    const files = {
        'manifest.json': JSON.stringify({ slug: 'qqnt_toolbox', version }),
        'package.json': JSON.stringify({ name: 'qqnt-toolbox', version }),
        'src/main.js': 'module.exports = {};',
        'src/preload.js': 'module.exports = {};',
        'src/renderer.js': 'export {};',
        'src/update-helper.ps1': 'param([string]$PlanPath)',
        'marker.txt': marker
    };
    for (const [relativePath, content] of Object.entries(files)) {
        const filePath = path.join(pluginRoot, relativePath);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content);
    }
}

function runPowerShellInstaller(planPath) {
    const powershell = path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
    );
    return execFile(powershell, [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(__dirname, '..', 'src', 'update-helper.ps1'),
        '-PlanPath',
        planPath
    ]);
}

async function waitForInstallStatus(statusPath, expected, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const status = JSON.parse(await fs.readFile(statusPath, 'utf8'));
            if (status.status === expected) {
                return status;
            }
            if (status.status === 'failed') {
                throw new Error(status.reason || 'installer failed');
            }
        } catch (error) {
            if (error?.code !== 'ENOENT' && !String(error?.message || '').includes('Unexpected end')) {
                throw error;
            }
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for installer status: ${expected}`);
}

test('normalizes GitHub Releases and compares semantic versions', () => {
    assert.equal(compareVersions('0.8.9', '0.8.8'), 1);
    assert.equal(compareVersions('v0.8.8', '0.8.8'), 0);
    assert.equal(compareVersions('0.8.8-beta.1', '0.8.8'), -1);

    const raw = makeGitHubRelease('0.8.9');
    const release = normalizeGitHubRelease(raw);
    assert.equal(release.version, '0.8.9');
    assert.equal(release.asset.name, 'QQNT-Toolbox-v0.8.9.zip');
    assert.match(release.asset.sha256, /^[0-9a-f]{64}$/);

    const missingAsset = makeGitHubRelease('0.8.9', Buffer.from('x'));
    missingAsset.assets[0].name = 'source.zip';
    assert.throws(() => normalizeGitHubRelease(missingAsset), { reason: 'invalid-release-asset' });

    const invalidDigest = makeGitHubRelease('0.8.9');
    invalidDigest.assets[0].digest = 'sha256:nope';
    assert.throws(() => normalizeGitHubRelease(invalidDigest), { reason: 'invalid-release-digest' });
});

test('uses an optional GitHub token only for the API and falls back from a download mirror', async () => {
    await withTemporaryDirectory(async directory => {
        const archive = Buffer.from('verified archive');
        const raw = makeGitHubRelease('0.8.9', archive);
        const requests = [];
        const transport = createFetchUpdateTransport(async (url, options) => {
            requests.push({ url, headers: { ...(options.headers || {}) } });
            if (url.startsWith('https://api.github.com/')) {
                return makeFetchResponse(200, JSON.stringify(raw), { etag: 'release-etag' });
            }
            if (url.startsWith('https://mirror.example/')) {
                return makeFetchResponse(502, 'mirror unavailable');
            }
            return makeFetchResponse(200, archive);
        });

        const checked = await transport.requestLatestRelease({
            token: 'github_pat_test',
            etag: 'old-etag'
        });
        assert.equal(checked.etag, 'release-etag');
        assert.equal(requests[0].headers.Authorization, 'Bearer github_pat_test');
        assert.equal(requests[0].headers['If-None-Match'], 'old-etag');

        const destination = path.join(directory, 'asset.zip');
        const downloaded = await transport.downloadPluginArchive({
            url: raw.assets[0].browser_download_url,
            destination,
            mirrorUrl: 'https://mirror.example/'
        });
        assert.equal(downloaded.route, 'direct');
        assert.equal(await fs.readFile(destination, 'utf8'), archive.toString());
        assert.equal(requests[1].headers.Authorization, undefined);
        assert.equal(requests[2].headers.Authorization, undefined);
        assert.equal(
            requests[1].url,
            `https://mirror.example/${raw.assets[0].browser_download_url}`
        );
    });

    assert.equal(
        applyDownloadMirror('https://github.com/owner/repo/file.zip', 'https://mirror.example/{url}'),
        'https://mirror.example/https://github.com/owner/repo/file.zip'
    );
    assert.throws(
        () => applyDownloadMirror('https://github.com/file.zip', 'http://unsafe.example'),
        { reason: 'invalid-mirror-url' }
    );
});

test('reports GitHub anonymous rate limiting distinctly', async () => {
    const transport = createFetchUpdateTransport(async () =>
        makeFetchResponse(403, '{}', { 'x-ratelimit-remaining': '0' })
    );
    await assert.rejects(transport.requestLatestRelease(), { reason: 'github-rate-limited' });
});

test('extracts only a complete, rooted plugin package with the expected identity', async () => {
    await withTemporaryDirectory(async directory => {
        const writer = new ZipWriter(new Uint8ArrayWriter());
        const files = {
            'manifest.json': JSON.stringify({ slug: 'qqnt_toolbox', version: '0.8.9' }),
            'package.json': JSON.stringify({ name: 'qqnt-toolbox', version: '0.8.9' }),
            'src/main.js': 'module.exports = {};',
            'src/preload.js': 'module.exports = {};',
            'src/renderer.js': 'export {};',
            'src/update-helper.ps1': 'param([string]$PlanPath)'
        };
        for (const [name, content] of Object.entries(files)) {
            await writer.add(`QQNT-Toolbox/${name}`, new TextReader(content));
        }
        const bytes = Buffer.from(await writer.close());
        const archivePath = path.join(directory, 'plugin.zip');
        const destination = path.join(directory, 'staged');
        await fs.writeFile(archivePath, bytes);

        await extractPluginArchive({
            archivePath,
            destination,
            expectedVersion: '0.8.9'
        });
        assert.equal(JSON.parse(await fs.readFile(
            path.join(destination, 'manifest.json'),
            'utf8'
        )).version, '0.8.9');
        assert.throws(() => normalizeArchiveEntryName('../manifest.json'), {
            reason: 'unsafe-archive-path'
        });
        assert.throws(() => normalizeArchiveEntryName('QQNT-Toolbox-main/manifest.json'), {
            reason: 'invalid-archive-root'
        });
    });
});

test('stages a Release package and prepares an in-place installation plan', async () => {
    await withTemporaryDirectory(async directory => {
        const pluginRoot = path.join(directory, 'plugins', 'QQNT-Toolbox-v0.8.8');
        const dataDir = path.join(directory, 'data');
        const helperSource = path.join(__dirname, '..', 'src', 'update-helper.ps1');
        const hostExecutable = path.join(directory, 'QQ.exe');
        const bytes = Buffer.from('verified release');
        const raw = makeGitHubRelease('0.8.9', bytes);
        let requestOptions = null;
        let downloadOptions = null;
        let spawnCall = null;
        await writeTestPlugin(pluginRoot, '0.8.8', 'old');
        await fs.writeFile(hostExecutable, 'host');

        const updater = createPluginUpdater({
            currentVersion: '0.8.8',
            pluginRoot,
            dataDir,
            helperSource,
            platform: 'win32',
            now: () => 1000,
            getRequestOptions: () => ({
                githubToken: 'github_pat_test',
                githubMirror: 'https://mirror.example/'
            }),
            requestLatestRelease: async options => {
                requestOptions = options;
                return { release: raw, etag: 'etag' };
            },
            downloadPluginArchive: async options => {
                downloadOptions = options;
                await fs.mkdir(path.dirname(options.destination), { recursive: true });
                await fs.writeFile(options.destination, bytes);
                return {
                    size: bytes.length,
                    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
                    route: 'mirror'
                };
            },
            extractPluginArchive: async ({ destination, expectedVersion }) => {
                await writeTestPlugin(destination, expectedVersion, 'new');
                return destination;
            },
            spawnProcess(executable, args, spawnOptions) {
                spawnCall = { executable, args, options: spawnOptions };
                return {
                    once(event, callback) {
                        if (event === 'spawn') {
                            setImmediate(callback);
                        }
                        return this;
                    },
                    unref() {}
                };
            },
            waitForInstallerHandshake: async () => {}
        });

        const checked = await updater.checkForUpdates({ force: true });
        assert.equal(checked.status, 'available');
        assert.equal(requestOptions.token, 'github_pat_test');

        const prepared = await updater.prepareUpdate();
        assert.equal(prepared.status, 'ready');
        assert.equal(downloadOptions.mirrorUrl, 'https://mirror.example/');

        const activated = await updater.activatePendingUpdate({
            processIds: [42, 24, 42],
            hostExecutable,
            relaunch: false
        });
        assert.equal(activated.status, 'restarting');
        assert.equal(spawnCall.options.detached, undefined);
        assert.equal(spawnCall.args.includes('-EncodedCommand'), true);
        assert.equal(await fs.readFile(path.join(pluginRoot, 'marker.txt'), 'utf8'), 'old');

        const plan = JSON.parse(await fs.readFile(
            path.join(dataDir, 'updater', 'install-plan.json'),
            'utf8'
        ));
        assert.equal(plan.schemaVersion, 3);
        assert.equal(path.resolve(plan.pluginRoot), path.resolve(pluginRoot));
        assert.equal(path.basename(plan.pluginRoot), 'QQNT-Toolbox-v0.8.8');
        assert.match(path.basename(plan.preparedPluginRoot), /^\.qqnt-toolbox-update-/);
        assert.match(path.basename(plan.backupPluginRoot), /^\.qqnt-toolbox-backup-/);
        assert.deepEqual(plan.processIds, [42, 24]);
        assert.equal(await fs.readFile(path.join(plan.preparedPluginRoot, 'marker.txt'), 'utf8'), 'new');
    });
});

test('does not report restart readiness before the installer handshake', async () => {
    await withTemporaryDirectory(async directory => {
        const pluginRoot = path.join(directory, 'plugins', 'QQNT-Toolbox');
        const dataDir = path.join(directory, 'data');
        const stagingRoot = path.join(dataDir, 'updater', 'staging', 'v0.8.9');
        const hostExecutable = path.join(directory, 'QQ.exe');
        await writeTestPlugin(pluginRoot, '0.8.8', 'old');
        await writeTestPlugin(stagingRoot, '0.8.9', 'new');
        await fs.mkdir(path.join(dataDir, 'updater'), { recursive: true });
        await fs.writeFile(hostExecutable, 'host');
        await fs.writeFile(path.join(dataDir, 'updater', 'pending-update.json'), JSON.stringify({
            schemaVersion: 1,
            kind: 'version-update',
            version: '0.8.9',
            stagedPluginRoot: stagingRoot,
            release: null
        }));

        const updater = createPluginUpdater({
            currentVersion: '0.8.8',
            pluginRoot,
            dataDir,
            helperSource: path.join(__dirname, '..', 'src', 'update-helper.ps1'),
            platform: 'win32',
            now: () => 1000,
            spawnProcess() {
                return {
                    once(event, callback) {
                        if (event === 'spawn') {
                            setImmediate(callback);
                        }
                        return this;
                    },
                    unref() {}
                };
            },
            waitForInstallerHandshake: async () => {
                const error = new Error('installer-start-timeout');
                error.reason = 'installer-start-timeout';
                throw error;
            }
        });
        assert.equal((await updater.getState()).status, 'ready');
        const result = await updater.activatePendingUpdate({
            processIds: [42],
            hostExecutable,
            relaunch: false
        });
        assert.equal(result.ok, false);
        assert.equal(result.status, 'error');
        assert.equal(result.reason, 'installer-start-timeout');
        assert.equal(await fs.readFile(path.join(pluginRoot, 'marker.txt'), 'utf8'), 'old');
    });
});

test('PowerShell installer replaces contents without changing the plugin directory name', {
    skip: process.platform !== 'win32'
}, async () => {
    await withTemporaryDirectory(async directory => {
        const pluginParent = path.join(directory, "plugin parent's files");
        const pluginRoot = path.join(pluginParent, 'QQNT-Toolbox-v0.8.8');
        const nonce = `${Date.now()}-deadbeef`;
        const preparedPluginRoot = path.join(pluginParent, `.qqnt-toolbox-update-${nonce}`);
        const backupPluginRoot = path.join(pluginParent, `.qqnt-toolbox-backup-${nonce}`);
        const dataDir = path.join(directory, 'data');
        const updateRoot = path.join(dataDir, 'updater');
        const pendingPath = path.join(updateRoot, 'pending-update.json');
        const planPath = path.join(updateRoot, 'install-plan.json');
        const statusPath = path.join(updateRoot, 'install-status.json');
        await writeTestPlugin(pluginRoot, '0.8.8', 'old');
        await writeTestPlugin(preparedPluginRoot, '0.8.9', 'new');
        await fs.mkdir(updateRoot, { recursive: true });
        await fs.writeFile(pendingPath, '{}');
        await fs.writeFile(planPath, JSON.stringify({
            schemaVersion: 3,
            version: '0.8.9',
            createdAt: Date.now(),
            launchDeadlineAt: Date.now() + 60000,
            slug: 'qqnt_toolbox',
            nonce,
            pluginParent,
            pluginRoot,
            preparedPluginRoot,
            backupPluginRoot,
            updateRoot,
            pendingPath,
            statusPath,
            processIds: [2147483646],
            hostExecutable: process.execPath,
            relaunch: false,
            requiredFiles: REQUIRED_TEST_PLUGIN_FILES
        }));

        await runPowerShellInstaller(planPath);

        assert.equal(await fs.readFile(path.join(pluginRoot, 'marker.txt'), 'utf8'), 'new');
        assert.equal(await fs.readFile(path.join(backupPluginRoot, 'marker.txt'), 'utf8'), 'old');
        const installedStatus = JSON.parse(await fs.readFile(statusPath, 'utf8'));
        assert.equal(installedStatus.status, 'installed');
        assert.equal(path.resolve(installedStatus.installedPluginRoot), path.resolve(pluginRoot));

        const restartedUpdater = createPluginUpdater({
            currentVersion: '0.8.9',
            pluginRoot,
            dataDir,
            platform: 'win32'
        });
        await restartedUpdater.getState();
        await assert.rejects(fs.stat(backupPluginRoot), { code: 'ENOENT' });
        await assert.rejects(fs.stat(planPath), { code: 'ENOENT' });
        await assert.rejects(fs.stat(statusPath), { code: 'ENOENT' });
    });
});

test('detached PowerShell installer survives the launcher process', {
    skip: process.platform !== 'win32'
}, async () => {
    await withTemporaryDirectory(async directory => {
        const pluginParent = path.join(directory, "plugin parent's files");
        const pluginRoot = path.join(pluginParent, 'QQNT-Toolbox-v0.8.8');
        const nonce = `${Date.now()}-facefeed`;
        const preparedPluginRoot = path.join(pluginParent, `.qqnt-toolbox-update-${nonce}`);
        const backupPluginRoot = path.join(pluginParent, `.qqnt-toolbox-backup-${nonce}`);
        const updateRoot = path.join(directory, "data folder's updater");
        const planPath = path.join(updateRoot, 'install-plan.json');
        const statusPath = path.join(updateRoot, 'install-status.json');
        const launcherPath = path.join(directory, 'launcher.js');
        const helperPath = path.join(__dirname, '..', 'src', 'update-helper.ps1');
        const updaterPath = path.join(__dirname, '..', 'src', 'plugin-updater.js');
        const powershell = path.join(
            process.env.SystemRoot || 'C:\\Windows',
            'System32',
            'WindowsPowerShell',
            'v1.0',
            'powershell.exe'
        );
        await writeTestPlugin(pluginRoot, '0.8.8', 'old');
        await writeTestPlugin(preparedPluginRoot, '0.8.9', 'new');
        await fs.mkdir(updateRoot, { recursive: true });
        await fs.writeFile(planPath, JSON.stringify({
            schemaVersion: 3,
            version: '0.8.9',
            createdAt: Date.now(),
            launchDeadlineAt: Date.now() + 60000,
            slug: 'qqnt_toolbox',
            nonce,
            pluginParent,
            pluginRoot,
            preparedPluginRoot,
            backupPluginRoot,
            updateRoot,
            pendingPath: path.join(updateRoot, 'pending-update.json'),
            statusPath,
            processIds: [],
            hostExecutable: process.execPath,
            relaunch: false,
            requiredFiles: REQUIRED_TEST_PLUGIN_FILES
        }));
        await fs.writeFile(launcherPath, [
            "'use strict';",
            "const fs = require('node:fs');",
            "const { launchPowerShellInstaller } = require(process.argv[2]);",
            'const [planPath, statusPath, helperPath, powershell] = process.argv.slice(3);',
            "const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));",
            'plan.processIds = [process.pid];',
            'plan.launchDeadlineAt = Date.now() + 60000;',
            "fs.writeFileSync(planPath, JSON.stringify(plan));",
            '(async () => {',
            'await launchPowerShellInstaller({ powershellPath: powershell, helperPath, planPath });',
            'const deadline = Date.now() + 8000;',
            'const poll = () => {',
            '  try {',
            "    const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));",
            "    if (status.status === 'waiting') process.exit(0);",
            '  } catch {}',
            '  if (Date.now() >= deadline) process.exit(2);',
            '  setTimeout(poll, 50);',
            '};',
            'poll();',
            '})().catch(() => process.exit(3));'
        ].join('\n'));

        await execFile(process.execPath, [
            launcherPath,
            updaterPath,
            planPath,
            statusPath,
            helperPath,
            powershell
        ], { timeout: 12000 });
        const status = await waitForInstallStatus(statusPath, 'installed');
        assert.equal(status.status, 'installed');
        assert.equal(await fs.readFile(path.join(pluginRoot, 'marker.txt'), 'utf8'), 'new');
    });
});

test('PowerShell installer preserves the old plugin when the prepared package is invalid', {
    skip: process.platform !== 'win32'
}, async () => {
    await withTemporaryDirectory(async directory => {
        const pluginParent = path.join(directory, 'plugins');
        const pluginRoot = path.join(pluginParent, 'QQNT-Toolbox');
        const nonce = `${Date.now()}-cafebabe`;
        const preparedPluginRoot = path.join(pluginParent, `.qqnt-toolbox-update-${nonce}`);
        const backupPluginRoot = path.join(pluginParent, `.qqnt-toolbox-backup-${nonce}`);
        const updateRoot = path.join(directory, 'data', 'updater');
        const planPath = path.join(updateRoot, 'install-plan.json');
        const statusPath = path.join(updateRoot, 'install-status.json');
        await writeTestPlugin(pluginRoot, '0.8.8', 'old');
        await writeTestPlugin(preparedPluginRoot, '0.8.7', 'invalid');
        await fs.mkdir(updateRoot, { recursive: true });
        await fs.writeFile(planPath, JSON.stringify({
            schemaVersion: 3,
            version: '0.8.9',
            createdAt: Date.now(),
            launchDeadlineAt: Date.now() + 60000,
            slug: 'qqnt_toolbox',
            nonce,
            pluginParent,
            pluginRoot,
            preparedPluginRoot,
            backupPluginRoot,
            updateRoot,
            pendingPath: path.join(updateRoot, 'pending-update.json'),
            statusPath,
            processIds: [2147483646],
            hostExecutable: process.execPath,
            relaunch: false,
            requiredFiles: REQUIRED_TEST_PLUGIN_FILES
        }));

        await runPowerShellInstaller(planPath);

        assert.equal(await fs.readFile(path.join(pluginRoot, 'marker.txt'), 'utf8'), 'old');
        await assert.rejects(fs.stat(backupPluginRoot), { code: 'ENOENT' });
        const failedStatus = JSON.parse(await fs.readFile(statusPath, 'utf8'));
        assert.equal(failedStatus.status, 'failed');
        assert.equal(failedStatus.reason, 'plugin-identity-mismatch');
    });
});

test('startup removes stale install plans and temporary plugin copies', async () => {
    await withTemporaryDirectory(async directory => {
        const pluginParent = path.join(directory, 'plugins');
        const pluginRoot = path.join(pluginParent, 'QQNT-Toolbox-v0.8.8');
        const temporaryRoot = path.join(pluginParent, '.qqnt-toolbox-update-1000-deadbeef');
        const dataDir = path.join(directory, 'data');
        const updateRoot = path.join(dataDir, 'updater');
        await writeTestPlugin(pluginRoot, '0.8.8', 'current');
        await writeTestPlugin(temporaryRoot, '0.8.8', 'temporary');
        await fs.mkdir(path.join(updateRoot, 'staging', 'stale-v0.8.8'), { recursive: true });
        await fs.writeFile(path.join(updateRoot, 'install-plan.json'), JSON.stringify({ schemaVersion: 2 }));
        await fs.writeFile(path.join(updateRoot, 'install-status.json'), JSON.stringify({ schemaVersion: 2 }));
        await fs.writeFile(path.join(updateRoot, 'pending-update.json'), JSON.stringify({
            kind: 'stale-update',
            version: '0.8.8'
        }));
        await fs.writeFile(path.join(updateRoot, 'update-helper.ps1'), 'legacy');

        const updater = createPluginUpdater({
            currentVersion: '0.8.8',
            pluginRoot,
            dataDir,
            platform: 'win32'
        });
        assert.equal((await updater.getState()).status, 'idle');
        await assert.rejects(fs.stat(temporaryRoot), { code: 'ENOENT' });
        await assert.rejects(fs.stat(path.join(updateRoot, 'pending-update.json')), { code: 'ENOENT' });
        await assert.rejects(fs.stat(path.join(updateRoot, 'staging')), { code: 'ENOENT' });
    });
});
