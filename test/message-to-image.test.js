'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'message-to-image.js'),
    'utf8'
);
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
    assert.equal((source.match(/collectMessages\(scope\)/g) || []).length, 1);
});
