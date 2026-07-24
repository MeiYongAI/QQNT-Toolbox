'use strict';

const WINDOW_SHAKE_RECEIVE_COMMAND = 'nodeIKernelMsgListener/onRecvMsg';
const WINDOW_SHAKE_FACE_TYPE = 5;
const WINDOW_SHAKE_FACE_INDEX = 1;
const DEFAULT_GUARD_DURATION_MS = 1500;

function createWindowShakeElement() {
    return {
        elementType: 6,
        elementId: '',
        faceElement: {
            faceIndex: WINDOW_SHAKE_FACE_INDEX,
            faceType: WINDOW_SHAKE_FACE_TYPE,
            pokeType: 1
        }
    };
}

function isWindowShakeRecord(record) {
    if (Number(record?.chatType) !== 1 || !Array.isArray(record?.elements)) {
        return false;
    }
    return record.elements.some(element => {
        const face = element?.faceElement;
        return Number(face?.faceType) === WINDOW_SHAKE_FACE_TYPE &&
            Number(face?.faceIndex) === WINDOW_SHAKE_FACE_INDEX;
    });
}

function shouldArmWindowShakeGuard(context, enabled) {
    return enabled === true &&
        context?.commandNames?.has?.(WINDOW_SHAKE_RECEIVE_COMMAND) === true &&
        Array.isArray(context.records) &&
        context.records.some(isWindowShakeRecord);
}

function createWindowShakeController(options = {}) {
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const guardDurationMs = Number(options.guardDurationMs) > 0
        ? Number(options.guardDurationMs)
        : DEFAULT_GUARD_DURATION_MS;
    const states = new WeakMap();

    function install(browserWindow) {
        if (!browserWindow || browserWindow.isDestroyed?.() || states.has(browserWindow)) {
            return false;
        }
        const state = { blockedUntil: 0 };
        const handleWillMove = event => {
            if (now() >= state.blockedUntil) {
                return;
            }
            event?.preventDefault?.();
            options.onBlocked?.(browserWindow);
        };
        const dispose = () => states.delete(browserWindow);
        browserWindow.on?.('will-move', handleWillMove);
        browserWindow.once?.('closed', dispose);
        states.set(browserWindow, state);
        return true;
    }

    function arm(browserWindow, context, enabled) {
        if (!shouldArmWindowShakeGuard(context, enabled) || browserWindow?.isDestroyed?.()) {
            return false;
        }
        install(browserWindow);
        const state = states.get(browserWindow);
        if (!state) {
            return false;
        }
        state.blockedUntil = Math.max(state.blockedUntil, now() + guardDurationMs);
        return true;
    }

    return {
        arm,
        install
    };
}

module.exports = {
    DEFAULT_GUARD_DURATION_MS,
    WINDOW_SHAKE_FACE_INDEX,
    WINDOW_SHAKE_FACE_TYPE,
    WINDOW_SHAKE_RECEIVE_COMMAND,
    createWindowShakeElement,
    createWindowShakeController,
    isWindowShakeRecord,
    shouldArmWindowShakeGuard
};
