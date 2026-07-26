'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'message-to-image.js'),
    'utf8'
);
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
const modulePromise = import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('sorts messages by their current visual position without duplicates', async () => {
    const { sortMessageImageElements } = await modulePromise;
    const lower = { isConnected: true, nodeType: 1, getBoundingClientRect: () => ({ top: 200, left: 20 }) };
    const upperRight = { isConnected: true, nodeType: 1, getBoundingClientRect: () => ({ top: 100, left: 300 }) };
    const upperLeft = { isConnected: true, nodeType: 1, getBoundingClientRect: () => ({ top: 100, left: 20 }) };
    const removed = { isConnected: false, nodeType: 1, getBoundingClientRect: () => ({ top: 0, left: 0 }) };

    assert.deepEqual(
        sortMessageImageElements([lower, upperRight, upperLeft, upperLeft, removed]),
        [upperLeft, upperRight, lower]
    );
});

test('formats one concise save toast from the actual output filename', async () => {
    const { getMessageImageToastPresentation } = await modulePromise;
    assert.deepEqual(
        getMessageImageToastPresentation({ filePath: 'D:\\Exports\\消息 (2).png' }),
        { message: '已保存：消息 (2).png', error: false }
    );
    assert.deepEqual(
        getMessageImageToastPresentation({
            filePath: '/tmp/消息.png',
            copied: true
        }),
        { message: '已保存并复制：消息.png', error: false }
    );
    assert.deepEqual(
        getMessageImageToastPresentation({
            filePath: '/tmp/消息.png',
            copyError: 'clipboard busy'
        }),
        { message: '已保存，但复制失败：消息.png', error: true }
    );
});

test('reads sender QQ number and nickname for filename placeholders', async () => {
    const { getMessageImageSenderMetadata } = await modulePromise;
    const message = {
        closest: () => null,
        querySelectorAll: () => [],
        querySelector: () => null
    };
    assert.deepEqual(getMessageImageSenderMetadata(message, {
        senderUin: '12345678',
        sendMemberName: '群名片'
    }), {
        qqNumber: '12345678',
        nickname: '群名片'
    });
});

test('uses sender tokens only for one sender and group tokens for mixed group messages', async () => {
    const { resolveMessageImageNamingMetadata } = await modulePromise;
    const alice = { record: { senderUin: '12345678' }, metadata: {
        qqNumber: '12345678', nickname: 'Alice'
    } };
    const aliceAgain = { record: { senderUin: '12345678' }, metadata: {
        qqNumber: '12345678', nickname: '群名片 Alice'
    } };
    const bob = { record: { senderUin: '23456789' }, metadata: {
        qqNumber: '23456789', nickname: 'Bob'
    } };

    assert.deepEqual(resolveMessageImageNamingMetadata([alice, aliceAgain], {
        groupNumber: '87654321', groupName: '测试群'
    }), {
        qqNumber: '12345678',
        nickname: 'Alice',
        groupNumber: '',
        groupName: ''
    });
    assert.deepEqual(resolveMessageImageNamingMetadata([alice, bob], {
        groupNumber: '87654321', groupName: '测试群'
    }), {
        qqNumber: '',
        nickname: '',
        groupNumber: '87654321',
        groupName: '测试群'
    });
});

test('renders the message container instead of its time and selection wrapper', async () => {
    const { getMessageImageContentElement } = await modulePromise;
    const content = { id: 'content' };
    const message = {
        matches: () => false,
        querySelector: selector => selector === '.message-container' ? content : null
    };
    const fallback = {
        matches: () => false,
        querySelector: () => null
    };

    assert.equal(getMessageImageContentElement(message), content);
    assert.equal(getMessageImageContentElement(fallback), fallback);
    assert.equal(getMessageImageContentElement(null), null);
});

