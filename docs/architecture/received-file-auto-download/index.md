# 群文件自动下载：架构评审索引

review_status: implementation_complete_pending_live_acceptance
baseline_fork_commit: c7d7406
recommended_upstream_baseline: c7d7406 (v0.9.1)

## 目标

当 QQNT 实时收到消息时，先把可恢复的消息快照写入 restart-safe candidate journal，并把图片放入临时 staging。对配置白名单群聊中的普通文件，无论文件扩展名或内容类型，只要文件大小落在闭区间内，也立即下载到 staging。bounded 模式下，图片和文件只有在对应消息实际撤回后才晋升到持久归档；管理员未来是否撤回无法预知，因此保护期限必须明确声明。

## 范围

- 只处理实时 `nodeIKernelMsgListener/onRecvMsg`，不因打开会话或滚动历史记录批量下载旧文件。
- 只处理群聊 `chatType === 2`。
- 文件自动下载只处理普通文件元素 `fileElement`；图片由同一防撤回 staging 生命周期提前保全，视频和语音不进入本功能。
- 白名单与防撤回名单分别配置；两者可以复用群选择组件，但不得共享同一份业务状态。
- 每个上下限分别支持 `B`、`KB`、`MB`、`GB`，按 1024 进制精确换算；支持 `0.5 KB` 这类最多 3 位小数的输入，但最终必须得到整数 byte，不做舍入。
- 默认文件范围为 `0.5 KB ～ 600 MB`，即 `512 B ～ 629145600 B`；600 MB 是单文件硬上限，零字节文件跳过。
- 普通文件的文件名、扩展名、MIME 和内容类型不参与下载判定；`.zip`、`.js`、`.txt`、无扩展名等一视同仁。
- QQ 原生下载完成后必须校验事件中的消息/元素身份、本地路径和实际文件大小。
- 插件发起的自动下载从第一字节写入账号级 `staging/.acquiring`，完成校验后原子进入 staging；撤回时再原子晋升到归档。只有用户手动下载继续使用 QQ 普通下载路径。
- 未撤回图片和文件只在有界 staging 中短暂存在，到期自动删除；不会永久复制所有匹配资产。
- 当前内存 `liveMessages` 不足以覆盖 QQ 重启后的延迟管理员撤回；保护窗口内的候选消息必须写入轻量 journal。
- 候选消息、图片和文件共用一个 UI 可配置保护窗口，默认 `24 小时`，支持整数分钟、小时和天，最终范围为 5 分钟到 30 天。
- 插件自有 staging 按账号设置总容量，默认 `5 GB = 5368709120 B`；UI 支持 MB/GB。容量不足时保留候选元数据并暂停新的图片/文件取得，绝不静默淘汰保护窗口内的已有资产；空间释放后按优先级恢复。
- 防撤回启用，或文件自动下载启用且白名单非空时，Toolbox 持有一个全局 `prevent-app-suspension` 电源断言；该断言覆盖空闲休眠，不把普通 Mac 物理关盖冒充成已覆盖状态。物理关盖由独立、AC-only、显式管理员授权的 helper 处理。

## 非目标

- 不自动打开、执行或解压下载文件。
- 不下载私聊、频道、临时会话或未列入白名单的群文件。
- 不把聊天历史加载当作实时接收。
- 不加入扩展名/MIME/内容类型过滤；不加入云同步、跨设备同步、自动清理、无限重试或自定义并发设置。
- 不把“消息记录仍可见”当作“文件内容已经保留”的证明。
- 不自动清理持久归档；资产删除由用户明确操作。
- 不把带 CDN 地址的消息记录当作图片内容已经归档。

## 推荐默认值

```json
{
  "antiRecallPreservation": {
    "stagingWindow": { "value": 24, "unit": "HOUR" },
    "stagingCapacity": { "value": "5", "unit": "GB" }
  },
  "receivedFileAutoDownload": {
    "enabled": false,
    "groups": [],
    "sizeRange": {
      "min": { "value": "0.5", "unit": "KB" },
      "max": { "value": "600", "unit": "MB" }
    }
  }
}
```

