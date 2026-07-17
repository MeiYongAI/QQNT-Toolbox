'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
    createQqDataRootResolver,
    getTencentFilesRoots,
    normalizeAbsoluteDirectory
} = require('../src/qq-data-root');

function absoluteTestPath(...segments) {
    return path.join(path.parse(process.cwd()).root, ...segments);
}

test('reads a Unicode custom data root from the QQ native wrapper', () => {
    const resourcesPath = absoluteTestPath('QQ', 'versions', '9.9.23', 'resources');
    const customRoot = absoluteTestPath('software', 'QQ', '自建 QQ Files', 'Tencent Files');
    let loadedPath = '';
    const resolveQqDataRoot = createQqDataRootResolver({
        getResourcesPath: () => resourcesPath,
        loadWrapper(wrapperPath) {
            loadedPath = wrapperPath;
            return {
                NodeQQNTWrapperUtil: {
                    getNTUserDataInfoConfig: () => `${customRoot}${path.sep}`
                }
            };
        }
    });

    assert.equal(resolveQqDataRoot(), path.normalize(customRoot));
    assert.equal(loadedPath, path.join(resourcesPath, 'app', 'wrapper.node'));
});

test('uses the QQ configured root instead of standard Documents paths', () => {
    const customRoot = absoluteTestPath('custom', 'Tencent Files');
    assert.deepEqual(getTencentFilesRoots({
        qqDataRoot: customRoot,
        documentsPath: absoluteTestPath('Documents'),
        homeDirectory: absoluteTestPath('Users', 'tester'),
        userProfile: absoluteTestPath('Profiles', 'tester')
    }), [path.normalize(customRoot)]);
});

test('retries after loading wrapper.node fails', () => {
    const resourcesPath = absoluteTestPath('QQ', 'resources');
    const customRoot = absoluteTestPath('custom', 'Tencent Files');
    let attempts = 0;
    const resolveQqDataRoot = createQqDataRootResolver({
        getResourcesPath: () => resourcesPath,
        loadWrapper() {
            attempts += 1;
            if (attempts === 1) {
                throw new Error('wrapper is not ready');
            }
            return {
                NodeQQNTWrapperUtil: {
                    getNTUserDataInfoConfig: () => customRoot
                }
            };
        }
    });

    assert.equal(resolveQqDataRoot(), '');
    assert.equal(resolveQqDataRoot(), path.normalize(customRoot));
    assert.equal(attempts, 2);
});

test('retries when the QQ data root is initially empty', () => {
    const resourcesPath = absoluteTestPath('QQ', 'resources');
    const customRoot = absoluteTestPath('custom', 'Tencent Files');
    let calls = 0;
    const resolveQqDataRoot = createQqDataRootResolver({
        getResourcesPath: () => resourcesPath,
        loadWrapper: () => ({
            NodeQQNTWrapperUtil: {
                getNTUserDataInfoConfig() {
                    calls += 1;
                    return calls === 1 ? '' : customRoot;
                }
            }
        })
    });

    assert.equal(resolveQqDataRoot(), '');
    assert.equal(resolveQqDataRoot(), path.normalize(customRoot));
});

test('falls back to standard Documents roots when the QQ API is unavailable', () => {
    const documentsPath = absoluteTestPath('system-documents');
    const homeDirectory = absoluteTestPath('home');
    const userProfile = absoluteTestPath('profile');

    assert.deepEqual(getTencentFilesRoots({
        qqDataRoot: '',
        documentsPath,
        homeDirectory,
        userProfile
    }), [
        path.join(documentsPath, 'Tencent Files'),
        path.join(homeDirectory, 'Documents', 'Tencent Files'),
        path.join(userProfile, 'Documents', 'Tencent Files')
    ]);
    assert.equal(normalizeAbsoluteDirectory('Tencent Files'), '');
});
