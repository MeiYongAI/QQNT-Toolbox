'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const moduleSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'reply-at-control.js'),
    'utf8'
);
const rendererSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer.js'),
    'utf8'
);
const modulePromise = import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);

function automaticItems(uid = 'u_reply') {
    return [
        { type: 'reply', reply: { uid, msgId: 'message-1' } },
        { type: 'at', atType: 2, uid, content: 'member' },
        { type: 'text', text: ' ' }
    ];
}

function ckeditorElement(name, item = null, children = [], startOffset = 0) {
    return {
        root: {},
        startOffset,
        offsetSize: 1,
        is(type, expectedName) {
            return type === 'element' && expectedName === name;
        },
        getAttribute(key) {
            return key === 'data' && item ? JSON.stringify(item) : undefined;
        },
        getChildren() {
            return children;
        }
    };
}

function ckeditorText(data, startOffset = 0) {
    return {
        root: {},
        data,
        startOffset,
        get offsetSize() {
            return this.data.length;
        },
        is(type) {
            return type === '$text';
        },
        getAttributes() {
            return [];
        }
    };
}

test('filters only QQ automatic at while keeping the required 32 insert spacer', async () => {
    const { removeAutomaticReplyAt } = await modulePromise;
    const prefix = { type: 'text', text: 'draft' };
    const suffix = { type: 'pic', path: 'image.png' };
    const items = [prefix, ...automaticItems(), suffix];
    const result = removeAutomaticReplyAt(items);

    assert.deepEqual(result, [prefix, items[1], items[3], suffix]);
    assert.equal(result[1], items[1]);
    assert.equal(result[2], items[3]);
    assert.deepEqual(items.slice(1, 4), automaticItems());
});

test('keeps proactive mentions and near-match reply payloads unchanged', async () => {
    const { removeAutomaticReplyAt } = await modulePromise;
    const proactive = [
        { type: 'at', atType: 2, uid: 'u_reply' },
        { type: 'text', text: ' ' }
    ];
    const differentUid = automaticItems();
    differentUid[1] = { ...differentUid[1], uid: 'u_other' };
    const nonAutomaticAt = automaticItems();
    nonAutomaticAt[1] = { ...nonAutomaticAt[1], atType: 1 };
    const nonExactSpace = automaticItems();
    nonExactSpace[2] = { type: 'text', text: '  ' };
    const emptyUid = automaticItems('');

    for (const items of [proactive, differentUid, nonAutomaticAt, nonExactSpace, emptyUid]) {
        assert.equal(removeAutomaticReplyAt(items), items);
    }
});

test('guard preserves this, remaining arguments, return value, and disabled payload identity', async () => {
    const { installReplyAtInsertGuard } = await modulePromise;
    const calls = [];
    const plugin = {
        insertItems(...args) {
            assert.equal(this, plugin);
            calls.push(args);
            return 'inserted';
        }
    };
    const editor = { commonPlugin: plugin };
    let enabled = false;

    assert.equal(installReplyAtInsertGuard(editor, () => enabled), true);
    assert.equal(installReplyAtInsertGuard(editor, () => enabled), true);
    const disabledItems = automaticItems();
    assert.equal(plugin.insertItems(disabledItems, null), 'inserted');
    assert.equal(calls[0][0], disabledItems);

    enabled = true;
    const enabledItems = automaticItems();
    assert.equal(plugin.insertItems(enabledItems, { source: 'reply' }), 'inserted');
    assert.deepEqual(calls[1][0], [enabledItems[0], enabledItems[2]]);
    assert.deepEqual(calls[1][1], { source: 'reply' });
});

test('removes the 32 insert spacer after QQ commits the reply transaction', async () => {
    const { installReplyAtInsertGuard } = await modulePromise;
    const items = automaticItems();
    const previousDoc = {};
    const replyNode = {
        type: { name: 'msgReply' },
        attrs: { item: items[0] }
    };
    const currentDoc = {
        forEach(callback) {
            callback(replyNode, 0);
            callback({
                type: { name: 'paragraph' },
                firstChild: { isText: true, text: ' ' }
            }, 1);
        }
    };
    const transaction = {
        deleted: null,
        delete(from, to) {
            this.deleted = { from, to };
            return this;
        }
    };
    const view = {
        state: {
            doc: previousDoc,
            selection: { empty: true, from: 1, $from: { nodeBefore: null } },
            tr: transaction
        },
        dispatched: null,
        dispatch(value) {
            this.dispatched = value;
        }
    };
    const plugin = {
        insertItems(receivedItems) {
            assert.deepEqual(receivedItems, [items[0], items[2]]);
            view.state = {
                doc: currentDoc,
                selection: {
                    empty: true,
                    from: 3,
                    $from: { nodeBefore: { isText: true, text: ' ' } }
                },
                tr: transaction
            };
            return 'inserted';
        }
    };

    assert.equal(installReplyAtInsertGuard({ commonPlugin: plugin, view }, () => true), true);
    assert.equal(plugin.insertItems(items), 'inserted');
    assert.deepEqual(transaction.deleted, { from: 2, to: 3 });
    assert.equal(view.dispatched, transaction);
});

