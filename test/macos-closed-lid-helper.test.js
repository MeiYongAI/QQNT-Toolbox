'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    HELPER_LABEL,
    createHelperScript,
    createLaunchDaemonPlist,
    escapeXml,
    MacClosedLidHelper
} = require('../src/macos-closed-lid-helper');

test('helper only applies disablesleep while the request pid is alive and AC power is present', () => {
    const script = createHelperScript(501, '/Users/test/Library/Containers/com.tencent.qq/request-501');
    assert.match(script, /Library\/Containers\/com\.tencent\.qq\/request-501/);
    assert.match(script, /kill -0/);
    assert.match(script, /AC Power/);
    assert.match(script, /pmset -a disablesleep 1/);
    assert.match(script, /restore_setting/);
    assert.match(script, /previous-501/);
    assert.match(script, /rm -f "\$REQUEST"/);
    assert.match(script, /exit 0/);
});

test('launch daemon is restartable and runs the root-owned helper', () => {
    const plist = createLaunchDaemonPlist(501, '/Users/test/QQ & Data/request-501');
    assert.match(plist, new RegExp(HELPER_LABEL.replace(/\./g, '\\.')));
    assert.match(plist, /<key>SuccessfulExit<\/key><false\/>/);
    assert.match(plist, /<key>PathState<\/key>/);
    assert.match(plist, /QQ &amp; Data\/request-501/);
    assert.match(plist, /PrivilegedHelperTools/);
});

test('escapes launchd path values without changing the helper shell path', () => {
    assert.equal(escapeXml(`/tmp/a&b<'\">`), '/tmp/a&amp;b&lt;&apos;&quot;&gt;');
});

test('unsupported platforms report status without requesting installation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-power-'));
    const helper = new MacClosedLidHelper({
        platform: 'linux',
        uid: 501,
        pid: 100,
        dataDir: root,
        execFile: async () => {
            throw new Error('should-not-run');
        }
    });
    assert.equal(helper.getStatus().supported, false);
    await assert.rejects(() => helper.setEnabled(true), /unsupported/);
    assert.equal(helper.getStatus().requested, false);
});

test('stopping a request removes the wake path so launchd can let the helper exit', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-power-request-'));
    const helper = new MacClosedLidHelper({ platform: 'darwin', uid: 501, pid: 100, dataDir: root });
    helper.installed = true;
    helper.requestPath = path.join(root, 'request-501');
    await helper.writeRequest(true);
    assert.equal(fs.existsSync(helper.requestPath), true);
    assert.equal(helper.getStatus().requested, true);
    await helper.writeRequest(false);
    assert.equal(fs.existsSync(helper.requestPath), false);
    assert.equal(helper.getStatus().requested, false);
});

test('installer writes embedded helper content without asking root to read the app container', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-power-install-'));
    let script = '';
    const helper = new MacClosedLidHelper({
        platform: 'darwin',
        uid: 501,
        pid: 100,
        dataDir: root,
        pathExists: () => true,
        execFile: async (_file, args) => {
            script = args[1];
        }
    });

    await helper.install();

    assert.match(script, /\/usr\/bin\/printf/);
    assert.doesNotMatch(script, /\/usr\/bin\/install/);
    assert.doesNotMatch(script, new RegExp(`${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/com\\.qqnt-toolbox\\.closed-lid\\.(?:sh|plist)`));
    assert.match(script, /\(\/bin\/launchctl bootout system\/com\.qqnt-toolbox\.closed-lid .*\|\| true\)/);
    assert.ok(script.indexOf('/usr/bin/printf') < script.indexOf('/bin/launchctl bootstrap'));
});

test('uninstall restores pmset only when this helper recorded an applied change', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-power-uninstall-'));
    let script = '';
    const helper = new MacClosedLidHelper({
        platform: 'darwin',
        uid: 501,
        pid: 100,
        dataDir: root,
        execFile: async (_file, args) => {
            script = args[1];
        }
    });
    helper.installed = false;
    await helper.uninstall();
    assert.match(script, /if \[ -f .*applied-501/);
    assert.match(script, /pmset -a disablesleep/);
    assert.ok(script.indexOf('if [ -f') < script.indexOf('pmset -a disablesleep'));
});
