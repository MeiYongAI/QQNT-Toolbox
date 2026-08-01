# 评审状态

overall_status: implementation_complete_live_smoke_passed

## 模块

| 模块 | 状态 | 实现 |
| --- | --- | --- |
| file-download-policy | automated | `src/anti-recall-preservation-config.js` |
| received-file-intake | source + contract test | `processAntiRecallPreservationIntake()` |
| file-download-runner | live-confirmed for 18.13 MB single-copy route | `queuePreservationAsset()` / `downloadRichMedia` |
| durable-archive | automated | `src/anti-recall-staging.js` |
| recall-image-reliability | source complete; fast-recall live pending | receipt-stage image acquisition and promotion |
| staging-lifecycle | automated | restart, capacity, reservation, one-timer and expiry tests |
| power-management | source complete; administrator and closed-lid live pending | Electron blocker + macOS LaunchDaemon helper |
| recall-file-link | source + contract test; live pending | staged/archive path writeback into live and recalled snapshots |
| settings-ui | source + preload contract tests | renderer, settings CSS, IPC and group-only selector |

## 已固化产品合同

1. 文件下载只看功能开关、独立群白名单和大小闭区间，不看扩展名、MIME 或内容类型。
2. 默认范围为 `0.5 KB` 到 `600 MB`，1024 进制，最多三位小数且必须精确到整数 byte。
3. 图片和文件先进入按账号 staging；未撤回资产到期删除，撤回资产晋升后一直保留到手动清理。
4. 保护窗口默认 24 小时，可配置 5 分钟到 30 天；容量默认每账号 5 GB，可配置 MB/GB。
5. 容量在 native 取得前按声明大小预留；满额暂停，不淘汰保护期内资产；撤回任务绕过 staging 容量直达归档。
6. expiry 使用最小堆、单 timer 和有界批次；新增更晚任务不会重复重置 timer。
7. 防撤回或有效群文件策略启用时持有 `prevent-app-suspension`。
8. macOS 关盖 helper 需显式管理员授权，仅接电请求 `disablesleep`，关闭、退出、崩溃恢复和卸载均走回滚路径。

## 自动验证

- 精确单位换算、511/512 B、600 MB、非法小数、跨单位区间、群白名单和格式无关。
- restart-safe candidate journal、原子复制/晋升、容量预留、实际文件大小校验、暂停/恢复和一万个候选单 timer。
- preload/IPC/status/helper/UI source contract。
- `npm run check`：63 个 JavaScript 文件通过语法检查。
- 当前分支 `npm test`：340 tests / 324 pass / 16 fail；`c7d7406` 基线为 309 tests / 293 pass / 16 fail，16 个失败名称逐项一致，新增 31 个测试全部通过。
- helper shell 通过 `/bin/sh -n`，生成的 LaunchDaemon plist 通过 `plutil -lint`。
- release 等价构建生成 `dist/QQNT-Toolbox-v0.10.0.zip`，105 个条目，`unzip -t` 通过并包含三个新增 runtime 模块。

## 剩余实机证明

- 已确认当前 QQNT 的 18.13 MB 普通群文件自动下载遵守插件私有目标路径，撤回后显示原生“已下载”加红边，右键只有原生 Finder 菜单，悬浮 Finder 入口路由正确。
- 真实验证 ZIP、JS、TXT、无扩展名、511/512 B、600 MB、下载中撤回和管理员延迟撤回。
- 真实验证快速图片撤回、QQ 重启、容量暂停/恢复和撤回后路径回写。
- 真实触发管理员安装 helper，并在 AC 接电关盖区间接收、撤回文字/图片/文件；同时用 `pmset`/系统日志证明没有进入 sleep，最后验证关闭、退出、崩溃和卸载恢复。