test('finds the exact automatic mention in the 25 CKEditor model', async () => {
    const { findCkeditorAutomaticReplyAt } = await modulePromise;
    const reply = ckeditorElement('msg-reply', automaticItems()[0]);
    const at = ckeditorElement('msg-at', automaticItems()[1]);
    const spacer = ckeditorText(' ');
    const paragraph = ckeditorElement('paragraph', null, [at, spacer]);
    const root = ckeditorElement('$root', null, [reply, paragraph]);

    const match = findCkeditorAutomaticReplyAt(root, reply);
    assert.equal(match.atElement, at);
    assert.equal(match.spacer, spacer);
    assert.equal(match.paragraph, paragraph);
    assert.equal(match.startOffset, 0);

    const proactiveAt = ckeditorElement('msg-at', {
        ...automaticItems()[1],
        uid: 'u_other'
    });
    const proactiveRoot = ckeditorElement('$root', null, [
        reply,
        ckeditorElement('paragraph', null, [proactiveAt, spacer])
    ]);
    assert.equal(findCkeditorAutomaticReplyAt(proactiveRoot, reply), null);
});

test('repairs the 25 cursor without inserting hidden editor content', async () => {
    const { installCkeditorReplyAtGuard } = await modulePromise;
    const reply = ckeditorElement('msg-reply', automaticItems()[0]);
    const at = ckeditorElement('msg-at', automaticItems()[1]);
    const spacer = ckeditorText(' draft', 1);
    const paragraphChildren = [at, spacer];
    const paragraph = ckeditorElement('paragraph', null, paragraphChildren);
    const rootChildren = [reply, paragraph];
    const root = ckeditorElement('$root', null, rootChildren);
    reply.root = root;
    paragraph.root = root;
    at.root = root;
    spacer.root = root;
    const refreshParagraphOffsets = () => {
        let offset = 0;
        for (const child of paragraphChildren) {
            child.startOffset = offset;
            offset += Number(child.offsetSize) || 1;
        }
        paragraph.maxOffset = offset;
    };
    refreshParagraphOffsets();
    const removed = [];
    const inserted = [];
    const selections = [];
    const scheduled = [];
    let changeHandler = null;
    let enabled = true;
    const documentModel = {
        getRoot() {
            return root;
        },
        on(event, handler) {
            assert.equal(event, 'change:data');
            changeHandler = handler;
        },
        selection: null
    };
    const editor = {
        model: {
            document: documentModel,
            enqueueChange(batchType, callback) {
                assert.equal(batchType, 'transparent');
                callback({
                    createPositionAt(parent, offset) {
                        return { parent, offset };
                    },
                    createRange(start, end) {
                        return { end, start };
                    },
                    createRangeOn(node) {
                        return { node };
                    },
                    insertText(text, attributes, parent, offset) {
                        inserted.push({ text, attributes, parent, offset });
                        const textNode = ckeditorText(text, offset);
                        textNode.root = root;
                        const nextIndex = paragraphChildren.findIndex(node =>
                            Number(node.startOffset) > offset
                        );
                        paragraphChildren.splice(
                            nextIndex < 0 ? paragraphChildren.length : nextIndex,
                            0,
                            textNode
                        );
                    },
                    setSelection(selection, offset) {
                        editor.selection = { selection, offset };
                        selections.push(editor.selection);
                        documentModel.selection = {
                            isCollapsed: true,
                            getFirstPosition() {
                                return { parent: selection, offset };
                            }
                        };
                    },
                    remove(value) {
                        if (value?.start && value?.end) {
                            const textNode = paragraphChildren.find(child =>
                                child.is?.('$text') === true &&
                                value.start.offset >= child.startOffset &&
                                value.start.offset < child.startOffset + child.data.length
                            );
                            assert.ok(textNode);
                            const localStart = value.start.offset - textNode.startOffset;
                            const localEnd = value.end.offset - textNode.startOffset;
                            textNode.data = textNode.data.slice(0, localStart) +
                                textNode.data.slice(localEnd);
                            if (!textNode.data) {
                                textNode.root = null;
                                paragraphChildren.splice(paragraphChildren.indexOf(textNode), 1);
                            }
                            removed.push(value);
                            refreshParagraphOffsets();
                            return;
                        }
                        const target = value?.node || value;
                        removed.push(value);
                        target.root = null;
                        const index = paragraphChildren.indexOf(target);
                        if (index >= 0) {
                            paragraphChildren.splice(index, 1);
                        }
                        refreshParagraphOffsets();
                    }
                });
            }
        }
    };

    assert.equal(installCkeditorReplyAtGuard(
        editor,
        () => enabled,
        callback => scheduled.push(callback)
    ), true);
    assert.equal(typeof changeHandler, 'function');
    assert.deepEqual(inserted, []);
    assert.deepEqual(removed[0], { node: at });
    assert.deepEqual(removed[1], {
        start: { parent: paragraph, offset: 0 },
        end: { parent: paragraph, offset: 1 }
    });
    assert.deepEqual(editor.selection, { selection: paragraph, offset: 0 });
    assert.equal(scheduled.length, 1);
    assert.equal(inserted.some(item => item.text.includes('\u200b')), false);

    documentModel.selection = {
        isCollapsed: true,
        getFirstPosition() {
            return {
                nodeAfter: reply,
                nodeBefore: null,
                parent: root,
                offset: 0
            };
        }
    };
    scheduled.shift()();
    assert.equal(paragraphChildren[0].data, 'draft');
    assert.deepEqual(editor.selection, { selection: paragraph, offset: 0 });
    assert.deepEqual(selections.map(selection => selection.offset), [0, 0]);

    const removalCount = removed.length;
    const proactiveAt = ckeditorElement('msg-at', automaticItems()[1]);
    const proactiveSpacer = ckeditorText(' ');
    paragraphChildren.push(proactiveAt, proactiveSpacer);
    changeHandler();
    assert.equal(removed.length, removalCount);
    assert.deepEqual(paragraphChildren, [
        paragraphChildren[0],
        proactiveAt,
        proactiveSpacer
    ]);
    assert.equal(paragraphChildren[0].data, 'draft');
});

