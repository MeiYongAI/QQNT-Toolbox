'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsPromises = require('node:fs').promises;
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const silkWasmEntry = require.resolve('silk-wasm');
delete require.cache[silkWasmEntry];
const {
    estimateSilkDurationMs,
    makePcm16Wav
} = require('../src/voice/media');
const injectedVoiceFileSenderUi = require('../src/voice/renderer-controller');

function loadVoiceLibraryTestApi(dataDir) {
    const modulePath = path.join(__dirname, '..', 'src', 'voice-file-sender.js');
    const source = fs.readFileSync(modulePath, 'utf8').replace(
        'module.exports = {',
        `module.exports = {\n    __libraryTest: {\n        ensureLibraryDirs,\n        getLibraryVoiceDir,\n        createLibraryFolder,\n        getLibraryFolders,\n        getLibraryItems,\n        moveLibraryItem,\n        renameLibraryItem,\n        deleteLibraryItem,\n        readLibraryIndex,\n        encodeLibraryItemId\n    },`
    );
    const testModule = new Module(modulePath, module);
    testModule.filename = modulePath;
    testModule.paths = Module._nodeModulePaths(path.dirname(modulePath));
    const normalRequire = testModule.require.bind(testModule);
    testModule.require = request => {
        if (request === 'electron') {
            return {
            app: { getPath: () => dataDir },
            BrowserWindow: { getAllWindows: () => [] },
            dialog: {},
            ipcMain: { emit() {}, listeners: () => [] }
            };
        }
        if (request === './native-ipc') {
            return {
                addNativeRequestHandler() {},
                isNativeFailure: () => false,
                qqNativeInvoke: async () => null,
                unwrapNativeValue: value => value
            };
        }
        return normalRequire(request);
    };
    testModule._compile(source, modulePath);
    return testModule.exports.__libraryTest;
}

async function withVoiceLibraryTestApi(run) {
    const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'qqnt-toolbox-voice-library-'));
    const dataDir = path.join(root, 'data');
    const previousLiteLoader = global.LiteLoader;
    await fsPromises.mkdir(dataDir, { recursive: true });
    global.LiteLoader = {
        plugins: {
            qqnt_toolbox: { path: { data: dataDir } }
        }
    };
    try {
        return await run(loadVoiceLibraryTestApi(dataDir), { root, dataDir });
    } finally {
        global.LiteLoader = previousLiteLoader;
        await fsPromises.rm(root, { recursive: true, force: true });
    }
}

test('loads voice media helpers without eagerly loading silk-wasm', () => {
    assert.equal(require.cache[silkWasmEntry], undefined);
});

test('does not retain unused voice send waiters or delayed Silk cleanup timers', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'voice-file-sender.js'), 'utf8');

    assert.doesNotMatch(source, /createNativeEventWaiter/);
    assert.doesNotMatch(source, /setTimeout\(\(\) => \{\s*fs\.unlink\(silkPath\)/);
    assert.match(source, /await fs\.unlink\(silkPath\)\.catch/);
});

