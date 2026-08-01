'use strict';

const { normalizeRecallGroupContacts } = require('./prevent-recall');

function createGroupListener(onGroupListUpdate) {
    const passthrough = new Set([
        'toString', 'valueOf', 'inspect', 'constructor', 'prototype', '__proto__',
        'then', 'catch', Symbol.toStringTag
    ]);
    return new Proxy({}, {
        get(target, property) {
            if (typeof property === 'symbol' || passthrough.has(property)) {
                return Reflect.get(target, property);
            }
            if (property === 'onGroupListUpdate') {
                return (...args) => onGroupListUpdate(args);
            }
            return () => {};
        }
    });
}

async function loadRecallGroupContacts(groupService, options = {}) {
    if (typeof groupService?.addKernelGroupListener !== 'function' ||
        typeof groupService?.removeKernelGroupListener !== 'function' ||
        typeof groupService?.getGroupList !== 'function') {
        throw new Error('QQ group service is unavailable.');
    }
    const timeoutMs = Math.max(100, Number(options.timeoutMs) || 8000);
    let listenerId;
    let timer;
    let settled = false;

    const cleanup = () => {
        clearTimeout(timer);
        if (listenerId === undefined || listenerId === null) {
            return;
        }
        try {
            groupService.removeKernelGroupListener(listenerId);
        } catch {
        }
        listenerId = undefined;
    };

    return await new Promise((resolve, reject) => {
        const finish = (error, values) => {
            if (settled) {
                return;
            }
            const contacts = error ? [] : normalizeRecallGroupContacts(values);
            if (!error && !contacts.length) {
                return;
            }
            settled = true;
            cleanup();
            if (error) {
                reject(error);
            } else {
                resolve(contacts);
            }
        };

        try {
            const listener = createGroupListener(values => finish(null, values));
            listenerId = groupService.addKernelGroupListener(listener);
            timer = setTimeout(() => {
                finish(new Error('Timed out waiting for QQ group list.'));
            }, timeoutMs);
            Promise.resolve(groupService.getGroupList(false)).then(
                values => finish(null, values),
                error => finish(error instanceof Error ? error : new Error(String(error)))
            );
        } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)));
        }
    });
}

module.exports = {
    createGroupListener,
    loadRecallGroupContacts
};
