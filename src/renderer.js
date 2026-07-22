import {
    closeNativeContextMenu,
    createMessageContextMenuOrderController,
    getContextMenuItemElements
} from './message-context-menu-order.js';
import { matchesControlLabelValue } from './control-label-match.js';
import { createReactionLimitController } from './reaction-limit.js';
import { createFakeForwardEditor } from './fake-forward-editor.js';
import { createRecallFilterEditor } from './recall-filter-editor.js';

let initializeToolboxSettings = async () => {};
let handleToolboxVueComponentMount = () => {};

(async () => {
    const PANEL_ID = 'qqnt-toolbox-panel';
    const SETTINGS_ID = 'qqnt-toolbox-settings';
    const STYLE_ID = 'qqnt-toolbox-style';
    const SETTINGS_STYLE_ID = 'qqnt-toolbox-settings-style';
    const INLINE_MEDIA_PREVIEW_ID = 'qqnt-toolbox-inline-media-preview';
    const MESSAGE_MEDIA_SELECTOR = [
        '.pic-element',
        '.mix-message__container--pic',
        '.video-element',
        '.msg-preview--video',
        '[class*="video-message"]',
        '.file-element',
        '[class*="file-message"]'
    ].join(',');
    const EMOJI_DOM_ROOT_SELECTOR = [
        '.market-face-element',
        '.market-face',
        '.emoji-element',
        '.sticker-element',
        '.face-element',
        '[class*="market-face" i]',
        '[class*="emoji" i]',
        '[class*="sticker" i]',
        '[class*="expression" i]'
    ].join(',');
    const EMOJI_DOM_EXCLUDED_SELECTOR = [
        '.avatar',
        '[class*="avatar" i]',
        '.reply-message__inner',
        '[class*="reply-message" i]',
        '[class*="reaction" i]',
        '[class*="emoji-like" i]',
        '.q-context-menu',
        '#qqnt-toolbox-inline-media-preview'
    ].join(',');
    const VIDEO_FILE_EXTENSIONS = new Set([
        '3g2', '3gp', 'asf', 'avi', 'flv', 'm2ts', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg',
        'mts', 'ogv', 'ts', 'vob', 'webm', 'wmv'
    ]);
    const IMAGE_FILE_EXTENSIONS = new Set([
        'apng', 'bmp', 'gif', 'jfif', 'jpeg', 'jpg', 'png', 'webp'
    ]);
    const POKE_FALLBACK_MENU_ID = 'qqnt-toolbox-poke-fallback-menu';
    const REPEAT_FALLBACK_MENU_ID = 'qqnt-toolbox-repeat-fallback-menu';
    const POKE_RECALL_NOTICE = '若对方QQ版本过低，可能无法撤回。';
    const STORAGE_KEY = 'qqnt-toolbox-panel-state';
    const ACTIVE_REPEAT_PEER_KEY_PREFIX = 'qqnt-toolbox-active-repeat-peer';
    const MSG_TYPE_GRAY_TIPS = 5;
    const SEND_STATUS_SUCCESS_NO_SEQ = 3;
    const TOOLBOX_MENU_TYPE_REPEAT = 990101;
    const INLINE_MEDIA_BACKGROUND_VALUES = new Set(['transparent', 'white', 'semi', 'black']);
    const RECALL_MARKER_STYLE_VALUES = new Set(['badge', 'outline']);
    const RECALL_FILTER_MODE_VALUES = new Set(['all', 'blacklist', 'whitelist']);
    const TEMP_POKE_CHAT_TYPES = new Set([99, 100, 101, 102, 103, 111, 117, 119]);
    const PROFILE_CARD_HOVER_TRIGGER_SELECTOR = [
        '[class*="avatar"]',
        '.chat-header .panel-header__title',
        '.message-container__name',
        '.message-container__sender-name',
        '[class*="member"][class*="item"]',
        '[class*="member-item"] [class*="name"]',
        '[class*="member-list"] [role="listitem"]',
        '[class*="member-list"] [class*="viewport-list__inner"] > *',
        '[class*="member-list"] [class*="name"]',
        '[class*="group-member"] [class*="viewport-list__inner"] > *',
        '.recent-contact-item .main-info'
    ].join(',');
    const DEFAULT_PANEL_STATE = {
        x: null,
        y: null,
        visible: false,
        hasUserPosition: false,
        groups: {
            interface: false,
            messages: false,
            preventRecall: false,
            entertainment: false,
            updater: false,
            floatingPanel: false,
            simplifySidebar: false,
            simplifyTop: false,
            simplifyChat: false,
            debug: false
        }
    };
    const DEFAULT_CONFIG = {
        fileRetryFixer: {
            enabled: false,
            image: false,
            video: false,
            audio: false,
            otherFiles: false,
            deleteFailedMessage: false,
            archivePassword: ''
        },
        repeatMessage: {
            enabled: false,
            doubleClick: false,
            showInContextMenu: false
        },
        fakeForward: {
            enabled: false
        },
        voiceMessage: {
            enabled: false,
            saveInContextMenu: false,
            forwardInContextMenu: false,
            fakeDurationEnabled: false,
            fakeDurationSeconds: 1
        },
        messageTweaks: {
            promptNoSeq: false,
            customImageSummaryEnabled: false,
            customImageSummary: '',
            removeReactionLimit: false,
            keepReactionPanelOpen: false,
            removeReplyAt: false
        },
        entertainment: {
            autoPokeBack: false,
            autoPokeBackLimit: 1,
            doubleClickAvatarPoke: false,
            rightClickAvatarPoke: false
        },
        floatingPanel: {
            enabled: true,
            shortcut: 'ControlRight'
        },
        updater: {
            checkOnStartup: false
        },
        preventRecall: {
            enabled: false,
            preventSelfMsg: false,
            persistedFiles: false,
            redirectPicPath: false,
            markerStyle: 'badge',
            filterMode: 'all',
            filterPeers: [],
            customColor: false,
            customTextColor: {
                light: '#ff6666',
                dark: '#c70000'
            }
        },
        interfaceTweaks: {
            inlineMediaViewer: false,
            inlineMediaBackground: 'black',
            openEmojiAsImage: false,
            singleClickMediaViewer: false,
            showFullUnreadCount: false,
            messageContextMenuOrder: {
                enabled: false,
                items: [],
                catalog: []
            },
            imageViewerOptimization: false,
            disableImageQrScan: false,
            singleMediaViewer: false,
            goBackMainList: false,
            preventMessageDrag: false,
            preventRecentContactDrag: false,
            preventProfileCardHover: false,
            deleteBubbleSkin: false,
            hiddenWeatherBtn: false,
            hiddenClassicBtn: false,
            hiddenHelpBtn: false,
            hiddenLockBtn: false,
            hiddenLogoutBtn: false,
            hiddenUpdateBtnAndNotice: false,
            removeVipColor: false
        },
        sideBar: {
            top: [],
            bottom: []
        },
        topFuncBar: [],
        chatFuncBar: [],
        debug: {
            enabled: false
        }
    };
    let currentConfig = clonePlain(DEFAULT_CONFIG);
    let configReady = false;
    let repeatResizeObserver = null;
    let repeatRefreshTimer = 0;
    let pokeMenuRequestId = 0;
    let messageContextMenuOrderController = null;
    let messageContextMenuActionsInstalled = false;
    let reactionLimitController = null;
    let fakeForwardEditor = null;
    let recallFilterEditor = null;
    let interfaceObserver = null;
    let interfaceRefreshTimer = 0;
    let unreadCountObserver = null;
    let unreadCountObservedRoot = null;
    let unreadCountRefreshTimer = 0;
    let preventDragActive = false;
    let replyAtEditor = null;
    let replyAtCleanupBusy = false;
    let imageViewerDrag = null;
    let inlineMediaPreviewPreviousFocus = null;
    let inlineMediaPreviewOpenedAt = 0;
    let emojiImageOpenUntil = 0;
    const nativeMediaDispatchEvents = new WeakSet();
    let messageBadgeObserver = null;
    let messageBadgeResizeObserver = null;
    let messageBadgeRefreshTimer = 0;
    let registeredPokeAccountUin = '';
    let lastPokeAccountProbeAt = 0;
    let lastPokeAccountSyncAt = 0;
    let pendingAvatarPoke = null;
    let suppressAvatarClicksUntil = 0;
    let pokeAccountRegistration = null;
    let nativeMenuSuppressionObserver = null;
    let nativeMenuSuppressionTimer = 0;
    let activeRepeatPeerSignature = '';
    let simplifyBarObserver = null;
    let simplifyObservedContainers = [];
    let simplifyConfigSaveTimer = 0;
    let labeledHiddenElements = new Set();
    let activeShortcutCapture = null;
    let rendererReadyDiagnosticSent = false;
    let currentUpdateState = {
        status: 'idle',
        supported: true,
        currentVersion: '',
        latestVersion: '',
        pendingVersion: '',
        reason: ''
    };
    const discoveredSimplifyItems = {
        sideTop: new Map(),
        sideBottom: new Map(),
        topFunc: new Map(),
        chatFunc: new Map()
    };
    const preventDragMouseButtons = new Set([1, 4, 8, 16]);
    const repeatButtonRecords = new WeakMap();
    const pokeAvatarAnimations = new WeakMap();
    const recalledPokeMessageIds = new Set();
    const panelActionFeedbackTimers = new WeakMap();

    if (window.__qqntToolboxRendererInstalled) {
        return;
    }
    window.__qqntToolboxRendererInstalled = true;

    function text(value) {
        return value;
    }

    function clonePlain(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function mergeConfig(value, defaults = DEFAULT_CONFIG) {
        const source = value && typeof value === 'object' ? value : {};
        const result = Array.isArray(defaults) ? [] : {};
        for (const [key, defaultValue] of Object.entries(defaults)) {
            const sourceValue = source[key];
            if (defaultValue && typeof defaultValue === 'object' && !Array.isArray(defaultValue)) {
                result[key] = mergeConfig(sourceValue, defaultValue);
            } else {
                result[key] = typeof sourceValue === typeof defaultValue ? sourceValue : defaultValue;
            }
        }
        return result;
    }

    function getRecallPeerDescriptor(value) {
        const chatType = Number(value?.chatType || value?.peer?.chatType) || 0;
        const peerUid = String(value?.peerUid || value?.peerUin || value?.peer?.peerUid || value?.peer?.peerUin || '').trim();
        if (!chatType || !peerUid) {
            return null;
        }
        return {
            key: `${chatType}:${peerUid}`,
            chatType,
            peerUid,
            label: String(value?.label || '').trim().slice(0, 80)
        };
    }

    function normalizeRendererConfig(value) {
        const config = mergeConfig(value);
        if (!RECALL_MARKER_STYLE_VALUES.has(config.preventRecall.markerStyle)) {
            config.preventRecall.markerStyle = DEFAULT_CONFIG.preventRecall.markerStyle;
        }
        if (!RECALL_FILTER_MODE_VALUES.has(config.preventRecall.filterMode)) {
            config.preventRecall.filterMode = DEFAULT_CONFIG.preventRecall.filterMode;
        }
        const peers = new Map();
        for (const source of Array.isArray(config.preventRecall.filterPeers)
            ? config.preventRecall.filterPeers
            : []) {
            const peer = getRecallPeerDescriptor(source);
            if (peer && !peers.has(peer.key) && peers.size < 256) {
                peers.set(peer.key, peer);
            }
        }
        config.preventRecall.filterPeers = Array.from(peers.values());
        return config;
    }

    function getBridge() {
        return window.qqnt_toolbox || null;
    }

    async function waitForBridge(timeoutMs = 5000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const bridge = getBridge();
            if (bridge?.getConfig) {
                return bridge;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        return getBridge();
    }

    function recordRendererDiagnostic(event, details = {}, level = 'info') {
        if (!isConfigEnabled('debug.enabled')) {
            return;
        }
        const recordEvent = getBridge()?.recordDiagnosticEvent;
        if (typeof recordEvent !== 'function') {
            return;
        }
        try {
            Promise.resolve(recordEvent({ level, event, details })).catch(() => {});
        } catch {
        }
    }

    function syncRendererReadyDiagnostic() {
        if (!isConfigEnabled('debug.enabled')) {
            rendererReadyDiagnosticSent = false;
            return;
        }
        if (rendererReadyDiagnosticSent) {
            return;
        }
        rendererReadyDiagnosticSent = true;
        recordRendererDiagnostic('ready', {
            forwardDetail: isForwardRecordWindow(),
            recordWindow: isSearchChatRecordWindow(),
            repeatMode: isConfigEnabled('repeatMessage.showInContextMenu') ? 'context-menu' : 'side-button',
            inlineMedia: isConfigEnabled('interfaceTweaks.inlineMediaViewer')
        });
    }

    function getByPath(object, path) {
        return String(path).split('.').reduce((value, key) => value?.[key], object);
    }

    function getInlineMediaBackground() {
        const value = String(getByPath(currentConfig, 'interfaceTweaks.inlineMediaBackground') || '');
        return INLINE_MEDIA_BACKGROUND_VALUES.has(value) ? value : 'black';
    }

    function setByPath(object, path, value) {
        const keys = String(path).split('.');
        let target = object;
        for (const key of keys.slice(0, -1)) {
            if (!target[key] || typeof target[key] !== 'object') {
                target[key] = {};
            }
            target = target[key];
        }
        target[keys[keys.length - 1]] = value;
    }

    function isFeatureEnabled(path) {
        return getByPath(currentConfig, path) !== false;
    }

    function isConfigEnabled(path) {
        return getByPath(currentConfig, path) === true;
    }

    function getMessageContextMenuOrderController() {
        if (!messageContextMenuOrderController) {
            messageContextMenuOrderController = createMessageContextMenuOrderController({
                getConfig: () => getByPath(currentConfig, 'interfaceTweaks.messageContextMenuOrder'),
                saveOrder: items => setConfigValue('interfaceTweaks.messageContextMenuOrder.items', items),
                saveCatalog: catalog => setConfigValue('interfaceTweaks.messageContextMenuOrder.catalog', catalog)
            });
            window.__qqntToolboxMessageContextMenu = messageContextMenuOrderController;
        }
        return messageContextMenuOrderController;
    }

    function getReactionLimitController() {
        if (!reactionLimitController) {
            reactionLimitController = createReactionLimitController({
                getCatalog: () => getBridge()?.getReactionEmojiCatalog?.() || [],
                getPeer: getPeerFromRecord,
                resolveRecord: findMessageRecordFromElement,
                sendReaction: async payload => {
                    const result = await getBridge()?.setMessageReaction?.(payload);
                    if (result && result.ok === false) {
                        throw new Error(result.reason || 'Reaction failed.');
                    }
                },
                onError: error => {
                    if (isConfigEnabled('debug.enabled')) {
                        console.warn('[QQNT Toolbox] Reaction failed:', error);
                    }
                }
            });
        }
        return reactionLimitController;
    }

    function getRecallFilterEditor() {
        if (!recallFilterEditor) {
            recallFilterEditor = createRecallFilterEditor({
                getContacts: () => getBridge()?.getRecallContacts?.() || [],
                getMode: () => currentConfig.preventRecall.filterMode,
                getSelected: () => currentConfig.preventRecall.filterPeers,
                save: peers => setConfigValue('preventRecall.filterPeers', peers)
            });
        }
        return recallFilterEditor;
    }

    function syncReactionLimitFeature() {
        getReactionLimitController().sync({
            removeLimit: isConfigEnabled('messageTweaks.removeReactionLimit'),
            keepOpen: isConfigEnabled('messageTweaks.keepReactionPanelOpen')
        });
    }

    function getPanelState() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            return {
                ...DEFAULT_PANEL_STATE,
                ...saved,
                groups: {
                    ...DEFAULT_PANEL_STATE.groups,
                    ...(saved.groups || {})
                }
            };
        } catch {
            return clonePlain(DEFAULT_PANEL_STATE);
        }
    }

    function setPanelState(nextState) {
        const currentState = getPanelState();
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            ...currentState,
            ...nextState,
            groups: {
                ...currentState.groups,
                ...(nextState.groups || {})
            }
        }));
    }

    function isPanelGroupExpanded(groupId) {
        return getPanelState().groups?.[groupId] !== false;
    }

    function setPanelGroupExpanded(groupId, expanded) {
        setPanelState({
            groups: {
                [groupId]: expanded
            }
        });
    }

    function hasSavedPanelPosition(state = getPanelState()) {
        return state.hasUserPosition === true &&
            Number.isFinite(Number(state.x)) &&
            Number.isFinite(Number(state.y));
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function clampPanelPosition(panel, x, y) {
        const rect = panel.getBoundingClientRect();
        const margin = 8;
        return {
            x: clamp(x, margin, Math.max(margin, window.innerWidth - rect.width - margin)),
            y: clamp(y, margin, Math.max(margin, window.innerHeight - rect.height - margin))
        };
    }

    function centerPosition(panel) {
        const rect = panel.getBoundingClientRect();
        return {
            x: Math.max(8, Math.round((window.innerWidth - rect.width) / 2)),
            y: Math.max(8, Math.round((window.innerHeight - rect.height) / 2))
        };
    }

    function applyPosition(panel, x, y) {
        const position = clampPanelPosition(panel, x, y);
        panel.style.left = `${position.x}px`;
        panel.style.top = `${position.y}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        return position;
    }

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
#${PANEL_ID} {
    position: fixed;
    z-index: 2147483000;
    width: min(360px, calc(100vw - 16px));
    height: clamp(400px, 68vh, 560px);
    max-height: calc(100vh - 16px);
    box-sizing: border-box;
    color: var(--text-primary, var(--text-01, #1f2329));
    background: var(--bg_top_light, var(--background-05, var(--background-01, #ffffff)));
    border: 1px solid var(--border-level-1-color, var(--divider, rgba(0, 0, 0, .08)));
    border-radius: 8px;
    box-shadow: var(--shadow-bg-middle-primary, 0 18px 48px rgba(0, 0, 0, .18));
    font: 13px/1.45 var(--font-family, "Microsoft YaHei UI", "Microsoft YaHei", sans-serif);
    overflow: hidden;
    user-select: none;
    display: flex;
    flex-direction: column;
}
#${INLINE_MEDIA_PREVIEW_ID} {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    padding: 32px;
    overflow: hidden;
    outline: none;
    background: #000;
    cursor: zoom-out;
    user-select: none;
    -webkit-app-region: no-drag;
}
#${INLINE_MEDIA_PREVIEW_ID}[data-background="transparent"] {
    background: transparent;
}
#${INLINE_MEDIA_PREVIEW_ID}[data-background="white"] {
    background: #fff;
}
#${INLINE_MEDIA_PREVIEW_ID}[data-background="semi"] {
    background: rgba(0, 0, 0, .72);
}
#${INLINE_MEDIA_PREVIEW_ID}[data-background="black"] {
    background: #000;
}
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-stage {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
}
#${INLINE_MEDIA_PREVIEW_ID}.is-pannable .qqnt-toolbox-media-stage {
    cursor: grab;
    touch-action: none;
}
#${INLINE_MEDIA_PREVIEW_ID}.is-panning .qqnt-toolbox-media-stage {
    cursor: grabbing;
}
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-stage::after {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 24px;
    height: 24px;
    box-sizing: border-box;
    border: 2px solid rgba(255, 255, 255, .28);
    border-top-color: #fff;
    border-radius: 50%;
    content: '';
    opacity: 0;
    pointer-events: none;
    z-index: 2;
    box-shadow: 0 0 0 8px rgba(0, 0, 0, .46);
    transform: translate(-50%, -50%);
}
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-stage.is-loading::after {
    opacity: 1;
    animation: qqnt-toolbox-media-loading .7s linear infinite;
}
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-error {
    display: flex;
    align-items: center;
    gap: 10px;
    color: rgba(255, 255, 255, .82);
    font-size: 13px;
    line-height: 20px;
}
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-retry {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    color: #fff;
    background: rgba(255, 255, 255, .14);
    font: 20px/1 var(--font-family, "Microsoft YaHei UI", "Microsoft YaHei", sans-serif);
    cursor: pointer;
}
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-retry:hover {
    background: rgba(255, 255, 255, .24);
}
@keyframes qqnt-toolbox-media-loading {
    to { transform: translate(-50%, -50%) rotate(360deg); }
}
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-stage > img,
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-stage > video {
    display: block;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    transform-origin: center;
    will-change: transform;
}
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-stage > img {
    pointer-events: none;
}
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-stage > .qqnt-toolbox-media-placeholder {
    opacity: 1;
}
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-stage > video {
    background: #000;
    cursor: default;
}
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-stage > video::-webkit-media-controls-panel {
    padding: 0 8px;
    background-color: rgba(0, 0, 0, .82);
}
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-stage > video::-webkit-media-controls-timeline {
    min-width: 0;
    margin: 0 8px;
}
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-stage > video::-webkit-media-controls-current-time-display,
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-stage > video::-webkit-media-controls-time-remaining-display {
    padding: 0 2px;
    font-variant-numeric: tabular-nums;
}
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-stage > video::-webkit-media-controls-fullscreen-button,
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-stage > video::-webkit-media-controls-overflow-button {
    display: none !important;
}
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-nav {
    position: absolute;
    top: 50%;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    color: #fff;
    background: rgba(24, 24, 24, .68);
    box-shadow: 0 2px 10px rgba(0, 0, 0, .24);
    cursor: pointer;
    transform: translateY(-50%);
}
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-nav:hover:not(:disabled) {
    background: rgba(50, 50, 50, .88);
}
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-nav:disabled {
    opacity: .24;
    cursor: default;
}
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-nav[hidden],
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-counter[hidden] {
    display: none;
}
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-nav--previous {
    left: 18px;
}
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-nav--next {
    right: 18px;
}
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-nav-icon {
    width: 11px;
    height: 11px;
    border-top: 2px solid currentColor;
    border-right: 2px solid currentColor;
}
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-nav--previous .qqnt-toolbox-media-nav-icon {
    margin-left: 4px;
    transform: rotate(-135deg);
}
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-nav--next .qqnt-toolbox-media-nav-icon {
    margin-right: 4px;
    transform: rotate(45deg);
}
#${INLINE_MEDIA_PREVIEW_ID} .qqnt-toolbox-media-counter {
    position: absolute;
    left: 50%;
    bottom: 16px;
    z-index: 2;
    min-width: 48px;
    box-sizing: border-box;
    padding: 5px 10px;
    border-radius: 14px;
    color: #fff;
    background: rgba(24, 24, 24, .68);
    font: 12px/18px var(--font-family, "Microsoft YaHei UI", "Microsoft YaHei", sans-serif);
    text-align: center;
    pointer-events: none;
    transform: translateX(-50%);
}
#${PANEL_ID}[hidden] {
    display: none;
}
#${PANEL_ID} .qqnt-toolbox-titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 42px;
    padding: 0 10px 0 14px;
    box-sizing: border-box;
    border-bottom: 1px solid var(--border-level-1-color, var(--divider, rgba(0, 0, 0, .06)));
    cursor: move;
    flex: none;
}
#${PANEL_ID} .qqnt-toolbox-title {
    min-width: 0;
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
#${PANEL_ID} .qqnt-toolbox-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    color: var(--text-secondary, var(--text-02, #6b7280));
    background: transparent;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
}
#${PANEL_ID} .qqnt-toolbox-close:hover {
    color: var(--text-primary, var(--text-01, #1f2329));
    background: var(--background-02, rgba(127, 127, 127, .12));
}
#${PANEL_ID} .qqnt-toolbox-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    flex: 1;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overflow-y: overlay;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;
}
#${PANEL_ID} .qqnt-toolbox-body::-webkit-scrollbar {
    width: 6px;
    height: 6px;
}
#${PANEL_ID} .qqnt-toolbox-body::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: transparent;
}
#${PANEL_ID} .qqnt-toolbox-body::-webkit-scrollbar-track {
    background: transparent;
}
#${PANEL_ID}:hover .qqnt-toolbox-body {
    scrollbar-color: var(--fill_standard_secondary, rgba(127, 127, 127, .30)) transparent;
}
#${PANEL_ID}:hover .qqnt-toolbox-body::-webkit-scrollbar-thumb {
    background: var(--fill_standard_secondary, rgba(127, 127, 127, .30));
}
#${PANEL_ID} .qqnt-toolbox-body::-webkit-scrollbar-thumb:hover {
    background: var(--fill_standard_primary, rgba(127, 127, 127, .42));
}
#${PANEL_ID} .qqnt-toolbox-category-title {
    flex: none;
    margin: 12px 4px 2px;
    color: var(--text-primary, var(--text-01, #1f2329));
    font-size: 14px;
    font-weight: 700;
    line-height: 24px;
}
#${PANEL_ID} .qqnt-toolbox-category-title:first-child {
    margin-top: 0;
}
#${PANEL_ID} .qqnt-toolbox-section {
    display: grid;
    flex: none;
    min-height: 0;
    border-radius: 8px;
    background: var(--fill_light_primary, var(--background-02, rgba(127, 127, 127, .06)));
    overflow: hidden;
}
#${PANEL_ID} .qqnt-toolbox-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    height: 42px;
    padding: 0 12px;
    border: 0;
    color: var(--text-primary, var(--text-01, #1f2329));
    background: transparent;
    font: inherit;
    cursor: pointer;
}
#${PANEL_ID} .qqnt-toolbox-section-header:hover {
    background: var(--overlay_hover, var(--background-02, rgba(127, 127, 127, .08)));
}
#${PANEL_ID} .qqnt-toolbox-section-title {
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#${PANEL_ID} .qqnt-toolbox-section-icon {
    flex: none;
    width: 8px;
    height: 8px;
    margin-left: 10px;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    opacity: .72;
    transform: rotate(45deg);
    transition: transform .16s ease;
}
#${PANEL_ID} .qqnt-toolbox-section[data-collapsed="true"] .qqnt-toolbox-section-icon {
    transform: rotate(-45deg);
}
#${PANEL_ID} .qqnt-toolbox-section-content {
    display: grid;
    gap: 0;
    padding: 0 10px 8px;
}
#${PANEL_ID} .qqnt-toolbox-section-content[hidden] {
    display: none;
}
#${PANEL_ID} .qqnt-toolbox-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 44px;
    gap: 12px;
    padding: 8px 2px;
    box-sizing: border-box;
    border-top: 1px solid var(--border-level-1-color, var(--divider, rgba(0, 0, 0, .06)));
    background: transparent;
}
#${PANEL_ID} .qqnt-toolbox-section-content .qqnt-toolbox-item:first-child {
    border-top: 0;
}
#${PANEL_ID} .qqnt-toolbox-item[data-child="true"] {
    width: calc(100% - 34px);
    margin-left: 34px;
}
#${PANEL_ID} .qqnt-toolbox-item[data-child="true"] .qqnt-toolbox-item-name {
    font-size: 13px;
    font-weight: 500;
}
#${PANEL_ID} .qqnt-toolbox-item[data-child-level="2"] {
    width: calc(100% - 68px);
    margin-left: 68px;
}
#${PANEL_ID} .qqnt-toolbox-item[data-disabled="true"] {
    opacity: .56;
}
#${PANEL_ID} .qqnt-toolbox-item-main {
    min-width: 0;
    display: grid;
    gap: 2px;
}
#${PANEL_ID} .qqnt-toolbox-item-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#${PANEL_ID} .qqnt-toolbox-item-meta {
    color: var(--text-secondary, var(--text-02, #6b7280));
    font-size: 12px;
}
#${PANEL_ID} .qqnt-toolbox-switch {
    flex: none;
    position: relative;
    width: 42px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    outline: 0;
    background: rgba(127, 127, 127, .35);
    cursor: pointer;
    transition: background-color .16s ease;
}
#${PANEL_ID} .qqnt-toolbox-switch::before {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, .22);
    transition: transform .16s ease;
}
#${PANEL_ID} .qqnt-toolbox-switch[data-checked="true"] {
    background: var(--brand_standard, var(--brand-primary, #2f6bff));
}
#${PANEL_ID} .qqnt-toolbox-switch[data-checked="true"]::before {
    transform: translateX(18px);
}
#${PANEL_ID} .qqnt-toolbox-switch:disabled {
    cursor: default;
    opacity: .58;
}
#${PANEL_ID} .qqnt-toolbox-action {
    flex: none;
    min-width: 64px;
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--border-level-1-color, var(--divider, rgba(127, 127, 127, .22)));
    border-radius: 6px;
    color: var(--text-primary, var(--text-01, #1f2329));
    background: var(--background-02, rgba(127, 127, 127, .08));
    font: inherit;
    cursor: pointer;
}
#${PANEL_ID} .qqnt-toolbox-action:hover:not(:disabled) {
    background: var(--overlay_hover, rgba(127, 127, 127, .14));
}
#${PANEL_ID} .qqnt-toolbox-action:disabled {
    cursor: default;
    opacity: .58;
}
#${PANEL_ID} .qqnt-toolbox-swatches {
    display: flex;
    flex: none;
    gap: 3px;
    padding: 2px;
    border-radius: 6px;
    background: var(--fill_light_primary, var(--background-02, rgba(127, 127, 127, .10)));
}
#${PANEL_ID} .qqnt-toolbox-swatch {
    display: grid;
    place-items: center;
    width: 27px;
    height: 27px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 5px;
    outline: 0;
    background: transparent;
    cursor: pointer;
}
#${PANEL_ID} .qqnt-toolbox-swatch:hover:not(:disabled) {
    background: var(--overlay_hover, rgba(127, 127, 127, .16));
}
#${PANEL_ID} .qqnt-toolbox-swatch[data-checked="true"] {
    border-color: var(--brand_standard, var(--brand-primary, #2f6bff));
    background: var(--overlay_hover, rgba(127, 127, 127, .14));
}
#${PANEL_ID} .qqnt-toolbox-swatch:focus-visible {
    box-shadow: 0 0 0 2px rgba(47, 107, 255, .3);
}
#${PANEL_ID} .qqnt-toolbox-swatch:disabled {
    cursor: default;
}
#${PANEL_ID} .qqnt-toolbox-swatch-sample {
    width: 16px;
    height: 16px;
    box-sizing: border-box;
    border: 1px solid rgba(127, 127, 127, .52);
    border-radius: 3px;
}
#${PANEL_ID} .qqnt-toolbox-swatch[data-value="transparent"] .qqnt-toolbox-swatch-sample {
    background: conic-gradient(#b8bcc4 25%, #fff 0 50%, #b8bcc4 0 75%, #fff 0) 0 0 / 8px 8px;
}
#${PANEL_ID} .qqnt-toolbox-swatch[data-value="white"] .qqnt-toolbox-swatch-sample {
    background: #fff;
}
#${PANEL_ID} .qqnt-toolbox-swatch[data-value="semi"] .qqnt-toolbox-swatch-sample {
    background:
        linear-gradient(rgba(0, 0, 0, .72), rgba(0, 0, 0, .72)),
        conic-gradient(#b8bcc4 25%, #fff 0 50%, #b8bcc4 0 75%, #fff 0) 0 0 / 8px 8px;
}
#${PANEL_ID} .qqnt-toolbox-swatch[data-value="black"] .qqnt-toolbox-swatch-sample {
    background: #000;
}
#${PANEL_ID} .qqnt-toolbox-choices {
    display: flex;
    flex: none;
    gap: 3px;
    padding: 2px;
    border-radius: 6px;
    background: var(--fill_light_primary, var(--background-02, rgba(127, 127, 127, .10)));
}
#${PANEL_ID} .qqnt-toolbox-choice {
    min-width: 42px;
    height: 26px;
    padding: 0 8px;
    border: 1px solid transparent;
    border-radius: 5px;
    outline: 0;
    color: var(--text-secondary, var(--text-02, #6b7280));
    background: transparent;
    font: inherit;
    font-size: 12px;
    white-space: nowrap;
    cursor: pointer;
}
#${PANEL_ID} .qqnt-toolbox-choice:hover:not(:disabled) {
    color: var(--text-primary, var(--text-01, #1f2329));
    background: var(--overlay_hover, rgba(127, 127, 127, .16));
}
#${PANEL_ID} .qqnt-toolbox-choice[data-checked="true"] {
    color: var(--brand_standard, var(--brand-primary, #2f6bff));
    border-color: var(--brand_standard, var(--brand-primary, #2f6bff));
    background: var(--overlay_hover, rgba(127, 127, 127, .14));
}
#${PANEL_ID} .qqnt-toolbox-choice[data-checked="true"]:hover:not(:disabled) {
    color: var(--brand_standard, var(--brand-primary, #2f6bff));
}
#${PANEL_ID} .qqnt-toolbox-choice:focus-visible {
    box-shadow: 0 0 0 2px rgba(47, 107, 255, .3);
}
#${PANEL_ID} .qqnt-toolbox-choice:disabled {
    cursor: default;
}
#${PANEL_ID} .qqnt-toolbox-action[data-danger="true"] {
    color: #ff5a5f;
    border-color: rgba(255, 90, 95, .35);
    background: rgba(255, 90, 95, .10);
}
#${PANEL_ID} .qqnt-toolbox-action[data-result="success"] {
    color: var(--brand_standard, var(--brand-primary, #2f6bff));
}
#${PANEL_ID} .qqnt-toolbox-action[data-result="error"] {
    color: #ff5a5f;
}
#${PANEL_ID} .qqnt-toolbox-color-pair {
    flex: none;
    display: flex;
    width: 64px;
    height: 26px;
    border: 1px solid var(--border-level-1-color, var(--divider, rgba(127, 127, 127, .22)));
    border-radius: 6px;
    overflow: hidden;
    background: var(--background-02, rgba(127, 127, 127, .08));
}
#${PANEL_ID} .qqnt-toolbox-color-input {
    width: 32px;
    height: 26px;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
}
#${PANEL_ID} .qqnt-toolbox-color-input:disabled {
    cursor: default;
}
#${PANEL_ID} .qqnt-toolbox-color-input::-webkit-color-swatch-wrapper {
    padding: 0;
}
#${PANEL_ID} .qqnt-toolbox-color-input::-webkit-color-swatch {
    border: 0;
}
#${PANEL_ID} .qqnt-toolbox-password-input,
#${PANEL_ID} .qqnt-toolbox-text-input {
    flex: none;
    width: 128px;
    height: 30px;
    padding: 0 9px;
    box-sizing: border-box;
    border: 1px solid var(--border-level-1-color, var(--divider, rgba(127, 127, 127, .22)));
    border-radius: 6px;
    outline: 0;
    color: var(--text-primary, var(--text_primary, var(--text-01, #1f2329))) !important;
    -webkit-text-fill-color: var(--text-primary, var(--text_primary, var(--text-01, #1f2329))) !important;
    caret-color: var(--text-primary, var(--text_primary, var(--text-01, #1f2329)));
    background: var(--fill_light_primary, var(--background-02, rgba(127, 127, 127, .12))) !important;
    font: inherit;
    user-select: text;
}
#${PANEL_ID} .qqnt-toolbox-password-input:focus,
#${PANEL_ID} .qqnt-toolbox-text-input:focus {
    border-color: var(--brand_standard, var(--brand-primary, #2f6bff));
    background: var(--overlay_hover, var(--fill_light_primary, rgba(127, 127, 127, .18))) !important;
}
#${PANEL_ID} .qqnt-toolbox-password-input:disabled,
#${PANEL_ID} .qqnt-toolbox-text-input:disabled {
    cursor: default;
    opacity: .58;
}
#${PANEL_ID} .qqnt-toolbox-number-control {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-secondary, var(--text-02, #6b7280));
    font-size: 12px;
}
#${PANEL_ID} .qqnt-toolbox-number-input {
    width: 56px;
    height: 28px;
    padding: 0 5px;
    box-sizing: border-box;
    border: 1px solid var(--border-level-1-color, var(--divider, rgba(127, 127, 127, .22)));
    border-radius: 6px;
    outline: 0;
    color: var(--text-primary, var(--text_primary, var(--text-01, #1f2329))) !important;
    -webkit-text-fill-color: var(--text-primary, var(--text_primary, var(--text-01, #1f2329))) !important;
    caret-color: var(--text-primary, var(--text_primary, var(--text-01, #1f2329)));
    background: var(--fill_light_primary, var(--background-02, rgba(127, 127, 127, .12))) !important;
    font: inherit;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-align: center;
    user-select: text;
    appearance: none;
    -moz-appearance: none;
}
#${PANEL_ID} .qqnt-toolbox-number-input:focus {
    border-color: var(--brand_standard, var(--brand-primary, #2f6bff));
    background: var(--overlay_hover, var(--fill_light_primary, rgba(127, 127, 127, .18))) !important;
}
#${PANEL_ID} .qqnt-toolbox-number-input:disabled {
    cursor: default;
    opacity: .58;
}
#${PANEL_ID} .qqnt-toolbox-shortcut-button {
    flex: none;
    min-width: 96px;
    max-width: 150px;
    height: 30px;
    padding: 0 10px;
    overflow: hidden;
    border: 1px solid var(--border-level-1-color, var(--divider, rgba(127, 127, 127, .22)));
    border-radius: 6px;
    color: var(--text-primary, var(--text_primary, var(--text-01, #1f2329)));
    background: var(--fill_light_primary, var(--background-02, rgba(127, 127, 127, .12)));
    font: inherit;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
}
#${PANEL_ID} .qqnt-toolbox-shortcut-button:hover,
#${PANEL_ID} .qqnt-toolbox-shortcut-button[data-capturing="true"] {
    border-color: var(--brand_standard, var(--brand-primary, #2f6bff));
    background: var(--overlay_hover, rgba(127, 127, 127, .18));
}
#${PANEL_ID} .qqnt-toolbox-shortcut-button:disabled {
    cursor: default;
    opacity: .58;
}
.qqnt-toolbox-poke-recall-native-hidden {
    display: none !important;
}
.qqnt-toolbox-fallback-context-menu {
    position: fixed;
    z-index: 2147483646;
    width: max-content !important;
    min-width: 0 !important;
    max-width: none !important;
    height: auto !important;
    min-height: 0 !important;
    padding: 4px !important;
    box-sizing: border-box;
    border: 1px solid var(--border-level-1-color, var(--divider, rgba(127, 127, 127, .18)));
    border-radius: 6px;
    color: var(--text-primary, var(--text-01, #1f2329));
    background: var(--bg_top_light, var(--background-05, var(--background-01, #fff)));
    box-shadow: var(--shadow-bg-middle-primary, 0 8px 24px rgba(0, 0, 0, .18));
}
.qqnt-toolbox-fallback-context-menu .q-context-menu-item {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    width: auto !important;
    min-width: 0 !important;
    max-width: none !important;
    height: 32px !important;
    min-height: 32px !important;
    max-height: 32px !important;
    margin: 0 !important;
    padding: 0 8px !important;
    box-sizing: border-box;
    border-radius: 4px;
    cursor: default;
    font-size: 14px;
    line-height: 32px;
    letter-spacing: 0;
    user-select: none;
}
.qqnt-toolbox-fallback-context-menu .q-context-menu-item:hover {
    background: var(--overlay_hover, var(--background-hover, rgba(127, 127, 127, .12)));
}
.qqnt-toolbox-fallback-context-menu .q-context-menu-item__icon {
    display: flex;
    flex: 0 0 16px;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
}
.qqnt-toolbox-fallback-context-menu .q-context-menu-item__text {
    display: block;
    flex: 0 1 auto;
    min-width: 0;
    line-height: 20px;
    letter-spacing: 0;
    text-align: left;
    white-space: nowrap;
}
body.qqnt-toolbox-side-repeat .message .qqnt-toolbox-repeat-slot.plus-one-btn,
body.qqnt-toolbox-side-repeat .ml-item .qqnt-toolbox-repeat-slot.plus-one-btn {
    position: absolute !important;
    right: auto !important;
    bottom: auto !important;
    z-index: 3;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 28px !important;
    min-width: 28px !important;
    max-width: 28px !important;
    height: 28px !important;
    min-height: 28px !important;
    max-height: 28px !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
    border: 0 !important;
    border-radius: 50% !important;
    outline: 0 !important;
    background: transparent !important;
    box-shadow: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
    cursor: pointer;
    transform: translateY(-50%) !important;
    overflow-anchor: none;
}
body.qqnt-toolbox-side-repeat .qqnt-toolbox-repeat-slot.plus-one-btn > svg {
    display: block !important;
    flex: none !important;
    width: 26px !important;
    height: 26px !important;
}
body.qqnt-toolbox-side-repeat .message:hover .qqnt-toolbox-repeat-slot.plus-one-btn,
body.qqnt-toolbox-side-repeat .ml-item:hover .qqnt-toolbox-repeat-slot.plus-one-btn {
    visibility: visible !important;
    opacity: 1 !important;
    pointer-events: auto !important;
}
body.qqnt-toolbox-side-repeat .message .plus-one-btn:not(.qqnt-toolbox-repeat-slot),
body.qqnt-toolbox-side-repeat .ml-item .plus-one-btn:not(.qqnt-toolbox-repeat-slot) {
    display: none !important;
}
.chat-record-list .plus-one-btn,
.msg-record-container .plus-one-btn,
.record-msg-panel .plus-one-btn,
body.qqnt-toolbox-search-record .plus-one-btn {
    display: none !important;
}
body.qqnt-toolbox-context-repeat .message .plus-one-btn:not(.qqnt-toolbox-repeat-menu-plus-one),
body.qqnt-toolbox-context-repeat .ml-item .plus-one-btn:not(.qqnt-toolbox-repeat-menu-plus-one),
body.qqnt-toolbox-context-repeat .qqnt-toolbox-repeat-slot {
    display: none !important;
}
.qqnt-toolbox-repeat-menu-plus-one {
    display: block !important;
    width: 16px !important;
    height: 16px !important;
    flex: none !important;
    overflow: visible;
    pointer-events: none !important;
    transform: none !important;
    color: inherit !important;
    --brand_standard: currentColor;
    --brand-primary: currentColor;
}
body.qqnt-toolbox-hide-weather .weather-widget,
body.qqnt-toolbox-hide-classic .window-control-area .narrow-toggler,
body.qqnt-toolbox-hide-update [class*="update-notice"],
body.qqnt-toolbox-hide-update [class*="updateNotice"],
body.qqnt-toolbox-hide-update [class*="upgrade-notice"],
body.qqnt-toolbox-hide-update [class*="upgradeNotice"] {
    display: none !important;
}
body.qqnt-toolbox-remove-vip-color .recent-contact .viewport-list .recent-contact-item .item__content .main-info .text-ellipsis,
body.qqnt-toolbox-remove-vip-color .aio .chat-header .panel-header__title .chat-header__contact-name {
    color: unset !important;
}
.recent-contact-item .q-badge-num.qqnt-toolbox-full-unread-count {
    width: auto !important;
    min-width: 18px !important;
    max-width: none !important;
    padding-right: 5px !important;
    padding-left: 5px !important;
    box-sizing: border-box !important;
    font-variant-numeric: tabular-nums;
}
.recent-contact-item .q-badge-num.qqnt-toolbox-full-unread-count > i {
    width: auto !important;
    min-width: 0 !important;
    max-width: none !important;
    overflow: visible !important;
}
.qqnt-toolbox-hidden {
    display: none !important;
}
.qqnt-toolbox-status-badge {
    position: absolute;
    top: -6px;
    right: -7px;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    opacity: .58;
    user-select: none;
    pointer-events: auto;
    transition: opacity .15s ease, transform .15s ease;
    transform: scale(.92);
    overflow-anchor: none;
}
.qqnt-toolbox-recall-badge {
    color: var(--qqnt-toolbox-recall-color, var(--text-secondary, var(--text-02, #8a8f99)));
}
.qqnt-toolbox-recall-badge::before {
    content: "";
    width: 14px;
    height: 14px;
    background: currentColor;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 12a9 9 0 1 0 3-6.7L3 8'/%3E%3Cpath d='M3 3v5h5'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 12a9 9 0 1 0 3-6.7L3 8'/%3E%3Cpath d='M3 3v5h5'/%3E%3C/svg%3E") center / contain no-repeat;
}
.qqnt-toolbox-recall-outline {
    position: absolute;
    z-index: 1;
    box-sizing: border-box;
    border: 1.5px solid currentColor;
    color: var(--qqnt-toolbox-recall-color, var(--text-secondary, var(--text-02, #8a8f99)));
    box-shadow: 0 0 7px currentColor;
    opacity: .78;
    user-select: none;
    pointer-events: none;
    overflow-anchor: none;
}
.qqnt-toolbox-noseq-badge {
    color: var(--warning-color, var(--warning-text-color, #d97706));
}
.qqnt-toolbox-noseq-badge::before {
    content: "!";
    display: flex;
    width: 12px;
    height: 12px;
    align-items: center;
    justify-content: center;
    border: 1.5px solid currentColor;
    border-radius: 50%;
    font: 700 9px/12px Arial, sans-serif;
}
.message:hover .qqnt-toolbox-status-badge,
.ml-item:hover .qqnt-toolbox-status-badge,
.qqnt-toolbox-status-badge:hover {
    opacity: 1;
    transform: scale(1);
}
[data-qqnt-toolbox-status-anchor="true"] {
    position: relative !important;
}
[data-qqnt-toolbox-repeat-anchor="true"] {
    position: relative !important;
}
`;
        document.head.appendChild(style);
    }

    async function injectSettingsStyle() {
        let link = document.getElementById(SETTINGS_STYLE_ID);
        if (!link) {
            link = document.createElement('link');
            link.id = SETTINGS_STYLE_ID;
            link.rel = 'stylesheet';
            link.href = new URL('./settings.css', import.meta.url).href;
            document.head.appendChild(link);
        }
        if (link.sheet) {
            return;
        }
        await new Promise(resolve => {
            const done = () => resolve();
            link.addEventListener('load', done, { once: true });
            link.addEventListener('error', done, { once: true });
            setTimeout(done, 1000);
        });
    }

    function createElement(tagName, className, textContent) {
        const element = document.createElement(tagName);
        if (className) {
            element.className = className;
        }
        if (textContent !== undefined) {
            element.textContent = textContent;
        }
        return element;
    }

    function parseShortcut(value) {
        const parts = String(value || DEFAULT_CONFIG.floatingPanel.shortcut)
            .split('+')
            .map(part => part.trim())
            .filter(Boolean);
        const code = parts.pop() || DEFAULT_CONFIG.floatingPanel.shortcut;
        return {
            code,
            ctrl: parts.includes('Ctrl'),
            shift: parts.includes('Shift'),
            alt: parts.includes('Alt'),
            meta: parts.includes('Meta')
        };
    }

    function shortcutFromEvent(event) {
        const code = String(event.code || '');
        if (!code || code === 'Unidentified') {
            return '';
        }
        const parts = [];
        if (event.ctrlKey && !code.startsWith('Control')) {
            parts.push('Ctrl');
        }
        if (event.shiftKey && !code.startsWith('Shift')) {
            parts.push('Shift');
        }
        if (event.altKey && !code.startsWith('Alt')) {
            parts.push('Alt');
        }
        if (event.metaKey && !code.startsWith('Meta')) {
            parts.push('Meta');
        }
        parts.push(code);
        return parts.join('+');
    }

    function isModifierCode(code) {
        return /^(Control|Shift|Alt|Meta)(Left|Right)$/.test(String(code || ''));
    }

    function formatShortcut(value) {
        const shortcut = parseShortcut(value);
        const labels = {
            ControlLeft: '左 Ctrl',
            ControlRight: '右 Ctrl',
            ShiftLeft: '左 Shift',
            ShiftRight: '右 Shift',
            AltLeft: '左 Alt',
            AltRight: '右 Alt',
            MetaLeft: '左 Win',
            MetaRight: '右 Win',
            Space: '空格',
            Enter: 'Enter',
            Escape: 'Esc',
            Tab: 'Tab',
            Backspace: 'Backspace',
            Delete: 'Delete',
            Insert: 'Insert',
            Home: 'Home',
            End: 'End',
            PageUp: 'PageUp',
            PageDown: 'PageDown',
            ArrowUp: '↑',
            ArrowDown: '↓',
            ArrowLeft: '←',
            ArrowRight: '→'
        };
        let codeLabel = labels[shortcut.code] || shortcut.code;
        if (/^Key[A-Z]$/.test(shortcut.code)) {
            codeLabel = shortcut.code.slice(3);
        } else if (/^Digit\d$/.test(shortcut.code)) {
            codeLabel = shortcut.code.slice(5);
        }
        return [
            shortcut.ctrl && 'Ctrl',
            shortcut.shift && 'Shift',
            shortcut.alt && 'Alt',
            shortcut.meta && 'Win',
            codeLabel
        ].filter(Boolean).join(' + ');
    }

    function matchesShortcut(event, value) {
        const shortcut = parseShortcut(value);
        if (event.code !== shortcut.code) {
            return false;
        }
        return (shortcut.code.startsWith('Control') || event.ctrlKey === shortcut.ctrl) &&
            (shortcut.code.startsWith('Shift') || event.shiftKey === shortcut.shift) &&
            (shortcut.code.startsWith('Alt') || event.altKey === shortcut.alt) &&
            (shortcut.code.startsWith('Meta') || event.metaKey === shortcut.meta);
    }

    function applyItemOptions(item, options = {}) {
        if (options.requires) {
            const requirements = Array.isArray(options.requires) ? options.requires : [options.requires];
            item.dataset.requires = requirements.join('|');
        }
        if (options.inverted) {
            item.dataset.inverted = 'true';
        }
        const childLevel = Number(options.childLevel) || (options.child ? 1 : 0);
        if (childLevel > 0) {
            item.dataset.child = 'true';
            item.dataset.childLevel = String(childLevel);
        }
    }

    function createSwitchItem(name, meta, configPath, options = {}) {
        const item = createElement('div', 'qqnt-toolbox-item');
        item.dataset.configPath = configPath;
        applyItemOptions(item, options);
        const itemMain = createElement('div', 'qqnt-toolbox-item-main');
        itemMain.append(createElement('div', 'qqnt-toolbox-item-name', name));
        if (meta) {
            itemMain.append(createElement('div', 'qqnt-toolbox-item-meta', meta));
        }
        const switchButton = createElement('button', 'qqnt-toolbox-switch');
        switchButton.type = 'button';
        switchButton.dataset.configPath = configPath;
        switchButton.setAttribute('role', 'switch');
        switchButton.setAttribute('aria-label', name);
        item.append(itemMain, switchButton);
        return item;
    }

    function createSwatchItem(name, meta, configPath, choices, options = {}) {
        const item = createElement('div', 'qqnt-toolbox-item');
        item.dataset.configPath = configPath;
        item.dataset.swatchItem = 'true';
        applyItemOptions(item, options);
        const itemMain = createElement('div', 'qqnt-toolbox-item-main');
        itemMain.append(createElement('div', 'qqnt-toolbox-item-name', name));
        if (meta) {
            itemMain.append(createElement('div', 'qqnt-toolbox-item-meta', meta));
        }
        const control = createElement('div', 'qqnt-toolbox-swatches');
        control.setAttribute('role', 'radiogroup');
        control.setAttribute('aria-label', name);
        for (const choice of Array.isArray(choices) ? choices : []) {
            const button = createElement('button', 'qqnt-toolbox-swatch');
            button.type = 'button';
            button.dataset.configPath = configPath;
            button.dataset.value = String(choice.value);
            button.setAttribute('role', 'radio');
            button.setAttribute('aria-label', choice.label);
            button.title = choice.label;
            button.append(createElement('span', 'qqnt-toolbox-swatch-sample'));
            control.append(button);
        }
        item.append(itemMain, control);
        return item;
    }

    function createChoiceItem(name, meta, configPath, choices, options = {}) {
        const item = createElement('div', 'qqnt-toolbox-item');
        item.dataset.configPath = configPath;
        item.dataset.choiceItem = 'true';
        applyItemOptions(item, options);
        const itemMain = createElement('div', 'qqnt-toolbox-item-main');
        itemMain.append(createElement('div', 'qqnt-toolbox-item-name', name));
        if (meta) {
            itemMain.append(createElement('div', 'qqnt-toolbox-item-meta', meta));
        }
        const control = createElement('div', 'qqnt-toolbox-choices');
        control.setAttribute('role', 'radiogroup');
        control.setAttribute('aria-label', name);
        for (const choice of Array.isArray(choices) ? choices : []) {
            const button = createElement('button', 'qqnt-toolbox-choice', choice.label);
            button.type = 'button';
            button.dataset.configPath = configPath;
            button.dataset.value = String(choice.value);
            button.setAttribute('role', 'radio');
            control.append(button);
        }
        item.append(itemMain, control);
        return item;
    }

    function createPasswordItem(name, meta, configPath, options = {}) {
        const item = createElement('div', 'qqnt-toolbox-item');
        item.dataset.configPath = configPath;
        item.dataset.passwordItem = 'true';
        applyItemOptions(item, options);
        const itemMain = createElement('div', 'qqnt-toolbox-item-main');
        itemMain.append(createElement('div', 'qqnt-toolbox-item-name', name));
        if (meta) {
            itemMain.append(createElement('div', 'qqnt-toolbox-item-meta', meta));
        }
        const input = createElement('input', 'qqnt-toolbox-password-input');
        input.type = 'password';
        input.autocomplete = 'off';
        input.maxLength = 128;
        input.dataset.configPath = configPath;
        input.setAttribute('aria-label', name);
        item.append(itemMain, input);
        return item;
    }

    function createTextItem(name, meta, configPath, options = {}) {
        const item = createElement('div', 'qqnt-toolbox-item');
        item.dataset.configPath = configPath;
        item.dataset.textItem = 'true';
        applyItemOptions(item, options);
        const itemMain = createElement('div', 'qqnt-toolbox-item-main');
        itemMain.append(createElement('div', 'qqnt-toolbox-item-name', name));
        if (meta) {
            itemMain.append(createElement('div', 'qqnt-toolbox-item-meta', meta));
        }
        const input = createElement('input', 'qqnt-toolbox-text-input');
        input.type = 'text';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.maxLength = Number(options.maxLength) || 128;
        input.dataset.configPath = configPath;
        input.setAttribute('aria-label', name);
        item.append(itemMain, input);
        return item;
    }

    function createNumberItem(name, meta, configPath, options = {}) {
        const item = createElement('div', 'qqnt-toolbox-item');
        item.dataset.configPath = configPath;
        item.dataset.numberItem = 'true';
        applyItemOptions(item, options);
        const itemMain = createElement('div', 'qqnt-toolbox-item-main');
        itemMain.append(createElement('div', 'qqnt-toolbox-item-name', name));
        if (meta) {
            itemMain.append(createElement('div', 'qqnt-toolbox-item-meta', meta));
        }
        const control = createElement('div', 'qqnt-toolbox-number-control');
        const input = createElement('input', 'qqnt-toolbox-number-input');
        input.type = 'text';
        input.inputMode = 'numeric';
        input.pattern = '[0-9]*';
        input.maxLength = String(options.maxLength ?? 4);
        input.min = String(options.min ?? 1);
        input.max = String(options.max ?? 99);
        input.step = String(options.step ?? 1);
        input.dataset.configPath = configPath;
        input.setAttribute('aria-label', name);
        control.append(input);
        if (options.suffix) {
            control.append(createElement('span', 'qqnt-toolbox-number-suffix', options.suffix));
        }
        item.append(itemMain, control);
        return item;
    }

    function createShortcutItem(name, meta, configPath, options = {}) {
        const item = createElement('div', 'qqnt-toolbox-item');
        item.dataset.configPath = configPath;
        item.dataset.shortcutItem = 'true';
        applyItemOptions(item, options);
        const itemMain = createElement('div', 'qqnt-toolbox-item-main');
        itemMain.append(createElement('div', 'qqnt-toolbox-item-name', name));
        if (meta) {
            itemMain.append(createElement('div', 'qqnt-toolbox-item-meta', meta));
        }
        const button = createElement('button', 'qqnt-toolbox-shortcut-button');
        button.type = 'button';
        button.dataset.configPath = configPath;
        button.setAttribute('aria-label', name);
        item.append(itemMain, button);
        return item;
    }

    function createActionItem(name, meta, action, options = {}) {
        const item = createElement('div', 'qqnt-toolbox-item');
        item.dataset.action = action;
        applyItemOptions(item, options);
        const itemMain = createElement('div', 'qqnt-toolbox-item-main');
        itemMain.append(createElement('div', 'qqnt-toolbox-item-name', name));
        if (meta) {
            itemMain.append(createElement('div', 'qqnt-toolbox-item-meta', meta));
        }
        const button = createElement('button', 'qqnt-toolbox-action', options.label || text('\u6253\u5f00'));
        button.type = 'button';
        button.dataset.action = action;
        if (options.updateRole) {
            item.dataset.updateRole = options.updateRole;
        }
        if (options.danger) {
            button.dataset.danger = 'true';
        }
        item.append(itemMain, button);
        return item;
    }

    function createColorPairItem(name, meta, lightPath, darkPath, options = {}) {
        const item = createElement('div', 'qqnt-toolbox-item');
        item.dataset.colorItem = 'true';
        applyItemOptions(item, options);
        const itemMain = createElement('div', 'qqnt-toolbox-item-main');
        itemMain.append(createElement('div', 'qqnt-toolbox-item-name', name));
        if (meta) {
            itemMain.append(createElement('div', 'qqnt-toolbox-item-meta', meta));
        }
        const controls = createElement('div', 'qqnt-toolbox-color-pair');
        const lightInput = createElement('input', 'qqnt-toolbox-color-input');
        lightInput.type = 'color';
        lightInput.dataset.configPath = lightPath;
        lightInput.title = text('亮色主题');
        const darkInput = createElement('input', 'qqnt-toolbox-color-input');
        darkInput.type = 'color';
        darkInput.dataset.configPath = darkPath;
        darkInput.title = text('暗色主题');
        controls.append(lightInput, darkInput);
        item.append(itemMain, controls);
        return item;
    }

    function createSection(groupId, title, items) {
        const section = createElement('div', 'qqnt-toolbox-section');
        section.dataset.groupId = groupId;
        const header = createElement('button', 'qqnt-toolbox-section-header');
        header.type = 'button';
        header.dataset.groupId = groupId;
        header.setAttribute('aria-controls', `${PANEL_ID}-${groupId}`);
        header.append(
            createElement('span', 'qqnt-toolbox-section-title', title),
            createElement('span', 'qqnt-toolbox-section-icon')
        );
        const content = createElement('div', 'qqnt-toolbox-section-content');
        content.id = `${PANEL_ID}-${groupId}`;
        content.append(...items);
        section.append(header, content);
        return section;
    }

    function createCategoryTitle(title) {
        return createElement('div', 'qqnt-toolbox-category-title', title);
    }

    function normalizeColorHex(value, fallback = '#ff6666') {
        const textValue = String(value || '').trim();
        return /^#[0-9a-f]{6}$/i.test(textValue) ? textValue : fallback;
    }

    function updateGroupUi(panel = document.getElementById(PANEL_ID)) {
        if (!panel) {
            return;
        }
        panel.querySelectorAll('.qqnt-toolbox-section[data-group-id]').forEach(section => {
            const groupId = section.dataset.groupId;
            const expanded = isPanelGroupExpanded(groupId);
            section.dataset.collapsed = String(!expanded);
            const header = section.querySelector('.qqnt-toolbox-section-header');
            const content = section.querySelector('.qqnt-toolbox-section-content');
            header?.setAttribute('aria-expanded', String(expanded));
            if (content) {
                content.hidden = !expanded;
            }
        });
    }

    function createSimplifyPlaceholder() {
        const item = createElement('div', 'qqnt-toolbox-item');
        item.dataset.disabled = 'true';
        const itemMain = createElement('div', 'qqnt-toolbox-item-main');
        itemMain.append(createElement('div', 'qqnt-toolbox-item-name', text('\u7b49\u5f85\u8bfb\u53d6\u680f\u76ee')));
        item.appendChild(itemMain);
        return item;
    }

    function createSimplifyItems(configPath, items, includePlaceholder = true) {
        if (!Array.isArray(items) || !items.length) {
            return includePlaceholder ? [createSimplifyPlaceholder()] : [];
        }
        return items.map((item, index) => createSwitchItem(
            normalizeText(item?.name) || normalizeText(item?.id) || text('\u672a\u77e5\u680f\u76ee'),
            '',
            `${configPath}.${index}.enabled`
        ));
    }

    function renderSimplifySections(panel = document.getElementById(PANEL_ID)) {
        if (!panel) {
            return;
        }
        const sidebarItems = [
            ...createSimplifyItems('sideBar.top', currentConfig.sideBar?.top, false),
            ...createSimplifyItems('sideBar.bottom', currentConfig.sideBar?.bottom, false)
        ];
        if (!sidebarItems.length) {
            sidebarItems.push(createSimplifyPlaceholder());
        }
        const contents = {
            simplifySidebar: sidebarItems,
            simplifyTop: createSimplifyItems('topFuncBar', currentConfig.topFuncBar),
            simplifyChat: createSimplifyItems('chatFuncBar', currentConfig.chatFuncBar)
        };
        for (const [groupId, items] of Object.entries(contents)) {
            panel.querySelector(`.qqnt-toolbox-section[data-group-id="${groupId}"] .qqnt-toolbox-section-content`)
                ?.replaceChildren(...items);
        }
    }

    function getConfigRoots() {
        return [document.getElementById(PANEL_ID), document.getElementById(SETTINGS_ID)].filter(Boolean);
    }

    function refreshConfigViews() {
        for (const root of getConfigRoots()) {
            renderSimplifySections(root);
            updateConfigUi(root);
        }
        syncInlineMediaPreviewBackground();
        fakeForwardEditor?.sync();
        const panel = document.getElementById(PANEL_ID);
        if (panel && !panel.hidden && !isConfigEnabled('floatingPanel.enabled')) {
            setVisible(panel, false);
        }
    }

    function createPanel(options = {}) {
        const settingsMode = options.settings === true;
        const rootId = settingsMode ? SETTINGS_ID : PANEL_ID;
        let panel = document.getElementById(rootId);
        if (panel) {
            renderSimplifySections(panel);
            updateConfigUi(panel);
            return panel;
        }
        injectStyle();

        panel = document.createElement('div');
        panel.id = rootId;
        panel.hidden = !settingsMode;
        if (settingsMode) {
            panel.className = 'qqnt-toolbox-settings-root';
        }

        const titlebar = createElement('div', 'qqnt-toolbox-titlebar');
        titlebar.append(
            createElement('div', 'qqnt-toolbox-title', 'QQNT Toolbox')
        );
        const close = createElement('button', 'qqnt-toolbox-close', '\u00d7');
        close.type = 'button';
        close.setAttribute('aria-label', text('\u5173\u95ed'));
        titlebar.append(close);

        const body = createElement('div', 'qqnt-toolbox-body');
        body.append(
            createCategoryTitle(text('功能')),
            createSection('interface', text('界面调整'), [
                createSwitchItem(text('窗口内查看媒体'), text('图片和视频不再打开独立预览窗口'), 'interfaceTweaks.inlineMediaViewer'),
                createSwatchItem(text('媒体查看背景'), text('选择预览遮罩颜色'), 'interfaceTweaks.inlineMediaBackground', [
                    { value: 'transparent', label: text('透明') },
                    { value: 'white', label: text('白色') },
                    { value: 'semi', label: text('半透明') },
                    { value: 'black', label: text('黑色') }
                ], {
                    requires: 'interfaceTweaks.inlineMediaViewer',
                    child: true
                }),
                createSwitchItem(text('以图片方式打开表情'), text('点击商城表情时按图片打开'), 'interfaceTweaks.openEmojiAsImage'),
                createSwitchItem(text('单击查看媒体'), text('只改变打开手势，不受查看器类型影响'), 'interfaceTweaks.singleClickMediaViewer'),
                createSwitchItem(text('显示完整未读数'), text('消息列表未读数不再以 99+ 封顶'), 'interfaceTweaks.showFullUnreadCount'),
                createSwitchItem(text('自定义消息菜单排序'), text('调整消息右键菜单中的全部项目'), 'interfaceTweaks.messageContextMenuOrder.enabled'),
                createActionItem(text('菜单顺序'), '', 'editMessageContextMenuOrder', {
                    label: text('编辑'),
                    requires: 'interfaceTweaks.messageContextMenuOrder.enabled',
                    child: true
                }),
                createSwitchItem(text('图片查看器优化'), text('点击空白关闭、拖动窗口'), 'interfaceTweaks.imageViewerOptimization'),
                createSwitchItem(text('图片自动二维码识别'), text('关闭可避免加载本地识码模型'), 'interfaceTweaks.disableImageQrScan', {
                    inverted: true
                }),
                createSwitchItem(text('单窗口媒体预览'), text('打开新媒体时关闭旧预览窗口'), 'interfaceTweaks.singleMediaViewer'),
                createSwitchItem(text('侧键返回主列表'), text('鼠标侧键返回会话列表'), 'interfaceTweaks.goBackMainList'),
                createSwitchItem(text('阻止消息窗口拖拽操作'), text('减少误选和误拖'), 'interfaceTweaks.preventMessageDrag'),
                createSwitchItem(text('阻止消息列表拖拽'), text('防止拖出独立聊天窗口'), 'interfaceTweaks.preventRecentContactDrag'),
                createSwitchItem(text('禁止悬停显示资料卡'), text('用户与群资料卡'), 'interfaceTweaks.preventProfileCardHover'),
                createSwitchItem(text('删除消息气泡装扮'), '', 'interfaceTweaks.deleteBubbleSkin'),
                createSwitchItem(text('隐藏天气按钮'), '', 'interfaceTweaks.hiddenWeatherBtn'),
                createSwitchItem(text('隐藏经典模式切换按钮'), '', 'interfaceTweaks.hiddenClassicBtn'),
                createSwitchItem(text('隐藏帮助按钮'), '', 'interfaceTweaks.hiddenHelpBtn'),
                createSwitchItem(text('隐藏锁定按钮'), '', 'interfaceTweaks.hiddenLockBtn'),
                createSwitchItem(text('隐藏退出账号按钮'), '', 'interfaceTweaks.hiddenLogoutBtn'),
                createSwitchItem(text('隐藏检查更新按钮和更新通知'), '', 'interfaceTweaks.hiddenUpdateBtnAndNotice'),
                createSwitchItem(text('隐藏 VIP 彩色昵称'), '', 'interfaceTweaks.removeVipColor')
            ]),
            createSection('messages', text('消息相关'), [
                createSwitchItem(text('文件发送修复'), 'Failed / NoSeq', 'fileRetryFixer.enabled'),
                createSwitchItem(text('自动删除失败消息'), text('重试成功后删除原失败条目'), 'fileRetryFixer.deleteFailedMessage', {
                    requires: 'fileRetryFixer.enabled',
                    child: true
                }),
                createSwitchItem(text('图片'), text('随机重写 PNG'), 'fileRetryFixer.image', {
                    requires: 'fileRetryFixer.enabled',
                    child: true
                }),
                createSwitchItem(text('视频'), text('无损重封装'), 'fileRetryFixer.video', {
                    requires: 'fileRetryFixer.enabled',
                    child: true
                }),
                createSwitchItem(text('音频'), text('无损重封装'), 'fileRetryFixer.audio', {
                    requires: 'fileRetryFixer.enabled',
                    child: true
                }),
                createSwitchItem(text('其他文件'), text('发送加密 ZIP'), 'fileRetryFixer.otherFiles', {
                    requires: 'fileRetryFixer.enabled',
                    child: true
                }),
                createPasswordItem(text('压缩密码'), 'AES-256', 'fileRetryFixer.archivePassword', {
                    requires: ['fileRetryFixer.enabled', 'fileRetryFixer.otherFiles'],
                    childLevel: 2
                }),
                createSwitchItem(text('自定义图片外显'), text('修改图片与表情的外显文字'), 'messageTweaks.customImageSummaryEnabled'),
                createTextItem(text('外显文字'), text('留空时不修改'), 'messageTweaks.customImageSummary', {
                    requires: 'messageTweaks.customImageSummaryEnabled',
                    child: true
                }),
                createSwitchItem(text('提示 NoSeq 消息'), text('标记可能未成功发送的消息'), 'messageTweaks.promptNoSeq'),
                createSwitchItem(text('语音消息'), text('拖拽发送与语音库'), 'voiceMessage.enabled'),
                createSwitchItem(text('右键保存语音'), text('在语音消息右键菜单中显示“保存”'), 'voiceMessage.saveInContextMenu', {
                    requires: 'voiceMessage.enabled',
                    child: true
                }),
                createSwitchItem(text('右键转发语音'), text('在语音消息右键菜单中显示“转发”'), 'voiceMessage.forwardInContextMenu', {
                    requires: 'voiceMessage.enabled',
                    child: true
                }),
                createSwitchItem(text('修改语音时长'), text('仅改变发送后的显示时长'), 'voiceMessage.fakeDurationEnabled', {
                    requires: 'voiceMessage.enabled',
                    child: true
                }),
                createNumberItem(text('显示时长'), text('范围 1–300 秒'), 'voiceMessage.fakeDurationSeconds', {
                    requires: ['voiceMessage.enabled', 'voiceMessage.fakeDurationEnabled'],
                    childLevel: 2,
                    min: 1,
                    max: 300,
                    maxLength: 3,
                    suffix: text('秒')
                }),
                createSwitchItem(text('复读'), text('消息尾部 +1 与右键复读'), 'repeatMessage.enabled'),
                createSwitchItem(text('双击复读'), text('避免误触'), 'repeatMessage.doubleClick', {
                    requires: 'repeatMessage.enabled',
                    child: true
                }),
                createSwitchItem(text('右键菜单'), text('开启后入口改到右键'), 'repeatMessage.showInContextMenu', {
                    requires: 'repeatMessage.enabled',
                    child: true
                }),
                createSwitchItem(text('移除回复 @'), text('移除回复消息时的 @ 标记'), 'messageTweaks.removeReplyAt'),
                createSwitchItem(text('伪造合并转发'), text('在当前会话创建自定义聊天记录'), 'fakeForward.enabled')
            ]),
            createSection('preventRecall', text('阻止撤回'), [
                createSwitchItem(text('启用'), text('将撤回灰条替换回原消息'), 'preventRecall.enabled'),
                createChoiceItem(text('撤回标记'), text('选择保留消息的提示样式'), 'preventRecall.markerStyle', [
                    { value: 'badge', label: text('图标') },
                    { value: 'outline', label: text('描边') }
                ], {
                    requires: 'preventRecall.enabled',
                    child: true
                }),
                createSwitchItem(text('拦截自己的撤回操作'), text('本人发起的撤回也将被拦截'), 'preventRecall.preventSelfMsg', {
                    requires: 'preventRecall.enabled'
                }),
                createChoiceItem(text('防撤回范围'), text('按好友和群控制是否生效'), 'preventRecall.filterMode', [
                    { value: 'all', label: text('全部') },
                    { value: 'blacklist', label: text('黑名单') },
                    { value: 'whitelist', label: text('白名单') }
                ], {
                    requires: 'preventRecall.enabled'
                }),
                createActionItem(text('名单管理'), text('从好友和群列表中选择'), 'manageRecallFilterPeers', {
                    label: text('管理'),
                    requires: 'preventRecall.enabled',
                    child: true
                }),
                createSwitchItem(text('持久化保存'), text('按当前账号保存撤回记录'), 'preventRecall.persistedFiles', {
                    requires: 'preventRecall.enabled'
                }),
                createSwitchItem(text('重定向图片储存路径'), text('按当前账号保存被撤回图片'), 'preventRecall.redirectPicPath', {
                    requires: 'preventRecall.enabled'
                }),
                createActionItem(text('查看重定向图片'), text('打开重定向图片储存路径'), 'openRecallImageDir', {
                    label: text('打开'),
                    child: true
                }),
                createSwitchItem(text('自定义颜色'), text('图标与描边共用浅色、深色主题颜色'), 'preventRecall.customColor', {
                    requires: 'preventRecall.enabled'
                }),
                createColorPairItem(text('撤回提示颜色'), text('依次为浅色与深色主题'), 'preventRecall.customTextColor.light', 'preventRecall.customTextColor.dark', {
                    requires: 'preventRecall.customColor',
                    child: true
                }),
                createActionItem(text('查看撤回消息'), text('查看当前账号的撤回数据'), 'viewRecallMessages', {
                    label: text('查看')
                }),
                createActionItem(text('清理撤回缓存'), text('清理当前账号的内存和本地数据'), 'clearRecallCache', {
                    label: text('清理'),
                    danger: true
                })
            ]),
            createSection('entertainment', text('娱乐互动'), [
                createSwitchItem(text('移除表情回应限制'), text('补全回应窗口中被隐藏的 emoji'), 'messageTweaks.removeReactionLimit'),
                createSwitchItem(text('回应后不关闭回应窗口'), text('便于连续添加或取消回应'), 'messageTweaks.keepReactionPanelOpen'),
                createSwitchItem(text('自动回戳'), text('收到戳戳后自动回戳'), 'entertainment.autoPokeBack'),
                createNumberItem(text('回戳阈值'), text('0 为无限制'), 'entertainment.autoPokeBackLimit', {
                    min: 0,
                    max: 9999,
                    maxLength: 4,
                    suffix: text('次'),
                    requires: 'entertainment.autoPokeBack',
                    child: true
                }),
                createSwitchItem(text('双击头像戳戳'), text('替代双击头像打开私聊'), 'entertainment.doubleClickAvatarPoke'),
                createSwitchItem(text('右键头像戳戳'), text('控制头像右键菜单中的戳一戳入口'), 'entertainment.rightClickAvatarPoke')
            ]),
            createCategoryTitle(text('精简')),
            createSection('simplifySidebar', text('侧边栏'), []),
            createSection('simplifyTop', text('顶部功能栏'), []),
            createSection('simplifyChat', text('聊天功能栏'), []),
            createCategoryTitle(text('其他')),
            createSection('updater', text('插件更新'), [
                createSwitchItem(text('启动时检查更新'), text('每 12 小时最多检查一次'), 'updater.checkOnStartup'),
                createActionItem(text('检查更新'), text('读取 GitHub 上的结构化更新清单'), 'checkPluginUpdate', {
                    label: text('检查'),
                    updateRole: 'check'
                }),
                createActionItem(text('下载更新'), text('校验后暂存，重启 QQ 后生效'), 'preparePluginUpdate', {
                    label: text('下载'),
                    child: true,
                    updateRole: 'prepare'
                })
            ]),
            createSection('floatingPanel', text('悬浮窗'), [
                createSwitchItem(text('启用悬浮窗'), text('允许通过快捷键打开工具箱'), 'floatingPanel.enabled'),
                createShortcutItem(text('唤出快捷键'), text('点击后按下新的快捷键'), 'floatingPanel.shortcut', {
                    requires: 'floatingPanel.enabled',
                    child: true
                })
            ]),
            createSection('debug', text('调试功能'), [
                createSwitchItem(text('诊断记录'), text('仅开启后记录关键功能状态与结果'), 'debug.enabled'),
                createActionItem(text('复制诊断报告'), text('复制版本、配置摘要与最近事件'), 'copyDiagnosticReport', {
                    label: text('复制'),
                    child: true
                }),
                createActionItem(text('导出诊断报告'), text('导出便于反馈问题的 JSON 文件'), 'exportDiagnosticReport', {
                    label: text('导出'),
                    child: true
                }),
                createActionItem(text('打开日志目录'), text('查看保留在本地的诊断记录'), 'openDiagnosticDir', {
                    label: text('打开'),
                    child: true
                }),
                createActionItem(text('清空诊断记录'), text('删除当前与上一份轮转日志'), 'clearDiagnosticLog', {
                    label: text('清空'),
                    child: true,
                    danger: true
                })
            ])
        );
        panel.querySelectorAll('.qqnt-toolbox-section[data-group-id]').forEach(section => {
            const content = section.querySelector('.qqnt-toolbox-section-content');
            const header = section.querySelector('.qqnt-toolbox-section-header');
            const contentId = `${rootId}-${section.dataset.groupId}`;
            if (content) {
                content.id = contentId;
            }
            header?.setAttribute('aria-controls', contentId);
        });
        if (settingsMode) {
            const meta = createElement('div', 'qqnt-toolbox-settings-meta');
            const plugin = Object.values(window.LiteLoader?.plugins || {})
                .find(item => item?.manifest?.slug === 'qqnt_toolbox');
            meta.append(
                createElement('span', 'qqnt-toolbox-settings-name', 'QQNT Toolbox'),
                createElement('span', 'qqnt-toolbox-settings-version', `v${plugin?.manifest?.version || '0.6.4'}`)
            );
            panel.append(meta, body);
            options.mount?.appendChild(panel);
        } else {
            panel.append(titlebar, body);
            document.body.appendChild(panel);
        }
        renderSimplifySections(panel);
        installGroupEvents(panel);
        installFeatureEvents(panel);
        updateConfigUi(panel);

        if (settingsMode) {
            return panel;
        }
        installPanelEvents(panel);

        const state = getPanelState();
        requestAnimationFrame(() => {
            if (!panel.hidden) {
                return;
            }
            const saved = hasSavedPanelPosition(state);
            const initialPosition = saved ? { x: Number(state.x), y: Number(state.y) } : centerPosition(panel);
            const initial = applyPosition(panel, initialPosition.x, initialPosition.y);
            setPanelState(initial);
            panel.hidden = !state.visible;
        });
        return panel;
    }

    function areRequirementsEnabled(value) {
        return !value || String(value).split('|').every(isFeatureEnabled);
    }

    function normalizeUpdateState(value) {
        const source = value && typeof value === 'object' ? value : {};
        const statuses = new Set([
            'idle', 'checking', 'current', 'available', 'downloading', 'ready', 'restarting', 'error'
        ]);
        return {
            status: statuses.has(source.status) ? source.status : 'idle',
            supported: source.supported !== false,
            currentVersion: String(source.currentVersion || ''),
            latestVersion: String(source.latestVersion || ''),
            pendingVersion: String(source.pendingVersion || ''),
            reason: String(source.reason || '')
        };
    }

    function getUpdateStatusText() {
        const current = currentUpdateState.currentVersion
            ? `v${currentUpdateState.currentVersion}`
            : text('当前版本');
        const latest = currentUpdateState.latestVersion
            ? `v${currentUpdateState.latestVersion}`
            : text('新版本');
        if (!currentUpdateState.supported) {
            return text('自动安装目前仅支持 Windows');
        }
        switch (currentUpdateState.status) {
            case 'checking':
                return text('正在检查 GitHub Release');
            case 'current':
                return `${current}，${text('已是最新版')}`;
            case 'available':
                return `${text('发现')} ${latest}`;
            case 'downloading':
                return `${text('正在下载并校验')} ${latest}`;
            case 'ready':
                return `${latest} ${text('已就绪，点击“重启安装”后生效')}`;
            case 'restarting':
                return text('正在重启 QQ 并安装更新');
            case 'error':
                return currentUpdateState.reason === 'unsupported-platform'
                    ? text('自动安装目前仅支持 Windows')
                    : text('更新操作失败，请重试');
            default:
                return `${text('当前版本')} ${current}`;
        }
    }

    function updatePluginUpdaterUi(root) {
        const checkItem = root.querySelector('.qqnt-toolbox-item[data-update-role="check"]');
        const prepareItem = root.querySelector('.qqnt-toolbox-item[data-update-role="prepare"]');
        const checkButton = checkItem?.querySelector('.qqnt-toolbox-action');
        const prepareButton = prepareItem?.querySelector('.qqnt-toolbox-action');
        const checkMeta = checkItem?.querySelector('.qqnt-toolbox-item-meta');
        if (checkMeta) {
            checkMeta.textContent = getUpdateStatusText();
        }
        const busy = ['checking', 'downloading', 'restarting'].includes(currentUpdateState.status);
        if (checkButton && !panelActionFeedbackTimers.has(checkButton)) {
            checkButton.textContent = currentUpdateState.status === 'error' ? text('重试') : text('检查');
            checkButton.disabled = busy;
        }
        if (prepareButton && !panelActionFeedbackTimers.has(prepareButton)) {
            prepareButton.textContent = currentUpdateState.status === 'ready' ? text('重启安装') : text('下载');
            prepareButton.disabled = !['available', 'ready'].includes(currentUpdateState.status) ||
                !currentUpdateState.supported;
        }
        if (prepareItem) {
            prepareItem.dataset.disabled = String(prepareButton?.disabled !== false);
        }
    }

    function updateConfigUi(panel = document.getElementById(PANEL_ID)) {
        if (!panel) {
            return;
        }
        panel.querySelectorAll('.qqnt-toolbox-item[data-config-path]').forEach(item => {
            const configPath = item.dataset.configPath;
            const requires = item.dataset.requires;
            const disabled = !areRequirementsEnabled(requires);
            item.dataset.disabled = String(disabled);
            const switchButton = item.querySelector('.qqnt-toolbox-switch');
            if (!switchButton) {
                return;
            }
            const configEnabled = isFeatureEnabled(configPath);
            const enabled = item.dataset.inverted === 'true' ? !configEnabled : configEnabled;
            switchButton.dataset.checked = String(enabled);
            switchButton.setAttribute('aria-checked', String(enabled));
            switchButton.title = enabled ? text('已开启') : text('已关闭');
            switchButton.disabled = disabled || (!configReady && Boolean(getBridge()));
        });
        panel.querySelectorAll('.qqnt-toolbox-item[data-swatch-item="true"]').forEach(item => {
            const buttons = Array.from(item.querySelectorAll('.qqnt-toolbox-swatch[data-config-path]'));
            if (!buttons.length) {
                return;
            }
            const disabled = !areRequirementsEnabled(item.dataset.requires);
            item.dataset.disabled = String(disabled);
            const configPath = buttons[0].dataset.configPath;
            const fallback = String(getByPath(DEFAULT_CONFIG, configPath) || '');
            const configured = String(getByPath(currentConfig, configPath) || fallback);
            const value = buttons.some(button => button.dataset.value === configured) ? configured : fallback;
            for (const button of buttons) {
                const checked = button.dataset.value === value;
                button.dataset.checked = String(checked);
                button.setAttribute('aria-checked', String(checked));
                button.tabIndex = checked ? 0 : -1;
                button.disabled = disabled || (!configReady && Boolean(getBridge()));
            }
        });
        panel.querySelectorAll('.qqnt-toolbox-item[data-choice-item="true"]').forEach(item => {
            const buttons = Array.from(item.querySelectorAll('.qqnt-toolbox-choice[data-config-path]'));
            if (!buttons.length) {
                return;
            }
            const disabled = !areRequirementsEnabled(item.dataset.requires);
            item.dataset.disabled = String(disabled);
            const configPath = buttons[0].dataset.configPath;
            const fallback = String(getByPath(DEFAULT_CONFIG, configPath) || '');
            const configured = String(getByPath(currentConfig, configPath) || fallback);
            const value = buttons.some(button => button.dataset.value === configured) ? configured : fallback;
            for (const button of buttons) {
                const checked = button.dataset.value === value;
                button.dataset.checked = String(checked);
                button.setAttribute('aria-checked', String(checked));
                button.tabIndex = checked ? 0 : -1;
                button.disabled = disabled || (!configReady && Boolean(getBridge()));
            }
        });
        panel.querySelectorAll('.qqnt-toolbox-item[data-color-item="true"]').forEach(item => {
            const requires = item.dataset.requires;
            const disabled = !areRequirementsEnabled(requires);
            item.dataset.disabled = String(disabled);
            item.querySelectorAll('.qqnt-toolbox-color-input[data-config-path]').forEach(input => {
                const fallback = getByPath(DEFAULT_CONFIG, input.dataset.configPath);
                input.value = normalizeColorHex(getByPath(currentConfig, input.dataset.configPath), fallback);
                input.disabled = disabled || (!configReady && Boolean(getBridge()));
            });
        });
        panel.querySelectorAll('.qqnt-toolbox-item[data-password-item="true"]').forEach(item => {
            const input = item.querySelector('.qqnt-toolbox-password-input[data-config-path]');
            if (!input) {
                return;
            }
            input.value = String(getByPath(currentConfig, input.dataset.configPath) || '');
            input.disabled = !areRequirementsEnabled(item.dataset.requires) || (!configReady && Boolean(getBridge()));
        });
        panel.querySelectorAll('.qqnt-toolbox-item[data-text-item="true"]').forEach(item => {
            const input = item.querySelector('.qqnt-toolbox-text-input[data-config-path]');
            if (!input) {
                return;
            }
            input.value = String(getByPath(currentConfig, input.dataset.configPath) || '');
            input.disabled = !areRequirementsEnabled(item.dataset.requires) || (!configReady && Boolean(getBridge()));
        });
        panel.querySelectorAll('.qqnt-toolbox-item[data-number-item="true"]').forEach(item => {
            const input = item.querySelector('.qqnt-toolbox-number-input[data-config-path]');
            if (!input) {
                return;
            }
            const fallback = Number(getByPath(DEFAULT_CONFIG, input.dataset.configPath)) || 1;
            const value = Math.trunc(Number(getByPath(currentConfig, input.dataset.configPath)));
            input.value = String(Number.isFinite(value) ? clamp(value, Number(input.min), Number(input.max)) : fallback);
            input.disabled = !areRequirementsEnabled(item.dataset.requires) || (!configReady && Boolean(getBridge()));
        });
        panel.querySelectorAll('.qqnt-toolbox-item[data-shortcut-item="true"]').forEach(item => {
            const button = item.querySelector('.qqnt-toolbox-shortcut-button[data-config-path]');
            if (!button) {
                return;
            }
            const disabled = !areRequirementsEnabled(item.dataset.requires) || (!configReady && Boolean(getBridge()));
            item.dataset.disabled = String(disabled);
            button.disabled = disabled;
            if (button.dataset.capturing !== 'true') {
                button.textContent = formatShortcut(getByPath(currentConfig, button.dataset.configPath));
            }
        });
        panel.querySelectorAll('.qqnt-toolbox-item[data-action]').forEach(item => {
            const disabled = !areRequirementsEnabled(item.dataset.requires) || (!configReady && Boolean(getBridge()));
            item.dataset.disabled = String(disabled);
            const button = item.querySelector('.qqnt-toolbox-action[data-action]');
            if (button) {
                button.disabled = disabled || panelActionFeedbackTimers.has(button);
            }
        });
        updatePluginUpdaterUi(panel);
        updateGroupUi(panel);
    }

    async function setConfigValue(configPath, value) {
        const nextConfig = clonePlain(currentConfig);
        setByPath(nextConfig, configPath, value);
        currentConfig = normalizeRendererConfig(nextConfig);
        syncMessageBadgeObserver(true);
        refreshConfigViews();
        scheduleRepeatEntrypointRefresh();
        scheduleInterfaceTweaksRefresh();
        const bridge = getBridge();
        if (!bridge?.setConfig) {
            syncReactionLimitFeature();
            syncRendererReadyDiagnostic();
            return;
        }
        try {
            currentConfig = normalizeRendererConfig(await bridge.setConfig(currentConfig));
        } catch {
        } finally {
            configReady = true;
            syncReactionLimitFeature();
            syncMessageBadgeObserver(true);
            refreshConfigViews();
            scheduleRepeatEntrypointRefresh();
            scheduleInterfaceTweaksRefresh();
            syncRendererReadyDiagnostic();
        }
    }

    async function setConfigBoolean(configPath, enabled) {
        return setConfigValue(configPath, enabled);
    }

    function stopShortcutCapture(value = '') {
        if (!activeShortcutCapture) {
            return;
        }
        const capture = activeShortcutCapture;
        activeShortcutCapture = null;
        window.removeEventListener('keydown', capture.onKeyDown, true);
        window.removeEventListener('keyup', capture.onKeyUp, true);
        window.removeEventListener('blur', capture.onBlur, true);
        capture.button.dataset.capturing = 'false';
        if (value) {
            setConfigValue(capture.button.dataset.configPath, value);
        } else {
            refreshConfigViews();
        }
    }

    function beginShortcutCapture(button) {
        stopShortcutCapture();
        let modifierCandidate = '';
        const consumeEvent = event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
        };
        const onKeyDown = event => {
            consumeEvent(event);
            if (event.code === 'Escape') {
                stopShortcutCapture();
                return;
            }
            if (event.repeat) {
                return;
            }
            const value = shortcutFromEvent(event);
            if (!value) {
                return;
            }
            if (isModifierCode(event.code)) {
                modifierCandidate = value;
                return;
            }
            stopShortcutCapture(value);
        };
        const onKeyUp = event => {
            consumeEvent(event);
            if (!modifierCandidate || !isModifierCode(event.code)) {
                return;
            }
            if (!event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
                stopShortcutCapture(modifierCandidate);
            }
        };
        const onBlur = () => stopShortcutCapture();
        activeShortcutCapture = { button, onKeyDown, onKeyUp, onBlur };
        button.dataset.capturing = 'true';
        button.textContent = text('请按下快捷键');
        button.focus();
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('blur', onBlur, true);
    }

    function installFeatureEvents(panel) {
        panel.addEventListener('click', event => {
            const shortcutButton = event.target.closest?.('.qqnt-toolbox-shortcut-button[data-config-path]');
            if (shortcutButton && panel.contains(shortcutButton)) {
                event.preventDefault();
                event.stopPropagation();
                if (!shortcutButton.disabled) {
                    beginShortcutCapture(shortcutButton);
                }
                return;
            }
            const actionButton = event.target.closest?.('.qqnt-toolbox-action[data-action]');
            if (actionButton && panel.contains(actionButton)) {
                event.preventDefault();
                event.stopPropagation();
                runPanelAction(actionButton.dataset.action, actionButton);
                return;
            }
            const swatchButton = event.target.closest?.('.qqnt-toolbox-swatch[data-config-path]');
            if (swatchButton && panel.contains(swatchButton)) {
                event.preventDefault();
                event.stopPropagation();
                if (!swatchButton.disabled) {
                    setConfigValue(swatchButton.dataset.configPath, swatchButton.dataset.value);
                }
                return;
            }
            const choiceButton = event.target.closest?.('.qqnt-toolbox-choice[data-config-path]');
            if (choiceButton && panel.contains(choiceButton)) {
                event.preventDefault();
                event.stopPropagation();
                if (!choiceButton.disabled) {
                    setConfigValue(choiceButton.dataset.configPath, choiceButton.dataset.value);
                }
                return;
            }
            const switchButton = event.target.closest?.('.qqnt-toolbox-switch[data-config-path]');
            if (!switchButton || !panel.contains(switchButton)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (switchButton.disabled) {
                return;
            }
            const configPath = switchButton.dataset.configPath;
            const nextChecked = switchButton.dataset.checked !== 'true';
            const item = switchButton.closest('.qqnt-toolbox-item');
            setConfigBoolean(configPath, item?.dataset.inverted === 'true' ? !nextChecked : nextChecked);
        });
        panel.addEventListener('change', event => {
            const numberInput = event.target.closest?.('.qqnt-toolbox-number-input[data-config-path]');
            if (numberInput && panel.contains(numberInput) && !numberInput.disabled) {
                const fallback = Number(getByPath(DEFAULT_CONFIG, numberInput.dataset.configPath)) || 1;
                const rawValue = numberInput.value.trim();
                const value = /^\d+$/.test(rawValue) ? Math.trunc(Number(rawValue)) : fallback;
                const normalized = clamp(
                    Number.isFinite(value) ? value : fallback,
                    Number(numberInput.min),
                    Number(numberInput.max)
                );
                numberInput.value = String(normalized);
                setConfigValue(numberInput.dataset.configPath, normalized);
                return;
            }
            const passwordInput = event.target.closest?.('.qqnt-toolbox-password-input[data-config-path]');
            if (passwordInput && panel.contains(passwordInput) && !passwordInput.disabled) {
                setConfigValue(passwordInput.dataset.configPath, passwordInput.value);
                return;
            }
            const textInput = event.target.closest?.('.qqnt-toolbox-text-input[data-config-path]');
            if (textInput && panel.contains(textInput) && !textInput.disabled) {
                setConfigValue(textInput.dataset.configPath, textInput.value);
                return;
            }
            const colorInput = event.target.closest?.('.qqnt-toolbox-color-input[data-config-path]');
            if (!colorInput || !panel.contains(colorInput) || colorInput.disabled) {
                return;
            }
            const fallback = getByPath(DEFAULT_CONFIG, colorInput.dataset.configPath);
            setConfigValue(colorInput.dataset.configPath, normalizeColorHex(colorInput.value, fallback));
        });
        panel.addEventListener('input', event => {
            const numberInput = event.target.closest?.('.qqnt-toolbox-number-input[data-config-path]');
            if (!numberInput || !panel.contains(numberInput) || numberInput.disabled) {
                return;
            }
            const digits = numberInput.value.replace(/\D/g, '').slice(0, Number(numberInput.maxLength) || 4);
            if (numberInput.value !== digits) {
                numberInput.value = digits;
            }
        });
        panel.addEventListener('keydown', event => {
            const choiceButton = event.target.closest?.('.qqnt-toolbox-choice[data-config-path]');
            if (choiceButton && !choiceButton.disabled && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                const buttons = Array.from(choiceButton.parentElement?.querySelectorAll(
                    '.qqnt-toolbox-choice[data-config-path]:not(:disabled)'
                ) || []);
                const currentIndex = buttons.indexOf(choiceButton);
                const direction = event.key === 'ArrowRight' ? 1 : -1;
                const next = buttons[(currentIndex + direction + buttons.length) % buttons.length];
                if (next) {
                    event.preventDefault();
                    next.focus();
                    next.click();
                }
                return;
            }
            const swatchButton = event.target.closest?.('.qqnt-toolbox-swatch[data-config-path]');
            if (swatchButton && !swatchButton.disabled && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                const buttons = Array.from(swatchButton.parentElement?.querySelectorAll(
                    '.qqnt-toolbox-swatch[data-config-path]:not(:disabled)'
                ) || []);
                const currentIndex = buttons.indexOf(swatchButton);
                const direction = event.key === 'ArrowRight' ? 1 : -1;
                const next = buttons[(currentIndex + direction + buttons.length) % buttons.length];
                if (next) {
                    event.preventDefault();
                    next.focus();
                    next.click();
                }
                return;
            }
            const input = event.target.closest?.(
                '.qqnt-toolbox-password-input[data-config-path], .qqnt-toolbox-text-input[data-config-path], ' +
                '.qqnt-toolbox-number-input[data-config-path]'
            );
            if (input && event.key === 'Enter') {
                input.blur();
            }
        });
    }

    function showPanelActionFeedback(button, label, result = '', timeoutMs = 1200) {
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }
        window.clearTimeout(panelActionFeedbackTimers.get(button));
        button.dataset.defaultLabel ||= button.textContent || text('打开');
        button.textContent = label;
        button.dataset.result = result;
        button.disabled = true;
        if (timeoutMs <= 0) {
            panelActionFeedbackTimers.set(button, 0);
            return;
        }
        const timer = window.setTimeout(() => {
            button.textContent = button.dataset.defaultLabel;
            delete button.dataset.result;
            panelActionFeedbackTimers.delete(button);
            updateConfigUi(button.closest(`#${PANEL_ID}, #${SETTINGS_ID}`));
        }, 1200);
        panelActionFeedbackTimers.set(button, timer);
    }

    async function runPanelAction(action, button = null) {
        const bridge = getBridge();
        showPanelActionFeedback(button, text('处理中'), 'pending', 0);
        try {
            let result = null;
            const diagnosticActions = new Set([
                'copyDiagnosticReport',
                'exportDiagnosticReport',
                'openDiagnosticDir',
                'clearDiagnosticLog'
            ]);
            if (diagnosticActions.has(action) && typeof bridge?.runDiagnosticAction !== 'function') {
                throw new Error('The diagnostics bridge is unavailable.');
            }
            if (action === 'openRecallDir') {
                result = await bridge?.openRecallDir?.();
            } else if (action === 'openRecallImageDir') {
                result = await bridge?.openRecallImageDir?.();
            } else if (action === 'viewRecallMessages') {
                result = await bridge?.viewRecallMessages?.();
            } else if (action === 'clearRecallCache') {
                result = await bridge?.clearRecallCache?.();
            } else if (action === 'manageRecallFilterPeers') {
                getRecallFilterEditor().open(button);
            } else if (action === 'editMessageContextMenuOrder') {
                getMessageContextMenuOrderController().openEditor();
            } else if (action === 'copyDiagnosticReport') {
                result = await bridge?.runDiagnosticAction?.('copy-report');
            } else if (action === 'exportDiagnosticReport') {
                result = await bridge?.runDiagnosticAction?.('export-report');
            } else if (action === 'openDiagnosticDir') {
                result = await bridge?.runDiagnosticAction?.('open-directory');
            } else if (action === 'clearDiagnosticLog') {
                result = await bridge?.runDiagnosticAction?.('clear');
            } else if (action === 'checkPluginUpdate') {
                if (typeof bridge?.checkForUpdates !== 'function') {
                    throw new Error('The updater bridge is unavailable.');
                }
                result = await bridge.checkForUpdates({ force: true });
                currentUpdateState = normalizeUpdateState(result);
                refreshConfigViews();
            } else if (action === 'preparePluginUpdate') {
                if (currentUpdateState.status === 'ready') {
                    if (typeof bridge?.restartForUpdate !== 'function') {
                        throw new Error('The updater restart bridge is unavailable.');
                    }
                    result = await bridge.restartForUpdate();
                } else {
                    if (typeof bridge?.prepareUpdate !== 'function') {
                        throw new Error('The updater bridge is unavailable.');
                    }
                    result = await bridge.prepareUpdate();
                }
                currentUpdateState = normalizeUpdateState(result);
                refreshConfigViews();
            } else {
                throw new Error('Unknown panel action.');
            }
            if (result?.ok === false) {
                throw new Error(result.reason || 'The action failed.');
            }
            const labels = {
                copyDiagnosticReport: text('已复制'),
                exportDiagnosticReport: text('已导出'),
                openDiagnosticDir: text('已打开'),
                clearDiagnosticLog: text('已清空'),
                clearRecallCache: text('已清理'),
                checkPluginUpdate: result?.status === 'available' ? text('有更新') : text('已检查'),
                preparePluginUpdate: result?.status === 'restarting' ? text('正在重启') : text('已下载')
            };
            showPanelActionFeedback(button, labels[action] || text('完成'), 'success');
        } catch (error) {
            showPanelActionFeedback(button, text('失败'), 'error');
            recordRendererDiagnostic('panel-action.failed', {
                action,
                errorName: error?.name || 'Error',
                errorMessage: String(error?.message || error || '')
            }, 'warn');
        }
    }

    function installGroupEvents(panel) {
        panel.addEventListener('click', event => {
            const header = event.target.closest?.('.qqnt-toolbox-section-header[data-group-id]');
            if (!header || !panel.contains(header)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const groupId = header.dataset.groupId;
            setPanelGroupExpanded(groupId, !isPanelGroupExpanded(groupId));
            updateGroupUi(panel);
            if (panel.id === PANEL_ID) {
                requestAnimationFrame(() => {
                    const rect = panel.getBoundingClientRect();
                    const position = applyPosition(panel, rect.left, rect.top);
                    setPanelState(position);
                });
            }
        });
    }

    function setVisible(panel, visible) {
        panel.hidden = !visible;
        if (visible) {
            const rect = panel.getBoundingClientRect();
            const state = getPanelState();
            const fallback = centerPosition(panel);
            const savedX = Number(state.x);
            const savedY = Number(state.y);
            const saved = hasSavedPanelPosition(state);
            const position = rect.width && rect.height
                ? applyPosition(panel, saved ? savedX : fallback.x, saved ? savedY : fallback.y)
                : fallback;
            setPanelState({ ...position, visible: true });
            updateConfigUi(panel);
        } else {
            setPanelState({ visible: false });
        }
    }

    function togglePanel() {
        const panel = createPanel();
        setVisible(panel, panel.hidden);
    }

    function installPanelEvents(panel) {
        const titlebar = panel.querySelector('.qqnt-toolbox-titlebar');
        const close = panel.querySelector('.qqnt-toolbox-close');
        let dragState = null;
        const closePanel = event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            dragState = null;
            setVisible(panel, false);
        };
        close.addEventListener('pointerdown', closePanel, true);
        close.addEventListener('mousedown', closePanel, true);
        close.addEventListener('click', closePanel, true);

        titlebar.addEventListener('pointerdown', event => {
            if (event.button !== 0) {
                return;
            }
            if (event.target instanceof Element && event.target.closest('button, [role="button"], input, select, textarea, a')) {
                return;
            }
            const rect = panel.getBoundingClientRect();
            dragState = {
                pointerId: event.pointerId,
                offsetX: event.clientX - rect.left,
                offsetY: event.clientY - rect.top
            };
            titlebar.setPointerCapture(event.pointerId);
            event.preventDefault();
        });
        titlebar.addEventListener('pointermove', event => {
            if (!dragState || dragState.pointerId !== event.pointerId) {
                return;
            }
            applyPosition(panel, event.clientX - dragState.offsetX, event.clientY - dragState.offsetY);
        });
        titlebar.addEventListener('pointerup', event => {
            if (!dragState || dragState.pointerId !== event.pointerId) {
                return;
            }
            dragState = null;
            const rect = panel.getBoundingClientRect();
            const position = applyPosition(panel, rect.left, rect.top);
            setPanelState({ ...position, hasUserPosition: true });
        });
        titlebar.addEventListener('pointercancel', () => {
            dragState = null;
        });
    }

    function setToolboxHidden(element, hidden) {
        if (!element?.style) {
            return;
        }
        if (hidden) {
            if (element.dataset.qqntToolboxHidden !== 'true') {
                element.dataset.qqntToolboxHidden = 'true';
                element.dataset.qqntToolboxPreviousDisplay = element.style.display || '';
            }
            if (element.style.getPropertyValue('display') === 'none' && element.style.getPropertyPriority('display') === 'important') {
                return;
            }
            element.style.setProperty('display', 'none', 'important');
            return;
        }
        if (element.dataset.qqntToolboxHidden === 'true') {
            const previousDisplay = element.dataset.qqntToolboxPreviousDisplay || '';
            if (previousDisplay) {
                element.style.display = previousDisplay;
            } else {
                element.style.removeProperty('display');
            }
            delete element.dataset.qqntToolboxHidden;
            delete element.dataset.qqntToolboxPreviousDisplay;
        }
    }

    function setSelectorHidden(selector, hidden) {
        document.querySelectorAll(selector).forEach(element => setToolboxHidden(element, hidden));
    }

    function elementMatchesAnyLabel(element, labels) {
        const normalizedLabels = labels.map(label => compactText(label)).filter(Boolean);
        const attributeValues = [
            element.getAttribute?.('aria-label'),
            element.getAttribute?.('title'),
            element.getAttribute?.('data-title'),
            element.getAttribute?.('data-text')
        ].map(compactText).filter(Boolean);
        if (attributeValues.some(value =>
            normalizedLabels.some(label => matchesControlLabelValue(value, label)))) {
            return true;
        }
        const textContent = compactText(element.textContent);
        return normalizedLabels.some(label => textContent === label);
    }

    function getLabeledControlTarget(element) {
        const menuItem = element.closest?.('.q-context-menu-item, [role="menuitem"], .func-menu__item_wrap');
        if (menuItem) {
            return menuItem;
        }
        let contextItem = element.closest?.('[class*="context-menu-item"]');
        while (contextItem?.parentElement?.matches?.('[class*="context-menu-item"]')) {
            contextItem = contextItem.parentElement;
        }
        return contextItem || element.closest?.('button') || element;
    }

    function collectLabeledControlTargets(labels) {
        const selector = [
            '.func-menu__item_wrap',
            '.q-context-menu-item',
            '[class*="context-menu-item"]',
            '[role="menuitem"]',
            '[aria-label]',
            '[title]',
            'button'
        ].join(',');
        const targets = new Set();
        document.querySelectorAll(selector).forEach(element => {
            if (element.closest([
                `#${PANEL_ID}`,
                `#${SETTINGS_ID}`,
                '.recent-contact',
                '.recent-contact-list--wrapper',
                '.aio',
                '.chat-msg-area',
                '.chat-record-list',
                '.msg-record-container',
                '.record-msg-panel'
            ].join(','))) {
                return;
            }
            if (elementMatchesAnyLabel(element, labels)) {
                targets.add(getLabeledControlTarget(element));
            }
        });
        return new Set(Array.from(targets).filter(target =>
            !Array.from(targets).some(other => other !== target && target.contains(other))
        ));
    }

    function applyLabeledControlVisibility(rules) {
        const nextHiddenElements = new Set();
        for (const rule of rules) {
            if (!rule.hidden) {
                continue;
            }
            for (const element of collectLabeledControlTargets(rule.labels)) {
                nextHiddenElements.add(element);
            }
        }
        for (const element of labeledHiddenElements) {
            if (!nextHiddenElements.has(element)) {
                setToolboxHidden(element, false);
            }
        }
        for (const element of nextHiddenElements) {
            setToolboxHidden(element, true);
        }
        labeledHiddenElements = nextHiddenElements;
    }

    function normalizeSimplifyItemName(value) {
        return normalizeText(value)
            .replace(/\s*[（(]?(?:99\+|\d+)\s*(?:条未读(?:消息)?|条新消息|个未读(?:消息)?)[）)]?\s*$/u, '')
            .trim();
    }

    function getSimplifyItemName(element) {
        const candidates = [
            element,
            element.querySelector?.('.icon-item[aria-label]'),
            element.querySelector?.('[aria-label]'),
            element.querySelector?.('[title]'),
            element.closest?.('.bar-icon[aria-label]')
        ].filter(Boolean);
        for (const candidate of candidates) {
            for (const attribute of ['aria-label', 'title', 'data-title', 'data-text']) {
                const value = normalizeSimplifyItemName(candidate.getAttribute?.(attribute));
                if (value) {
                    return value;
                }
            }
        }
        return normalizeSimplifyItemName(element.textContent);
    }

    function getSimplifyItemId(element, prefix, name) {
        return normalizeText(element.id) || `${prefix}:${compactText(name)}`;
    }

    function collectSimplifyItems(elements, bucket, prefix) {
        for (const element of elements) {
            if (element.style?.display === 'none' && element.dataset.qqntToolboxHidden !== 'true') {
                continue;
            }
            const name = getSimplifyItemName(element);
            if (!name) {
                continue;
            }
            const id = getSimplifyItemId(element, prefix, name);
            bucket.set(id, { id, name });
        }
    }

    function mergeSimplifyItemList(currentItems, discoveredItems) {
        const normalizedCurrent = new Map();
        for (const source of Array.isArray(currentItems) ? currentItems : []) {
            const name = normalizeSimplifyItemName(source?.name) || normalizeSimplifyItemName(source?.id);
            if (!name) {
                continue;
            }
            const rawId = String(source?.id ?? '');
            const prefix = rawId.match(/^(sidebar-top|sidebar-bottom|top-func|chat-func):/)?.[1];
            const id = prefix ? `${prefix}:${compactText(name)}` : rawId;
            const previous = normalizedCurrent.get(id);
            normalizedCurrent.set(id, {
                id,
                name,
                enabled: (previous?.enabled !== false) && source?.enabled !== false
            });
        }
        const current = Array.from(normalizedCurrent.values());
        const byId = new Map(current.map(item => [String(item?.id), item]));
        const byName = new Map(current.map(item => [compactText(item?.name), item]));
        const next = [];
        const included = new Set();
        for (const item of discoveredItems.values()) {
            const previous = byId.get(String(item.id)) || byName.get(compactText(item.name));
            next.push({
                id: item.id,
                name: item.name,
                enabled: previous?.enabled !== false
            });
            included.add(String(item.id));
            if (previous?.id !== undefined && previous?.id !== null) {
                included.add(String(previous.id));
            }
        }
        for (const item of current) {
            if (item?.id === undefined || item?.id === null || included.has(String(item.id))) {
                continue;
            }
            next.push({
                id: item.id,
                name: normalizeText(item.name) || String(item.id),
                enabled: item.enabled !== false
            });
        }
        return next;
    }

    function scheduleSimplifyConfigSave() {
        if (!configReady || simplifyConfigSaveTimer) {
            return;
        }
        simplifyConfigSaveTimer = window.setTimeout(async () => {
            simplifyConfigSaveTimer = 0;
            const bridge = getBridge();
            if (!bridge?.setConfig) {
                return;
            }
            try {
                currentConfig = normalizeRendererConfig(await bridge.setConfig(clonePlain(currentConfig)));
                refreshConfigViews();
            } catch {
            }
        }, 180);
    }

    function discoverSimplifyItems(groups) {
        collectSimplifyItems(groups.sideTop, discoveredSimplifyItems.sideTop, 'sidebar-top');
        collectSimplifyItems(groups.sideBottom, discoveredSimplifyItems.sideBottom, 'sidebar-bottom');
        collectSimplifyItems(groups.topFunc, discoveredSimplifyItems.topFunc, 'top-func');
        collectSimplifyItems(groups.chatFunc, discoveredSimplifyItems.chatFunc, 'chat-func');
        if (!configReady) {
            return;
        }
        const next = {
            sideBar: {
                top: mergeSimplifyItemList(currentConfig.sideBar?.top, discoveredSimplifyItems.sideTop),
                bottom: mergeSimplifyItemList(currentConfig.sideBar?.bottom, discoveredSimplifyItems.sideBottom)
            },
            topFuncBar: mergeSimplifyItemList(currentConfig.topFuncBar, discoveredSimplifyItems.topFunc),
            chatFuncBar: mergeSimplifyItemList(currentConfig.chatFuncBar, discoveredSimplifyItems.chatFunc)
        };
        const changed = JSON.stringify(currentConfig.sideBar) !== JSON.stringify(next.sideBar) ||
            JSON.stringify(currentConfig.topFuncBar) !== JSON.stringify(next.topFuncBar) ||
            JSON.stringify(currentConfig.chatFuncBar) !== JSON.stringify(next.chatFuncBar);
        if (!changed) {
            return;
        }
        currentConfig.sideBar = next.sideBar;
        currentConfig.topFuncBar = next.topFuncBar;
        currentConfig.chatFuncBar = next.chatFuncBar;
        refreshConfigViews();
        scheduleSimplifyConfigSave();
    }

    function applySimplifyVisibility(elements, items, prefix) {
        const byId = new Map((Array.isArray(items) ? items : []).map(item => [String(item?.id), item]));
        const byName = new Map((Array.isArray(items) ? items : []).map(item => [compactText(item?.name), item]));
        for (const element of elements) {
            const name = getSimplifyItemName(element);
            const id = getSimplifyItemId(element, prefix, name);
            const item = byId.get(id) || byName.get(compactText(name));
            setToolboxHidden(element, item?.enabled === false);
        }
    }

    function observeSimplifyBars() {
        const containers = Array.from(document.querySelectorAll([
            '.sidebar-wrapper .sidebar__upper .nav.sidebar__nav',
            '.sidebar-wrapper .sidebar__lower',
            '.panel-header__action .func-bar-native',
            '.chat-func-bar .func-bar-native'
        ].join(',')));
        if (containers.length === simplifyObservedContainers.length &&
            containers.every((container, index) => container === simplifyObservedContainers[index])) {
            return;
        }
        simplifyBarObserver?.disconnect();
        simplifyObservedContainers = containers;
        simplifyBarObserver = new MutationObserver(scheduleInterfaceTweaksRefresh);
        for (const container of containers) {
            simplifyBarObserver.observe(container, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['aria-label', 'id', 'style']
            });
        }
    }

    function applySimplifyTweaks() {
        const groups = {
            sideTop: Array.from(document.querySelectorAll('.sidebar-wrapper .sidebar__upper .nav.sidebar__nav .nav-item')),
            sideBottom: Array.from(document.querySelectorAll('.sidebar-wrapper .sidebar__lower .func-menu__item_wrap')),
            topFunc: Array.from(document.querySelectorAll('.panel-header__action .func-bar-native > div')),
            chatFunc: Array.from(document.querySelectorAll('.chat-func-bar .func-bar-native > div'))
        };
        observeSimplifyBars();
        discoverSimplifyItems(groups);
        applySimplifyVisibility(groups.sideTop, currentConfig.sideBar?.top, 'sidebar-top');
        applySimplifyVisibility(groups.sideBottom, currentConfig.sideBar?.bottom, 'sidebar-bottom');
        applySimplifyVisibility(groups.topFunc, currentConfig.topFuncBar, 'top-func');
        applySimplifyVisibility(groups.chatFunc, currentConfig.chatFuncBar, 'chat-func');
    }

    function handleProfileCardHover(event) {
        if (!isConfigEnabled('interfaceTweaks.preventProfileCardHover')) {
            return;
        }
        const isProfileTrigger = (event.composedPath?.() || [event.target]).some(item =>
            item instanceof Element && item.matches(PROFILE_CARD_HOVER_TRIGGER_SELECTOR)
        );
        if (!isProfileTrigger) {
            return;
        }
        event.stopPropagation();
        event.stopImmediatePropagation?.();
    }

    function installProfileCardHoverBlocker() {
        for (const eventName of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter']) {
            document.addEventListener(eventName, handleProfileCardHover, true);
        }
    }

    function normalizeUnreadCount(value) {
        const candidate = value && typeof value === 'object' && 'value' in value ? value.value : value;
        const count = Number(candidate);
        return Number.isSafeInteger(count) && count >= 0 ? count : null;
    }

    function getRecentContactUnreadCount(item, badge) {
        const values = [
            findVueValue(badge, ['props.count', 'ctx.count', 'proxy.count', 'vnode.props.count']),
            findVueValue(item, [
                'proxy.unreadCnt',
                'ctx.unreadCnt',
                'proxy.rCItemData.unreadCnt',
                'ctx.rCItemData.unreadCnt'
            ])
        ];
        const label = badge.closest('[aria-label*="未读"]')?.getAttribute('aria-label') || '';
        values.push(label.match(/(\d+)\s*条未读/)?.[1]);
        for (const value of values) {
            const count = normalizeUnreadCount(value);
            if (count !== null) {
                return count;
            }
        }
        return null;
    }

    function setUnreadBadgeText(badge, count, full) {
        const textElement = badge.querySelector('i') || badge;
        const content = full || count <= 99 ? String(count) : '99+';
        if (textElement.textContent !== content) {
            textElement.textContent = content;
        }
        const labelHost = badge.closest('[aria-label*="未读"]');
        const label = `${count}条未读`;
        if (labelHost && labelHost.getAttribute('aria-label') !== label) {
            labelHost.setAttribute('aria-label', label);
        }
    }

    function restoreFullUnreadCounts() {
        document.querySelectorAll('.q-badge-num.qqnt-toolbox-full-unread-count').forEach(badge => {
            const item = badge.closest('.recent-contact-item');
            const count = getRecentContactUnreadCount(item, badge) ??
                normalizeUnreadCount(badge.dataset.qqntToolboxUnreadCount);
            if (count !== null) {
                setUnreadBadgeText(badge, count, false);
            }
            badge.classList.remove('qqnt-toolbox-full-unread-count');
            delete badge.dataset.qqntToolboxUnreadCount;
        });
    }

    function applyFullUnreadCounts() {
        if (!isConfigEnabled('interfaceTweaks.showFullUnreadCount')) {
            restoreFullUnreadCounts();
            return;
        }
        document.querySelectorAll('.recent-contact-item').forEach(item => {
            const badge = item.querySelector('.summary-bubble .q-badge-num');
            if (!badge) {
                return;
            }
            const count = getRecentContactUnreadCount(item, badge);
            if (count === null || count <= 0) {
                return;
            }
            badge.dataset.qqntToolboxUnreadCount = String(count);
            badge.classList.add('qqnt-toolbox-full-unread-count');
            setUnreadBadgeText(badge, count, true);
        });
    }

    function scheduleUnreadCountRefresh() {
        if (unreadCountRefreshTimer) {
            return;
        }
        unreadCountRefreshTimer = window.setTimeout(() => {
            unreadCountRefreshTimer = 0;
            applyFullUnreadCounts();
        }, 40);
    }

    function syncUnreadCountObserver() {
        if (!isConfigEnabled('interfaceTweaks.showFullUnreadCount')) {
            unreadCountObserver?.disconnect();
            unreadCountObserver = null;
            unreadCountObservedRoot = null;
            restoreFullUnreadCounts();
            return;
        }
        const root = document.querySelector('.recent-contact-list--wrapper .viewport-list, .recent-contact .viewport-list');
        if (root !== unreadCountObservedRoot) {
            unreadCountObserver?.disconnect();
            unreadCountObservedRoot = root;
            unreadCountObserver = root ? new MutationObserver(scheduleUnreadCountRefresh) : null;
            unreadCountObserver?.observe(root, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['aria-label']
            });
        }
        applyFullUnreadCounts();
    }

    function applyInterfaceTweaks() {
        if (!document.body) {
            return;
        }
        document.body.classList.toggle('qqnt-toolbox-hide-weather', isConfigEnabled('interfaceTweaks.hiddenWeatherBtn'));
        document.body.classList.toggle('qqnt-toolbox-hide-classic', isConfigEnabled('interfaceTweaks.hiddenClassicBtn'));
        document.body.classList.toggle('qqnt-toolbox-hide-update', isConfigEnabled('interfaceTweaks.hiddenUpdateBtnAndNotice'));
        document.body.classList.toggle('qqnt-toolbox-remove-vip-color', isConfigEnabled('interfaceTweaks.removeVipColor'));

        setSelectorHidden('.weather-widget', isConfigEnabled('interfaceTweaks.hiddenWeatherBtn'));
        setSelectorHidden('.window-control-area .narrow-toggler', isConfigEnabled('interfaceTweaks.hiddenClassicBtn'));
        applyLabeledControlVisibility([
            {
                labels: [text('\u5e2e\u52a9')],
                hidden: isConfigEnabled('interfaceTweaks.hiddenHelpBtn')
            },
            {
                labels: [text('\u9501\u5b9a')],
                hidden: isConfigEnabled('interfaceTweaks.hiddenLockBtn')
            },
            {
                labels: [text('\u9000\u51fa\u8d26\u53f7'), text('\u9000\u51fa\u767b\u5f55')],
                hidden: isConfigEnabled('interfaceTweaks.hiddenLogoutBtn')
            },
            {
                labels: [text('\u68c0\u67e5\u66f4\u65b0'), text('\u66f4\u65b0\u901a\u77e5')],
                hidden: isConfigEnabled('interfaceTweaks.hiddenUpdateBtnAndNotice')
            }
        ]);

        const controlWidth = document.querySelector('.window-control-area')?.offsetWidth;
        if (controlWidth) {
            document.querySelector('.topbar.container-topbar .topbar-content')?.style.setProperty('padding-right', `${controlWidth - 10}px`);
        }
        syncUnreadCountObserver();
        applySimplifyTweaks();
    }

    function scheduleInterfaceTweaksRefresh() {
        if (interfaceRefreshTimer) {
            return;
        }
        interfaceRefreshTimer = window.setTimeout(() => {
            interfaceRefreshTimer = 0;
            applyInterfaceTweaks();
            installReplyAtCleanup();
        }, 80);
    }

    function handleInterfaceTweaksMutations(mutations) {
        const menuSelector = [
            '.func-menu__item_wrap',
            '.q-context-menu',
            '.q-context-menu-item',
            '[class*="context-menu"]',
            '[role="menu"]',
            '[role="menuitem"]'
        ].join(',');
        const menuAdded = mutations.some(mutation => Array.from(mutation.addedNodes).some(node => {
            if (!(node instanceof Element)) {
                return false;
            }
            return node.matches(menuSelector) ||
                Boolean(node.querySelector(menuSelector)) ||
                Boolean(node.parentElement?.closest(menuSelector));
        }));
        if (!menuAdded) {
            scheduleInterfaceTweaksRefresh();
            return;
        }
        applyInterfaceTweaks();
        installReplyAtCleanup();
    }

    function installInterfaceTweaksObserver() {
        if (interfaceObserver || !document.body) {
            scheduleInterfaceTweaksRefresh();
            return;
        }
        interfaceObserver = new MutationObserver(handleInterfaceTweaksMutations);
        interfaceObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        scheduleInterfaceTweaksRefresh();
    }

    function getCkeditorInstance() {
        return document.querySelector('.ck.ck-content.ck-editor__editable')?.ckeditorInstance || null;
    }

    function cleanupReplyAt(editor) {
        if (!isConfigEnabled('messageTweaks.removeReplyAt') || replyAtCleanupBusy) {
            return;
        }
        const model = editor?.model;
        const doc = model?.document;
        const root = doc?.getRoot?.();
        if (!model || !root) {
            return;
        }
        const hasReply = Array.from(root.getChildren?.() || []).some(child => child.is?.('element', 'msg-reply'));
        if (!hasReply) {
            return;
        }
        replyAtCleanupBusy = true;
        try {
            model.enqueueChange('transparent', writer => {
                let atElement = null;
                let nextText = null;
                for (const child of root.getChildren()) {
                    if (!child.is?.('element', 'paragraph')) {
                        continue;
                    }
                    const children = Array.from(child.getChildren?.() || []);
                    for (let index = 0; index < children.length - 1; index++) {
                        const current = children[index];
                        const next = children[index + 1];
                        if (current.is?.('element', 'msg-at')) {
                            atElement = current;
                            nextText = next;
                        }
                    }
                }
                if (nextText?.root && nextText.is?.('$text')) {
                    const raw = String(nextText.data || '');
                    const trimmed = raw.replace(/^\s+/, '');
                    if (trimmed !== raw) {
                        const position = writer.createPositionBefore(nextText);
                        const attributes = Object.fromEntries(Array.from(nextText.getAttributes?.() || []));
                        writer.remove(nextText);
                        if (trimmed) {
                            writer.insertText(trimmed, attributes, position);
                        }
                    }
                }
                if (atElement?.root) {
                    writer.remove(writer.createRangeOn(atElement));
                }
            });
        } catch {
        } finally {
            replyAtCleanupBusy = false;
        }
    }

    function installReplyAtCleanup() {
        const editor = getCkeditorInstance();
        if (!editor || editor === replyAtEditor) {
            return;
        }
        replyAtEditor = editor;
        editor.model?.document?.on?.('change:data', () => cleanupReplyAt(editor));
    }

    function getGoBackMainList() {
        return findVueValue(document.querySelector('.two-col-layout__aside .recent-contact .list-toggler'), [
            'proxy.goBackMainList',
            'ctx.goBackMainList'
        ]) || findVueValue(document.querySelector('.recent-contact-list--wrapper'), [
            'proxy.goBackMainList',
            'ctx.goBackMainList'
        ]);
    }

    function handleSideBackMouseUp(event) {
        if (event.button !== 3 || !isConfigEnabled('interfaceTweaks.goBackMainList')) {
            return;
        }
        const goBackMainList = getGoBackMainList();
        if (typeof goBackMainList !== 'function') {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        goBackMainList();
    }

    function handleRecentContactDragStart(event) {
        if (!isConfigEnabled('interfaceTweaks.preventRecentContactDrag')) {
            return;
        }
        const target = event.target instanceof Element ? event.target : null;
        const item = target?.closest('.recent-contact-item');
        if (!item?.closest('.recent-contact, .recent-contact-list--wrapper')) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
    }

    function handlePreventMessageDragPointerDown(event) {
        if (!isConfigEnabled('interfaceTweaks.preventMessageDrag') || !preventDragMouseButtons.has(event.buttons)) {
            preventDragActive = false;
            return;
        }
        const target = event.target instanceof Element ? event.target : null;
        const messageArea = target?.closest('.chat-msg-area, .message-panel, .ml-list');
        if (messageArea) {
            document.querySelector('.q-context-menu')?.remove();
        }
        preventDragActive = Boolean(target &&
            !target.closest('.message-content__wrapper') &&
            messageArea &&
            !target.closest('.v-scrollbar-track'));
    }

    function handlePreventMessageDragPointerUp(event) {
        if (event.buttons === 0) {
            preventDragActive = false;
        }
    }

    function handlePreventMessageDragMove(event) {
        if (!isConfigEnabled('interfaceTweaks.preventMessageDrag') || !preventDragActive || !preventDragMouseButtons.has(event.buttons)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
    }

    function isImageViewerWindow() {
        return String(location.hash || '').toLowerCase().includes('#/image-viewer') ||
            Boolean(document.querySelector('.main-area.main-area--image, .main-area--image'));
    }

    function isNativeMediaViewerWindow() {
        const hash = String(location.hash || '').toLowerCase();
        return ['#/image-viewer', '#/video-viewer', '#/media-viewer'].some(route => hash.includes(route)) ||
            isImageViewerWindow() ||
            Boolean(document.querySelector([
                '.main-area--video',
                '[class*="media-viewer"]'
            ].join(',')));
    }

    function closeInlineMediaPreview() {
        const layer = document.getElementById(INLINE_MEDIA_PREVIEW_ID);
        layer?.qqntToolboxDispose?.();
        layer?.querySelector('video')?.pause?.();
        layer?.remove();
        if (inlineMediaPreviewPreviousFocus instanceof HTMLElement && inlineMediaPreviewPreviousFocus.isConnected) {
            inlineMediaPreviewPreviousFocus.focus({ preventScroll: true });
        }
        inlineMediaPreviewPreviousFocus = null;
        inlineMediaPreviewOpenedAt = 0;
    }

    function syncInlineMediaPreviewBackground() {
        const layer = document.getElementById(INLINE_MEDIA_PREVIEW_ID);
        if (layer) {
            layer.dataset.background = getInlineMediaBackground();
        }
    }

    function openInlineMediaPreview(payload) {
        const galleryId = normalizeText(payload?.galleryId);
        const items = (Array.isArray(payload?.items) ? payload.items : [payload])
            .map(item => ({
                type: item?.type === 'video' ? 'video' : 'image',
                src: normalizeText(item?.src),
                previewSrc: normalizeText(item?.previewSrc),
                name: normalizeText(item?.name),
                pending: item?.pending === true,
                needsResolve: item?.needsResolve === true,
                loadRevision: 0
            }))
            .filter(item => item.src || item.needsResolve);
        let index = Math.min(Math.max(Number(payload?.index) || 0, 0), items.length - 1);
        if (!items.length || !document.body || isNativeMediaViewerWindow()) {
            return;
        }
        recordRendererDiagnostic('media.preview-rendered', {
            itemCount: items.length,
            selectedType: items[index]?.type || '',
            unresolvedItems: items.filter(item => item.needsResolve).length
        });
        injectStyle();
        closeInlineMediaPreview();
        inlineMediaPreviewPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const layer = document.createElement('div');
        layer.id = INLINE_MEDIA_PREVIEW_ID;
        layer.dataset.background = getInlineMediaBackground();
        layer.tabIndex = -1;
        layer.setAttribute('role', 'dialog');
        layer.setAttribute('aria-modal', 'true');
        const stage = document.createElement('div');
        stage.className = 'qqnt-toolbox-media-stage';
        const createNavButton = (direction, label) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `qqnt-toolbox-media-nav qqnt-toolbox-media-nav--${direction}`;
            button.setAttribute('aria-label', label);
            button.title = label;
            const icon = document.createElement('span');
            icon.className = 'qqnt-toolbox-media-nav-icon';
            button.append(icon);
            return button;
        };
        const previous = createNavButton('previous', text('上一个'));
        const next = createNavButton('next', text('下一个'));
        const counter = document.createElement('div');
        counter.className = 'qqnt-toolbox-media-counter';
        let activeMedia = null;
        let mediaScale = 1;
        let mediaOffsetX = 0;
        let mediaOffsetY = 0;
        let mediaPanState = null;
        let suppressPreviewCloseUntil = 0;
        let wheelNavigationDelta = 0;
        let wheelNavigationLockedUntil = 0;
        let activeMediaIndex = -1;
        let renderSequence = 0;
        let loadingPlaceholder = null;
        let disposed = false;
        let loadController = null;
        let preloadTimer = 0;
        const preparedMedia = new Map();
        const getMediaPanBounds = () => {
            if (activeMedia?.tagName !== 'IMG') {
                return { maxX: 0, maxY: 0, pannable: false };
            }
            const scaledWidth = activeMedia.offsetWidth * mediaScale;
            const scaledHeight = activeMedia.offsetHeight * mediaScale;
            const maxX = Math.max(0, (scaledWidth - stage.clientWidth) / 2);
            const maxY = Math.max(0, (scaledHeight - stage.clientHeight) / 2);
            return { maxX, maxY, pannable: maxX > .5 || maxY > .5 };
        };
        const resetMediaPan = () => {
            if (mediaPanState) {
                try {
                    stage.releasePointerCapture(mediaPanState.pointerId);
                } catch {
                }
            }
            mediaPanState = null;
            layer.classList.remove('is-panning');
        };
        const applyMediaTransform = () => {
            if (!activeMedia) {
                layer.classList.remove('is-pannable');
                return;
            }
            const bounds = getMediaPanBounds();
            mediaOffsetX = Math.max(-bounds.maxX, Math.min(bounds.maxX, mediaOffsetX));
            mediaOffsetY = Math.max(-bounds.maxY, Math.min(bounds.maxY, mediaOffsetY));
            activeMedia.style.transform =
                `translate3d(${mediaOffsetX}px, ${mediaOffsetY}px, 0) scale(${mediaScale})`;
            layer.classList.toggle('is-pannable', bounds.pannable);
            if (!bounds.pannable) {
                resetMediaPan();
            }
        };
        const handleMediaViewportResize = () => applyMediaTransform();
        window.addEventListener('resize', handleMediaViewportResize, { passive: true });
        const releaseMedia = media => {
            media?.pause?.();
            media?.removeAttribute?.('poster');
            media?.removeAttribute?.('src');
            media?.load?.();
        };
        const clearLoadingPlaceholder = () => {
            const placeholder = loadingPlaceholder;
            loadingPlaceholder = null;
            releaseMedia(placeholder);
            placeholder?.remove?.();
        };
        const createAbortError = () => Object.assign(new Error('media load aborted'), { name: 'AbortError' });
        const isAbortError = error => error?.name === 'AbortError';
        const getMediaSource = item => {
            if (!item.loadRevision || !/^https?:/i.test(item.src)) {
                return item.src;
            }
            const separator = item.src.includes('?') ? '&' : '?';
            return `${item.src}${separator}qqnt_toolbox_retry=${item.loadRevision}`;
        };
        const loadMedia = async (item, mediaIndex, signal) => {
            const isVideo = item.type === 'video';
            const media = document.createElement(isVideo ? 'video' : 'img');
            media.draggable = false;
            if (isVideo) {
                media.preload = 'metadata';
                media.playsInline = true;
                if (item.previewSrc) {
                    media.poster = item.previewSrc;
                }
            } else {
                media.decoding = 'async';
            }
            await new Promise((resolve, reject) => {
                const readyEvent = isVideo ? 'loadedmetadata' : 'load';
                let settled = false;
                const timer = window.setTimeout(
                    () => finish(new Error('media load timed out')),
                    item.pending ? (isVideo ? 65000 : 12000) : isVideo ? 12000 : 6000
                );
                const cleanup = () => {
                    clearTimeout(timer);
                    media.removeEventListener(readyEvent, handleReady);
                    media.removeEventListener('error', handleError);
                    signal.removeEventListener('abort', handleAbort);
                };
                const finish = error => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    cleanup();
                    if (error) {
                        releaseMedia(media);
                        reject(error);
                    } else {
                        resolve();
                    }
                };
                const handleReady = async () => {
                    recordRendererDiagnostic('media.load-ready', {
                        index: mediaIndex,
                        type: item.type,
                        readyState: Number(media.readyState) || 0
                    });
                    if (!isVideo) {
                        await media.decode?.().catch(() => {});
                    }
                    finish(signal.aborted ? createAbortError() : null);
                };
                function handleError() {
                    finish(new Error('media load failed'));
                }
                const handleAbort = () => finish(createAbortError());
                media.addEventListener(readyEvent, handleReady, { once: true });
                media.addEventListener('error', handleError, { once: true });
                signal.addEventListener('abort', handleAbort, { once: true });
                if (signal.aborted) {
                    handleAbort();
                    return;
                }
                media.src = getMediaSource(item);
                media.load?.();
            });
            return media;
        };
        const prepareMedia = async (item, mediaIndex, signal) => {
            if (item.src) {
                try {
                    return await loadMedia(item, mediaIndex, signal);
                } catch (error) {
                    if (isAbortError(error)) {
                        throw error;
                    }
                }
            }
            if (!item.needsResolve || !galleryId || signal.aborted) {
                throw signal.aborted ? createAbortError() : new Error('media load failed');
            }
            const resolved = await getBridge()?.prepareInlineMedia?.({ galleryId, index: mediaIndex });
            if (signal.aborted) {
                throw createAbortError();
            }
            if (!resolved?.src) {
                throw new Error('media resolve failed');
            }
            item.src = normalizeText(resolved.src);
            item.previewSrc = normalizeText(resolved.previewSrc) || item.previewSrc;
            item.name = normalizeText(resolved.name) || item.name;
            item.pending = resolved.pending === true;
            item.loadRevision += 1;
            return await loadMedia(item, mediaIndex, signal);
        };
        const dropPreparedMedia = mediaIndex => {
            const entry = preparedMedia.get(mediaIndex);
            if (!entry) {
                return;
            }
            preparedMedia.delete(mediaIndex);
            entry.controller.abort();
            releaseMedia(entry.media);
        };
        const getPreparedMedia = mediaIndex => {
            if (mediaIndex < 0 || mediaIndex >= items.length) {
                return null;
            }
            const cached = preparedMedia.get(mediaIndex);
            if (cached) {
                return cached;
            }
            const entry = {
                controller: new AbortController(),
                media: null,
                promise: null
            };
            entry.promise = prepareMedia(items[mediaIndex], mediaIndex, entry.controller.signal)
                .then(media => {
                    if (entry.controller.signal.aborted) {
                        releaseMedia(media);
                        throw createAbortError();
                    }
                    entry.media = media;
                    return media;
                })
                .catch(error => {
                    if (preparedMedia.get(mediaIndex) === entry) {
                        preparedMedia.delete(mediaIndex);
                    }
                    throw error;
                });
            preparedMedia.set(mediaIndex, entry);
            return entry;
        };
        const scheduleAdjacentPreload = () => {
            clearTimeout(preloadTimer);
            const scheduledIndex = index;
            preloadTimer = window.setTimeout(() => {
                preloadTimer = 0;
                if (disposed || index !== scheduledIndex) {
                    return;
                }
                const retained = new Set([index - 1, index + 1]);
                for (const mediaIndex of retained) {
                    if (items[mediaIndex]?.type !== 'image') {
                        continue;
                    }
                    getPreparedMedia(mediaIndex)?.promise.catch(() => {});
                }
                for (const mediaIndex of Array.from(preparedMedia.keys())) {
                    if (!retained.has(mediaIndex)) {
                        dropPreparedMedia(mediaIndex);
                    }
                }
            }, 100);
        };
        const updateNavigation = () => {
            previous.disabled = index === 0;
            next.disabled = index === items.length - 1;
            previous.hidden = items.length < 2;
            next.hidden = items.length < 2;
            counter.hidden = items.length < 2;
            counter.textContent = `${index + 1} / ${items.length}`;
        };
        const render = async () => {
            const sequence = ++renderSequence;
            const renderIndex = index;
            const item = items[renderIndex];
            const isVideo = item.type === 'video';
            clearTimeout(preloadTimer);
            preloadTimer = 0;
            loadController?.abort();
            const prepared = getPreparedMedia(renderIndex);
            if (!prepared) {
                return;
            }
            preparedMedia.delete(renderIndex);
            loadController = prepared.controller;
            activeMedia?.pause?.();
            resetMediaPan();
            clearLoadingPlaceholder();
            if (!activeMedia) {
                stage.replaceChildren();
            }
            mediaScale = 1;
            mediaOffsetX = 0;
            mediaOffsetY = 0;
            suppressPreviewCloseUntil = 0;
            wheelNavigationDelta = 0;
            stage.classList.add('is-loading');
            stage.setAttribute('aria-busy', 'true');
            layer.setAttribute('aria-label', text(isVideo ? '视频预览' : '图片预览'));
            updateNavigation();
            if (!activeMedia && item.previewSrc) {
                loadingPlaceholder = document.createElement('img');
                loadingPlaceholder.className = 'qqnt-toolbox-media-placeholder';
                loadingPlaceholder.alt = '';
                loadingPlaceholder.decoding = 'async';
                const placeholder = loadingPlaceholder;
                placeholder.addEventListener('error', () => {
                    if (loadingPlaceholder === placeholder) {
                        clearLoadingPlaceholder();
                    }
                }, { once: true });
                loadingPlaceholder.src = item.previewSrc;
                stage.append(loadingPlaceholder);
            }
            let media;
            try {
                media = await prepared.promise;
            } catch (loadError) {
                if (disposed || sequence !== renderSequence) {
                    return;
                }
                recordRendererDiagnostic('media.load-failed', {
                    index: renderIndex,
                    type: item.type,
                    reason: loadError?.message || String(loadError)
                }, 'warn');
                const previousMedia = activeMedia;
                activeMedia = null;
                activeMediaIndex = -1;
                const error = document.createElement('div');
                error.className = 'qqnt-toolbox-media-error';
                const errorLabel = document.createElement('span');
                errorLabel.textContent = text('\u5a92\u4f53\u52a0\u8f7d\u5931\u8d25');
                const retry = document.createElement('button');
                retry.type = 'button';
                retry.className = 'qqnt-toolbox-media-retry qqnt-toolbox-media-control';
                retry.setAttribute('aria-label', text('重试'));
                retry.title = text('重试');
                retry.textContent = '↻';
                retry.addEventListener('click', event => {
                    event.preventDefault();
                    stopEvent(event);
                    if (disposed || index !== renderIndex) {
                        return;
                    }
                    if (item.needsResolve) {
                        item.src = '';
                    }
                    item.loadRevision += 1;
                    render().catch(() => {});
                });
                error.append(errorLabel, retry);
                clearLoadingPlaceholder();
                stage.replaceChildren(error);
                releaseMedia(previousMedia);
                stage.classList.remove('is-loading');
                stage.removeAttribute('aria-busy');
                return;
            }
            if (disposed || sequence !== renderSequence) {
                return;
            }
            clearLoadingPlaceholder();
            const previousMedia = activeMedia;
            activeMedia = media;
            activeMediaIndex = renderIndex;
            if (isVideo) {
                media.controls = true;
                media.setAttribute('controlsList', 'nodownload nofullscreen noremoteplayback');
                media.disablePictureInPicture = true;
                media.disableRemotePlayback = true;
                media.autoplay = true;
                media.preload = 'auto';
                media.playsInline = true;
                if (media.readyState >= 3) {
                    media.play().catch(() => {});
                } else {
                    media.addEventListener('canplay', () => {
                        if (activeMedia === media) {
                            media.play().catch(() => {});
                        }
                    }, { once: true });
                }
            } else {
                media.alt = item.name || text('图片');
            }
            stage.replaceChildren(media);
            if (previousMedia !== media) {
                releaseMedia(previousMedia);
            }
            applyMediaTransform();
            stage.classList.remove('is-loading');
            stage.removeAttribute('aria-busy');
            scheduleAdjacentPreload();
        };
        const navigate = delta => {
            const nextIndex = Math.min(Math.max(index + delta, 0), items.length - 1);
            if (nextIndex === index) {
                return;
            }
            index = nextIndex;
            render().catch(() => {});
        };
        layer.qqntToolboxNavigate = navigate;
        previous.addEventListener('click', () => navigate(-1));
        next.addEventListener('click', () => navigate(1));
        layer.append(stage, previous, next, counter);
        render().catch(() => {});
        layer.qqntToolboxDispose = () => {
            disposed = true;
            clearTimeout(preloadTimer);
            loadController?.abort();
            for (const mediaIndex of Array.from(preparedMedia.keys())) {
                dropPreparedMedia(mediaIndex);
            }
            resetMediaPan();
            clearLoadingPlaceholder();
            window.removeEventListener('resize', handleMediaViewportResize);
            renderSequence += 1;
            activeMedia = null;
            activeMediaIndex = -1;
        };
        const stopEvent = event => {
            event.stopPropagation();
            event.stopImmediatePropagation?.();
        };
        stage.addEventListener('pointerdown', event => {
            if (event.button !== 0 || !getMediaPanBounds().pannable) {
                return;
            }
            mediaPanState = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                offsetX: mediaOffsetX,
                offsetY: mediaOffsetY,
                moved: false
            };
            try {
                stage.setPointerCapture(event.pointerId);
            } catch {
            }
            event.preventDefault();
            stopEvent(event);
        });
        stage.addEventListener('pointermove', event => {
            if (!mediaPanState || mediaPanState.pointerId !== event.pointerId) {
                return;
            }
            const deltaX = event.clientX - mediaPanState.startX;
            const deltaY = event.clientY - mediaPanState.startY;
            if (!mediaPanState.moved && Math.hypot(deltaX, deltaY) < 4) {
                stopEvent(event);
                return;
            }
            mediaPanState.moved = true;
            mediaOffsetX = mediaPanState.offsetX + deltaX;
            mediaOffsetY = mediaPanState.offsetY + deltaY;
            layer.classList.add('is-panning');
            applyMediaTransform();
            event.preventDefault();
            stopEvent(event);
        });
        const finishMediaPan = (event, cancelled = false) => {
            if (!mediaPanState || mediaPanState.pointerId !== event.pointerId) {
                return;
            }
            const moved = mediaPanState.moved;
            resetMediaPan();
            if (moved && !cancelled) {
                suppressPreviewCloseUntil = performance.now() + 350;
                event.preventDefault();
            }
            stopEvent(event);
        };
        stage.addEventListener('pointerup', event => finishMediaPan(event));
        stage.addEventListener('pointercancel', event => finishMediaPan(event, true));
        for (const eventName of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick']) {
            layer.addEventListener(eventName, stopEvent);
        }
        for (const eventName of ['contextmenu', 'dragstart']) {
            layer.addEventListener(eventName, event => {
                event.preventDefault();
                stopEvent(event);
            }, { passive: false });
        }
        layer.addEventListener('wheel', event => {
            event.preventDefault();
            stopEvent(event);
            if (!Number.isFinite(event.deltaY) || event.deltaY === 0) {
                return;
            }
            if (!event.ctrlKey) {
                const now = performance.now();
                if (now < wheelNavigationLockedUntil) {
                    wheelNavigationDelta = 0;
                    return;
                }
                wheelNavigationDelta += event.deltaY;
                if (Math.abs(wheelNavigationDelta) < 60) {
                    return;
                }
                const direction = wheelNavigationDelta > 0 ? 1 : -1;
                wheelNavigationDelta = 0;
                wheelNavigationLockedUntil = now + 180;
                navigate(direction);
                return;
            }
            wheelNavigationDelta = 0;
            if (!activeMedia) {
                return;
            }
            const stageRect = stage.getBoundingClientRect();
            const pointerX = event.clientX - stageRect.left - stageRect.width / 2;
            const pointerY = event.clientY - stageRect.top - stageRect.height / 2;
            const wheelDelta = Math.max(-160, Math.min(160, event.deltaY));
            const nextScale = Math.max(.25, Math.min(8, mediaScale * Math.exp(-wheelDelta * .0018)));
            if (nextScale === mediaScale) {
                return;
            }
            const scaleRatio = nextScale / mediaScale;
            mediaOffsetX = pointerX - (pointerX - mediaOffsetX) * scaleRatio;
            mediaOffsetY = pointerY - (pointerY - mediaOffsetY) * scaleRatio;
            mediaScale = nextScale;
            applyMediaTransform();
        }, { passive: false });
        layer.addEventListener('click', event => {
            stopEvent(event);
            if (performance.now() < suppressPreviewCloseUntil) {
                event.preventDefault();
                return;
            }
            if (performance.now() - inlineMediaPreviewOpenedAt < 320) {
                event.preventDefault();
                return;
            }
            if (event.target instanceof Element && event.target.closest('.qqnt-toolbox-media-control, .qqnt-toolbox-media-nav')) {
                event.preventDefault();
                return;
            }
            const isVideo = items[index].type === 'video';
            if (!isVideo || event.target === layer || event.target === stage) {
                event.preventDefault();
                closeInlineMediaPreview();
            }
        });
        document.body.append(layer);
        inlineMediaPreviewOpenedAt = performance.now();
        layer.focus({ preventScroll: true });
    }

    function getVideoOpenControl(element) {
        const playControlSelector = [
            '.file-progress',
            'button',
            '[role="button"]',
            '[class~="play"]',
            '[class*="video-play"]',
            '[class*="play-btn"]',
            '[class*="play-button"]',
            '[class*="play-icon"]'
        ].join(',');
        const isUsableControl = control => {
            if (!(control instanceof Element) || !element.contains(control)) {
                return false;
            }
            const controlRect = control.getBoundingClientRect();
            const x = controlRect.left + controlRect.width / 2;
            const y = controlRect.top + controlRect.height / 2;
            if (controlRect.width <= 0 || controlRect.height <= 0 ||
                x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
                return false;
            }
            const hit = document.elementFromPoint(x, y);
            return hit === control || (hit instanceof Node && control.contains(hit));
        };
        const rect = element.getBoundingClientRect();
        const fileProgress = element.matches('.file-progress')
            ? element
            : element.querySelector('.file-progress');
        if (isUsableControl(fileProgress)) {
            return fileProgress;
        }
        const center = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        if (center instanceof Element && element.contains(center)) {
            const control = center.closest(playControlSelector);
            if (isUsableControl(control)) {
                return control;
            }
            return center;
        }
        return Array.from(element.querySelectorAll([
            '.file-progress',
            '[class~="play"]',
            '[class*="video-play"]',
            '[class*="play-btn"]',
            '[class*="play-button"]',
            '[class*="play-icon"]',
            'button[aria-label*="播放"]',
            '[role="button"][aria-label*="播放"]'
        ].join(','))).find(isUsableControl) || null;
    }

    function isPointInsideMediaElement(element, event) {
        if (!(element instanceof Element)) {
            return false;
        }
        const x = Number(event?.clientX);
        const y = Number(event?.clientY);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 &&
            x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }

    function getClickedMediaElement(event, matchedElement) {
        if (!(matchedElement instanceof Element)) {
            return null;
        }
        const directSelectors = [
            '.pic-element',
            '.video-element',
            '.msg-preview--video',
            '.file-element'
        ].join(',');
        const candidates = [];
        for (const node of event?.composedPath?.() || []) {
            if (node instanceof Element && node.matches(directSelectors) && matchedElement.contains(node)) {
                candidates.push(node);
            }
        }
        candidates.push(...matchedElement.querySelectorAll(directSelectors));
        const contentScope = matchedElement.closest('.message-content__wrapper') ||
            matchedElement.querySelector('.message-content__wrapper') ||
            matchedElement;
        candidates.push(...Array.from(contentScope.querySelectorAll('img, video, canvas')).filter(candidate =>
            !candidate.closest('.avatar, [class*="avatar"], [data-testid*="avatar"]')
        ));
        const unique = Array.from(new Set(candidates));
        return unique.find(candidate => isPointInsideMediaElement(candidate, event)) || null;
    }

    function isMarketFaceRecordElement(element) {
        return Boolean(element?.marketFaceElement) || Number(element?.elementType) === 11;
    }

    function getMarketFaceRecordData(element) {
        return element?.marketFaceElement || (Number(element?.elementType) === 11 ? element : null);
    }

    function isExcludedEmojiDomElement(element) {
        return element instanceof Element && Boolean(element.closest(EMOJI_DOM_EXCLUDED_SELECTOR));
    }

    function isEmojiVisualElement(element) {
        if (!(element instanceof Element) || isExcludedEmojiDomElement(element)) {
            return false;
        }
        if (['IMG', 'CANVAS', 'VIDEO'].includes(element.tagName)) {
            return true;
        }
        if (element.matches(EMOJI_DOM_ROOT_SELECTOR)) {
            return true;
        }
        try {
            return getComputedStyle(element).backgroundImage !== 'none';
        } catch {
            return false;
        }
    }

    function getEmojiVisualElement(root, event) {
        if (!(root instanceof Element) || isExcludedEmojiDomElement(root)) {
            return null;
        }
        const candidates = [];
        const path = event?.composedPath?.() || [];
        for (const item of path) {
            if (item instanceof Element && root.contains(item) &&
                ['IMG', 'CANVAS', 'VIDEO'].includes(item.tagName)) {
                candidates.push(item);
            }
        }
        candidates.push(...root.querySelectorAll('img, canvas, video'));
        const visual = Array.from(new Set(candidates)).find(candidate =>
            isPointInsideMediaElement(candidate, event) && !isExcludedEmojiDomElement(candidate)
        );
        if (visual) {
            return visual;
        }
        return isPointInsideMediaElement(root, event) && isEmojiVisualElement(root) ? root : null;
    }

    function getEmojiDomRoots(messageElement) {
        if (!(messageElement instanceof Element)) {
            return [];
        }
        const roots = [];
        if (messageElement.matches(EMOJI_DOM_ROOT_SELECTOR)) {
            roots.push(messageElement);
        }
        roots.push(...messageElement.querySelectorAll(EMOJI_DOM_ROOT_SELECTOR));
        const unique = Array.from(new Set(roots)).filter(root => !isExcludedEmojiDomElement(root));
        const nestedFiltered = unique.filter(root => !unique.some(other => other !== root && other.contains(root)));
        if (nestedFiltered.length) {
            return nestedFiltered;
        }
        const content = messageElement.querySelector('.message-content__wrapper, .message-content') || messageElement;
        return Array.from(content.querySelectorAll('img, canvas, video')).filter(candidate =>
            !candidate.closest(MESSAGE_MEDIA_SELECTOR) &&
            !isExcludedEmojiDomElement(candidate) &&
            isEmojiVisualElement(candidate)
        );
    }

    function getClickedEmojiDomRoot(event, messageElement, record) {
        const path = event?.composedPath?.() || [];
        const directRoot = path.find(item => item instanceof Element &&
            item.matches(EMOJI_DOM_ROOT_SELECTOR) &&
            messageElement.contains(item) &&
            !isExcludedEmojiDomElement(item) &&
            isPointInsideMediaElement(item, event));
        if (directRoot) {
            return directRoot;
        }
        const faces = Array.isArray(record?.elements)
            ? record.elements.filter(isMarketFaceRecordElement)
            : [];
        if (!faces.length) {
            return null;
        }
        const hasOrdinaryMedia = Array.isArray(record?.elements) && record.elements.some(element => {
            const kind = getRecordMediaKind(element);
            return ['image', 'video', 'image-file', 'video-file'].includes(kind);
        });
        if (hasOrdinaryMedia) {
            return null;
        }
        const roots = getEmojiDomRoots(messageElement);
        const clickedRoot = roots.find(root =>
            isPointInsideMediaElement(root, event) && !isExcludedEmojiDomElement(root)
        );
        if (clickedRoot && (faces.length === 1 || roots.length === faces.length)) {
            return clickedRoot;
        }
        if (faces.length !== 1) {
            return null;
        }
        const content = messageElement.querySelector('.message-content__wrapper, .message-content') || messageElement;
        const visual = Array.from(content.querySelectorAll('img, canvas, video')).find(candidate =>
            isPointInsideMediaElement(candidate, event) &&
            !candidate.closest(MESSAGE_MEDIA_SELECTOR) &&
            !isExcludedEmojiDomElement(candidate)
        );
        return visual && isEmojiVisualElement(visual) ? visual : null;
    }

    function getEmojiVisualSources(visual) {
        if (!(visual instanceof Element)) {
            return [];
        }
        const values = [
            visual.currentSrc,
            visual.src,
            visual.getAttribute('src'),
            visual.getAttribute('data-src'),
            visual.getAttribute('data-original'),
            visual.dataset?.src,
            visual.dataset?.original
        ];
        try {
            const background = getComputedStyle(visual).backgroundImage;
            const match = background.match(/url\((?:"|')?(.*?)(?:"|')?\)/i);
            if (match?.[1]) {
                values.push(match[1]);
            }
        } catch {
        }
        return Array.from(new Set(values.map(normalizeText).filter(Boolean)));
    }

    function getEmojiImageTarget(event) {
        if (!(event?.target instanceof Element)) {
            return null;
        }
        const messageElement = getMessageElementFromElement(event.target);
        if (!(messageElement instanceof Element) || event.target.closest(`#${INLINE_MEDIA_PREVIEW_ID}`)) {
            return null;
        }
        const record = findMessageRecordFromElement(messageElement) || findMessageRecordFromElement(event.target);
        const faces = Array.isArray(record?.elements)
            ? record.elements.filter(isMarketFaceRecordElement)
            : [];
        if (!faces.length) {
            return null;
        }
        const clickedRoot = getClickedEmojiDomRoot(event, messageElement, record);
        if (!(clickedRoot instanceof Element)) {
            return null;
        }
        const visual = getEmojiVisualElement(clickedRoot, event) || clickedRoot;
        if (!isEmojiVisualElement(visual) || isExcludedEmojiDomElement(visual)) {
            return null;
        }
        const roots = getEmojiDomRoots(messageElement);
        const renderedId = getMediaDomElementId(clickedRoot) || getMediaDomElementId(visual);
        let face = renderedId
            ? faces.find(element => normalizeText(element?.elementId) === renderedId)
            : null;
        if (!face) {
            const clickedIndex = roots.indexOf(clickedRoot);
            face = clickedIndex >= 0 ? (faces[clickedIndex] || faces[0]) : faces[0];
        }
        const data = getMarketFaceRecordData(face);
        if (!data) {
            return null;
        }
        return {
            visual,
            face: data,
            sources: [
                data.staticFacePath,
                data.dynamicFacePath,
                data.sourcePath,
                data.filePath,
                data.localPath,
                data.path,
                data.originImageUrl,
                data.emojiWebUrl,
                data.originUrl,
                data.url,
                ...getEmojiVisualSources(visual)
            ].map(normalizeText).filter(Boolean),
            name: normalizeText(data.faceName) || text('表情'),
            width: Number(data.imageWidth) || 0,
            height: Number(data.imageHeight) || 0
        };
    }

    function hasFileMediaExtension(element, extensions) {
        const file = element?.fileElement || element;
        const source = normalizeText(
            file?.fileName || file?.filePath || file?.sourcePath || file?.originPath || file?.localPath
        ).split(/[?#]/, 1)[0];
        const match = source.match(/\.([^.\\/]+)$/);
        return Boolean(match && extensions.has(match[1].toLowerCase()));
    }

    function getRecordMediaKind(element) {
        const elementType = Number(element?.elementType) || 0;
        if (elementType === 5 || element?.videoElement) {
            return 'video';
        }
        if (elementType === 2 || element?.picElement) {
            return 'image';
        }
        if (elementType === 3 || element?.fileElement) {
            if (hasFileMediaExtension(element, VIDEO_FILE_EXTENSIONS)) {
                return 'video-file';
            }
            if (hasFileMediaExtension(element, IMAGE_FILE_EXTENSIONS)) {
                return 'image-file';
            }
            return 'file';
        }
        return '';
    }

    function getRecordMediaValues(value) {
        if (typeof value === 'string') {
            return [normalizeText(value)].filter(Boolean);
        }
        if (value instanceof Map) {
            return Array.from(value.values()).flatMap(getRecordMediaValues);
        }
        if (Array.isArray(value)) {
            return value.flatMap(getRecordMediaValues);
        }
        if (value && typeof value === 'object') {
            return Object.values(value).flatMap(getRecordMediaValues);
        }
        return [];
    }

    function createInlineMediaOpenItem(record, recordElement, sourceIndex) {
        const kind = getRecordMediaKind(recordElement);
        const type = ['video', 'video-file'].includes(kind)
            ? 'video'
            : ['image', 'image-file'].includes(kind) ? 'image' : '';
        if (!type) {
            return null;
        }
        const media = recordElement?.videoElement || recordElement?.fileElement ||
            recordElement?.picElement || recordElement;
        const sourceValues = [
            media?.filePath,
            media?.sourcePath,
            media?.originPath,
            media?.localPath,
            media?.path
        ].flatMap(getRecordMediaValues);
        const resourcePattern = /^(?:https?|appimg|local|blob):/i;
        const filePath = sourceValues.find(value => !resourcePattern.test(value)) || '';
        const sourceUrl = sourceValues.find(value => resourcePattern.test(value)) || '';
        const previewSource = [
            media?.coverPath,
            media?.thumbPath,
            media?.picThumbPath
        ].flatMap(getRecordMediaValues)[0] || '';
        const peer = getPeerFromRecord(record);
        const identity = {
            chatType: Number(peer?.chatType || record?.chatType) || 0,
            peerUid: normalizeText(peer?.peerUid || record?.peerUid || record?.peer?.peerUid),
            msgId: normalizeText(record?.msgId),
            msgSeq: normalizeText(record?.msgSeq),
            elementId: normalizeText(recordElement?.elementId)
        };
        const pendingFile = kind.endsWith('-file') && !filePath && !sourceUrl &&
            Boolean(identity.msgId && identity.elementId);
        if (!filePath && !sourceUrl && !pendingFile) {
            return null;
        }
        const item = {
            type,
            ...(filePath ? { filePath } : {}),
            ...(sourceUrl ? { sourceUrl } : {}),
            ...(previewSource ? { previewSource } : {}),
            fingerprint: normalizeText(
                media?.md5HexStr || media?.originImageMd5 || media?.videoMd5 || media?.fileMd5
            ).toLowerCase(),
            name: normalizeText(media?.fileName || media?.summary) ||
                filePath.split(/[\\/]/).pop() || (type === 'video' ? 'video.mp4' : 'image.png'),
            sourceIndex,
            identity,
            ...(pendingFile ? { pendingFile: true } : {})
        };
        if (!isForwardRecordWindow()) {
            return item;
        }
        item.recordSource = 'forward-detail';
        return item;
    }

    function getMediaDomSelectorGroups(kind) {
        if (kind === 'video') {
            return [
                ['.video-element', '.msg-preview--video'],
                ['[class*="video-message"]']
            ];
        }
        if (kind === 'file') {
            return [
                ['.file-element'],
                ['[class*="file-message"]']
            ];
        }
        return [
            ['.pic-element'],
            ['.mix-message__container--pic']
        ];
    }

    function getMediaDomRoot(element, kind) {
        if (!(element instanceof Element)) {
            return null;
        }
        for (const selectors of getMediaDomSelectorGroups(kind)) {
            const selector = selectors.join(',');
            if (element.matches(selector)) {
                return element;
            }
            const root = element.closest(selector);
            if (root) {
                return root;
            }
        }
        return null;
    }

    function getMediaDomRoots(scope, kind) {
        if (!(scope instanceof Element)) {
            return [];
        }
        for (const selectors of getMediaDomSelectorGroups(kind)) {
            const selector = selectors.join(',');
            const roots = [];
            if (scope.matches(selector)) {
                roots.push(scope);
            }
            roots.push(...scope.querySelectorAll(selector));
            const unique = Array.from(new Set(roots));
            if (unique.length) {
                const replyScope = scope.closest('.reply-message__inner');
                const filtered = unique.filter(root => {
                    const rootReplyScope = root.closest('.reply-message__inner');
                    return !rootReplyScope || rootReplyScope === replyScope;
                });
                return filtered.length ? filtered : unique;
            }
        }
        return [];
    }

    function getMediaDomScope(element, messageElement) {
        return element?.closest?.(
            '.reply-message__inner, .message-content.mix-message__inner, .message-content__wrapper'
        ) || messageElement;
    }

    function getMediaDomElementId(element) {
        if (!(element instanceof Element)) {
            return '';
        }
        return normalizeText(
            element.dataset?.elementId ||
            element.getAttribute('data-element-id') ||
            element.getAttribute('data-elementid') ||
            element.getAttribute('element-id')
        );
    }

    function getClickedRecordMediaElement(record, item, renderedElement, kind, eventTarget) {
        const elements = Array.isArray(record?.elements) ? record.elements : [];
        const candidates = elements.filter(element => {
            const candidateKind = getRecordMediaKind(element);
            return kind === 'file'
                ? ['file', 'image-file', 'video-file'].includes(candidateKind)
                : candidateKind === kind;
        });
        if (!candidates.length) {
            return null;
        }
        const renderedId = getMediaDomElementId(eventTarget) ||
            getMediaDomElementId(renderedElement) ||
            getMediaDomElementId(item);
        if (renderedId) {
            const exact = candidates.find(element => normalizeText(element?.elementId) === renderedId);
            if (exact) {
                return exact;
            }
        }
        const messageElement = item?.closest?.('.message, .ml-item');
        const scope = getMediaDomScope(eventTarget || item, messageElement);
        const roots = getMediaDomRoots(scope, kind);
        const clickedRoot = getMediaDomRoot(eventTarget, kind) ||
            getMediaDomRoot(renderedElement || item, kind);
        const clickedIndex = clickedRoot ? roots.indexOf(clickedRoot) : -1;
        return clickedIndex >= 0 ? (candidates[clickedIndex] || candidates[0]) : candidates[0];
    }

    function getMarkdownMediaTarget(event) {
        const messageElement = event?.target instanceof Element
            ? getMessageElementFromElement(event.target)
            : null;
        if (!(messageElement instanceof Element)) {
            return null;
        }
        const record = findMessageRecordFromElement(messageElement) || findMessageRecordFromElement(event.target);
        const elements = Array.isArray(record?.elements) ? record.elements : [];
        const markdownElements = elements.filter(element => Boolean(element?.markdownElement));
        if (!markdownElements.length) {
            return null;
        }
        const excludedSelectors = [
            EMOJI_DOM_ROOT_SELECTOR,
            '.avatar',
            '[class*="avatar" i]',
            '.reply-message__inner',
            '[class*="reply-message" i]',
            '[class*="reaction" i]',
            '.q-context-menu',
            '#' + INLINE_MEDIA_PREVIEW_ID
        ];
        const visual = (event.composedPath?.() || []).find(item =>
            item instanceof Element && item.tagName === 'IMG' &&
            messageElement.contains(item) &&
            !item.closest(excludedSelectors.join(','))
        );
        if (!(visual instanceof Element) || visual.tagName !== 'IMG') {
            return null;
        }
        if (!normalizeText(visual.currentSrc || visual.src || visual.getAttribute('src'))) {
            return null;
        }
        const renderedId = getMediaDomElementId(visual);
        const markdownElement = renderedId
            ? markdownElements.find(element => normalizeText(element?.elementId) === renderedId)
            : markdownElements.length === 1 ? markdownElements[0] : null;
        if (!markdownElement) {
            return null;
        }
        return {
            element: visual,
            isVideo: false,
            isFileMedia: false,
            source: 'markdown',
            openControl: visual
        };
    }
    function getSingleClickMediaTarget(event) {
        const path = event.composedPath?.() || [event.target];
        for (const item of path) {
            if (!(item instanceof Element) || !item.matches(MESSAGE_MEDIA_SELECTOR)) {
                continue;
            }
            if (!item.closest('.message, .ml-item') || item.closest(`#${INLINE_MEDIA_PREVIEW_ID}`)) {
                continue;
            }
            const mediaElement = getClickedMediaElement(event, item);
            if (!mediaElement) {
                continue;
            }
            const record = findMessageRecordFromElement(mediaElement) || findMessageRecordFromElement(item);
            const elements = Array.isArray(record?.elements) ? record.elements : [];
            const videoElements = elements.filter(element =>
                Number(element?.elementType) === 5 || Boolean(element?.videoElement)
            );
            const imageElements = elements.filter(element =>
                Number(element?.elementType) === 2 || Boolean(element?.picElement)
            );
            const hasVideo = videoElements.length > 0;
            const hasImage = imageElements.length > 0;
            const videoFileElements = elements.filter(element =>
                (Number(element?.elementType) === 3 || Boolean(element?.fileElement)) &&
                hasFileMediaExtension(element, VIDEO_FILE_EXTENSIONS)
            );
            const imageFileElements = elements.filter(element =>
                (Number(element?.elementType) === 3 || Boolean(element?.fileElement)) &&
                hasFileMediaExtension(element, IMAGE_FILE_EXTENSIONS)
            );
            const hasVideoFile = videoFileElements.length > 0;
            const hasImageFile = imageFileElements.length > 0;
            const isFileMessage = item.matches('.file-element, [class*="file-message"]') ||
                mediaElement.matches('.file-element');
            const elementLooksLikeVideo = item.matches(
                '.video-element, .msg-preview--video, [class*="video-message"]'
            ) || mediaElement.matches('.video-element, .msg-preview--video, [class*="video-message"], video');
            const provisionalIsVideo = isFileMessage
                ? hasVideoFile && !hasImageFile
                : elementLooksLikeVideo || (hasVideo && !hasImage);
            const isVideo = provisionalIsVideo;
            const matchesRecord = isFileMessage
                ? hasVideoFile || hasImageFile
                : isVideo ? hasVideo : hasImage;
            if (matchesRecord) {
                let element;
                if (isFileMessage) {
                    element = mediaElement.closest('.file-element') ||
                        mediaElement.closest('[class*="file-message"]') || mediaElement;
                } else if (isVideo) {
                    element = mediaElement.closest('.video-element, .msg-preview--video') || mediaElement;
                } else {
                    element = mediaElement.closest('.pic-element, .mix-message__container--pic') || mediaElement;
                }
                const mediaKind = isFileMessage ? 'file' : isVideo ? 'video' : 'image';
                const inlineElement = getClickedRecordMediaElement(record, mediaElement, element, mediaKind, event.target) ||
                    (isFileMessage
                        ? (provisionalIsVideo ? videoFileElements[0] : imageFileElements[0])
                        : isVideo ? videoElements[0] : imageElements[0]);
                const selectedKind = getRecordMediaKind(inlineElement);
                const isFileVideo = isFileMessage
                    ? selectedKind === 'video-file' || (!selectedKind && provisionalIsVideo)
                    : false;
                const isFileImage = isFileMessage && selectedKind === 'image-file';
                const resolvedIsVideo = isFileMessage ? isFileVideo : isVideo;
                return {
                    element,
                    isVideo: resolvedIsVideo,
                    isFileMedia: isFileVideo || isFileImage,
                    source: isFileMessage ? 'file-message' : 'message',
                    openControl: resolvedIsVideo || isFileMessage ? getVideoOpenControl(element) : element,
                    inlineMedia: resolvedIsVideo || isFileImage
                        ? createInlineMediaOpenItem(record, inlineElement, elements.indexOf(inlineElement))
                        : null
                };
            }
        }
        return getMarkdownMediaTarget(event);
    }

    function dispatchNativeMediaOpen(target, sourceEvent) {
        if ((target.isVideo || target.isFileMedia) && target.openControl) {
            const rect = target.openControl.getBoundingClientRect();
            const clientX = rect.left + rect.width / 2;
            const clientY = rect.top + rect.height / 2;
            const event = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                composed: true,
                view: window,
                button: 0,
                buttons: 0,
                clientX,
                clientY,
                screenX: sourceEvent.screenX + clientX - sourceEvent.clientX,
                screenY: sourceEvent.screenY + clientY - sourceEvent.clientY,
                detail: 1
            });
            nativeMediaDispatchEvents.add(event);
            target.openControl.dispatchEvent(event);
            return;
        }
        const activationTarget = sourceEvent.target instanceof Element &&
            target.element.contains(sourceEvent.target)
            ? sourceEvent.target
            : target.element;
        const eventOptions = {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            button: 0,
            buttons: 0,
            clientX: sourceEvent.clientX,
            clientY: sourceEvent.clientY,
            screenX: sourceEvent.screenX,
            screenY: sourceEvent.screenY
        };
        const event = new MouseEvent('dblclick', { ...eventOptions, detail: 2 });
        nativeMediaDispatchEvents.add(event);
        activationTarget.dispatchEvent(event);
    }

    function stopMediaOpenEvent(event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
    }

    async function openInlineMediaTarget(target, sourceEvent) {
        const payload = {
            ...target.inlineMedia,
            source: target.source || 'message'
        };
        if (target.isFileMedia && payload.pendingFile === true) {
            let opened = false;
            try {
                opened = await getBridge()?.openInlineMedia?.(payload) === true;
            } catch {
            }
            dispatchNativeMediaOpen(target, sourceEvent);
            if (!opened) {
                recordRendererDiagnostic('media.pending-file-preview-failed', {
                    mediaType: target.isVideo ? 'video' : 'image'
                }, 'warn');
            }
            return;
        }
        let nativeActivated = false;
        if (target.isVideo && !target.isFileMedia) {
            dispatchNativeMediaOpen(target, sourceEvent);
            nativeActivated = true;
            await new Promise(resolve => setTimeout(resolve, 0));
            if (document.getElementById(INLINE_MEDIA_PREVIEW_ID)) {
                return;
            }
            payload.nativeDownloadStarted = true;
        }
        let opened = false;
        try {
            opened = await getBridge()?.openInlineMedia?.(payload) === true;
        } catch {
        }
        if (!opened && !nativeActivated) {
            dispatchNativeMediaOpen(target, sourceEvent);
        }
    }

    function handleEmojiImageClick(event) {
        if (!isConfigEnabled('interfaceTweaks.openEmojiAsImage') || event.button !== 0 ||
            document.getElementById(INLINE_MEDIA_PREVIEW_ID) || isNativeMediaViewerWindow()) {
            return;
        }
        const target = getEmojiImageTarget(event);
        if (!target) {
            return;
        }
        const now = performance.now();
        if (now < emojiImageOpenUntil) {
            stopMediaOpenEvent(event);
            return;
        }
        emojiImageOpenUntil = now + 500;
        recordRendererDiagnostic('emoji-image.open-requested', {
            sourceCount: target.sources.length,
            name: target.name
        });
        stopMediaOpenEvent(event);
        queueMicrotask(() => {
            const face = target.face || {};
            const payload = {
                sources: target.sources,
                name: target.name,
                width: target.width,
                height: target.height,
                marketFace: {
                    emojiId: normalizeText(face.emojiId),
                    emojiPackageId: Number(face.emojiPackageId) || 0,
                    faceName: normalizeText(face.faceName),
                    key: normalizeText(face.key),
                    staticFacePath: normalizeText(face.staticFacePath),
                    dynamicFacePath: normalizeText(face.dynamicFacePath),
                    imageWidth: Number(face.imageWidth) || 0,
                    imageHeight: Number(face.imageHeight) || 0
                }
            };
            Promise.resolve(getBridge()?.openEmojiAsImage?.(payload)).catch(() => {});
        });
    }

    function handleSingleClickMedia(event) {
        if (nativeMediaDispatchEvents.has(event)) {
            nativeMediaDispatchEvents.delete(event);
            return;
        }
        const singleClickEnabled = isConfigEnabled('interfaceTweaks.singleClickMediaViewer');
        const inlineViewerEnabled = isConfigEnabled('interfaceTweaks.inlineMediaViewer');
        if ((!singleClickEnabled && !inlineViewerEnabled) || event.button !== 0 ||
            document.getElementById(INLINE_MEDIA_PREVIEW_ID) || isNativeMediaViewerWindow()) {
            return;
        }
        const target = getSingleClickMediaTarget(event);
        if (!target) {
            return;
        }
        const eventPath = event.composedPath?.() || [event.target];
        const clickedOpenControl = target.isVideo && target.openControl && eventPath.some(item =>
            item === target.openControl || (item instanceof Node && target.openControl?.contains?.(item))
        );
        const openInlineMedia = inlineViewerEnabled && (target.isVideo || target.isFileMedia) &&
            target.inlineMedia &&
            (singleClickEnabled || clickedOpenControl || target.isFileMedia);
        const shouldActivateNative = singleClickEnabled || clickedOpenControl || target.isFileMedia;
        if (!openInlineMedia && !shouldActivateNative) {
            return;
        }
        recordRendererDiagnostic('media.open-requested', {
            gesture: 'single-click',
            viewer: openInlineMedia ? 'inline' : 'native',
            mediaType: target.isVideo ? 'video' : 'image',
            source: target.source || 'message'
        });
        stopMediaOpenEvent(event);
        queueMicrotask(() => openInlineMedia
            ? openInlineMediaTarget(target, event)
            : dispatchNativeMediaOpen(target, event));
    }

    function handleInlineMediaPreviewKey(event) {
        const layer = document.getElementById(INLINE_MEDIA_PREVIEW_ID);
        if (!layer || !['Escape', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        if (event.type !== 'keydown') {
            return;
        }
        if (event.key === 'Escape') {
            closeInlineMediaPreview();
        } else {
            layer.qqntToolboxNavigate?.(event.key === 'ArrowLeft' ? -1 : 1);
        }
    }

    async function subscribeInlineMediaPreview() {
        const bridge = await waitForBridge();
        bridge?.onInlineMediaPreview?.(openInlineMediaPreview);
    }

    function isImageAllInViewport() {
        const viewer = document.querySelector('.main-area.main-area--image.vue-component, .main-area.main-area--image');
        const value = findVueValue(viewer, [
            'proxy.isImageAllInViewport',
            'ctx.isImageAllInViewport'
        ]);
        return (value && typeof value === 'object' && 'value' in value ? value.value : value) === true;
    }

    function handleImageViewerPointerDown(event) {
        if (!isConfigEnabled('interfaceTweaks.imageViewerOptimization') || !isImageViewerWindow()) {
            imageViewerDrag = null;
            return;
        }
        if (event.buttons === 1) {
            imageViewerDrag = {
                distance: 0,
                screenX: window.screenX,
                screenY: window.screenY,
                outerWidth: window.outerWidth,
                outerHeight: window.outerHeight
            };
        } else {
            imageViewerDrag = null;
        }
    }

    function handleImageViewerPointerMove(event) {
        if (!imageViewerDrag || !isConfigEnabled('interfaceTweaks.imageViewerOptimization') || !isImageViewerWindow() || event.buttons !== 1) {
            return;
        }
        imageViewerDrag.distance += Math.abs(event.movementX) + Math.abs(event.movementY);
        if (!isImageAllInViewport() || document.querySelector('embed')) {
            return;
        }
        imageViewerDrag.screenX += event.movementX;
        imageViewerDrag.screenY += event.movementY;
        try {
            window.moveTo(imageViewerDrag.screenX, imageViewerDrag.screenY);
            if (window.devicePixelRatio !== 1) {
                window.resizeTo(imageViewerDrag.outerWidth, imageViewerDrag.outerHeight);
            }
            event.preventDefault();
            event.stopPropagation();
        } catch {
        }
    }

    function handleImageViewerPointerUp(event) {
        if (!imageViewerDrag || !isConfigEnabled('interfaceTweaks.imageViewerOptimization') || !isImageViewerWindow()) {
            imageViewerDrag = null;
            return;
        }
        const distance = imageViewerDrag.distance;
        const target = event.target instanceof Element ? event.target : null;
        imageViewerDrag = null;
        if (event.button !== 0 || distance >= 2 || document.querySelector('.q-context-menu, embed')) {
            return;
        }
        if (!target?.closest('.main-area__content')) {
            return;
        }
        const closeButton = document.querySelector('div[aria-label="\u5173\u95ed"], button[aria-label="\u5173\u95ed"], [aria-label="Close"]');
        closeButton?.click?.();
    }

    function getRecallMark(record) {
        return record?.qqnt_toolbox_recall || null;
    }

    function getRecallOperatorName(mark) {
        return normalizeText(mark?.operatorRemark || mark?.operatorMemRemark || mark?.operatorNick) || text('\u5bf9\u65b9');
    }

    function formatRecallTime(value) {
        const timestamp = Number(value);
        if (!timestamp) {
            return '';
        }
        const date = new Date(timestamp > 100000000000 ? timestamp : timestamp * 1000);
        if (Number.isNaN(date.getTime())) {
            return '';
        }
        return date.toLocaleString('zh-CN', {
            hour12: false,
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function isNoSeqMessage(record) {
        if (Number(record?.sendStatus) !== SEND_STATUS_SUCCESS_NO_SEQ || Number(record?.msgType) === MSG_TYPE_GRAY_TIPS) {
            return false;
        }
        return !(Array.isArray(record?.elements) && record.elements.some(element => element?.grayTipElement));
    }

    function getMessageBadgeTarget(messageElement, record) {
        const wrapper = messageElement.querySelector('.message-content__wrapper');
        const pttBubble = wrapper?.querySelector(
            '.ptt-message__container.ptt-message > .ptt-message__inner > .ptt-element'
        );
        if (pttBubble) {
            return pttBubble;
        }
        const elementTypes = new Set((Array.isArray(record?.elements) ? record.elements : [])
            .map(element => Number(element?.elementType)));
        const selectors = [];
        if (elementTypes.has(4)) {
            selectors.push('.ptt-message__container');
        }
        if (elementTypes.has(2)) {
            selectors.push('.pic-element', '.message-content.mix-message__inner .pic-element', '.mix-message__container--pic');
        }
        if (elementTypes.has(5)) {
            selectors.push('.video-element', '[class*="video-message"]');
        }
        if (elementTypes.has(3)) {
            selectors.push('.file-element', '[class*="file-message"]');
        }
        selectors.push(
            '.msg-content-container',
            '.mix-message__container',
            '.message-content:is(.mix-message__inner, .reply-message__inner)',
            '.message-content'
        );
        for (const selector of selectors) {
            const target = wrapper?.querySelector(selector) || messageElement.querySelector(selector);
            if (target) {
                return target;
            }
        }
        return wrapper || messageElement;
    }

    function isCompositeMediaRecord(record) {
        const elements = Array.isArray(record?.elements) ? record.elements.filter(Boolean) : [];
        return elements.length > 1 && elements.some(element =>
            [2, 3, 4, 5].includes(Number(element?.elementType)) ||
            Boolean(element?.picElement) ||
            Boolean(element?.fileElement) ||
            Boolean(element?.pttElement) ||
            Boolean(element?.videoElement)
        );
    }

    function getRepeatButtonTarget(messageElement, record) {
        if (!isCompositeMediaRecord(record)) {
            return getMessageBadgeTarget(messageElement, record);
        }
        const wrapper = messageElement.querySelector('.message-content__wrapper');
        const selectors = [
            '.mix-message__container',
            '.message-content.mix-message__inner',
            '.msg-content-container',
            '.message-content'
        ];
        for (const selector of selectors) {
            const target = wrapper?.querySelector(selector) || messageElement.querySelector(selector);
            if (target) {
                return target;
            }
        }
        return wrapper || messageElement;
    }

    function getMessageLayoutHost(messageElement) {
        return messageElement.querySelector('.message-container') ||
            messageElement.querySelector('.message-content__wrapper') ||
            messageElement;
    }

    function positionMessageBadge(badge, host, target, slot) {
        const hostRect = host.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        if (!hostRect.width || !hostRect.height || !targetRect.width || !targetRect.height) {
            badge.style.removeProperty('top');
            badge.style.removeProperty('left');
            badge.style.removeProperty('right');
            return;
        }
        badge.style.top = `${Math.round(targetRect.top - hostRect.top - 5)}px`;
        badge.style.left = `${Math.round(targetRect.right - hostRect.left - 9 - slot * 17)}px`;
        badge.style.right = 'auto';
    }

    function positionRecallOutline(outline, host, target) {
        const hostRect = host.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        if (!hostRect.width || !hostRect.height || !targetRect.width || !targetRect.height) {
            outline.style.removeProperty('top');
            outline.style.removeProperty('left');
            outline.style.removeProperty('width');
            outline.style.removeProperty('height');
            return;
        }
        const offset = 2;
        outline.style.top = `${Math.round(targetRect.top - hostRect.top - offset)}px`;
        outline.style.left = `${Math.round(targetRect.left - hostRect.left - offset)}px`;
        outline.style.width = `${Math.round(targetRect.width + offset * 2)}px`;
        outline.style.height = `${Math.round(targetRect.height + offset * 2)}px`;
        const borderRadius = getComputedStyle(target).borderRadius;
        outline.style.borderRadius = borderRadius && borderRadius !== '0px' ? borderRadius : '8px';
    }

    function setMessageBadge(messageElement, className, visible, title) {
        let badge = messageElement.querySelector(`:scope .${className}`);
        if (!visible) {
            badge?.remove();
            return null;
        }
        if (!badge) {
            badge = createElement('span');
        }
        badge.classList.add('qqnt-toolbox-status-badge', className);
        badge.title = title;
        badge.setAttribute('role', 'img');
        badge.setAttribute('aria-label', title);
        return badge;
    }

    function setRecallOutline(messageElement, visible, title) {
        let outline = messageElement.querySelector(':scope .qqnt-toolbox-recall-outline');
        if (!visible) {
            outline?.remove();
            return null;
        }
        if (!outline) {
            outline = createElement('span', 'qqnt-toolbox-recall-outline');
        }
        outline.title = title;
        outline.setAttribute('aria-hidden', 'true');
        return outline;
    }

    function upsertMessageBadges(messageElement, record) {
        applyPokeRecallNotice(messageElement, record);
        const mark = getRecallMark(record);
        const titleParts = [text('\u8be5\u6d88\u606f\u5df2\u88ab'), getRecallOperatorName(mark), text('\u64a4\u56de'), formatRecallTime(mark?.recallTime)].filter(Boolean);
        const recallTitle = titleParts.join(' ');
        const recallEnabled = isConfigEnabled('preventRecall.enabled') && Boolean(mark);
        const markerStyle = currentConfig.preventRecall.markerStyle;
        const recallBadge = setMessageBadge(
            messageElement,
            'qqnt-toolbox-recall-badge',
            recallEnabled && markerStyle === 'badge',
            recallTitle
        );
        const recallOutline = setRecallOutline(
            messageElement,
            recallEnabled && markerStyle === 'outline',
            recallTitle
        );
        const noSeqTitle = text('这条消息可能未成功发送（NoSeq）');
        const noSeqBadge = setMessageBadge(
            messageElement,
            'qqnt-toolbox-noseq-badge',
            isConfigEnabled('messageTweaks.promptNoSeq') && isNoSeqMessage(record),
            noSeqTitle
        );
        const badges = [recallBadge, noSeqBadge].filter(Boolean);
        const anchors = messageElement.querySelectorAll('[data-qqnt-toolbox-status-anchor="true"]');
        if (!badges.length && !recallOutline) {
            anchors.forEach(anchor => anchor.removeAttribute('data-qqnt-toolbox-status-anchor'));
            messageBadgeResizeObserver?.unobserve(messageElement);
            return;
        }
        const target = getRepeatButtonTarget(messageElement, record);
        const host = getMessageLayoutHost(messageElement);
        anchors.forEach(anchor => {
            if (anchor !== host) {
                anchor.removeAttribute('data-qqnt-toolbox-status-anchor');
            }
        });
        if (recallOutline) {
            if (recallOutline.parentElement !== host) {
                host.appendChild(recallOutline);
            }
            positionRecallOutline(recallOutline, host, target);
        }
        for (const [slot, badge] of badges.entries()) {
            if (badge.parentElement !== host) {
                host.appendChild(badge);
            }
            positionMessageBadge(badge, host, target, slot);
        }
        host.dataset.qqntToolboxStatusAnchor = 'true';
        messageBadgeResizeObserver?.observe(messageElement);
    }

    function updateMessageBadgeTheme() {
        if (!document.body) {
            return;
        }
        if (!isConfigEnabled('preventRecall.customColor')) {
            document.body.style.removeProperty('--qqnt-toolbox-recall-color');
            return;
        }
        document.body.style.setProperty(
            '--qqnt-toolbox-recall-color',
            matchMedia('(prefers-color-scheme: dark)').matches
                ? currentConfig.preventRecall.customTextColor.dark
                : currentConfig.preventRecall.customTextColor.light
        );
    }

    function processMessageBadgeElements(messageElements) {
        for (const messageElement of messageElements) {
            if (!(messageElement instanceof Element) || !messageElement.isConnected) {
                continue;
            }
            const record = findMessageRecordFromElement(messageElement);
            upsertMessageBadges(messageElement, record);
        }
    }

    function getAllMessageElements() {
        const messages = new Set();
        document.querySelectorAll('.message, .ml-item').forEach(element => {
            const messageElement = getMessageElementFromElement(element);
            if (messageElement) {
                messages.add(messageElement);
            }
        });
        return messages;
    }

    function refreshMessageBadges() {
        if (!document.body) {
            return;
        }
        updateMessageBadgeTheme();
        processMessageBadgeElements(getAllMessageElements());
    }

    function scheduleMessageBadgeRefresh(force = false) {
        if (!force && !isMessageBadgeObserverNeeded()) {
            return;
        }
        if (messageBadgeRefreshTimer) {
            return;
        }
        messageBadgeRefreshTimer = window.setTimeout(() => {
            messageBadgeRefreshTimer = 0;
            refreshMessageBadges();
        }, 100);
    }

    function addMessageBadgeCandidate(messages, node, includeDescendants = true) {
        const element = node instanceof Element ? node : node?.parentElement;
        if (!element) {
            return;
        }
        const direct = getMessageElementFromElement(element);
        if (direct) {
            messages.add(direct);
        }
        if (!includeDescendants) {
            return;
        }
        element.querySelectorAll?.('.message, .ml-item').forEach(candidate => {
            const messageElement = getMessageElementFromElement(candidate);
            if (messageElement) {
                messages.add(messageElement);
            }
        });
    }

    function unobserveRemovedMessageBadges(node) {
        if (!(node instanceof Element)) {
            return;
        }
        const messages = new Set();
        addMessageBadgeCandidate(messages, node);
        messages.forEach(message => messageBadgeResizeObserver?.unobserve(message));
    }

    function handleMessageBadgeMutations(mutations) {
        if (!isMessageBadgeObserverNeeded()) {
            return;
        }
        const messages = new Set();
        for (const mutation of mutations) {
            addMessageBadgeCandidate(messages, mutation.target, false);
            mutation.addedNodes.forEach(node => addMessageBadgeCandidate(messages, node));
            mutation.removedNodes.forEach(unobserveRemovedMessageBadges);
        }
        processMessageBadgeElements(messages);
    }

    function isMessageBadgeObserverNeeded() {
        return isConfigEnabled('preventRecall.enabled') ||
            isConfigEnabled('messageTweaks.promptNoSeq') ||
            recalledPokeMessageIds.size > 0;
    }

    function disconnectMessageBadgeObservers() {
        messageBadgeObserver?.disconnect();
        messageBadgeObserver = null;
        messageBadgeResizeObserver?.disconnect();
        messageBadgeResizeObserver = null;
    }

    function syncMessageBadgeObserver(fullRefresh = false) {
        if (!document.body) {
            return;
        }
        updateMessageBadgeTheme();
        if (!isMessageBadgeObserverNeeded()) {
            window.clearTimeout(messageBadgeRefreshTimer);
            messageBadgeRefreshTimer = 0;
            disconnectMessageBadgeObservers();
            if (document.querySelector('.qqnt-toolbox-status-badge, [data-qqnt-toolbox-status-anchor="true"]')) {
                refreshMessageBadges();
            }
            return;
        }
        if (!messageBadgeObserver) {
            messageBadgeObserver = new MutationObserver(handleMessageBadgeMutations);
            messageBadgeObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        }
        if (!messageBadgeResizeObserver && typeof ResizeObserver === 'function') {
            messageBadgeResizeObserver = new ResizeObserver(entries => {
                processMessageBadgeElements(entries.map(entry => entry.target));
            });
        }
        if (fullRefresh) {
            scheduleMessageBadgeRefresh(true);
        }
    }

    function installMessageBadgeObserver() {
        syncMessageBadgeObserver(true);
    }

    function normalizeText(value) {
        const content = String(value ?? '').trim();
        return content && content !== 'undefined' && content !== 'null' && content !== '0' ? content : '';
    }

    function getVueInstances(element) {
        const instances = [];
        const seen = new Set();
        for (const item of element?.__VUE__ || []) {
            if (item && !seen.has(item)) {
                seen.add(item);
                instances.push(item);
            }
        }
        if (element?.__vueParentComponent && !seen.has(element.__vueParentComponent)) {
            instances.push(element.__vueParentComponent);
        }
        return instances;
    }

    function findVueValue(element, paths) {
        for (const instance of getVueInstances(element)) {
            for (const path of paths) {
                const value = getByPath(instance, path);
                if (value !== undefined && value !== null) {
                    return value;
                }
            }
        }
        return undefined;
    }

    function isMsgRecord(value) {
        return Boolean(value && typeof value === 'object' && (value.msgId || value.msgSeq) && Array.isArray(value.elements));
    }

    function findMsgRecordInValue(value, depth = 0, seen = new WeakSet()) {
        if (!value || depth > 4) {
            return null;
        }
        if (typeof value !== 'object') {
            return null;
        }
        if (seen.has(value)) {
            return null;
        }
        seen.add(value);
        if (isMsgRecord(value)) {
            return value;
        }
        if (value instanceof Element || value instanceof Uint8Array || value instanceof Map) {
            return null;
        }
        for (const key of ['props', 'setupState', 'ctx', 'proxy', 'msgRecord', 'message', 'record', 'msg']) {
            const found = findMsgRecordInValue(value[key], depth + 1, seen);
            if (found) {
                return found;
            }
        }
        return null;
    }

    function findMessageRecordFromElement(element) {
        const start = element?.closest?.('.message.vue-component') ||
            element?.closest?.('.ml-item') ||
            element?.closest?.('.message') ||
            element?.closest?.('[id]');
        const candidates = [];
        for (let node = element; node && node !== document.body; node = node.parentElement) {
            candidates.push(node);
            if (node === start) {
                break;
            }
        }
        if (start) {
            candidates.push(start, ...Array.from(start.querySelectorAll?.('*') || []).slice(0, 80));
        }
        for (const candidate of candidates) {
            const direct = findVueValue(candidate, [
                'props.msgRecord',
                'ctx.msgRecord',
                'proxy.msgRecord',
                'props.message',
                'ctx.message',
                'proxy.message'
            ]);
            if (isMsgRecord(direct)) {
                return direct;
            }
            for (const instance of getVueInstances(candidate)) {
                const found = findMsgRecordInValue(instance);
                if (found) {
                    return found;
                }
            }
        }
        return null;
    }

    function getCurrentAioData() {
        return findVueValue(document.querySelector('.aio.vue-component'), ['proxy.commonAioStore.curAioData', 'ctx.commonAioStore.curAioData']) ||
            findVueValue(document.querySelector('.aio'), ['proxy.commonAioStore.curAioData', 'ctx.commonAioStore.curAioData']);
    }

    function isSearchChatRecordWindow() {
        return location.hash === '#/record' || location.hash.startsWith('#/record?');
    }

    function isForwardRecordWindow() {
        return location.hash.startsWith('#/forward/');
    }

    function getForwardRouteContext() {
        const prefix = '#/forward/';
        if (!location.hash.startsWith(prefix)) {
            return null;
        }
        try {
            const value = JSON.parse(decodeURIComponent(location.hash.slice(prefix.length)));
            const rootMsg = value?.rootMsg;
            const msgId = normalizeText(rootMsg?.msgId);
            const chatType = Number(rootMsg?.chatType);
            const peerUid = normalizeText(rootMsg?.peerUid);
            if (!msgId || !chatType || !peerUid) {
                return null;
            }
            return {
                rootMsg: {
                    msgId,
                    chatType,
                    peerUid,
                    guildId: normalizeText(rootMsg?.guildId)
                }
            };
        } catch {
            return null;
        }
    }

    function normalizeUin(value) {
        const content = String(value ?? '').trim();
        return /^\d+$/.test(content) && content !== '0' ? content : '';
    }

    function getStructuredValue(value, key) {
        if (value instanceof Map) {
            return value.get(key);
        }
        return value && typeof value === 'object' ? value[key] : undefined;
    }

    function getPokeRecordEvent(record) {
        for (const element of Array.isArray(record?.elements) ? record.elements : []) {
            const tip = element?.grayTipElement?.jsonGrayTipElement;
            if (String(tip?.busiId || '') !== '1061') {
                continue;
            }
            const xmlParams = tip?.xmlToJsonParam;
            const params = getStructuredValue(xmlParams, 'templParam');
            return {
                initiatorUin: normalizeUin(getStructuredValue(params, 'uin_str1')),
                targetUin: normalizeUin(getStructuredValue(params, 'uin_str2')),
                businessId: normalizeText(tip?.busiId || getStructuredValue(xmlParams, 'busiId')),
                businessType: normalizeText(getStructuredValue(xmlParams, 'busiType')),
                tipsSeqId: normalizeText(getStructuredValue(xmlParams, 'seqId'))
            };
        }
        return null;
    }

    function applyPokeRecallNotice(messageElement, record) {
        const msgId = normalizeText(record?.msgId);
        if (!msgId || !recalledPokeMessageIds.has(msgId) || !(messageElement instanceof Element)) {
            return false;
        }
        const target = messageElement.querySelector('.gray-tip-content') ||
            getMessageBadgeTarget(messageElement, record);
        if (!target || target.dataset.qqntToolboxPokeRecalled === msgId) {
            return Boolean(target);
        }
        target.replaceChildren(document.createTextNode(POKE_RECALL_NOTICE));
        target.dataset.qqntToolboxPokeRecalled = msgId;
        target.setAttribute('aria-label', POKE_RECALL_NOTICE);
        return true;
    }

    function markPokeRecalled(messageElement, record) {
        const msgId = normalizeText(record?.msgId);
        if (!msgId) {
            return;
        }
        recalledPokeMessageIds.add(msgId);
        syncMessageBadgeObserver();
        applyPokeRecallNotice(messageElement, record);
    }

    function getPokeRecordOwnership(record) {
        if (recalledPokeMessageIds.has(normalizeText(record?.msgId))) {
            return 'recalled';
        }
        const event = getPokeRecordEvent(record);
        if (!event?.initiatorUin) {
            return 'not-poke';
        }
        const selfUin = registerPokeAccountFromPage(true);
        if (selfUin) {
            return event.initiatorUin === selfUin ? 'own' : 'other';
        }
        if (Number(record?.sendType) === 1) {
            return 'own';
        }
        if (Number(record?.sendType) === 2) {
            return 'other';
        }
        return 'unknown';
    }

    function createPokeRecallPayload(record) {
        const pokeEvent = getPokeRecordEvent(record);
        if (!pokeEvent) {
            return null;
        }
        const selfUin = registerPokeAccountFromPage(true) ||
            (Number(record?.sendType) === 1 ? pokeEvent.initiatorUin : '');
        return {
            selfUin,
            recall: {
                initiatorUin: pokeEvent.initiatorUin,
                targetUin: pokeEvent.targetUin,
                chatType: Number(record?.chatType),
                peerUin: normalizeText(record?.peerUin || record?.peerUid),
                msgType: pokeEvent.businessType || normalizeText(record?.subMsgType),
                msgSeq: normalizeText(record?.msgSeq),
                msgTime: normalizeText(record?.msgTime),
                msgUid: normalizeText(record?.msgRandom),
                msgId: normalizeText(record?.msgId),
                businessId: pokeEvent.businessId,
                tipsSeqId: pokeEvent.tipsSeqId
            }
        };
    }

    function supportsNativeNudge() {
        const actual = (String(window.LiteLoader?.package?.qqnt?.version || '').match(/\d+/g) || [])
            .slice(0, 3)
            .map(Number);
        const required = [9, 9, 32];
        if (actual.length < required.length) {
            return false;
        }
        for (let index = 0; index < required.length; index++) {
            if (actual[index] !== required[index]) {
                return actual[index] > required[index];
            }
        }
        return true;
    }

    function findSelfUinFromPage() {
        const paths = [
            'proxy.selfUin',
            'ctx.selfUin',
            'proxy.authData.uin',
            'ctx.authData.uin',
            'proxy.commonAioStore.authData.uin',
            'ctx.commonAioStore.authData.uin',
            'proxy.aioStore.authData.uin',
            'ctx.aioStore.authData.uin'
        ];
        for (const root of [document.querySelector('.aio.vue-component'), document.querySelector('.aio')]) {
            const selfUin = normalizeUin(findVueValue(root, paths));
            if (selfUin) {
                return selfUin;
            }
        }
        for (const messageElement of getVisibleMessageElements()) {
            const record = findMessageRecordFromElement(messageElement);
            if (Number(record?.sendType) === 1) {
                const selfUin = normalizeUin(record?.senderUin);
                if (selfUin) {
                    return selfUin;
                }
            }
        }
        return '';
    }

    function registerPokeAccountFromPage(force = false) {
        const now = Date.now();
        if (!force && now - lastPokeAccountProbeAt < 2000) {
            return registeredPokeAccountUin;
        }
        lastPokeAccountProbeAt = now;
        const selfUin = findSelfUinFromPage();
        const accountChanged = Boolean(selfUin && selfUin !== registeredPokeAccountUin);
        if (selfUin) {
            registeredPokeAccountUin = selfUin;
        }
        const shouldSync = accountChanged || !registeredPokeAccountUin || now - lastPokeAccountSyncAt >= 30000;
        if (shouldSync && !pokeAccountRegistration) {
            lastPokeAccountSyncAt = now;
            pokeAccountRegistration = Promise.resolve(getBridge()?.registerPokeAccount?.(selfUin || ''))
                .then(value => {
                    const registered = normalizeUin(value);
                    if (registered) {
                        registeredPokeAccountUin = registered;
                        rememberActiveRepeatPeer();
                    }
                })
                .catch(() => {})
                .finally(() => {
                    pokeAccountRegistration = null;
                });
        }
        return registeredPokeAccountUin;
    }

    function getPokeAvatarFromEvent(event) {
        const path = event?.composedPath?.() || [event?.target];
        for (const item of path) {
            if (!(item instanceof Element) || !item.matches([
                '.avatar-span .avatar',
                '.avatar.message-container__avatar',
                '[class*="avatar" i]',
                '[data-testid*="avatar" i]',
                '[data-type*="avatar" i]'
            ].join(','))) {
                continue;
            }
            if (findMessageRecordFromElement(item)) {
                return item;
            }
        }
        return null;
    }

    function getPokeChatContext(avatar) {
        const record = findMessageRecordFromElement(avatar);
        const aioData = getCurrentAioData() || {};
        const header = aioData.header || {};
        const chatTypes = [
            aioData.chatType,
            aioData.type,
            aioData.aioType,
            aioData.peer?.chatType,
            aioData.contact?.chatType,
            header.chatType,
            header.type,
            header.peer?.chatType,
            header.contact?.chatType,
            record?.chatType,
            record?.peer?.chatType
        ].map(Number).filter(value => Number.isFinite(value) && value > 0);
        return {
            record,
            aioData,
            header,
            chatType: chatTypes[0] || 0,
            isTemporary: chatTypes.some(value => TEMP_POKE_CHAT_TYPES.has(value))
        };
    }

    function getPokePayload(avatar, context = getPokeChatContext(avatar)) {
        const { record, aioData, header, chatType, isTemporary } = context;
        if (isTemporary) {
            return null;
        }
        const peerUid = normalizeText(
            record?.peerUid ||
            record?.peer?.peerUid ||
            aioData.peerUid ||
            aioData.peer?.peerUid ||
            header.peerUid ||
            header.uid
        );
        const peerUin = [
            record?.peerUin,
            record?.peer?.peerUin,
            record?.peerUid,
            aioData.peerUin,
            aioData.peer?.peerUin,
            aioData.peerUid,
            header.uin,
            header.peerUin,
            header.uid,
            header.peerUid
        ].map(normalizeUin).find(Boolean) || '';
        if (chatType === 2) {
            const targetUin = normalizeUin(record?.senderUin || record?.sender?.uin);
            const groupUin = peerUin || normalizeUin(peerUid);
            return targetUin && groupUin ? { chatType, targetUin, groupUin, peerUid: groupUin } : null;
        }
        if (chatType === 1) {
            const targetUin = normalizeUin(record?.senderUin || record?.sender?.uin) || peerUin;
            return targetUin ? { chatType, targetUin, groupUin: '', peerUid } : null;
        }
        return null;
    }

    function stopAvatarEvent(event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
    }

    function animatePokedAvatar(avatar) {
        if (!(avatar instanceof Element) || !avatar.isConnected) {
            return;
        }
        pokeAvatarAnimations.get(avatar)?.cancel();
        const animation = avatar.animate([
            { transform: 'translateX(0) rotate(0deg)' },
            { transform: 'translateX(-5px) rotate(-5deg)', offset: .14 },
            { transform: 'translateX(5px) rotate(4deg)', offset: .28 },
            { transform: 'translateX(-4px) rotate(-3deg)', offset: .42 },
            { transform: 'translateX(4px) rotate(3deg)', offset: .58 },
            { transform: 'translateX(-2px) rotate(-2deg)', offset: .72 },
            { transform: 'translateX(2px) rotate(1deg)', offset: .86 },
            { transform: 'translateX(0) rotate(0deg)' }
        ], {
            duration: 460,
            easing: 'cubic-bezier(.36, .07, .19, .97)',
            composite: 'add'
        });
        pokeAvatarAnimations.set(avatar, animation);
        const clearAnimation = () => {
            if (pokeAvatarAnimations.get(avatar) === animation) {
                pokeAvatarAnimations.delete(avatar);
            }
        };
        animation.addEventListener('finish', clearAnimation, { once: true });
        animation.addEventListener('cancel', clearAnimation, { once: true });
    }

    function sendAvatarPoke(payload, avatar, source = 'double-click') {
        const request = {
            ...(payload || { chatType: 0, targetUin: '', groupUin: '' }),
            selfUin: registerPokeAccountFromPage(true),
            source
        };
        Promise.resolve(getBridge()?.sendPoke?.(request)).then(result => {
            if (result?.ok === true) {
                animatePokedAvatar(avatar);
            }
        }).catch(() => {});
    }

    function handleAvatarPointerDown(event) {
        if (!isFeatureEnabled('entertainment.doubleClickAvatarPoke') || event.button !== 0) {
            pendingAvatarPoke = null;
            return;
        }
        const now = performance.now();
        const pending = pendingAvatarPoke;
        const avatar = getPokeAvatarFromEvent(event);
        if (!avatar) {
            pendingAvatarPoke = null;
            return;
        }
        const context = getPokeChatContext(avatar);
        if (context.isTemporary) {
            stopAvatarEvent(event);
            suppressAvatarClicksUntil = now + 650;
            pendingAvatarPoke = null;
            return;
        }
        const payload = getPokePayload(avatar, context);
        if (!payload) {
            pendingAvatarPoke = null;
            return;
        }
        const isSecondPress = pending && pending.avatar === avatar && now - pending.time <= 480 &&
            Math.hypot(event.clientX - pending.x, event.clientY - pending.y) <= 20;
        if (isSecondPress) {
            stopAvatarEvent(event);
            suppressAvatarClicksUntil = now + 650;
            pendingAvatarPoke = null;
            sendAvatarPoke(pending.payload, pending.avatar);
            return;
        }

        stopAvatarEvent(event);
        suppressAvatarClicksUntil = now + 650;
        const next = {
            time: now,
            x: event.clientX,
            y: event.clientY,
            avatar,
            payload
        };
        pendingAvatarPoke = next;
        window.setTimeout(() => {
            if (pendingAvatarPoke === next) {
                pendingAvatarPoke = null;
            }
        }, 500);
    }

    function suppressAvatarClick(event) {
        if (performance.now() <= suppressAvatarClicksUntil) {
            stopAvatarEvent(event);
        }
    }

    function handleAvatarDoubleClick(event) {
        if (!isFeatureEnabled('entertainment.doubleClickAvatarPoke') || event.button !== 0) {
            return;
        }
        if (performance.now() <= suppressAvatarClicksUntil) {
            stopAvatarEvent(event);
            return;
        }
        const avatar = getPokeAvatarFromEvent(event);
        if (!avatar) {
            return;
        }
        const context = getPokeChatContext(avatar);
        if (context.isTemporary) {
            stopAvatarEvent(event);
            suppressAvatarClicksUntil = performance.now() + 650;
            pendingAvatarPoke = null;
            return;
        }
        const payload = getPokePayload(avatar, context);
        if (!payload) {
            return;
        }
        stopAvatarEvent(event);
        suppressAvatarClicksUntil = performance.now() + 650;
        pendingAvatarPoke = null;
        sendAvatarPoke(payload, avatar);
    }

    function installPokeInteractions() {
        document.addEventListener('pointerdown', handleAvatarPointerDown, true);
        document.addEventListener('click', suppressAvatarClick, true);
        document.addEventListener('dblclick', handleAvatarDoubleClick, true);
        registerPokeAccountFromPage(true);
    }

    function getPeerFromRecord(record) {
        const aioData = getCurrentAioData() || {};
        const header = aioData.header || {};
        const chatType = Number(record?.chatType || aioData.chatType || header.chatType || 0);
        const peerUid = normalizeText(
            record?.peerUid ||
            record?.peer?.peerUid ||
            aioData.peerUid ||
            header.uid ||
            header.peerUid ||
            aioData.peer?.peerUid
        );
        if (!chatType || !peerUid) {
            return null;
        }
        return {
            chatType,
            peerUid,
            peerUin: normalizeUin(
                record?.peerUin ||
                record?.peer?.peerUin ||
                aioData.peerUin ||
                aioData.peer?.peerUin ||
                header.peerUin ||
                header.uin
            ),
            guildId: normalizeText(record?.guildId || aioData.guildId || header.guildId)
        };
    }

    function getCurrentRecallPeerLabel(peer) {
        const aioData = getCurrentAioData() || {};
        const header = aioData.header || {};
        const elementLabel = normalizeText(document.querySelector(
            '.aio .chat-header__contact-name, .aio .panel-header__title [class*="contact-name"]'
        )?.textContent);
        const dataLabel = [
            header.remark,
            header.name,
            header.nick,
            header.nickName,
            header.groupName,
            header.contactName,
            aioData.remark,
            aioData.name,
            aioData.nick,
            aioData.nickName,
            aioData.groupName,
            aioData.peer?.remark,
            aioData.peer?.name,
            aioData.peer?.nick,
            aioData.contact?.remark,
            aioData.contact?.name,
            aioData.contact?.nick
        ].map(normalizeText).find(Boolean);
        return elementLabel || dataLabel || peer?.label || '';
    }

    function getActiveRepeatPeerStorageKey() {
        const selfUin = registeredPokeAccountUin || registerPokeAccountFromPage(true);
        return selfUin ? `${ACTIVE_REPEAT_PEER_KEY_PREFIX}:${selfUin}` : '';
    }

    function rememberActiveRepeatPeer() {
        if (isSearchChatRecordWindow() || isForwardRecordWindow() ||
            !document.querySelector('.aio.vue-component, .aio')) {
            return;
        }
        const storageKey = getActiveRepeatPeerStorageKey();
        const peer = getPeerFromRecord({});
        if (!storageKey || !peer) {
            return;
        }
        const rememberedPeer = {
            ...peer,
            label: getCurrentRecallPeerLabel(peer)
        };
        const signature = `${storageKey}:${peer.chatType}:${peer.peerUid}:${peer.guildId}:${rememberedPeer.label}`;
        if (signature === activeRepeatPeerSignature) {
            return;
        }
        activeRepeatPeerSignature = signature;
        try {
            localStorage.setItem(storageKey, JSON.stringify(rememberedPeer));
        } catch {
        }
    }

    function getActiveRepeatPeer() {
        const storageKey = getActiveRepeatPeerStorageKey();
        if (!storageKey) {
            return null;
        }
        try {
            const peer = JSON.parse(localStorage.getItem(storageKey) || 'null');
            const chatType = Number(peer?.chatType);
            const peerUid = normalizeText(peer?.peerUid);
            if (!chatType || !peerUid) {
                return null;
            }
            return {
                chatType,
                peerUid,
                peerUin: normalizeUin(peer?.peerUin),
                guildId: normalizeText(peer?.guildId),
                label: normalizeText(peer?.label)
            };
        } catch {
            return null;
        }
    }

    function cloneRepeatPayloadValue(value, depth = 0, seen = new WeakMap()) {
        if (value === null || value === undefined || depth > 12 || typeof value !== 'object') {
            return typeof value === 'function' ? undefined : value;
        }
        if (value instanceof Node) {
            return undefined;
        }
        if (value instanceof Uint8Array) {
            return new Uint8Array(value);
        }
        if (seen.has(value)) {
            return seen.get(value);
        }
        if (value instanceof Map) {
            const map = new Map();
            seen.set(value, map);
            for (const [key, item] of value) {
                map.set(key, cloneRepeatPayloadValue(item, depth + 1, seen));
            }
            return map;
        }
        if (Array.isArray(value)) {
            const array = [];
            seen.set(value, array);
            for (const item of value) {
                array.push(cloneRepeatPayloadValue(item, depth + 1, seen));
            }
            return array;
        }
        const object = {};
        seen.set(value, object);
        try {
            for (const [key, item] of Object.entries(value)) {
                if (typeof item !== 'function') {
                    object[key] = cloneRepeatPayloadValue(item, depth + 1, seen);
                }
            }
        } catch {
            return object;
        }
        return object;
    }

    function buildRepeatPayload(record) {
        const msgId = normalizeText(record?.msgId);
        const sourcePeer = getPeerFromRecord(record);
        if (!msgId || !sourcePeer) {
            return null;
        }
        const payload = {
            msgId,
            peer: sourcePeer
        };
        if (!isForwardRecordWindow()) {
            return payload;
        }
        const destinationPeer = getActiveRepeatPeer();
        const elements = cloneRepeatPayloadValue(record?.elements);
        if (!destinationPeer || !Array.isArray(elements) || !elements.length) {
            return null;
        }
        payload.destinationPeer = destinationPeer;
        payload.recordSource = 'forward-detail';
        payload.forwardContext = getForwardRouteContext();
        payload.record = {
            msgId,
            chatType: Number(record?.chatType || sourcePeer.chatType),
            peerUid: normalizeText(record?.peerUid || record?.peer?.peerUid || sourcePeer.peerUid),
            guildId: normalizeText(record?.guildId || record?.peer?.guildId || sourcePeer.guildId),
            msgSeq: normalizeText(record?.msgSeq),
            msgTime: normalizeText(record?.msgTime),
            msgRandom: normalizeText(record?.msgRandom),
            senderUid: normalizeText(record?.senderUid),
            elements
        };
        return payload;
    }

    function debugRepeatFailure(error) {
        if (isConfigEnabled('debug.enabled')) {
            console.warn('[QQNT Toolbox] Repeat failed:', error);
        }
    }

    function getRecordDiagnosticSummary(record) {
        const elements = Array.isArray(record?.elements) ? record.elements.filter(Boolean) : [];
        return {
            elementTypes: Array.from(new Set(elements.map(element => Number(element?.elementType) || 0))),
            elementCount: elements.length,
            composite: elements.length > 1,
            source: isForwardRecordWindow() ? 'forward-detail' : 'chat'
        };
    }

    async function repeatRecord(record) {
        if (!isFeatureEnabled('repeatMessage.enabled')) {
            return;
        }
        const bridge = getBridge();
        const payload = buildRepeatPayload(record);
        if (!bridge?.repeatMessage || !payload) {
            const error = new Error('The repeat request could not be built.');
            recordRendererDiagnostic('repeat.rejected', {
                ...getRecordDiagnosticSummary(record),
                reason: !bridge?.repeatMessage ? 'bridge-unavailable' : 'payload-unavailable'
            }, 'warn');
            debugRepeatFailure(error);
            return;
        }
        recordRendererDiagnostic('repeat.requested', getRecordDiagnosticSummary(record));
        try {
            await bridge.repeatMessage(payload);
        } catch (error) {
            recordRendererDiagnostic('repeat.bridge-failed', {
                ...getRecordDiagnosticSummary(record),
                errorName: error?.name || 'Error',
                errorMessage: String(error?.message || error || '')
            }, 'error');
            debugRepeatFailure(error);
        }
    }

    function isRepeatableRecord(record) {
        return Boolean(normalizeText(record?.msgId) && Array.isArray(record?.elements) && record.elements.length > 0);
    }

    function shouldUseSideRepeat() {
        return !isSearchChatRecordWindow() &&
            isFeatureEnabled('repeatMessage.enabled') &&
            !isFeatureEnabled('repeatMessage.showInContextMenu');
    }

    function shouldUseContextRepeat() {
        return !isSearchChatRecordWindow() &&
            isFeatureEnabled('repeatMessage.enabled') &&
            isFeatureEnabled('repeatMessage.showInContextMenu');
    }

    function getMessageElementFromElement(element) {
        const vueMessage = element?.closest?.('.message.vue-component');
        if (vueMessage) {
            return vueMessage;
        }
        const item = element?.closest?.('.ml-item');
        if (item) {
            return item.querySelector?.('.message.vue-component') || item.querySelector?.('.message') || item;
        }
        const message = element?.closest?.('.message');
        return message?.closest?.('.message.vue-component') || message || null;
    }

    function getMessageContextTargetFromEvent(event) {
        for (const item of event?.composedPath?.() || []) {
            if (!(item instanceof Element)) {
                continue;
            }
            const messageElement = getMessageElementFromElement(item);
            if (messageElement && findMessageRecordFromElement(messageElement)) {
                return messageElement;
            }
        }
        return null;
    }

    function getVisibleMessageElements() {
        const seen = new Set();
        const messages = [];
        document.querySelectorAll('.message, .ml-item').forEach(element => {
            const messageElement = getMessageElementFromElement(element);
            if (!messageElement || seen.has(messageElement)) {
                return;
            }
            seen.add(messageElement);
            messages.push(messageElement);
        });
        return messages;
    }

    function removeRepeatSlot(slot) {
        const messageElement = getMessageElementFromElement(slot);
        const host = slot.parentElement;
        window.clearTimeout(Number(slot.dataset.armedTimer || 0));
        slot.remove();
        if (host && !host.querySelector('.qqnt-toolbox-repeat-slot')) {
            host.removeAttribute('data-qqnt-toolbox-repeat-anchor');
            if (messageElement) {
                repeatResizeObserver?.unobserve(messageElement);
            }
        }
    }

    function removeSideRepeatEntrypoints(root = document) {
        root.querySelectorAll?.('.qqnt-toolbox-repeat-slot').forEach(removeRepeatSlot);
    }

    function updateRepeatModeClass() {
        const sideRepeat = shouldUseSideRepeat();
        const contextRepeat = shouldUseContextRepeat();
        document.body?.classList.toggle('qqnt-toolbox-search-record', isSearchChatRecordWindow());
        document.body?.classList.toggle('qqnt-toolbox-side-repeat', sideRepeat);
        document.body?.classList.toggle('qqnt-toolbox-context-repeat', contextRepeat);
    }

    function getNativePlusOneTemplate() {
        const selector = '.plus-one-btn:not(.qqnt-toolbox-repeat-slot):not(.qqnt-toolbox-repeat-menu-plus-one)';
        return document.querySelector(`.message-content__wrapper > ${selector}`) || document.querySelector(`.message ${selector}`) || document.querySelector(selector);
    }

    function createQqPlusOneIcon() {
        const namespace = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(namespace, 'svg');
        for (const [name, value] of Object.entries({
            width: '16',
            height: '16',
            viewBox: '1 1 26 26',
            fill: 'none'
        })) {
            svg.setAttribute(name, value);
        }
        const circle = document.createElementNS(namespace, 'circle');
        for (const [name, value] of Object.entries({
            cx: '14',
            cy: '14',
            r: '11.25',
            stroke: 'var(--brand_standard)',
            'stroke-width': '1.5'
        })) {
            circle.setAttribute(name, value);
        }
        const paths = [
            'M6.81348 14.7051V13.3447H14.2168V14.7051H6.81348ZM9.83496 17.7402V10.3096H11.1953V17.7402H9.83496Z',
            'M17.4727 18V9.71484H17.3633L14.8818 11.4854V9.98145L17.4795 8.13574H19.0107V18H17.4727Z'
        ];
        svg.append(circle, ...paths.map(data => {
            const path = document.createElementNS(namespace, 'path');
            path.setAttribute('d', data);
            path.setAttribute('fill', 'var(--brand_standard)');
            return path;
        }));
        return svg;
    }

    function createNativePlusOneButton(template = getNativePlusOneTemplate()) {
        const button = template?.cloneNode(true) || document.createElement('div');
        const icon = template?.querySelector('svg')?.cloneNode(true) || createQqPlusOneIcon();
        button.removeAttribute('id');
        button.removeAttribute('data-event');
        button.replaceChildren(icon);
        button.classList.add('plus-one-btn', 'no-copy');
        button.classList.remove('qqnt-toolbox-repeat-slot', 'qqnt-toolbox-repeat-menu-plus-one');
        if (button instanceof HTMLButtonElement) {
            button.type = 'button';
        } else {
            button.setAttribute('role', 'button');
            button.setAttribute('tabindex', '0');
        }
        button.removeAttribute('title');
        button.setAttribute('aria-label', text('\u590d\u8bfb'));
        return button;
    }

    function createSideRepeatButton(record, template = null) {
        const button = createNativePlusOneButton(template || undefined);
        button.classList.add('qqnt-toolbox-repeat-slot');
        button.dataset.msgId = normalizeText(record?.msgId);
        button.setAttribute('role', 'button');
        button.setAttribute('tabindex', '-1');
        repeatButtonRecords.set(button, record);
        return button;
    }

    function positionSideRepeatButton(button, messageElement, record) {
        const target = getRepeatButtonTarget(messageElement, record);
        const host = getMessageLayoutHost(messageElement);
        const hostRect = host.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const buttonWidth = button.getBoundingClientRect().width || 26;
        if (!hostRect.width || !hostRect.height || !targetRect.width || !targetRect.height) {
            return;
        }
        const avatar = messageElement.querySelector('.avatar-span') ||
            messageElement.querySelector('.avatar.message-container__avatar');
        const avatarRect = avatar?.getBoundingClientRect();
        const outgoing = avatarRect?.width
            ? avatarRect.left + avatarRect.width / 2 > targetRect.left + targetRect.width / 2
            : Number(record?.sendType) === 1;
        const gap = 8;
        const left = outgoing
            ? targetRect.left - hostRect.left - buttonWidth - gap
            : targetRect.right - hostRect.left + gap;
        button.style.top = `${Math.round(targetRect.top - hostRect.top + targetRect.height / 2)}px`;
        button.style.left = `${Math.round(left)}px`;
        button.style.right = 'auto';
        button.style.bottom = 'auto';
        host.dataset.qqntToolboxRepeatAnchor = 'true';
    }

    function getRepeatButtonFromEvent(event) {
        const button = event.target?.closest?.('.qqnt-toolbox-repeat-slot');
        return button && !button.closest(`#${PANEL_ID}`) ? button : null;
    }

    function triggerRepeatFromButton(button, record) {
        if (!isRepeatableRecord(record)) {
            return;
        }
        if (!isFeatureEnabled('repeatMessage.doubleClick')) {
            repeatRecord(record);
            return;
        }
        if (button.dataset.armed === 'true') {
            window.clearTimeout(Number(button.dataset.armedTimer || 0));
            button.dataset.armed = 'false';
            button.dataset.armedTimer = '';
            repeatRecord(record);
            return;
        }
        button.dataset.armed = 'true';
        const timer = window.setTimeout(() => {
            button.dataset.armed = 'false';
            button.dataset.armedTimer = '';
        }, 500);
        button.dataset.armedTimer = String(timer);
    }

    function handleRepeatButtonEvent(button, record, event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        if (event.type === 'pointerdown') {
            triggerRepeatFromButton(button, record);
        }
    }

    function handleRepeatPlusOneEvent(event) {
        if (!shouldUseSideRepeat()) {
            return;
        }
        const button = getRepeatButtonFromEvent(event);
        if (!button) {
            return;
        }
        if (event.type !== 'pointerdown') {
            handleRepeatButtonEvent(button, null, event);
            return;
        }
        const record = findMessageRecordFromElement(button) || repeatButtonRecords.get(button);
        handleRepeatButtonEvent(button, record, event);
    }

    function handleRepeatMessagePointerOver(event) {
        if (!shouldUseSideRepeat()) {
            return;
        }
        const target = event.target instanceof Element ? event.target : null;
        const messageElement = target && getMessageElementFromElement(target);
        const relatedTarget = event.relatedTarget instanceof Element ? event.relatedTarget : null;
        if (messageElement?.querySelector('.qqnt-toolbox-repeat-slot') &&
            getMessageElementFromElement(relatedTarget) === messageElement) {
            return;
        }
        const record = messageElement && findMessageRecordFromElement(messageElement);
        if (messageElement && isRepeatableRecord(record)) {
            ensureSideRepeatEntrypoint(messageElement, record);
        }
    }

    function ensureSideRepeatEntrypoint(messageElement, record) {
        const msgId = normalizeText(record?.msgId);
        const wrapper = messageElement.querySelector('.message-content__wrapper');
        const existing = messageElement.querySelector('.qqnt-toolbox-repeat-slot');
        if (!shouldUseSideRepeat() || !isRepeatableRecord(record)) {
            if (existing) {
                removeRepeatSlot(existing);
            }
            return;
        }
        if (existing?.dataset.msgId === msgId) {
            repeatButtonRecords.set(existing, record);
            positionSideRepeatButton(existing, messageElement, record);
            repeatResizeObserver?.observe(messageElement);
            return;
        }
        if (existing) {
            removeRepeatSlot(existing);
        }
        if (!wrapper) {
            return;
        }
        const nativePlusOne = wrapper.querySelector(':scope > .plus-one-btn:not(.qqnt-toolbox-repeat-slot):not(.qqnt-toolbox-repeat-menu-plus-one)');
        const button = createSideRepeatButton(record, nativePlusOne);
        getMessageLayoutHost(messageElement).append(button);
        positionSideRepeatButton(button, messageElement, record);
        repeatResizeObserver?.observe(messageElement);
    }

    function refreshRepeatEntrypoints() {
        rememberActiveRepeatPeer();
        updateRepeatModeClass();
        if (!shouldUseSideRepeat()) {
            removeSideRepeatEntrypoints();
            repeatResizeObserver?.disconnect();
            return;
        }
        for (const slot of Array.from(document.querySelectorAll('.qqnt-toolbox-repeat-slot'))) {
            const messageElement = getMessageElementFromElement(slot);
            const record = messageElement ? findMessageRecordFromElement(messageElement) || repeatButtonRecords.get(slot) : null;
            if (!messageElement || !isRepeatableRecord(record)) {
                removeRepeatSlot(slot);
                continue;
            }
            ensureSideRepeatEntrypoint(messageElement, record);
        }
        const hoveredMessages = new Set();
        document.querySelectorAll('.message:hover, .ml-item:hover').forEach(element => {
            const messageElement = getMessageElementFromElement(element);
            if (messageElement) {
                hoveredMessages.add(messageElement);
            }
        });
        for (const messageElement of hoveredMessages) {
            const record = findMessageRecordFromElement(messageElement);
            ensureSideRepeatEntrypoint(messageElement, record);
        }
    }

    function scheduleRepeatEntrypointRefresh() {
        if (repeatRefreshTimer) {
            return;
        }
        repeatRefreshTimer = window.setTimeout(() => {
            repeatRefreshTimer = 0;
            refreshRepeatEntrypoints();
        }, 80);
    }

    function installRepeatEntrypoints() {
        injectStyle();
        if (!repeatResizeObserver && typeof ResizeObserver === 'function') {
            repeatResizeObserver = new ResizeObserver(entries => {
                if (!shouldUseSideRepeat()) {
                    return;
                }
                for (const entry of entries) {
                    const messageElement = entry.target;
                    if (!messageElement.isConnected) {
                        repeatResizeObserver.unobserve(messageElement);
                        continue;
                    }
                    const button = messageElement.querySelector?.('.qqnt-toolbox-repeat-slot');
                    const record = button && (
                        findMessageRecordFromElement(messageElement) || repeatButtonRecords.get(button)
                    );
                    if (button && isRepeatableRecord(record)) {
                        positionSideRepeatButton(button, messageElement, record);
                    }
                }
            });
        }
        scheduleRepeatEntrypointRefresh();
    }

    function handleRepeatPeerInteraction(event) {
        const target = event.target instanceof Element ? event.target : null;
        if (target && getMessageElementFromElement(target)) {
            rememberActiveRepeatPeer();
        }
    }

    function compactText(value) {
        const content = typeof value === 'string' || typeof value === 'number'
            ? value
            : value?.textContent;
        return String(content || '')
            .replace(/\s+/g, '')
            .trim();
    }

    function isVisible(element) {
        const rect = element?.getBoundingClientRect?.();
        const style = element ? getComputedStyle(element) : null;
        return Boolean(rect && rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden');
    }

    function distanceToRect(point, rect) {
        const dx = point.x < rect.left ? rect.left - point.x : point.x > rect.right ? point.x - rect.right : 0;
        const dy = point.y < rect.top ? rect.top - point.y : point.y > rect.bottom ? point.y - rect.bottom : 0;
        return Math.hypot(dx, dy);
    }

    function getNativeMenuItemElements(menu) {
        return getContextMenuItemElements(menu, false);
    }

    function getVisibleNativeContextMenus() {
        return Array.from(document.querySelectorAll('.q-context-menu, [class*="context-menu"], [role="menu"]'))
            .filter(menu => {
                if (menu.classList.contains('qqnt-toolbox-fallback-context-menu')) {
                    return false;
                }
                if (menu.matches('.q-context-menu-item, [class*="context-menu-item"], [role="menuitem"]')) {
                    return false;
                }
                if (!isVisible(menu)) {
                    return false;
                }
                const rect = menu.getBoundingClientRect();
                return rect.width >= 40 && rect.height >= 24 && getNativeMenuItemElements(menu).length > 0;
            });
    }

    function closePokeContextMenu(menu) {
        const closed = closeNativeContextMenu(menu);
        if (closed) {
            queueMicrotask(() => restorePokeRecallMenu(menu));
        }
        return closed;
    }

    function findNativeContextMenuNear(point) {
        const menus = getVisibleNativeContextMenus();
        return menus
            .map(menu => {
                const rect = menu.getBoundingClientRect();
                return { menu, rect, distance: distanceToRect(point, rect) };
            })
            .filter(item => item.distance <= 360 || (
                point.x >= item.rect.left - 48 &&
                point.x <= item.rect.right + 48 &&
                point.y >= item.rect.top - 48 &&
                point.y <= item.rect.bottom + 48
            ))
            .sort((a, b) => a.distance - b.distance || (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height))[0]?.menu || null;
    }

    function setNativeMenuItemLabel(item, label) {
        const textNode = item.querySelector?.('.q-context-menu-item__text,[class*="context-menu-item__text"]');
        if (textNode) {
            textNode.textContent = label;
            return;
        }
        const directText = Array.from(item.childNodes || [])
            .find(node => node.nodeType === Node.TEXT_NODE && node.nodeValue.trim());
        if (directText) {
            directText.nodeValue = label;
            return;
        }
        item.append(document.createTextNode(label));
    }

    function setNativeMenuItemRepeatIcon(item) {
        const icon = item.querySelector?.('.q-context-menu-item__icon,[class*="context-menu-item__icon"]');
        if (!icon || icon.querySelector('.qqnt-toolbox-repeat-menu-plus-one')) {
            return;
        }
        const plusOne = createQqPlusOneIcon();
        plusOne.classList.add('qqnt-toolbox-repeat-menu-plus-one');
        plusOne.setAttribute('aria-hidden', 'true');
        plusOne.querySelectorAll('[stroke]').forEach(element => {
            if (element.getAttribute('stroke') !== 'none') {
                element.setAttribute('stroke', 'currentColor');
            }
        });
        plusOne.querySelectorAll('[fill]').forEach(element => {
            if (element.getAttribute('fill') !== 'none') {
                element.setAttribute('fill', 'currentColor');
            }
        });
        icon.replaceChildren(plusOne);
        icon.style.display = icon.style.display || 'flex';
        icon.style.alignItems = 'center';
        icon.style.justifyContent = 'center';
        icon.style.background = 'transparent';
        icon.style.backgroundImage = 'none';
        icon.style.maskImage = 'none';
        icon.style.webkitMaskImage = 'none';
    }

    function setNativeMenuItemPokeIcon(item) {
        const icon = item.querySelector?.('.q-context-menu-item__icon,[class*="context-menu-item__icon"]');
        if (!icon) {
            return;
        }
        const svgNamespace = 'http://www.w3.org/2000/svg';
        const iconElement = document.createElement('i');
        iconElement.className = 'q-svg-icon q-icon vue-component';
        iconElement.style.width = '16px';
        iconElement.style.height = '16px';
        iconElement.style.color = 'inherit';
        const svg = document.createElementNS(svgNamespace, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        const path = document.createElementNS(svgNamespace, 'path');
        path.setAttribute('d', 'M15.1326 5.12573C15.6495 3.98089 17.1938 3.79238 17.9597 4.7644L20.7273 8.27612L20.7205 8.28003L21.2917 9.00366C21.2967 9.00998 21.2991 9.0141 21.2996 9.01538V19.0935C21.2992 19.5667 20.9152 19.9509 20.4412 19.9509H11.9167C11.3487 19.9507 10.8224 19.6605 10.5183 19.1863L10.4607 19.0886L9.03394 16.4919C8.86227 16.1793 8.77226 15.8276 8.77222 15.4705V12.7166H4.56226C3.53378 12.7164 2.70009 11.8825 2.69995 10.8542L2.70972 10.6638C2.80515 9.72475 3.59815 8.99206 4.56226 8.99194H15.614L15.4246 8.08765L15.0193 6.15308C14.9565 5.85276 14.9787 5.53756 15.0828 5.2478L15.1326 5.12573Z');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '1.5');
        svg.appendChild(path);
        iconElement.appendChild(svg);
        icon.replaceChildren(iconElement);
        icon.style.display = icon.style.display || 'flex';
        icon.style.alignItems = 'center';
        icon.style.justifyContent = 'center';
        icon.style.background = 'transparent';
        icon.style.backgroundImage = 'none';
        icon.style.maskImage = 'none';
        icon.style.webkitMaskImage = 'none';
        icon.style.visibility = 'visible';
    }

    function setNativeMenuItemRecallIcon(item) {
        const icon = item.querySelector?.('.q-context-menu-item__icon,[class*="context-menu-item__icon"]');
        if (!icon) {
            return;
        }
        const namespace = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(namespace, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        const path = document.createElementNS(namespace, 'path');
        path.setAttribute('d', 'M9 7 4 12l5 5M5 12h8a6 6 0 0 1 6 6');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '1.7');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.append(path);
        icon.replaceChildren(svg);
        icon.style.display = icon.style.display || 'flex';
        icon.style.alignItems = 'center';
        icon.style.justifyContent = 'center';
        icon.style.background = 'transparent';
        icon.style.backgroundImage = 'none';
        icon.style.maskImage = 'none';
        icon.style.webkitMaskImage = 'none';
        icon.style.visibility = 'visible';
    }

    function createPokeMenuItem(menu, payload, avatar) {
        const template = getNativeMenuItemElements(menu)[0];
        const item = template?.cloneNode(true) || document.createElement('div');
        item.classList?.add('qqnt-toolbox-poke-menu-item');
        if (!template) {
            item.classList.add('q-context-menu-item');
            const icon = document.createElement('span');
            icon.className = 'q-context-menu-item__icon';
            const label = document.createElement('span');
            label.className = 'q-context-menu-item__text';
            item.append(icon, label);
        }
        item.removeAttribute('id');
        item.setAttribute('role', item.getAttribute('role') || 'menuitem');
        item.setAttribute('tabindex', '-1');
        setNativeMenuItemLabel(item, text('\u6233\u4e00\u6233'));
        setNativeMenuItemPokeIcon(item);
        const stop = event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
        };
        item.addEventListener('pointerdown', stop, true);
        item.addEventListener('mousedown', stop, true);
        item.addEventListener('click', event => {
            stop(event);
            closePokeContextMenu(menu);
            sendAvatarPoke(payload, avatar, 'context-menu');
            if (menu.id === POKE_FALLBACK_MENU_ID) {
                removeFallbackPokeMenu();
            }
        }, true);
        return item;
    }

    function removeFallbackRepeatMenu() {
        document.getElementById(REPEAT_FALLBACK_MENU_ID)?.remove();
    }

    function createRepeatFallbackMenuItem(record) {
        const config = createRepeatContextMenuConfig(record);
        const item = document.createElement('div');
        item.className = 'q-context-menu-item qqnt-toolbox-repeat-menu-item';
        item.setAttribute('role', 'menuitem');
        item.setAttribute('tabindex', '-1');
        const icon = document.createElement('span');
        icon.className = 'q-context-menu-item__icon';
        const label = document.createElement('span');
        label.className = 'q-context-menu-item__text';
        label.textContent = config.text;
        item.append(icon, label);
        setNativeMenuItemRepeatIcon(item);
        const stop = event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
        };
        item.addEventListener('pointerdown', stop, true);
        item.addEventListener('mousedown', stop, true);
        item.addEventListener('click', event => {
            stop(event);
            removeFallbackRepeatMenu();
            config.handler();
        }, true);
        return item;
    }

    function showFallbackRepeatMenu(event, record) {
        removeFallbackRepeatMenu();
        injectStyle();
        const menu = document.createElement('div');
        menu.id = REPEAT_FALLBACK_MENU_ID;
        menu.className = 'q-context-menu qqnt-toolbox-fallback-context-menu';
        menu.setAttribute('role', 'menu');
        menu.append(createRepeatFallbackMenuItem(record));
        document.body?.append(menu);
        const rect = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - rect.width - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - rect.height - 8))}px`;
    }

    function removeFallbackPokeMenu() {
        nativeMenuSuppressionObserver?.disconnect();
        nativeMenuSuppressionObserver = null;
        window.clearTimeout(nativeMenuSuppressionTimer);
        nativeMenuSuppressionTimer = 0;
        document.getElementById(POKE_FALLBACK_MENU_ID)?.remove();
    }

    function suppressNativeContextMenus() {
        nativeMenuSuppressionObserver?.disconnect();
        window.clearTimeout(nativeMenuSuppressionTimer);
        const removeCompetingMenus = () => {
            getVisibleNativeContextMenus().forEach(menu => menu.remove());
        };
        removeCompetingMenus();
        nativeMenuSuppressionObserver = new MutationObserver(removeCompetingMenus);
        nativeMenuSuppressionObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        nativeMenuSuppressionTimer = window.setTimeout(() => {
            nativeMenuSuppressionObserver?.disconnect();
            nativeMenuSuppressionObserver = null;
            nativeMenuSuppressionTimer = 0;
        }, 900);
    }

    function showFallbackPokeMenu(point, payload, avatar, requestId) {
        if (requestId !== pokeMenuRequestId || supportsNativeNudge() || Number(payload?.chatType) !== 1 ||
            !isFeatureEnabled('entertainment.rightClickAvatarPoke')) {
            return false;
        }
        removeFallbackPokeMenu();
        injectStyle();
        const menu = document.createElement('div');
        menu.id = POKE_FALLBACK_MENU_ID;
        menu.className = 'q-context-menu qqnt-toolbox-fallback-context-menu';
        menu.setAttribute('role', 'menu');
        menu.append(createPokeMenuItem(menu, payload, avatar));
        document.body?.append(menu);
        const rect = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(point.x, window.innerWidth - rect.width - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(point.y, window.innerHeight - rect.height - 8))}px`;
        suppressNativeContextMenus();
        return true;
    }

    function syncPokeMenuItem(point, payload, avatar, menu = null) {
        menu = menu || findNativeContextMenuNear(point);
        if (!menu) {
            return false;
        }
        const enabled = isFeatureEnabled('entertainment.rightClickAvatarPoke');
        const nativeItems = getNativeMenuItemElements(menu)
            .filter(item => ['\u6233\u6233', '\u6233\u4e00\u6233'].includes(compactText(item)));
        if (nativeItems.length) {
            nativeItems.forEach(item => {
                setNativeMenuItemLabel(item, text('\u6233\u4e00\u6233'));
                setToolboxHidden(item, !enabled);
            });
            return true;
        }
        if (!enabled || supportsNativeNudge()) {
            return false;
        }
        if (menu.querySelector('.qqnt-toolbox-poke-menu-item')) {
            return true;
        }
        const items = getNativeMenuItemElements(menu);
        const pokeItem = createPokeMenuItem(menu, payload, avatar);
        if (items[0]?.parentElement) {
            items[0].parentElement.insertBefore(pokeItem, items[0]);
        } else {
            menu.insertBefore(pokeItem, menu.firstChild);
        }
        return true;
    }

    function schedulePokeContextMenu(event, payload, avatar, requestId) {
        const point = { x: event.clientX, y: event.clientY };
        const run = () => requestId === pokeMenuRequestId && syncPokeMenuItem(point, payload, avatar);
        [24, 72, 160, 300, 480].forEach(delay => setTimeout(run, delay));
        setTimeout(() => {
            if (requestId === pokeMenuRequestId && !findNativeContextMenuNear(point)) {
                showFallbackPokeMenu(point, payload, avatar, requestId);
            }
        }, 540);
        const observer = new MutationObserver(() => {
            if (requestId !== pokeMenuRequestId) {
                observer.disconnect();
                return;
            }
            if (run()) {
                observer.disconnect();
            }
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        setTimeout(() => observer.disconnect(), 900);
    }

    function createRepeatContextMenuConfig(record) {
        return {
            type: TOOLBOX_MENU_TYPE_REPEAT,
            text: text('\u590d\u8bfb'),
            icon: 'copy',
            when: () => true,
            handler: () => repeatRecord(record),
            __qqntToolboxDescriptor: {
                id: 'toolbox:repeat',
                label: text('\u590d\u8bfb'),
                toolbox: true
            },
            __qqntToolboxInsertAfter: ['qq:\u8f6c\u53d1']
        };
    }

    function createPokeRecallMenuItem(menu, record, messageElement) {
        const template = getNativeMenuItemElements(menu)[0];
        const item = template?.cloneNode(true) || document.createElement('div');
        item.classList?.add('qqnt-toolbox-poke-recall-menu-item');
        item.removeAttribute('id');
        item.setAttribute('role', item.getAttribute('role') || 'menuitem');
        item.setAttribute('tabindex', '-1');
        setNativeMenuItemLabel(item, text('\u64a4\u56de'));
        setNativeMenuItemRecallIcon(item);
        const stop = event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
        };
        item.addEventListener('pointerdown', stop, true);
        item.addEventListener('mousedown', stop, true);
        item.addEventListener('click', event => {
            stop(event);
            const payload = createPokeRecallPayload(record);
            const recallPoke = getBridge()?.recallPoke;
            closePokeContextMenu(menu);
            if (!payload || typeof recallPoke !== 'function') {
                return;
            }
            Promise.resolve(recallPoke(payload))
                .then(result => {
                    if (result?.ok) {
                        markPokeRecalled(messageElement, record);
                    }
                })
                .catch(() => {});
        }, true);
        return item;
    }

    function restorePokeRecallMenu(root = document) {
        root.querySelectorAll?.('[data-qqnt-toolbox-poke-recall-hidden="true"]').forEach(item => {
            delete item.dataset.qqntToolboxPokeRecallHidden;
            item.hidden = false;
            item.classList.remove('qqnt-toolbox-poke-recall-native-hidden');
        });
        root.querySelectorAll?.('.qqnt-toolbox-poke-recall-menu-item').forEach(item => item.remove());
    }

    function insertPokeRecallMenuItem(point, record, messageElement, menu = null) {
        menu = menu || findNativeContextMenuNear(point);
        if (!menu || menu.querySelector('.qqnt-toolbox-poke-recall-menu-item')) {
            return Boolean(menu);
        }
        const items = getNativeMenuItemElements(menu);
        const recallItem = createPokeRecallMenuItem(menu, record, messageElement);
        const clearItem = items.find(item => compactText(item) === text('\u6e05\u5c4f'));
        if (clearItem?.parentElement) {
            clearItem.parentElement.insertBefore(recallItem, clearItem);
            clearItem.dataset.qqntToolboxPokeRecallHidden = 'true';
            clearItem.hidden = true;
            clearItem.classList.add('qqnt-toolbox-poke-recall-native-hidden');
        } else if (items[0]?.parentElement) {
            items[0].parentElement.insertBefore(recallItem, items[0]);
        } else {
            menu.insertBefore(recallItem, menu.firstChild);
        }
        return true;
    }

    function schedulePokeRecallContextMenu(event, record) {
        if (supportsNativeNudge() || getPokeRecordOwnership(record) !== 'own') {
            return;
        }
        const point = { x: event.clientX, y: event.clientY };
        const messageElement = event.target instanceof Element
            ? getMessageElementFromElement(event.target)
            : null;
        const run = () => insertPokeRecallMenuItem(point, record, messageElement);
        setTimeout(run, 0);
        setTimeout(run, 48);
        setTimeout(run, 140);
    }

    function getToolboxMessageContextMenuItems({ originalContext, sourceEvent }) {
        const messageElement = getMessageContextTargetFromEvent(sourceEvent);
        const record = isMsgRecord(originalContext?.msgRecord)
            ? originalContext.msgRecord
            : messageElement && findMessageRecordFromElement(messageElement);
        if (!isMsgRecord(record)) {
            return [];
        }
        return shouldUseContextRepeat() && isRepeatableRecord(record)
            ? [createRepeatContextMenuConfig(record)]
            : [];
    }

    function decorateToolboxMessageContextMenuItem({ item }) {
        if (!shouldUseContextRepeat() || compactText(item) !== text('\u590d\u8bfb')) {
            return;
        }
        item.classList.add('qqnt-toolbox-repeat-menu-item');
        setNativeMenuItemRepeatIcon(item);
    }

    function installMessageContextMenuActions() {
        if (messageContextMenuActionsInstalled) {
            return;
        }
        const controller = getMessageContextMenuOrderController();
        controller.registerExtension({
            id: 'toolbox-message-actions',
            getItems: getToolboxMessageContextMenuItems,
            onItemMounted: decorateToolboxMessageContextMenuItem
        });
        handleToolboxVueComponentMount = component => controller.handleVueComponentMount(component, false);
        messageContextMenuActionsInstalled = true;
    }

    function isPanelShortcut(event) {
        return isConfigEnabled('floatingPanel.enabled') &&
            matchesShortcut(event, getByPath(currentConfig, 'floatingPanel.shortcut'));
    }

    async function loadConfig() {
        const bridge = await waitForBridge();
        if (!bridge?.getConfig) {
            configReady = true;
            syncMessageBadgeObserver(true);
            syncRendererReadyDiagnostic();
            return;
        }
        try {
            currentConfig = normalizeRendererConfig(await bridge.getConfig());
        } catch {
        } finally {
            configReady = true;
            getMessageContextMenuOrderController().syncConfig();
            syncReactionLimitFeature();
            syncMessageBadgeObserver(true);
            refreshConfigViews();
            refreshRepeatEntrypoints();
            scheduleRepeatEntrypointRefresh();
            scheduleInterfaceTweaksRefresh();
            syncRendererReadyDiagnostic();
        }
    }

    function subscribeConfig() {
        const bridge = getBridge();
        if (!bridge?.onConfigChanged) {
            return;
        }
        bridge.onConfigChanged(config => {
            currentConfig = normalizeRendererConfig(config);
            configReady = true;
            getMessageContextMenuOrderController().syncConfig();
            syncReactionLimitFeature();
            syncMessageBadgeObserver(true);
            refreshConfigViews();
            scheduleRepeatEntrypointRefresh();
            scheduleInterfaceTweaksRefresh();
            syncRendererReadyDiagnostic();
            if (!isConfigEnabled('interfaceTweaks.inlineMediaViewer')) {
                closeInlineMediaPreview();
            }
        });
    }

    async function loadUpdateState() {
        const bridge = await waitForBridge();
        if (typeof bridge?.getUpdateState !== 'function') {
            return;
        }
        try {
            currentUpdateState = normalizeUpdateState(await bridge.getUpdateState());
            refreshConfigViews();
        } catch {
        }
    }

    function subscribeUpdateState() {
        const bridge = getBridge();
        if (typeof bridge?.onUpdateStateChanged !== 'function') {
            return;
        }
        bridge.onUpdateStateChanged(state => {
            currentUpdateState = normalizeUpdateState(state);
            refreshConfigViews();
        });
    }

    async function initSettingWindow(view) {
        if (!(view instanceof HTMLElement)) {
            return;
        }
        await Promise.all([loadConfig(), injectSettingsStyle()]);
        stopShortcutCapture();
        document.getElementById(SETTINGS_ID)?.remove();
        createPanel({ settings: true, mount: view });
        refreshConfigViews();
    }

    initializeToolboxSettings = initSettingWindow;

    document.addEventListener('keydown', handleInlineMediaPreviewKey, true);
    document.addEventListener('keyup', handleInlineMediaPreviewKey, true);
    document.addEventListener('click', handleEmojiImageClick, true);
    document.addEventListener('click', handleSingleClickMedia, true);

    document.addEventListener('keydown', event => {
        if (activeShortcutCapture || !configReady || !isPanelShortcut(event) || event.repeat) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        togglePanel();
    }, true);

    document.addEventListener('keyup', event => {
        if (!configReady || !isPanelShortcut(event)) {
            return;
        }
        event.stopPropagation();
    }, true);

    installMessageContextMenuActions();

    document.addEventListener('pointerdown', handleRepeatPeerInteraction, true);
    document.addEventListener('pointerdown', handleRepeatPlusOneEvent, true);
    document.addEventListener('mousedown', handleRepeatPlusOneEvent, true);
    document.addEventListener('click', handleRepeatPlusOneEvent, true);
    document.addEventListener('pointerover', handleRepeatMessagePointerOver, true);
    document.addEventListener('mouseup', handleSideBackMouseUp, true);
    document.addEventListener('dragstart', handleRecentContactDragStart, true);
    document.addEventListener('pointerdown', handlePreventMessageDragPointerDown, true);
    document.addEventListener('pointerup', handlePreventMessageDragPointerUp, true);
    document.addEventListener('mousemove', handlePreventMessageDragMove, true);
    document.addEventListener('pointerdown', handleImageViewerPointerDown, true);
    document.addEventListener('pointermove', handleImageViewerPointerMove, true);
    document.addEventListener('pointerup', handleImageViewerPointerUp, true);

    document.addEventListener('contextmenu', event => {
        if (supportsNativeNudge()) {
            return;
        }
        const messageTarget = getMessageContextTargetFromEvent(event);
        const record = messageTarget ? findMessageRecordFromElement(messageTarget) : null;
        if (getPokeRecordOwnership(record) !== 'own') {
            return;
        }
        restorePokeRecallMenu();
        schedulePokeRecallContextMenu(event, record);
    }, true);

    document.addEventListener('contextmenu', event => {
        const pokeRequestId = ++pokeMenuRequestId;
        removeFallbackPokeMenu();
        removeFallbackRepeatMenu();
        document.querySelectorAll('.qqnt-toolbox-poke-menu-item').forEach(item => item.remove());
        const avatar = getPokeAvatarFromEvent(event);
        const messageTarget = avatar ? null : getMessageContextTargetFromEvent(event);
        const directRecord = messageTarget ? findMessageRecordFromElement(messageTarget) : null;
        const pokeRecord = !avatar && getPokeRecordEvent(directRecord) ? directRecord : null;
        const contextRecord = pokeRecord || directRecord;
        const pokeOwnership = pokeRecord
            ? getPokeRecordOwnership(pokeRecord)
            : 'not-poke';
        const menuPrepared = getMessageContextMenuOrderController().handleContextMenu(event, messageTarget);
        if (messageTarget && shouldUseContextRepeat() && isForwardRecordWindow() &&
            Array.isArray(directRecord?.elements) &&
            directRecord.elements.some(element => Number(element?.elementType) === 16)) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            showFallbackRepeatMenu(event, directRecord);
        }
        recordRendererDiagnostic('context-menu.opened', {
            contextKind: avatar ? 'avatar' : messageTarget ? 'message' : 'other',
            elementTypes: Array.isArray(contextRecord?.elements)
                ? Array.from(new Set(contextRecord.elements.map(element => Number(element?.elementType) || 0)))
                : [],
            forwardDetail: isForwardRecordWindow(),
            recordWindow: isSearchChatRecordWindow(),
            pokeOwnership,
            menuPrepared
        });
        getReactionLimitController().rememberContext(
            contextRecord
        );
        const pokeContext = avatar ? getPokeChatContext(avatar) : null;
        if (pokeContext?.isTemporary && isFeatureEnabled('entertainment.rightClickAvatarPoke')) {
            stopAvatarEvent(event);
            suppressNativeContextMenus();
            return;
        }
        const payload = avatar && getPokePayload(avatar, pokeContext);
        if (payload) {
            if (!supportsNativeNudge() && Number(payload.chatType) === 1) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                showFallbackPokeMenu({ x: event.clientX, y: event.clientY }, payload, avatar, pokeRequestId);
            } else {
                schedulePokeContextMenu(event, payload, avatar, pokeRequestId);
            }
        }
    }, true);

    document.addEventListener('pointerdown', event => {
        const recallItem = document.querySelector('.qqnt-toolbox-poke-recall-menu-item');
        const recallMenu = recallItem?.closest?.('.q-context-menu, [class*="context-menu"], [role="menu"]');
        if (recallMenu && !recallMenu.contains(event.target)) {
            restorePokeRecallMenu(recallMenu);
        }
        const menu = document.getElementById(POKE_FALLBACK_MENU_ID);
        if (menu && !menu.contains(event.target)) {
            removeFallbackPokeMenu();
        }
        const repeatMenu = document.getElementById(REPEAT_FALLBACK_MENU_ID);
        if (repeatMenu && !repeatMenu.contains(event.target)) {
            removeFallbackRepeatMenu();
        }
    }, true);

    document.addEventListener('wheel', event => {
        if (!document.getElementById(POKE_FALLBACK_MENU_ID) &&
            !document.getElementById(REPEAT_FALLBACK_MENU_ID)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
    }, { capture: true, passive: false });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            removeFallbackPokeMenu();
            removeFallbackRepeatMenu();
            restorePokeRecallMenu();
        }
    }, true);

    window.addEventListener('resize', () => {
        const panel = document.getElementById(PANEL_ID);
        if (!panel || panel.hidden) {
            scheduleRepeatEntrypointRefresh();
            return;
        }
        const rect = panel.getBoundingClientRect();
        const position = applyPosition(panel, rect.left, rect.top);
        setPanelState(position);
        scheduleRepeatEntrypointRefresh();
    });

    window.addEventListener('hashchange', scheduleRepeatEntrypointRefresh);
    window.addEventListener('focus', rememberActiveRepeatPeer);

    fakeForwardEditor = createFakeForwardEditor({
        getEnabled: () => isConfigEnabled('fakeForward.enabled'),
        getPeer: () => getPeerFromRecord({}),
        getStorageScope: () => registeredPokeAccountUin || 'default',
        getFilePath: file => getBridge()?.getPathForFile?.(file) || file?.path || '',
        stageImage: payload => {
            const stageFakeForwardImage = getBridge()?.stageFakeForwardImage;
            if (typeof stageFakeForwardImage !== 'function') {
                throw new Error('图片暂存接口不可用');
            }
            return stageFakeForwardImage(payload);
        },
        resolveSenderName: senderUin => {
            const resolveSenderName = getBridge()?.resolveFakeForwardSenderName;
            if (typeof resolveSenderName !== 'function') {
                throw new Error('昵称查询接口不可用');
            }
            return resolveSenderName(senderUin);
        },
        send: payload => {
            const sendFakeForward = getBridge()?.sendFakeForward;
            if (typeof sendFakeForward !== 'function') {
                throw new Error('伪造合并转发接口不可用');
            }
            return sendFakeForward({
                ...payload,
                selfUin: registeredPokeAccountUin || registerPokeAccountFromPage(true)
            });
        },
        onError: error => recordRendererDiagnostic('fake-forward.failed', {
            reason: error?.message || String(error)
        }, 'error')
    });
    fakeForwardEditor.install();

    loadConfig().then(subscribeConfig).catch(() => {});
    loadUpdateState().then(subscribeUpdateState).catch(() => {});
    subscribeInlineMediaPreview().catch(() => {});
    installProfileCardHoverBlocker();
    installPokeInteractions();
    installRepeatEntrypoints();
    installInterfaceTweaksObserver();
    installMessageBadgeObserver();
})().catch(error => {
    try {
        window.__qqntToolboxRendererInstalled = false;
        console.error('[QQNT Toolbox] renderer bootstrap failed:', error);
        Promise.resolve(window.qqnt_toolbox?.recordDiagnosticEvent?.({
            level: 'error',
            event: 'renderer.bootstrap-failed',
            details: { reason: error?.message || String(error) }
        })).catch(() => {});
    } catch {
    }
});

export function onVueComponentMount(component) {
    handleToolboxVueComponentMount(component);
}

export async function onSettingWindowCreated(view) {
    return initializeToolboxSettings(view);
}