test('defers missing library durations and virtualizes large libraries', () => {
    const senderSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'voice-file-sender.js'), 'utf8');
    const listSource = senderSource.match(/async function getLibraryItems\([\s\S]*?\n}\n\nfunction toLibraryViewItems/)[0];
    const panelSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'voice', 'library-panel.js'), 'utf8');
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'voice', 'renderer-controller.js'), 'utf8');

    assert.doesNotMatch(listSource, /await detectLibraryDurationSeconds/);
    assert.match(senderSource, /const LIBRARY_DURATION_CONCURRENCY = 2;/);
    assert.match(senderSource, /function createLibraryIndexLookup\(/);
    assert.match(senderSource, /function queueLibraryDurationRefresh\(/);
    assert.match(senderSource, /persistLibraryDurationUpdates/);
    assert.match(senderSource, /async function countSupportedLibraryEntries\(/);
    assert.match(listSource, /const folderItems = await Promise\.all\(/);
    assert.match(senderSource, /MEDIA_EXTENSION_SET\.has\(extension\) \|\| !extension/);
    assert.doesNotMatch(senderSource, /function countSupportedLibraryEntries[\s\S]*?fsSync\.readdirSync/);
    assert.match(panelSource, /const LIST_RENDER_OVERSCAN = 8;/);
    assert.match(panelSource, /const LIST_MIN_RENDER_COUNT = 24;/);
    assert.match(panelSource, /function getListRenderRange\(/);
    assert.match(panelSource, /function renderListWindow\(/);
    assert.match(panelSource, /qvlib-list-spacer-top/);
    assert.match(panelSource, /qvlib-list-spacer-bottom/);
    assert.match(panelSource, /state\.items\.length - end/);
    assert.match(panelSource, /list\.replaceChildren\(fragment\)/);
    assert.match(panelSource, /list\.addEventListener\('scroll', handleListScroll, \{ passive: true \}\)/);
    assert.match(panelSource, /state\.listRenderFrame = requestAnimationFrame/);
    assert.match(panelSource, /function haveSameLibraryRows\(/);
    assert.match(panelSource, /function updateRenderedListMetadata\(/);
    assert.match(panelSource, /if \(state\.dragging \|\| state\.pendingLibraryFrame\)/);
    assert.match(panelSource, /schedulePendingLibraryFlush\(\);/);
    assert.doesNotMatch(panelSource, /function appendListRows|renderedItemCount/);
    assert.match(panelSource, /function updateLibraryItems\(/);
    assert.match(rendererSource, /bridge\.updateLibraryItems = payload => libraryPanel\.updateLibraryItems\?\.\(payload\);/);
});

test('renders the voice library as a direct file browser with contextual actions', () => {
    const senderSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'voice-file-sender.js'), 'utf8');
    const panelSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'voice', 'library-panel.js'), 'utf8');
    const styleSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'voice', 'panel-style.js'), 'utf8');

    assert.match(panelSource, /const ICON_PATHS = Object\.freeze\(/);
    const clockFormatterSource = panelSource.match(/function formatClockTime\(seconds\) \{[\s\S]*?\n    \}/)[0];
    const formatClockTime = new Function(`${clockFormatterSource}\nreturn formatClockTime;`)();
    assert.equal(formatClockTime(3), '00:03');
    assert.equal(formatClockTime(62), '01:02');
    assert.equal(formatClockTime(3600), '60:00');
    assert.doesNotMatch(panelSource, /\$\{value\}\\u79d2|'0:00'/);
    assert.match(panelSource, /const ESTIMATED_LIST_ROW_HEIGHT = 55;/);
    assert.match(panelSource, /isFolder \? 'openFolder' : 'previewLibrary'/);
    assert.match(panelSource, /createIcon\(isFolder \? 'folder' : 'fileAudio'\)/);
    assert.match(panelSource, /chevronLeft: '<path d="m15 18-6-6 6-6"\/>',/);
    assert.match(panelSource, /createIconButton\('chevronLeft', 'backFolder'/);
    assert.doesNotMatch(panelSource, /arrowLeft/);
    assert.doesNotMatch(panelSource, /chevronRight|qvlib-chevron/);
    assert.doesNotMatch(panelSource, /pending:\s*'\\u5f85\\u8f6c\\u6362'/);
    assert.match(panelSource, /function getItemMetaText\(item\) \{[\s\S]*?return formatDuration\(item\.duration\);[\s\S]*?\}/);
    assert.doesNotMatch(panelSource, /\[TEXT\.open,\s*'openFolder'/);
    assert.match(panelSource, /more\.setAttribute\('aria-haspopup', 'menu'\)/);
    assert.match(panelSource, /menu\.setAttribute\('role', 'menu'\)/);
    assert.match(panelSource, /\[TEXT\.send, 'sendLibrary', 'send'/);
    assert.match(panelSource, /\[TEXT\.move, 'moveLibrary', 'moveTo'/);
    assert.match(panelSource, /\[TEXT\.remove, 'deleteLibrary', 'delete'/);
    assert.match(panelSource, /function showCreateFolderDialog\(\)/);
    assert.match(panelSource, /function showMoveDialog\(item\)/);
    assert.match(panelSource, /Array\.isArray\(dialogOptions\.selectOptions\)/);
    assert.match(panelSource, /createIconButton\('folderPlus', 'createFolder'/);
    assert.match(panelSource, /type: 'createLibraryFolder', title/);
    assert.match(panelSource, /type: 'moveLibrary',[\s\S]*?targetFolder,[\s\S]*?selectedItemId: state\.selectedItemId/);
    assert.match(panelSource, /type: 'renameLibrary',[\s\S]*?selectedItemId: state\.selectedItemId/);
    assert.match(panelSource, /deleteFolderMessage/);
    assert.match(panelSource, /function selectionIsAffectedBy\(item\)/);
    assert.match(panelSource, /createIconButton\('send', 'sendSelected'/);
    assert.match(panelSource, /more: '<circle cx="12" cy="5" r="1"\/>/);
    assert.match(panelSource, /selectedItem: null/);
    assert.match(panelSource, /folders: \[\]/);
    assert.match(panelSource, /const item = state\.selectedItem;/);
    assert.match(panelSource, /selectedActionItem = state\.selectedItem;/);
    assert.match(panelSource, /state\.selectedItem\.parentPath[\s\S]*?state\.folder/);
    assert.match(panelSource, /const refreshedItem = getItem\(state\.selectedItemId\);[\s\S]*?parentPath: refreshedItem\.parentPath \?\? state\.folder/);
    assert.match(panelSource, /function isAudioPlaying\(audio\)/);
    assert.match(panelSource, /function resetPlayer\(\)/);
    assert.match(panelSource, /String\(payload\.id \|\| ''\) !== state\.selectedItemId/);
    assert.match(panelSource, /function syncPlayingRows\(\)/);
    assert.match(panelSource, /syncPlayer\(\)[\s\S]*?syncPlayingRows\(\);/);
    assert.match(panelSource, /qvlib-playing-indicator/);
    assert.match(panelSource, /const listFrame = createElement\('div', 'qvlib-list-frame'\)/);
    assert.match(panelSource, /createElement\('div', 'qvlib-list qqnt-toolbox-scrollable'\)/);
    assert.doesNotMatch(panelSource, /qvlib-scrollbar|syncScrollbar|installScrollbar/);
    assert.match(panelSource, /function handleListScroll\(\) \{[\s\S]*?closeItemMenu\(\);/);
    assert.match(panelSource, /list\.addEventListener\('scroll', handleListScroll, \{ passive: true \}\)/);
    assert.match(panelSource, /else if \(closeItemMenu\(true\)\)/);
    assert.match(panelSource, /menu\.addEventListener\('focusout'/);
    assert.match(panelSource, /row\?\.classList\.add\('is-menu-open'\)/);
    assert.match(panelSource, /hasPointerPosition \? event : null/);
    assert.match(panelSource, /function releasePointerActionFocus\(\)/);
    assert.match(panelSource, /root\.addEventListener\('pointerleave',[\s\S]*?is-pointer-outside[\s\S]*?releasePointerActionFocus\(\)/);
    assert.match(panelSource, /state\.windowBlurHandler = \(\) => \{[\s\S]*?closeItemMenu\(\);[\s\S]*?releasePointerActionFocus\(\);/);

    assert.match(styleSource, /\.qvlib-row\.is-folder \.qvlib-item-icon/);
    assert.match(styleSource, /\.qvlib-row\.is-file \.qvlib-item-icon/);
    assert.match(styleSource, /\.qvlib-row:hover \.qvlib-actions/);
    assert.match(styleSource, /\.qvlib-row:has\(\.qvlib-more:focus-visible\) \.qvlib-actions/);
    assert.doesNotMatch(styleSource, /\.qvlib-row:focus-within \.qvlib-actions/);
    assert.match(styleSource, /\.qvlib-row\.is-menu-open \.qvlib-actions/);
    assert.match(styleSource, /\.is-pointer-outside \.qvlib-row:not\(\.is-menu-open\) \.qvlib-actions/);
    assert.match(styleSource, /\.qvlib-list \{[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;[\s\S]*?overflow-anchor: none;/);
    assert.match(styleSource, /\.qvlib-list-frame \{[\s\S]*?position: relative;/);
    assert.doesNotMatch(styleSource, /\.qvlib-list::\-webkit-scrollbar|scrollbar-width:/);
    assert.doesNotMatch(styleSource, /qvlib-scrollbar-thumb|\.qvlib-scrollbar\s*\{/);
    assert.match(styleSource, /\.qvlib-list-spacer \{[\s\S]*?pointer-events: none;/);
    assert.match(styleSource, /\.qvlib-row \{[\s\S]*?margin-inline: 4px;/);
    assert.match(styleSource, /\.qvlib-row \{[\s\S]*?height: 55px;/);
    assert.match(styleSource, /\.qvlib-row \{[\s\S]*?overflow: hidden;[\s\S]*?border-radius: 6px;/);
    assert.match(styleSource, /\.qvlib-row\.is-playing \.qvlib-playing-indicator/);
    assert.match(styleSource, /\.qvlib-primary \{[\s\S]*?font: inherit;/);
    assert.match(styleSource, /\.qvlib-name \{[\s\S]*?line-height: 19px;/);
    assert.match(styleSource, /\.qvlib-meta \{[\s\S]*?line-height: 15px;/);
    assert.match(styleSource, /\.qvlib-shell \{[\s\S]*?transform: translate3d\(0, 0, 0\);[\s\S]*?will-change: transform;/);
    assert.match(styleSource, /@keyframes qvlib-playing-wave/);
    assert.doesNotMatch(styleSource, /\.qvlib-row\.is-selected \{/);
    assert.match(styleSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.qvlib-playing-bar/);
    assert.match(styleSource, /@media \(hover: none\)/);
    assert.match(styleSource, /\.qvlib-item-menu \{\s*position: absolute;/);
    assert.match(styleSource, /\.qvlib-dialog input,[\s\S]*?\.qvlib-dialog select/);
    assert.doesNotMatch(styleSource, /\.qvlib-chevron/);
    assert.match(senderSource, /id: previewItem\.id,[\s\S]*?previewUrl:/);
    assert.match(senderSource, /async function getLibraryFolders\(\)/);
    assert.match(senderSource, /async function createLibraryFolder\(/);
    assert.match(senderSource, /async function moveLibraryItem\(/);
    assert.match(senderSource, /for \(const directoryPath of \[getPluginDataDir\(\), getLibraryDir\(\), getLibraryVoiceDir\(\)\]\)/);
    assert.match(senderSource, /itemLstat\.isSymbolicLink\(\)/);
    assert.match(senderSource, /isCaseOnlyRename/);
    assert.match(senderSource, /\.qqnt-toolbox-rename-/);
    assert.match(senderSource, /changed = isCaseOnlyRename[\s\S]*?\? false[\s\S]*?: removeIndexedItemsAtPath/);
    assert.match(senderSource, /const \[items, folders\] = await Promise\.all\(/);
    assert.match(senderSource, /getLibraryFolders\(\)/);
    assert.match(senderSource, /folders,\n\s*\.\.\.extraPayload/);
    assert.match(senderSource, /action\.type === 'createLibraryFolder'/);
    assert.match(senderSource, /action\.type === 'moveLibrary'/);
    assert.match(senderSource, /action\.type === 'renameLibrary'[\s\S]*?action\.selectedItemId[\s\S]*?selectedItem:/);
});

test('rejects unsafe voice library names and relative paths', () => {
    const senderSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'voice-file-sender.js'), 'utf8');
    const nameHelpers = senderSource.slice(
        senderSource.indexOf('function normalizeFieldText'),
        senderSource.indexOf('function normalizeLibraryRelativePath')
    );
    const pathValidatorSource = senderSource.slice(
        senderSource.indexOf('function validateLibraryRelativePath'),
        senderSource.indexOf('function getLibraryAbsolutePath')
    );
    const sanitizeLibraryEntryName = new Function(
        `${nameHelpers}\nreturn sanitizeLibraryEntryName;`
    )();
    const validateLibraryRelativePath = new Function(
        'path',
        `${pathValidatorSource}\nreturn validateLibraryRelativePath;`
    )(path);

    assert.equal(sanitizeLibraryEntryName(' normal folder '), 'normal folder');
    assert.equal(sanitizeLibraryEntryName('name.  '), 'name');
    for (const invalidName of ['', '.', '..', 'CON', 'nul.txt', 'LPT9']) {
        assert.equal(sanitizeLibraryEntryName(invalidName), '');
    }
    assert.equal(validateLibraryRelativePath('', true), '');
    assert.equal(validateLibraryRelativePath('folder/child', false), 'folder/child');
    for (const invalidPath of ['../outside', 'folder//child', '/absolute', 'C:/absolute']) {
        assert.throws(() => validateLibraryRelativePath(invalidPath, true));
    }
});

test('manages voice library folders and preserves indexed files across moves', async () => {
    await withVoiceLibraryTestApi(async library => {
        await library.ensureLibraryDirs();
        const voiceRoot = library.getLibraryVoiceDir();
        await library.createLibraryFolder('', 'Folder');
        await library.createLibraryFolder('Folder', 'Child');
        const voicePath = path.join(voiceRoot, 'sample.amr');
        await fsPromises.writeFile(voicePath, Buffer.concat([
            Buffer.from([0x02]),
            Buffer.from('#!SILK_V3', 'latin1'),
            Buffer.from([0, 0])
        ]));

        const sourceItem = (await library.getLibraryItems('')).find(item => item.kind !== 'folder');
        assert.ok(sourceItem);
        await library.moveLibraryItem(sourceItem.id, 'Folder');
        assert.equal(fs.existsSync(path.join(voiceRoot, 'Folder', 'sample.amr')), true);

        const originalOpenSync = fs.openSync;
        let syncOpenCount = 0;
        fs.openSync = (...args) => {
            syncOpenCount += 1;
            return originalOpenSync(...args);
        };
        try {
            const folder = (await library.getLibraryItems('')).find(item => item.kind === 'folder');
            assert.equal(folder.count, 2);
        } finally {
            fs.openSync = originalOpenSync;
        }
        assert.equal(syncOpenCount, 0);

        const folderId = library.encodeLibraryItemId('folder', 'Folder');
        await library.renameLibraryItem(folderId, 'folder');
        const indexed = (await library.readLibraryIndex()).items.find(item => item.id === sourceItem.id);
        assert.ok(indexed);
        assert.equal(path.basename(path.dirname(indexed.path)), 'folder');
        assert.deepEqual(await library.getLibraryFolders(), ['', 'folder', 'folder/Child']);

        await library.deleteLibraryItem(library.encodeLibraryItemId('folder', 'folder'));
        assert.equal(fs.existsSync(path.join(voiceRoot, 'folder')), false);
        assert.equal((await library.readLibraryIndex()).items.some(item => item.id === sourceItem.id), false);
    });
});

test('rejects a junction used as the managed voice library root', async t => {
    await withVoiceLibraryTestApi(async (library, { root, dataDir }) => {
        const libraryDir = path.join(dataDir, 'voice', 'library');
        const externalDir = path.join(root, 'external');
        const voiceRoot = path.join(libraryDir, 'voices');
        await fsPromises.mkdir(libraryDir, { recursive: true });
        await fsPromises.mkdir(externalDir, { recursive: true });
        try {
            await fsPromises.symlink(externalDir, voiceRoot, process.platform === 'win32' ? 'junction' : 'dir');
        } catch (error) {
            if (error?.code === 'EPERM' || error?.code === 'EACCES') {
                t.skip('Creating a directory link is not permitted in this environment.');
                return;
            }
            throw error;
        }
        await assert.rejects(() => library.ensureLibraryDirs(), /root is invalid/);
        assert.deepEqual(await fsPromises.readdir(externalDir), []);
    });
});

test('uses the built-in FFmpeg resampler without requiring optional libsoxr', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'voice', 'media.js'), 'utf8');

    assert.match(source, /`aresample=\$\{TARGET_SILK_SAMPLE_RATE\}`/);
    assert.doesNotMatch(source, /resampler=soxr|precision=28/);
});

test('estimates Silk duration from complete frames', () => {
    const makeFrame = payload => {
        const size = Buffer.alloc(2);
        size.writeUInt16LE(payload.length);
        return Buffer.concat([size, payload]);
    };
    const silk = Buffer.concat([
        Buffer.from([0x02]),
        Buffer.from('#!SILK_V3', 'latin1'),
        makeFrame(Buffer.from([1, 2])),
        makeFrame(Buffer.from([3, 4, 5]))
    ]);

    assert.equal(estimateSilkDurationMs(silk), 40);
});

test('writes a valid PCM16 WAV header', () => {
    const pcm = Buffer.from([0, 0, 1, 0]);
    const wav = makePcm16Wav(pcm, 24000, 1);

    assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
    assert.equal(wav.readUInt32LE(24), 24000);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(40), pcm.length);
    assert.deepEqual(wav.subarray(44), pcm);
});

function createVoiceRendererHarness() {
    const previousGlobals = {
        window: global.window,
        document: global.document,
        Element: global.Element,
        getComputedStyle: global.getComputedStyle
    };
    const listeners = new Map();
    let extension = null;
    class MockElement {
        constructor(text = '') {
            this.innerText = text;
            this.textContent = text;
        }

        matches(selector) {
            return selector === '.q-context-menu-item';
        }
    }
    const documentMock = {
        body: new MockElement(),
        documentElement: new MockElement(),
        addEventListener(name, handler) {
            const handlers = listeners.get(name) || [];
            handlers.push(handler);
            listeners.set(name, handlers);
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        elementFromPoint: () => null
    };
    const windowMock = {
        __voiceFileSenderEnabled: true,
        __voiceFileSenderSaveInContextMenuEnabled: true,
        __voiceFileSenderForwardInContextMenuEnabled: true,
        __qqntToolboxMessageContextMenu: {
            registerExtension(value) {
                extension = value;
            }
        },
        addEventListener() {}
    };
    const panelFactory = () => ({
        close() {},
        contains: () => false,
        handleEscape() {},
        isOpen: () => false,
        open() {},
        playPreview() {},
        setLibrary() {},
        setStatus() {},
        updateLibraryItems() {},
        updatePlacement() {}
    });

    global.window = windowMock;
    global.document = documentMock;
    global.Element = MockElement;
    global.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
    const actionPromise = injectedVoiceFileSenderUi(panelFactory, '');
    return {
        actionPromise,
        extension,
        listeners,
        MockElement,
        window: windowMock,
        restore() {
            global.window = previousGlobals.window;
            global.document = previousGlobals.document;
            global.Element = previousGlobals.Element;
            global.getComputedStyle = previousGlobals.getComputedStyle;
        }
    };
}

function createVoiceMenuRequest(record, getNativeItemsForContext) {
    const originalContext = { msgRecord: record };
    const menuContext = { menuContext: originalContext };
    const menu = { _: { ctx: menuContext } };
    Object.defineProperty(menu, 'menuContext', {
        get: () => menuContext.menuContext,
        set: value => {
            menuContext.menuContext = value;
        }
    });
    return {
        menu,
        menuContext,
        originalContext,
        request: {
            menu,
            originalContext,
            context: originalContext,
            getNativeItemsForContext
        }
    };
}

test('keeps the real voice menu and binds only native forward to a text placeholder', async () => {
    const harness = createVoiceRendererHarness();
    try {
        assert.ok(harness.extension);
        const voiceRecord = {
            msgId: 'voice-message-1',
            playbackState: 'paused',
            transcription: { text: 'converted voice text' },
            elements: [{
                elementType: 4,
                pttElement: { fileName: 'voice.amr', duration: 2 }
            }]
        };
        let speechHandled = 0;
        const speechItem = {
            type: 15,
            text: '转文字',
            icon: 'native-speech-icon',
            handler: () => speechHandled++
        };
        const collectItem = { type: 8, text: '收藏' };
        const forwardedArgs = [];
        const forwardPrototype = {
            handler(...args) {
                forwardedArgs.push({ args, thisValue: this });
            },
            when: () => true
        };
        const nativeForward = Object.assign(Object.create(forwardPrototype), {
            type: 6,
            text: '转发',
            icon: 'one_by_one_forward'
        });
        const request = createVoiceMenuRequest(voiceRecord, context => {
            assert.notEqual(context, request.originalContext);
            assert.equal(context.msgRecord.msgId, voiceRecord.msgId);
            assert.equal(context.msgRecord.elements[0].elementType, 1);
            return [nativeForward];
        });

        const prepared = harness.extension.beforeOpen(request.request);
        assert.equal(prepared, request.request);
        assert.equal(prepared.context, request.originalContext);
        const transformed = harness.extension.transformItems({
            ...prepared,
            items: [speechItem, collectItem]
        });
        assert.equal(transformed.items[0], speechItem);
        assert.equal(transformed.items[0].type, 15);
        assert.notEqual(transformed.items[1], nativeForward);
        assert.equal(Object.getPrototypeOf(transformed.items[1]), forwardPrototype);
        assert.equal(transformed.items[1].type, 6);
        assert.equal(transformed.items[2], collectItem);

        const clickHandler = harness.listeners.get('click')[0];
        clickHandler({ composedPath: () => [new harness.MockElement('转文字')] });
        transformed.items[0].handler();
        assert.equal(speechHandled, 1);
        assert.equal(request.menuContext.menuContext, request.originalContext);

        const nativeContext = { sendable: true, sourceEvent: 'source-event' };
        const nativeEvent = { type: 'click' };
        clickHandler({ composedPath: () => [new harness.MockElement('转发')] });
        transformed.items[1].handler(voiceRecord, voiceRecord.elements[0], nativeContext, nativeEvent);
        assert.equal(forwardedArgs.length, 1);
        assert.equal(forwardedArgs[0].thisValue, nativeForward);
        assert.equal(forwardedArgs[0].args[0].msgId, voiceRecord.msgId);
        assert.equal(forwardedArgs[0].args[0].elements[0].elementType, 1);
        assert.equal(forwardedArgs[0].args[1], forwardedArgs[0].args[0].elements[0]);
        assert.equal(forwardedArgs[0].args[2], nativeContext);
        assert.equal(forwardedArgs[0].args[3], nativeEvent);
        assert.equal((await harness.actionPromise).type, 'prepareNativePttForward');
    } finally {
        harness.restore();
    }
});
