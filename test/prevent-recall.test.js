'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    getRecallPeerDescriptor,
    normalizePreventRecallConfig,
    normalizeRecallBuddyContacts,
    normalizeRecallGroupContacts,
    normalizeRecallFilterPeers,
    shouldHandlePreventRecallRecord,
    shouldPreventRecallForPeer
} = require('../src/prevent-recall');

test('normalizes recall marker options and a bounded peer list', () => {
    const peers = normalizeRecallFilterPeers([
        { chatType: 2, peerUid: '123456', label: 'Group A' },
        { chatType: 2, peerUid: '123456', label: 'Duplicate' },
        { chatType: 1, peer: { peerUid: 'u_friend' }, label: 'Friend' },
        { chatType: 0, peerUid: '' }
    ]);
    assert.deepEqual(peers, [
        { key: '2:123456', chatType: 2, peerUid: '123456', label: 'Group A' },
        { key: '1:u_friend', chatType: 1, peerUid: 'u_friend', label: 'Friend' }
    ]);
    assert.deepEqual(normalizePreventRecallConfig({ markerStyle: 'invalid', filterMode: 'invalid' }), {
        markerStyle: 'badge',
        filterMode: 'all',
        filterPeers: []
    });
});

test('normalizes QQ buddy categories with profile details', () => {
    const contacts = normalizeRecallBuddyContacts(
        { data: [{ buddyUids: ['u_friend', 'u_second'] }] },
        new Map([
            ['u_friend', { coreInfo: { uid: 'u_friend', uin: '654321', nick: 'Nick', remark: 'Friend' } }],
            ['u_second', { uid: 'u_second', uin: '112233', nick: 'Second' }]
        ])
    );
    assert.deepEqual(contacts, [
        {
            key: '1:u_friend',
            chatType: 1,
            peerUid: 'u_friend',
            peerUin: '654321',
            label: 'Friend',
            avatarUrl: 'https://q1.qlogo.cn/g?b=qq&nk=654321&s=100',
            msgTime: 0
        },
        {
            key: '1:u_second',
            chatType: 1,
            peerUid: 'u_second',
            peerUin: '112233',
            label: 'Second',
            avatarUrl: 'https://q1.qlogo.cn/g?b=qq&nk=112233&s=100',
            msgTime: 0
        }
    ]);
});

test('normalizes the complete QQ group list', () => {
    assert.deepEqual(normalizeRecallGroupContacts([0, [
        { groupCode: '123456', groupName: 'Group A', remarkName: 'Remark A' },
        { groupCode: '998877', groupName: 'Group B' }
    ]]), [
        {
            key: '2:123456', chatType: 2, peerUid: '123456', peerUin: '123456', label: 'Remark A',
            avatarUrl: 'https://p.qlogo.cn/gh/123456/123456/100/', msgTime: 0
        },
        {
            key: '2:998877', chatType: 2, peerUid: '998877', peerUin: '998877', label: 'Group B',
            avatarUrl: 'https://p.qlogo.cn/gh/998877/998877/100/', msgTime: 0
        }
    ]);
});

test('applies recall blacklist and whitelist before recovery', () => {
    const group = { chatType: 2, peerUid: '123456' };
    const friend = { chatType: 1, peerUid: 'u_friend' };
    const filterPeers = [{ chatType: 2, peerUid: '123456', label: 'Group A' }];

    assert.equal(shouldPreventRecallForPeer({ filterMode: 'all' }, group), true);
    assert.equal(shouldPreventRecallForPeer({ filterMode: 'blacklist', filterPeers }, group), false);
    assert.equal(shouldPreventRecallForPeer({ filterMode: 'blacklist', filterPeers }, friend), true);
    assert.equal(shouldPreventRecallForPeer({ filterMode: 'whitelist', filterPeers }, group), true);
    assert.equal(shouldPreventRecallForPeer({ filterMode: 'whitelist', filterPeers }, friend), false);
    assert.deepEqual(getRecallPeerDescriptor({ chatType: 2, peerUin: '998877' }), {
        key: '2:998877',
        chatType: 2,
        peerUid: '998877'
    });
});

test('keeps an already recovered message until its cache is cleared', () => {
    const group = { chatType: 2, peerUid: '123456' };
    const emptyWhitelist = { enabled: true, filterMode: 'whitelist', filterPeers: [] };

    assert.equal(shouldHandlePreventRecallRecord(emptyWhitelist, group, false), false);
    assert.equal(shouldHandlePreventRecallRecord(emptyWhitelist, group, true), true);
    assert.equal(shouldHandlePreventRecallRecord({ enabled: false }, group, true), true);
    assert.equal(shouldHandlePreventRecallRecord({ enabled: false }, group, false), false);
});

test('wires selectable recall markers and a shared outline color into the renderer', () => {
    const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
    assert.match(renderer, /preventRecall\.markerStyle/);
    assert.match(renderer, /preventRecall\.filterMode/);
    assert.match(renderer, /qqnt-toolbox-recall-outline/);
    assert.match(renderer, /--qqnt-toolbox-recall-color/);
    assert.match(renderer, /createRecallFilterEditor/);
    assert.doesNotMatch(renderer, /qqnt-toolbox-recall-filter-chip/);
    const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    assert.match(main, /nodeIKernelBuddyService\/getBuddyListV2/);
    assert.match(main, /nodeIKernelGroupService\/getGroupList/);
    assert.match(main, /getProfileService\?\.\(\)/);
    assert.match(main, /getCoreAndBaseInfo\('nodeStore', buddyUids\)/);
    assert.match(main, /recalledMessages\.has\(msgId\)/);
    assert.doesNotMatch(main, /nodeIKernelProfileService\/getCoreAndBaseInfo/);
    assert.doesNotMatch(main, /getRecentContactService/);
});
