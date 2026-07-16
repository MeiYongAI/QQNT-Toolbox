'use strict';

function injectedVoiceFileSenderUi(voiceLibraryPanelFactory, voiceLibraryPanelCss) {
    const VOICE_TEXTS = [
        '\u5f00\u59cb\u8bf4\u8bdd',
        '\u6309\u4f4f\u8bf4\u8bdd',
        '\u6309\u4f4f\u7a7a\u683c\u952e',
        '\u6309Esc\u952e',
        '\u70b9\u51fb\u9000\u51fa',
        '\u677e\u5f00\u53d1\u9001'
    ];
    const VOICE_SELECTORS = [
        '.audio-msg-input',
        '[class*="audio-msg-input"]',
        '[class*="record-panel"]',
        '[class*="recordPanel"]',
        '[class*="ptt-panel"]',
        '[class*="pttPanel"]'
    ];
    const MEDIA_EXTENSIONS = new Set([
        '.3g2', '.3gp', '.aac', '.amr', '.asf', '.avi', '.flac', '.flv', '.m2ts', '.m4a', '.m4v', '.mkv',
        '.mov', '.mp3', '.mp4', '.mpeg', '.mpg', '.ogg', '.ogv', '.opus', '.ts', '.wav', '.weba', '.webm', '.wmv'
    ]);
    let libraryPanel = null;

    function getBridge() {
        window.__voiceFileSenderBridge = window.__voiceFileSenderBridge || {};
        const bridge = window.__voiceFileSenderBridge;
        bridge.queue = bridge.queue || [];
        return bridge;
    }

    function isVoiceFeatureEnabled() {
        return getBridge().enabled === true;
    }

    function isVoiceSaveInContextMenuEnabled() {
        const bridge = getBridge();
        return bridge.enabled === true && bridge.saveInContextMenu === true;
    }

    function isVoiceForwardInContextMenuEnabled() {
        const bridge = getBridge();
        return bridge.enabled === true && bridge.forwardInContextMenu === true;
    }

    function getByPath(object, path) {
        return path.split('.').reduce((value, key) => value?.[key], object);
    }

    function findVueValue(element, path) {
        const instances = element?.__VUE__;
        if (!instances?.length) {
            return undefined;
        }
        for (const instance of new Set(instances)) {
            const value = getByPath(instance, path);
            if (value !== undefined) {
                return value;
            }
        }
        return undefined;
    }

    function getCurrentAioData() {
        return findVueValue(document.querySelector('.aio.vue-component'), 'proxy.commonAioStore.curAioData') ||
            findVueValue(document.querySelector('.aio'), 'proxy.commonAioStore.curAioData') ||
            getByPath(globalThis, 'app.__vue_app__.config.globalProperties.$store.state.common_Aio.curAioData');
    }

    function firstNonEmpty(values) {
        return values.find(value => value !== undefined && value !== null && String(value).trim());
    }

    function normalizePeerId(value) {
        const text = String(value ?? '').trim();
        if (!text || text === 'undefined' || text === 'null' || text === '0') {
            return '';
        }
        return text;
    }

    function pickPeerId(values) {
        return normalizePeerId(firstNonEmpty(values));
    }

    function normalizePeerFromAioData(aioData) {
        if (!aioData || typeof aioData !== 'object') {
            return null;
        }
        const header = aioData.header || {};
        const chatType = Number(firstNonEmpty([
            aioData.chatType,
            aioData.type,
            header.chatType,
            aioData.aioType,
            header.type
        ]));
        const isGroup = chatType === 2;
        const isC2c = chatType === 1 || chatType === 100;
        const peerUin = pickPeerId([
            aioData.peerUin,
            header.peerUin,
            aioData.chatUin,
            header.chatUin,
            aioData.uin,
            header.uin,
            aioData.userUin,
            header.userUin,
            aioData.contactUin,
            header.contactUin,
            aioData.targetUin,
            header.targetUin
        ]);
        const peerUid = isGroup
            ? pickPeerId([
                aioData.peerUid,
                header.peerUid,
                aioData.groupCode,
                header.groupCode,
                aioData.groupId,
                header.groupId,
                aioData.peerUin,
                header.peerUin,
                aioData.chatUin,
                header.chatUin,
                aioData.uin,
                header.uin
            ])
            : pickPeerId([
                aioData.peerUid,
                header.peerUid,
                aioData.peer?.peerUid,
                header.peer?.peerUid,
                aioData.peer?.uid,
                header.peer?.uid,
                aioData.peer?.ntUid,
                header.peer?.ntUid,
                aioData.contact?.peerUid,
                header.contact?.peerUid,
                aioData.contact?.uid,
                header.contact?.uid,
                aioData.contact?.ntUid,
                header.contact?.ntUid,
                aioData.buddy?.peerUid,
                header.buddy?.peerUid,
                aioData.buddy?.uid,
                header.buddy?.uid,
                aioData.friend?.peerUid,
                header.friend?.peerUid,
                aioData.friend?.uid,
                header.friend?.uid,
                aioData.target?.peerUid,
                header.target?.peerUid,
                aioData.target?.uid,
                header.target?.uid,
                aioData.uid,
                header.uid,
                aioData.contactUid,
                header.contactUid,
                aioData.userUid,
                header.userUid,
                aioData.targetUid,
                header.targetUid,
                aioData.friendUid,
                header.friendUid,
                aioData.peerUin,
                header.peerUin,
                aioData.chatUin,
                header.chatUin,
                aioData.uin,
                header.uin
            ]);
        if (!chatType || !peerUid || (isC2c && peerUid === 'self')) {
            return null;
        }
        return {
            chatType,
            peerUid,
            peerUin,
            guildId: String(aioData?.guildId || header.guildId || '')
        };
    }

    function getVueInstances(element) {
        if (!(element instanceof Element)) {
            return [];
        }
        const result = [];
        if (Array.isArray(element.__VUE__)) {
            result.push(...element.__VUE__);
        }
        if (element.__vueParentComponent) {
            result.push(element.__vueParentComponent);
        }
        return Array.from(new Set(result.filter(Boolean)));
    }

    function isMsgRecord(value) {
        return Boolean(value && typeof value === 'object' && (value.msgId || value.msgSeq) && Array.isArray(value.elements));
    }

    function getCurrentPeerFromAioComponents() {
        const roots = Array.from(document.querySelectorAll('.aio.vue-component, .aio')).slice(0, 4);
        for (const root of roots) {
            for (const instance of getVueInstances(root)) {
                for (const source of [
                    instance.props,
                    instance.proxy,
                    instance.ctx,
                    instance.setupState,
                    instance.proxy?.commonAioStore?.curAioData,
                    instance.ctx?.commonAioStore?.curAioData,
                    instance.proxy?.aioStore?.curAioData,
                    instance.ctx?.aioStore?.curAioData
                ]) {
                    const peer = normalizePeerFromAioData(source);
                    if (peer) {
                        return peer;
                    }
                }
            }
        }
        return null;
    }

    function getCurrentPeer() {
        return normalizePeerFromAioData(getCurrentAioData()) || getCurrentPeerFromAioComponents();
    }

    function compactText(element) {
        return String(element?.innerText || element?.textContent || '').replace(/\s+/g, '');
    }

    function isVoicePanelOpen() {
        const text = compactText(document.body);
        return VOICE_TEXTS.some(item => text.includes(item.replace(/\s+/g, '')));
    }

    function isVisible(element) {
        const rect = element?.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) {
            return false;
        }
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
    }

    function hasVoicePanelText(element) {
        const text = compactText(element);
        return VOICE_TEXTS.some(item => text.includes(item.replace(/\s+/g, '')));
    }

    function findVoicePanelFrom(element) {
        if (!isVoicePanelOpen()) {
            return null;
        }
        let current = element;
        for (let depth = 0; current && current !== document.documentElement && depth < 12; depth += 1) {
            if (VOICE_SELECTORS.some(selector => current.matches?.(selector)) && isVisible(current) && hasVoicePanelText(current)) {
                return current;
            }
            const rect = current.getBoundingClientRect?.();
            const compactEnough = rect && rect.width > 0 && rect.height > 0 && rect.width <= 1200 && rect.height <= 760;
            if (compactEnough && hasVoicePanelText(current)) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }

    function findVoicePanel() {
        if (!isVoicePanelOpen()) {
            return null;
        }
        const selectorTarget = document.querySelector('.audio-msg-input');
        if (selectorTarget && isVisible(selectorTarget) && hasVoicePanelText(selectorTarget)) {
            return selectorTarget;
        }
        const candidates = Array.from(document.querySelectorAll('div, section, main')).filter(element => {
            const rect = element.getBoundingClientRect?.();
            if (!rect || rect.width < 260 || rect.height < 90 || rect.width > 1300 || rect.height > 780) {
                return false;
            }
            return isVisible(element) && hasVoicePanelText(element);
        });
        candidates.sort((a, b) => {
            const aRect = a.getBoundingClientRect();
            const bRect = b.getBoundingClientRect();
            return (aRect.width * aRect.height) - (bRect.width * bRect.height);
        });
        return candidates[0] || null;
    }

    function getVoiceDropTarget(event) {
        const activePanel = findVoicePanel();
        if (!activePanel) {
            return null;
        }
        const targets = [];
        if (event?.target instanceof Element) {
            targets.push(event.target);
        }
        const pointTarget = document.elementFromPoint?.(event.clientX, event.clientY);
        if (pointTarget) {
            targets.push(pointTarget);
        }
        for (const target of targets) {
            const panel = findVoicePanelFrom(target);
            if (panel && (panel === activePanel || activePanel.contains(panel) || panel.contains(activePanel))) {
                return panel;
            }
        }
        return null;
    }

    function isMediaPath(filePath) {
        const name = String(filePath || '').toLowerCase();
        const index = name.lastIndexOf('.');
        return index >= 0 && MEDIA_EXTENSIONS.has(name.slice(index));
    }

    function getDropMediaPaths(dataTransfer) {
        return Array.from(dataTransfer?.files || [])
            .map(file => file.path)
            .filter(filePath => filePath && isMediaPath(filePath));
    }

    function isLikelySidebarElement(element) {
        const text = [
            element.id || '',
            String(element.className || ''),
            element.getAttribute?.('role') || '',
            element.getAttribute?.('aria-label') || ''
        ].join(' ');
        return /side|sidebar|right|member|notice|announcement|profile|detail|drawer|contact/i.test(text);
    }

    function getLibraryHostScore(element, trigger) {
        const rect = element.getBoundingClientRect?.();
        if (!rect || rect.width < 360 || rect.height < 260 || !isVisible(element) || isLikelySidebarElement(element)) {
            return Infinity;
        }
        const text = [
            element.id || '',
            String(element.className || ''),
            element.getAttribute?.('role') || ''
        ].join(' ');
        let score = rect.width * rect.height;
        if (/chat|aio|message|conversation|main|content|panel/i.test(text)) {
            score -= 100000;
        }
        if (/input|editor|toolbar|operation/i.test(text)) {
            score += 1000000;
        }
        if (trigger && !element.contains(trigger)) {
            score += 1000000;
        }
        return score;
    }

    function pickLibraryHost(candidates, trigger = null) {
        return candidates
            .filter(Boolean)
            .map(element => ({
                element,
                score: getLibraryHostScore(element, trigger)
            }))
            .filter(item => Number.isFinite(item.score))
            .sort((a, b) => a.score - b.score)[0]?.element || null;
    }

    function findLibraryHostFromTrigger(trigger) {
        if (!(trigger instanceof Element)) {
            return null;
        }
        const candidates = [];
        let current = trigger;
        for (let depth = 0; current && current !== document.documentElement && depth < 18; depth += 1) {
            candidates.push(current);
            current = current.parentElement;
        }
        return pickLibraryHost(candidates, trigger);
    }

    function findLibraryHost() {
        const bridge = getBridge();
        const triggerHost = findLibraryHostFromTrigger(bridge.lastLibraryTrigger);
        if (triggerHost) {
            return triggerHost;
        }
        const selectors = [
            '.group-chat',
            '.c2c-chat',
            '[class*="chat-main"]',
            '[class*="chat-content"]',
            '[class*="message-panel"]',
            '[class*="message-list"]',
            '.chat-panel',
            '.message-panel',
            '.aio.vue-component',
            '.aio'
        ];
        const candidates = selectors.flatMap(selector => Array.from(document.querySelectorAll(selector)));
        return pickLibraryHost(candidates);
    }

    function openLibraryPanel() {
        return libraryPanel?.open();
    }

    function closeLibraryPanel() {
        libraryPanel?.close();
    }

    function updateLibraryPanelPlacement() {
        libraryPanel?.updatePlacement();
    }

    function blockDocumentWhileLibraryOpen(event) {
        if (!libraryPanel?.isOpen()) {
            return;
        }
        if (event.type === 'keydown' && event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            libraryPanel.handleEscape();
            return;
        }
        if (libraryPanel.contains(event.target)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
    }
    function findVoiceLibraryTriggerFromEvent(event) {
        const selector = [
            '#id-func-bar-microphone_on',
            '[id*="microphone_on"]',
            '[aria-label="\u8bed\u97f3\u6d88\u606f"]',
            '[title="\u8bed\u97f3\u6d88\u606f"]',
            '[data-title="\u8bed\u97f3\u6d88\u606f"]'
        ].join(',');
        const path = (event.composedPath?.() || [])
            .filter(item => item instanceof Element)
            .slice(0, 16);
        for (const item of path) {
            const trigger = item.matches?.(selector) ? item : item.closest?.(selector);
            if (trigger?.closest?.('.chat-func-bar .func-bar-native, .chat-func-bar')) {
                return trigger;
            }
        }
        return null;
    }

    function openLibraryPanelDebounced() {
        if (!isVoiceFeatureEnabled()) {
            closeLibraryPanel();
            return;
        }
        const bridge = getBridge();
        const now = Date.now();
        if (bridge.lastLibraryOpenAt && now - bridge.lastLibraryOpenAt < 350) {
            return;
        }
        bridge.lastLibraryOpenAt = now;
        openLibraryPanel();
    }

    function flushActionQueue() {
        const bridge = getBridge();
        if (!bridge.resolve || bridge.queue.length === 0) {
            return;
        }
        const resolve = bridge.resolve;
        bridge.resolve = null;
        resolve(bridge.queue.shift());
    }

    function enqueueAction(action) {
        const bridge = getBridge();
        bridge.queue.push(action);
        flushActionQueue();
    }

    const panelBridge = getBridge();
    libraryPanel = panelBridge.panelController || voiceLibraryPanelFactory({
        cssText: voiceLibraryPanelCss,
        resolveHost: findLibraryHost,
        onAction: action => {
            const nextAction = { ...action };
            if (action.type === 'pick' || action.type === 'sendLibrary') {
                nextAction.peer = getCurrentPeer();
            }
            enqueueAction(nextAction);
        }
    });
    panelBridge.panelController = libraryPanel;

    const PTT_PATH_KEYS = new Set([
        'filepath', 'sourcepath', 'path', 'localpath', 'originpath', 'originfilepath', 'srcpath',
        'downloadpath', 'realpath', 'absolutepath', 'audiopath', 'voicepath', 'pttpath',
        'url', 'audiourl', 'voiceurl', 'ptturl'
    ]);
    const PTT_NAME_KEYS = new Set(['filename', 'name', 'originfilename', 'originalname', 'audioname', 'voicename', 'pttfilename']);
    const PTT_MD5_KEYS = new Set(['md5hexstr', 'md5', 'filemd5', 'md5str', 'filemd5hex', 'originmd5', 'originalmd5']);
    const PTT_DURATION_KEYS = new Set(['duration', 'voiceduration', 'durationseconds', 'seconds', 'second', 'time', 'playtime']);
    const PTT_DURATION_MS_KEYS = new Set(['durationms', 'durationmilliseconds', 'timems', 'playtimems']);
    const PTT_ID_KEYS = new Set(['fileuuid', 'filesubid', 'uuid', 'fileid', 'storeid', 'resid', 'resourceid']);

    function normalizeFieldText(value) {
        const text = String(value ?? '').trim();
        return text && text !== 'undefined' && text !== 'null' && text !== '0' ? text : '';
    }

    function normalizeFieldKey(key) {
        return String(key || '').replace(/[_\-\s]/g, '').toLowerCase();
    }

    function addUniqueText(list, value) {
        const text = normalizeFieldText(value);
        if (text && !list.includes(text)) {
            list.push(text);
        }
    }

    function collectFieldValues(value, keySet, results = [], depth = 0, seen = new WeakSet()) {
        if (value === undefined || value === null || depth > 7 || results.length > 24) {
            return results;
        }
        if (Array.isArray(value)) {
            for (const item of value.slice(0, 64)) {
                collectFieldValues(item, keySet, results, depth + 1, seen);
            }
            return results;
        }
        if (typeof value !== 'object' || value instanceof Element || value instanceof Uint8Array || value instanceof Map) {
            return results;
        }
        if (seen.has(value)) {
            return results;
        }
        seen.add(value);
        for (const [key, item] of Object.entries(value)) {
            if (!keySet.has(normalizeFieldKey(key)) || item === undefined || item === null || typeof item === 'object') {
                continue;
            }
            addUniqueText(results, item);
        }
        for (const item of Object.values(value)) {
            collectFieldValues(item, keySet, results, depth + 1, seen);
        }
        return results;
    }

    function firstFieldValue(roots, keySet) {
        for (const root of roots) {
            const values = collectFieldValues(root, keySet);
            if (values.length) {
                return values[0];
            }
        }
        return '';
    }

    function normalizeDurationSeconds(value, isMilliseconds = false) {
        const number = Number(value);
        if (!Number.isFinite(number) || number <= 0) {
            return 0;
        }
        if (isMilliseconds || number > 1000) {
            return Math.max(1, Math.ceil(number / 1000));
        }
        return Math.max(1, Math.ceil(number));
    }

    function firstDurationSeconds(roots) {
        for (const root of roots) {
            const msDuration = normalizeDurationSeconds(firstFieldValue([root], PTT_DURATION_MS_KEYS), true);
            if (msDuration) {
                return msDuration;
            }
            const duration = normalizeDurationSeconds(firstFieldValue([root], PTT_DURATION_KEYS));
            if (duration) {
                return duration;
            }
        }
        return 0;
    }

    function sanitizePttElement(pttElement) {
        if (!pttElement || typeof pttElement !== 'object') {
            return null;
        }
        const nested = pttElement.pttElement || pttElement;
        const roots = [nested, pttElement].filter(Boolean);
        const paths = [];
        const names = [];
        const ids = [];
        for (const root of roots) {
            collectFieldValues(root, PTT_PATH_KEYS, paths);
            collectFieldValues(root, PTT_NAME_KEYS, names);
            collectFieldValues(root, PTT_ID_KEYS, ids);
        }
        const ptt = {
            filePath: paths[0] || '',
            sourcePath: paths[1] || '',
            fileName: names[0] || '',
            md5HexStr: firstFieldValue(roots, PTT_MD5_KEYS),
            duration: firstDurationSeconds(roots),
            fileUuid: ids[0] || '',
            fileSubId: ids[1] || '',
            fileId: ids[2] || '',
            paths,
            names,
            ids
        };
        return ptt.filePath || ptt.fileName || ptt.md5HexStr || ptt.fileUuid || ptt.fileSubId || ptt.fileId ? ptt : null;
    }

    function getPttIdentity(ptt) {
        return ptt?.filePath ||
            ptt?.md5HexStr ||
            ptt?.fileName ||
            ptt?.fileUuid ||
            ptt?.fileSubId ||
            ptt?.fileId ||
            '';
    }

    function dedupePtts(items) {
        const result = [];
        const seen = new Set();
        for (const item of items || []) {
            const ptt = sanitizePttElement(item);
            const key = getPttIdentity(ptt);
            if (!key || seen.has(key)) {
                continue;
            }
            seen.add(key);
            result.push(ptt);
        }
        return result;
    }

    function collectPttElementsFromValue(value, results = [], depth = 0, seen = new WeakSet()) {
        if (!value || depth > 5 || results.length > 16) {
            return results;
        }
        if (Array.isArray(value)) {
            for (const item of value.slice(0, 32)) {
                collectPttElementsFromValue(item, results, depth + 1, seen);
            }
            return results;
        }
        if (typeof value !== 'object' || value instanceof Element || value instanceof Uint8Array || value instanceof Map) {
            return results;
        }
        if (seen.has(value)) {
            return results;
        }
        seen.add(value);
        if (Number(value.elementType) === 4 || value.pttElement) {
            const ptt = sanitizePttElement(value);
            if (ptt) {
                results.push(ptt);
            }
        }
        const priorityKeys = [
            'pttElement',
            'msgElements',
            'elements',
            'element',
            'msgElement',
            'records',
            'msgList',
            'payload',
            'message',
            'msg',
            'msgRecord',
            'item',
            'data',
            'result'
        ];
        for (const key of priorityKeys) {
            collectPttElementsFromValue(value[key], results, depth + 1, seen);
        }
        for (const [key, item] of Object.entries(value)) {
            if (priorityKeys.includes(key)) {
                continue;
            }
            collectPttElementsFromValue(item, results, depth + 1, seen);
        }
        return results;
    }

    function makePttForwardPlaceholder(record, ptt) {
        const duration = Math.max(1, Math.ceil(Number(ptt?.duration) || 1));
        return {
            ...record,
            msgType: 2,
            subMsgType: 1,
            elements: [{
                elementType: 1,
                elementId: '',
                textElement: {
                    content: `[\u8bed\u97f3] ${duration}\u2033`,
                    atType: 0,
                    atUid: '',
                    atNtUid: ''
                }
            }]
        };
    }

    function getPttFromRecord(record) {
        const ptts = [];
        collectPttElementsFromValue(record?.elements, ptts);
        return dedupePtts(ptts)[0] || null;
    }

    function prepareNativePttForwardContext(request) {
        const bridge = getBridge();
        restoreNativePttForwardContext(bridge.nativePttForwardState);
        const record = request.originalContext?.msgRecord;
        const ptt = getPttFromRecord(record);
        if (!isVoiceForwardInContextMenuEnabled() || !ptt || !isMsgRecord(record)) {
            return request;
        }
        const placeholderRecord = makePttForwardPlaceholder(record, ptt);
        const placeholderContext = { ...request.originalContext, msgRecord: placeholderRecord };
        bridge.nativePttForwardState = {
            active: true,
            menu: request.menu,
            originalContext: request.originalContext,
            originalRecord: record,
            placeholderContext,
            placeholderRecord,
            ptt,
            sourceMsgId: String(record.msgId || '')
        };
        return { ...request, context: placeholderContext };
    }

    function transformNativePttForwardItems(request) {
        const state = getBridge().nativePttForwardState;
        if (!state?.active || state.menu !== request.menu ||
            request.menu?.menuContext !== state.placeholderContext || !Array.isArray(request.items)) {
            return request;
        }
        const speechToText = request.items.find(item => Number(item?.type) === 15) || {
            type: 15,
            text: '\u8f6c\u6587\u5b57',
            icon: 'speech_to_text'
        };
        const forward = request.items.find(item => Number(item?.type) === 6) || {
            type: 6,
            text: '\u8f6c\u53d1',
            icon: 'one_by_one_forward'
        };
        return {
            ...request,
            items: [
                speechToText,
                forward,
                ...request.items.filter(item => ![1, 6, 15].includes(Number(item?.type)))
            ]
        };
    }

    function getPttContextMenuItems({ originalContext }) {
        const ptt = getPttFromRecord(originalContext?.msgRecord);
        if (!isVoiceSaveInContextMenuEnabled() || !ptt) {
            return [];
        }
        return [{
            type: 990102,
            text: '\u4fdd\u5b58',
            icon: 'download',
            when: () => true,
            handler: () => enqueueAction({ type: 'savePtt', ptt }),
            __qqntToolboxDescriptor: {
                id: 'toolbox:voice-save',
                label: '\u4fdd\u5b58\u8bed\u97f3',
                toolbox: true
            },
            __qqntToolboxInsertAfter: ['qq:\u6536\u85cf', 'qq:\u8f6c\u53d1']
        }];
    }

    function registerPttContextMenuExtension() {
        const bridge = getBridge();
        const service = window.__qqntToolboxMessageContextMenu;
        if (bridge.messageContextMenuExtensionRegistered || typeof service?.registerExtension !== 'function') {
            return false;
        }
        service.registerExtension({
            id: 'toolbox-voice-message-actions',
            beforeOpen: prepareNativePttForwardContext,
            transformItems: transformNativePttForwardItems,
            getItems: getPttContextMenuItems
        });
        bridge.messageContextMenuExtensionRegistered = true;
        return true;
    }

    function restoreNativePttForwardContext(state) {
        if (!state?.menu?._?.ctx || !state.originalContext) {
            return;
        }
        state.active = false;
        try {
            state.menu._.ctx.menuContext = state.originalContext;
        } catch {
        }
    }

    function handleNativePttForwardMenuClick(event) {
        const state = getBridge().nativePttForwardState;
        if (!state?.active) {
            return;
        }
        if (!isVoiceForwardInContextMenuEnabled()) {
            restoreNativePttForwardContext(state);
            return;
        }
        const item = event.composedPath?.().find(element =>
            element instanceof Element && element.matches?.('.q-context-menu-item')
        );
        if (!item) {
            return;
        }
        const label = compactText(item);
        if (label === '\u8f6c\u53d1') {
            enqueueAction({
                type: 'prepareNativePttForward',
                ptt: state.ptt,
                sourceMsgId: state.sourceMsgId
            });
            return;
        }
        restoreNativePttForwardContext(state);
    }

    function install() {
        if (window.__voiceFileSenderInstalled || window.__voiceFileSenderInstalling) {
            return;
        }
        window.__voiceFileSenderInstalling = true;
        document.addEventListener('dragover', event => {
            if (!isVoiceFeatureEnabled()) {
                return;
            }
            if (!getVoiceDropTarget(event) || getDropMediaPaths(event.dataTransfer).length === 0) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'copy';
        }, true);
        document.addEventListener('drop', event => {
            if (!isVoiceFeatureEnabled()) {
                return;
            }
            const panel = getVoiceDropTarget(event);
            const paths = getDropMediaPaths(event.dataTransfer);
            if (!panel || paths.length === 0) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            enqueueAction({
                type: 'drop',
                paths,
                peer: getCurrentPeer()
            });
        }, true);
        document.addEventListener('contextmenu', event => {
            if (!isVoiceFeatureEnabled()) {
                return;
            }
            const trigger = findVoiceLibraryTriggerFromEvent(event);
            if (trigger) {
                getBridge().lastLibraryTrigger = trigger;
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                openLibraryPanelDebounced();
            }
        }, true);
        document.addEventListener('click', handleNativePttForwardMenuClick, true);
        for (const eventName of ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'contextmenu', 'wheel', 'dragover', 'drop', 'keydown', 'keyup']) {
            document.addEventListener(eventName, blockDocumentWhileLibraryOpen, true);
        }
        window.addEventListener('resize', () => updateLibraryPanelPlacement(), true);
        window.addEventListener('scroll', () => updateLibraryPanelPlacement(), true);
        window.__voiceFileSenderInstalled = true;
        window.__voiceFileSenderInstalling = false;
    }

    const bridge = getBridge();
    bridge.enabled = window.__voiceFileSenderEnabled === true;
    bridge.saveInContextMenu = window.__voiceFileSenderSaveInContextMenuEnabled === true;
    bridge.forwardInContextMenu = window.__voiceFileSenderForwardInContextMenuEnabled === true;
    bridge.setEnabled = enabled => {
        bridge.enabled = enabled === true;
        if (!bridge.enabled) {
            closeLibraryPanel();
            restoreNativePttForwardContext(bridge.nativePttForwardState);
        }
    };
    bridge.setSaveInContextMenuEnabled = enabled => {
        bridge.saveInContextMenu = enabled === true;
    };
    bridge.setForwardInContextMenuEnabled = enabled => {
        bridge.forwardInContextMenu = enabled === true;
        if (!bridge.forwardInContextMenu) {
            restoreNativePttForwardContext(bridge.nativePttForwardState);
        }
    };
    bridge.setStatus = (text, options = {}) => libraryPanel.setStatus(text, options);
    bridge.setLibrary = payload => libraryPanel.setLibrary(payload);
    bridge.playPreview = payload => libraryPanel.playPreview(payload);
    registerPttContextMenuExtension();
    install();

    return new Promise(resolve => {
        const nextBridge = getBridge();
        nextBridge.resolve = resolve;
        flushActionQueue();
    });
}

module.exports = injectedVoiceFileSenderUi;
