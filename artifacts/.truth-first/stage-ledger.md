# Anti-recall preservation stage ledger

| Stage | Input | Action | Output | Proof | Status |
| --- | --- | --- | --- | --- | --- |
| Upstream sync | fork v0.9.0 | fast-forward from upstream | v0.9.1 baseline | HEAD baseline `c7d7406` | passed |
| Policy | 0.5 KB to 600 MB contract | implement exact unit parsing, group whitelist and format-independent selection | `anti-recall-preservation-config.js` | boundary/unit tests | passed |
| Lifecycle | 24 h window and 5 GB account cap | implement journal, reservations, single-account timer, expiry and recall promotion | `anti-recall-staging.js` | restart/capacity/race/10k scheduler tests | passed |
| Native integration | real-time `onRecvMsg` context | capture before recall replacement, recheck policy, invoke visit download, verify file size and write back paths | main-process orchestration | source integration tests; real QQ route pending | automated passed / live pending |
| UI and power | accepted configurable settings and AC-only closed-lid mode | add group-only editor, range/window/capacity/status UI, Electron blocker and helper lifecycle | renderer/preload/helper | IPC/source tests, shell syntax and plist lint | automated passed / live pending |
| Regression | baseline has known macOS path failures | run current and detached-baseline suites, compare unique failure names | no new regression | current 340/324/16 vs baseline 309/293/16; equal failure set | passed |
| Package | version 0.10.0 | build equivalent release layout and inspect ZIP | `dist/QQNT-Toolbox-v0.10.0.zip` | 105 entries, `unzip -t`, SHA-256 recorded | passed |
| Delivery | reviewed working tree | stage once, create one functional commit and push feature branch | remote fork branch | clean status + remote SHA | active |
| Live acceptance | built archive and configured QQNT | ZIP/JS/TXT/no-extension, 511/512 B, 600 MB, fast recall, delayed admin recall, restart, capacity and AC closed-lid scenarios | target-owned proof packet | QQNT and system power logs | pending |
