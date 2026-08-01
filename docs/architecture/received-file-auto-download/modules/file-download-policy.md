# 文件下载策略

review_status: implemented_automated
review_scope: file-download-policy

## Role

把用户配置和收到的文件候选转换为一个确定的 `download | skip` 判定，不接触 QQ native API 或文件系统。

## Owns

- `receivedFileAutoDownload` 配置规范化。
- 仅允许群聊身份的独立白名单。
- `B`、`KB`、`MB`、`GB` 十进制输入字符串到整数 bytes 的 1024 进制精确换算。
- 下限和上限的闭区间判定。
- 文件格式无关：文件名、扩展名、MIME、内容类型均不参与判定。
- 稳定、可测试的跳过原因。

## Does Not Own

- 联系人/群列表读取和选择 UI。
- 消息事件监听。
- 下载、队列、重试、保存目录或防撤回缓存。

## Inputs And Preconditions

- 配置：`enabled`、`groups`、`sizeRange.min`、`sizeRange.max`。
- 候选：`chatType`、`peerUid`、`fileSizeBytes`。策略接口不接收文件名、扩展名或 MIME。
- `groups` 只接受 `chatType=2` 且群号/peer UID 非空的项，最多 256 个。

## Outputs, Events, And Side Effects

```text
{ matched: true, minBytes, maxBytes }
{ matched: false, reason: disabled | group-missing | group-not-selected |
  size-unknown | empty-file | below-min | above-max | invalid-config }
```

无副作用。

## State And Data Rules

- 单位集合固定为 `B | KB | MB | GB`。
- `value` 使用普通十进制字符串，不接受指数、负数、空值或超过 3 位小数。
- 通过十进制有理数乘以单位因子精确换算；结果必须是整数 bytes，不做四舍五入。例如 `0.5 KB = 512 B`，`0.1 KB` 因结果不是整数 byte 而拒绝。
- 文件下限不得小于 `1 B`；零字节文件按 `empty-file` 跳过。
- 默认策略下限为 `0.5 KB = 512 B`，候选 `511 B` 跳过，`512 B` 命中闭区间边界。
- 单文件硬上限为 `600 MB = 629145600 B`；UI 配置的上限不得超过该值。`0.5 GB = 512 MB` 合法，`1 GB` 超过硬上限。
- `minBytes <= maxBytes` 才是合法范围。
- 边界包含：`size === minBytes` 和 `size === maxBytes` 都匹配。
- 对同一群身份和同一文件大小，`.zip`、`.js`、`.txt`、无扩展名及其他普通文件必须得到相同判定。
- 不维护文件类型白名单、黑名单或危险扩展名分支；自动下载只由功能开关、群白名单、合法大小和大小闭区间决定。
- 手工损坏的配置按 `invalid-config` 失败关闭，不交换上下限、不猜单位。
- 群显示名只用于 UI，身份使用 `2:<peerUid>`。

## Implementation Boundary

- 实现在 `src/anti-recall-preservation-config.js`，通过公开函数测试。
- `src/prevent-recall.js` 不包含文件大小、文件格式或自动下载白名单策略。

## Proof

- `1 B`、`0.5 KB`、`512 B`、`1 MB`、`0.5 GB` 的精确换算。
- `1024 KB === 1 MB` 的跨单位比较。
- `0.5 KB === 512 B`，且 `0.1 KB` 因非整数 byte 被拒绝。
- `600 MB` 可作为上限，超过 `600 MB` 的配置或候选均跳过。
- 默认范围验证 `511 B` 跳过、`512 B` 命中、`600 MB` 命中。
- 下限、上限、上下限外各一条测试。
- 同一大小的 `.zip`、`.js`、`.txt`、无扩展名文件均匹配，且判定结果完全一致。
- 空白名单、私聊、零字节、未知大小、非法单位、非整数 byte 结果、上下限反转均跳过。
