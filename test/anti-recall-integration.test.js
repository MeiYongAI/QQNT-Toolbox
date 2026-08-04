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
    const intake = main.slice(main.indexOf('function processAntiRecallPreservationIntake'), main.indexOf('function getRecallPicOriginalSourcePath'));
    assert.ok(intake.indexOf('!imageTargets.length && !fileTargets.length') < intake.indexOf('observeCandidate'));
});

test('keeps archived asset paths on later full-message updates after recovery', () => {
    const main = source('src/main.js');
    const start = main.indexOf('function preserveRecoveredRecallMetadata');
    const end = main.indexOf('function processPreventRecall', start);
    const preserve = main.slice(start, end);
    assert.match(preserve, /getPicSourcePath/);
    assert.match(preserve, /getArchivedRecallFilePath/);
    assert.match(preserve, /applyAssetPath/);
});

test('reserves staging capacity before invoking the QQ native acquisition route', () => {
    const main = source('src/main.js');
    const queue = main.slice(main.indexOf('function queuePreservationAsset'), main.indexOf('function resumeRecallStaging'));
    assert.ok(queue.indexOf('beginAssetAcquisition') >= 0);
    assert.ok(queue.indexOf('isPreservationFileAssetEligible') >= 0);
    assert.ok(queue.indexOf('isPreservationFileAssetEligible') < queue.indexOf('beginAssetAcquisition'));
    assert.ok(queue.indexOf('resolvePreservationAssetSource') > queue.indexOf('beginAssetAcquisition'));
    assert.match(main, /nodeIKernelMsgService\/downloadRichMedia/);
    assert.match(queue, /admission\.acquisitionPath/);
    assert.match(queue, /adoptOwnedAcquisition/);
    assert.match(queue, /failAssetAcquisition/);
    assert.match(source('src/anti-recall-staging.js'), /asset\.kind === 'file'[\s\S]*getAcquisitionPath/);
});

test('projects archived files into QQ native completed state and native file actions', () => {
    const staging = source('src/anti-recall-staging.js');
    const main = source('src/main.js');
    const apply = staging.slice(staging.indexOf('function applyAssetPath'), staging.indexOf('class AntiRecallStaging'));
    assert.match(apply, /media\.transferStatus = 4/);
    assert.match(apply, /media\.progress = 0/);
    assert.match(apply, /media\.invalidState = 0/);
    assert.match(apply, /record\.qqnt_toolbox_archived_files/);
    const fileBranch = apply.slice(apply.indexOf('Keep the plugin path'));
    assert.match(fileBranch, /media\.filePath = targetPath/);
    assert.doesNotMatch(fileBranch, /media\.(?:sourcePath|originPath|localPath|path) = targetPath/);
    assert.match(main, /function loadPersistedRecallCache[\s\S]*normalizeArchivedRecallFileStates\(record, recallState\)/);
    assert.match(main, /function getRecoveredRecallRecord[\s\S]*normalizeArchivedRecallFileStates\(recovered, recallState\)/);
    const renderer = source('src/renderer.js');
    assert.doesNotMatch(renderer, /qqnt-toolbox-archive-ready-badge/);
    assert.doesNotMatch(renderer, /ArchivedRecallFile|archived-recall-file|runArchivedRecallFileAction/);
    assert.doesNotMatch(renderer, /在 Finder 中显示归档文件|toolbox:(?:open|reveal)-archived-file/);
    assert.doesNotMatch(source('src/preload.js'), /runArchivedRecallFileAction|archived-recall-file-action/);
    assert.doesNotMatch(source('src/ipc-channels.js'), /ARCHIVED_RECALL_FILE_ACTION|archived-recall-file-action/);
    assert.doesNotMatch(main, /runArchivedRecallFileAction|archive-file-(?:opened|revealed|action-rejected)/);
});

test('loads the recall viewer without network-blocking image resolution and opens archived files by record identity', () => {
    const main = source('src/main.js');
    const projection = source('src/recall-viewer-data.js');
    const preload = source('src/recall-viewer-preload.js');
    assert.match(main, /buildRecallViewerData\(records\)/);
    assert.doesNotMatch(projection, /resolveRecallImageUrl\(/);
    assert.match(projection, /getImmediateRecallImageUrl/);
    assert.match(preload, /invokeWithTimeout\(CHANNEL_GET_RECALL_VIEWER_DATA\)/);
    assert.match(main, /function openRecallViewerFile[\s\S]*recallViewerRecordIndex\.get\(msgId\)/);
    const viewer = source('src/recall-viewer.js');
    const viewerHtml = source('src/recall-viewer.html');
    assert.match(viewerHtml, /搜索群名、QQ号或文件名/);
    assert.match(viewer, /part\.name, part\.text, part\.title/);
    assert.match(viewer, /`文件 \$\{fileCount\}`/);
});

test('clears the complete account recall state through one canonical cache reset', () => {
    const main = source('src/main.js');
    const cacheClear = source('src/recall-cache-clear.js');
    const renderer = source('src/renderer.js');
    assert.match(main, /clearRecallAccountCache\(/);
    assert.match(cacheClear, /liveMessages\?\.clear\(\)/);
    assert.match(cacheClear, /recalledMessages\?\.clear\(\)/);
    assert.match(cacheClear, /persistedIds\?\.clear\(\)/);
    assert.match(cacheClear, /imageDownloads\?\.clear\(\)/);
    assert.match(cacheClear, /state\.staging\?\.clear\(\)/);
    assert.match(cacheClear, /fs\.rm\(account, \{ recursive: true, force: true \}\)/);
    assert.match(renderer, /撤回消息、归档图片、归档文件和暂存数据/);
});

test('isolates file preservation from slow image downloads and prioritizes recalled work', () => {
    const main = source('src/main.js');
    const queueStart = main.indexOf('function getPreservationQueue');
    const queueEnd = main.indexOf('function createRecallStaging', queueStart);
    const queue = main.slice(queueStart, queueEnd);
    assert.match(queue, /assetKind/);
    assert.match(queue, /priority/);
    assert.match(queue, /pending\.unshift/);
    assert.match(main, /enqueuePreservationTask\(recallState\.accountUin, queuedAsset\.kind/);
});

test('integrates received-file protection into anti-recall without changing its policy', () => {
    const renderer = source('src/renderer.js');
    const sectionStart = renderer.indexOf("createSection('preventRecall'");
    const sectionEnd = renderer.indexOf("createSection('entertainment'", sectionStart);
    const section = renderer.slice(sectionStart, sectionEnd);
    assert.match(section, /启用消息防撤回[\s\S]*preventRecall\.enabled/);
    assert.match(section, /群文件防撤回下载[\s\S]*receivedFileAutoDownload\.enabled/);
    assert.match(section, /receivedFileAutoDownload\.enabled/);
    assert.match(section, /manageAutoDownloadGroups/);
    assert.match(section, /createFileSizeRangeItem/);
    assert.match(section, /openRecallDir/);
    assert.doesNotMatch(renderer, /createSection\('receivedFiles'/);
    assert.doesNotMatch(section, /MIME|扩展名|后缀|格式过滤/);
    assert.match(renderer, /#\$\{PANEL_ID\} \.qqnt-toolbox-item\[data-file-size-range-item="true"\] \{\s*flex-direction: column;\s*align-items: stretch;\s*gap: 6px;/);
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
