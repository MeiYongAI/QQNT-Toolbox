# 防撤回资产持久归档

review_status: implemented_automated_pending_live
review_scope: durable-archive

## Role

把已经发生撤回并完成 promotion 的图片和普通文件写入插件控制的账号级归档目录，使 QQ 重启和缓存清理不会移除资产；归档文件一直保留到用户手动删除。

## Owns

- 账号隔离的 `files/` 与 `images/` 归档目录。
- 临时文件写入、大小校验、原子重命名和已存在资产复用。
- 归档路径与原消息 `msgId + elementId` 的关联元数据。
- “打开归档目录”和用户手动删除后的缺失状态投影。

## Does Not Own

- 自动清理、按时间过期、总容量淘汰或后台重新下载已被用户删除的资产。
- 未撤回图片和文件的临时 staging；该生命周期由共享 staging 模块管理。
- 文件是否满足群白名单和大小策略。
- 自动打开、执行或解压归档内容。

## Inputs And Preconditions

- 普通文件已经通过群白名单与大小策略，并且图片或文件已经收到对应撤回事件并请求 promotion。
- 内容已经从 QQ 本地路径、QQ native 下载结果或经过验证的远端响应取得。
- 普通文件必须有声明大小且落盘大小完全一致；图片至少要求非零本地内容，声明大小存在时用于选择更完整的来源。

## Outputs, Events, And Side Effects

```text
archived { accountUin, msgId, elementId, assetKind, archivePath, observedSize }
failed   { assetKey, reason }
missing  { assetKey, reason=user-deleted }
```

- 成功结果只返回插件归档中的绝对路径，不把 QQ 易失缓存路径当作最终路径。
- 未撤回图片和文件不会调用本模块的持久写入接口。
- 用户手动删除归档文件后，记录保留但显示资产缺失；插件不会静默恢复同一旧记录。

## State And Data Rules

- 状态机：`staging -> verified -> archived`，任一步失败进入 `failed`。
- 写入同目录临时文件，验证完成后原子重命名；进程中断留下的 archive `.tmp-*` 文件在下次启动清理。
- 相同内容可以复用一个物理文件，但每条消息保留独立的元素关联。
- 归档目录不设置自动过期时间或自动容量回收。
- 图片从同文件系统 staging 晋升时优先使用原子重命名，不产生第二份长期副本。
- 新收到的同内容消息仍按新事件正常处理；“用户删除”只影响被删除的旧归档路径。

## Implementation Boundary

- `src/anti-recall-staging.js` 同时负责图片和普通文件的同文件系统晋升。
- `src/main.js` 只向 staging manager 提交来源路径并把归档结果回写到 canonical message snapshot。

## Proof

- QQ 重启和 QQ 缓存清理后，撤回记录仍能打开归档图片和文件。
- 未撤回图片和文件不会出现在持久归档目录。
- 归档资产不会随时间自动删除；只有用户手动删除或清空功能触发删除。
- 中断写入不会产生被当作成功的半文件。
- 用户删除后显示缺失，不从旧 CDN 或旧 QQ 缓存静默复活。
