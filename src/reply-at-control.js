const installedCkeditors = new WeakMap();
const installedPlugins = new WeakMap();

function normalizeUid(value) {
    const normalized = String(value ?? '').trim();
    return normalized && !['0', 'null', 'undefined'].includes(normalized)
        ? normalized
        : '';
}

function sameUid(left, right) {
    const normalizedLeft = normalizeUid(left);
    return normalizedLeft !== '' && normalizedLeft === normalizeUid(right);
}

function isAutomaticReplyAtSequence(replyItem, atItem, spaceItem) {
    return replyItem?.type === 'reply' &&
        atItem?.type === 'at' &&
        Number(atItem.atType) === 2 &&
        sameUid(atItem.uid, replyItem.reply?.uid) &&
        spaceItem?.type === 'text' &&
        spaceItem.text === ' ';
}

function removeAutomaticReplyAt(items) {
    if (!Array.isArray(items)) {
        return items;
    }

    let result = null;
    for (let index = 0; index < items.length; index++) {
        if (!isAutomaticReplyAtSequence(items[index], items[index + 1], items[index + 2])) {
            result?.push(items[index]);
            continue;
        }

        if (!result) {
            result = items.slice(0, index);
        }
        result.push(items[index], items[index + 2]);
        index += 2;
    }
    return result || items;
}

function findProseMirrorReplySpacer(doc, replyItem) {
    const entries = [];
    try {
        doc?.forEach?.((node, offset) => {
            entries.push({ node, offset });
        });
    } catch {
        return null;
    }
    for (let index = 0; index < entries.length - 1; index++) {
        const reply = entries[index].node?.attrs?.item?.reply;
        const paragraph = entries[index + 1];
        if (entries[index].node?.type?.name !== 'msgReply' ||
            !sameUid(reply?.uid, replyItem?.reply?.uid) ||
            (replyItem?.reply?.msgId != null &&
                String(reply?.msgId) !== String(replyItem.reply.msgId)) ||
            paragraph.node?.type?.name !== 'paragraph' ||
            paragraph.node?.firstChild?.isText !== true ||
            !String(paragraph.node.firstChild.text || '').startsWith(' ')) {
            continue;
        }
        const from = Number(paragraph.offset) + 1;
        return { from, to: from + 1 };
    }
    return null;
}

function removeInsertedReplySpacer(editor, previousDoc, replyItem) {
    const view = editor?.view;
    const state = view?.state;
    const range = state?.doc && state.doc !== previousDoc
        ? findProseMirrorReplySpacer(state.doc, replyItem)
        : null;
    if (!range || typeof state.tr?.delete !== 'function' || typeof view.dispatch !== 'function') {
        return false;
    }

    try {
        const transaction = state.tr.delete(range.from, range.to);
        view.dispatch(transaction);
        return true;
    } catch {
        return false;
    }
}

function installReplyAtInsertGuard(editor, isEnabled) {
    const plugin = editor?.commonPlugin;
    if (!plugin || typeof plugin.insertItems !== 'function') {
        return false;
    }

    const installed = installedPlugins.get(plugin);
    if (installed && plugin.insertItems === installed.guardedInsertItems) {
        installed.editor = editor;
        installed.isEnabled = isEnabled;
        return true;
    }

    const state = {
        editor,
        isEnabled,
        originalInsertItems: plugin.insertItems,
        guardedInsertItems: null
    };
    state.guardedInsertItems = function guardedReplyAtInsert(items, ...args) {
        let nextItems = items;
        let replyItem = null;
        try {
            if (state.isEnabled?.() === true) {
                nextItems = removeAutomaticReplyAt(items);
                if (nextItems !== items) {
                    replyItem = items.find((item, index) =>
                        isAutomaticReplyAtSequence(item, items[index + 1], items[index + 2])
                    ) || null;
                }
            }
        } catch {
        }

        const previousDoc = replyItem == null ? null : state.editor?.view?.state?.doc;
        const result = Reflect.apply(state.originalInsertItems, this, [nextItems, ...args]);
        if (replyItem) {
            removeInsertedReplySpacer(state.editor, previousDoc, replyItem);
        }
        return result;
    };

    try {
        plugin.insertItems = state.guardedInsertItems;
        if (plugin.insertItems !== state.guardedInsertItems) {
            return false;
        }
        installedPlugins.set(plugin, state);
        return true;
    } catch {
        return false;
    }
}

