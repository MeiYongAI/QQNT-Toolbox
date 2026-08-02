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
const CHANNEL_LOAD_MESSAGE_IMAGE_RENDERER = 'qqnt-toolbox:load-message-image-renderer';
const CHANNEL_CHOOSE_MESSAGE_IMAGE_DIRECTORY = 'qqnt-toolbox:choose-message-image-directory';
const CHANNEL_SAVE_MESSAGE_IMAGE = 'qqnt-toolbox:save-message-image';
const CHANNEL_GET_MESSAGE_IMAGE_LIBRARY = 'qqnt-toolbox:get-message-image-library';
const CHANNEL_MESSAGE_IMAGE_LIBRARY_ACTION = 'qqnt-toolbox:message-image-library-action';
const CHANNEL_FORWARD_OPEN_INTENT = 'qqnt-toolbox:forward-open-intent';
const CHANNEL_REPEAT_MESSAGE = 'qqnt-toolbox:repeat-message';
const CHANNEL_STAGE_FAKE_FORWARD_IMAGE = 'qqnt-toolbox:stage-fake-forward-image';
const CHANNEL_RESOLVE_FAKE_FORWARD_SENDER_NAME = 'qqnt-toolbox:resolve-fake-forward-sender-name';
const CHANNEL_SEND_FAKE_FORWARD = 'qqnt-toolbox:send-fake-forward';
const CHANNEL_CHOOSE_LOCAL_STICKER_DIRECTORY = 'qqnt-toolbox:choose-local-sticker-directory';
const CHANNEL_GET_LOCAL_STICKERS = 'qqnt-toolbox:get-local-stickers';
const CHANNEL_REMEMBER_LOCAL_STICKER = 'qqnt-toolbox:remember-local-sticker';
const CHANNEL_SEND_LOCAL_STICKER = 'qqnt-toolbox:send-local-sticker';
const CHANNEL_OPEN_LOCAL_STICKER_DIRECTORY = 'qqnt-toolbox:open-local-sticker-directory';
const CHANNEL_UPDATE_LOCAL_STICKER_PACK_ORDER = 'qqnt-toolbox:update-local-sticker-pack-order';
const CHANNEL_CHOOSE_LOCAL_STICKER_TOOL = 'qqnt-toolbox:choose-local-sticker-tool';
const CHANNEL_GET_LOCAL_STICKER_ENVIRONMENT = 'qqnt-toolbox:get-local-sticker-environment';
const CHANNEL_OPEN_LOCAL_STICKER_TOOL_DOWNLOAD = 'qqnt-toolbox:open-local-sticker-tool-download';
const CHANNEL_DOWNLOAD_TELEGRAM_STICKERS = 'qqnt-toolbox:download-telegram-stickers';
const CHANNEL_GET_REACTION_CATALOG = 'qqnt-toolbox:get-reaction-catalog';
const CHANNEL_GET_AUTO_REACTION_CATALOG = 'qqnt-toolbox:get-auto-reaction-catalog';
const CHANNEL_SET_MESSAGE_REACTION = 'qqnt-toolbox:set-message-reaction';
const CHANNEL_SEND_POKE = 'qqnt-toolbox:send-poke';
const CHANNEL_SEND_WINDOW_SHAKE = 'qqnt-toolbox:send-window-shake';
const CHANNEL_RECALL_POKE = 'qqnt-toolbox:recall-poke';
const CHANNEL_REGISTER_POKE_ACCOUNT = 'qqnt-toolbox:register-poke-account';
const CHANNEL_CLEAR_RECALL_CACHE = 'qqnt-toolbox:clear-recall-cache';
const CHANNEL_OPEN_RECALL_DIR = 'qqnt-toolbox:open-recall-dir';
const CHANNEL_OPEN_RECALL_IMAGE_DIR = 'qqnt-toolbox:open-recall-image-dir';
const CHANNEL_VIEW_RECALL_MESSAGES = 'qqnt-toolbox:view-recall-messages';
const CHANNEL_GET_RECALL_CONTACTS = 'qqnt-toolbox:get-recall-contacts';
const CHANNEL_GET_ANTI_RECALL_STATUS = 'qqnt-toolbox:get-anti-recall-status';
const CHANNEL_UNINSTALL_CLOSED_LID_HELPER = 'qqnt-toolbox:uninstall-closed-lid-helper';
const CHANNEL_ANTI_RECALL_STATUS_CHANGED = 'qqnt-toolbox:anti-recall-status-changed';
const CHANNEL_GET_RECALL_VIEWER_DATA = 'qqnt-toolbox:get-recall-viewer-data';
const CHANNEL_GET_RECALL_AUDIO_PREVIEW = 'qqnt-toolbox:get-recall-audio-preview';
const CHANNEL_OPEN_RECALL_VIEWER_FILE = 'qqnt-toolbox:open-recall-viewer-file';
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
    CHANNEL_LOAD_MESSAGE_IMAGE_RENDERER,
    CHANNEL_CHOOSE_MESSAGE_IMAGE_DIRECTORY,
    CHANNEL_SAVE_MESSAGE_IMAGE,
    CHANNEL_GET_MESSAGE_IMAGE_LIBRARY,
    CHANNEL_MESSAGE_IMAGE_LIBRARY_ACTION,
    CHANNEL_FORWARD_OPEN_INTENT,
    CHANNEL_REPEAT_MESSAGE,
    CHANNEL_STAGE_FAKE_FORWARD_IMAGE,
    CHANNEL_RESOLVE_FAKE_FORWARD_SENDER_NAME,
    CHANNEL_SEND_FAKE_FORWARD,
    CHANNEL_CHOOSE_LOCAL_STICKER_DIRECTORY,
    CHANNEL_GET_LOCAL_STICKERS,
    CHANNEL_REMEMBER_LOCAL_STICKER,
    CHANNEL_SEND_LOCAL_STICKER,
    CHANNEL_OPEN_LOCAL_STICKER_DIRECTORY,
    CHANNEL_UPDATE_LOCAL_STICKER_PACK_ORDER,
    CHANNEL_CHOOSE_LOCAL_STICKER_TOOL,
    CHANNEL_GET_LOCAL_STICKER_ENVIRONMENT,
    CHANNEL_OPEN_LOCAL_STICKER_TOOL_DOWNLOAD,
    CHANNEL_DOWNLOAD_TELEGRAM_STICKERS,
    CHANNEL_GET_REACTION_CATALOG,
    CHANNEL_GET_AUTO_REACTION_CATALOG,
    CHANNEL_SET_MESSAGE_REACTION,
    CHANNEL_SEND_POKE,
    CHANNEL_SEND_WINDOW_SHAKE,
    CHANNEL_RECALL_POKE,
    CHANNEL_REGISTER_POKE_ACCOUNT,
    CHANNEL_CLEAR_RECALL_CACHE,
    CHANNEL_OPEN_RECALL_DIR,
    CHANNEL_OPEN_RECALL_IMAGE_DIR,
    CHANNEL_VIEW_RECALL_MESSAGES,
    CHANNEL_GET_RECALL_CONTACTS,
    CHANNEL_GET_ANTI_RECALL_STATUS,
    CHANNEL_UNINSTALL_CLOSED_LID_HELPER,
    CHANNEL_ANTI_RECALL_STATUS_CHANGED,
    CHANNEL_GET_RECALL_VIEWER_DATA,
    CHANNEL_GET_RECALL_AUDIO_PREVIEW,
    CHANNEL_OPEN_RECALL_VIEWER_FILE,
    CHANNEL_JUMP_RECALL_MESSAGE,
    CHANNEL_GET_UPDATE_STATE,
    CHANNEL_CHECK_UPDATE,
    CHANNEL_PREPARE_UPDATE,
    CHANNEL_RESTART_UPDATE,
    CHANNEL_UPDATE_STATE_CHANGED
});
