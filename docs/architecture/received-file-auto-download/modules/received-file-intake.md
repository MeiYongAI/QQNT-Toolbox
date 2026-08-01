# 实时群文件入口

review_status: implemented_automated_pending_live
review_scope: received-file-intake

## Role

只从 QQNT 实时接收事件中提取普通群文件，在策略命中后登记 restart-safe candidate 并排队取得资产。

## Owns

- `context.commandNames` 必须包含 `nodeIKernelMsgListener/onRecvMsg`。
- 遍历 `context.records` 和每个记录的全部 elements。
- 识别存在 `fileElement` 的普通文件。
- 规范化群、消息、元素、文件名、文件大小和候选本地路径。
- 不根据文件名后缀、MIME 或内容类型排除普通文件。

## Does Not Own

- 白名单和大小判定。
- QQ native 下载细节、落盘和晋升。
- 撤回替换本身。

## Inputs And Preconditions

- 来自 `createNativeEventContext` 的 `records` 与 `commandNames`。
- 当前窗口必须已解析出 `accountUin`。

## Outputs, Events, And Side Effects

- 每个普通文件 element 登记一个独立 asset；混合消息和多文件消息共享消息 snapshot，但不合并文件任务。
- 非实时事件、非群聊、缺少 `msgId`、群身份或合法大小的记录不登记文件 asset。
- `elementId` 缺失时使用稳定的 element index 作为当前消息内 fallback identity。

## State And Data Rules

- 不能只用文件名去重；首选 `accountUin + peerUid + msgId + elementId`。
- 文件大小接受 QQ 提供的安全整数或其十进制字符串表示；未知、零、负数和非安全整数均跳过。
- `fileName` 只用于展示、日志脱敏和本地路径关联，不参与是否下载的判定。
- 历史消息列表更新 `onMsgInfoListUpdate` 不属于本模块的下载触发面。

## Implementation Boundary

- 纯策略与身份规范化位于 `src/anti-recall-preservation-config.js`。
- `src/main.js` 的 `processAntiRecallPreservationIntake()` 负责把共享 native context 交给 staging 与队列。

## Proof

- 实时群文件输出候选。
- `.zip`、`.js`、`.txt`、无扩展名文件均按普通文件输出候选。
- 同一消息两个文件输出两个候选。
- 图片、视频、语音、私聊和历史加载不输出候选。
- 缺少群身份、消息 ID 或文件大小时失败关闭；缺少元素 ID 时使用 element index。
