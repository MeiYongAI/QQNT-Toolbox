'use strict';

const CHANNEL_GET_CONFIG = 'qqnt-toolbox:get-config';
const CHANNEL_SET_CONFIG = 'qqnt-toolbox:set-config';
const CHANNEL_CONFIG_CHANGED = 'qqnt-toolbox:config-changed';
const CHANNEL_INLINE_MEDIA_PREVIEW = 'qqnt-toolbox:inline-media-preview';
const CHANNEL_OPEN_INLINE_MEDIA = 'qqnt-toolbox:open-inline-media';
const CHANNEL_PREPARE_INLINE_MEDIA = 'qqnt-toolbox:prepare-inline-media';
const CHANNEL_REPEAT_MESSAGE = 'qqnt-toolbox:repeat-message';
const CHANNEL_GET_REACTION_CATALOG = 'qqnt-toolbox:get-reaction-catalog';
const CHANNEL_SET_MESSAGE_REACTION = 'qqnt-toolbox:set-message-reaction';
const CHANNEL_SEND_POKE = 'qqnt-toolbox:send-poke';
const CHANNEL_RECALL_POKE = 'qqnt-toolbox:recall-poke';
const CHANNEL_REGISTER_POKE_ACCOUNT = 'qqnt-toolbox:register-poke-account';
const CHANNEL_CLEAR_RECALL_CACHE = 'qqnt-toolbox:clear-recall-cache';
const CHANNEL_OPEN_RECALL_DIR = 'qqnt-toolbox:open-recall-dir';
const CHANNEL_OPEN_RECALL_IMAGE_DIR = 'qqnt-toolbox:open-recall-image-dir';
const CHANNEL_VIEW_RECALL_MESSAGES = 'qqnt-toolbox:view-recall-messages';
const CHANNEL_GET_RECALL_VIEWER_DATA = 'qqnt-toolbox:get-recall-viewer-data';
const CHANNEL_GET_RECALL_AUDIO_PREVIEW = 'qqnt-toolbox:get-recall-audio-preview';
const CHANNEL_JUMP_RECALL_MESSAGE = 'qqnt-toolbox:jump-recall-message';

module.exports = Object.freeze({
    CHANNEL_GET_CONFIG,
    CHANNEL_SET_CONFIG,
    CHANNEL_CONFIG_CHANGED,
    CHANNEL_INLINE_MEDIA_PREVIEW,
    CHANNEL_OPEN_INLINE_MEDIA,
    CHANNEL_PREPARE_INLINE_MEDIA,
    CHANNEL_REPEAT_MESSAGE,
    CHANNEL_GET_REACTION_CATALOG,
    CHANNEL_SET_MESSAGE_REACTION,
    CHANNEL_SEND_POKE,
    CHANNEL_RECALL_POKE,
    CHANNEL_REGISTER_POKE_ACCOUNT,
    CHANNEL_CLEAR_RECALL_CACHE,
    CHANNEL_OPEN_RECALL_DIR,
    CHANNEL_OPEN_RECALL_IMAGE_DIR,
    CHANNEL_VIEW_RECALL_MESSAGES,
    CHANNEL_GET_RECALL_VIEWER_DATA,
    CHANNEL_GET_RECALL_AUDIO_PREVIEW,
    CHANNEL_JUMP_RECALL_MESSAGE
});
