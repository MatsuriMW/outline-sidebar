import type { Block, Evidence, Kind, Metrics, Status, Tech, View } from '../types'
import { PH } from './icons'
import type { PhosphorIcon } from './icons'
import { STATUS_INFO, isForMe, isOpenStatus, statusText } from './status'

export { STATUSES, STATUS_GAP, STATUS_INFO, isForMe, isOpenStatus, nextBadStatus, nextStatus, normalizeStatus, statusText } from './status'

export const VIEW_INFO: Record<View, { label: string; aliases: string[] }> = {
  conclusions: { label: '结论', aliases: ['concl', 'conclusion'] },
  me: { label: '需要我做的', aliases: ['todo'] },
  asks: { label: '我让它做的', aliases: ['ask'] },
  all: { label: '全部', aliases: [] },
  done: { label: '它已做的', aliases: ['did'] },
  tech: { label: '技术信息', aliases: ['stats'] },
}

export const DEFAULT_KEYS = 'conclusions,me,asks,all,done,tech'

/** 把配置里的 `conclusions,me,asks,…` 读成数字键的顺序；写错的跳过，漏掉的视图补在后面 */
export const parseKeys = (text: string): View[] => {
  const known = Object.keys(VIEW_INFO) as View[]
  const picked: View[] = []
  for (const word of text.split(/[,，\s]+/)) {
    const v = viewFromArg(word)
    if (v !== undefined && !picked.includes(v)) picked.push(v)
  }
  for (const v of known) if (!picked.includes(v)) picked.push(v)
  return picked.slice(0, 9)
}

export const viewFromArg = (word: string): View | undefined => {
  const w = word.trim().toLowerCase()
  for (const [v, info] of Object.entries(VIEW_INFO) as [View, { aliases: string[] }][]) {
    if (v === w || info.aliases.includes(w)) return v
  }
  return undefined
}

/** 子块类型：用文字标 */
export const KIND_BADGE: Record<Kind, { text: string; color: string } | undefined> = {
  turn: undefined,
  agent: { text: '子任务', color: 'merged' },
  fork: { text: 'fork', color: 'merged' },
  btw: { text: 'btw', color: 'ide' },
  recap: { text: '回顾', color: 'remember' },
}

// ---------- 字段图标（Phosphor；「需要我做」用 ASCII 的 -，证据用 ↳） ----------

export type Field =
  | 'needsMe' | 'did' | 'proof' | 'files' | 'conclusion' | 'question' | 'resolved' | 'ask'
  | 'coverage' | 'review' | 'reopen' | 'fix'
  | 'stats' | 'tokens' | 'cache' | 'time' | 'model' | 'skills' | 'mcp' | 'slash' | 'agents' | 'outline' | 'live' | 'last' | 'note'

export const FIELD: Record<Field, { icon: PhosphorIcon | Mark; label: string }> = {
  needsMe: { icon: 'point', label: '需要我做' },
  did: { icon: 'did', label: '做了' },
  proof: { icon: 'proof', label: '证据' },
  files: { icon: 'files', label: '改了的文件' },
  conclusion: { icon: 'conclusion', label: '结论' },
  question: { icon: 'question', label: '还没解决的问题' },
  resolved: { icon: 'resolved', label: '在第几轮解决' },
  ask: { icon: 'ask', label: '我的原话' },
  coverage: { icon: 'proof', label: '证据覆盖率：「做了」里有证据的比例' },
  review: { icon: 'resolved', label: '验收拦下率：验收时没让通过的比例' },
  reopen: { icon: 'past', label: '返工率：标了 Done 又被重新打开的比例' },
  fix: { icon: 'pending', label: '手动纠正过层级的块' },
  stats: { icon: 'stats', label: '技术信息' },
  tokens: { icon: 'tokens', label: 'token（↑ 输入 ↓ 输出）' },
  cache: { icon: 'cache', label: '缓存命中率' },
  time: { icon: 'time', label: '耗时' },
  model: { icon: 'model', label: '模型' },
  skills: { icon: 'skills', label: '技能' },
  mcp: { icon: 'mcp', label: 'MCP' },
  slash: { icon: 'slash', label: '斜杠命令' },
  agents: { icon: 'agents', label: '子代理' },
  outline: { icon: 'outline', label: '大纲自己的开销' },
  live: { icon: 'live', label: '进行中' },
  last: { icon: 'last', label: '刚才那一步' },
  note: { icon: 'note', label: '进度小结' },
}