test('does not override a deliberate 25 cursor move', async () => {
    const { installCkeditorReplyAtGuard } = await modulePromise;
    const reply = ckeditorElement('msg-reply', automaticItems()[0]);
    const at = ckeditorElement('msg-at', automaticItems()[1]);
    const spacer = ckeditorText(' draft', 1);
    const paragraphChildren = [at, spacer];
    const paragraph = ckeditorElement('paragraph', null, paragraphChildren);
    const root = ckeditorElement('$root', null, [reply, paragraph]);
    for (const node of [reply, at, spacer, paragraph]) {
        node.root = root;
    }
    const refreshParagraphOffsets = () => {
        let offset = 0;
        for (const child of paragraphChildren) {
            child.startOffset = offset;
            offset += Number(child.offsetSize) || 1;
        }
        paragraph.maxOffset = offset;
    };
    refreshParagraphOffsets();
    const scheduled = [];
    const selections = [];
    const documentModel = {
        getRoot: () => root,
        on() {},
        selection: null
    };
    const editor = {
        model: {
            document: documentModel,
            enqueueChange(_batchType, callback) {
                callback({
                    createPositionAt: (parent, offset) => ({ parent, offset }),
                    createRange: (start, end) => ({ start, end }),
                    createRangeOn: node => ({ node }),
                    insertText(text, _attributes, _parent, offset) {
                        const textNode = ckeditorText(text, offset);
                        textNode.root = root;
                        paragraphChildren.push(textNode);
                    },
                    remove(value) {
                        if (value?.start && value?.end) {
                            const textNode = paragraphChildren.find(node => node.is?.('$text'));
                            const localStart = value.start.offset - textNode.startOffset;
                            const localEnd = value.end.offset - textNode.startOffset;
                            textNode.data = textNode.data.slice(0, localStart) +
                                textNode.data.slice(localEnd);
                            refreshParagraphOffsets();
                            return;
                        }
                        const target = value?.node || value;
                        target.root = null;
                        paragraphChildren.splice(paragraphChildren.indexOf(target), 1);
                        refreshParagraphOffsets();
                    },
                    setSelection(selection, offset) {
                        selections.push({ selection, offset });
                        documentModel.selection = {
                            isCollapsed: true,
                            getFirstPosition: () => ({ parent: selection, offset })
                        };
                    }
                });
            }
        }
    };

    assert.equal(installCkeditorReplyAtGuard(
        editor,
        () => true,
        callback => scheduled.push(callback)
    ), true);
    documentModel.selection = {
        isCollapsed: true,
        getFirstPosition: () => ({ parent: paragraph, offset: 4 })
    };
    scheduled.shift()();

    assert.equal(paragraphChildren[0].data, 'draft');
    assert.deepEqual(selections.map(selection => selection.offset), [0]);
});

