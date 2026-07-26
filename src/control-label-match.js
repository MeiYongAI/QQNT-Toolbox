'use strict';

const ACCESSIBLE_CONTROL_SUFFIXES = [
    '\u6309\u94ae',
    '\u83dc\u5355\u9879'
];
const DYNAMIC_NOTIFICATION_SUFFIX =
    /\s*[\uff08(]?(?:99\+|\d+)\s*(?:\u6761\u672a\u8bfb(?:\u6d88\u606f)?|\u6761\u65b0\u6d88\u606f|\u4e2a\u672a\u8bfb(?:\u6d88\u606f)?|\u4e2a\u901a\u77e5)[\uff09)]?\s*$/u;

function compactLabel(value) {
    return String(value ?? '')
        .replace(/\s+/g, '')
        .trim();
}

export function normalizeDynamicControlLabel(value) {
    return String(value ?? '').replace(DYNAMIC_NOTIFICATION_SUFFIX, '').trim();
}

export function matchesControlLabelValue(value, label) {
    const normalizedValue = compactLabel(value);
    const normalizedLabel = compactLabel(label);
    if (!normalizedValue || !normalizedLabel) {
        return false;
    }
    return normalizedValue === normalizedLabel ||
        ACCESSIBLE_CONTROL_SUFFIXES.some(suffix => normalizedValue === `${normalizedLabel}${suffix}`);
}