/** 终端里画图标用的字：Phosphor 字体里的字，「需要我做」是 - */
/** 没总结出标题、也没有原话可用的块 */
export const UNTITLED = '（没有标题）'

/** 「需要我做」那一条行首的记号 */
export const ITEM_MARK = '-'

/** 不用图标字体、直接画字的记号 */
const MARKS = { point: ITEM_MARK, proof: '↳' } as const
type Mark = keyof typeof MARKS
export const isMark = (icon: PhosphorIcon | Mark): icon is Mark => icon in MARKS

export const glyph = (field: Field) => {
  const icon = FIELD[field].icon
  return isMark(icon) ? MARKS[icon] : PH[icon]
}

/** 终端里的显示宽度：中日韩文字、全角符号和 emoji 占两格；图标字体（补充私用区）占一格 */
export const cellWidth = (text: string) => {
  let n = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp === 0xfe0f || cp === 0x200d) continue
    if (cp >= 0xf0000) {
      n += 1
      continue
    }
    const isWide =
      (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || cp >= 0x1f300
    n += isWide ? 2 : 1
  }
  return n
}

// ---------- 树 ----------

export const childrenOf = (list: readonly Block[], id: string | null) => list.filter(b => b.parent === id)

export const ancestorsOf = (list: readonly Block[], b: Block) => {
  const byId = new Map(list.map(one => [one.id, one]))
  const chain: Block[] = []
  let at = b.parent === null ? undefined : byId.get(b.parent)
  while (at !== undefined && chain.length < 64) {
    chain.unshift(at)
    at = at.parent === null ? undefined : byId.get(at.parent)
  }
  return chain
}

/** 「需要我做」第 i 条的状态：单独改过就用改过的，没改过就跟着块走 */
export const itemStatus = (b: Block, i: number): Status => b.needsMeStatus?.[i] ?? (isOpenStatus(b.status) ? 'TODO' : 'DONE')

/** 这一块还有没办完的、要我做的事 */
export const hasOpenForMe = (b: Block) => b.needsMe.some((_, i) => isOpenStatus(itemStatus(b, i))) || (b.needsMe.length === 0 && isForMe(b.status))

export const matches = (b: Block, v: View) => {
  if (b.live !== undefined) return true
  if (v === 'me') return b.needsMe.length > 0 || isForMe(b.status)
  if (v === 'asks') return b.kind === 'turn' || b.kind === 'btw'
  if (v === 'done') return b.did.length > 0 || b.files.length > 0 || (b.kind !== 'turn' && b.kind !== 'recap' && b.conclusion !== '')
  if (v === 'conclusions') return b.conclusion !== ''
  if (v === 'tech') return b.tech !== undefined
  return true
}

/** 还没办完的「需要我做的」条数，面板上的角标 */
export const waitingCount = (list: readonly Block[]) =>
  list.reduce((n, b) => {
    if (b.live !== undefined) return n
    const open = b.needsMe.filter((_, i) => isOpenStatus(itemStatus(b, i))).length
    return n + (b.needsMe.length > 0 ? open : isForMe(b.status) ? 1 : 0)
  }, 0)

/** 「需要我做」的一条，在大纲里是块下面一行，能单独选中、改状态 */
export type Item = { index: number; text: string; status: Status }

export type Row = {
  block: Block
  item?: Item
  /** 光标认的 id：块就是块的 id，条目是「块 id#第几条」 */
  key: string
  depth: number
  isContext: boolean
  hasChildren: boolean
  isFolded: boolean
  /** 标题行前的引导线：「│  ├─ 」 */
  prefix: string
  /** 标题下面字段行前的引导线，竖线一直连到子块和下一个兄弟块 */
  cont: string
  /** 顶层话题（第一个除外）前空一行，让一个话题和它的子块聚成一团 */
  isGap: boolean
}

export const itemKey = (blockId: string, index: number) => `${blockId}#${index}`

export const parseKey = (key: string) => {
  const at = key.lastIndexOf('#')
  return at < 0 ? { blockId: key } : { blockId: key.slice(0, at), index: Number(key.slice(at + 1)) }
}