test('converts CSS color functions to html2canvas-compatible rgba values', async () => {
    const { normalizeUnsupportedCssColors } = await modulePromise;
    const writes = [];
    const child = {
        style: { setProperty: (...args) => writes.push(args) }
    };
    const surface = {
        style: { setProperty: (...args) => writes.push(args) },
        querySelectorAll: () => [child]
    };
    const context = {
        fillStyle: '',
        clearRect() {},
        fillRect() {},
        getImageData: () => ({ data: new Uint8ClampedArray([120, 80, 40, 128]) })
    };
    const documentRef = {
        createElement: () => ({
            width: 0,
            height: 0,
            getContext: () => context
        })
    };
    const windowRef = {
        getComputedStyle: element => ({
            getPropertyValue: property =>
                element === child && property === 'color'
                    ? 'color(display-p3 0.5 0.3 0.1)'
                    : 'rgb(0, 0, 0)'
        })
    };

    assert.equal(normalizeUnsupportedCssColors(surface, windowRef, documentRef), 1);
    assert.deepEqual(writes, [[
        'color',
        'rgba(120, 80, 40, 0.502)',
        'important'
    ]]);
});

test('flattens translucent QQ theme colors when chat background is omitted', async () => {
    const { normalizeUnsupportedCssColors } = await modulePromise;
    const writes = [];
    let fillStyle = '';
    const context = {
        clearRect() {},
        fillRect() {},
        get fillStyle() { return fillStyle; },
        set fillStyle(value) { fillStyle = value; },
        getImageData: () => ({
            data: fillStyle === 'rgb(20, 20, 20)'
                ? new Uint8ClampedArray([20, 20, 20, 255])
                : fillStyle === 'rgba(255, 255, 255, 0.05)'
                    ? new Uint8ClampedArray([255, 255, 255, 13])
                    : new Uint8ClampedArray([0, 0, 0, 0])
        })
    };
    const element = { style: { setProperty: (...args) => writes.push(args) } };
    const surface = {
        style: { setProperty: (...args) => writes.push(args) },
        querySelectorAll: () => [element]
    };
    const documentRef = {
        createElement: () => ({ getContext: () => context })
    };
    const windowRef = {
        getComputedStyle: target => ({
            getPropertyValue: property =>
                target === element && property === 'background-color'
                    ? 'rgba(255, 255, 255, 0.05)'
                    : 'transparent'
        })
    };

    assert.equal(normalizeUnsupportedCssColors(surface, windowRef, documentRef, {
        matteColor: 'rgb(20, 20, 20)'
    }), 1);
    assert.deepEqual(writes, [[
        'background-color',
        'rgba(32, 32, 32, 1)',
        'important'
    ]]);
});

test('crops transparent outer pixels from the rendered message image', async () => {
    const { cropTransparentCanvas } = await modulePromise;
    const width = 5;
    const height = 4;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 1; y <= 2; y += 1) {
        for (let x = 1; x <= 3; x += 1) {
            pixels[(y * width + x) * 4 + 3] = 255;
        }
    }
    let drawArgs = null;
    const output = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: (...args) => { drawArgs = args; } })
    };
    const canvas = {
        width,
        height,
        getContext: () => ({ getImageData: () => ({ data: pixels }) }),
        ownerDocument: { createElement: () => output }
    };

    const result = cropTransparentCanvas(canvas);

    assert.equal(result, output);
    assert.deepEqual({ width: result.width, height: result.height }, { width: 3, height: 2 });
    assert.deepEqual(drawArgs.slice(1), [1, 1, 3, 2, 0, 0, 3, 2]);
});

test('crops an opaque chat background to previously measured message bounds', async () => {
    const { cropCanvasToBounds } = await modulePromise;
    let drawArgs = null;
    const output = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: (...args) => { drawArgs = args; } })
    };
    const canvas = {
        width: 10,
        height: 6,
        ownerDocument: { createElement: () => output }
    };

    const result = cropCanvasToBounds(canvas, { left: 2, top: 1, right: 7, bottom: 4 });

    assert.equal(result, output);
    assert.deepEqual({ width: result.width, height: result.height }, { width: 6, height: 4 });
    assert.deepEqual(drawArgs.slice(1), [2, 1, 6, 4, 0, 0, 6, 4]);
});

test('aligns canvas text without moving message containers or media', async () => {
    const { installCanvasTextAlignment } = await modulePromise;
    const calls = [];
    const originalFillText = (...args) => calls.push(['fill', ...args]);
    const originalStrokeText = (...args) => calls.push(['stroke', ...args]);
    const context = {
        fillText: originalFillText,
        strokeText: originalStrokeText
    };
    const restore = installCanvasTextAlignment({ getContext: () => context }, -1);

    context.fillText('文字', 20, 30);
    context.strokeText('描边', 40, 50, 120);
    assert.deepEqual(calls, [
        ['fill', '文字', 20, 29],
        ['stroke', '描边', 40, 49, 120]
    ]);

    restore();
    assert.equal(context.fillText, originalFillText);
    assert.equal(context.strokeText, originalStrokeText);
});

