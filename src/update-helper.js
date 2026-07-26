'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { spawn } = require('node:child_process');

const INSTALL_PLAN_SCHEMA_VERSION = 4;
const HOST_EXIT_TIMEOUT_MS = 90_000;
const PROCESS_POLL_INTERVAL_MS = 200;

function installerError(reason) {
    const error = new Error(reason);
    error.reason = reason;
    return error;
}

function normalizeComparablePath(value, platform = process.platform) {
    const resolved = path.resolve(String(value || ''));
    return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function pathsEqual(left, right, platform = process.platform) {
    return normalizeComparablePath(left, platform) === normalizeComparablePath(right, platform);
}

function assertChildPath(root, candidate) {
    const rootPath = path.resolve(String(root || ''));
    const candidatePath = path.resolve(String(candidate || ''));
    const relative = path.relative(rootPath, candidatePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw installerError('unsafe-path');
    }
    return candidatePath;
}

function assertDirectChildPath(root, candidate) {
    const candidatePath = assertChildPath(root, candidate);
    if (!pathsEqual(path.dirname(candidatePath), root)) {
        throw installerError('unsafe-plugin-path');
    }
    return candidatePath;
}

async function readJson(filePath) {
    try {
        return JSON.parse(await fsp.readFile(filePath, 'utf8'));
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw installerError('invalid-plan');
        }
        throw error;
    }
}

async function writeJson(filePath, value) {
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
    await fsp.rm(filePath, { force: true });
    await fsp.rename(temporaryPath, filePath);
}

async function readPluginIdentity(pluginRoot) {
    let manifest;
    try {
        manifest = JSON.parse(await fsp.readFile(path.join(pluginRoot, 'manifest.json'), 'utf8'));
    } catch {
        throw installerError('installed-plugin-missing');
    }
    return {
        slug: String(manifest?.slug || ''),
        version: String(manifest?.version || '')
    };
}

async function assertPluginIdentity(pluginRoot, expectedSlug, expectedVersion = '') {
    const identity = await readPluginIdentity(pluginRoot);
    if (identity.slug !== expectedSlug || (expectedVersion && identity.version !== expectedVersion)) {
        throw installerError('plugin-identity-mismatch');
    }
}

function normalizeRequiredFiles(values) {
    if (!Array.isArray(values) || !values.length || values.length > 256) {
        throw installerError('incomplete-plugin-package');
    }
    return values.map(value => {
        const relative = String(value || '');
        const segments = relative.replace(/\\/g, '/').split('/');
        if (!relative || path.isAbsolute(relative) || segments.some(segment => !segment || segment === '.' || segment === '..')) {
            throw installerError('unsafe-required-file');
        }
        return relative;
    });
}

async function assertRequiredFiles(pluginRoot, requiredFiles) {
    for (const relativePath of requiredFiles) {
        const filePath = assertChildPath(pluginRoot, path.join(pluginRoot, relativePath));
        const stat = await fsp.stat(filePath).catch(() => null);
        if (!stat?.isFile()) {
            throw installerError('incomplete-plugin-package');
        }
    }
}

function normalizeProcessIds(values) {
    return [...new Set((Array.isArray(values) ? values : [])
        .map(Number)
        .filter(value => Number.isSafeInteger(value) && value > 0))];
}

function isProcessRunning(processId) {
    try {
        process.kill(processId, 0);
        return true;
    } catch (error) {
        return error?.code === 'EPERM';
    }
}

async function waitForProcessesToExit(processIds, options = {}) {
    const timeoutMs = Number(options.timeoutMs) || HOST_EXIT_TIMEOUT_MS;
    const pollIntervalMs = Number(options.pollIntervalMs) || PROCESS_POLL_INTERVAL_MS;
    const sleep = options.sleep || (delay => new Promise(resolve => setTimeout(resolve, delay)));
    const deadline = Date.now() + timeoutMs;
    while (true) {
        const running = processIds.filter(isProcessRunning);
        if (!running.length) {
            return;
        }
        if (Date.now() >= deadline) {
            throw installerError('host-still-running');
        }
        await sleep(pollIntervalMs);
    }
}

async function validateInstallPlan(planPath) {
    const plan = await readJson(planPath);
    if (!plan || Number(plan.schemaVersion) !== INSTALL_PLAN_SCHEMA_VERSION) {
        throw installerError('unsupported-plan');
    }

    const updateRoot = path.resolve(String(plan.updateRoot || ''));
    const pluginParent = path.resolve(String(plan.pluginParent || ''));
    const normalized = {
        ...plan,
        updateRoot,
        pluginParent,
        planPath: assertChildPath(updateRoot, planPath),
        statusPath: assertChildPath(updateRoot, plan.statusPath),
        pendingPath: assertChildPath(updateRoot, plan.pendingPath),
        pluginRoot: assertDirectChildPath(pluginParent, plan.pluginRoot),
        preparedPluginRoot: assertDirectChildPath(pluginParent, plan.preparedPluginRoot),
        backupPluginRoot: assertDirectChildPath(pluginParent, plan.backupPluginRoot),
        hostExecutable: path.resolve(String(plan.hostExecutable || '')),
        processIds: normalizeProcessIds(plan.processIds),
        requiredFiles: normalizeRequiredFiles(plan.requiredFiles),
        relaunch: plan.relaunch !== false
    };

    const expectedPreparedName = `.qqnt-toolbox-update-${normalized.nonce}`;
    const expectedBackupName = `.qqnt-toolbox-backup-${normalized.nonce}`;
    if (!/^\d+-[0-9a-f]{8}$/.test(String(normalized.nonce || '')) ||
        normalized.slug !== 'qqnt_toolbox' ||
        path.basename(normalized.preparedPluginRoot) !== expectedPreparedName ||
        path.basename(normalized.backupPluginRoot) !== expectedBackupName) {
        throw installerError('invalid-plan');
    }
    if (Date.now() > Number(normalized.launchDeadlineAt)) {
        throw installerError('installer-start-expired');
    }
    if (!normalized.processIds.length) {
        throw installerError('installer-processes-missing');
    }
    if (normalized.relaunch) {
        const hostStat = await fsp.stat(normalized.hostExecutable).catch(() => null);
        if (!hostStat?.isFile()) {
            throw installerError('host-executable-missing');
        }
    }
    return normalized;
}