/** 已了结的状态：做完的、不做了的、我已经答过是或否的。层级「去掉 Done」藏起来，整棵都是这些的子树自动折叠 */
const SETTLED: readonly Status[] = ['DONE', 'CANCELLED', 'YES', 'NO']

/** 这一块连同它的「需要我做」条目、所有子孙都了结了 */
const isSettledTree = (list: readonly Block[], b: Block): boolean =>
  SETTLED.includes(b.status) &&
  b.live === undefined &&
  !b.isPending &&
  b.needsMe.every((_, i) => SETTLED.includes(itemStatus(b, i))) &&
  childrenOf(list, b.id).every(kid => isSettledTree(list, kid))

/** 自动折叠只在看当前进度的视图里生效 */
const AUTO_FOLD_VIEWS: readonly View[] = ['me', 'asks', 'all']

/** 自动折叠：整棵都了结的块折起来，除了我手动打开过的（unfolded）和先别折的（hold：光标所在的块、它的祖先、光标刚离开还在缓冲的） */
export type AutoFold = { unfolded: readonly string[]; hold: readonly string[] }

/**
 * 按视图把树摊成可见的行。除「全部」外都是 sparse tree：命中的块和它们的祖先，其余不显示。
 * hideDone（层级「去掉 Done」）：已了结的块和「需要我做」条目也不算命中，块下面还有没了结的子块时留着当上下文
 */
export const visibleRows = (list: readonly Block[], v: View, folded: readonly string[], zoom: string | null, open: readonly string[] = [], hideDone = false, auto?: AutoFold): Row[] => {
  // 「结论」「它已做的」「技术信息」本来就是看做完的事，不自动折
  const isAutoFolded = (b: Block) =>
    auto !== undefined && AUTO_FOLD_VIEWS.includes(v) && !auto.unfolded.includes(b.id) && !auto.hold.includes(b.id) && isSettledTree(list, b)
  const isFiltered = v !== 'all' || hideDone
  const hit = (b: Block) => matches(b, v) && !(hideDone && SETTLED.includes(b.status))
  const keep = new Set<string>()
  if (isFiltered) {
    for (const b of list) {
      if (!hit(b)) continue
      keep.add(b.id)
      for (const a of ancestorsOf(list, b)) keep.add(a.id)
    }
  }
  const rows: Row[] = []
  const shown = (bs: Block[]) => (isFiltered ? bs.filter(b => keep.has(b.id)) : bs)
  type Node = { block: Block; item?: Item }
  const walk = (node: Node, depth: number, parentCont: string, isLast: boolean) => {
    const b = node.block
    const own = depth === 0 ? '' : isLast ? '   ' : '│  '
    const branch = depth === 0 ? '' : isLast ? '└─ ' : '├─ '
    const below = parentCont + own
    if (node.item !== undefined) {
      rows.push({ block: b, item: node.item, key: itemKey(b.id, node.item.index), depth, isContext: false, hasChildren: false, isFolded: false, prefix: parentCont + branch, cont: below + '  ', isGap: false })
      return
    }
    // 「需要我做」的条目排在子块前面，各占一行
    const showItems = (v === 'me' || open.includes(b.id)) && !(isFiltered && !hit(b))
    const items: Node[] = showItems
      ? b.needsMe.map((text, index) => ({ block: b, item: { index, text, status: itemStatus(b, index) } })).filter(one => !(hideDone && SETTLED.includes(one.item.status)))
      : []
    const kids: Node[] = [...items, ...shown(childrenOf(list, b.id)).map(block => ({ block }))]
    const isFolded = kids.length > 0 && (folded.includes(b.id) || isAutoFolded(b))
    rows.push({
      block: b,
      key: b.id,
      depth,
      isContext: isFiltered && !hit(b),
      hasChildren: kids.length > 0,
      isFolded,
      prefix: parentCont + branch,
      cont: below + (kids.length > 0 && !isFolded ? '│ ' : '  '),
      isGap: depth === 0 && rows.length > 0,
    })
    if (!isFolded) kids.forEach((kid, i) => walk(kid, depth + 1, below, i === kids.length - 1))
  }
  const top = shown(zoom === null ? childrenOf(list, null) : list.filter(b => b.id === zoom))
  top.forEach((b, i) => walk({ block: b }, 0, '', i === top.length - 1))
  return rows
}

