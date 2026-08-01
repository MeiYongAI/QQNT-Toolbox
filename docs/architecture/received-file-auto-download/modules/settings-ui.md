# 文件自动下载设置界面

review_status: implemented_automated
review_scope: settings-ui

## Role

提供独立、可枚举的群文件自动下载设置，不把它伪装成防撤回名单的一个附属开关。

## Owns

- “文件自动下载”设置分组。
- 启用开关。
- 独立的群白名单管理入口，只显示群聊。
- 下限十进制数值 + 单位、上限十进制数值 + 单位的复合编辑；单位支持 B/KB/MB/GB。
- 共享“防撤回保护窗口”数值 + `分钟/小时/天` 单位，默认 `24 小时`。
- 账号级 staging 总容量数值 + `MB/GB` 单位，默认 `5 GB`。
- 选中群数量与有效大小范围摘要。
- 当前 staging 已用/已预留/总容量、容量阻塞任务数、候选数量、最近到期时间和电源模式摘要。
- 非法范围的行内错误和禁止提交。

## Does Not Own

- 联系人数据源、下载状态机或磁盘文件。
- 自动修正上下限、推测单位或链接防撤回名单。
- 文件扩展名、MIME、内容类型白名单或黑名单设置；产品不提供这类过滤维度。
- 为图片和文件分别创建语义重复的保护窗口；当前实现使用一个共享窗口。

## Inputs And Preconditions

- 当前配置和 QQ 群列表。
- `antiRecallPreservation.stagingWindow`、`antiRecallPreservation.stagingCapacity` 与 staging runtime status。
- 通用群选择编辑器；若从 `recall-filter-editor.js` 抽取，防撤回也迁移到新 canonical editor。

## Outputs, Events, And Side Effects

- 整个 `sizeRange` 对象一次性保存，避免瞬时非法范围。
- 整个 `stagingWindow` 对象一次性保存；运行时异步重算任务 deadline，不在设置保存 IPC 中同步删除文件。
- 整个 `stagingCapacity` 对象一次性保存；缩小时只更新额度并触发暂停判断，不在设置保存 IPC 中同步删除文件。
- 群选择保存到 `receivedFileAutoDownload.groups`，不修改 `preventRecall.filterPeers`。
- 设置保存仍走现有完整配置 IPC。

## State And Data Rules

- 功能默认关闭。
- 白名单为空时摘要明确显示“未选择群，当前不会下载”。
- 文件大小单位固定为 B、KB、MB、GB。
- 保护窗口单位固定为分钟、小时、天；数值只接受整数，换算后必须落在 5 分钟到 30 天。
- staging 容量单位固定为 MB、GB；数值保存为最多 3 位小数的十进制字符串，必须精确换算成整数 bytes，默认 `5 GB`。
- 文件大小数值保存为十进制字符串，最多 3 位小数；换算必须得到整数 bytes，不做隐式舍入。
- 文件下限至少 `1 B`，单文件上限至多 `600 MB`；默认范围为 `0.5 KB ～ 600 MB`。
- 上限小于下限、结果包含部分 byte 或超过 600 MB 时显示错误，并保留上一个已保存的合法范围。
- 缩短窗口时显示“部分未撤回暂存将异步到期”；延长窗口不承诺恢复已经删除的暂存。
- 容量不足时显示“暂存容量已满，新的图片和文件已暂停”，并显示阻塞数量；不得自动建议或执行淘汰保护窗口内资产。
- 用户把容量调低到当前占用以下时显示明确确认文案：已有资产不删除，新的取得暂停到占用降低或再次扩容。
- 设置页与悬浮面板使用同一配置和相同行为。

## Implementation Boundary

- `src/renderer.js` 组装复合数值控件、校验、摘要和状态投影。
- `src/recall-filter-editor.js` 提供可限制 `allowedChatTypes: [2]` 的共享群选择器。
- 新增 IPC 只覆盖 runtime status 与 helper 卸载；配置仍走既有完整配置保存通道。

## Proof

- 配置解析、群选择器约束、IPC/preload 和 renderer source contract 有自动测试；真实 QQ DOM 交互仍需实机确认。
- 切换单位、`0.5 KB`、1 B/600 MB 边界、部分 byte、非法范围、空白名单、保存后重载均有测试。
- 保护窗口的分钟/小时/天等价换算、5 分钟下界、30 天上界、缩短/延长摘要均有测试。
- staging 容量的 MB/GB 等价换算、5 GB 默认值、保存重载、低于当前占用时暂停且不删除、扩容后恢复均有测试。
- 设置 UI 不出现文件格式过滤控件。
- 设置 UI 不包含防撤回名单状态的直接读写。
