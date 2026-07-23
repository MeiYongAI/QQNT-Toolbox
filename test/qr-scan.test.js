'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
    expandQrScanPathCandidates,
    getOpenableQrUrl,
    isQqThumbnailPath,
    migrateQrScanConfig,
    normalizeQrScanInfos,
    summarizeQrScanValue
} = require('../src/qr-scan');

test('migrates the old inverted QR setting and removes it', () => {
    const migrated = migrateQrScanConfig({
        interfaceTweaks: {
            disableImageQrScan: true,
            inlineMediaViewer: false
        }
    });
    assert.deepEqual(migrated.interfaceTweaks, {
        activeQrScan: true,
        inlineMediaViewer: false
    });
});

test('keeps an explicit active QR setting during migration', () => {
    const migrated = migrateQrScanConfig({
        interfaceTweaks: {
            activeQrScan: false,
            disableImageQrScan: true
        }
    });
    assert.deepEqual(migrated.interfaceTweaks, { activeQrScan: false });
});

test('normalizes and deduplicates native QR scan results', () => {
    assert.deepEqual(normalizeQrScanInfos({
        infos: [
            { text: ' https://example.com ', format: 'QR_CODE', charset: 'UTF-8' },
            { text: 'https://example.com', format: 'QR_CODE' },
            { text: 'plain text', format: 'QR_CODE' },
            { text: '   ' }
        ]
    }), [
        { text: 'https://example.com', format: 'QR_CODE', charset: 'UTF-8' },
        { text: 'plain text', format: 'QR_CODE', charset: '' }
    ]);
});

test('normalizes QR results nested in the native IPC payload', () => {
    assert.deepEqual(normalizeQrScanInfos({
        payload: {
            result: {
                infos: [{ text: 'nested result', format: 'QR_CODE' }]
            }
        }
    }), [{ text: 'nested result', format: 'QR_CODE', charset: '' }]);
    assert.deepEqual(normalizeQrScanInfos([
        { text: 'direct result', format: 'QR_CODE', charset: 'UTF-8' }
    ]), [{ text: 'direct result', format: 'QR_CODE', charset: 'UTF-8' }]);
});

test('normalizes QR results wrapped in arrays and maps', () => {
    assert.deepEqual(normalizeQrScanInfos([
        { result: [{ infos: [{ text: 'array wrapped', format: 'QR_CODE' }] }] }
    ]), [{ text: 'array wrapped', format: 'QR_CODE', charset: '' }]);

    assert.deepEqual(normalizeQrScanInfos(new Map([
        ['result', new Map([
            ['infos', [new Map([
                ['text', 'map wrapped'],
                ['charset', 'UTF-8']
            ])]]
        ])]
    ])), [{ text: 'map wrapped', format: '', charset: 'UTF-8' }]);
});

test('summarizes native QR results without logging decoded text', () => {
    const summary = summarizeQrScanValue({
        result: [{ infos: [{ text: 'private QR contents', format: 'QR_CODE' }] }]
    });
    const serialized = JSON.stringify(summary);

    assert.match(serialized, /infos/);
    assert.match(serialized, /array/);
    assert.doesNotMatch(serialized, /private QR contents/);
});

test('prefers the QQ original image over its thumbnail', () => {
    const thumbnail = 'D:\\Tencent Files\\10000\\nt_qq\\nt_data\\Pic\\2026-07\\Thumb\\aabb_720.jpg';
    const original = 'D:\\Tencent Files\\10000\\nt_qq\\nt_data\\Pic\\2026-07\\Ori\\aabb.jpg';

    assert.equal(isQqThumbnailPath(thumbnail), true);
    assert.deepEqual(expandQrScanPathCandidates([thumbnail, original]), [original, thumbnail]);
});

test('does not intercept QQ native QR detection', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

    assert.doesNotMatch(mainSource, /command\.cmdName === QR_SCAN_COMMAND/);
    assert.doesNotMatch(mainSource, /replyWithEmptyQrResult|manualQrScanAllowances/);
});

test('only accepts HTTP URLs from QR results', () => {
    assert.equal(getOpenableQrUrl('https://example.com/path'), 'https://example.com/path');
    assert.equal(getOpenableQrUrl('mqqapi://card/show_pslcard'), '');
    assert.equal(getOpenableQrUrl('not a url'), '');
});

test('uses an in-page QR result dialog that follows QQ theme variables', () => {
    const root = path.join(__dirname, '..', 'src');
    const dialogSource = fs.readFileSync(path.join(root, 'qr-result-dialog.js'), 'utf8');
    const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    const rendererSource = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
    const viewerHtml = fs.readFileSync(path.join(root, 'media-viewer.html'), 'utf8');
    const qrIconSource = rendererSource.slice(
        rendererSource.indexOf('function createQrCodeIcon'),
        rendererSource.indexOf('function getQrImageSources')
    );

    assert.match(dialogSource, /--bg_top_light/);
    assert.match(dialogSource, /--brand_standard/);
    assert.match(dialogSource, /--overlay_mask_dark/);
    assert.match(rendererSource, /qqntToolboxQrDialog\?\.show/);
    assert.match(viewerHtml, /qr-result-dialog\.js/);
    assert.match(qrIconSource, /stroke', 'currentColor'/);
    assert.doesNotMatch(qrIconSource, /M8 3H5/);
    assert.match(mainSource, /handleQrResultAction\(event, payload\)/);
    assert.match(mainSource, /isToolboxMediaViewerSender\(event\?\.sender\)\) \{\s*hideMediaViewer\(\);\s*clearMediaViewerSession\(\);/);
});
