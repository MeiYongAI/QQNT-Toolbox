'use strict';

const CHANNEL_GET_CONFIG = 'qqnt-toolbox:get-config';
const CHANNEL_SET_CONFIG = 'qqnt-toolbox:set-config';
const CHANNEL_CONFIG_CHANGED = 'qqnt-toolbox:config-changed';
const CHANNEL_DIAGNOSTIC_EVENT = 'qqnt-toolbox:diagnostic-event';
const CHANNEL_DIAGNOSTIC_ACTION = 'qqnt-toolbox:diagnostic-action';
const CHANNEL_OPEN_MEDIA_VIEWER = 'qqnt-toolbox:open-media-viewer';
const CHANNEL_SCAN_QR_CODE = 'qqnt-toolbox:scan-qr-code';
const CHANNEL_QR_RESULT_ACTION = 'qqnt-toolbox:qr-result-action';
const CHANNEL_MEDIA_VIEWER_GET_STATE = 'qqnt-toolbox:media-viewer-get-state';
const CHANNEL_MEDIA_VIEWER_PREPARE = 'qqnt-toolbox:media-viewer-prepare';
const CHANNEL_MEDIA_VIEWER_ACTION = 'qqnt-toolbox:media-viewer-action';
const CHANNEL_MEDIA_VIEWER_STATE_CHANGED = 'qqnt-toolbox:media-viewer-state-changed';
const CHANNEL_MEDIA_PIP_GET_STATE = 'qqnt-toolbox:media-pip-get-state';
const CHANNEL_MEDIA_PIP_ACTION = 'qqnt-toolbox:media-pip-action';
const CHANNEL_MEDIA_PIP_DRAG = 'qqnt-toolbox:media-pip-drag';
const CHANNEL_MEDIA_PIP_STATE_CHANGED = 'qqnt-toolbox:media-pip-state-changed';
const CHANNEL_OPEN_EMOJI_AS_IMAGE = 'qqnt-toolbox:open-emoji-as-image';
const CHANNEL_REPEAT_MESSAGE = 'qqnt-toolbox:repeat-message';
const CHANNEL_STAGE_FAKE_FORWARD_IMAGE = 'qqnt-toolbox:stage-fake-forward-image';
const CHANNEL_RESOLVE_FAKE_FORWARD_SENDER_NAME = 'qqnt-toolbox:resolve-fake-forward-sender-name';
const CHANNEL_SEND_FAKE_FORWARD = 'qqnt-toolbox:send-fake-forward';
const CHANNEL_GET_REACTION_CATALOG = 'qqnt-toolbox:get-reaction-catalog';
const CHANNEL_SET_MESSAGE_REACTION = 'qqnt-toolbox:set-message-reaction';
const CHANNEL_SEND_POKE = 'qqnt-toolbox:send-poke';
const CHANNEL_RECALL_POKE = 'qqnt-toolbox:recall-poke';
const CHANNEL_REGISTER_POKE_ACCOUNT = 'qqnt-toolbox:register-poke-account';
const CHANNEL_CLEAR_RECALL_CACHE = 'qqnt-toolbox:clear-recall-cache';
const CHANNEL_OPEN_RECALL_DIR = 'qqnt-toolbox:open-recall-dir';
const CHANNEL_OPEN_RECALL_IMAGE_DIR = 'qqnt-toolbox:open-recall-image-dir';
const CHANNEL_VIEW_RECALL_MESSAGES = 'qqnt-toolbox:view-recall-messages';
const CHANNEL_GET_RECALL_CONTACTS = 'qqnt-toolbox:get-recall-contacts';
const CHANNEL_GET_RECALL_VIEWER_DATA = 'qqnt-toolbox:get-recall-viewer-data';
const CHANNEL_GET_RECALL_AUDIO_PREVIEW = 'qqnt-toolbox:get-recall-audio-preview';
const CHANNEL_JUMP_RECALL_MESSAGE = 'qqnt-toolbox:jump-recall-message';
const CHANNEL_GET_UPDATE_STATE = 'qqnt-toolbox:get-update-state';
const CHANNEL_CHECK_UPDATE = 'qqnt-toolbox:check-update';
const CHANNEL_PREPARE_UPDATE = 'qqnt-toolbox:prepare-update';
const CHANNEL_RESTART_UPDATE = 'qqnt-toolbox:restart-update';
const CHANNEL_UPDATE_STATE_CHANGED = 'qqnt-toolbox:update-state-changed';

module.exports = Object.freeze({
    CHANNEL_GET_CONFIG,
    CHANNEL_SET_CONFIG,
    CHANNEL_CONFIG_CHANGED,
    CHANNEL_DIAGNOSTIC_EVENT,
    CHANNEL_DIAGNOSTIC_ACTION,
    CHANNEL_OPEN_MEDIA_VIEWER,
    CHANNEL_SCAN_QR_CODE,
    CHANNEL_QR_RESULT_ACTION,
    CHANNEL_MEDIA_VIEWER_GET_STATE,
    CHANNEL_MEDIA_VIEWER_PREPARE,
    CHANNEL_MEDIA_VIEWER_ACTION,
    CHANNEL_MEDIA_VIEWER_STATE_CHANGED,
    CHANNEL_MEDIA_PIP_GET_STATE,
    CHANNEL_MEDIA_PIP_ACTION,
    CHANNEL_MEDIA_PIP_DRAG,
    CHANNEL_MEDIA_PIP_STATE_CHANGED,
    CHANNEL_OPEN_EMOJI_AS_IMAGE,
    CHANNEL_REPEAT_MESSAGE,
    CHANNEL_STAGE_FAKE_FORWARD_IMAGE,
    CHANNEL_RESOLVE_FAKE_FORWARD_SENDER_NAME,
    CHANNEL_SEND_FAKE_FORWARD,
    CHANNEL_GET_REACTION_CATALOG,
    CHANNEL_SET_MESSAGE_REACTION,
    CHANNEL_SEND_POKE,
    CHANNEL_RECALL_POKE,
    CHANNEL_REGISTER_POKE_ACCOUNT,
    CHANNEL_CLEAR_RECALL_CACHE,
    CHANNEL_OPEN_RECALL_DIR,
    CHANNEL_OPEN_RECALL_IMAGE_DIR,
    CHANNEL_VIEW_RECALL_MESSAGES,
    CHANNEL_GET_RECALL_CONTACTS,
    CHANNEL_GET_RECALL_VIEWER_DATA,
    CHANNEL_GET_RECALL_AUDIO_PREVIEW,
    CHANNEL_JUMP_RECALL_MESSAGE,
    CHANNEL_GET_UPDATE_STATE,
    CHANNEL_CHECK_UPDATE,
    CHANNEL_PREPARE_UPDATE,
    CHANNEL_RESTART_UPDATE,
    CHANNEL_UPDATE_STATE_CHANGED
});