function isCkeditorElement(node, name) {
    try {
        return node?.is?.('element', name) === true;
    } catch {
        return false;
    }
}

function getCkeditorChildren(node) {
    try {
        return Array.from(node?.getChildren?.() || []);
    } catch {
        return [];
    }
}

function getCkeditorItem(node) {
    let value;
    try {
        value = node?.getAttribute?.('data');
    } catch {
        return null;
    }
    if (typeof value !== 'string') {
        return value && typeof value === 'object' ? value : null;
    }
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function getCkeditorAtElements(root) {
    const result = [];
    for (const block of getCkeditorChildren(root)) {
        if (!isCkeditorElement(block, 'paragraph')) {
            continue;
        }
        for (const child of getCkeditorChildren(block)) {
            if (isCkeditorElement(child, 'msg-at')) {
                result.push(child);
            }
        }
    }
    return result;
}

function toWeakSet(values) {
    const result = new WeakSet();
    for (const value of values) {
        if (value && (typeof value === 'object' || typeof value === 'function')) {
            result.add(value);
        }
    }
    return result;
}

function findCkeditorAutomaticReplyAt(root, replyElement, existingAtElements) {
    const replyItem = getCkeditorItem(replyElement);
    const replyUid = replyItem?.reply?.uid;
    if (replyItem?.type !== 'reply' || replyUid == null) {
        return null;
    }

    for (const block of getCkeditorChildren(root)) {
        if (!isCkeditorElement(block, 'paragraph')) {
            continue;
        }
        const children = getCkeditorChildren(block);
        for (let index = 0; index < children.length - 1; index++) {
            const atElement = children[index];
            const spacer = children[index + 1];
            const atItem = getCkeditorItem(atElement);
            if (isCkeditorElement(atElement, 'msg-at') &&
                existingAtElements?.has?.(atElement) !== true &&
                atItem?.type === 'at' && Number(atItem.atType) === 2 &&
                sameUid(atItem.uid, replyUid) && spacer?.is?.('$text') === true &&
                String(spacer.data || '').startsWith(' ')) {
                return {
                    atElement,
                    paragraph: block,
                    replyElement,
                    root,
                    spacer,
                    startOffset: Number(atElement.startOffset) || 0
                };
            }
        }
    }
    return null;
}

function shouldRepairCkeditorSelection(documentModel, repair) {
    const selection = documentModel?.selection;
    if (!selection) {
        return false;
    }
    if (selection.isCollapsed === false) {
        return false;
    }
    try {
        const selectedElement = selection.getSelectedElement?.();
        if (selectedElement) {
            return selectedElement === repair.replyElement;
        }
    } catch {
    }

    let position = null;
    try {
        position = selection.getFirstPosition?.() || selection.focus || selection.anchor || null;
    } catch {
    }
    if (!position) {
        return false;
    }

    const offset = Number(position.offset);
    if (!Number.isFinite(offset)) {
        return false;
    }
    if (position.parent === repair.paragraph) {
        return offset === repair.cursorOffset;
    }
    if (position.parent !== repair.root) {
        return false;
    }
    try {
        const nodeAfter = position.nodeAfter;
        const nodeBefore = position.nodeBefore;
        return nodeAfter === repair.replyElement ||
            nodeAfter === repair.paragraph ||
            nodeBefore === repair.replyElement;
    } catch {
        return false;
    }
}

function finishCkeditorCursorRepair(editor, repair) {
    const model = editor?.model;
    const documentModel = model?.document;
    if (!model || !repair?.paragraph?.root || repair.isCurrent?.() === false) {
        return false;
    }
    if (editor?.editing?.view?.document?.isFocused === false) {
        return false;
    }

    try {
        model.enqueueChange('transparent', writer => {
            if (!repair.paragraph?.root || repair.isCurrent?.() === false) {
                return;
            }
            const rootChildren = getCkeditorChildren(repair.root);
            const replyIndex = rootChildren.indexOf(repair.replyElement);
            const replyIsCurrent = repair.replyElement?.root === repair.root &&
                replyIndex >= 0 && rootChildren[replyIndex + 1] === repair.paragraph;
            const repairSelection = replyIsCurrent &&
                shouldRepairCkeditorSelection(documentModel, repair);
            if (repairSelection) {
                const maxOffset = Number(repair.paragraph.maxOffset);
                const cursorOffset = Number.isFinite(maxOffset)
                    ? Math.min(repair.cursorOffset, maxOffset)
                    : repair.cursorOffset;
                writer.setSelection(repair.paragraph, cursorOffset);
            }
        });
        return true;
    } catch {
        return false;
    }
}

function scheduleCkeditorCursorRepair(callback) {
    const scheduleTimer = () => globalThis.setTimeout(callback, 0);
    if (typeof globalThis.requestAnimationFrame === 'function') {
        globalThis.requestAnimationFrame(scheduleTimer);
        return;
    }
    scheduleTimer();
}

function removeCkeditorLegacyReplyAnchors(editor, root, replyElement) {
    const model = editor?.model;
    const rootChildren = getCkeditorChildren(root);
    const replyIndex = rootChildren.indexOf(replyElement);
    const paragraph = rootChildren[replyIndex + 1];
    if (!model || replyIndex < 0 || !isCkeditorElement(paragraph, 'paragraph')) {
        return false;
    }
    const firstChild = getCkeditorChildren(paragraph)[0];
    const legacyLength = firstChild?.is?.('$text') === true
        ? String(firstChild.data || '').match(/^\u200b+/)?.[0]?.length || 0
        : 0;
    if (!legacyLength) {
        return false;
    }

    try {
        model.enqueueChange('transparent', writer => {
            const currentRootChildren = getCkeditorChildren(root);
            const currentReplyIndex = currentRootChildren.indexOf(replyElement);
            if (currentReplyIndex < 0 ||
                currentRootChildren[currentReplyIndex + 1] !== paragraph) {
                return;
            }
            const currentFirstChild = getCkeditorChildren(paragraph)[0];
            const currentLength = currentFirstChild?.is?.('$text') === true
                ? String(currentFirstChild.data || '').match(/^\u200b+/)?.[0]?.length || 0
                : 0;
            if (!currentLength) {
                return;
            }
            const start = writer.createPositionAt(paragraph, 0);
            const end = writer.createPositionAt(paragraph, currentLength);
            writer.remove(writer.createRange(start, end));
        });
        return true;
    } catch {
        return false;
    }
}

function removeCkeditorAutomaticReplyAt(
    editor,
    match,
    scheduleRepair = scheduleCkeditorCursorRepair,
    isRepairCurrent = () => true
) {
    const model = editor?.model;
    if (!model || !match) {
        return false;
    }
    let repair = null;
    try {
        model.enqueueChange('transparent', writer => {
            if (!match.atElement?.root || !match.spacer?.root ||
                !String(match.spacer.data || '').startsWith(' ')) {
                return;
            }
            const paragraphChildren = getCkeditorChildren(match.paragraph);
            const atIndex = paragraphChildren.indexOf(match.atElement);
            if (atIndex < 0 || paragraphChildren[atIndex + 1] !== match.spacer) {
                return;
            }
            const currentAtOffset = Number(match.atElement.startOffset);
            const cursorOffset = Math.max(
                0,
                Number.isFinite(currentAtOffset) ? currentAtOffset : match.startOffset
            );
            const previous = paragraphChildren[atIndex - 1];
            const previousText = previous?.is?.('$text') === true
                ? String(previous.data || '')
                : '';
            const legacyMatch = previousText.match(/\u200b+$/);
            const legacyAnchorLength = Math.min(
                cursorOffset,
                legacyMatch?.[0]?.length || 0
            );
            writer.remove(writer.createRangeOn(match.atElement));
            const spaceStart = writer.createPositionAt(match.paragraph, cursorOffset);
            const spaceEnd = writer.createPositionAt(match.paragraph, cursorOffset + 1);
            writer.remove(writer.createRange(spaceStart, spaceEnd));
            const cleanedCursorOffset = cursorOffset - legacyAnchorLength;
            if (legacyAnchorLength) {
                const legacyStart = writer.createPositionAt(
                    match.paragraph,
                    cleanedCursorOffset
                );
                const legacyEnd = writer.createPositionAt(
                    match.paragraph,
                    cursorOffset
                );
                writer.remove(writer.createRange(legacyStart, legacyEnd));
            }
            writer.setSelection(match.paragraph, cleanedCursorOffset);
            repair = {
                cursorOffset: cleanedCursorOffset,
                isCurrent: isRepairCurrent,
                paragraph: match.paragraph,
                replyElement: match.replyElement,
                root: match.root
            };
        });
        if (!repair) {
            return false;
        }
        try {
            scheduleRepair(() => finishCkeditorCursorRepair(editor, repair));
        } catch {
            finishCkeditorCursorRepair(editor, repair);
        }
        return true;
    } catch {
        return false;
    }
}

function installCkeditorReplyAtGuard(
    editor,
    isEnabled,
    scheduleRepair = scheduleCkeditorCursorRepair
) {
    const documentModel = editor?.model?.document;
    if (!documentModel || typeof documentModel.on !== 'function' ||
        typeof documentModel.getRoot !== 'function') {
        return false;
    }

    const installed = installedCkeditors.get(editor);
    if (installed) {
        installed.isEnabled = isEnabled;
        installed.scheduleRepair = scheduleRepair;
        return true;
    }

    const state = {
        atElements: new WeakSet(),
        isEnabled,
        legacyCleanedReplies: new WeakSet(),
        pendingReply: null,
        replyData: undefined,
        replyElement: null,
        replyRevision: 0,
        scheduleRepair
    };
    const handleChange = () => {
        const root = documentModel.getRoot?.();
        const atElements = getCkeditorAtElements(root);
        const replyElement = getCkeditorChildren(root)
            .find(node => isCkeditorElement(node, 'msg-reply')) || null;
        let replyData;
        try {
            replyData = replyElement?.getAttribute?.('data');
        } catch {
        }
        if (replyElement !== state.replyElement || replyData !== state.replyData) {
            state.replyRevision += 1;
            let enabled = false;
            try {
                enabled = state.isEnabled?.() === true;
            } catch {
            }
            state.pendingReply = replyElement && enabled
                ? {
                    atElements: state.atElements,
                    expiresAt: Date.now() + 500,
                    replyElement,
                    revision: state.replyRevision
                }
                : null;
            state.replyData = replyData;
            state.replyElement = replyElement;
        }
        const pending = state.pendingReply;
        let removedAutomaticAt = false;
        if (pending && Date.now() <= pending.expiresAt) {
            const match = findCkeditorAutomaticReplyAt(
                root,
                pending.replyElement,
                pending.atElements
            );
            if (match) {
                state.pendingReply = null;
                removedAutomaticAt = removeCkeditorAutomaticReplyAt(
                    editor,
                    match,
                    state.scheduleRepair,
                    () => state.replyRevision === pending.revision &&
                        state.replyElement === pending.replyElement
                );
                if (!removedAutomaticAt) {
                    state.pendingReply = pending;
                }
            }
        } else if (pending) {
            state.pendingReply = null;
        }
        if (replyElement && !removedAutomaticAt &&
            !state.legacyCleanedReplies.has(replyElement)) {
            state.legacyCleanedReplies.add(replyElement);
            removeCkeditorLegacyReplyAnchors(editor, root, replyElement);
        }
        state.atElements = toWeakSet(atElements);
    };

    try {
        documentModel.on('change:data', handleChange);
        installedCkeditors.set(editor, state);
        handleChange();
        return true;
    } catch {
        return false;
    }
}

export {
    findCkeditorAutomaticReplyAt,
    findProseMirrorReplySpacer,
    installCkeditorReplyAtGuard,
    installReplyAtInsertGuard,
    isAutomaticReplyAtSequence,
    removeAutomaticReplyAt,
    removeInsertedReplySpacer
};
