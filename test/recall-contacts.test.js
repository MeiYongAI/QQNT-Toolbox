'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { loadRecallGroupContacts } = require('../src/recall-contacts');

test('loads the complete group list through the active QQ wrapper session', async () => {
    let listener;
    let removedId;
    let forced;
    const groupService = {
        addKernelGroupListener(value) {
            listener = value;
            return 17;
        },
        removeKernelGroupListener(id) {
            removedId = id;
        },
        getGroupList(value) {
            forced = value;
            queueMicrotask(() => listener.onGroupListUpdate(0, [
                { groupCode: '123456', groupName: 'Group A' },
                { groupCode: '998877', groupName: 'Group B', remarkName: 'Remark B' }
            ]));
        }
    };

    const contacts = await loadRecallGroupContacts(groupService, { timeoutMs: 500 });

    assert.equal(forced, false);
    assert.equal(removedId, 17);
    assert.deepEqual(contacts.map(contact => [contact.peerUid, contact.label]), [
        ['123456', 'Group A'],
        ['998877', 'Remark B']
    ]);
});

test('accepts a group list returned directly by the wrapper service', async () => {
    let removed = false;
    const contacts = await loadRecallGroupContacts({
        addKernelGroupListener() {
            return 9;
        },
        removeKernelGroupListener() {
            removed = true;
        },
        getGroupList() {
            return { groupList: [{ groupCode: '246810', groupName: 'Direct Group' }] };
        }
    }, { timeoutMs: 500 });

    assert.equal(removed, true);
    assert.equal(contacts[0].label, 'Direct Group');
});

test('removes the temporary listener when group loading times out', async () => {
    let removedId;
    await assert.rejects(() => loadRecallGroupContacts({
        addKernelGroupListener() {
            return 23;
        },
        removeKernelGroupListener(id) {
            removedId = id;
        },
        getGroupList() {
        }
    }, { timeoutMs: 25 }), /Timed out waiting for QQ group list/);
    assert.equal(removedId, 23);
});
