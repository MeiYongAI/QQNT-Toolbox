function createReplyAtCleanupTracker() {
    const replyElements = new WeakMap();

    return Object.freeze({
        shouldCleanup(editor, replyElement, enabled) {
            if ((!editor || (typeof editor !== 'object' && typeof editor !== 'function'))) {
                return false;
            }
            const currentReplyElement = replyElements.get(editor) || null;
            if (replyElement === currentReplyElement) {
                return false;
            }
            replyElements.set(editor, replyElement || null);
            return enabled === true && Boolean(replyElement);
        }
    });
}

export { createReplyAtCleanupTracker };
