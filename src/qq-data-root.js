'use strict';

const os = require('os');
const path = require('path');

function normalizeAbsoluteDirectory(value) {
    if (typeof value !== 'string') {
        return '';
    }
    const directory = value.trim();
    if (!directory || !path.isAbsolute(directory)) {
        return '';
    }
    let normalized = path.normalize(directory);
    const rootLength = path.parse(normalized).root.length;
    while (normalized.length > rootLength && normalized.endsWith(path.sep)) {
        normalized = normalized.slice(0, -1);
    }
    return normalized;
}

function createQqDataRootResolver({
    getResourcesPath = () => process.resourcesPath,
    loadWrapper = wrapperPath => require(wrapperPath)
} = {}) {
    return function resolveQqDataRoot() {
        try {
            const resourcesPath = normalizeAbsoluteDirectory(getResourcesPath());
            if (!resourcesPath) {
                return '';
            }
            const wrapper = loadWrapper(path.join(resourcesPath, 'app', 'wrapper.node'));
            return normalizeAbsoluteDirectory(
                wrapper?.NodeQQNTWrapperUtil?.getNTUserDataInfoConfig?.()
            );
        } catch {
            return '';
        }
    };
}

const getQqDataRoot = createQqDataRootResolver();

function uniqueAbsoluteDirectories(values) {
    const directories = [];
    const seen = new Set();
    for (const value of values) {
        const directory = normalizeAbsoluteDirectory(value);
        if (!directory) {
            continue;
        }
        const key = process.platform === 'win32' ? directory.toLowerCase() : directory;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        directories.push(directory);
    }
    return directories;
}

function appendTencentFiles(directory) {
    const normalized = normalizeAbsoluteDirectory(directory);
    return normalized ? path.join(normalized, 'Tencent Files') : '';
}

function getTencentFilesRoots({
    qqDataRoot,
    documentsPath = '',
    homeDirectory = os.homedir(),
    userProfile = process.env.USERPROFILE || ''
} = {}) {
    const configuredRoot = normalizeAbsoluteDirectory(
        qqDataRoot === undefined ? getQqDataRoot() : qqDataRoot
    );
    if (configuredRoot) {
        return [configuredRoot];
    }
    return uniqueAbsoluteDirectories([
        appendTencentFiles(documentsPath),
        appendTencentFiles(homeDirectory ? path.join(homeDirectory, 'Documents') : ''),
        appendTencentFiles(userProfile ? path.join(userProfile, 'Documents') : '')
    ]);
}

module.exports = {
    createQqDataRootResolver,
    getQqDataRoot,
    getTencentFilesRoots,
    normalizeAbsoluteDirectory
};