test('removes reactions and the complete QQ essence badge in message-only mode', async () => {
    const { removeMessageAddons } = await modulePromise;
    const removed = [];
    const reaction = { remove: () => removed.push('reaction') };
    const essenceBadge = {
        textContent: '💧 精华',
        parentElement: null,
        remove: () => removed.push('essence')
    };
    const essenceIcon = {
        textContent: '',
        parentElement: essenceBadge,
        closest: () => null,
        remove: () => removed.push('icon')
    };
    const root = {
        querySelectorAll: selector => selector.includes('img[src*="essence"')
            ? [essenceIcon]
            : [reaction]
    };

    removeMessageAddons(root);

    assert.deepEqual(removed.sort(), ['essence', 'reaction']);
});

test('uses a positive message-only setting and migrates the retired reaction setting', () => {
    assert.match(rendererSource, /text\('仅包含消息'\)/);
    assert.match(rendererSource, /messageTweaks\.messageToImageOnlyMessage/);
    assert.match(mainSource, /messageToImageOnlyMessage\s*=\s*!messageTweaks\.messageToImageIncludeReactions/);
    assert.match(mainSource, /delete messageTweaks\.messageToImageIncludeReactions/);
    assert.match(mainSource, /LEGACY_MESSAGE_IMAGE_FILE_NAME_PATTERNS/);
    assert.match(mainSource, /messageToImageFileNamePattern\s*=\s*DEFAULT_MESSAGE_IMAGE_FILE_NAME_PATTERN/);
    assert.doesNotMatch(rendererSource, /messageToImageIncludeReactions|text\('包含表情回应'\)/);
});

test('keeps background whitespace as an opt-in child setting', () => {
    assert.match(mainSource, /messageToImageIncludeBackgroundWhitespace:\s*false/);
    assert.match(rendererSource, /text\('包含背景留白'\)/);
    assert.match(rendererSource, /includeBackgroundWhitespace:\s*\(\)\s*=>/);
    assert.match(source, /withBackground\s*&&\s*includeBackgroundWhitespace\(\)/);
    assert.match(source, /getCanvasAlphaBounds\(contentCanvas,\s*\{ margin \}\)/);
});

test('passes resolved sender or group metadata to the save payload', () => {
    assert.match(source, /resolveMessageImageNamingMetadata/);
    assert.match(source, /qqNumber:\s*namingMetadata\.qqNumber/);
    assert.match(source, /nickname:\s*namingMetadata\.nickname/);
    assert.match(source, /groupNumber:\s*namingMetadata\.groupNumber/);
    assert.match(source, /groupName:\s*namingMetadata\.groupName/);
    assert.match(rendererSource, /getSenderMetadata:\s*getMessageImageFileNameMetadata/);
    assert.match(rendererSource, /getGroupMetadata:\s*getMessageImageGroupMetadata/);
});

test('recognizes QQ native checked markers without relying on the gray row overlay', async () => {
    const { isNativeSelectionMarkerChecked } = await modulePromise;
    const emptyAttributes = { getAttribute: () => null, className: '', querySelectorAll: () => [] };
    const inputMarker = {
        ...emptyAttributes,
        matches: () => false,
        querySelector: selector => selector === 'input' ? { checked: true } : null
    };
    const ariaMarker = {
        ...emptyAttributes,
        matches: () => false,
        getAttribute: name => name === 'aria-checked' ? 'true' : null,
        querySelector: () => null
    };
    const visualMarker = {
        ...emptyAttributes,
        matches: () => false,
        querySelector: selector => selector === 'input' ? null : {}
    };
    const uncheckedMarker = {
        ...emptyAttributes,
        matches: () => false,
        querySelector: () => null
    };
    const windowRef = {
        getComputedStyle: marker => ({
            backgroundColor: marker === visualMarker ? 'rgb(204, 111, 190)' : 'transparent'
        })
    };

    assert.equal(isNativeSelectionMarkerChecked(inputMarker, windowRef), true);
    assert.equal(isNativeSelectionMarkerChecked(ariaMarker, windowRef), true);
    assert.equal(isNativeSelectionMarkerChecked(visualMarker, windowRef), true);
    assert.equal(isNativeSelectionMarkerChecked(uncheckedMarker, windowRef), false);
});

