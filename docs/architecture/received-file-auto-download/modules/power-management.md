# 防撤回后台电源生命周期

review_status: implemented_automated_pending_live
review_scope: power-management

## Role

在文件自动下载或消息/图片防撤回可能产生任务时保持 QQNT/Electron 进程可运行，避免系统因空闲休眠而错过实时事件；同时把“屏幕熄灭”“系统空闲休眠”和“Mac 物理关盖”作为不同电源状态处理。

## Owns

- 一个进程级、全局唯一的 Electron `powerSaveBlocker` ID。
- 根据规范化配置计算 `required = preventRecall.enabled || (receivedFileAutoDownload.enabled && groups.length > 0)`。
- `required` 从 false 变 true 时调用 `powerSaveBlocker.start('prevent-app-suspension')`。
- `required` 从 true 变 false 时调用 `powerSaveBlocker.stop(id)` 并清空 ID。
- QQ 退出前释放 blocker；重复配置广播和多窗口安装不得创建多个 blocker。
- 向设置界面投影“后台保持运行中/当前未保持”的只读状态。
- 检测并投影当前模式只覆盖空闲休眠，还是已经通过单独验证的 closed-lid 模式。

## Does Not Own

- 显示器常亮；不使用 `prevent-display-sleep`。
- 把普通 Electron idle-sleep assertion 描述成已覆盖 Mac 关盖。
- 未经用户选择和实机证明就修改系统级 `SleepDisabled` 状态。
- 覆盖关机、退出 QQ 或网络断开。
- 睡眠期间的补拉取和历史回填。

## Inputs And Preconditions

- 规范化后的 `receivedFileAutoDownload.enabled` 和群白名单数量。
- Electron main process 的 `powerSaveBlocker`。
- 当前 Mac 的 clamshell 状态和系统电源断言；本机目前报告 `AppleClamshellCausesSleep=Yes`。

## Outputs, Events, And Side Effects

- 有效策略期间创建一个操作系统电源断言，增加待机耗电，但允许屏幕正常关闭。
- 策略失效或 QQ 退出时释放断言。
- `prevent-app-suspension` 只证明阻止空闲休眠。普通物理关盖仍会进入系统睡眠，QQ renderer、网络和插件任务随之暂停。
- closed-lid 路线已实现为首次显式管理员授权的特权电源 helper，仅在外接电源下生效，并具有状态快照、PID 存活检查、退出恢复、异常恢复和卸载回滚；仍需当前 Mac 的真实关盖收发与系统日志证明。
- 状态变化写入脱敏诊断事件，不记录群号。

## State And Data Rules

- 状态机：`released -> held -> released`。
- `held` 状态必须对应一个仍由 `powerSaveBlocker.isStarted(id)` 确认有效的 ID。
- blocker 属于整个插件进程，不按窗口、账号、群或任务创建。
- 文件自动下载启用但白名单为空，且防撤回关闭时不持有 blocker，因为此时没有合法后台任务。
- 仅有 `prevent-app-suspension` 时，关盖后醒来只继续处理 QQ 实际重新投递的事件；不把历史扫描当作补偿机制。
- 特权 helper 路线若被选择，默认只在外接电源下生效，且插件退出、功能关闭、崩溃恢复和卸载都有明确回滚。

## Implementation Boundary

- `src/main.js` 持有全局 Electron blocker，并只在启动、配置保存和退出时同步状态。
- `src/macos-closed-lid-helper.js` 独立封装 helper/plist 生成、管理员安装、request 文件、状态和卸载。
- 卸载仅在存在本 helper 写入的 `applied-<uid>` 标记时恢复 `pmset`，避免 helper 从未改值时覆盖用户原设置。

## Proof

- 启用并选群只创建一个 `prevent-app-suspension` blocker。
- 只启用防撤回时同样持有一个 blocker，不创建第二个。
- 重复 `sync()`、多窗口创建和配置广播不增加 blocker 数量。
- 屏幕熄灭时系统保持唤醒，仍能接收并下载测试文件。
- 关闭功能、清空白名单和退出 QQ 均释放 blocker。
- 单独完成关盖测试：关盖期间由另一账号发送文字、图片和文件并随后撤回，开盖后证明接收时间发生在关盖区间且三类内容均已保存；`pmset`/系统日志同时证明设备没有进入 sleep。
- 若 closed-lid helper 改变系统设置，功能关闭、QQ 退出、崩溃后恢复和卸载均恢复原值。
