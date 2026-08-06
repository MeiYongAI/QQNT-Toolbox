import { localStickerFileUrl } from './local-sticker-panel.js';

const EDITOR_ID = 'qqnt-toolbox-local-sticker-manager';
const STYLE_ID = 'qqnt-toolbox-local-sticker-manager-style';

function normalizeText(value) {
    return String(value ?? '').trim();
}

function createElement(tag, className = '', content = '') {
    const element = document.createElement(tag);
    if (className) {
        element.className = className;
    }
    if (content !== '') {
        element.textContent = content;
    }
    return element;
}

export function normalizeLocalStickerManagerPacks(store) {
    const packs = new Map();
    for (const value of Array.isArray(store?.stickerPacks) ? store.stickerPacks : []) {
        const dirPath = normalizeText(value?.dirPath);
        if (!dirPath || value?.recent === true || packs.has(dirPath)) {
            continue;
        }
        packs.set(dirPath, {
            dirPath,
            label: normalizeText(value?.label) || '未命名贴纸集',
            icon: normalizeText(value?.icon),
            count: Array.isArray(value?.stickers) ? value.stickers.length : 0,
            index: Number.isFinite(Number(value?.index)) ? Math.trunc(Number(value.index)) : 0
        });
    }
    return Array.from(packs.values()).sort((left, right) =>
        left.index - right.index || left.label.localeCompare(right.label, 'zh-CN', {
            numeric: true,
            sensitivity: 'base'
        })
    );
}

export function getLocalStickerPackInsertionIndex(rowMidpoints, pointerY) {
    const y = Number(pointerY);
    if (!Number.isFinite(y)) {
        return 0;
    }
    const points = Array.isArray(rowMidpoints) ? rowMidpoints : [];
    const index = points.findIndex(point => y < Number(point));
    return index < 0 ? points.length : index;
}

function parseCssColor(value) {
    const match = String(value || '').match(/^rgba?\(\s*(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)(?:\D+(\d*(?:\.\d+)?))?\s*\)$/i);
    return match ? {
        red: Number(match[1]),
        green: Number(match[2]),
        blue: Number(match[3]),
        alpha: match[4] === undefined || match[4] === '' ? 1 : Number(match[4])
    } : null;
}

function resolveOpaqueSurface(themeRoot, textColor) {
    for (let element = themeRoot; element instanceof Element; element = element.parentElement) {
        const parsed = parseCssColor(getComputedStyle(element).backgroundColor);
        if (parsed?.alpha >= 0.98) {
            return `rgb(${parsed.red}, ${parsed.green}, ${parsed.blue})`;
        }
    }
    const text = parseCssColor(textColor);
    return text && text.red + text.green + text.blue > 420 ? '#1f1f1f' : '#ffffff';
}

function ensureStyle() {
    const existing = document.getElementById(STYLE_ID);
    if (existing) {
        return existing.dataset.ready === 'true'
            ? Promise.resolve()
            : new Promise(resolve => {
                existing.addEventListener('load', resolve, { once: true });
                existing.addEventListener('error', resolve, { once: true });
            });
    }
    const link = document.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    link.href = new URL('./local-sticker-manager.css', import.meta.url).href;
    return new Promise(resolve => {
        const complete = () => {
            link.dataset.ready = 'true';
            resolve();
        };
        link.addEventListener('load', complete, { once: true });
        link.addEventListener('error', complete, { once: true });
        document.head.append(link);
    });
}

