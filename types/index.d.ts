/** 照 Obsidian todoseq 的关键词（见 hooks/status.ts） */
export type Status =
  | 'TODO' | 'TODOFORAI' | 'DOING' | 'TOREVIEW' | 'REWORK' | 'UNCLEAR' | 'YES' | 'NO' | 'SKIP' | 'NEEDOK' | 'ERRORED' | 'HITLIMIT' | 'QUEUED' | 'DELEGATED' | 'PAUSED'
  | 'WAITING' | 'SUSPENDED' | 'DONE' | 'FAILED' | 'CANCELLED'

/** turn：我发的一轮；agent / fork：Claude Code 切出去的子任务；btw：/btw 的旁支问题；recap：回顾 */
export type Kind = 'turn' | 'agent' | 'fork' | 'btw' | 'recap'

/** 一轮对话的技术信息，全部来自事件本身，不额外调用模型；只记技能、MCP、斜杠命令和用量 */
export type Tech = {
  durationMs: number
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** 用到的斜杠命令（不含参数）；Read、Grep、Bash 这类内置工具不记 */
  slash: string[]
  skills: string[]
  /** MCP 工具，`服务名/工具名` */
  mcp: string[]
  agents: number
  /** 子代理花掉的 token（输入 + 输出 + 缓存） */
  agentTokens: number
  /** 大纲自己总结这一轮花掉的 token */
  outlineTokens: number
}

/** 一块 = 一轮对话：我发一条消息，到 Claude Code 执行完。 */
export type Block = {
  id: string
  kind: Kind
  /** 第几轮，从 1 开始；子任务和 btw 跟着它所在的那一轮 */
  turn: number
  /** 我的原话（截断） */
  ask: string
  /** 我要它做什么，一句话 */
  title: string
  status: Status
  /** 它做了什么 */
  did: string[]
  /** 这一轮的证据：改的文件、跑的命令和结果，全部来自工具调用本身，不经过模型 */
  evidence?: Evidence[]
  /** did 每一条挂的证据（下标对 evidence）；模型只能从 evidence 里挑，挑不出就是空的 */
  didEvidence?: number[][]
  /** 看过证据的时间：ToReview 要先看过证据才能改成 Done */
  reviewedAt?: number
  /** 验收时被我放行过（ToReview → Done） */
  reviewPassed?: true
  /** 验收时被我拦下过（ToReview → 别的状态） */
  reviewBlocked?: true
  /** 标了 Done 之后被我重新打开过 */
  isReopened?: true
  /** 我这一轮问的问题，写成问句；这一轮不是在提问就是空串。加这个字段之前总结的块没有 */
  myQuestion?: string
  conclusion: string
  questions: string[]
  /** 需要我做什么；解决后保留，按状态显示成已完成 */
  needsMe: string[]
  /** 「需要我做」每一条单独改过的状态（下标对 needsMe）；没改过的跟着块的状态走 */
  needsMeStatus?: (Status | null)[]
  /** 「需要我做」里哪几条是问我的问题（下标）：答 Yes / No 要马上告诉 Claude；其余是交给我做的事 */
  needsMeAsks?: number[]
  /** 「需要我做」每一条是不是后来的对话自动了结的（下标对 needsMe）：user 是我在消息里说了，claude 是 Claude 说替我办了；我手动改过就清掉 */
  needsMeAuto?: (Resolver | null)[]
  /** 块本身是不是被后来的对话自动了结的（没有「需要我做」条目、只是在等我的块） */
  autoResolved?: Resolver
  /** 状态最近一次变的时候，桌面版刚变时播一次出场动效 */
  statusAt?: number
  /** 父块 id，null 为顶层 */
  parent: string | null
  /** 层级被我手动改过，AI 不再动 */
  isManual: boolean
  /** 状态被我手动改过，AI 不再动 */
  isStatusManual: boolean
  /** 还在等模型总结 */
  isPending: boolean
  files: string[]
  commands: number
  /** 在第几轮被后来的对话解决 */
  resolvedIn?: number
  /** 我那条消息在对话里的 id，用来跳转 */
  messageId?: string
  /** 这一轮最后一条带文字的回答在对话里的 id：「需要我做」的条目按 G 跳到这里看原文 */
  answerId?: string
  tech?: Tech
  /** 这一轮还没结束时的实时进度；结束后去掉 */
  live?: Live
}