async function writeInstallStatus(plan, status, reason = '', installedPluginRoot = '') {
    await writeJson(plan.statusPath, {
        schemaVersion: INSTALL_PLAN_SCHEMA_VERSION,
        status,
        reason,
        version: String(plan.version || ''),
        installedPluginRoot,
        backupPluginRoot: plan.backupPluginRoot,
        updatedAt: Date.now()
    });
}

async function relaunchHost(plan, spawnProcess = spawn) {
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    delete environment.QQNT_TOOLBOX_UPDATE_HELPER;
    const child = spawnProcess(plan.hostExecutable, [], {
        cwd: path.dirname(plan.hostExecutable),
        detached: true,
        env: environment,
        stdio: 'ignore',
        windowsHide: true
    });
    await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
    });
    child.unref();
}

async function installUpdate(planPath, options = {}) {
    const renamePath = options.renamePath || fsp.rename;
    let plan = null;
    let lockPath = '';
    let oldPluginMoved = false;
    let newPluginInstalled = false;
    let installSucceeded = false;
    let hostExitObserved = false;
    let failureReason = '';

    try {
        plan = await validateInstallPlan(planPath);
        lockPath = path.join(plan.updateRoot, 'install.lock');
        await fsp.mkdir(plan.updateRoot, { recursive: true });
        try {
            await fsp.mkdir(lockPath);
        } catch (error) {
            if (error?.code === 'EEXIST') {
                throw installerError('installer-already-running');
            }
            throw error;
        }

        await writeInstallStatus(plan, 'waiting');
        await waitForProcessesToExit(plan.processIds, options);
        hostExitObserved = true;

        await writeInstallStatus(plan, 'installing');
        await assertPluginIdentity(plan.pluginRoot, plan.slug);
        await assertPluginIdentity(plan.preparedPluginRoot, plan.slug, plan.version);
        await assertRequiredFiles(plan.preparedPluginRoot, plan.requiredFiles);
        if (await fsp.stat(plan.backupPluginRoot).catch(() => null)) {
            throw installerError('backup-target-exists');
        }

        await renamePath(plan.pluginRoot, plan.backupPluginRoot);
        oldPluginMoved = true;
        await renamePath(plan.preparedPluginRoot, plan.pluginRoot);
        newPluginInstalled = true;
        await assertPluginIdentity(plan.pluginRoot, plan.slug, plan.version);
        await writeInstallStatus(plan, 'installed', '', plan.pluginRoot);
        installSucceeded = true;
    } catch (error) {
        failureReason = String(error?.reason || error?.message || 'installer-failed');
        if (plan) {
            try {
                if (newPluginInstalled && await fsp.stat(plan.pluginRoot).catch(() => null)) {
                    await fsp.rm(plan.pluginRoot, { recursive: true, force: true });
                    newPluginInstalled = false;
                }
                if (oldPluginMoved && await fsp.stat(plan.backupPluginRoot).catch(() => null)) {
                    if (await fsp.stat(plan.pluginRoot).catch(() => null)) {
                        throw installerError('activation-rollback-target-exists');
                    }
                    await renamePath(plan.backupPluginRoot, plan.pluginRoot);
                    oldPluginMoved = false;
                }
            } catch (rollbackError) {
                failureReason = `activation-rollback-failed: ${rollbackError?.message || rollbackError}; original: ${failureReason}`;
            }
            await writeInstallStatus(plan, 'failed', failureReason).catch(() => {});
        }
    } finally {
        if (lockPath) {
            await fsp.rm(lockPath, { recursive: true, force: true }).catch(() => {});
        }
    }

    if (plan?.relaunch && hostExitObserved) {
        try {
            await relaunchHost(plan, options.spawnProcess || spawn);
        } catch (error) {
            const relaunchReason = `relaunch-failed: ${error?.message || error}`;
            await writeInstallStatus(
                plan,
                installSucceeded ? 'installed' : 'failed',
                installSucceeded ? relaunchReason : `${failureReason}; ${relaunchReason}`,
                installSucceeded ? plan.pluginRoot : ''
            ).catch(() => {});
        }
    }

    return { ok: installSucceeded, reason: failureReason };
}

if (require.main === module) {
    installUpdate(process.argv[2])
        .then(result => {
            process.exitCode = result.ok ? 0 : 1;
        })
        .catch(() => {
            process.exitCode = 1;
        });
}

module.exports = {
    INSTALL_PLAN_SCHEMA_VERSION,
    installUpdate,
    validateInstallPlan,
    waitForProcessesToExit
};
