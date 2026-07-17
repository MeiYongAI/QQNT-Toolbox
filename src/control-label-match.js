'use strict';

const ACCESSIBLE_CONTROL_SUFFIXES = [
    '\u6309\u94ae',
    '\u83dc\u5355\u9879'
];

function compactLabel(value) {
    return String(value ?? '')
        .replace(/\s+/g, '')
        .trim();
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