// ---------- 每块下面显示的行 ----------

/** 一行里的一段：一个图标加一段字。一行可以有好几段（🗄️ 3.2k  🎯 90%  🕐 12s） */
export type Part = { field: Field; text: string }

/** level 1 缩进一层；bullet 是某个字段下的一条，画 • 不画图标 */
export type Line = { parts: Part[]; color?: string; level?: 1; bullet?: true }

const one = (field: Field, text: string, extra: Partial<Line> = {}): Line => ({ parts: [{ field, text }], ...extra })

/** 一个字段的几条：一条就跟图标同一行，多条就图标单独一行、条目缩进 */
const group = (field: Field, items: readonly string[]): Line[] =>
  items.length <= 1 ? items.map(text => one(field, text)) : [one(field, ''), ...items.map(text => one(field, text, { level: 1, bullet: true }))]

/** 一条证据：改了哪个文件；跑了哪条命令，✓ 成功 / ✗ 报错，→ 后面是输出的最后一行 */
const evidenceLine = (e: Evidence): Line => {
  const text = e.kind === 'edit' ? `${e.isOk ? '' : '✗ '}改 ${e.text}` : `${e.isOk ? '✓' : '✗'} ${e.text}${e.tail === undefined ? '' : ` → ${e.tail}`}`
  const color = !e.isOk ? STATUS_INFO.FAILED.color : e.kind === 'run' ? STATUS_INFO.DONE.color : undefined
  return one('proof', text, { level: 1, ...(color === undefined ? {} : { color }) })
}

/** 每条「做了」下面挂它的证据；一条证据都挂不上的标「无证据」，验收时一眼看得到 */
const didLines = (b: Block): Line[] => {
  // 加证据之前存下的块没有这一项，照旧画
  if (b.didEvidence === undefined) return group('did', b.did)
  const all = b.evidence ?? []
  const isMany = b.did.length > 1
  const out: Line[] = isMany ? [one('did', '')] : []
  b.did.forEach((text, i) => {
    const proofs = (b.didEvidence?.[i] ?? []).map(n => all[n]).filter((e): e is Evidence => e !== undefined)
    const extra: Partial<Line> = { ...(isMany ? { level: 1 as const, bullet: true as const } : {}), ...(proofs.length === 0 ? { color: STATUS_INFO.TOREVIEW.color } : {}) }
    out.push(one('did', proofs.length === 0 ? `${text}（无证据）` : text, extra))
    out.push(...proofs.slice(0, 3).map(evidenceLine))
    if (proofs.length > 3) out.push(one('proof', `另有 ${proofs.length - 3} 条`, { level: 1 }))
  })
  return out
}

/**
 * 「我让它做的」：每件事带上我的原话、做成了几件、证据够不够、还有几件等我，以及结论。
 * 被打断以后扫一遍这个视图，就能把「当时要干什么、做到哪了」重新装回脑子里
 */
const askLines = (b: Block): Line[] => {
  const lines: Line[] = []
  const said = b.ask.replace(/\s+/g, ' ').trim()
  if (said !== '' && said !== b.title) lines.push(one('ask', clip(said, 80)))
  const parts: Part[] = []
  if (b.did.length > 0) {
    const proven = b.didEvidence?.filter(nums => nums.length > 0).length
    parts.push({ field: 'did', text: proven === undefined ? `做了 ${b.did.length} 件` : `做了 ${b.did.length} 件 · 有证据 ${proven}` })
  }
  const waiting = b.needsMe.filter((_, i) => isOpenStatus(itemStatus(b, i))).length
  if (waiting > 0) parts.push({ field: 'needsMe', text: `等我 ${waiting} 件` })
  if (parts.length > 0) lines.push({ parts })
  if (b.conclusion !== '') lines.push(one('conclusion', b.conclusion))
  return lines
}

const elapsed = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n))

export const cacheHit = (t: Tech) => {
  const all = t.input + t.cacheRead + t.cacheWrite
  return all === 0 ? undefined : Math.round((t.cacheRead / all) * 100)
}

