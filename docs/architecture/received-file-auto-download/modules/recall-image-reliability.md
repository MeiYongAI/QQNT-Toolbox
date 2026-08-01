# 图片防撤回可靠性

review_status: implemented_automated_pending_live
review_scope: recall-image-reliability

## Source-Confirmed Failure Model

- 当前 `cacheRecallCandidate()` 只保存消息快照，不在原消息到达时启动图片归档。
- 图片本地化主要由 `getRecoveredRecallRecord()` 在撤回事件已经到达后调用；撤回很快时，本地缓存可能尚未形成或已经失效。
- 远端回退依赖 `originImageUrl`。当前真实持久化记录中的 152 个图片元素里，只有 13 个仍有可用本地路径；139 个本地路径已经缺失。
- 其中 144 个使用 NT `/download?appid=1407` 形状且没有 `rkey`，8 个是旧式 `gchatpic_new`；当前代码使用的外部 rkey 服务返回 `error code: 525`，因此 NT 图片 URL 无法被当前 resolver 转换为可下载地址。
- 异步归档即使在撤回后完成，也只更新内存/持久化记录；当前路径没有证明已经渲染的消息气泡会被主动刷新。

## Conclusion

“撤回太快”是实际竞争条件之一，但不是唯一原因。QQ 图片确实经 CDN 展示，不过 NT 图片链接通常依赖短期鉴权参数；保存一个缺少有效 `rkey` 的 URL 不等于保存了图片内容，CDN 也不构成长期归档合同。

## Canonical Design

1. 原消息通过实时 `onRecvMsg` 到达时立即保存消息快照。
2. 同一同步路径先把已经存在的完整本地图片或缩略图复制到账号级临时 staging；这不是持久归档。
3. 本地内容不完整时，立即通过当前 QQ runtime 的 native 图片下载能力把内容补齐到 staging，而不是等待撤回后再依赖第三方 rkey 服务。
4. staging 使用有界 TTL 和容量；消息在窗口内没有撤回时，图片自动过期删除，不进入持久归档。
5. 撤回事件到达时，把 candidate 标记为 `recalled`；已经验证完成的 staging 文件通过同文件系统原子重命名进入持久归档，仍在下载的任务完成后立即晋升。
6. 晋升完成后把归档路径回写到 recalled snapshot；若撤回先于任务完成，保留明确 pending 状态，并在完成后走经过实机证明的消息更新路径刷新当前记录。
7. 已经自带可用鉴权并通过响应校验的 CDN URL 只作为最后回退，不作为长期真源。

## Non-Goals

- 不把外部公共 rkey 服务作为生产依赖。
- 不假定任意 CDN URL 永久有效。
- 不在撤回完成之后才开始唯一一条图片保存路线。
- 不把所有收到但未撤回的图片永久保存。

## Proof

- 分别在图片到达后立即撤回、100 ms 后撤回、1 秒后撤回，归档与恢复均成功。
- 未撤回图片只存在于 staging，超过 TTL 后被删除，持久归档目录没有对应文件。
- 图片本地路径为空、QQ 缓存路径缺失、NT URL 缺少 rkey 时，native 下载路线仍能归档。
- 归档完成晚于撤回事件时，当前消息气泡和持久化查看器最终都指向同一归档文件。
- QQ 重启、清理 QQ 缓存后图片仍可打开；手动删除归档后显示缺失。
