(() => {
    const PANEL_ID = 'qqnt-toolbox-panel';
    const STYLE_ID = 'qqnt-toolbox-style';
    const STORAGE_KEY = 'qqnt-toolbox-panel-state';
    const MSG_TYPE_GRAY_TIPS = 5;
    const SEND_STATUS_SUCCESS_NO_SEQ = 3;
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
            simplifySidebar: false,
            simplifyTop: false,
            simplifyChat: false,
            debug: false
        }
    };
    const DEFAULT_CONFIG = {
        fileRetryFixer: {
            enabled: true,
            image: true,
            video: true,
            audio: true,
            otherFiles: false,
            deleteFailedMessage: false,
            archivePassword: ''
        },
        repeatMessage: {
            enabled: true,
            doubleClick: false,
            showInContextMenu: true
        },
        voiceMessage: {
            enabled: true,
            saveInContextMenu: true,
            fakeDurationEnabled: false,
            fakeDurationSeconds: 1
        },
        messageTweaks: {
            promptNoSeq: false,
            removeReplyAt: false
        },
        entertainment: {
            autoPokeBack: false,
            autoPokeBackLimit: 1,
            doubleClickAvatarPoke: false
        },
        preventRecall: {
            enabled: false,
            preventSelfMsg: false,
            persistedFiles: true,
            redirectPicPath: true,
            customColor: false,
            customTextColor: {
                light: '#ff6666',
                dark: '#c70000'
            }
        },
        interfaceTweaks: {
            imageViewerOptimization: false,
            goBackMainList: false,
            preventMessageDrag: false,
            preventRecentContactDrag: false,
            preventProfileCardHover: false,
            deleteBubbleSkin: false,
            hiddenWeatherBtn: false,
            hiddenClassicBtn: false,
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
    let repeatObserver = null;
    let repeatRefreshTimer = 0;
    let repeatMenuRequestId = 0;
    let interfaceObserver = null;
    let interfaceRefreshTimer = 0;
    let preventDragActive = false;
    let replyAtEditor = null;
    let replyAtCleanupBusy = false;
    let imageViewerDrag = null;
    let messageBadgeObserver = null;
    let messageBadgeResizeObserver = null;
    let messageBadgeRefreshTimer = 0;
    let registeredPokeAccountUin = '';
    let lastPokeAccountProbeAt = 0;
    let pendingAvatarPoke = null;
    let suppressAvatarClicksUntil = 0;
    let simplifyBarObserver = null;
    let simplifyObservedContainers = [];
    let simplifyConfigSaveTimer = 0;
    const discoveredSimplifyItems = {
        sideTop: new Map(),
        sideBottom: new Map(),
        topFunc: new Map(),
        chatFunc: new Map()
    };
    const preventDragMouseButtons = new Set([1, 4, 8, 16]);
    const repeatButtonRecords = new WeakMap();
    const pokeAvatarAnimations = new WeakMap();

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

    function getBridge() {
        return window.qqnt_toolbox || null;
    }

    function getByPath(object, path) {
        return String(path).split('.').reduce((value, key) => value?.[key], object);
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
#${PANEL_ID} .qqnt-toolbox-action:hover {
    background: var(--overlay_hover, rgba(127, 127, 127, .14));
}
#${PANEL_ID} .qqnt-toolbox-action[data-danger="true"] {
    color: #ff5a5f;
    border-color: rgba(255, 90, 95, .35);
    background: rgba(255, 90, 95, .10);
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
#${PANEL_ID} .qqnt-toolbox-password-input {
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
#${PANEL_ID} .qqnt-toolbox-password-input:focus {
    border-color: var(--brand_standard, var(--brand-primary, #2f6bff));
    background: var(--overlay_hover, var(--fill_light_primary, rgba(127, 127, 127, .18))) !important;
}
#${PANEL_ID} .qqnt-toolbox-password-input:disabled {
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
body.qqnt-toolbox-side-repeat .message .message-content__wrapper > .qqnt-toolbox-repeat-slot.plus-one-btn {
    display: none !important;
    cursor: pointer;
}
body.qqnt-toolbox-side-repeat .message:hover .message-content__wrapper > .qqnt-toolbox-repeat-slot.plus-one-btn {
    display: flex !important;
}
body.qqnt-toolbox-side-repeat .message .message-content__wrapper > .qqnt-toolbox-repeat-slot.plus-one-btn::before,
.qqnt-toolbox-repeat-menu-plus-one::before {
    content: "+1";
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: currentColor;
    font-size: 13px;
    font-weight: 600;
    line-height: 1;
    letter-spacing: 0;
}
body.qqnt-toolbox-context-repeat .message .plus-one-btn:not(.qqnt-toolbox-repeat-menu-plus-one),
body.qqnt-toolbox-context-repeat .qqnt-toolbox-repeat-slot {
    display: none !important;
}
.qqnt-toolbox-repeat-menu-plus-one {
    pointer-events: none !important;
    transform: scale(.72);
    transform-origin: center;
    color: currentColor;
}
body.qqnt-toolbox-hide-weather .user-profile-card__widgets .weather-widget,
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
`;
        document.head.appendChild(style);
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

    function applyItemOptions(item, options = {}) {
        if (options.requires) {
            const requirements = Array.isArray(options.requires) ? options.requires : [options.requires];
            item.dataset.requires = requirements.join('|');
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

    function createPanel() {
        let panel = document.getElementById(PANEL_ID);
        if (panel) {
            renderSimplifySections(panel);
            updateConfigUi(panel);
            return panel;
        }
        injectStyle();

        panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.hidden = true;

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
                createSwitchItem(text('图片查看器优化'), text('点击空白关闭、拖动窗口'), 'interfaceTweaks.imageViewerOptimization'),
                createSwitchItem(text('侧键返回主列表'), text('鼠标侧键返回会话列表'), 'interfaceTweaks.goBackMainList'),
                createSwitchItem(text('阻止消息窗口拖拽操作'), text('减少误选和误拖'), 'interfaceTweaks.preventMessageDrag'),
                createSwitchItem(text('阻止消息列表拖拽'), text('防止拖出独立聊天窗口'), 'interfaceTweaks.preventRecentContactDrag'),
                createSwitchItem(text('禁止悬停显示资料卡'), text('用户与群资料卡'), 'interfaceTweaks.preventProfileCardHover'),
                createSwitchItem(text('删除消息气泡装扮'), '', 'interfaceTweaks.deleteBubbleSkin'),
                createSwitchItem(text('隐藏天气按钮'), '', 'interfaceTweaks.hiddenWeatherBtn'),
                createSwitchItem(text('隐藏经典模式切换按钮'), '', 'interfaceTweaks.hiddenClassicBtn'),
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
                createSwitchItem(text('提示 NoSeq 消息'), text('标记可能未成功发送的消息'), 'messageTweaks.promptNoSeq'),
                createSwitchItem(text('语音消息'), text('拖拽发送与语音库'), 'voiceMessage.enabled'),
                createSwitchItem(text('右键保存语音'), text('在语音消息右键菜单中显示“保存”'), 'voiceMessage.saveInContextMenu', {
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
                createSwitchItem(text('移除回复 @'), text('移除回复消息时的 @ 标记'), 'messageTweaks.removeReplyAt')
            ]),
            createSection('preventRecall', text('阻止撤回'), [
                createSwitchItem(text('启用'), text('将撤回灰条替换回原消息'), 'preventRecall.enabled'),
                createSwitchItem(text('拦截自己的撤回操作'), text('本人发起的撤回也将被拦截'), 'preventRecall.preventSelfMsg', {
                    requires: 'preventRecall.enabled'
                }),
                createSwitchItem(text('持久化保存'), text('将撤回记录保存在插件的数据目录中'), 'preventRecall.persistedFiles', {
                    requires: 'preventRecall.enabled'
                }),
                createSwitchItem(text('重定向图片储存路径'), text('将被撤回图片保存到插件的数据目录下'), 'preventRecall.redirectPicPath', {
                    requires: 'preventRecall.enabled'
                }),
                createActionItem(text('查看重定向图片'), text('打开重定向图片储存路径'), 'openRecallImageDir', {
                    label: text('打开'),
                    child: true
                }),
                createSwitchItem(text('自定义颜色'), text('调整撤回消息颜色，重载消息生效'), 'preventRecall.customColor', {
                    requires: 'preventRecall.enabled'
                }),
                createColorPairItem(text('撤回提示颜色'), text('撤回提示标记显示颜色'), 'preventRecall.customTextColor.light', 'preventRecall.customTextColor.dark', {
                    requires: 'preventRecall.customColor',
                    child: true
                }),
                createActionItem(text('查看撤回消息'), text('查看所有的撤回数据'), 'viewRecallMessages', {
                    label: text('查看')
                }),
                createActionItem(text('清理撤回缓存'), text('清理内存和本地撤回数据'), 'clearRecallCache', {
                    label: text('清理'),
                    danger: true
                })
            ]),
            createSection('entertainment', text('娱乐互动'), [
                createSwitchItem(text('自动回拍'), text('收到拍一拍后自动拍回'), 'entertainment.autoPokeBack'),
                createNumberItem(text('回拍阈值'), text('0 为无限制'), 'entertainment.autoPokeBackLimit', {
                    min: 0,
                    max: 9999,
                    maxLength: 4,
                    suffix: text('次'),
                    requires: 'entertainment.autoPokeBack',
                    child: true
                }),
                createSwitchItem(text('双击头像拍一拍'), text('替代双击头像打开私聊'), 'entertainment.doubleClickAvatarPoke')
            ]),
            createCategoryTitle(text('精简')),
            createSection('simplifySidebar', text('侧边栏'), []),
            createSection('simplifyTop', text('顶部功能栏'), []),
            createSection('simplifyChat', text('聊天功能栏'), []),
            createCategoryTitle(text('其他')),
            createSection('debug', text('调试功能'), [
                createSwitchItem(text('调试日志'), text('仅开启后输出诊断信息'), 'debug.enabled')
            ])
        );
        panel.append(titlebar, body);

        document.body.appendChild(panel);
        renderSimplifySections(panel);
        installPanelEvents(panel);
        installGroupEvents(panel);
        installFeatureEvents(panel);
        updateConfigUi(panel);

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
            const enabled = isFeatureEnabled(configPath);
            switchButton.dataset.checked = String(enabled);
            switchButton.setAttribute('aria-checked', String(enabled));
            switchButton.title = enabled ? text('已开启') : text('已关闭');
            switchButton.disabled = disabled || (!configReady && Boolean(getBridge()));
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
        updateGroupUi(panel);
    }

    async function setConfigValue(configPath, value) {
        const nextConfig = clonePlain(currentConfig);
        setByPath(nextConfig, configPath, value);
        currentConfig = mergeConfig(nextConfig);
        updateConfigUi();
        scheduleRepeatEntrypointRefresh();
        scheduleInterfaceTweaksRefresh();
        const bridge = getBridge();
        if (!bridge?.setConfig) {
            return;
        }
        try {
            currentConfig = mergeConfig(await bridge.setConfig(currentConfig));
        } catch {
        } finally {
            configReady = true;
            renderSimplifySections();
            updateConfigUi();
            scheduleRepeatEntrypointRefresh();
            scheduleInterfaceTweaksRefresh();
        }
    }

    async function setConfigBoolean(configPath, enabled) {
        return setConfigValue(configPath, enabled);
    }

    function installFeatureEvents(panel) {
        panel.addEventListener('click', event => {
            const actionButton = event.target.closest?.('.qqnt-toolbox-action[data-action]');
            if (actionButton && panel.contains(actionButton)) {
                event.preventDefault();
                event.stopPropagation();
                runPanelAction(actionButton.dataset.action);
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
            setConfigBoolean(configPath, nextChecked);
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
            const input = event.target.closest?.(
                '.qqnt-toolbox-password-input[data-config-path], .qqnt-toolbox-number-input[data-config-path]'
            );
            if (input && event.key === 'Enter') {
                input.blur();
            }
        });
    }

    async function runPanelAction(action) {
        const bridge = getBridge();
        try {
            if (action === 'openRecallDir') {
                await bridge?.openRecallDir?.();
            } else if (action === 'openRecallImageDir') {
                await bridge?.openRecallImageDir?.();
            } else if (action === 'viewRecallMessages') {
                await bridge?.viewRecallMessages?.();
            } else if (action === 'clearRecallCache') {
                await bridge?.clearRecallCache?.();
            }
        } catch {
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
            requestAnimationFrame(() => {
                const rect = panel.getBoundingClientRect();
                const position = applyPosition(panel, rect.left, rect.top);
                setPanelState(position);
            });
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
        const normalizedLabels = labels.map(label => compactText(label));
        const values = [
            element.getAttribute?.('aria-label'),
            element.getAttribute?.('title'),
            element.getAttribute?.('data-title'),
            element.getAttribute?.('data-text'),
            element.textContent
        ].map(compactText).filter(Boolean);
        return values.some(value => normalizedLabels.some(label => value === label || value.includes(label)));
    }

    function setLabeledControlsHidden(labels, hidden) {
        const panel = document.getElementById(PANEL_ID);
        panel?.querySelectorAll('[data-qqnt-toolbox-hidden="true"]')
            .forEach(element => setToolboxHidden(element, false));

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
            if (element.closest(`#${PANEL_ID}`)) {
                return;
            }
            if (elementMatchesAnyLabel(element, labels)) {
                targets.add(element.closest(
                    '.func-menu__item_wrap, .q-context-menu-item, [class*="context-menu-item"], [role="menuitem"], button'
                ) || element);
            }
        });
        targets.forEach(element => setToolboxHidden(element, hidden));
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
                const value = normalizeText(candidate.getAttribute?.(attribute));
                if (value) {
                    return value;
                }
            }
        }
        return normalizeText(element.textContent);
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
        const current = Array.isArray(currentItems) ? currentItems : [];
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
                currentConfig = mergeConfig(await bridge.setConfig(clonePlain(currentConfig)));
                renderSimplifySections();
                updateConfigUi();
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
        renderSimplifySections();
        updateConfigUi();
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

    function applyInterfaceTweaks() {
        if (!document.body) {
            return;
        }
        document.body.classList.toggle('qqnt-toolbox-hide-weather', isConfigEnabled('interfaceTweaks.hiddenWeatherBtn'));
        document.body.classList.toggle('qqnt-toolbox-hide-classic', isConfigEnabled('interfaceTweaks.hiddenClassicBtn'));
        document.body.classList.toggle('qqnt-toolbox-hide-update', isConfigEnabled('interfaceTweaks.hiddenUpdateBtnAndNotice'));
        document.body.classList.toggle('qqnt-toolbox-remove-vip-color', isConfigEnabled('interfaceTweaks.removeVipColor'));

        setSelectorHidden('.user-profile-card__widgets .weather-widget', isConfigEnabled('interfaceTweaks.hiddenWeatherBtn'));
        setSelectorHidden('.window-control-area .narrow-toggler', isConfigEnabled('interfaceTweaks.hiddenClassicBtn'));
        setLabeledControlsHidden([text('\u9501\u5b9a')], isConfigEnabled('interfaceTweaks.hiddenLockBtn'));
        setLabeledControlsHidden([text('\u9000\u51fa\u8d26\u53f7'), text('\u9000\u51fa\u767b\u5f55')], isConfigEnabled('interfaceTweaks.hiddenLogoutBtn'));
        setLabeledControlsHidden([text('\u68c0\u67e5\u66f4\u65b0'), text('\u66f4\u65b0\u901a\u77e5')], isConfigEnabled('interfaceTweaks.hiddenUpdateBtnAndNotice'));

        const controlWidth = document.querySelector('.window-control-area')?.offsetWidth;
        if (controlWidth) {
            document.querySelector('.topbar.container-topbar .topbar-content')?.style.setProperty('padding-right', `${controlWidth - 10}px`);
        }
        applySimplifyTweaks();
        scheduleMessageBadgeRefresh();
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
        return location.hash === '#/image-viewer' || Boolean(document.querySelector('.main-area.main-area--image, .main-area--image'));
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
        return record?.qqnt_toolbox_recall || record?.lt_recall || null;
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
        const elementTypes = new Set((Array.isArray(record?.elements) ? record.elements : [])
            .map(element => Number(element?.elementType)));
        const selectors = [];
        if (elementTypes.has(4)) {
            selectors.push('.ptt-message__container.ptt-message', '.ptt-message__container');
        }
        if (elementTypes.has(2)) {
            selectors.push('.mix-message__container--pic', '.message-content.mix-message__inner .pic-element', '.pic-element');
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

    function upsertMessageBadges(messageElement, record) {
        const mark = getRecallMark(record);
        const titleParts = [text('\u8be5\u6d88\u606f\u5df2\u88ab'), getRecallOperatorName(mark), text('\u64a4\u56de'), formatRecallTime(mark?.recallTime)].filter(Boolean);
        const recallBadge = setMessageBadge(
            messageElement,
            'qqnt-toolbox-recall-badge',
            isConfigEnabled('preventRecall.enabled') && Boolean(mark),
            titleParts.join(' ')
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
        if (!badges.length) {
            anchors.forEach(anchor => anchor.removeAttribute('data-qqnt-toolbox-status-anchor'));
            return;
        }
        const target = getMessageBadgeTarget(messageElement, record);
        const host = messageElement.querySelector('.message-container') ||
            messageElement.querySelector('.message-content__wrapper') ||
            messageElement;
        anchors.forEach(anchor => {
            if (anchor !== host) {
                anchor.removeAttribute('data-qqnt-toolbox-status-anchor');
            }
        });
        for (const [slot, badge] of badges.entries()) {
            if (badge.parentElement !== host) {
                host.appendChild(badge);
            }
            positionMessageBadge(badge, host, target, slot);
        }
        host.dataset.qqntToolboxStatusAnchor = 'true';
    }

    function refreshMessageBadges() {
        if (!document.body) {
            return;
        }
        document.body.style.setProperty('--qqnt-toolbox-recall-color', isConfigEnabled('preventRecall.customColor')
            ? (matchMedia('(prefers-color-scheme: dark)').matches
                ? currentConfig.preventRecall.customTextColor.dark
                : currentConfig.preventRecall.customTextColor.light)
            : '');
        document.querySelectorAll('.message, .ml-item').forEach(element => {
            const messageElement = getMessageElementFromElement(element);
            if (!messageElement) {
                return;
            }
            const record = findMessageRecordFromElement(messageElement);
            upsertMessageBadges(messageElement, record);
        });
        registerPokeAccountFromPage();
    }

    function scheduleMessageBadgeRefresh() {
        if (messageBadgeRefreshTimer) {
            return;
        }
        messageBadgeRefreshTimer = window.setTimeout(() => {
            messageBadgeRefreshTimer = 0;
            refreshMessageBadges();
        }, 100);
    }

    function installMessageBadgeObserver() {
        if (messageBadgeObserver || !document.body) {
            scheduleMessageBadgeRefresh();
            return;
        }
        messageBadgeObserver = new MutationObserver(scheduleMessageBadgeRefresh);
        messageBadgeObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        if (typeof ResizeObserver === 'function') {
            messageBadgeResizeObserver = new ResizeObserver(scheduleMessageBadgeRefresh);
            messageBadgeResizeObserver.observe(document.body);
        }
        scheduleMessageBadgeRefresh();
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
        for (const key of ['props', 'ctx', 'proxy', 'msgRecord', 'message', 'record']) {
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

    function normalizeUin(value) {
        const content = String(value ?? '').trim();
        return /^\d+$/.test(content) && content !== '0' ? content : '';
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
        if (!selfUin || selfUin === registeredPokeAccountUin) {
            return selfUin;
        }
        registeredPokeAccountUin = selfUin;
        Promise.resolve(getBridge()?.registerPokeAccount?.(selfUin)).catch(() => {
            if (registeredPokeAccountUin === selfUin) {
                registeredPokeAccountUin = '';
            }
        });
        return selfUin;
    }

    function getPokeAvatarFromEvent(event) {
        const path = event?.composedPath?.() || [event?.target];
        for (const item of path) {
            if (!(item instanceof Element) ||
                !item.matches('.avatar-span .avatar, .avatar.message-container__avatar')) {
                continue;
            }
            if (getMessageElementFromElement(item)) {
                return item;
            }
        }
        return null;
    }

    function getPokePayload(avatar) {
        const record = findMessageRecordFromElement(avatar);
        const aioData = getCurrentAioData() || {};
        const header = aioData.header || {};
        const chatType = Number(record?.chatType || aioData.chatType || header.chatType || 0);
        const peerUin = [
            record?.peerUin,
            record?.peerUid,
            aioData.peerUin,
            aioData.peerUid,
            header.uin,
            header.peerUin,
            header.uid,
            header.peerUid
        ].map(normalizeUin).find(Boolean) || '';
        if (chatType === 2) {
            const targetUin = normalizeUin(record?.senderUin || record?.sender?.uin);
            return targetUin && peerUin ? { chatType, targetUin, groupUin: peerUin } : null;
        }
        if (chatType === 1) {
            return peerUin ? { chatType, targetUin: peerUin, groupUin: '' } : null;
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

    function sendAvatarPoke(payload, avatar) {
        const request = {
            ...(payload || { chatType: 0, targetUin: '', groupUin: '' }),
            selfUin: registerPokeAccountFromPage(true)
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
            payload: getPokePayload(avatar)
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

    function installPokeInteractions() {
        document.addEventListener('pointerdown', handleAvatarPointerDown, true);
        document.addEventListener('click', suppressAvatarClick, true);
        document.addEventListener('dblclick', suppressAvatarClick, true);
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
            guildId: normalizeText(record?.guildId || aioData.guildId || header.guildId)
        };
    }

    function cloneForIpc(value, depth = 0, seen = new WeakMap()) {
        if (value === null || value === undefined || depth > 8) {
            return value;
        }
        if (typeof value !== 'object') {
            return value;
        }
        if (ArrayBuffer.isView(value)) {
            return Array.from(value);
        }
        if (value instanceof Map) {
            return Object.fromEntries(Array.from(value, ([key, item]) => [key, cloneForIpc(item, depth + 1, seen)]));
        }
        if (seen.has(value)) {
            return seen.get(value);
        }
        if (Array.isArray(value)) {
            const array = [];
            seen.set(value, array);
            for (const item of value) {
                array.push(cloneForIpc(item, depth + 1, seen));
            }
            return array;
        }
        const object = {};
        seen.set(value, object);
        for (const [key, item] of Object.entries(value)) {
            if (typeof item === 'function') {
                continue;
            }
            object[key] = cloneForIpc(item, depth + 1, seen);
        }
        return object;
    }

    function buildRepeatPayload(record) {
        const msgId = normalizeText(record?.msgId);
        const peer = getPeerFromRecord(record);
        if (!msgId || !peer) {
            return null;
        }
        return {
            msgId,
            peer,
            record: {
                msgId,
                msgSeq: normalizeText(record?.msgSeq),
                msgRandom: normalizeText(record?.msgRandom),
                chatType: Number(record?.chatType || peer.chatType),
                peerUid: normalizeText(record?.peerUid || peer.peerUid),
                peerUin: normalizeText(record?.peerUin),
                guildId: normalizeText(record?.guildId || peer.guildId),
                elements: cloneForIpc(record?.elements || [])
            }
        };
    }

    async function repeatRecord(record) {
        if (!isFeatureEnabled('repeatMessage.enabled')) {
            return;
        }
        const bridge = getBridge();
        const payload = buildRepeatPayload(record);
        if (!bridge?.repeatMessage || !payload) {
            return;
        }
        try {
            await bridge.repeatMessage(payload);
        } catch {
        }
    }

    function isRepeatableRecord(record) {
        return Boolean(normalizeText(record?.msgId) && Array.isArray(record?.elements) && record.elements.length > 0);
    }

    function shouldUseSideRepeat() {
        return isFeatureEnabled('repeatMessage.enabled') && !isFeatureEnabled('repeatMessage.showInContextMenu');
    }

    function shouldUseContextRepeat() {
        return isFeatureEnabled('repeatMessage.enabled') && isFeatureEnabled('repeatMessage.showInContextMenu');
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

    function getRepeatTargetFromElement(element) {
        const messageElement = getMessageElementFromElement(element);
        const record = findMessageRecordFromElement(messageElement || element);
        if (!messageElement || !isRepeatableRecord(record)) {
            return null;
        }
        return { messageElement, record };
    }

    function getRepeatTargetFromEvent(event) {
        const path = event?.composedPath?.() || [];
        for (const item of path) {
            if (!(item instanceof Element)) {
                continue;
            }
            const target = getRepeatTargetFromElement(item);
            if (!target) {
                continue;
            }
            const content = getMessageBadgeTarget(target.messageElement, target.record);
            const rect = content?.getBoundingClientRect?.();
            if (rect?.width > 0 && rect?.height > 0 &&
                event.clientX >= rect.left && event.clientX <= rect.right &&
                event.clientY >= rect.top && event.clientY <= rect.bottom) {
                return target;
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
        slot.remove();
    }

    function removeSideRepeatEntrypoints(root = document) {
        root.querySelectorAll?.('.qqnt-toolbox-repeat-slot').forEach(removeRepeatSlot);
    }

    function updateRepeatModeClass() {
        const sideRepeat = shouldUseSideRepeat();
        const contextRepeat = shouldUseContextRepeat();
        document.body?.classList.toggle('qqnt-toolbox-side-repeat', sideRepeat);
        document.body?.classList.toggle('qqnt-toolbox-context-repeat', contextRepeat);
    }

    function getNativePlusOneTemplate() {
        const selector = '.plus-one-btn:not(.qqnt-toolbox-repeat-slot):not(.qqnt-toolbox-repeat-menu-plus-one)';
        return document.querySelector(`.message-content__wrapper > ${selector}`) || document.querySelector(`.message ${selector}`) || document.querySelector(selector);
    }

    function createNativePlusOneButton() {
        const template = getNativePlusOneTemplate();
        const button = template?.cloneNode(true) || document.createElement('div');
        button.removeAttribute('id');
        button.removeAttribute('data-event');
        button.textContent = '';
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

    function createSideRepeatButton(record) {
        const button = createNativePlusOneButton();
        button.classList.add('qqnt-toolbox-repeat-slot');
        button.dataset.msgId = normalizeText(record?.msgId);
        button.setAttribute('role', 'button');
        button.setAttribute('tabindex', '-1');
        repeatButtonRecords.set(button, record);
        return button;
    }

    function getRepeatPlusOneFromEvent(event) {
        const button = event.target?.closest?.('.plus-one-btn');
        if (!button || button.closest(`#${PANEL_ID}`) || button.closest('.qqnt-toolbox-repeat-menu-item')) {
            return null;
        }
        const target = getRepeatTargetFromElement(button);
        const record = target?.record || repeatButtonRecords.get(button);
        if (!isRepeatableRecord(record)) {
            return null;
        }
        return {
            button,
            messageElement: target?.messageElement || getMessageElementFromElement(button),
            record
        };
    }

    function triggerRepeatFromButton(button, fallbackRecord) {
        const record = findMessageRecordFromElement(button) || repeatButtonRecords.get(button) || fallbackRecord;
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
        const target = getRepeatPlusOneFromEvent(event);
        if (!target) {
            return;
        }
        handleRepeatButtonEvent(target.button, target.record, event);
    }

    function ensureSideRepeatEntrypoint(messageElement, record) {
        const msgId = normalizeText(record?.msgId);
        const wrapper = messageElement.querySelector('.message-content__wrapper');
        const existing = wrapper?.querySelector(':scope > .qqnt-toolbox-repeat-slot');
        if (!shouldUseSideRepeat() || !isRepeatableRecord(record)) {
            if (existing) {
                removeRepeatSlot(existing);
            }
            return;
        }
        if (existing?.dataset.msgId === msgId) {
            repeatButtonRecords.set(existing, record);
            return;
        }
        if (existing) {
            removeRepeatSlot(existing);
        }
        if (!wrapper) {
            return;
        }
        const nativePlusOne = wrapper.querySelector(':scope > .plus-one-btn:not(.qqnt-toolbox-repeat-slot):not(.qqnt-toolbox-repeat-menu-plus-one)');
        if (nativePlusOne) {
            return;
        }
        wrapper.append(createSideRepeatButton(record));
    }

    function refreshRepeatEntrypoints() {
        updateRepeatModeClass();
        if (!shouldUseSideRepeat()) {
            removeSideRepeatEntrypoints();
            return;
        }
        const visibleMessages = getVisibleMessageElements();
        const visibleSet = new Set(visibleMessages);
        for (const slot of Array.from(document.querySelectorAll('.qqnt-toolbox-repeat-slot'))) {
            const messageElement = getMessageElementFromElement(slot);
            const record = messageElement ? findMessageRecordFromElement(messageElement) || repeatButtonRecords.get(slot) : null;
            if (!messageElement || !visibleSet.has(messageElement) || !isRepeatableRecord(record)) {
                removeRepeatSlot(slot);
            }
        }
        for (const messageElement of visibleMessages) {
            const record = findMessageRecordFromElement(messageElement);
            if (isRepeatableRecord(record)) {
                ensureSideRepeatEntrypoint(messageElement, record);
            }
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
        if (repeatObserver || !document.body) {
            scheduleRepeatEntrypointRefresh();
            return;
        }
        repeatObserver = new MutationObserver(scheduleRepeatEntrypointRefresh);
        repeatObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        scheduleRepeatEntrypointRefresh();
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
        const selectors = ['.q-context-menu-item', '[class*="context-menu-item"]', '[role="menuitem"]', 'li', 'button'];
        const candidates = [];
        for (const selector of selectors) {
            candidates.push(...Array.from(menu.querySelectorAll(selector)));
        }
        const seen = new Set();
        return candidates
            .filter(item => {
                if (!item || seen.has(item) || item.classList?.contains('qqnt-toolbox-repeat-menu-item')) {
                    return false;
                }
                seen.add(item);
                return !candidates.some(parent => parent !== item && parent.contains?.(item));
            })
            .slice(0, 28);
    }

    function findNativeContextMenuNear(point) {
        const menus = Array.from(document.querySelectorAll('.q-context-menu, [class*="context-menu"], [role="menu"]'))
            .filter(menu => {
                if (!isVisible(menu)) {
                    return false;
                }
                const rect = menu.getBoundingClientRect();
                return rect.width >= 40 && rect.height >= 24 && getNativeMenuItemElements(menu).length > 0;
            });
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
        if (!icon) {
            return;
        }
        const plusOne = createNativePlusOneButton();
        plusOne.classList.add('qqnt-toolbox-repeat-menu-plus-one');
        plusOne.removeAttribute('title');
        plusOne.setAttribute('aria-hidden', 'true');
        icon.replaceChildren(plusOne);
        icon.style.display = icon.style.display || 'flex';
        icon.style.alignItems = 'center';
        icon.style.justifyContent = 'center';
        icon.style.background = 'transparent';
        icon.style.backgroundImage = 'none';
        icon.style.maskImage = 'none';
        icon.style.webkitMaskImage = 'none';
    }

    function createRepeatMenuItem(menu, record) {
        const template = getNativeMenuItemElements(menu)[0];
        const item = template?.cloneNode(true) || document.createElement('div');
        item.classList?.add('qqnt-toolbox-repeat-menu-item');
        item.removeAttribute('id');
        item.setAttribute('role', item.getAttribute('role') || 'menuitem');
        item.setAttribute('tabindex', '-1');
        setNativeMenuItemLabel(item, text('\u590d\u8bfb'));
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
            repeatRecord(record);
            menu.remove();
        }, true);
        return item;
    }

    function insertRepeatMenuItem(point, record, menu = null) {
        menu = menu || findNativeContextMenuNear(point);
        if (!menu || menu.querySelector('.qqnt-toolbox-repeat-menu-item')) {
            return Boolean(menu);
        }
        const items = getNativeMenuItemElements(menu);
        const repeatItem = createRepeatMenuItem(menu, record);
        if (items[0]?.parentElement) {
            items[0].parentElement.insertBefore(repeatItem, items[0]);
        } else {
            menu.insertBefore(repeatItem, menu.firstChild);
        }
        return true;
    }

    function scheduleRepeatContextMenu(event, record, requestId) {
        const point = { x: event.clientX, y: event.clientY };
        const run = () => requestId === repeatMenuRequestId && insertRepeatMenuItem(point, record);
        [0, 48, 140, 260, 420].forEach(delay => setTimeout(run, delay));
        const observer = new MutationObserver(() => {
            if (requestId !== repeatMenuRequestId) {
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

    function isRightCtrl(event) {
        return event.code === 'ControlRight' || (event.key === 'Control' && event.location === KeyboardEvent.DOM_KEY_LOCATION_RIGHT);
    }

    async function loadConfig() {
        const bridge = getBridge();
        if (!bridge?.getConfig) {
            configReady = true;
            return;
        }
        try {
            currentConfig = mergeConfig(await bridge.getConfig());
        } catch {
        } finally {
            configReady = true;
            renderSimplifySections();
            updateConfigUi();
            scheduleRepeatEntrypointRefresh();
            scheduleInterfaceTweaksRefresh();
        }
    }

    function subscribeConfig() {
        const bridge = getBridge();
        if (!bridge?.onConfigChanged) {
            return;
        }
        bridge.onConfigChanged(config => {
            currentConfig = mergeConfig(config);
            configReady = true;
            renderSimplifySections();
            updateConfigUi();
            scheduleRepeatEntrypointRefresh();
            scheduleInterfaceTweaksRefresh();
        });
    }

    document.addEventListener('keydown', event => {
        if (!isRightCtrl(event) || event.repeat) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        togglePanel();
    }, true);

    document.addEventListener('keyup', event => {
        if (!isRightCtrl(event)) {
            return;
        }
        event.stopPropagation();
    }, true);

    document.addEventListener('pointerdown', handleRepeatPlusOneEvent, true);
    document.addEventListener('mousedown', handleRepeatPlusOneEvent, true);
    document.addEventListener('click', handleRepeatPlusOneEvent, true);
    document.addEventListener('mouseup', handleSideBackMouseUp, true);
    document.addEventListener('dragstart', handleRecentContactDragStart, true);
    document.addEventListener('pointerdown', handlePreventMessageDragPointerDown, true);
    document.addEventListener('pointerup', handlePreventMessageDragPointerUp, true);
    document.addEventListener('mousemove', handlePreventMessageDragMove, true);
    document.addEventListener('pointerdown', handleImageViewerPointerDown, true);
    document.addEventListener('pointermove', handleImageViewerPointerMove, true);
    document.addEventListener('pointerup', handleImageViewerPointerUp, true);

    document.addEventListener('contextmenu', event => {
        const requestId = ++repeatMenuRequestId;
        document.querySelectorAll('.qqnt-toolbox-repeat-menu-item').forEach(item => item.remove());
        if (!shouldUseContextRepeat()) {
            return;
        }
        const target = getRepeatTargetFromEvent(event);
        const record = target?.record;
        if (!isRepeatableRecord(record)) {
            return;
        }
        scheduleRepeatContextMenu(event, record, requestId);
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

    window.addEventListener('scroll', scheduleRepeatEntrypointRefresh, true);

    loadConfig();
    subscribeConfig();
    installProfileCardHoverBlocker();
    installPokeInteractions();
    installRepeatEntrypoints();
    installInterfaceTweaksObserver();
    installMessageBadgeObserver();
})();