export const techLines = (t: Tech): Line[] => {
  const hit = cacheHit(t)
  const usage: Part[] = [{ field: 'tokens', text: `↑${tokens(t.input + t.cacheRead + t.cacheWrite)} ↓${tokens(t.output)}` }]
  if (hit !== undefined) usage.push({ field: 'cache', text: `${hit}%` })
  usage.push({ field: 'time', text: elapsed(t.durationMs) })
  if (t.model !== '') usage.push({ field: 'model', text: t.model.replace(/^claude-/, '') })
  const lines: Line[] = [{ parts: usage }]
  lines.push(...group('skills', t.skills))
  lines.push(...group('mcp', t.mcp))
  if ((t.slash ?? []).length > 0) lines.push(one('slash', (t.slash ?? []).map(c => `/${c}`).join(' ')))
  if (t.agents > 0) lines.push({ parts: [{ field: 'agents', text: `×${t.agents}` }, { field: 'tokens', text: tokens(t.agentTokens) }] })
  if (t.outlineTokens > 0) lines.push({ parts: [{ field: 'outline', text: '' }, { field: 'tokens', text: tokens(t.outlineTokens) }] })
  return lines
}

/** 进行中那一轮的实时进度，在任何视图里都显示 */
export const liveLines = (b: Block, now: number): Line[] => {
  const live = b.live
  if (live === undefined) return []
  const parts: Part[] = [{ field: 'last', text: String(live.steps) }, { field: 'time', text: elapsed(now - live.startedAt) }]
  if (live.isRefreshing === true) parts.push({ field: 'note', text: '…' })
  const lines: Line[] = [{ parts, color: 'claude' }]
  if (live.last !== '') lines.push(one('last', live.last))
  if (live.note !== undefined && live.note !== '') lines.push(one('note', live.note, { color: 'claude' }))
  return lines
}

/** 某块在某个视图下要显示的字段；`isOpen` 是我展开了详情。「需要我做」的条目不在这里，是单独的行 */
export const blockLines = (b: Block, v: View, isOpen: boolean, now = 0): Line[] => {
  const lines: Line[] = b.live === undefined ? [] : liveLines(b, now)
  // 进行中的块：手动刷新出来的进展在任何视图里都直接露出来
  if (v === 'asks' && !isOpen && b.live === undefined) return [...lines, ...askLines(b)]
  if (v === 'done' || isOpen || b.live !== undefined) lines.push(...didLines(b))
  if ((v === 'done' || isOpen) && b.files.length > 0) lines.push(one('files', b.files.join('、')))
  if ((v === 'conclusions' || v === 'done' || isOpen) && b.conclusion !== '') lines.push(one('conclusion', b.conclusion))
  if (v === 'tech' && b.tech !== undefined) lines.push(...techLines(b.tech))
  if (isOpen) {
    lines.push(...group('question', b.questions))
    if (b.resolvedIn !== undefined) lines.push(one('resolved', `#${b.resolvedIn}`))
    if (b.ask !== '' && b.ask !== b.title) lines.push(one('ask', b.ask.replace(/\s+/g, ' ')))
    // 展开详情时，技术信息收进一个小节，缩进一层
    if (v !== 'tech' && b.tech !== undefined) lines.push(one('stats', ''), ...techLines(b.tech).map(l => ({ ...l, level: 1 as const })))
  }
  return lines
}

/** 终端里一行的字：每段「图标 字」，段与段之间空两格 */
export const lineText = (line: Line) => line.parts.map(p => `${glyph(p.field)}${p.text === '' ? '' : ` ${p.text}`}`).join('  ')

// ---------- 导出 ----------

const partsText = (parts: readonly Part[]) => parts.map(p => (p.text === '' ? FIELD[p.field].label : `${FIELD[p.field].label} ${p.text}`)).join(' · ')

