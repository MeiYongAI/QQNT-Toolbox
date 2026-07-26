'use strict';

const fs = require('node:fs');
const path = require('node:path');

const INSTALL_PLAN_SCHEMA_VERSION = 5;
const PLUGIN_SLUG = 'qqnt_toolbox';
const DEFAULT_MAIN_INJECT = './src/main.js';

function bootstrapError(reason) {
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
        throw bootstrapError('unsafe-path');
    }
    return candidatePath;
}

function assertDirectChildPath(root, candidate) {
    const candidatePath = assertChildPath(root, candidate);
    if (!pathsEqual(path.dirname(candidatePath), root)) {
        throw bootstrapError('unsafe-plugin-path');
    }
    return candidatePath;
}

function readJson(filePath, reason = 'invalid-plan') {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        throw bootstrapError(reason);
    }
}

function writeJson(filePath, value) {
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    try {
        fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
        fs.rmSync(filePath, { force: true });
        fs.renameSync(temporaryPath, filePath);
    } finally {
        fs.rmSync(temporaryPath, { force: true });
    }
}

function normalizeInjectEntry(value) {
    const entry = String(value || '').replace(/\\/g, '/');
    const relative = entry.replace(/^\.\//, '');
    const segments = relative.split('/');
    if (!relative || path.isAbsolute(entry) ||
        segments.some(segment => !segment || segment === '.' || segment === '..')) {
        throw bootstrapError('invalid-plugin-entry');
    }
    return `./${relative}`;
}

function resolvePluginEntry(pluginRoot, entry) {
    return assertChildPath(pluginRoot, path.resolve(pluginRoot, normalizeInjectEntry(entry)));
}

function readPluginManifest(pluginRoot) {
    const manifest = readJson(path.join(pluginRoot, 'manifest.json'), 'installed-plugin-missing');
    if (String(manifest?.slug || '') !== PLUGIN_SLUG) {
        throw bootstrapError('plugin-identity-mismatch');
    }
    return manifest;
}

function assertPluginIdentity(pluginRoot, expectedVersion = '') {
    const manifest = readPluginManifest(pluginRoot);
    if (expectedVersion && String(manifest.version || '') !== expectedVersion) {
        throw bootstrapError('plugin-identity-mismatch');
    }
    return manifest;
}

function normalizeRequiredFiles(values) {
    if (!Array.isArray(values) || !values.length || values.length > 256) {
        throw bootstrapError('incomplete-plugin-package');
    }
    return values.map(value => {
        const relative = String(value || '').replace(/\\/g, '/');
        const segments = relative.split('/');
        if (!relative || path.isAbsolute(relative) ||
            segments.some(segment => !segment || segment === '.' || segment === '..')) {
            throw bootstrapError('unsafe-required-file');
        }
        return relative;
    });
}

function assertRequiredFiles(pluginRoot, requiredFiles) {
    for (const relativePath of requiredFiles) {
        const filePath = assertChildPath(pluginRoot, path.join(pluginRoot, relativePath));
        if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
            throw bootstrapError('incomplete-plugin-package');
        }
    }
}

function validateInstallPlan(planPath) {
    const plan = readJson(planPath);
    if (Number(plan?.schemaVersion) !== INSTALL_PLAN_SCHEMA_VERSION) {
        throw bootstrapError('unsupported-plan');
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
        originalMainInject: normalizeInjectEntry(plan.originalMainInject),
        bootstrapInject: normalizeInjectEntry(plan.bootstrapInject),
        requiredFiles: normalizeRequiredFiles(plan.requiredFiles)
    };
    if (!/^\d+-[0-9a-f]{8}$/.test(String(normalized.nonce || '')) ||
        normalized.slug !== PLUGIN_SLUG || !String(normalized.version || '') ||
        path.basename(normalized.preparedPluginRoot) !== `.qqnt-toolbox-update-${normalized.nonce}` ||
        path.basename(normalized.backupPluginRoot) !== `.qqnt-toolbox-backup-${normalized.nonce}`) {
        throw bootstrapError('invalid-plan');
    }
    resolvePluginEntry(normalized.pluginRoot, normalized.originalMainInject);
    resolvePluginEntry(normalized.pluginRoot, normalized.bootstrapInject);
    return normalized;
}

function writeInstallStatus(plan, status, reason = '', installedPluginRoot = '') {
    writeJson(plan.statusPath, {
        schemaVersion: INSTALL_PLAN_SCHEMA_VERSION,
        status,
        reason,
        version: String(plan.version || ''),
        installedPluginRoot,
        backupPluginRoot: plan.backupPluginRoot,
        updatedAt: Date.now()
    });
}

function restoreOriginalMainEntry(plan) {
    const manifestPath = path.join(plan.pluginRoot, 'manifest.json');
    const manifest = readPluginManifest(plan.pluginRoot);
    manifest.injects = manifest.injects && typeof manifest.injects === 'object'
        ? manifest.injects
        : {};
    manifest.injects.main = plan.originalMainInject;
    writeJson(manifestPath, manifest);
}

