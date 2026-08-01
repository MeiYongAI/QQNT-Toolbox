# 文件下载执行器

review_status: implemented_automated_pending_live
review_scope: file-download-runner

## Role

接收已通过策略的候选，控制去重、并发、QQ 原生下载请求、完成事件关联、临时 staging 和撤回触发的持久晋升。

## Owns

- 按账号共享的有界任务状态，避免多窗口重复下载。
- 每账号最多 2 个并发取得任务；等待资产由 candidate journal 和内存去重表持有，不暴露并发设置。
- 在任务真正开始前重新执行策略判定。
- 通过完整 message visit context 调用 `downloadRichMediaInVisit`，并从返回值、native 更新后的 element 路径或已验证远端结果取得绝对本地路径。
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

- QQ 下载结果进入插件临时 staging；只有对应消息实际撤回后才晋升到持久归档。
- 不覆盖、不删除用户选择的文件；插件 staging 使用基于 message/element identity 的 digest 路径。

## State And Data Rules

- `observed|blocked-capacity -> acquiring -> staged -> promoted|expired`；策略变化可 `discard` 尚未落盘的 asset，已撤回的 failed asset 可在恢复/重启时再次取得。
- 同一 job key 在 queued/running/staged/promoted 窗口内只执行一次。
- 已存在且大小与声明值相同的 QQ 本地文件直接进入 staging，不再请求 QQ。
- 完成事件必须同时匹配消息和元素；只匹配文件名不够。
- 普通文件要求实际大小等于声明大小；不沿用图片/视频的“可解码即接受大小差异”规则。
- 功能关闭或白名单/范围变更只阻止尚未开始的任务；已交给 QQ 的任务自然完成并上报。
- 撤回在下载完成前到达时设置 promotion 请求；下载完成后直接晋升，不受原 staging deadline 影响。
- 未撤回文件由共享 staging scheduler 到期删除；执行器不创建独立轮询器或目录扫描器。
- 未撤回任务失败后不循环重试；若随后发生撤回，允许为持久归档再尝试一次，避免后台重试风暴。

## Runtime Blocker

当前实现复用项目已有的 `downloadRichMediaInVisit` visit payload 和路径等待语义，但当前 QQNT 普通群文件的真实返回值、路径更新和 600 MB 行为仍需实机捕获。该捕获完成前只能标记为 source/automated complete，不能宣称 live-confirmed。

## Implementation Boundary

- `src/main.js` 的账号级队列负责策略重检、admission 和 QQ native orchestration。
- `src/anti-recall-staging.js` 负责 reservation、落盘校验、暂存和晋升；执行器不维护第二套文件生命周期。

## Proof

- 两个窗口看到同一候选只触发一次 adapter 调用。
- 并发上限和队列上限生效。
- 排队期间移除白名单会产生 `skipped`，不发起调用。
- 未撤回文件到期产生 `expired` 且不会进入持久归档；撤回文件产生 `promoted`。
- 撤回先于慢下载完成时，最终仍晋升。
- 相对路径、缺失文件、空文件和大小不符均失败。
- live proof 捕获真实请求、完成事件、最终路径和磁盘大小。