test('removes legacy cursor anchors beside a new 25 automatic mention', async () => {
    const { installCkeditorReplyAtGuard } = await modulePromise;
    const reply = ckeditorElement('msg-reply', automaticItems()[0]);
    const legacyAnchor = ckeditorText('\u200b\u200b', 0);
    const at = ckeditorElement('msg-at', automaticItems()[1], [], 2);
    const spacer = ckeditorText(' ', 3);
    const paragraphChildren = [legacyAnchor, at, spacer];
    const paragraph = ckeditorElement('paragraph', null, paragraphChildren);
    paragraph.maxOffset = 4;
    const root = ckeditorElement('$root', null, [reply, paragraph]);
    for (const node of [reply, legacyAnchor, at, spacer, paragraph]) {
        node.root = root;
    }
    const removed = [];
    const scheduled = [];
    const editor = {
        model: {
            document: {
                getRoot: () => root,
                on() {},
                selection: null
            },
            enqueueChange(_batchType, callback) {
                callback({
                    createPositionAt: (parent, offset) => ({ parent, offset }),
                    createRange: (start, end) => ({ start, end }),
                    createRangeOn: node => ({ node }),
                    remove(value) {
                        removed.push(value);
                        if (value?.node) {
                            value.node.root = null;
                        }
                    },
                    setSelection(parent, offset) {
                        editor.selection = { parent, offset };
                    }
                });
            }
        }
    };

    assert.equal(installCkeditorReplyAtGuard(
        editor,
        () => true,
        callback => scheduled.push(callback)
    ), true);
    assert.deepEqual(removed, [
        { node: at },
        {
            start: { parent: paragraph, offset: 2 },
            end: { parent: paragraph, offset: 3 }
        },
        {
            start: { parent: paragraph, offset: 0 },
            end: { parent: paragraph, offset: 2 }
        }
    ]);
    assert.deepEqual(editor.selection, { parent: paragraph, offset: 0 });
    assert.equal(scheduled.length, 1);
});

test('migrates legacy 25 cursor anchors from an existing reply draft', async () => {
    const { installCkeditorReplyAtGuard } = await modulePromise;
    const reply = ckeditorElement('msg-reply', automaticItems()[0]);
    const legacyDraft = ckeditorText('\u200b\u200bdraft', 0);
    const paragraph = ckeditorElement('paragraph', null, [legacyDraft]);
    paragraph.maxOffset = legacyDraft.data.length;
    const root = ckeditorElement('$root', null, [reply, paragraph]);
    for (const node of [reply, legacyDraft, paragraph]) {
        node.root = root;
    }
    const removed = [];
    let changeHandler = null;
    const editor = {
        model: {
            document: {
                getRoot: () => root,
                on(_event, handler) {
                    changeHandler = handler;
                },
                selection: null
            },
            enqueueChange(_batchType, callback) {
                callback({
                    createPositionAt: (parent, offset) => ({ parent, offset }),
                    createRange: (start, end) => ({ start, end }),
                    remove(value) {
                        removed.push(value);
                    }
                });
            }
        }
    };

    assert.equal(installCkeditorReplyAtGuard(editor, () => true), true);
    assert.deepEqual(removed, [{
        start: { parent: paragraph, offset: 0 },
        end: { parent: paragraph, offset: 2 }
    }]);
    changeHandler();
    assert.equal(removed.length, 1);
});

