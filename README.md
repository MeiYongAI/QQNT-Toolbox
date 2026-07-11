# QQNT Toolbox

A toolbox plugin for LiteLoaderQQNT. Press right Ctrl to open the draggable settings panel.

## Features

- Image retry: repairs failed image-only NoSeq messages by changing one visually indistinguishable pixel and resending to the original chat.
- Message repeat: adds a `+1` beside a message or `复读` to QQ's context menu, including native PTT voice repeat and real group mentions.
- Voice messages: drops audio/video files onto QQ's voice panel and sends the extracted audio as native PTT.
- Voice library: saves, previews, renames, organizes, and sends local voice items and folders.
- Voice saving: adds `保存` to the native context menu for QQ voice messages.
- Prevent recall: preserves recalled messages across navigation and restarts, marks them in chat, and provides a conversation-based viewer.
- Interface tools: configurable sidebar, toolbar, image viewer, navigation, message drag, bubble skin, and account-menu adjustments.

The former `QQNT-Voice-File-Sender` project has been merged into this plugin and is superseded by QQNT Toolbox.

## Installation

1. Download `QQNT-Toolbox-v0.6.2.zip` from Releases.
2. Extract the `QQNT-Toolbox` folder into `LiteLoaderQQNT/plugins`.
3. Install `ffmpeg` and make it available through `PATH`, or set `FFMPEG_PATH` to the full path of `ffmpeg.exe`.
4. Restart QQ.

The release archive already includes the required `silk-wasm` runtime.

## Data

Plugin settings, recall data, and the voice library are stored under:

```text
LiteLoaderQQNT\data\qqnt_toolbox
```

Voice library files are stored under:

```text
LiteLoaderQQNT\data\qqnt_toolbox\voice\library\voices
```

## Credits

- [QAuxiliary](https://github.com/cinit/QAuxiliary): NoSeq image retry and repeat-message behavior references.
- [lite-tools](https://github.com/xiyuesaves/lite-tools): prevent-recall persistence, interface tools, and recall-viewer references.
- [LiteLoaderQQNT-Audio-Sender](https://github.com/xtaw/LiteLoaderQQNT-Audio-Sender): original voice-file sender concept and early implementation reference.
- [silk-wasm](https://www.npmjs.com/package/silk-wasm): Silk codec runtime included in release archives under its own license.

## License

QQNT Toolbox is distributed under the [GNU Affero General Public License v3.0](LICENSE).
