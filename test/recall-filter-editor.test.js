'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const moduleSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'recall-filter-editor.js'),
    'utf8'
);
const modulePromise = import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);

test('merges the full contact list with saved selections without duplicates', async () => {
    const { mergeRecallFilterContacts } = await modulePromise;
    const contacts = mergeRecallFilterContacts(
        [
            { chatType: 2, peerUid: 'group', peerUin: '123', label: 'Group', msgTime: 20 },
            { chatType: 1, peerUid: 'friend', label: 'Friend', msgTime: 10 }
        ],
        [{ chatType: 2, peerUid: 'group', label: 'Saved Group' }]
    );
    assert.deepEqual(contacts.map(contact => [contact.key, contact.label]), [
        ['1:friend', 'Friend'],
        ['2:group', 'Group']
    ]);
});

test('uses a standalone selectable page instead of inline chips', () => {
    assert.match(moduleSource, /getRecallContacts|qqnt-toolbox-recall-filter-page|type = 'checkbox'/);
    assert.match(moduleSource, /width:\s*min\(500px/);
    assert.match(moduleSource, /height:\s*min\(680px/);
    assert.match(moduleSource, /--qqnt-toolbox-recall-filter-surface/);
    assert.match(moduleSource, /搜索群或好友/);
    assert.match(moduleSource, /\['all', '全部'\], \['group', '群聊'\], \['private', '好友'\]/);
    assert.match(moduleSource, /data-selected/);
    assert.match(moduleSource, /recall-filter-check:checked/);
    assert.doesNotMatch(moduleSource, /\['selected', '已选'\]|filter === 'selected'/);
    assert.doesNotMatch(moduleSource, /qqnt-toolbox-recall-filter-(?:back|refresh)/);
    assert.doesNotMatch(moduleSource, /position:\s*absolute/);
});