- `groups` 为空时下载零个群，不解释为全部群。
- `stagingWindow` 同时应用于消息快照、图片和符合文件策略的文件；窗口外的管理员撤回为 best-effort。
- `stagingCapacity` 按账号独立计算，只覆盖插件自有 acquisition/staging 资产，不覆盖持久归档和 QQ 自有缓存；默认 5 GB，容量草稿支持 MB/GB 并精确换算到整数 bytes。
- 文件大小数值使用普通十进制字符串，最多 3 位小数；配置中保留用户输入与单位，运行时精确换算成整数 bytes。
- `0.5 KB` 等于 `512 B`；`0.1 KB` 会产生部分 byte，因此作为非法输入处理。
- 配置被手工改坏、群身份缺失或文件大小未知时，当前候选文件按 `skipped` 处理，不触发下载。

## 模块图

| 模块 | 责任 | 文档 |
| --- | --- | --- |
| 文件下载策略 | 配置规范化、群白名单、单位换算、大小闭区间判定 | [modules/file-download-policy.md](modules/file-download-policy.md) |
| 实时消息入口 | 从共享 native event context 中提取实时群文件候选 | [modules/received-file-intake.md](modules/received-file-intake.md) |
| 下载执行器 | 队列、去重、QQ 原生下载、完成事件关联、文件完整性验证 | [modules/file-download-runner.md](modules/file-download-runner.md) |
| 暂存生命周期 | 图片/文件到期队列、慢下载与撤回竞态、单 timer 批量清理 | [modules/staging-lifecycle.md](modules/staging-lifecycle.md) |
| 持久归档 | 图片/文件原子归档、账号隔离、保留到手动删除 | [modules/durable-archive.md](modules/durable-archive.md) |
| 图片可靠性 | 原消息阶段临时 staging，撤回时晋升，消除快速撤回与 rkey/CDN 单点依赖 | [modules/recall-image-reliability.md](modules/recall-image-reliability.md) |
| 电源生命周期 | 自动下载有效时阻止空闲休眠，失效时释放全局 blocker | [modules/power-management.md](modules/power-management.md) |
| 防撤回衔接 | 下载完成后更新已缓存/已恢复记录中的文件本地路径 | [modules/recall-file-link.md](modules/recall-file-link.md) |
| 设置界面 | 启用开关、独立群白名单、上下限与单位、校验和摘要 | [modules/settings-ui.md](modules/settings-ui.md) |

## 共享状态

### `ReceivedFileCandidate`

```text
accountUin
chatType=2
peerUid
msgId
msgSeq
msgTime
elementId
fileName
fileSizeBytes
pendingFilePath?
sourceRecord
sourceElement
```

### `ReceivedFileDownloadJob`

```text
jobKey = accountUin:peerUid:msgId:elementId
state = queued | running | completed | failed | skipped
decision = policy snapshot plus current re-check
completedFilePath?
observedFileSize?
failureReason?
```

队列开始执行前重新读取当前配置，确保用户移除群、关闭功能或缩小大小范围后，尚未开始的任务不会继续下载。已经交给 QQ 的下载不强行取消，也不删除部分文件。

## 已实现代码落点

- `src/anti-recall-preservation-config.js`：文件大小精确换算、独立群白名单、保护窗口与容量规范化。
- `src/anti-recall-staging.js`：candidate journal、每账号单 timer 最小堆、容量 reservation、暂存、撤回晋升、到期删除和启动恢复。
- `src/macos-closed-lid-helper.js`：AC-only LaunchDaemon/helper 安装、请求、退出/崩溃恢复与卸载回滚。
- `src/main.js`：在 `processPreventRecall()` 前执行实时 intake；每账号 2 并发队列、策略运行时重检、QQ native 取得、消息快照回写、IPC 和电源生命周期。
- `src/renderer.js` / `src/recall-filter-editor.js` / `src/preload.js`：群专用白名单、复合上下限、保护窗口、容量、状态和 helper 卸载 UI。
- `tools/build-release.ps1`：release 必需文件清单包含三个新增 runtime 模块。

## 当前交付切片

1. `c7d7406` / v0.9.1 作为已验证基线。
2. 文件策略、candidate lifecycle、容量 reservation、单 timer、helper shell/plist、IPC/UI source contract 已实现并有自动测试。
3. 全量测试与基线逐项比较，新增 31 个测试全部通过且不引入新的失败；macOS 下仍保留同一组 16 个既有 Windows 路径断言失败。
4. 当前源码已通过 release 等价构建、105-entry archive 内容检查和 `unzip -t`。
5. 当前 QQNT 普通群文件 native 参数、快速图片撤回和真实关盖收发仍属于 live acceptance，不能由源码测试替代。