/** 把当前视图导出成 Markdown 大纲（不用图标字体，换个地方打开也看得懂） */
export const toMarkdown = (list: readonly Block[], rows: readonly Row[], v: View, open: readonly string[], date: string) => {
  const out = [`# 会话大纲：${VIEW_INFO[v].label}`, '', `导出于 ${date}，共 ${rows.filter(r => !r.isContext && r.item === undefined).length} 块`, '']
  for (const row of rows) {
    const b = row.block
    const pad = '  '.repeat(row.depth)
    if (row.item !== undefined) {
      out.push(`${pad}- ${STATUS_INFO[row.item.status].label} ${row.item.text}`)
      continue
    }
    const badge = KIND_BADGE[b.kind]
    out.push(`${pad}- ${STATUS_INFO[b.status].label} ${badge === undefined ? '' : `[${badge.text}] `}${b.title}${row.isContext ? '（上下文）' : ''}`)
    if (row.isContext) continue
    for (const line of blockLines(b, v, open.includes(b.id))) {
      const indent = line.level === 1 ? '    ' : '  '
      out.push(`${pad}${indent}- ${line.bullet === true ? (line.parts[0]?.text ?? '') : partsText(line.parts)}`)
    }
  }
  if (v === 'tech') {
    const total = sumTech(list)
    if (total !== undefined) out.push('', '## 本次会话合计', '', ...techLines(total).map(l => `- ${partsText(l.parts)}`))
  }
  return `${out.join('\n')}\n`
}

// ---------- 验收指标 ----------

export const NO_METRICS: Metrics = { did: 0, proven: 0, reviewed: 0, blocked: 0, finished: 0, reopened: 0, fixed: 0 }

/** 从块上的标记数出验收指标：证据覆盖率、验收拦下率、返工率、纠正层级 */
export const measure = (list: readonly Block[]): Metrics => {
  const m = { ...NO_METRICS }
  for (const b of list) {
    if (b.kind !== 'turn') continue
    if (b.didEvidence !== undefined) {
      m.did += b.did.length
      m.proven += b.didEvidence.filter(nums => nums.length > 0).length
    }
    if (b.reviewPassed === true || b.reviewBlocked === true) m.reviewed += 1
    if (b.reviewBlocked === true) m.blocked += 1
    if (b.status === 'DONE' || b.isReopened === true) m.finished += 1
    if (b.isReopened === true) m.reopened += 1
    if (b.isManual) m.fixed += 1
  }
  return m
}

export const addMetrics = (a: Metrics, b: Metrics): Metrics => ({
  did: a.did + b.did, proven: a.proven + b.proven, reviewed: a.reviewed + b.reviewed, blocked: a.blocked + b.blocked,
  finished: a.finished + b.finished, reopened: a.reopened + b.reopened, fixed: a.fixed + b.fixed,
})

const ratio = (word: string, n: number, total: number) => (total === 0 ? `${word} —` : `${word} ${n}/${total} · ${Math.round((n * 100) / total)}%`)

export const metricsLines = (m: Metrics): Line[] => [
  { parts: [{ field: 'coverage', text: ratio('证据', m.proven, m.did) }, { field: 'review', text: ratio('拦下', m.blocked, m.reviewed) }] },
  { parts: [{ field: 'reopen', text: ratio('重开', m.reopened, m.finished) }, { field: 'fix', text: `纠正层级 ${m.fixed} 块` }] },
]

export const sumTech = (list: readonly Block[]): Tech | undefined => {
  const all = list.map(b => b.tech).filter((t): t is Tech => t !== undefined)
  if (all.length === 0) return undefined
  const unique = (pick: (t: Tech) => string[]) => [...new Set(all.flatMap(pick))]
  return {
    durationMs: all.reduce((s, t) => s + t.durationMs, 0),
    model: '',
    input: all.reduce((s, t) => s + t.input, 0),
    output: all.reduce((s, t) => s + t.output, 0),
    cacheRead: all.reduce((s, t) => s + t.cacheRead, 0),
    cacheWrite: all.reduce((s, t) => s + t.cacheWrite, 0),
    slash: unique(t => t.slash ?? []),
    skills: unique(t => t.skills),
    mcp: unique(t => t.mcp),
    agents: all.reduce((s, t) => s + t.agents, 0),
    agentTokens: all.reduce((s, t) => s + t.agentTokens, 0),
    outlineTokens: all.reduce((s, t) => s + t.outlineTokens, 0),
  }
}

export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)

// ---------- 交给树视图（Client）画的数据 ----------

export type TreeLine = { text: string; color?: string; level?: 1; isBullet?: boolean }

export type TreeRow = {
  key: string
  prefix: string
  cont: string
  isGap: boolean
  arrow: string
  status: string
  statusColor: string
  /** 还在办的，状态和标题加粗 */
  isOpen: boolean
  /** Doing 的图标要转 */
  isSpinning: boolean
  badge?: { text: string; color: string }
  title: string
  isAt: boolean
  isContext: boolean
  /** 已了结的，标题变暗 */
  isClosed: boolean
  isCanceled: boolean
  /** 「需要我做」的一条，回车菜单只有改状态 */
  isItem?: boolean
  lines: TreeLine[]
}

