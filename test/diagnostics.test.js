'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
    createDiagnosticActionRunner,
    createDiagnosticLogger,
    sanitizeString,
    sanitizeDiagnosticValue
} = require('../src/diagnostics');

test('does not create diagnostics while disabled', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-toolbox-diagnostics-off-'));
    try {
        const logger = createDiagnosticLogger({
            isEnabled: () => false,
            getDirectory: () => directory
        });
        assert.equal(logger.record('info', 'session.started', { ok: true }), null);
        assert.equal(fs.existsSync(path.join(directory, 'toolbox.log')), false);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('redacts private fields before writing a bounded report', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-toolbox-diagnostics-on-'));
    try {
        const logger = createDiagnosticLogger({
            isEnabled: () => true,
            getDirectory: () => directory,
            getEnvironment: () => ({ qqVersion: '9.9.32-50969' }),
            entryLimit: 10
        });
        logger.record('info', 'repeat.request', {
            accountUin: '3100914681',
            archivePassword: 'secret',
            content: 'message body',
            filePath: 'D:\\private\\voice.amr',
            route: 'forward'
        });
        const report = logger.createReport();
        const details = report.entries[0].details;

        assert.equal(report.environment.qqVersion, '9.9.32-50969');
        assert.equal(details.accountUin, '<redacted-id:4681>');
        assert.equal(details.archivePassword, '<redacted>');
        assert.equal(details.content, '<redacted>');
        assert.equal(details.filePath, '<path>/voice.amr');
        assert.equal(details.route, 'forward');
        assert.ok(fs.statSync(path.join(directory, 'toolbox.log')).size > 0);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('rotates persistent diagnostics and clears both files', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-toolbox-diagnostics-rotate-'));
    try {
        const logger = createDiagnosticLogger({
            isEnabled: () => true,
            getDirectory: () => directory,
            fileLimit: 1024,
            entryLimit: 20
        });
        for (let index = 0; index < 20; index++) {
            logger.record('info', 'media.open', { index, note: 'x'.repeat(120) });
        }
        assert.equal(fs.existsSync(path.join(directory, 'toolbox.previous.log')), true);
        assert.ok(logger.createReport().entries.length <= 20);

        const stats = logger.clear();
        assert.equal(stats.entryCount, 0);
        assert.equal(fs.existsSync(path.join(directory, 'toolbox.log')), false);
        assert.equal(fs.existsSync(path.join(directory, 'toolbox.previous.log')), false);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('sanitizes cyclic and binary values', () => {
    const value = { bytes: Buffer.from([1, 2, 3]) };
    value.self = value;
    assert.deepEqual(sanitizeDiagnosticValue(value), {
        bytes: { type: 'Buffer', length: 3 },
        self: '<circular>'
    });
});

test('redacts absolute paths and long identifiers embedded in error text', () => {
    const value = sanitizeString('Failed D:\\private\\cache\\voice.amr for account 3100914681');
    assert.doesNotMatch(value, /D:\\private|3100914681/);
    assert.match(value, /<path>\/voice\.amr/);
    assert.match(value, /<redacted-id:4681>/);
    assert.equal(
        sanitizeDiagnosticValue({ filePath: 'D:\\private\\3100914681.amr' }).filePath,
        '<path>/<redacted-id:4681>.amr'
    );
});

test('copies, exports, opens, and clears diagnostics through one action runner', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qqnt-toolbox-diagnostics-actions-'));
    try {
        const logger = createDiagnosticLogger({
            isEnabled: () => true,
            getDirectory: () => directory,
            getEnvironment: () => ({ qqVersion: '9.9.32-50969' })
        });
        logger.record('info', 'renderer.ready');
        let copiedText = '';
        let revealedPath = '';
        let openedDirectory = '';
        const actions = createDiagnosticActionRunner({
            logger,
            copyText: value => {
                copiedText = value;
            },
            showItemInFolder: filePath => {
                revealedPath = filePath;
            },
            openPath: targetDirectory => {
                openedDirectory = targetDirectory;
                return '';
            }
        });

        assert.equal((await actions.run('copy-report')).ok, true);
        assert.equal(JSON.parse(copiedText).environment.qqVersion, '9.9.32-50969');

        const exported = await actions.run('export-report');
        assert.equal(exported.ok, true);
        assert.equal(revealedPath, path.join(directory, exported.fileName));
        assert.equal(fs.existsSync(revealedPath), true);
        assert.doesNotMatch(exported.fileName, /ZZ\.json$/);

        assert.equal((await actions.run('open-directory')).ok, true);
        assert.equal(openedDirectory, directory);
        assert.equal((await actions.run('clear')).entryCount, 0);
        assert.equal(fs.existsSync(path.join(directory, 'toolbox.log')), false);
        assert.equal((await actions.run('not-an-action')).reason, 'unknown-action');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
