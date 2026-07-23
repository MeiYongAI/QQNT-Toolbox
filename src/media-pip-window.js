'use strict';

const PIP_DEFAULT_SIZE = 320;
const PIP_MIN_SIZE = 120;
const PIP_BORDER_SKIP = 20;
const PIP_SNAP_AREA = 16;
const PIP_SHADOW_PADDING = 10;

function clamp(value, minimum, maximum) {
    return Math.min(Math.max(Number(value) || 0, minimum), maximum);
}

function normalizeAspectRatio(value) {
    const ratio = Number(value);
    return Number.isFinite(ratio) && ratio > 0.05 && ratio < 20 ? ratio : 16 / 9;
}

function normalizeRect(value) {
    const rect = {
        x: Math.round(Number(value?.x) || 0),
        y: Math.round(Number(value?.y) || 0),
        width: Math.round(Number(value?.width) || 0),
        height: Math.round(Number(value?.height) || 0)
    };
    return rect.width > 0 && rect.height > 0 ? rect : null;
}

function getContentSize(aspectRatio, longSide) {
    const ratio = normalizeAspectRatio(aspectRatio);
    return ratio >= 1
        ? { width: longSide, height: longSide / ratio }
        : { width: longSide * ratio, height: longSide };
}

function getLongSideRange(workArea, aspectRatio) {
    const ratio = normalizeAspectRatio(aspectRatio);
    const area = normalizeRect(workArea) || { x: 0, y: 0, width: 1280, height: 720 };
    const availableWidth = Math.max(1, area.width - (3 * PIP_BORDER_SKIP) - (2 * PIP_SHADOW_PADDING));
    const availableHeight = Math.max(1, area.height - (3 * PIP_BORDER_SKIP) - (2 * PIP_SHADOW_PADDING));
    const maximum = ratio >= 1
        ? Math.min(availableWidth, availableHeight * ratio)
        : Math.min(availableHeight, availableWidth / ratio);
    const minimum = PIP_MIN_SIZE * Math.max(ratio, 1 / ratio);
    return {
        minimum: Math.min(minimum, maximum),
        maximum: Math.max(1, maximum)
    };
}

function getPipOuterSize(workArea, aspectRatio, requestedLongSide = PIP_DEFAULT_SIZE) {
    const range = getLongSideRange(workArea, aspectRatio);
    const longSide = clamp(requestedLongSide, range.minimum, range.maximum);
    const content = getContentSize(aspectRatio, longSide);
    return {
        width: Math.round(content.width + (2 * PIP_SHADOW_PADDING)),
        height: Math.round(content.height + (2 * PIP_SHADOW_PADDING))
    };
}

function clampPipBounds(value, workArea, gap = 0) {
    const bounds = normalizeRect(value);
    const area = normalizeRect(workArea);
    if (!bounds || !area) {
        return bounds;
    }
    const minimumX = area.x + gap;
    const minimumY = area.y + gap;
    const maximumX = Math.max(minimumX, area.x + area.width - gap - bounds.width);
    const maximumY = Math.max(minimumY, area.y + area.height - gap - bounds.height);
    return {
        ...bounds,
        x: clamp(bounds.x, minimumX, maximumX),
        y: clamp(bounds.y, minimumY, maximumY)
    };
}

function movePipBounds(value, dx, dy) {
    const bounds = normalizeRect(value);
    dx = Number(dx);
    dy = Number(dy);
    if (!bounds || !Number.isFinite(dx) || !Number.isFinite(dy)) {
        return bounds;
    }
    return {
        ...bounds,
        x: Math.round(bounds.x + dx),
        y: Math.round(bounds.y + dy)
    };
}

function fitPipBounds(savedBounds, workArea, aspectRatio) {
    const saved = normalizeRect(savedBounds);
    const requestedLongSide = saved
        ? Math.max(
            saved.width - (2 * PIP_SHADOW_PADDING),
            saved.height - (2 * PIP_SHADOW_PADDING)
        )
        : PIP_DEFAULT_SIZE;
    const size = getPipOuterSize(workArea, aspectRatio, requestedLongSide);
    const area = normalizeRect(workArea) || { x: 0, y: 0, width: 1280, height: 720 };
    return clampPipBounds({
        x: saved ? saved.x : area.x + PIP_BORDER_SKIP,
        y: saved ? saved.y : area.y + PIP_BORDER_SKIP,
        ...size
    }, area);
}

function constrainPipResize(currentBounds, proposedBounds, edge, workArea, aspectRatio) {
    const current = normalizeRect(currentBounds);
    const proposed = normalizeRect(proposedBounds);
    if (!current || !proposed) {
        return proposed || current;
    }
    edge = String(edge || '').toLowerCase();
    const horizontal = edge.includes('left') || edge.includes('right');
    const vertical = edge.includes('top') || edge.includes('bottom');
    const ratio = normalizeAspectRatio(aspectRatio);
    const padding = 2 * PIP_SHADOW_PADDING;
    const proposedWidth = Math.max(1, proposed.width - padding);
    const proposedHeight = Math.max(1, proposed.height - padding);
    const currentLongSide = Math.max(current.width - padding, current.height - padding);
    const fromWidth = ratio >= 1 ? proposedWidth : proposedWidth / ratio;
    const fromHeight = ratio >= 1 ? proposedHeight * ratio : proposedHeight;
    const requestedLongSide = horizontal && !vertical
        ? fromWidth
        : vertical && !horizontal
            ? fromHeight
            : Math.abs(fromWidth - currentLongSide) >= Math.abs(fromHeight - currentLongSide)
                ? fromWidth
                : fromHeight;
    const size = getPipOuterSize(workArea, ratio, requestedLongSide);
    const right = current.x + current.width;
    const bottom = current.y + current.height;
    const bounds = {
        x: edge.includes('left') ? right - size.width : current.x,
        y: edge.includes('top') ? bottom - size.height : current.y,
        ...size
    };
    return clampPipBounds(bounds, workArea);
}

function snapPipBounds(value, workArea) {
    const bounds = clampPipBounds(value, workArea);
    const area = normalizeRect(workArea);
    if (!bounds || !area) {
        return bounds;
    }
    const left = area.x + PIP_BORDER_SKIP;
    const top = area.y + PIP_BORDER_SKIP;
    const right = area.x + area.width - PIP_BORDER_SKIP - bounds.width;
    const bottom = area.y + area.height - PIP_BORDER_SKIP - bounds.height;
    return clampPipBounds({
        ...bounds,
        x: Math.abs(bounds.x - left) <= PIP_SNAP_AREA
            ? left
            : Math.abs(bounds.x - right) <= PIP_SNAP_AREA
                ? right
                : bounds.x,
        y: Math.abs(bounds.y - top) <= PIP_SNAP_AREA
            ? top
            : Math.abs(bounds.y - bottom) <= PIP_SNAP_AREA
                ? bottom
                : bounds.y
    }, area);
}

module.exports = {
    PIP_BORDER_SKIP,
    PIP_DEFAULT_SIZE,
    PIP_MIN_SIZE,
    PIP_SHADOW_PADDING,
    PIP_SNAP_AREA,
    clampPipBounds,
    constrainPipResize,
    fitPipBounds,
    getPipOuterSize,
    movePipBounds,
    normalizeAspectRatio,
    snapPipBounds
};
