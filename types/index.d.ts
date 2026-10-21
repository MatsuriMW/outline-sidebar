/** 照 Obsidian todoseq 的关键词（见 hooks/status.ts） */
export type Status =
  | 'TODO' | 'TODOFORAI' | 'DOING' | 'TOREVIEW' | 'NEEDOK' | 'ERRORED' | 'HITLIMIT' | 'QUEUED' | 'DELEGATED' | 'PAUSED'
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
  conclusion: string
  questions: string[]
  /** 需要我做什么；解决后保留，按状态显示成已完成 */
  needsMe: string[]
  /** 「需要我做」每一条单独改过的状态（下标对 needsMe）；没改过的跟着块的状态走 */
  needsMeStatus?: (Status | null)[]
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
  /** 这一轮在对话里的助手消息和工具调用行，正文折叠时藏起来 */
  rowIds?: string[]
  tech?: Tech
  /** 这一轮还没结束时的实时进度；结束后去掉 */
  live?: Live
}

/** 一条证据：edit 是改了一个文件，run 是跑了一条命令；isOk 看工具有没有报错，tail 是输出的最后一行 */
export type Evidence = { kind: 'edit' | 'run'; text: string; isOk: boolean; tail?: string }

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

export type Level = 'overview' | 'contents' | 'all'

/** 正文折叠：我那条消息改画成一行摘要，这一轮其余的行藏起来 */
export type Body = { labels: Record<string, string>; hide: string[] }

/** 回顾：Claude Code 自带的 recap（claude），或大纲自己生成的（outline） */
export type Recap = { text: string; source: 'claude' | 'outline'; at: number; isPending?: boolean }

export type AgendaItem = { sid: string; blockId: string; title: string; needsMe: string[]; status: Status }

/** 我在侧栏里改的一处状态，下次发消息时告诉 Claude */
export type StatusChange = { key: string; what: string; from: Status; to: Status }

export type AgendaGroup = { sid: string; label: string; isCurrent: boolean; items: AgendaItem[] }

declare module 'claude-code' {
  interface PluginState {
    /** 改名前的插件（org-inspired-chat）；只在启动时读一次，把当前会话的大纲接过来 */
    'org-inspired-chat': {
      blocks: Block[]
    }
    'outline-sidebar': {
      blocks: Block[]
      /** 子块被折起来的块 */
      folded: string[]
      /** 展开了详情字段的块 */
      open: string[]
      view: View
      level: Level
      cursor: string | null
      zoom: string | null
      /** 我手动纠正层级的次数，用来评估 AI 判断的准确率 */
      corrections: number
      /** 正文里折起来的块（全折模式下是例外：这些块展开） */
      bodyFolded: string[]
      bodyFoldAll: boolean
      body: Body
      agenda: AgendaGroup[]
      /** 最近一次回顾，显示在面板顶部 */
      recap: Recap | null
      /** 面板顶部显示状态和图标的说明 */
      legend: boolean
      /** 侧栏里改过、还没告诉 Claude 的状态 */
      changes: StatusChange[]
      /** 键盘在哪一层：视图栏选视图，或者进了某个视图在树里操作 */
      scope: 'tabs' | 'tree'
    }
  }
}