test('finds one visible QQ multi-select toolbar and ignores hidden duplicate actions', async () => {
    const { findNativeMultiSelectToolbar, findNativeMultiSelectToolbarHosts } = await modulePromise;
    const body = {};
    const toolbar = {
        parentElement: body,
        contains: element => element === toolbar || element.parentElement === toolbar,
        getBoundingClientRect: () => ({ width: 720, height: 120, bottom: 900 })
    };
    const hiddenToolbar = {
        parentElement: body,
        contains: element => element === hiddenToolbar || element.parentElement === hiddenToolbar,
        getBoundingClientRect: () => ({ width: 720, height: 120, bottom: 900 })
    };
    const labels = ['逐条转发', '合并转发', '保存至电脑', '收藏', '删除', '复制'];
    const createNodes = (parent, visible) => labels.map(label => ({
        nodeValue: label,
        parentElement: {
            parentElement: parent,
            closest: () => null,
            contains(element) { return element === this; },
            getBoundingClientRect: () => ({ width: visible ? 72 : 0, height: visible ? 24 : 0 })
        }
    }));
    const nodes = [...createNodes(hiddenToolbar, false), ...createNodes(toolbar, true)];
    const documentRef = {
        body,
        createTreeWalker: () => {
            let index = 0;
            return { nextNode: () => nodes[index++] || null };
        }
    };

    const result = findNativeMultiSelectToolbar(documentRef, {
        innerHeight: 1000,
        getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
    });

    assert.equal(result.toolbar, toolbar);
    assert.equal(result.labels.size, labels.length);
    assert.deepEqual(
        new Set(findNativeMultiSelectToolbarHosts(documentRef, {
            innerHeight: 1000,
            getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
        }).map(item => item.toolbar)),
        new Set([hiddenToolbar, toolbar])
    );
});

test('renders cleaned DOM clones and has no custom multi-select overlay or window capture path', () => {
    assert.match(source, /backgroundColor:\s*null/);
    assert.match(source, /\.plus-one-btn/);
    assert.match(source, /\[class\*="reaction" i\]/);
    assert.match(source, /\[class\*="essence" i\]/);
    assert.match(source, /MESSAGE_ONLY_CLASS/);
    assert.match(source, /if \(messageOnly\)/);
    assert.doesNotMatch(source, /includeReactions|INCLUDE_REACTIONS_CLASS/);
    assert.match(source, /findNativeMultiSelectToolbar/);
    assert.match(source, /qqnt-toolbox-message-to-image-toolbar-button/);
    assert.match(source, /\.message-container\s*\{[\s\S]*?background-color:\s*transparent\s*!important/);
    assert.match(source, /labels\.get\('合并转发'\)/);
    assert.match(source, /toolbarStateObserver\.observe\(stateSource/);
    assert.match(source, /toolbarVisibilityObserver\.observe\(target/);
    assert.match(source, /attributeFilter:\s*\['aria-hidden', 'class', 'hidden', 'style'\]/);
    assert.match(source, /toolbarInfo\.labels\.get\('逐条转发'\)/);
    assert.match(source, /stateSource\.action\.cloneNode\(true\)/);
    assert.doesNotMatch(source, /setTimeout\(sync, 80\)/);
    assert.doesNotMatch(source, /!hasSelection\s*\?\s*'0\.35'/);
    assert.doesNotMatch(source, /attribute\.name\.startsWith\('data-'\)/);
    assert.match(source, /loadRenderer/);
    assert.doesNotMatch(source, /^import html2canvas/m);
    assert.doesNotMatch(source, /createElement\(['"]script['"]\)|\.src\s*=\s*new URL/);
    assert.match(source, /message\.cloneNode\(false\)/);
    assert.doesNotMatch(source, /capturePage|startSelection|closeSelection/);
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/);
    assert.match(source, /documentRef\.getElementById\(TOAST_ID\)\?\.remove\(\)/);
    assert.match(source, /error \? 3200 : 2200/);
    assert.equal((source.match(/collectMessages\(scope\)/g) || []).length, 1);
});
