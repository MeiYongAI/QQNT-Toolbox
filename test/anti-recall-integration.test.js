'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function source(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('captures preservation candidates before applying recall replacement', () => {
    const main = source('src/main.js');
    const handler = main.slice(main.indexOf('function handleNativeSend'), main.indexOf('function installNativeSendHandler'));
    assert.ok(handler.indexOf('processAntiRecallPreservationIntake') >= 0);
    assert.ok(handler.indexOf('processPreventRecall') > handler.indexOf('processAntiRecallPreservationIntake'));
    assert.match(main, /function processAntiRecallPreservationIntake[\s\S]*commandNames\.has\(POKE_RECEIVE_CMD\)/);
});

test('keeps archived asset paths on later full-message updates after recovery', () => {
    const main = source('src/main.js');
    const start = main.indexOf('function preserveRecoveredRecallMetadata');
    const end = main.indexOf('function processPreventRecall', start);
    const preserve = main.slice(start, end);
    assert.match(preserve, /getPicSourcePath/);
    assert.match(preserve, /getFileSourcePath/);
    assert.match(preserve, /applyAssetPath/);
});

test('reserves staging capacity before invoking the QQ native acquisition route', () => {
    const main = source('src/main.js');
    const queue = main.slice(main.indexOf('function queuePreservationAsset'), main.indexOf('function resumeRecallStaging'));
    assert.ok(queue.indexOf('beginAssetAcquisition') >= 0);
    assert.ok(queue.indexOf('isPreservationFileAssetEligible') >= 0);
    assert.ok(queue.indexOf('isPreservationFileAssetEligible') < queue.indexOf('beginAssetAcquisition'));
    assert.ok(queue.indexOf('resolvePreservationAssetSource') > queue.indexOf('beginAssetAcquisition'));
    assert.match(main, /nodeIKernelRichMediaService\/downloadRichMediaInVisit/);
    assert.match(queue, /failAssetAcquisition/);
});

test('keeps file policy independent from file names and content types in the received-file UI', () => {
    const renderer = source('src/renderer.js');
    const sectionStart = renderer.indexOf("createSection('receivedFiles'");
    const sectionEnd = renderer.indexOf("createSection('entertainment'", sectionStart);
    const section = renderer.slice(sectionStart, sectionEnd);
    assert.match(section, /receivedFileAutoDownload\.enabled/);
    assert.match(section, /manageAutoDownloadGroups/);
    assert.match(section, /createFileSizeRangeItem/);
    assert.doesNotMatch(section, /MIME|扩展名|后缀|格式过滤/);
});

test('wires anti-recall status and helper lifecycle through matching IPC channels', () => {
    const channels = source('src/ipc-channels.js');
    const preload = source('src/preload.js');
    const main = source('src/main.js');
    for (const channel of [
        'qqnt-toolbox:get-anti-recall-status',
        'qqnt-toolbox:uninstall-closed-lid-helper',
        'qqnt-toolbox:anti-recall-status-changed'
    ]) {
        assert.match(channels, new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.match(preload, new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(main, /powerSaveBlocker\.start\('prevent-app-suspension'\)/);
    assert.match(main, /await helper\.install\(\)/);
    assert.match(main, /writeRequestSync\(false\)/);
});

test('renders configurable byte, window, capacity, whitelist, and closed-lid controls', () => {
    const renderer = source('src/renderer.js');
    assert.match(renderer, /\['B', 'KB', 'MB', 'GB'\]/);
    assert.match(renderer, /\['MINUTE', 'HOUR', 'DAY'\]/);
    assert.match(renderer, /\['MB', 'GB'\]/);
    assert.match(renderer, /allowedChatTypes: \[2\]/);
    assert.match(renderer, /antiRecallPreservation\.closedLidEnabled/);
    assert.match(renderer, /data-invalid/);
});
