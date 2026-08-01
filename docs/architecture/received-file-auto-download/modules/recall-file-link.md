# 防撤回文件衔接

review_status: implemented_automated_pending_live
review_scope: recall-file-link

## Role

把下载执行器的成功结果应用到防撤回缓存中的对应文件 element，使恢复消息使用已验证的本地文件路径。

## Owns

- 根据 `accountUin + msgId + elementId` 查找 live/recalled 缓存记录。
- 仅更新匹配 file element 的本地路径字段。
- 若消息已持久化或已撤回，按现有持久化规则更新记录。

## Does Not Own

- 下载是否应该发生。
- 下载队列、文件完整性或群名单。
- 改变防撤回开关的启用范围。

## Inputs And Preconditions

- 下载执行器的 `completed` 结果已通过真实磁盘大小校验。
- 防撤回缓存可能不存在、消息可能尚未撤回或已经撤回。

## Outputs, Events, And Side Effects

- 找到记录：插件元数据记录归档路径，并只把 QQ native `filePath` 投影为同一已验证绝对路径；不同时写入 `sourcePath/originPath/localPath/path`。
- 文件状态投影为当前 QQ 的本地完成值 `transferStatus = 4`、`progress = 0`、`invalidState = 0`，复用原生“已下载”、左键打开、右键和悬浮 Finder 行为。
- candidate 不存在：不回写；取得任务返回缺失/过期。
- 已持久化记录：追加当前 canonical cache revision，加载时以最后一条记录为准，不产生第二套文件索引。
- 撤回恢复后若 QQ 再发送完整消息 update，保留 recall marker 的同时重新应用已存在的归档图片/文件路径，避免 live bubble 退回 QQ 易失路径。

## State And Data Rules

- 该模块是两个独立功能之间的窄适配器；自动下载不得读取防撤回名单，防撤回不得控制下载策略。
- 不能按文件名更新，因为同一消息可有重名文件或多个元素。
- 只通过同一 candidate 中的 `elementId` 或 element index 定位，不按文件名跨记录覆盖。

## Implementation Boundary

- `src/anti-recall-staging.js` 的 `applyAssetPath()` 只修改匹配 element。
- `src/main.js` 的 `syncPreservationCandidateRecord()` 把更新后的 snapshot 投影回 live/recalled Map 和持久化缓存。

## Proof

- 下载先完成、后撤回：恢复记录携带本地路径。
- 撤回先发生、下载后完成：已恢复记录被更新并重新持久化。
- 撤回后的后续完整消息 update 继续使用归档路径。
- 原生文件气泡显示“已下载”并保留撤回红边；右键菜单没有插件重复项，悬浮文件夹入口不被插件根节点 click handler 截获。
- 同一消息多个文件只更新匹配 element。
- 防撤回未启用但文件策略命中时，仍创建保护窗口内的文件消息 candidate；只有真实撤回后才进入持久归档。