/** 谁了结了一件等我的事：user 是我在消息里说做完了、给了答复；claude 是 Claude Code 说它替我办了或者不用我做了 */
export type Resolver = 'user' | 'claude'

/** 总结时模型给的一条「这一轮了结了哪件等我的事」：key 是块 id，或者「块 id#第几条」 */
export type Resolution = { key: string; by: Resolver }

/** 一条证据：edit 是改了一个文件，run 是跑了一条命令；isOk 看工具有没有报错，tail 是输出的最后一行 */
export type Evidence = { kind: 'edit' | 'run'; text: string; isOk: boolean; tail?: string }

/** 验收和返工的指标，从块上的标记数出来；跨会话就是把各个会话的存档加起来 */
export type Metrics = {
  /** 挂过证据的「做了」一共几条，其中几条有证据 */
  did: number
  proven: number
  /** 我验收过几块，其中拦下几块 */
  reviewed: number
  blocked: number
  /** 标过 Done 的块，其中被重新打开的 */
  finished: number
  reopened: number
  /** 我手动纠正过层级的块 */
  fixed: number
}

export type Live = {
  startedAt: number
  /** 到目前为止调了几次工具 */
  steps: number
  /** 最近一步做了什么 */
  last: string
  /** 手动刷新时 haiku 写的小结 */
  note?: string
  refreshedAt?: number
  isRefreshing?: boolean
}

export type View = 'all' | 'me' | 'asks' | 'done' | 'conclusions' | 'tech'

export type Level = 'overview' | 'contents' | 'all' | 'undone'

/** 回顾：Claude Code 自带的 recap（claude），或大纲自己生成的（outline） */
export type Recap = { text: string; source: 'claude' | 'outline'; at: number; isPending?: boolean }

export type AgendaItem = { sid: string; blockId: string; title: string; needsMe: string[]; status: Status }

/** 我在侧栏里改的一处状态，下次发消息时告诉 Claude */
export type StatusChange = { key: string; what: string; from: Status; to: Status }

export type AgendaGroup = { sid: string; label: string; isCurrent: boolean; items: AgendaItem[] }

declare module 'claude-code' {
  interface PluginState {
    'outline-sidebar': {
      blocks: Block[]
      /** 子块被折起来的块 */
      folded: string[]
      /** 整棵都了结、本该自动折起来，但我手动打开过的块：不再自动折 */
      unfolded: string[]
      /** 我展开过的「…」里的块：这次会话里不再折进「…」 */
      shownRuns: string[]
      /** F 一键收起已完成：整棵了结的顶层块全折进「…」 */
      doneFolded: boolean
      /** 光标刚离开的块（连同祖先）先别自动折，到这个时间为止 */
      lingering: Record<string, number>
      /** 滚轮在面板上滚过的格数，累加；交给大纲树自己翻 */
      wheel: number
      /** 展开了详情字段的块 */
      open: string[]
      view: View
      level: Level
      cursor: string | null
      /** 多选的起点：⇧↑ / ⇧↓ 从这里拉到光标，中间的行都算选中；null 是没在多选 */
      anchor: string | null
      /** 搜索的关键词，空串是没在搜 */
      query: string
      /** 搜索框露出来了（按 / 打开，清空后回车收起） */
      searching: boolean
      /** 正在回复的那一行（按 A 打开回复框，回车发出或空着回车收起）；null 是没在回复 */
      replyTo: string | null
      /** 「长期没动」的提示里我点过「不用」的块，不再为它们提示 */
      staleSkipped: string[]
      zoom: string | null
      /** 我手动纠正层级的次数，用来评估 AI 判断的准确率 */
      corrections: number
      agenda: AgendaGroup[]
      /** 最近一次回顾，显示在面板顶部 */
      recap: Recap | null
      /** 面板顶部显示状态和图标的说明 */
      legend: boolean
      /** 侧栏里改过、还没告诉 Claude 的状态 */
      changes: StatusChange[]
      /** 键盘在哪一层：视图栏选视图，或者进了某个视图在树里操作 */
      scope: 'tabs' | 'tree'
      /** 所有会话加起来的验收指标，切到技术信息视图时重算 */
      metricsAll: Metrics | null
      /** 会话的名字（自动起的或 /rename 改的），画在大纲最上面；还没有名字时是 null */
      sessionTitle: string | null
      /** 重新排版之前每一轮挂在哪（块 id → 母块 id），下一轮开始之前按 M 撤销用；null 是没得撤销 */
      undoLayout: Record<string, string | null> | null
    }
  }
}
