# 防撤回临时暂存生命周期

review_status: implemented_automated
review_scope: staging-lifecycle

## Role

为可能被发送者、群主或管理员撤回的消息快照、图片和白名单群文件提供临时保全，在真实撤回事件到达时晋升到持久归档；没有撤回的候选按明确的保护期限处理，不通过高频轮询或反复扫描目录清理。

## Accepted Decisions

- closed-lid helper 已接受为 AC-only、显式管理员授权并可完整回滚。
- bounded 模式使用一个 UI 可配置的共享保护窗口，统一作用于候选消息、图片和符合策略的文件；默认值为 24 小时。
- 窗口输入由正整数和 `MINUTE | HOUR | DAY` 单位组成，最终范围为 5 分钟到 30 天。
- 图片和文件在 bounded 模式下都只有收到对应撤回事件后才进入持久归档。
- 已接受 AC-only、显式管理员授权的 closed-lid helper；该 helper 属于电源模块，不属于 staging scheduler。
- staging 容量按账号独立配置，默认 `5 GB = 5368709120 B`；UI 支持 MB/GB 精确换算。
- 容量达到上限时暂停新的资产取得并显示状态，不静默淘汰保护窗口内的已有 staging。

## State Machine

```text
observed -> blocked-capacity -> acquiring -> staged -> promoted
          |                         \-> expired
          |                         \-> failed
          \----------------------------> promoted-acquisition
```

- `expiresAt = receivedAt + stagingWindow`，不从下载完成时间重新起算。
- 设置缩短时按每个任务原始 `receivedAt` 重算；已经到期的任务进入同一个批量 expiry 队列，不在保存设置的同步调用中删除文件。
- 设置延长时只延长当前仍存在的候选；已经过期删除的内容不从 QQ 缓存或 CDN 静默复活。
- 消息结构和 asset job metadata 写入轻量 candidate journal，QQ 在保护窗口内重启后可恢复消息 snapshot、asset identity 与原始 `receivedAt`。
- 撤回事件在 `observed | blocked-capacity | acquiring | staged` 任一状态到达时设置 candidate `recalled=true`，旧 expiry heap 节点通过 generation 检查惰性失效。
- 下载很慢但撤回已经到达时，任务继续完成，验证后直接晋升；下载时间不会导致已确认撤回的资产被清理。
- 到期时仍在下载且没有撤回：若 native adapter 支持取消则取消；否则标记 `discardOnComplete`，完成后不写持久归档并删除插件 staging 文件。
- 到期后才收到撤回：可以尝试当前仍可用的本地/native 路线，但只报告 best-effort，不宣称已覆盖该窗口之外的撤回。

## Capacity

- 容量只统计插件账号目录下的 acquisition 临时文件与 staging 资产；持久归档、candidate journal 元数据和 QQ 自有缓存不计入该额度。
- `usedBytes + reservedBytes + candidateBytes <= capacityBytes`。文件声明大小可信且已通过策略时，取得前按声明大小预留；本地图片先 `stat` 再预留。大小未知的 native 内容先落 QQ 自有路径，完成校验后再按实际大小申请 staging 空间。
- 预留必须是原子操作，多个并发任务不能各自看到相同剩余空间后共同突破上限。任务失败、到期或取消时释放预留；完成写入后把 reservation 转为实际占用。
- 容量不足时只把资产任务置为 `blocked-capacity`，candidate journal 仍保存消息与 asset identity。空间因到期清理、晋升或用户扩容而释放后，先恢复已收到撤回的任务，再按最近到期时间恢复未撤回任务。
- `blocked-capacity` 任务在等待期间仍沿用原始 `expiresAt`；到期前始终没有空间则删除候选任务而不下载内容。
- 容量阻塞期间收到撤回时设置 `recalled=true`，任务绕过 staging 额度，优先尝试直接取得到持久归档；持久归档不受 staging 额度限制，但实际写入错误会保留明确失败状态。
- 用户把容量调低到当前占用以下时，不删除已有资产；保持暂停状态，直到自然到期、撤回晋升或用户扩容使占用重新低于上限。
- UI 必须显示账号级 `used / reserved / capacity`、阻塞任务数和暂停原因；不得把“容量暂停”显示成下载成功。

## Scheduler

- 每个账号 staging manager 只有一个按 `expiresAt` 排序的最小堆和一个指向最近到期项的 timer；不会为每条消息或每个 asset 创建 timer。
- 新任务只在比当前最近期限更早时重置 timer；每个任务不创建 `setInterval`。
- 同一消息的重复实时 snapshot 只更新 journal record，不重复插入相同 expiry 节点或重置 timer。
- timer 触发后以有界批次处理已经到期的条目，并通过 `setImmediate`/下一轮事件循环继续剩余批次，避免一次删除大量文件阻塞 QQ main process。
- promotion、手动清空和配置关闭通过 job generation/token 使旧堆节点惰性失效，不在堆中做高成本全量删除。
- 启动时只执行一次 staging 目录 sweep，之后不周期扫描目录。
- 启动时从 candidate journal 恢复未到期任务，再执行一次 orphan sweep；journal 与资产使用同一 generation，避免恢复已晋升或已过期任务。

## Disk And CPU Rules

- staging 与持久归档位于同一账号目录和文件系统；晋升优先使用原子重命名，不重新复制文件。
- 每个未撤回资产最多发生一次 staging 写入和一次到期删除；没有持续读写循环。
- 文件下载并发沿用全局上限 2，排队任务到期前仍未开始时直接丢弃，不产生文件。
- QQ native API 若支持指定目标路径，直接写入 staging；否则只做一次验证后的 staging copy。
- 清理诊断只记录计数、耗时和字节数，不记录文件名、群号或消息内容。
- 手工损坏或越界的保护窗口配置标记为 invalid，并暂停创建新 staging；不猜测单位或静默套用另一个期限。
- 手工损坏的容量配置同样失败关闭；已有 staging 保持原生命周期，不因配置错误被删除。

## Proof

- 单账号一万个模拟到期任务仍只存在一个活动 timer，不产生一万个定时器。
- 同一候选重复更新一万次后仍只有一个 expiry heap 节点和一个活动 timer。
- 过期处理按批次让出事件循环；QQ main process 的延迟保持在设定预算内。
- 未撤回资产到期删除一次，持久归档中不存在对应文件。
- QQ 在窗口中途重启后，候选消息、expiry 和 asset identity 均能恢复，管理员撤回仍命中原候选。
- UI 从 24 小时改为 5 分钟时，到期任务异步分批清理；改为 7 天时，仍存在任务按原 `receivedAt` 延长。
- 撤回发生在下载完成前时，任务退出到期队列并在完成后晋升。
- promotion 使用 rename；跨文件系统或 rename 失败时明确失败，不保留两套隐式路径。
- 5 GB 默认容量下，原子 reservation 能阻止并发超额；满额后已有未到期资产不变，新任务进入 `blocked-capacity`。
- 到期删除或调高容量后，阻塞队列自动恢复；调低容量到当前占用以下不会触发删除风暴。
- 满额期间发生撤回的任务优先，并直接取得到持久归档；其状态和失败原因可在 UI 观察。
