'use strict';

const CONTEXT_MENU_ORDER_SCOPE_KEYS = Object.freeze([
    'message',
    'avatar',
    'recent'
]);

function createDefaultContextMenuOrderConfig() {
    return {
        enabled: false,
        scopes: Object.fromEntries(CONTEXT_MENU_ORDER_SCOPE_KEYS.map(scope => [
            scope,
            { items: [], catalog: [] }
        ]))
    };
}

function migrateContextMenuOrderConfig(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }
    const interfaceTweaks = value.interfaceTweaks;
    if (!interfaceTweaks || typeof interfaceTweaks !== 'object' || Array.isArray(interfaceTweaks)) {
        return value;
    }

    const migratedTweaks = { ...interfaceTweaks };
    const legacy = migratedTweaks.messageContextMenuOrder;
    const current = migratedTweaks.contextMenuOrder &&
        typeof migratedTweaks.contextMenuOrder === 'object' &&
        !Array.isArray(migratedTweaks.contextMenuOrder)
        ? { ...migratedTweaks.contextMenuOrder }
        : {};
    const storedScopes = current.scopes && typeof current.scopes === 'object' &&
        !Array.isArray(current.scopes)
        ? current.scopes
        : {};
    const scopes = Object.fromEntries(CONTEXT_MENU_ORDER_SCOPE_KEYS
        .filter(scope => Object.prototype.hasOwnProperty.call(storedScopes, scope))
        .map(scope => [scope, storedScopes[scope]]));

    if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
        if (typeof current.enabled !== 'boolean' && typeof legacy.enabled === 'boolean') {
            current.enabled = legacy.enabled;
        }
        const message = scopes.message && typeof scopes.message === 'object' &&
            !Array.isArray(scopes.message)
            ? { ...scopes.message }
            : {};
        if (!Array.isArray(message.items) && Array.isArray(legacy.items)) {
            message.items = [...legacy.items];
        }
        if (!Array.isArray(message.catalog) && Array.isArray(legacy.catalog)) {
            message.catalog = [...legacy.catalog];
        }
        scopes.message = message;
    }

    current.scopes = scopes;
    migratedTweaks.contextMenuOrder = current;
    delete migratedTweaks.messageContextMenuOrder;
    return { ...value, interfaceTweaks: migratedTweaks };
}

module.exports = {
    CONTEXT_MENU_ORDER_SCOPE_KEYS,
    createDefaultContextMenuOrderConfig,
    migrateContextMenuOrderConfig
};