function installPreparedUpdate(planPath, options = {}) {
    const renamePath = options.renamePath || fs.renameSync;
    const removePath = options.removePath || (target => fs.rmSync(target, {
        recursive: true,
        force: true
    }));
    let plan = null;
    let oldPluginMoved = false;
    let newPluginInstalled = false;
    let failureReason = '';
    try {
        plan = validateInstallPlan(planPath);
        writeInstallStatus(plan, 'installing');
        assertPluginIdentity(plan.pluginRoot);
        assertPluginIdentity(plan.preparedPluginRoot, plan.version);
        assertRequiredFiles(plan.preparedPluginRoot, plan.requiredFiles);
        if (fs.existsSync(plan.backupPluginRoot)) {
            throw bootstrapError('backup-target-exists');
        }
        renamePath(plan.pluginRoot, plan.backupPluginRoot);
        oldPluginMoved = true;
        renamePath(plan.preparedPluginRoot, plan.pluginRoot);
        newPluginInstalled = true;
        assertPluginIdentity(plan.pluginRoot, plan.version);
        writeInstallStatus(plan, 'installed', '', plan.pluginRoot);
        return { ok: true, reason: '', plan };
    } catch (error) {
        failureReason = String(error?.reason || error?.message || 'installer-failed');
        if (plan) {
            try {
                if (newPluginInstalled && fs.existsSync(plan.pluginRoot)) {
                    removePath(plan.pluginRoot);
                    newPluginInstalled = false;
                }
                if (oldPluginMoved && fs.existsSync(plan.backupPluginRoot)) {
                    if (fs.existsSync(plan.pluginRoot)) {
                        throw bootstrapError('activation-rollback-target-exists');
                    }
                    renamePath(plan.backupPluginRoot, plan.pluginRoot);
                    oldPluginMoved = false;
                }
                if (fs.existsSync(plan.pluginRoot)) {
                    restoreOriginalMainEntry(plan);
                }
            } catch (rollbackError) {
                failureReason = `activation-rollback-failed: ${rollbackError?.message || rollbackError}; original: ${failureReason}`;
            }
            try {
                writeInstallStatus(plan, 'failed', failureReason);
            } catch {
            }
        }
        return { ok: false, reason: failureReason, plan };
    }
}

function refreshLiteLoaderPlugin(liteLoader, pluginRoot, manifest) {
    const plugin = liteLoader?.plugins?.[PLUGIN_SLUG];
    if (!plugin) {
        return;
    }
    plugin.manifest = manifest;
    plugin.path.plugin = pluginRoot;
    plugin.path.injects = {
        main: manifest.injects?.main ? resolvePluginEntry(pluginRoot, manifest.injects.main) : null,
        preload: manifest.injects?.preload ? resolvePluginEntry(pluginRoot, manifest.injects.preload) : null,
        renderer: manifest.injects?.renderer ? resolvePluginEntry(pluginRoot, manifest.injects.renderer) : null
    };
}

function runUpdateBootstrap(options = {}) {
    const liteLoader = options.liteLoader || globalThis.LiteLoader;
    const pluginRoot = path.resolve(String(
        options.pluginRoot || liteLoader?.plugins?.[PLUGIN_SLUG]?.path?.plugin || path.join(__dirname, '..')
    ));
    const dataDirectory = String(
        options.dataDir || liteLoader?.plugins?.[PLUGIN_SLUG]?.path?.data || ''
    );
    if (!dataDirectory) {
        throw bootstrapError('updater-data-missing');
    }
    const dataDir = path.resolve(dataDirectory);
    const planPath = path.join(dataDir, 'updater', 'install-plan.json');
    const result = installPreparedUpdate(planPath, options);
    const manifest = readPluginManifest(pluginRoot);
    if (!result.ok && !result.plan) {
        manifest.injects = manifest.injects && typeof manifest.injects === 'object'
            ? manifest.injects
            : {};
        manifest.injects.main = DEFAULT_MAIN_INJECT;
        writeJson(path.join(pluginRoot, 'manifest.json'), manifest);
    }
    refreshLiteLoaderPlugin(liteLoader, pluginRoot, manifest);
    const mainEntry = result.ok
        ? manifest.injects?.main
        : result.plan?.originalMainInject || DEFAULT_MAIN_INJECT;
    const mainPath = resolvePluginEntry(pluginRoot, mainEntry);
    return typeof options.loadModule === 'function'
        ? options.loadModule(mainPath, result)
        : require(mainPath);
}

function getActiveLiteLoader() {
    try {
        return globalThis.LiteLoader || null;
    } catch {
        return null;
    }
}

const activeLiteLoader = getActiveLiteLoader();
const activeMainPath = activeLiteLoader?.plugins?.[PLUGIN_SLUG]?.path?.injects?.main;
if (activeMainPath && pathsEqual(activeMainPath, __filename)) {
    module.exports = runUpdateBootstrap({ liteLoader: activeLiteLoader });
} else {
    module.exports = {
        INSTALL_PLAN_SCHEMA_VERSION,
        installPreparedUpdate,
        runUpdateBootstrap,
        validateInstallPlan
    };
}
