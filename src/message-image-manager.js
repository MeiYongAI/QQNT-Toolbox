const MANAGER_ID = 'qqnt-toolbox-message-image-manager';
const STYLE_ID = 'qqnt-toolbox-message-image-manager-style';

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

export function messageImageFileUrl(filePath) {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    const encoded = normalized.split('/').map(part =>
        encodeURIComponent(part).replace(/%3A/gi, ':')
    ).join('/');
    return `local:///${encoded}`;
}

export function filterMessageImageManagerImages(images, categoryId) {
    const values = Array.isArray(images) ? images : [];
    if (categoryId === 'all') {
        return values;
    }
    if (categoryId === 'uncategorized') {
        return values.filter(image => !image?.categoryId);
    }
    return values.filter(image => image?.categoryId === categoryId);
}

function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function formatDate(value) {
    const date = new Date(Number(value));
    if (!Number.isFinite(date.getTime())) {
        return '';
    }
    return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
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
    return text && text.red + text.green + text.blue > 420 ? '#202124' : '#ffffff';
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
    link.href = new URL('./message-image-manager.css', import.meta.url).href;
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

const ERROR_MESSAGES = Object.freeze({
    'category-name-empty': '请输入分类名称',
    'category-name-conflict': '已经存在同名分类',
    'category-not-found': '分类已不存在，请刷新后重试',
    'image-selection-empty': '请先选择图片',
    'image-name-empty': '请输入图片名称',
    'image-name-conflict': '已经存在同名图片',
    'image-not-found': '图片已不存在，请刷新后重试',
    'image-order-invalid': '图片列表已变化，请刷新后重试',
    'clipboard-unavailable': '图片复制不可用',
    'shell-unavailable': '无法打开图片目录'
});

export function createMessageImageManager(options = {}) {
    let previousFocus = null;
    let cleanup = null;
    let openRevision = 0;

    function close() {
        openRevision += 1;
        cleanup?.();
        cleanup = null;
        document.getElementById(MANAGER_ID)?.remove();
        if (previousFocus?.isConnected) {
            previousFocus.focus({ preventScroll: true });
        }
        previousFocus = null;
    }

    async function open(themeSource = null) {
        close();
        const revision = openRevision;
        await ensureStyle();
        if (revision !== openRevision) {
            return;
        }
        previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        let state = { ok: true, directory: '', categories: [], images: [], totalCount: 0 };
        let activeCategoryId = 'all';
        let selectedIds = new Set();
        let busy = false;
        let drag = null;
        let dialogResolve = null;
        let disposed = false;
        let statusTimer = 0;
        let suppressCardClickUntil = 0;

        const layer = createElement('div');
        layer.id = MANAGER_ID;
        layer.tabIndex = -1;
        layer.setAttribute('role', 'dialog');
        layer.setAttribute('aria-modal', 'true');
        layer.setAttribute('aria-label', '消息图片管理');
        const themeRoot = themeSource?.closest?.('#qqnt-toolbox-settings, #qqnt-toolbox-panel');
        if (themeRoot instanceof Element) {
            const textColor = getComputedStyle(themeRoot).color;
            if (textColor) {
                layer.style.setProperty('--qmim-text', textColor);
            }
            layer.style.setProperty('--qmim-surface', resolveOpaqueSurface(themeRoot, textColor));
            layer.style.colorScheme = parseCssColor(textColor)?.red > 160 ? 'dark' : 'light';
        }

        const page = createElement('section', 'qmim-page');
        const header = createElement('header', 'qmim-header');
        const headerTitle = createElement('div', 'qmim-heading');
        headerTitle.append(
            createElement('h2', 'qmim-title', '消息图片管理'),
            createElement('span', 'qmim-total')
        );
        const headerActions = createElement('div', 'qmim-header-actions');
        const openDirectoryButton = createElement('button', 'qmim-button', '打开目录');
        const refreshButton = createElement('button', 'qmim-button', '刷新');
        const closeButton = createElement('button', 'qmim-close', '×');
        for (const button of [openDirectoryButton, refreshButton, closeButton]) {
            button.type = 'button';
        }
        closeButton.setAttribute('aria-label', '关闭');
        headerActions.append(openDirectoryButton, refreshButton, closeButton);
        header.append(headerTitle, headerActions);

        const body = createElement('div', 'qmim-body');
        const sidebar = createElement('aside', 'qmim-sidebar');
        const categoryHeader = createElement('div', 'qmim-category-header');
        const addCategoryButton = createElement('button', 'qmim-icon-button', '+');
        addCategoryButton.type = 'button';
        addCategoryButton.title = '新建分类';
        addCategoryButton.setAttribute('aria-label', '新建分类');
        categoryHeader.append(createElement('div', 'qmim-sidebar-title', '分类'), addCategoryButton);
        const categoryList = createElement('div', 'qmim-category-list');
        categoryList.setAttribute('role', 'listbox');
        categoryList.setAttribute('aria-label', '图片分类');
        const categoryControls = createElement('div', 'qmim-category-controls');
        const moveCategoryUp = createElement('button', 'qmim-quiet-button', '上移');
        const moveCategoryDown = createElement('button', 'qmim-quiet-button', '下移');
        const renameCategory = createElement('button', 'qmim-quiet-button', '重命名');
        const deleteCategory = createElement('button', 'qmim-quiet-button qmim-danger-text', '删除');
        for (const button of [moveCategoryUp, moveCategoryDown, renameCategory, deleteCategory]) {
            button.type = 'button';
        }
        categoryControls.append(moveCategoryUp, moveCategoryDown, renameCategory, deleteCategory);
        sidebar.append(categoryHeader, categoryList, categoryControls);

        const main = createElement('main', 'qmim-main');
        const toolbar = createElement('div', 'qmim-toolbar');
        const selectionSummary = createElement('div', 'qmim-selection-summary', '未选择图片');
        const toolbarActions = createElement('div', 'qmim-toolbar-actions');
        const viewButton = createElement('button', 'qmim-button', '查看');
        const copyButton = createElement('button', 'qmim-button', '复制');
        const renameButton = createElement('button', 'qmim-button', '重命名');
        const categoryAction = createElement('div', 'qmim-category-action');
        const assignButton = createElement('button', 'qmim-button', '移动到分类');
        const categoryMenu = createElement('div', 'qmim-category-menu');
        assignButton.type = 'button';
        categoryMenu.hidden = true;
        categoryAction.append(assignButton, categoryMenu);
        const deleteButton = createElement('button', 'qmim-button qmim-danger-text', '删除');
        for (const button of [viewButton, copyButton, renameButton, deleteButton]) {
            button.type = 'button';
        }
        toolbarActions.append(viewButton, copyButton, renameButton, categoryAction, deleteButton);
        toolbar.append(selectionSummary, toolbarActions);
        const grid = createElement('div', 'qmim-grid');
        grid.setAttribute('role', 'listbox');
        grid.setAttribute('aria-multiselectable', 'true');
        grid.setAttribute('aria-label', '消息图片');
        const footer = createElement('footer', 'qmim-footer');
        const directoryLabel = createElement('div', 'qmim-directory');
        const status = createElement('div', 'qmim-status');
        footer.append(directoryLabel, status);
        main.append(toolbar, grid, footer);
        body.append(sidebar, main);

        const preview = createElement('div', 'qmim-preview');
        preview.hidden = true;
        const previewHeader = createElement('div', 'qmim-preview-header');
        const previewName = createElement('div', 'qmim-preview-name');
        const previewClose = createElement('button', 'qmim-close', '×');
        previewClose.type = 'button';
        previewClose.setAttribute('aria-label', '关闭预览');
        previewHeader.append(previewName, previewClose);
        const previewStage = createElement('div', 'qmim-preview-stage');
        const previewImage = createElement('img', 'qmim-preview-image');
        previewImage.alt = '';
        previewStage.append(previewImage);
        preview.append(previewHeader, previewStage);

        const dialogLayer = createElement('div', 'qmim-dialog-layer');
        dialogLayer.hidden = true;
        const dialogForm = createElement('form', 'qmim-dialog');
        const dialogTitle = createElement('h3', 'qmim-dialog-title');
        const dialogMessage = createElement('div', 'qmim-dialog-message');
        const dialogInput = createElement('input', 'qmim-dialog-input');
        dialogInput.type = 'text';
        dialogInput.maxLength = 180;
        const dialogActions = createElement('div', 'qmim-dialog-actions');
        const dialogCancel = createElement('button', 'qmim-button', '取消');
        const dialogConfirm = createElement('button', 'qmim-primary', '确定');
        dialogCancel.type = 'button';
        dialogConfirm.type = 'submit';
        dialogActions.append(dialogCancel, dialogConfirm);
        dialogForm.append(dialogTitle, dialogMessage, dialogInput, dialogActions);
        dialogLayer.append(dialogForm);

        page.append(header, body, preview, dialogLayer);
        layer.append(page);
        document.body.append(layer);

        const setStatus = (message = '', result = '') => {
            window.clearTimeout(statusTimer);
            status.textContent = message;
            status.dataset.result = result;
            if (message && result === 'success') {
                statusTimer = window.setTimeout(() => {
                    status.textContent = '';
                    delete status.dataset.result;
                }, 1800);
            }
        };

        const selectedImages = () => state.images.filter(image => selectedIds.has(image.id));
        const activeCategory = () => state.categories.find(category => category.id === activeCategoryId) || null;

        const updateControls = () => {
            const selected = selectedIds.size;
            selectionSummary.textContent = selected ? `已选择 ${selected} 张` : '未选择图片';
            viewButton.disabled = busy || selected !== 1;
            copyButton.disabled = busy || selected !== 1;
            renameButton.disabled = busy || selected !== 1;
            assignButton.disabled = busy || selected < 1;
            deleteButton.disabled = busy || selected < 1;
            refreshButton.disabled = busy;
            openDirectoryButton.disabled = busy;
            addCategoryButton.disabled = busy;
            const category = activeCategory();
            const categoryIndex = category ? state.categories.indexOf(category) : -1;
            moveCategoryUp.disabled = busy || categoryIndex <= 0;
            moveCategoryDown.disabled = busy || categoryIndex < 0 || categoryIndex >= state.categories.length - 1;
            renameCategory.disabled = busy || !category;
            deleteCategory.disabled = busy || !category;
            grid.dataset.busy = String(busy);
        };

        const closePreview = () => {
            preview.hidden = true;
            previewImage.removeAttribute('src');
            previewName.textContent = '';
        };

        const showPreview = image => {
            if (!image) {
                return;
            }
            previewImage.removeAttribute('src');
            previewName.textContent = image.name;
            preview.hidden = false;
            requestAnimationFrame(() => {
                if (!preview.hidden) {
                    previewImage.src = messageImageFileUrl(image.filePath);
                }
            });
            previewClose.focus({ preventScroll: true });
        };

        const closeDialog = value => {
            if (dialogLayer.hidden) {
                return;
            }
            dialogLayer.hidden = true;
            dialogInput.value = '';
            dialogInput.hidden = false;
            const resolve = dialogResolve;
            dialogResolve = null;
            resolve?.(value);
        };

        const ask = ({ title, message = '', value = '', confirmLabel = '确定', danger = false, input = true }) =>
            new Promise(resolve => {
                dialogResolve?.(null);
                dialogResolve = resolve;
                dialogTitle.textContent = title;
                dialogMessage.textContent = message;
                dialogMessage.hidden = !message;
                dialogInput.hidden = !input;
                dialogInput.value = value;
                dialogConfirm.textContent = confirmLabel;
                dialogConfirm.dataset.danger = String(danger);
                dialogLayer.hidden = false;
                (input ? dialogInput : dialogConfirm).focus({ preventScroll: true });
                if (input) {
                    dialogInput.select();
                }
            });

        const adoptState = nextState => {
            if (!nextState?.ok || !Array.isArray(nextState.images)) {
                return false;
            }
            state = nextState;
            const availableIds = new Set(state.images.map(image => image.id));
            selectedIds = new Set(Array.from(selectedIds).filter(id => availableIds.has(id)));
            if (!['all', 'uncategorized'].includes(activeCategoryId) &&
                !state.categories.some(category => category.id === activeCategoryId)) {
                activeCategoryId = 'all';
            }
            return true;
        };

        const getErrorMessage = result =>
            result?.message || ERROR_MESSAGES[result?.reason] || result?.reason || '操作失败';

        const runAction = async (request, successMessage = '') => {
            if (busy) {
                return null;
            }
            busy = true;
            categoryMenu.hidden = true;
            updateControls();
            try {
                const result = await options.action?.(request);
                if (!result?.ok) {
                    throw new Error(getErrorMessage(result));
                }
                adoptState(result);
                if (successMessage) {
                    setStatus(successMessage, 'success');
                }
                return result;
            } catch (error) {
                setStatus(error?.message || '操作失败', 'error');
                return null;
            } finally {
                busy = false;
                renderAll();
            }
        };

        const renderCategoryMenu = () => {
            categoryMenu.replaceChildren();
            const choices = [
                { id: '', name: '未分类' },
                ...state.categories
            ];
            for (const category of choices) {
                const button = createElement('button', 'qmim-category-menu-item', category.name);
                button.type = 'button';
                button.dataset.categoryId = category.id;
                categoryMenu.append(button);
            }
        };

        const renderCategories = () => {
            categoryList.replaceChildren();
            const categories = [
                { id: 'all', name: '全部图片', count: state.totalCount },
                { id: 'uncategorized', name: '未分类', count: state.uncategorizedCount || 0 },
                ...state.categories
            ];
            for (const category of categories) {
                const button = createElement('button', 'qmim-category-row');
                button.type = 'button';
                button.dataset.categoryId = category.id;
                button.dataset.active = String(activeCategoryId === category.id);
                button.setAttribute('role', 'option');
                button.setAttribute('aria-selected', String(activeCategoryId === category.id));
                button.append(
                    createElement('span', 'qmim-category-name', category.name),
                    createElement('span', 'qmim-category-count', String(category.count || 0))
                );
                categoryList.append(button);
            }
            renderCategoryMenu();
        };

        const renderGrid = () => {
            grid.replaceChildren();
            const images = filterMessageImageManagerImages(state.images, activeCategoryId);
            if (!images.length) {
                grid.append(createElement('div', 'qmim-empty', state.totalCount
                    ? '这个分类中还没有图片'
                    : '保存的消息图片会显示在这里'));
                return;
            }
            const fragment = document.createDocumentFragment();
            for (const image of images) {
                const card = createElement('div', 'qmim-card');
                card.tabIndex = 0;
                card.dataset.imageId = image.id;
                card.dataset.selected = String(selectedIds.has(image.id));
                card.setAttribute('role', 'option');
                card.setAttribute('aria-selected', String(selectedIds.has(image.id)));
                const imageFrame = createElement('div', 'qmim-image-frame');
                const thumbnail = createElement('img', 'qmim-thumbnail');
                thumbnail.alt = '';
                thumbnail.loading = 'lazy';
                thumbnail.src = messageImageFileUrl(image.filePath);
                const failed = createElement('div', 'qmim-thumbnail-failed', '无法加载');
                failed.hidden = true;
                thumbnail.addEventListener('error', () => {
                    thumbnail.hidden = true;
                    failed.hidden = false;
                }, { once: true });
                const checkbox = createElement('input', 'qmim-checkbox');
                checkbox.type = 'checkbox';
                checkbox.checked = selectedIds.has(image.id);
                checkbox.setAttribute('aria-label', `选择 ${image.name}`);
                const handle = createElement('button', 'qmim-drag-handle');
                handle.type = 'button';
                handle.setAttribute('aria-label', `拖动 ${image.name} 排序`);
                handle.title = '拖动排序';
                imageFrame.append(thumbnail, failed, checkbox, handle);
                const details = createElement('div', 'qmim-card-details');
                const name = createElement('div', 'qmim-card-name', image.name);
                name.title = image.name;
                details.append(
                    name,
                    createElement('div', 'qmim-card-meta', `${formatBytes(image.size)} · ${formatDate(image.modifiedAt)}`)
                );
                card.append(imageFrame, details);
                fragment.append(card);
            }
            grid.append(fragment);
        };

        const renderAll = () => {
            const total = page.querySelector('.qmim-total');
            total.textContent = `${state.totalCount || 0} 张`;
            directoryLabel.textContent = state.directory || '';
            directoryLabel.title = state.directory || '';
            renderCategories();
            renderGrid();
            updateControls();
        };

        const refresh = async () => {
            if (busy) {
                return;
            }
            busy = true;
            setStatus('正在读取图片');
            updateControls();
            try {
                const result = await options.getState?.();
                if (!adoptState(result)) {
                    throw new Error(getErrorMessage(result));
                }
                setStatus('');
            } catch (error) {
                setStatus(error?.message || '图片读取失败', 'error');
            } finally {
                busy = false;
                renderAll();
            }
        };

        const toggleSelection = (id, selected = !selectedIds.has(id)) => {
            if (selected) {
                selectedIds.add(id);
            } else {
                selectedIds.delete(id);
            }
            renderGrid();
            updateControls();
        };

        const finishDrag = async () => {
            const current = drag;
            drag = null;
            if (!current) {
                return;
            }
            current.handle.releasePointerCapture?.(current.pointerId);
            current.ghost?.remove();
            current.card.removeAttribute('data-dragging');
            if (!current.started) {
                return;
            }
            suppressCardClickUntil = Date.now() + 250;
            const imageIds = Array.from(grid.querySelectorAll('.qmim-card[data-image-id]'))
                .map(card => card.dataset.imageId)
                .filter(Boolean);
            await runAction({
                type: 'reorder-images',
                categoryId: activeCategoryId,
                imageIds
            }, '排序已保存');
        };

        const startDrag = () => {
            if (!drag || drag.started) {
                return;
            }
            const rect = drag.card.getBoundingClientRect();
            const ghost = drag.card.cloneNode(true);
            ghost.classList.add('qmim-drag-ghost');
            ghost.setAttribute('aria-hidden', 'true');
            Object.assign(ghost.style, {
                left: `${rect.left}px`,
                top: `${rect.top}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`
            });
            layer.append(ghost);
            drag.started = true;
            drag.ghost = ghost;
            drag.offsetX = drag.startX - rect.left;
            drag.offsetY = drag.startY - rect.top;
            drag.card.dataset.dragging = 'true';
        };

        const moveDrag = event => {
            if (!drag || drag.pointerId !== event.pointerId) {
                return;
            }
            if (!drag.started && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 4) {
                startDrag();
            }
            if (!drag.started) {
                return;
            }
            drag.ghost.style.left = `${event.clientX - drag.offsetX}px`;
            drag.ghost.style.top = `${event.clientY - drag.offsetY}px`;
            const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.qmim-card');
            if (target && target !== drag.card && grid.contains(target)) {
                const rect = target.getBoundingClientRect();
                const after = event.clientY > rect.top + rect.height / 2 || (
                    Math.abs(event.clientY - (rect.top + rect.height / 2)) < rect.height / 3 &&
                    event.clientX > rect.left + rect.width / 2
                );
                target[after ? 'after' : 'before'](drag.card);
            }
            const gridRect = grid.getBoundingClientRect();
            if (event.clientY < gridRect.top + 36) {
                grid.scrollTop -= 12;
            } else if (event.clientY > gridRect.bottom - 36) {
                grid.scrollTop += 12;
            }
            event.preventDefault();
        };

        categoryList.addEventListener('click', event => {
            const button = event.target.closest?.('.qmim-category-row[data-category-id]');
            if (!button || busy) {
                return;
            }
            activeCategoryId = button.dataset.categoryId;
            selectedIds.clear();
            categoryMenu.hidden = true;
            renderAll();
        });

        grid.addEventListener('click', event => {
            if (Date.now() < suppressCardClickUntil || busy) {
                return;
            }
            const card = event.target.closest?.('.qmim-card[data-image-id]');
            if (!card || event.target.closest?.('.qmim-drag-handle')) {
                return;
            }
            const checkbox = event.target.closest?.('.qmim-checkbox');
            toggleSelection(card.dataset.imageId, checkbox ? checkbox.checked : undefined);
        });
        grid.addEventListener('dblclick', event => {
            if (Date.now() < suppressCardClickUntil) {
                return;
            }
            const card = event.target.closest?.('.qmim-card[data-image-id]');
            const image = state.images.find(item => item.id === card?.dataset.imageId);
            if (image) {
                showPreview(image);
            }
        });
        grid.addEventListener('keydown', event => {
            const card = event.target.closest?.('.qmim-card[data-image-id]');
            if (!card) {
                return;
            }
            if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                if (event.key === 'Enter') {
                    showPreview(state.images.find(image => image.id === card.dataset.imageId));
                } else {
                    toggleSelection(card.dataset.imageId);
                }
            }
        });
        grid.addEventListener('pointerdown', event => {
            const handle = event.target.closest?.('.qmim-drag-handle');
            const card = handle?.closest?.('.qmim-card[data-image-id]');
            if (!handle || !card || event.button !== 0 || drag || busy) {
                return;
            }
            drag = {
                pointerId: event.pointerId,
                handle,
                card,
                startX: event.clientX,
                startY: event.clientY,
                started: false,
                ghost: null
            };
            handle.setPointerCapture?.(event.pointerId);
            event.preventDefault();
        });
        grid.addEventListener('pointermove', moveDrag);
        grid.addEventListener('pointerup', event => {
            if (drag?.pointerId === event.pointerId) {
                finishDrag();
            }
        });
        grid.addEventListener('pointercancel', event => {
            if (drag?.pointerId === event.pointerId) {
                finishDrag();
            }
        });

        viewButton.addEventListener('click', () => showPreview(selectedImages()[0]));
        copyButton.addEventListener('click', async () => {
            const image = selectedImages()[0];
            if (image) {
                await runAction({ type: 'copy-image', imageId: image.id }, '图片已复制');
            }
        });
        renameButton.addEventListener('click', async () => {
            const image = selectedImages()[0];
            if (!image) {
                return;
            }
            const name = await ask({ title: '重命名图片', value: image.name });
            if (name === null) {
                return;
            }
            const result = await runAction({ type: 'rename-image', imageId: image.id, name }, '图片已重命名');
            if (result?.imageId) {
                selectedIds = new Set([result.imageId]);
                renderAll();
            }
        });
        deleteButton.addEventListener('click', async () => {
            const images = selectedImages();
            if (!images.length) {
                return;
            }
            const confirmed = await ask({
                title: '删除图片',
                message: `将永久删除选中的 ${images.length} 张图片，此操作无法撤销。`,
                confirmLabel: '删除',
                danger: true,
                input: false
            });
            if (!confirmed) {
                return;
            }
            const result = await runAction({
                type: 'delete-images',
                imageIds: images.map(image => image.id)
            }, `已删除 ${images.length} 张图片`);
            if (result) {
                selectedIds.clear();
                renderAll();
            }
        });
        assignButton.addEventListener('click', event => {
            event.stopPropagation();
            categoryMenu.hidden = !categoryMenu.hidden;
        });
        categoryMenu.addEventListener('click', async event => {
            const button = event.target.closest?.('.qmim-category-menu-item[data-category-id]');
            if (!button) {
                return;
            }
            const imageIds = Array.from(selectedIds);
            const categoryName = button.textContent;
            const result = await runAction({
                type: 'assign',
                categoryId: button.dataset.categoryId,
                imageIds
            }, `已移动到${categoryName}`);
            if (result) {
                selectedIds.clear();
                renderAll();
            }
        });

        addCategoryButton.addEventListener('click', async () => {
            const name = await ask({ title: '新建分类', value: '', confirmLabel: '新建' });
            if (name === null) {
                return;
            }
            const result = await runAction({ type: 'create-category', name }, '分类已新建');
            if (result?.categoryId) {
                activeCategoryId = result.categoryId;
                selectedIds.clear();
                renderAll();
            }
        });
        renameCategory.addEventListener('click', async () => {
            const category = activeCategory();
            if (!category) {
                return;
            }
            const name = await ask({ title: '重命名分类', value: category.name });
            if (name !== null) {
                await runAction({ type: 'rename-category', categoryId: category.id, name }, '分类已重命名');
            }
        });
        deleteCategory.addEventListener('click', async () => {
            const category = activeCategory();
            if (!category) {
                return;
            }
            const confirmed = await ask({
                title: '删除分类',
                message: `“${category.name}”中的图片会回到未分类，图片文件不会被删除。`,
                confirmLabel: '删除分类',
                danger: true,
                input: false
            });
            if (confirmed) {
                const result = await runAction({ type: 'delete-category', categoryId: category.id }, '分类已删除');
                if (result) {
                    activeCategoryId = 'uncategorized';
                    renderAll();
                }
            }
        });

        const moveActiveCategory = async offset => {
            const category = activeCategory();
            const index = category ? state.categories.indexOf(category) : -1;
            const target = index + offset;
            if (index < 0 || target < 0 || target >= state.categories.length) {
                return;
            }
            const categoryIds = state.categories.map(item => item.id);
            [categoryIds[index], categoryIds[target]] = [categoryIds[target], categoryIds[index]];
            await runAction({ type: 'reorder-categories', categoryIds }, '分类顺序已保存');
        };
        moveCategoryUp.addEventListener('click', () => moveActiveCategory(-1));
        moveCategoryDown.addEventListener('click', () => moveActiveCategory(1));

        openDirectoryButton.addEventListener('click', async () => {
            const image = selectedImages()[0];
            await runAction({ type: 'open-directory', imageId: selectedIds.size === 1 ? image?.id : '' });
        });
        refreshButton.addEventListener('click', refresh);
        closeButton.addEventListener('click', close);
        previewClose.addEventListener('click', closePreview);
        dialogCancel.addEventListener('click', () => closeDialog(null));
        dialogForm.addEventListener('submit', event => {
            event.preventDefault();
            if (dialogInput.hidden) {
                closeDialog(true);
                return;
            }
            const value = normalizeText(dialogInput.value);
            if (!value) {
                dialogInput.focus();
                return;
            }
            closeDialog(value);
        });
        layer.addEventListener('click', event => {
            if (!event.target.closest?.('.qmim-category-action')) {
                categoryMenu.hidden = true;
            }
        });
        layer.addEventListener('keydown', event => {
            if (event.key !== 'Escape') {
                return;
            }
            event.preventDefault();
            if (!dialogLayer.hidden) {
                closeDialog(null);
            } else if (!preview.hidden) {
                closePreview();
            } else if (!categoryMenu.hidden) {
                categoryMenu.hidden = true;
            } else {
                close();
            }
        });

        cleanup = () => {
            disposed = true;
            window.clearTimeout(statusTimer);
            dialogResolve?.(null);
            dialogResolve = null;
            const currentDrag = drag;
            drag = null;
            currentDrag?.ghost?.remove();
            closePreview();
        };
        renderAll();
        await refresh();
        if (!disposed) {
            layer.focus({ preventScroll: true });
        }
    }

    return Object.freeze({ close, open });
}
