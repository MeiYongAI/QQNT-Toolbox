'use strict';

const VOICE_LIBRARY_PANEL_CSS = String.raw`
#qqnt-toolbox-voice-library {
    --voice-bg: var(--bg_top_light, var(--background-05, var(--background-01, #ffffff)));
    --voice-layer: var(--fill_light_primary, var(--background-02, rgba(127, 127, 127, .06)));
    --voice-hover: var(--background-02, rgba(127, 127, 127, .12));
    --voice-active: var(--background-03, rgba(127, 127, 127, .18));
    --voice-border: var(--border-level-1-color, var(--divider, rgba(0, 0, 0, .08)));
    --voice-text: var(--text-primary, var(--text-01, #1f2329));
    --voice-muted: var(--text-secondary, var(--text-02, #6b7280));
    --voice-faint: var(--text-tertiary, var(--text-03, #8a8f99));
    --voice-accent: var(--brand_standard, var(--theme-color, #0099ff));
    --voice-danger: var(--text_error, #e84d4d);
    position: fixed;
    inset: 0;
    z-index: 2147483000;
    color: var(--voice-text);
    background: rgba(0, 0, 0, .28);
    font: 13px/1.45 var(--font-family, "Microsoft YaHei UI", "Microsoft YaHei", sans-serif);
    letter-spacing: 0;
}
#qqnt-toolbox-voice-library, #qqnt-toolbox-voice-library * {
    box-sizing: border-box;
}
#qqnt-toolbox-voice-library .qvlib-shell {
    position: absolute;
    left: 8px;
    top: 8px;
    width: min(360px, calc(100vw - 24px));
    height: min(400px, calc(100vh - 24px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--voice-border);
    border-radius: 8px;
    background: var(--voice-bg);
    box-shadow: var(--shadow-bg-middle-primary, 0 18px 48px rgba(0, 0, 0, .18));
}
#qqnt-toolbox-voice-library .qvlib-header {
    flex: 0 0 44px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 7px 0 12px;
    border-bottom: 1px solid var(--voice-border);
    background: var(--voice-bg);
    cursor: move;
    touch-action: none;
    user-select: none;
}
#qqnt-toolbox-voice-library .qvlib-heading {
    min-width: 0;
    flex: 1;
    display: flex;
    align-items: baseline;
    gap: 6px;
}
#qqnt-toolbox-voice-library .qvlib-title {
    min-width: 0;
    overflow: hidden;
    color: var(--voice-text);
    font-size: 14px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#qqnt-toolbox-voice-library .qvlib-count {
    flex: none;
    color: var(--voice-muted);
    font-size: 11px;
    white-space: nowrap;
}
#qqnt-toolbox-voice-library button {
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 8px;
    border: 1px solid var(--voice-border);
    border-radius: 6px;
    color: var(--voice-text);
    background: var(--voice-layer);
    font: 500 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    letter-spacing: 0;
    white-space: nowrap;
    cursor: pointer;
}
#qqnt-toolbox-voice-library button:hover:not(:disabled) {
    background: var(--voice-hover);
}
#qqnt-toolbox-voice-library button:active:not(:disabled) {
    background: var(--voice-active);
}
#qqnt-toolbox-voice-library button:focus-visible,
#qqnt-toolbox-voice-library input:focus-visible,
#qqnt-toolbox-voice-library [role="slider"]:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--voice-accent) 72%, transparent);
    outline-offset: 1px;
}
#qqnt-toolbox-voice-library button:disabled {
    opacity: .42;
    cursor: default;
}
#qqnt-toolbox-voice-library .qvlib-icon-button {
    width: 30px;
    height: 30px;
    flex: none;
    padding: 0;
    border-color: transparent;
    background: transparent;
    font-size: 18px;
}
#qqnt-toolbox-voice-library .qvlib-close {
    color: var(--voice-muted);
    font-size: 19px;
}
#qqnt-toolbox-voice-library .qvlib-nav {
    flex: 0 0 38px;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 8px;
    border-bottom: 1px solid var(--voice-border);
    background: var(--voice-layer);
}
#qqnt-toolbox-voice-library .qvlib-nav[hidden] {
    display: none;
}
#qqnt-toolbox-voice-library .qvlib-back {
    width: 28px;
    flex: none;
    padding: 0;
    border-color: transparent;
    background: transparent;
    font-size: 16px;
}
#qqnt-toolbox-voice-library .qvlib-path {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
}
#qqnt-toolbox-voice-library .qvlib-path-current,
#qqnt-toolbox-voice-library .qvlib-path-parent {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#qqnt-toolbox-voice-library .qvlib-path-current {
    color: var(--voice-text);
    font-size: 12px;
}
#qqnt-toolbox-voice-library .qvlib-path-parent {
    color: var(--voice-muted);
    font-size: 10px;
}
#qqnt-toolbox-voice-library .qvlib-list {
    min-height: 0;
    flex: 1;
    overflow: auto;
    padding: 3px 8px;
    scrollbar-gutter: stable both-edges;
    scrollbar-width: thin;
    scrollbar-color: var(--voice-border) transparent;
}
#qqnt-toolbox-voice-library .qvlib-list::-webkit-scrollbar {
    width: 4px;
}
#qqnt-toolbox-voice-library .qvlib-list::-webkit-scrollbar-track {
    background: transparent;
}
#qqnt-toolbox-voice-library .qvlib-list::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: var(--voice-border);
}
#qqnt-toolbox-voice-library .qvlib-empty {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--voice-faint);
}
#qqnt-toolbox-voice-library .qvlib-row {
    min-height: 55px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 7px;
    padding: 7px 3px;
    border-bottom: 1px solid var(--voice-border);
}
#qqnt-toolbox-voice-library .qvlib-row:last-child {
    border-bottom: 0;
}
#qqnt-toolbox-voice-library .qvlib-row:hover {
    background: var(--voice-layer);
}
#qqnt-toolbox-voice-library .qvlib-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
}
#qqnt-toolbox-voice-library .qvlib-name {
    overflow: hidden;
    color: var(--voice-text);
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#qqnt-toolbox-voice-library .qvlib-meta {
    overflow: hidden;
    color: var(--voice-muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#qqnt-toolbox-voice-library .qvlib-actions {
    display: flex;
    align-items: center;
    gap: 1px;
}
#qqnt-toolbox-voice-library .qvlib-row-action {
    height: 26px;
    padding: 0 4px;
    border-color: transparent;
    background: transparent;
}
#qqnt-toolbox-voice-library .qvlib-send {
    color: var(--voice-accent);
}
#qqnt-toolbox-voice-library .qvlib-delete {
    color: var(--voice-danger);
}
#qqnt-toolbox-voice-library .qvlib-player {
    flex: 0 0 56px;
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) auto;
    grid-template-rows: 19px 16px;
    align-items: center;
    gap: 3px 10px;
    padding: 7px 11px 8px;
    border-top: 1px solid var(--voice-border);
    background: var(--voice-bg);
}
#qqnt-toolbox-voice-library .qvlib-player-toggle {
    grid-column: 1;
    grid-row: 1 / 3;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    color: var(--voice-muted);
    background: var(--voice-layer);
    gap: 3px;
}
#qqnt-toolbox-voice-library .qvlib-player-toggle::before {
    content: "";
    width: 0;
    height: 0;
    border-top: 5px solid transparent;
    border-bottom: 5px solid transparent;
    border-left: 8px solid currentColor;
    transform: translateX(1px);
}
#qqnt-toolbox-voice-library .qvlib-player-toggle::after {
    content: "";
    display: none;
}
#qqnt-toolbox-voice-library .qvlib-player-toggle[data-playing="true"]::before,
#qqnt-toolbox-voice-library .qvlib-player-toggle[data-playing="true"]::after {
    width: 2px;
    height: 10px;
    flex: 0 0 2px;
    border: 0;
    border-radius: 1px;
    background: currentColor;
    transform: none;
}
#qqnt-toolbox-voice-library .qvlib-player-toggle[data-playing="true"]::after {
    display: block;
}
#qqnt-toolbox-voice-library .qvlib-player-title {
    grid-column: 2;
    grid-row: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--voice-muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#qqnt-toolbox-voice-library .qvlib-player-time {
    grid-column: 3;
    grid-row: 1;
    color: var(--voice-faint);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}
#qqnt-toolbox-voice-library .qvlib-track {
    grid-column: 2 / 4;
    grid-row: 2;
    position: relative;
    height: 16px;
    display: flex;
    align-items: center;
    cursor: pointer;
}
#qqnt-toolbox-voice-library .qvlib-track::before {
    content: "";
    width: 100%;
    height: 4px;
    border-radius: 999px;
    background: var(--voice-border);
}
#qqnt-toolbox-voice-library .qvlib-progress {
    position: absolute;
    left: 0;
    top: 50%;
    width: var(--voice-progress, 0%);
    height: 4px;
    transform: translateY(-50%);
    border-radius: 999px;
    background: var(--voice-accent);
}
#qqnt-toolbox-voice-library .qvlib-thumb {
    position: absolute;
    left: var(--voice-progress, 0%);
    top: 50%;
    width: 8px;
    height: 8px;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: var(--voice-accent);
    box-shadow: 0 0 0 2px var(--voice-bg);
    opacity: 0;
}
#qqnt-toolbox-voice-library .qvlib-player.is-ready .qvlib-track:hover .qvlib-thumb,
#qqnt-toolbox-voice-library .qvlib-player.is-ready .qvlib-track:focus-visible .qvlib-thumb {
    opacity: 1;
}
#qqnt-toolbox-voice-library audio {
    display: none;
}
#qqnt-toolbox-voice-library .qvlib-footer {
    flex: 0 0 44px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 7px;
    padding: 7px 9px;
    border-top: 1px solid var(--voice-border);
    background: var(--voice-bg);
}
#qqnt-toolbox-voice-library .qvlib-footer button {
    width: 100%;
    height: 30px;
}
#qqnt-toolbox-voice-library .qvlib-toast {
    position: absolute;
    left: 50%;
    top: 51px;
    z-index: 7;
    max-width: calc(100% - 24px);
    overflow: hidden;
    padding: 6px 10px;
    transform: translate(-50%, -7px);
    border: 1px solid var(--voice-border);
    border-radius: 6px;
    color: var(--voice-text);
    background: var(--voice-bg);
    box-shadow: 0 7px 20px rgba(0, 0, 0, .2);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity .14s ease, transform .14s ease;
}
#qqnt-toolbox-voice-library .qvlib-toast.is-visible {
    transform: translate(-50%, 0);
    opacity: 1;
}
#qqnt-toolbox-voice-library .qvlib-toast.is-error {
    color: var(--voice-danger);
    border-color: color-mix(in srgb, var(--voice-danger) 58%, var(--voice-border));
}
#qqnt-toolbox-voice-library .qvlib-dialog-layer {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 22px;
    background: rgba(0, 0, 0, .24);
}
#qqnt-toolbox-voice-library .qvlib-dialog {
    width: 100%;
    max-width: 310px;
    padding: 14px;
    border: 1px solid var(--voice-border);
    border-radius: 8px;
    background: var(--voice-bg);
    box-shadow: 0 12px 30px rgba(0, 0, 0, .24);
}
#qqnt-toolbox-voice-library .qvlib-dialog-title {
    margin-bottom: 8px;
    color: var(--voice-text);
    font-size: 14px;
    font-weight: 600;
}
#qqnt-toolbox-voice-library .qvlib-dialog-message {
    margin-bottom: 10px;
    color: var(--voice-muted);
    font-size: 12px;
    overflow-wrap: anywhere;
    white-space: pre-line;
}
#qqnt-toolbox-voice-library .qvlib-dialog input {
    width: 100%;
    height: 32px;
    padding: 0 8px;
    border: 1px solid var(--voice-border);
    border-radius: 6px;
    outline: 0;
    color: var(--voice-text) !important;
    -webkit-text-fill-color: var(--voice-text) !important;
    caret-color: var(--voice-text);
    background: var(--voice-layer) !important;
    font: 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    letter-spacing: 0;
}
#qqnt-toolbox-voice-library .qvlib-dialog input:focus {
    border-color: var(--voice-accent);
    background: var(--voice-hover) !important;
}
#qqnt-toolbox-voice-library .qvlib-dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 7px;
    margin-top: 12px;
}
#qqnt-toolbox-voice-library .qvlib-dialog-confirm.is-danger {
    color: var(--voice-danger);
}
@media (max-width: 390px) {
    #qqnt-toolbox-voice-library .qvlib-row-action {
        padding: 0 3px;
        font-size: 11px;
    }
    #qqnt-toolbox-voice-library .qvlib-row {
        gap: 5px;
    }
}
`;

module.exports = VOICE_LIBRARY_PANEL_CSS;