test('invalidates the delayed 25 cursor repair after switching replies', async () => {
    const { installCkeditorReplyAtGuard } = await modulePromise;
    const replyItems = automaticItems();
    const rootChildren = [];
    const root = ckeditorElement('$root', null, rootChildren);
    const scheduled = [];
    const selections = [];
    let changeHandler = null;
    let currentReply = null;
    const documentModel = {
        getRoot: () => root,
        on(_event, handler) {
            changeHandler = handler;
        },
        selection: null
    };
    const installReply = msgId => {
        const replyItem = {
            ...replyItems[0],
            reply: { ...replyItems[0].reply, msgId }
        };
        const reply = ckeditorElement('msg-reply', replyItem);
        const at = ckeditorElement('msg-at', replyItems[1]);
        const spacer = ckeditorText(' ', 1);
        const paragraph = ckeditorElement('paragraph', null, [at, spacer]);
        paragraph.maxOffset = 2;
        for (const node of [reply, at, spacer, paragraph]) {
            node.root = root;
        }
        rootChildren.splice(0, rootChildren.length, reply, paragraph);
        currentReply = reply;
        documentModel.selection = {
            isCollapsed: true,
            getFirstPosition: () => ({
                nodeAfter: reply,
                nodeBefore: null,
                parent: root,
                offset: 0
            })
        };
    };
    const editor = {
        editing: { view: { document: { isFocused: true } } },
        model: {
            document: documentModel,
            enqueueChange(_batchType, callback) {
                callback({
                    createPositionAt: (parent, offset) => ({ parent, offset }),
                    createRange: (start, end) => ({ start, end }),
                    createRangeOn: node => ({ node }),
                    remove(value) {
                        if (value?.node) {
                            value.node.root = null;
                        }
                    },
                    setSelection(parent, offset) {
                        selections.push({ parent, offset });
                    }
                });
            }
        }
    };

    installReply('message-a');
    assert.equal(installCkeditorReplyAtGuard(
        editor,
        () => true,
        callback => scheduled.push(callback)
    ), true);
    assert.equal(scheduled.length, 1);

    installReply('message-b');
    changeHandler();
    assert.equal(scheduled.length, 2);
    const immediateSelectionCount = selections.length;

    scheduled[0]();
    assert.equal(selections.length, immediateSelectionCount);
    scheduled[1]();
    assert.equal(selections.length, immediateSelectionCount + 1);
    assert.equal(selections.at(-1).parent, rootChildren[1]);
    assert.equal(currentReply, rootChildren[0]);
});

test('does not repair a blurred 25 editor selection', async () => {
    const { installCkeditorReplyAtGuard } = await modulePromise;
    const reply = ckeditorElement('msg-reply', automaticItems()[0]);
    const at = ckeditorElement('msg-at', automaticItems()[1]);
    const spacer = ckeditorText(' ', 1);
    const paragraph = ckeditorElement('paragraph', null, [at, spacer]);
    paragraph.maxOffset = 2;
    const root = ckeditorElement('$root', null, [reply, paragraph]);
    for (const node of [reply, at, spacer, paragraph]) {
        node.root = root;
    }
    const scheduled = [];
    const selections = [];
    const documentModel = {
        getRoot: () => root,
        on() {},
        selection: {
            isCollapsed: true,
            getFirstPosition: () => ({
                nodeAfter: reply,
                nodeBefore: null,
                parent: root,
                offset: 0
            })
        }
    };
    const editor = {
        editing: { view: { document: { isFocused: true } } },
        model: {
            document: documentModel,
            enqueueChange(_batchType, callback) {
                callback({
                    createPositionAt: (parent, offset) => ({ parent, offset }),
                    createRange: (start, end) => ({ start, end }),
                    createRangeOn: node => ({ node }),
                    remove() {},
                    setSelection(parent, offset) {
                        selections.push({ parent, offset });
                    }
                });
            }
        }
    };

    assert.equal(installCkeditorReplyAtGuard(
        editor,
        () => true,
        callback => scheduled.push(callback)
    ), true);
    assert.equal(selections.length, 1);
    editor.editing.view.document.isFocused = false;
    scheduled.shift()();
    assert.equal(selections.length, 1);
});

test('fails closed without the QQ common insert plugin', async () => {
    const { installReplyAtInsertGuard } = await modulePromise;

    assert.equal(installReplyAtInsertGuard(null, () => true), false);
    assert.equal(installReplyAtInsertGuard({}, () => true), false);
    assert.equal(installReplyAtInsertGuard({ commonPlugin: {} }, () => true), false);
});

test('renderer installs both editor guards and contains no legacy interception path', () => {
    assert.match(rendererSource, /findProseMirrorEditor/);
    assert.match(rendererSource, /installReplyAtInsertGuard/);
    assert.match(rendererSource, /installCkeditorReplyAtGuard/);
    assert.doesNotMatch(rendererSource, /anonymousExtInfo/);
    assert.doesNotMatch(rendererSource, /reply-at\.probe/);
    assert.doesNotMatch(rendererSource, /msg-at/);
    assert.doesNotMatch(rendererSource, /replyAtCleanup|replyAtController|transformReplyAtContextMenuItems/);
});