export function createLocalStickerManager(options = {}) {
    let previousFocus = null;
    let cleanup = null;
    let openRevision = 0;

    function close() {
        openRevision += 1;
        cleanup?.();
        cleanup = null;
        document.getElementById(EDITOR_ID)?.remove();
        if (previousFocus?.isConnected) {
            previousFocus.focus({ preventScroll: true });
        }
        previousFocus = null;
    }

    async function open(initialTab = 'packs', themeSource = null) {
        close();
        const revision = openRevision;
        await ensureStyle();
        if (revision !== openRevision) {
            return;
        }
        previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        let activeTab = ['packs', 'panel', 'telegram'].includes(initialTab) ? initialTab : 'packs';
        let pointerDrag = null;
        let autoScrollFrame = 0;
        let disposed = false;

        const layer = createElement('div');
        layer.id = EDITOR_ID;
        layer.tabIndex = -1;
        layer.setAttribute('role', 'dialog');
        layer.setAttribute('aria-modal', 'true');
        layer.setAttribute('aria-label', '本地贴纸管理');
        const themeRoot = themeSource?.closest?.('#qqnt-toolbox-settings, #qqnt-toolbox-panel');
        if (themeRoot instanceof Element) {
            const textColor = getComputedStyle(themeRoot).color;
            if (textColor) {
                layer.style.setProperty('--qlsm-text', textColor);
            }
            layer.style.setProperty('--qlsm-surface', resolveOpaqueSurface(themeRoot, textColor));
            layer.style.colorScheme = parseCssColor(textColor)?.red > 160 ? 'dark' : 'light';
        }

        const page = createElement('section', 'qlsm-page');
        const header = createElement('header', 'qlsm-header');
        const title = createElement('h2', 'qlsm-title', '本地贴纸管理');
        const closeButton = createElement('button', 'qlsm-close', '×');
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label', '关闭');
        header.append(title, closeButton);

        const tabs = createElement('div', 'qlsm-tabs');
        tabs.setAttribute('role', 'tablist');
        for (const [tabId, label] of [['packs', '贴纸集'], ['panel', '面板'], ['telegram', 'Telegram']]) {
            const tab = createElement('button', 'qlsm-tab', label);
            tab.type = 'button';
            tab.dataset.tab = tabId;
            tab.setAttribute('role', 'tab');
            tabs.append(tab);
        }

        const content = createElement('div', 'qlsm-content');
        const createConfigRow = (label, description, controlElement) => {
            const row = createElement('div', 'qlsm-config-row');
            const main = createElement('div', 'qlsm-config-main');
            const meta = createElement('div', 'qlsm-config-meta', description);
            main.append(
                createElement('div', 'qlsm-config-name', label),
                meta
            );
            const control = createElement('div', 'qlsm-config-control');
            control.append(controlElement);
            row.append(main, control);
            return { row, control, meta };
        };
        const createNumberControl = (label, minimum, maximum, suffix) => {
            const wrap = createElement('div', 'qlsm-number-control');
            const input = createElement('input', 'qlsm-input qlsm-number-input');
            input.type = 'number';
            input.min = String(minimum);
            input.max = String(maximum);
            input.step = '1';
            input.setAttribute('aria-label', label);
            wrap.append(input, createElement('span', 'qlsm-number-suffix', suffix));
            return { wrap, input };
        };

        const packPane = createElement('section', 'qlsm-pane qlsm-pack-pane');
        packPane.dataset.pane = 'packs';
        packPane.setAttribute('role', 'tabpanel');
        const directoryRow = createElement('div', 'qlsm-directory-row');
        const directoryMain = createElement('div', 'qlsm-directory-main');
        const directoryPath = createElement('div', 'qlsm-directory-path');
        directoryMain.append(
            createElement('div', 'qlsm-pane-title', '贴纸目录'),
            directoryPath
        );
        const directoryActions = createElement('div', 'qlsm-directory-actions');
        const openDirectory = createElement('button', 'qlsm-secondary', '打开');
        openDirectory.type = 'button';
        const changeDirectory = createElement('button', 'qlsm-secondary', '更改');
        changeDirectory.type = 'button';
        const refreshPacks = createElement('button', 'qlsm-secondary', '刷新');
        refreshPacks.type = 'button';
        directoryActions.append(openDirectory, changeDirectory, refreshPacks);
        directoryRow.append(directoryMain, directoryActions);
        const packIntro = createElement('div', 'qlsm-pane-intro');
        packIntro.append(
            createElement('div', 'qlsm-pane-title', '贴纸集排序'),
            createElement('div', 'qlsm-pane-meta', '拖动手柄调整面板底部的贴纸集顺序')
        );
        const packList = createElement('div', 'qlsm-pack-list qqnt-toolbox-scrollable');
        packList.setAttribute('role', 'list');
        const packFooter = createElement('footer', 'qlsm-pane-footer');
        const packStatus = createElement('div', 'qlsm-status');
        const saveOrder = createElement('button', 'qlsm-primary', '保存排序');
        saveOrder.type = 'button';
        saveOrder.disabled = true;
        packFooter.append(packStatus, saveOrder);
        packPane.append(directoryRow, packIntro, packList, packFooter);

        const panelPane = createElement('section', 'qlsm-pane qlsm-panel-pane');
        panelPane.dataset.pane = 'panel';
        panelPane.setAttribute('role', 'tabpanel');
        const panelForm = createElement(
            'form',
            'qlsm-form qlsm-panel-form qqnt-toolbox-scrollable'
        );
        const layoutSection = createElement('section', 'qlsm-form-section');
        layoutSection.append(createElement('div', 'qlsm-form-title', '面板布局'));
        const perRow = createNumberControl('每行贴纸', 3, 10, '个');
        const panelWidth = createNumberControl('面板宽度', 280, 520, 'px');
        const panelHeight = createNumberControl('面板高度', 260, 640, 'px');
        const layoutGrid = createElement('div', 'qlsm-layout-grid');
        for (const [label, range, control] of [
            ['每行贴纸', '3–10', perRow],
            ['面板宽度', '280–520', panelWidth],
            ['面板高度', '260–640', panelHeight]
        ]) {
            const field = createElement('div', 'qlsm-layout-field');
            const heading = createElement('div', 'qlsm-layout-heading');
            heading.append(
                createElement('span', 'qlsm-layout-label', label),
                createElement('span', 'qlsm-layout-range', range)
            );
            field.append(heading, control.wrap);
            layoutGrid.append(field);
        }
        layoutSection.append(layoutGrid);
        const behaviorSection = createElement('section', 'qlsm-form-section');
        behaviorSection.append(createElement('div', 'qlsm-form-title', '使用方式'));
        const sendMode = createElement('div', 'qlsm-segmented');
        sendMode.setAttribute('role', 'radiogroup');
        sendMode.setAttribute('aria-label', '发送形式');
        for (const [value, label] of [['sticker', '贴纸'], ['image', '图片']]) {
            const button = createElement('button', 'qlsm-segment', label);
            button.type = 'button';
            button.dataset.sendMode = value;
            button.setAttribute('role', 'radio');
            sendMode.append(button);
        }
        const recentToggle = createElement('button', 'qlsm-toggle');
        recentToggle.type = 'button';
        recentToggle.setAttribute('role', 'switch');
        recentToggle.setAttribute('aria-label', '显示最近使用');
        const directSendMode = createElement('div', 'qlsm-segmented');
        directSendMode.setAttribute('role', 'radiogroup');
        directSendMode.setAttribute('aria-label', '直接发送方式');
        for (const [value, label] of [['alt', 'Alt + 单击'], ['click', '单击']]) {
            const button = createElement('button', 'qlsm-segment', label);
            button.type = 'button';
            button.dataset.directSendMode = value;
            button.setAttribute('role', 'radio');
            directSendMode.append(button);
        }
        const recentRows = createNumberControl('最近使用行数', 1, 6, '行');
        const recentControls = createElement('div', 'qlsm-recent-controls');
        recentControls.append(recentRows.wrap, recentToggle);
        const panelStatus = createElement('div', 'qlsm-status qlsm-panel-status');
        behaviorSection.append(
            createConfigRow('发送形式', '贴纸消息或普通图片', sendMode).row,
            createConfigRow('直接发送方式', '本地贴纸与 QQ 非默认表情', directSendMode).row,
            createConfigRow('最近使用', '在贴纸包栏显示最近使用', recentControls).row,
            panelStatus
        );
        panelForm.append(layoutSection, behaviorSection);
        panelPane.append(panelForm);

        const telegramPane = createElement('section', 'qlsm-pane qlsm-telegram-pane');
        telegramPane.dataset.pane = 'telegram';
        telegramPane.setAttribute('role', 'tabpanel');
        const form = createElement('form', 'qlsm-form qqnt-toolbox-scrollable');
        const downloadSection = createElement('section', 'qlsm-form-section');
        downloadSection.append(
            createElement('div', 'qlsm-form-title', '下载贴纸包'),
            createElement('div', 'qlsm-form-meta', '支持 t.me/addstickers 链接；下载后直接加入当前贴纸目录')
        );
        const urlRow = createElement('div', 'qlsm-download-row');
        const urlInput = createElement('input', 'qlsm-input');
        urlInput.type = 'url';
        urlInput.placeholder = 'https://t.me/addstickers/...';
        urlInput.autocomplete = 'off';
        urlInput.spellcheck = false;
        urlInput.setAttribute('aria-label', 'Telegram 贴纸包链接');
        const downloadButton = createElement('button', 'qlsm-primary', '下载');
        downloadButton.type = 'submit';
        urlRow.append(urlInput, downloadButton);
        const downloadStatus = createElement('div', 'qlsm-status qlsm-download-status');
        downloadSection.append(urlRow, downloadStatus);

        const configSection = createElement('section', 'qlsm-form-section qlsm-config-section');
        const tokenInput = createElement('input', 'qlsm-input qlsm-config-input');
        tokenInput.type = 'password';
        tokenInput.autocomplete = 'off';
        tokenInput.maxLength = 256;
        tokenInput.setAttribute('aria-label', 'Telegram Bot Token');
        const tokenRow = createConfigRow('Bot Token', '在 Telegram 中通过 @BotFather 获取，仅保存在本地', tokenInput);

        const ffmpegInput = createElement('input', 'qlsm-input qlsm-path-input');
        ffmpegInput.type = 'text';
        ffmpegInput.placeholder = '自动检测 PATH';
        ffmpegInput.autocomplete = 'off';
        ffmpegInput.spellcheck = false;
        ffmpegInput.setAttribute('aria-label', 'FFmpeg 路径');
        const ffmpegRow = createConfigRow('FFmpeg 路径', '留空时自动从 PATH 查找；用于视频贴纸', ffmpegInput);
        const chooseFfmpeg = createElement('button', 'qlsm-secondary', '选择');
        chooseFfmpeg.type = 'button';
        chooseFfmpeg.dataset.chooseTool = 'ffmpeg';
        const downloadFfmpeg = createElement('button', 'qlsm-secondary', '下载');
        downloadFfmpeg.type = 'button';
        downloadFfmpeg.dataset.downloadTool = 'ffmpeg';
        ffmpegRow.control.append(chooseFfmpeg, downloadFfmpeg);

        const tgsInput = createElement('input', 'qlsm-input qlsm-path-input');
        tgsInput.type = 'text';
        tgsInput.placeholder = '自动检测 PATH';
        tgsInput.autocomplete = 'off';
        tgsInput.spellcheck = false;
        tgsInput.setAttribute('aria-label', 'tgsToGif 路径');
        const tgsRow = createConfigRow('tgsToGif 路径', '留空时自动从 PATH 查找；仅用于 TGS 动画贴纸', tgsInput);
        const chooseTgs = createElement('button', 'qlsm-secondary', '选择');
        chooseTgs.type = 'button';
        chooseTgs.dataset.chooseTool = 'tgsToGif';
        const downloadTgs = createElement('button', 'qlsm-secondary', '下载');
        downloadTgs.type = 'button';
        downloadTgs.dataset.downloadTool = 'tgsToGif';
        tgsRow.control.append(chooseTgs, downloadTgs);

        const toolSection = createElement('section', 'qlsm-tool-section');
        const toolTitle = createElement('h3', 'qlsm-tool-title', '转换工具');
        const toolBody = createElement('div', 'qlsm-tool-body');
        toolBody.append(ffmpegRow.row, tgsRow.row);
        toolSection.append(toolTitle, toolBody);
        configSection.append(tokenRow.row, toolSection);
        form.append(downloadSection, configSection);
        telegramPane.append(form);

        content.append(packPane, panelPane, telegramPane);
        page.append(header, tabs, content);
        layer.append(page);
        document.body.append(layer);

        const setStatus = (element, message = '', state = '') => {
            element.textContent = normalizeText(message);
            if (state) {
                element.dataset.state = state;
            } else {
                delete element.dataset.state;
            }
        };

        const syncTabs = () => {
            tabs.querySelectorAll('.qlsm-tab[data-tab]').forEach(tab => {
                const selected = tab.dataset.tab === activeTab;
                tab.dataset.active = String(selected);
                tab.setAttribute('aria-selected', String(selected));
                tab.tabIndex = selected ? 0 : -1;
            });
            content.querySelectorAll('.qlsm-pane[data-pane]').forEach(pane => {
                pane.hidden = pane.dataset.pane !== activeTab;
            });
        };

        const readConfig = () => {
            const config = options.getConfig?.() || {};
            const stickerPath = normalizeText(config.path);
            directoryPath.textContent = stickerPath || '尚未配置目录';
            directoryPath.title = stickerPath;
            perRow.input.value = String(config.stickersPerRow ?? 6);
            panelWidth.input.value = String(config.panelWidth ?? 350);
            panelHeight.input.value = String(config.panelHeight ?? 420);
            sendMode.querySelectorAll('.qlsm-segment[data-send-mode]').forEach(button => {
                const selected = button.dataset.sendMode === (config.sendAsImage ? 'image' : 'sticker');
                button.dataset.active = String(selected);
                button.setAttribute('aria-checked', String(selected));
            });
            const selectedDirectSendMode = config.directSendMode === 'click' ? 'click' : 'alt';
            directSendMode.querySelectorAll('.qlsm-segment[data-direct-send-mode]').forEach(button => {
                const selected = button.dataset.directSendMode === selectedDirectSendMode;
                button.dataset.active = String(selected);
                button.setAttribute('aria-checked', String(selected));
            });
            const recentEnabled = config.recentEnabled !== false;
            recentToggle.dataset.checked = String(recentEnabled);
            recentToggle.setAttribute('aria-checked', String(recentEnabled));
            recentRows.input.value = String(config.recentRows ?? 2);
            recentRows.input.disabled = !recentEnabled;
            recentRows.wrap.dataset.disabled = String(!recentEnabled);
            tokenInput.value = normalizeText(config.telegramBotToken);
            ffmpegInput.value = normalizeText(config.ffmpegPath);
            tgsInput.value = normalizeText(config.tgsToGifPath);
        };

        let environmentRevision = 0;
        const describeTool = (row, tool, configured, fallback) => {
            row.meta.title = normalizeText(tool?.path);
            if (configured) {
                row.meta.textContent = tool?.available === false
                    ? '所选路径不可用'
                    : '使用所选的可执行文件';
                return;
            }
            if (tool?.available) {
                const fileName = normalizeText(tool.path).split(/[\\/]/).pop() || tool.label || '可执行文件';
                row.meta.textContent = `已从 PATH 检测到 ${fileName}`;
                return;
            }
            row.meta.textContent = fallback;
        };

        const inspectEnvironment = async () => {
            const revision = ++environmentRevision;
            const result = await options.inspectEnvironment?.();
            if (disposed || revision !== environmentRevision || result?.ok !== true) {
                return;
            }
            describeTool(
                ffmpegRow,
                result.tools?.ffmpeg,
                Boolean(ffmpegInput.value.trim()),
                '未在 PATH 中检测到；下载视频贴纸时需要'
            );
            describeTool(
                tgsRow,
                result.tools?.tgsToGif,
                Boolean(tgsInput.value.trim()),
                '未在 PATH 中检测到；仅影响 TGS 动画贴纸'
            );
        };

        const renderPacks = packs => {
            packList.replaceChildren();
            if (!packs.length) {
                packList.append(createElement('div', 'qlsm-empty', '当前目录中没有可排序的贴纸集'));
                saveOrder.disabled = true;
                return;
            }
            const fragment = document.createDocumentFragment();
            for (const pack of packs) {
                const row = createElement('div', 'qlsm-pack-row');
                row.dataset.packPath = pack.dirPath;
                row.setAttribute('role', 'listitem');
                const handle = createElement('button', 'qlsm-drag-handle');
                handle.type = 'button';
                handle.setAttribute('aria-label', `${pack.label} 拖动排序`);
                const image = createElement('img', 'qlsm-pack-image');
                image.alt = '';
                image.src = localStickerFileUrl(pack.icon);
                image.addEventListener('error', () => image.dataset.error = 'true', { once: true });
                const details = createElement('div', 'qlsm-pack-details');
                const name = createElement('div', 'qlsm-pack-name', pack.label);
                const meta = createElement('div', 'qlsm-pack-meta', `${pack.count} 个贴纸`);
                meta.title = pack.dirPath;
                details.append(name, meta);
                row.append(handle, image, details);
                fragment.append(row);
            }
            packList.append(fragment);
            saveOrder.disabled = true;
            setStatus(packStatus, `${packs.length} 个贴纸集`);
        };

        const loadPacks = async () => {
            packList.replaceChildren(createElement('div', 'qlsm-empty', '正在读取贴纸集'));
            try {
                const store = await options.getStore?.({ force: true });
                if (disposed) {
                    return;
                }
                renderPacks(normalizeLocalStickerManagerPacks(store));
                if (store?.status !== 'success') {
                    setStatus(packStatus, store?.msg || '贴纸集读取失败', 'error');
                }
            } catch (error) {
                if (!disposed) {
                    renderPacks([]);
                    setStatus(packStatus, error?.message || '贴纸集读取失败', 'error');
                }
            }
        };

        openDirectory.addEventListener('click', async () => {
            openDirectory.disabled = true;
            try {
                const result = await options.openDirectory?.();
                if (result?.ok !== true) {
                    throw new Error(result?.reason || '贴纸目录打开失败');
                }
            } catch (error) {
                setStatus(packStatus, error?.message || '贴纸目录打开失败', 'error');
            } finally {
                openDirectory.disabled = false;
            }
        });

        changeDirectory.addEventListener('click', async () => {
            changeDirectory.disabled = true;
            try {
                const result = await options.chooseDirectory?.();
                if (!result?.ok || !result.path) {
                    if (!result?.canceled) {
                        throw new Error(result?.reason || '贴纸目录更改失败');
                    }
                    return;
                }
                await options.saveSettings?.({ path: result.path });
                readConfig();
                await loadPacks();
            } catch (error) {
                setStatus(packStatus, error?.message || '贴纸目录更改失败', 'error');
            } finally {
                changeDirectory.disabled = false;
            }
        });

        refreshPacks.addEventListener('click', async () => {
            refreshPacks.disabled = true;
            try {
                await loadPacks();
            } finally {
                refreshPacks.disabled = false;
            }
        });

        const moveRow = (row, direction) => {
            if (direction === 'up') {
                row.previousElementSibling?.before(row);
            } else {
                row.nextElementSibling?.after(row);
            }
            saveOrder.disabled = false;
            setStatus(packStatus, '排序尚未保存', 'pending');
            row.scrollIntoView?.({ block: 'nearest' });
        };

        const updatePointerDrag = clientY => {
            if (!pointerDrag?.started) {
                return;
            }
            pointerDrag.clientY = clientY;
            pointerDrag.ghost.style.transform = `translate3d(0, ${clientY - pointerDrag.startY}px, 0)`;
            const rows = Array.from(packList.querySelectorAll('.qlsm-pack-row'))
                .filter(row => row !== pointerDrag.row);
            const insertionIndex = getLocalStickerPackInsertionIndex(rows.map(row => {
                const rect = row.getBoundingClientRect();
                return rect.top + rect.height / 2;
            }), clientY);
            const target = rows[insertionIndex] || null;
            if (target && pointerDrag.row.nextElementSibling !== target) {
                packList.insertBefore(pointerDrag.row, target);
            } else if (!target && pointerDrag.row !== packList.lastElementChild) {
                packList.append(pointerDrag.row);
            }
        };

        const runAutoScroll = () => {
            if (!pointerDrag?.started) {
                autoScrollFrame = 0;
                return;
            }
            const rect = packList.getBoundingClientRect();
            const edge = 48;
            let delta = 0;
            if (pointerDrag.clientY < rect.top + edge) {
                delta = -Math.ceil((rect.top + edge - pointerDrag.clientY) / 4);
            } else if (pointerDrag.clientY > rect.bottom - edge) {
                delta = Math.ceil((pointerDrag.clientY - rect.bottom + edge) / 4);
            }
            if (delta) {
                packList.scrollTop += Math.max(-18, Math.min(18, delta));
                updatePointerDrag(pointerDrag.clientY);
            }
            autoScrollFrame = requestAnimationFrame(runAutoScroll);
        };

        const startPointerDrag = () => {
            if (!pointerDrag || pointerDrag.started) {
                return;
            }
            const rect = pointerDrag.row.getBoundingClientRect();
            const ghost = pointerDrag.row.cloneNode(true);
            ghost.classList.add('qlsm-drag-ghost');
            ghost.setAttribute('aria-hidden', 'true');
            ghost.querySelectorAll('button').forEach(button => button.tabIndex = -1);
            Object.assign(ghost.style, {
                left: `${rect.left}px`,
                top: `${rect.top}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`
            });
            layer.append(ghost);
            pointerDrag.started = true;
            pointerDrag.ghost = ghost;
            pointerDrag.row.dataset.dragging = 'true';
            packList.dataset.dragging = 'true';
            autoScrollFrame = requestAnimationFrame(runAutoScroll);
        };

        const finishPointerDrag = () => {
            const drag = pointerDrag;
            pointerDrag = null;
            if (!drag) {
                return;
            }
            drag.handle.releasePointerCapture?.(drag.pointerId);
            if (autoScrollFrame) {
                cancelAnimationFrame(autoScrollFrame);
                autoScrollFrame = 0;
            }
            drag.ghost?.remove();
            drag.row.removeAttribute('data-dragging');
            packList.removeAttribute('data-dragging');
            if (drag.started) {
                saveOrder.disabled = false;
                setStatus(packStatus, '排序尚未保存', 'pending');
            }
        };

        packList.addEventListener('pointerdown', event => {
            const handle = event.target.closest?.('.qlsm-drag-handle');
            const row = handle?.closest?.('.qlsm-pack-row');
            if (!handle || !row || event.button !== 0 || pointerDrag) {
                return;
            }
            pointerDrag = {
                pointerId: event.pointerId,
                handle,
                row,
                startX: event.clientX,
                startY: event.clientY,
                clientY: event.clientY,
                started: false,
                ghost: null
            };
            handle.setPointerCapture?.(event.pointerId);
            event.preventDefault();
        });
        packList.addEventListener('pointermove', event => {
            if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) {
                return;
            }
            if (!pointerDrag.started && Math.hypot(
                event.clientX - pointerDrag.startX,
                event.clientY - pointerDrag.startY
            ) >= 4) {
                startPointerDrag();
            }
            if (pointerDrag.started) {
                updatePointerDrag(event.clientY);
                event.preventDefault();
            }
        });
        packList.addEventListener('pointerup', event => {
            if (pointerDrag?.pointerId === event.pointerId) {
                finishPointerDrag();
            }
        });
        packList.addEventListener('pointercancel', event => {
            if (pointerDrag?.pointerId === event.pointerId) {
                finishPointerDrag();
            }
        });
        packList.addEventListener('keydown', event => {
            const handle = event.target.closest?.('.qlsm-drag-handle');
            const row = handle?.closest?.('.qlsm-pack-row');
            if (!handle || !row || !['ArrowUp', 'ArrowDown'].includes(event.key)) {
                return;
            }
            event.preventDefault();
            moveRow(row, event.key === 'ArrowUp' ? 'up' : 'down');
            handle.focus({ preventScroll: true });
        });

        saveOrder.addEventListener('click', async () => {
            finishPointerDrag();
            saveOrder.disabled = true;
            setStatus(packStatus, '正在保存排序', 'pending');
            try {
                const packPaths = Array.from(packList.querySelectorAll('.qlsm-pack-row[data-pack-path]'))
                    .map(row => row.dataset.packPath)
                    .filter(Boolean);
                const result = await options.saveOrder?.(packPaths);
                if (result?.ok !== true) {
                    throw new Error(result.msg || result.reason || '排序保存失败');
                }
                renderPacks(normalizeLocalStickerManagerPacks(result?.store));
                setStatus(packStatus, '排序已保存', 'success');
            } catch (error) {
                saveOrder.disabled = false;
                setStatus(packStatus, error?.message || '排序保存失败', 'error');
            }
        });

        const saveSettings = patch => options.saveSettings?.(patch);
        const savePanelSettings = async patch => {
            setStatus(panelStatus, '正在保存', 'pending');
            try {
                await saveSettings(patch);
                readConfig();
                setStatus(panelStatus, '已保存', 'success');
            } catch (error) {
                setStatus(panelStatus, error?.message || '面板设置保存失败', 'error');
            }
        };
        for (const [input, key, minimum, maximum] of [
            [perRow.input, 'stickersPerRow', 3, 10],
            [panelWidth.input, 'panelWidth', 280, 520],
            [panelHeight.input, 'panelHeight', 260, 640],
            [recentRows.input, 'recentRows', 1, 6]
        ]) {
            input.addEventListener('change', () => {
                const value = Math.min(maximum, Math.max(minimum, Math.round(Number(input.value)) || minimum));
                input.value = String(value);
                savePanelSettings({ [key]: value });
            });
        }
        sendMode.addEventListener('click', event => {
            const button = event.target.closest?.('.qlsm-segment[data-send-mode]');
            if (!button) {
                return;
            }
            savePanelSettings({ sendAsImage: button.dataset.sendMode === 'image' });
        });
        directSendMode.addEventListener('click', event => {
            const button = event.target.closest?.('.qlsm-segment[data-direct-send-mode]');
            if (!button) {
                return;
            }
            savePanelSettings({ directSendMode: button.dataset.directSendMode });
        });
        recentToggle.addEventListener('click', () => {
            savePanelSettings({ recentEnabled: recentToggle.dataset.checked !== 'true' });
        });
        panelForm.addEventListener('submit', event => event.preventDefault());

        for (const [input, key] of [
            [tokenInput, 'telegramBotToken'],
            [ffmpegInput, 'ffmpegPath'],
            [tgsInput, 'tgsToGifPath']
        ]) {
            input.addEventListener('change', async () => {
                try {
                    await saveSettings?.({ [key]: input.value.trim() });
                    if (input !== tokenInput) {
                        await inspectEnvironment();
                    }
                } catch (error) {
                    setStatus(downloadStatus, error?.message || '下载配置保存失败', 'error');
                }
            });
        }

        configSection.addEventListener('click', async event => {
            const downloadToolButton = event.target.closest?.('.qlsm-secondary[data-download-tool]');
            if (downloadToolButton && !downloadToolButton.disabled) {
                downloadToolButton.disabled = true;
                try {
                    const result = await options.openToolDownload?.(downloadToolButton.dataset.downloadTool);
                    if (result?.ok === false) {
                        throw new Error(result.reason || '下载页面打开失败');
                    }
                } catch (error) {
                    setStatus(downloadStatus, error?.message || '下载页面打开失败', 'error');
                } finally {
                    downloadToolButton.disabled = false;
                }
                return;
            }
            const toolButton = event.target.closest?.('.qlsm-secondary[data-choose-tool]');
            if (!toolButton || toolButton.disabled) {
                return;
            }
            toolButton.disabled = true;
            try {
                const result = await options.chooseTool?.(toolButton.dataset.chooseTool);
                if (result?.ok && result.path) {
                    const input = toolButton.dataset.chooseTool === 'ffmpeg' ? ffmpegInput : tgsInput;
                    const key = toolButton.dataset.chooseTool === 'ffmpeg' ? 'ffmpegPath' : 'tgsToGifPath';
                    input.value = result.path;
                    await saveSettings?.({ [key]: result.path });
                    await inspectEnvironment();
                }
            } catch (error) {
                setStatus(downloadStatus, error?.message || '工具路径选择失败', 'error');
            } finally {
                toolButton.disabled = false;
            }
        });

        form.addEventListener('submit', async event => {
            event.preventDefault();
            if (downloadButton.disabled) {
                return;
            }
            downloadButton.disabled = true;
            setStatus(downloadStatus, '正在下载并转换贴纸，请稍候', 'pending');
            try {
                await saveSettings?.({
                    telegramBotToken: tokenInput.value.trim(),
                    ffmpegPath: ffmpegInput.value.trim(),
                    tgsToGifPath: tgsInput.value.trim()
                });
                const result = await options.download?.(urlInput.value.trim());
                if (result?.ok !== true) {
                    throw new Error(result.msg || result.reason || '贴纸包下载失败');
                }
                setStatus(downloadStatus, `${result?.packName || '贴纸包'}：${result?.msg || '下载完成'}`, 'success');
            } catch (error) {
                setStatus(downloadStatus, error?.message || '贴纸包下载失败', 'error');
            } finally {
                downloadButton.disabled = false;
            }
        });

        tabs.addEventListener('click', event => {
            const tab = event.target.closest?.('.qlsm-tab[data-tab]');
            if (!tab) {
                return;
            }
            activeTab = tab.dataset.tab;
            syncTabs();
            if (activeTab === 'telegram') {
                inspectEnvironment().catch(() => {});
            }
        });
        tabs.addEventListener('keydown', event => {
            const tab = event.target.closest?.('.qlsm-tab[data-tab]');
            if (!tab || !['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                return;
            }
            const tabButtons = Array.from(tabs.querySelectorAll('.qlsm-tab[data-tab]'));
            const direction = event.key === 'ArrowRight' ? 1 : -1;
            const next = tabButtons[(tabButtons.indexOf(tab) + direction + tabButtons.length) % tabButtons.length];
            event.preventDefault();
            next?.click();
            next?.focus();
        });
        closeButton.addEventListener('click', close);
        layer.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
            }
        });
        cleanup = () => {
            disposed = true;
            finishPointerDrag();
        };
        readConfig();
        syncTabs();
        if (activeTab === 'telegram') {
            inspectEnvironment().catch(() => {});
        }
        loadPacks().catch(() => {});
        layer.focus({ preventScroll: true });
    }

    return Object.freeze({ close, open });
}
