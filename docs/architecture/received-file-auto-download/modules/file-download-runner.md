# 文件下载执行器

review_status: implemented_automated_pending_live
review_scope: file-download-runner

## Role

接收已通过策略的候选，控制去重、并发、QQ 原生下载请求、完成事件关联、临时 staging 和撤回触发的持久晋升。

## Owns

- 按账号共享的有界任务状态，避免多窗口重复下载。
- 每账号最多 2 个并发取得任务；等待资产由 candidate journal 和内存去重表持有，不暴露并发设置。
- 在任务真正开始前重新执行策略判定。
- 通过消息与元素 identity 调用 `nodeIKernelMsgService/downloadRichMedia`，强制把自动防撤回下载目标设为插件私有 `staging/.acquiring` 绝对路径，并用 `onRichMediaDownloadComplete` 精确关联完成事件。
- 验证绝对本地路径、文件存在和实际大小；普通文件必须与消息声明大小完全一致。
- 输出 `staged | promoted | expired | failed | skipped` 结果事件。

## Does Not Own

- 群选择 UI、配置编辑或防撤回缓存结构。
- 自动打开、解压、执行文件。
- 未经证据支持的备用下载 API 或无限重试。

## Inputs And Preconditions

- `ReceivedFileCandidate` 和当前策略读取函数。
- 一个当前 QQNT 实机捕获确认过的 native adapter。
- 现有 `createNativeEventWaiter` / `qqNativeInvoke` 语义可复用。

## Outputs, Events, And Side Effects

```text
staged   { accountUin, peerUid, msgId, elementId, stagingPath, expiresAt, fileSize }
promoted { accountUin, peerUid, msgId, elementId, archivePath, fileSize }
expired  { jobKey, reason=no-recall }
failed   { jobKey, reason }
skipped  { jobKey, reason }
```

- QQ 从第一字节直接写入插件私有 acquisition 路径；完成校验后原子移动到 staging，只有对应消息实际撤回后才原子晋升到持久归档。
- 不覆盖、不删除用户选择的文件；插件 staging 使用基于 message/element identity 的 digest 路径。

## State And Data Rules

- `observed|blocked-capacity -> acquiring -> staged -> promoted|expired`；策略变化可 `discard` 尚未落盘的 asset，已撤回的 failed asset 可在恢复/重启时再次取得。
- 同一 job key 在 queued/running/staged/promoted 窗口内只执行一次。
- 已存在且大小与声明值相同的外部本地文件复制进入 staging，不移动或删除原文件；插件发起的自动下载只允许收养 `.acquiring` 内的目标文件。
- 完成事件必须同时匹配消息和元素；只匹配文件名不够。
- 普通文件要求实际大小等于声明大小；不沿用图片/视频的“可解码即接受大小差异”规则。
- 功能关闭或白名单/范围变更只阻止尚未开始的任务；已交给 QQ 的任务自然完成并上报。
- 撤回在下载完成前到达时设置 promotion 请求；下载完成后直接晋升，不受原 staging deadline 影响。
- 未撤回文件由共享 staging scheduler 到期删除；执行器不创建独立轮询器或目录扫描器。
- 未撤回任务失败后不循环重试；若随后发生撤回，允许为持久归档再尝试一次，避免后台重试风暴。

## Runtime Proof Boundary

当前 QQNT 已实机确认一个 18.13 MB 普通群文件遵守插件指定的 acquisition 路径，完成后以同一 inode 从 `.acquiring -> staging -> files` 晋升，QQ 普通下载目录没有自动副本。撤回记录已实机显示 QQ 原生“已下载”状态和红色撤回边框，原生右键菜单只保留一个“在 Finder 中显示”，悬浮文件夹入口也能进入 Finder。511/512 B、ZIP/JS/TXT/无扩展名、600 MB、慢下载中撤回和管理员延迟撤回仍属于扩大后的 live acceptance，不由当前 smoke 代替。

## Implementation Boundary

- `src/main.js` 的账号级队列负责策略重检、admission 和 QQ native orchestration。
- `src/anti-recall-staging.js` 负责 reservation、落盘校验、暂存和晋升；执行器不维护第二套文件生命周期。

## Proof

- 两个窗口看到同一候选只触发一次 adapter 调用。
- 并发上限和队列上限生效。
- 排队期间移除白名单会产生 `skipped`，不发起调用。
- 未撤回文件到期产生 `expired` 且不会进入持久归档；撤回文件产生 `promoted`。
- 撤回先于慢下载完成时，最终仍晋升。
- 下载完成原子移动期间到达撤回时，最终路径必须位于持久 `files/`，且 inode 不变、staging 不留副本。
- 相对路径、缺失文件、空文件和大小不符均失败。
- live proof 捕获真实请求、完成事件、最终路径和磁盘大小。