## 最终验收边界

必须在当前 QQNT 实机证明：

1. 白名单群内，大小分别处于 0.5 KB 下限、区间内、600 MB 上限的普通文件都只下载一次；511 B 跳过，512 B 命中；同一范围内的 `.zip`、`.js`、`.txt` 和无扩展名文件均自动下载。
2. 小于下限、大于上限、大小未知、非白名单群、私聊和历史加载均不发起下载。
3. 相同文件名、重复事件、多个 QQ 窗口不会覆盖现有文件或产生重复任务。
4. 下载完成事件与原消息和元素精确关联，磁盘文件大小与声明大小一致。
5. 发送方撤回后，staging 文件以同一 inode 晋升到持久归档；防撤回恢复的文件气泡显示 QQ 原生“已下载”状态并保留撤回红边，左键按 QQ 原生逻辑打开，右键和悬浮文件夹入口均使用 QQ 原生“在 Finder 中显示”。
6. 重启 QQ 后，防撤回记录直接使用插件归档路径并恢复本地完成状态；QQ 普通下载路径和 QQ 缓存均不承担自动防撤回文件的长期保留职责。
7. 归档图片和文件一直保留到用户手动删除；QQ 缓存清理不影响归档。
8. 未撤回图片和文件在 UI 配置的保护窗口到期后自动删除，持久归档中没有对应资产。
9. 单账号一万个模拟到期任务只使用一个活动 timer，并通过有界批次清理，不进行周期目录扫描。
10. QQ 在保护窗口中途重启后，candidate journal 能恢复消息快照、asset identity 和 expiry，后续管理员撤回仍能命中。
11. UI 可在 5 分钟到 30 天之间原子修改保护窗口；缩短窗口异步批量过期，延长窗口不复活已删除内容。
12. 每账号 staging 默认容量为 5 GB；容量已满或预留后将超限时，新资产进入 `blocked-capacity`，不删除窗口内已有资产。到期清理或设置扩容释放空间后任务恢复；缩小上限至当前占用以下只暂停，不同步删除。
13. 容量阻塞期间若对应消息发生撤回，该任务优先于未撤回候选，并直接取得到持久归档；不能取得时显示明确失败，不把仅有消息结构冒充为附件已保留。
14. 防撤回或有效文件策略启用时系统不会因空闲休眠，显示器仍可熄灭；关闭全部后台策略后 blocker 被释放。
15. closed-lid 验收必须由另一账号在真实关盖区间发送并撤回文字、图片和文件，同时用系统电源日志证明设备没有进入 sleep。

## 当前证据边界

- `source-confirmed`：项目存在实时消息统一入口、防撤回群名单、普通文件元素识别、QQ rich-media 下载调用和完成事件等待器。
- `source-confirmed`：当前图片归档在撤回恢复阶段才启动，远端 NT 图片缺少 rkey 时依赖外部服务，异步完成后也没有已证明的当前气泡刷新路线。
- `external-source-confirmed`：NapCatQQ 当前实现使用 `nodeIKernelMsgService/downloadRichMedia` + `nodeIKernelMsgListener/onRichMediaDownloadComplete` 下载包括 `ElementType.FILE` 在内的消息媒体。
- `live-analysis-confirmed`：本机实际配置已开启持久化和图片路径重定向；870 条持久化撤回记录含 152 个图片元素，其中 139 个当前没有可用本地文件，144 个 NT 图片 URL 缺少 rkey；当前外部 rkey endpoint 返回 525 内容，resolver 对抽样 NT 图片得到空结果。
- `live-analysis-confirmed`：当前 MacBook Air M3 报告 `AppleClamshellCausesSleep=Yes`；现有 NoIdleSleep assertion 只覆盖空闲休眠，系统日志存在关盖后的实际 sleep/dark-wake 区间。
- `automated-confirmed`：精确文件策略、restart-safe journal、容量 reservation、单账号单 timer、撤回晋升、到期删除、helper 生成内容和 IPC/UI source contract 已通过自动测试。
- `regression-confirmed`：当前分支全量测试的失败集合与 `c7d7406` 基线逐项一致；新增测试没有增加失败。
- `live-pending`：尚未捕获当前 QQNT 普通群文件的手动下载请求，也未证明快速图片撤回、撤回后文件打开和真实 AC 关盖区间收发。