export type MenuItem = { id: string; label: string; color?: string }

export type TreeProps = {
  rows: TreeRow[]
  height: number
  empty?: string
  menu: MenuItem[]
  itemMenu: MenuItem[]
  /** tabs：键盘在视图栏上，←→ 和数字选视图、⏎ 进入；tree：光标只在这个视图的行里走 */
  scope?: 'tabs' | 'tree'
}

export const toTreeRows = (rows: readonly Row[], v: View, open: readonly string[], cursor: string | null, now = 0): TreeRow[] =>
  rows.map(row => {
    const b = row.block
    const st = row.item?.status ?? b.status
    const info = STATUS_INFO[st]
    const isOpen = isOpenStatus(st)
    const common = {
      key: row.key,
      prefix: row.prefix,
      cont: row.cont,
      isGap: row.isGap,
      statusColor: info.color,
      isOpen,
      isSpinning: st === 'DOING',
      isAt: row.key === cursor,
      isClosed: !isOpen && b.live === undefined,
      isCanceled: st === 'CANCELLED',
    }
    if (row.item !== undefined) {
      return { ...common, isItem: true, arrow: ITEM_MARK, status: statusText(st), title: row.item.text, isContext: false, lines: [] }
    }
    const badge = KIND_BADGE[b.kind]
    const lines = row.isContext ? [] : blockLines(b, v, open.includes(b.id), now)
    return {
      ...common,
      arrow: row.hasChildren ? (row.isFolded ? '▸' : '▾') : '•',
      status: b.isPending ? `${glyph('note')} …` : statusText(st),
      ...(badge === undefined ? {} : { badge }),
      title: b.title === '' ? UNTITLED : b.title,
      isContext: row.isContext,
      lines: lines.map(line => ({
        text: line.bullet === true ? (line.parts[0]?.text ?? '') : lineText(line),
        ...(line.color === undefined ? {} : { color: line.color }),
        ...(line.level === 1 ? { level: 1 as const } : {}),
        ...(line.bullet === true ? { isBullet: true } : {}),
      })),
    }
  })

/**
 * 按终端格子宽度折行。中文可以在任意字之间断开；英文单词尽量不拆，单词比一行还长才硬断。
 * 终端自己的折行只认空格，一长串中文会被当成一个词整段挪到下一行，留下一大片空白
 */
export const wrapCells = (text: string, width: number): string[] => {
  const room = Math.max(4, width)
  const out: string[] = []
  let line = ''
  let used = 0
  // 当前行末尾那个还没写完的英文单词从哪开始（-1：末尾不是英文单词）
  let wordAt = -1
  for (const ch of text) {
    const w = cellWidth(ch)
    const isWord = /[A-Za-z0-9_./:@#%+-]/.test(ch)
    if (used + w > room && line !== '') {
      if (isWord && wordAt > 0) {
        // 把没写完的单词整个挪到下一行
        const carry = line.slice(wordAt)
        out.push(line.slice(0, wordAt).trimEnd())
        line = carry
      } else {
        out.push(line.trimEnd())
        line = ''
      }
      if (ch === ' ' && line === '') {
        used = 0
        wordAt = -1
        continue
      }
      used = cellWidth(line)
      wordAt = isWord && line !== '' ? 0 : -1
    }
    if (isWord) {
      if (wordAt < 0) wordAt = line.length
    } else wordAt = -1
    line += ch
    used += w
  }
  out.push(line)
  return out
}

/** 估算一串按钮排成几行，用来算树视图还剩多少高度 */
export const estimateWrappedRows = (labels: readonly string[], columns: number) => {
  let rows = 1
  let used = 0
  for (const label of labels) {
    const w = cellWidth(label)
    if (used > 0 && used + 1 + w > columns) {
      rows++
      used = w
    } else used += (used > 0 ? 1 : 0) + w
  }
  return rows
}

/** 一段文字在给定宽度下大约占几行（中日韩文字占两格） */
export const textRows = (text: string, columns: number) => Math.max(1, Math.ceil(cellWidth(text) / Math.max(4, columns)))
