import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { AgendaGroup, Block, Body, Evidence, Kind, Level, Metrics, Recap, Status, StatusChange, Tech, View } from '../types'
import type { Field, Line, MenuItem } from './outline'
import { PH, PH_SVG } from './icons'
import type { PhosphorIcon } from './icons'
import { FIRE_MS, statusSvg } from './status'
import {
  DEFAULT_KEYS,
  KIND_BADGE,
  STATUSES,
  STATUS_INFO,
  glyph,
  hasOpenForMe,
  itemStatus,
  lineText,
  isMark,
  nextBadStatus,
  nextStatus,
  parseKey,
  FIELD,
  ITEM_MARK,
  normalizeStatus,
  statusText,
  VIEW_INFO,
  ancestorsOf,
  blockLines,
  childrenOf,
  clip,
  estimateWrappedRows,
  isOpenStatus,
  matches,
  parseKeys,
  sumTech,
  techLines,
  addMetrics,
  measure,
  metricsLines,
  textRows,
  toMarkdown,
  toTreeRows,
  viewFromArg,
  visibleRows,
  waitingCount,
} from './outline'

const PANE = 'outline'
const TITLE = '大纲'
const AGENDA = 'agenda'
const STORE_PREFIX = 'session:'
const STORE_KEEP = 30
const TREE = 'tree'

const blocks = atom({ plugin: 'outline-sidebar', key: 'blocks' } as const, [])
const folded = atom({ plugin: 'outline-sidebar', key: 'folded' } as const, [])
const open = atom({ plugin: 'outline-sidebar', key: 'open' } as const, [])
const view = atom({ plugin: 'outline-sidebar', key: 'view' } as const, 'all')
const level = atom({ plugin: 'outline-sidebar', key: 'level' } as const, 'contents')
const cursor = atom({ plugin: 'outline-sidebar', key: 'cursor' } as const, null)
const zoom = atom({ plugin: 'outline-sidebar', key: 'zoom' } as const, null)
const corrections = atom({ plugin: 'outline-sidebar', key: 'corrections' } as const, 0)
const bodyFolded = atom({ plugin: 'outline-sidebar', key: 'bodyFolded' } as const, [])
const bodyFoldAll = atom({ plugin: 'outline-sidebar', key: 'bodyFoldAll' } as const, false)
const body = atom({ plugin: 'outline-sidebar', key: 'body' } as const, { labels: {}, hide: [] })
const agenda = atom({ plugin: 'outline-sidebar', key: 'agenda' } as const, [])
const recap = atom({ plugin: 'outline-sidebar', key: 'recap' } as const, null)
const legend = atom({ plugin: 'outline-sidebar', key: 'legend' } as const, false)
const changes = atom({ plugin: 'outline-sidebar', key: 'changes' } as const, [])
const scope = atom({ plugin: 'outline-sidebar', key: 'scope' } as const, 'tabs')
const metricsAll = atom({ plugin: 'outline-sidebar', key: 'metricsAll' } as const, null)

/** 面板上（键盘不在树里）按 ⏎：Claude Code 只让鼠标点击把键盘交给树 */
const ENTER_TIP = '用鼠标点一下下面的大纲树，键盘就进去了；之后选视图、⏎ 进入、⌫ 返回都在树里完成，别按 Esc'

const LEVELS: Level[] = ['overview', 'contents', 'all']
const LEVEL_LABEL: Record<Level, string> = { overview: '只看顶层', contents: '全部标题', all: '全部展开' }

/** 工具栏：文字按钮（中文输入法下用不了字母快捷键时，点按钮或在树里按回车用菜单） */
const ACTIONS: { key: string; hotkey: string; label: string }[] = [
  { key: 'down', hotkey: 'j', label: '下' },
  { key: 'up', hotkey: 'k', label: '上' },
  { key: 'fold-up', hotkey: 't', label: '折叠到母块' },
  { key: 'unfold-down', hotkey: 'e', label: '展开子块' },
  { key: 'detail', hotkey: 'd', label: '详情' },
  { key: 'indent', hotkey: 'l', label: '缩进' },
  { key: 'outdent', hotkey: 'h', label: '反缩进' },
  { key: 'status', hotkey: 's', label: '切状态' },
  { key: 'status-bad', hotkey: 'n', label: '负面状态' },
  { key: 'level', hotkey: 'o', label: '层级' },
  { key: 'zoom', hotkey: 'z', label: '聚焦' },
  { key: 'body', hotkey: 'f', label: '正文折叠' },
  { key: 'body-all', hotkey: 'w', label: '正文全折' },
  { key: 'progress', hotkey: 'p', label: '刷新进度' },
  { key: 'recap', hotkey: 'r', label: '回顾' },
  { key: 'jump', hotkey: 'g', label: '跳转' },
  { key: 'export', hotkey: 'x', label: '导出' },
  { key: 'legend', hotkey: 'i', label: '图例' },
]

/** 图例里列出的字段 */
const LEGEND_FIELDS = ['needsMe', 'did', 'proof', 'files', 'conclusion', 'question', 'resolved', 'ask', 'live', 'last', 'note', 'stats', 'tokens', 'cache', 'time', 'model', 'skills', 'mcp', 'slash', 'agents', 'outline', 'coverage', 'review', 'reopen', 'fix'] as const

/** 图例占几行（终端），用来算树视图还剩多少高度 */
const legendRows = (width: number) =>
  estimateWrappedRows(STATUSES.map(st => statusText(st)), width) + estimateWrappedRows(LEGEND_FIELDS.map(f => `${glyph(f)} ${FIELD[f].label}`), width)

// ---------- 桌面版的图标：SVG ----------

/** Phosphor 图标的 SVG，颜色跟文字 */
const phosphorIconSvg = (icon: PhosphorIcon, color: string) => {
  const { path, size } = PH_SVG[icon]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><path fill="${color}" d="${path}"/></svg>`
}

const phosphorSvg = (field: Field, color: string) => {
  const icon = FIELD[field].icon
  return isMark(icon) ? undefined : phosphorIconSvg(icon, color)
}

const ICON_PX = 14

type DesktopEls = Elements['desktop']

/** 桌面版一行：每段「图标 字」 */
function desktopLine(els: DesktopEls, line: Line) {
  const { Box, Text, Svg } = els
  const props = { line }
  const color = line.color === undefined ? '#8a8f98' : line.color === 'claude' ? '#c8635f' : line.color === 'warning' ? '#b39a3e' : line.color
  return (
    <Box flexDirection="row" columnGap={1} flexWrap="wrap">
      {props.line.parts.map(part => {
        const svg = phosphorSvg(part.field, color)
        return (
          <Box flexDirection="row" columnGap={1}>
            {svg === undefined ? <Text>{glyph(part.field)}</Text> : <Svg source={svg} alt={FIELD[part.field].label} width={ICON_PX} height={ICON_PX} />}
            {part.text !== '' && <Text color={props.line.color} dimColor={props.line.color === undefined}>{part.text}</Text>}
          </Box>
        )
      })}
    </Box>
  )
}

/** 桌面版的状态：todoseq 的 SVG（Doing 一直转，刚换上的状态播一次出场动效）+ 关键词 */
function desktopStatus(els: DesktopEls, status: Status, isFire: boolean, isContext = false) {
  const { Box, Text, Svg } = els
  const props = { status, isFire, isContext }
  const info = STATUS_INFO[props.status]
  const isAnimated = props.status === 'DOING' || props.isFire
  return (
    <Box flexDirection="row" columnGap={1}>
      <Svg source={statusSvg(props.status, props.isFire)} alt={info.label} width={ICON_PX} height={ICON_PX} {...(isAnimated ? { isInteractive: true } : {})} />
      <Text color={info.color} bold={isOpenStatus(props.status)} dimColor={props.isContext === true}>{info.label}</Text>
    </Box>
  )
}


// ---------- 一轮里采集到的东西 ----------

/** 子任务、fork、/btw：挂在它所在那一轮下面 */
type Branch = { kind: Kind; title: string; ask: string; conclusion: string; status: Status; tokens: number }

type Turn = {
  turnId: string
  text: string
  messageId?: string
  rowIds: string[]
  files: Set<string>
  commands: string[]
  slash: string[]
  skills: string[]
  mcp: string[]
  branches: Branch[]
  agentTokens: number
  /** 一开始就建好的「进行中」块 */
  blockId: string
  startedAt: number
  /** 每一步做了什么，手动刷新时交给 haiku */
  steps: string[]
  /** Claude Code 到目前为止写出的文字 */
  texts: string[]
  /** 改了的文件、跑了的命令和结果，给「做了」挂证据 */
  evidence: Evidence[]
}

const usageTotal = (u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | undefined) =>
  u === undefined ? 0 : u.input_tokens + u.output_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)

const emptyBlock = (id: string, kind: Kind, turn: number, parent: string | null): Block => ({
  id,
  kind,
  turn,
  ask: '',
  title: '',
  status: 'DONE',
  did: [],
  conclusion: '',
  questions: [],
  needsMe: [],
  parent,
  isManual: false,
  isStatusManual: false,
  isPending: false,
  files: [],
  commands: 0,
})

const branchBlock = (br: Branch, id: string, turn: number, parent: string | null): Block => ({
  ...emptyBlock(id, br.kind, turn, parent),
  ask: br.ask,
  title: br.title,
  status: br.status,
  conclusion: br.conclusion,
})

// ---------- 跨事件的采集状态（重载后重新开始） ----------

let cwd = ''
let current: Turn | undefined
let lastPromptId: string | undefined
/** 子代理是在哪一轮里切出去的 */
const agentOwner = new Map<string, string>()
/** 一轮结束后对应的块 id */
const turnBlock = new Map<string, string>()
let lastTurnId: string | undefined
/** 敲了还没归到哪一轮的斜杠命令 */
let pendingSlash: string[] = []

// ---------- 保存，--resume 后恢复 ----------

type Saved = { blocks?: Block[]; cwd?: string; savedAt?: number }

async function persist($: EngineInterface) {
  const sid = await $.session.id()
  await $.store.set(`${STORE_PREFIX}${sid}`, { blocks: await read($, blocks), cwd, savedAt: await $.clock.now() })
  const keys = (await $.store.keys()).filter(k => k.startsWith(STORE_PREFIX))
  for (const old of keys.slice(0, Math.max(0, keys.length - STORE_KEEP))) await $.store.delete(old)
}

async function setBlocks($: EngineInterface, change: (list: Block[]) => Block[]) {
  await update($, blocks, list => change(list ?? []))
  await persist($)
  await refreshBody($)
}

/** 改名前的插件在这个会话里记下的大纲 */
const legacyBlocks = { plugin: 'org-inspired-chat', key: 'blocks' } as const

async function restore($: EngineInterface) {
  if ((await read($, blocks)).length === 0) {
    const { value: old = [] } = await $.state.get(legacyBlocks)
    if (old.length > 0) await update($, blocks, () => old.map(b => ({ ...b, kind: b.kind ?? 'turn', status: normalizeStatus(String(b.status)) })))
  }
  const saved = (await $.store.get(`${STORE_PREFIX}${await $.session.id()}`)) as Saved | undefined
  const list = saved?.blocks
  if ((await read($, blocks)).length === 0 && Array.isArray(list) && list.length > 0) {
    // 旧版本存下的块没有 kind，状态也是旧写法
    await update($, blocks, () => list.map(b => ({ ...b, kind: b.kind ?? 'turn', status: normalizeStatus(String(b.status)) })))
  }
  // 当前会话里已有的旧状态（CANCELED、DOING 以外的旧词）也换成新写法
  const current = await read($, blocks)
  if (current.some(b => !(STATUSES as string[]).includes(b.status))) {
    await update($, blocks, all => (all ?? []).map(b => ({ ...b, status: normalizeStatus(String(b.status)) })))
  }
}

// ---------- 正文折叠 ----------

/** 按折叠设置算出：哪些消息改画成一行摘要，哪些行藏起来 */
async function refreshBody($: EngineInterface) {
  const list = await read($, blocks)
  const isAll = await read($, bodyFoldAll)
  const toggled = await read($, bodyFolded)
  const turns = list.filter(b => b.kind === 'turn')
  const last = turns.at(-1)?.id
  const next: Body = { labels: {}, hide: [] }
  for (const b of turns) {
    if (b.messageId === undefined || b.isPending) continue
    // 全折模式下，最新一轮默认不折，toggled 里的是例外
    const isFolded = isAll ? b.id !== last !== toggled.includes(b.id) : toggled.includes(b.id)
    if (!isFolded) continue
    const open = b.needsMe.filter((_, i) => isOpenStatus(itemStatus(b, i)))
    const waiting = open.length > 0 ? `  需要我做：${open.join('；')}` : ''
    next.labels[b.messageId] = `▸ ${STATUS_INFO[b.status].label}  ${b.title}${waiting}`
    next.hide.push(...(b.rowIds ?? []))
  }
  await update($, body, () => next)
}

async function toggleBodyFold($: EngineInterface) {
  const id = await cursorBlockId($)
  const b = (await read($, blocks)).find(one => one.id === id)
  // 子任务和 btw 跟着它所在那一轮
  const turnId = b?.kind === 'turn' ? b.id : b?.parent ?? undefined
  if (turnId === undefined) return
  await update($, bodyFolded, ids => toggle(ids, turnId))
  await refreshBody($)
}

async function toggleBodyFoldAll($: EngineInterface) {
  await update($, bodyFoldAll, on => !on)
  await update($, bodyFolded, () => [])
  await refreshBody($)
  $.ui.toast((await read($, bodyFoldAll)) ? '正文全折：除了最新一轮，每轮只留一行摘要' : '正文全部展开')
}

async function hideRow($: EngineInterface, requestId: string, isExpanded: boolean | undefined) {
  if (isExpanded === true) return false
  return (await read($, body)).hide.includes(requestId)
}

// ---------- 总结 ----------

/** 交给模型的状态说明：关键词 + 什么时候用 */
const STATUS_LINES = STATUSES.map(st => `\n  ${st}：${STATUS_INFO[st].meaning}`).join('')

const SYSTEM = `你在给一段 Claude Code 会话做大纲。每次给你「现有大纲」和「刚结束的一轮」，你把这一轮变成大纲里的一个块。
只输出一个 JSON 对象，不要任何别的文字，不要代码块标记。字段：
- title：用户要 Claude Code 做什么，一句话，中文，不超过 30 字，动词开头
- status：从下面选一个最贴切的关键词（照用户在 Obsidian todoseq 里的那一套）：${STATUS_LINES}
- did：Claude Code 这一轮实际做了的事，数组，每条是 { "text": 一短句, "evidence": [证据编号] }；evidence 只能填下面「证据」里列出的编号，哪条证据能证明这件事做了就填哪条，没有能证明它的证据就填空数组，不许编；没做事就空数组
- conclusion：这一轮定下来的结论，一句话，没有就空字符串
- questions：还没解决的问题，没有就空数组
- needsMe：需要用户做的事（确认、选择、手动操作），没有就空数组
- parent：如果这一轮是顺着现有大纲里某个块继续深入的同一个功能或话题，填那个块的 id；换了新话题或新功能，填 null
- resolved：现有大纲里「待用户处理」的块中，被这一轮解决了的块 id 数组，没有就空数组
用户在一轮进行中的插话只是引导和补充，不单独当成任务；以这一轮从提问到做完的整体为准。`

const describeOutline = (list: readonly Block[]) => {
  const turns = list.filter(b => b.kind === 'turn')
  const lines = turns.slice(-40).map(b => `${'  '.repeat(ancestorsOf(list, b).length)}- [${b.id}] ${b.status} ${b.title}`)
  const waiting = turns.filter(b => (b.needsMe.length > 0 || b.status === 'WAITING') && isOpenStatus(b.status))
  const pending = waiting.map(b => `- [${b.id}] ${b.title}：${b.needsMe.join('；') || '等待确认'}`)
  return `现有大纲：\n${lines.join('\n') || '（空）'}\n\n待用户处理的块：\n${pending.join('\n') || '（无）'}`
}

const parseJson = (text: string) => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return undefined
  }
}

const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string' && one !== '') : []

/** 证据最多记这么多条，交给模型的也是这些 */
const MAX_EVIDENCE = 30

/** 工具跑完记一条证据：改文件按文件去重，跑命令记成没成、输出的最后一行 */
function addEvidence(turn: Turn, tool: string, input: Record<string, unknown>, isFailed: boolean, output: string | undefined) {
  if (turn.evidence.length >= MAX_EVIDENCE) return
  if ((tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') && typeof input.file_path === 'string') {
    const text = base(input.file_path)
    const seen = turn.evidence.find(one => one.kind === 'edit' && one.text === text)
    if (seen === undefined) turn.evidence.push({ kind: 'edit', text, isOk: !isFailed })
    else if (!isFailed) seen.isOk = true
  }
  if (tool === 'Bash' && typeof input.command === 'string') {
    const tail = (output ?? '').split('\n').map(line => line.trim()).filter(line => line !== '').at(-1)
    turn.evidence.push({ kind: 'run', text: clip(input.command.split('\n')[0] ?? '', 80), isOk: !isFailed, ...(tail === undefined ? {} : { tail: clip(tail, 60) }) })
  }
}

const evidenceText = (e: Evidence) => (e.kind === 'edit' ? `改了 ${e.text}${e.isOk ? '' : '（失败）'}` : `跑了 ${e.text}（${e.isOk ? '成功' : '报错'}${e.tail === undefined ? '' : `：${e.tail}`}）`)

/** 模型给的 did：新格式是 { text, evidence: [编号] }，旧格式是字符串；编号从 1 开始，对不上的丢掉 */
const parseDid = (value: unknown, count: number) => {
  const did: string[] = []
  const proofs: number[][] = []
  for (const one of Array.isArray(value) ? value : []) {
    const item = typeof one === 'string' ? { text: one, evidence: [] } : (one as { text?: unknown; evidence?: unknown })
    if (typeof item.text !== 'string' || item.text === '') continue
    did.push(item.text)
    const nums = Array.isArray(item.evidence) ? item.evidence.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= count) : []
    proofs.push([...new Set(nums)].map(n => n - 1))
  }
  return { did, proofs }
}

async function summarize($: EngineInterface, id: string, turn: Turn, answer: string, isAborted: boolean) {
  const before = (await read($, blocks)).filter(b => b.id !== id && !b.isPending && b.live === undefined)
  const prompt = [
    describeOutline(before),
    '',
    '刚结束的一轮：',
    `用户原话：${clip(turn.text, 2000)}`,
    `Claude Code 的回答：${clip(answer, 4000) || '（无文字回答）'}`,
    `证据（编号从 1 开始）：\n${turn.evidence.map((one, i) => `[${i + 1}] ${evidenceText(one)}`).join('\n') || '（无）'}`,
    `切出去的子任务：${turn.branches.map(br => `${br.title}（${clip(br.conclusion, 200)}）`).join('；') || '（无）'}`,
    isAborted ? '这一轮被用户中断了。' : '',
  ].join('\n')

  const reply = await $.model.complete({ model: 'haiku', system: SYSTEM, prompt, maxTokens: 1024, timeoutMs: 60000 })
  const data = reply.isAnswered ? parseJson(reply.text) : undefined
  const spent = usageTotal(reply.usage)
  const now = await $.clock.now()
  const didParsed = parseDid(data?.did, turn.evidence.length)

  await setBlocks($, all => {
    const turnIds = new Set(all.filter(b => b.kind === 'turn').map(b => b.id))
    const status = String(data?.status ?? '')
    const parent = typeof data?.parent === 'string' && turnIds.has(data.parent) && data.parent !== id ? data.parent : null
    const resolved = new Set(strings(data?.resolved))
    const self = all.find(b => b.id === id)
    return all.map(b => {
      if (b.id === id) {
        return {
          ...b,
          isPending: false,
          title: typeof data?.title === 'string' && data.title !== '' ? data.title : b.title,
          status: (STATUSES as string[]).includes(status) ? (status as Status) : isAborted ? 'PAUSED' : 'DONE',
          statusAt: now,
          needsMeStatus: undefined,
          did: didParsed.did,
          evidence: turn.evidence,
          didEvidence: didParsed.proofs,
          conclusion: typeof data?.conclusion === 'string' ? data.conclusion : '',
          questions: strings(data?.questions),
          needsMe: strings(data?.needsMe),
          parent: b.isManual ? b.parent : parent,
          tech: b.tech === undefined ? undefined : { ...b.tech, outlineTokens: b.tech.outlineTokens + spent },
        }
      }
      // 被这一轮解决的待办：改成 DONE，待办条目留着，显示成已完成
      if (resolved.has(b.id) && !b.isStatusManual && b.status !== 'DONE') {
        return { ...b, status: 'DONE' as const, resolvedIn: self?.turn, statusAt: now }
      }
      return b
    })
  })
  if (!reply.isAnswered) $.ui.log(`outline-sidebar：这一轮没总结成（${reply.reason}），先用原话当标题`, { to: 'debug' })
}

/** 把子任务或 /btw 挂到它所在那一轮下面；那一轮还在跑就先攒着 */
async function addBranch($: EngineInterface, br: Branch, ownerTurn: string | undefined) {
  if (current !== undefined && (ownerTurn === undefined || ownerTurn === current.turnId)) {
    current.branches.push(br)
    return
  }
  const all = await read($, blocks)
  const parentId = (ownerTurn === undefined ? undefined : turnBlock.get(ownerTurn)) ?? all.filter(b => b.kind === 'turn').at(-1)?.id ?? null
  const parent = all.find(b => b.id === parentId)
  const id = `${parentId ?? 'x'}.${all.filter(b => b.parent === parentId).length + 1}`
  await setBlocks($, list => [...list, branchBlock(br, id, parent?.turn ?? 0, parentId)])
}

// ---------- 面板里的操作 ----------

const toggle = (list: readonly string[] | undefined, id: string) =>
  (list ?? []).includes(id) ? (list ?? []).filter(one => one !== id) : [...(list ?? []), id]

async function currentRows($: EngineInterface) {
  return visibleRows(await read($, blocks), await read($, view), await read($, folded), await read($, zoom), await read($, open))
}

/** 光标可能停在「需要我做」的某一条上；块一级的操作（折叠、缩进、聚焦…）作用在它所在的块 */
async function cursorBlockId($: EngineInterface) {
  const key = await read($, cursor)
  return key === null ? null : parseKey(key).blockId
}

async function moveCursor($: EngineInterface, step: number) {
  const rows = await currentRows($)
  if (rows.length === 0) return
  const id = await read($, cursor)
  const at = rows.findIndex(r => r.key === id)
  const next = at < 0 ? (step > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, at + step))
  await update($, cursor, () => rows[next]!.key)
}

/** 换了视图，光标要是不在这个视图的行里，就放到第一行 */
async function keepCursorInView($: EngineInterface) {
  const rows = await currentRows($)
  const key = await read($, cursor)
  if (rows.some(r => r.key === key)) return
  const first = rows.find(r => !r.isContext) ?? rows[0]
  await update($, cursor, () => first?.key ?? null)
}

async function switchView($: EngineInterface, v: View) {
  await update($, view, () => v)
  await keepCursorInView($)
  if (v === 'tech') await measureAll($)
}

/** 所有会话的验收指标：当前会话加上各个会话存下的大纲 */
async function measureAll($: EngineInterface) {
  const sid = await $.session.id()
  let total: Metrics = measure(await read($, blocks))
  for (const key of await $.store.keys()) {
    if (!key.startsWith(STORE_PREFIX) || key === `${STORE_PREFIX}${sid}`) continue
    const saved = (await $.store.get(key)) as Saved | undefined
    if (Array.isArray(saved?.blocks)) total = addMetrics(total, measure(saved.blocks))
  }
  await update($, metricsAll, () => total)
}

/** 视图栏上 ←→：在数字键的顺序里挪一格 */
async function stepView($: EngineInterface, keys: readonly View[], step: number) {
  const at = keys.indexOf(await read($, view))
  await switchView($, keys[(at + step + keys.length) % keys.length]!)
}

async function enterView($: EngineInterface) {
  await update($, scope, () => 'tree')
  await keepCursorInView($)
}

/** 点树之前用的输入法；回对话框敲第一个键时切回去 */
let restoreInput: string | undefined

/** 面板上一次画的时候有没有键盘，用来只在刚拿到键盘那一下切输入法 */
let isPaneFocused = false

/**
 * 点进大纲树时切到英文键盘：中文输入法开着，J/K、T 这些字母会被拿去组字。
 * 用 tools/ascii-input.swift（第一次用时编译到 bin/），只在 macOS 上，失败了也不打扰
 */
async function asciiInput($: EngineInterface) {
  const tool = `${$.plugin.root}/bin/ascii-input`
  const run = () =>
    $.process.run([tool], { timeoutMs: 3000 }).then(
      r => {
        const before = r.stdout.trim()
        // 原来就是英文就不用切回去；连着点几下，记的还是最早那个
        if (r.exitCode === 0 && before !== '' && before !== 'com.apple.keylayout.US' && restoreInput === undefined) restoreInput = before
        return r.exitCode === 0
      },
      () => false,
    )
  if (await run()) return
  try {
    await $.process.run(['/bin/mkdir', '-p', `${$.plugin.root}/bin`])
    const built = await $.process.run(['/usr/bin/swiftc', '-O', `${$.plugin.root}/tools/ascii-input.swift`, '-o', tool], { timeoutMs: 120000 })
    if (built.exitCode === 0) await run()
  } catch {
    // 不是 macOS，或者没装 Xcode 命令行工具：就不切了
  }
}

async function pick($: EngineInterface, key: string) {
  await update($, scope, () => 'tree')
  const { blockId, index } = parseKey(key)
  // 点块：第二下展开详情。点只挪光标，不改状态，改状态用 S
  if ((await read($, cursor)) === key) {
    if (index === undefined) {
      await update($, open, ids => toggle(ids, blockId))
      if ((await read($, open)).includes(blockId)) await markReviewed($, blockId)
    }
  } else await update($, cursor, () => key)
}

async function toggleFold($: EngineInterface, force?: boolean) {
  const id = await cursorBlockId($)
  if (id === null) return
  await update($, folded, ids => {
    const has = (ids ?? []).includes(id)
    const want = force ?? !has
    return want === has ? (ids ?? []) : toggle(ids, id)
  })
  await keepCursorVisible($)
}

/**
 * T：在子块里按，把它所在的母块折起来，光标跳到母块上；再按一次就再往上折一层。
 * 顶层块没有母块，就折它自己的子块。「需要我做」的一条，母块就是它所在的块
 */
async function foldUp($: EngineInterface) {
  const key = await read($, cursor)
  if (key === null) return
  const { blockId, index } = parseKey(key)
  const all = await read($, blocks)
  const b = all.find(one => one.id === blockId)
  if (b === undefined) return
  // 聚焦时，聚焦的那块就是顶，不再往上
  const target = index !== undefined ? b.id : b.parent !== null && b.id !== (await read($, zoom)) ? b.parent : null
  if (target === null) return toggleFold($)
  await update($, folded, ids => ((ids ?? []).includes(target) ? (ids ?? []) : [...(ids ?? []), target]))
  await update($, cursor, () => target)
}

/** E：和 T 反过来，展开光标所在的块，光标跳到它的第一个子块上；再按就再往下一层 */
async function unfoldDown($: EngineInterface) {
  const id = await cursorBlockId($)
  if (id === null) return
  await update($, folded, ids => (ids ?? []).filter(one => one !== id))
  const rows = await currentRows($)
  const at = rows.findIndex(r => r.key === id)
  const below = rows[at + 1]
  if (at >= 0 && below !== undefined && parseKey(below.key).blockId !== id && below.block.parent === id) await update($, cursor, () => below.key)
}

/** ⌥1 / ⌥2 / ⌥3：整棵大纲展开到第几层，更深的折起来 */
async function showDepth($: EngineInterface, depth: number) {
  const all = await read($, blocks)
  const atDepth = all.filter(b => ancestorsOf(all, b).length === depth - 1 && (childrenOf(all, b.id).length > 0 || b.needsMe.length > 0))
  await update($, folded, () => atDepth.map(b => b.id))
  await keepCursorVisible($)
  $.ui.toast(`展开到第 ${depth} 层`)
}

async function toggleDetail($: EngineInterface) {
  const id = await cursorBlockId($)
  if (id === null) return
  await update($, open, ids => toggle(ids, id))
  if ((await read($, open)).includes(id)) await markReviewed($, id)
}

/** 展开详情就算看过证据了 */
async function markReviewed($: EngineInterface, id: string) {
  const now = await $.clock.now()
  await setBlocks($, all => all.map(b => (b.id === id && b.status === 'TOREVIEW' ? { ...b, reviewedAt: now } : b)))
}

/**
 * 验收关口：ToReview 改成 Done 之前，要先展开详情看过证据。
 * 没看过就替你展开，这一下不改状态；看完再按一次才算通过
 */
async function passesReview($: EngineInterface, b: Block, to: Status) {
  if (b.status !== 'TOREVIEW' || to !== 'DONE') return true
  if (b.reviewedAt !== undefined && b.reviewedAt >= (b.statusAt ?? 0)) return true
  await update($, open, ids => (ids.includes(b.id) ? ids : [...ids, b.id]))
  await markReviewed($, b.id)
  const bare = b.didEvidence === undefined ? 0 : b.didEvidence.filter(nums => nums.length === 0).length
  $.ui.toast(bare > 0 ? `先看证据：已展开，有 ${bare} 条「做了」没有证据；看完再按一次才改成 Done` : '先看证据：已展开，看完再按一次才改成 Done')
  return false
}

async function reparent($: EngineInterface, direction: 'in' | 'out') {
  const id = await cursorBlockId($)
  if (id === null) return
  let isChanged = false
  await setBlocks($, all => {
    const b = all.find(one => one.id === id)
    if (b === undefined) return all
    let parent = b.parent
    if (direction === 'in') {
      // 缩进：挂到上一个兄弟块下面
      const siblings = childrenOf(all, b.parent)
      const above = siblings[siblings.findIndex(s => s.id === id) - 1]
      if (above === undefined) return all
      parent = above.id
    } else {
      // 反缩进：提到父块同级
      if (b.parent === null) return all
      parent = all.find(one => one.id === b.parent)?.parent ?? null
    }
    isChanged = true
    return all.map(one => (one.id === id ? { ...one, parent, isManual: true } : one))
  })
  if (isChanged) await update($, corrections, n => (n ?? 0) + 1)
}

/** 改光标所在那一行的状态：块，或者「需要我做」的某一条 */
async function changeStatus($: EngineInterface, pick: (current: Status) => Status) {
  const key = await read($, cursor)
  if (key === null) return
  const { blockId, index } = parseKey(key)
  const now = await $.clock.now()
  const target = (await read($, blocks)).find(b => b.id === blockId)
  if (index === undefined && target !== undefined && !(await passesReview($, target, pick(target.status)))) return
  let change: StatusChange | undefined
  let verdict: Status | undefined
  await setBlocks($, all =>
    all.map(b => {
      if (b.id !== blockId) return b
      if (index === undefined) {
        const to = pick(b.status)
        // 验收通过：告诉 Claude 是看过证据才通过的，没证据的那几条也说出来
        const bare = b.did.filter((_, i) => b.didEvidence !== undefined && (b.didEvidence[i] ?? []).length === 0)
        const checked = b.status === 'TOREVIEW' && to === 'DONE' ? `（用户看过证据后验收${bare.length > 0 ? `；其中这几条没有工具调用能证明：${bare.join('；')}` : ''}）` : ''
        change = { key, what: `块 [${b.id}]「${b.title}」${checked}`, from: b.status, to }
        // 指标：验收放行 / 拦下，Done 之后重新打开（改成 Cancelled 不算返工）
        const marks: Partial<Block> = {}
        if (b.status === 'TOREVIEW' && to !== 'TOREVIEW') {
          if (to === 'DONE') marks.reviewPassed = true
          else marks.reviewBlocked = true
        }
        if (b.status === 'DONE' && to !== 'DONE' && to !== 'CANCELLED') marks.isReopened = true
        if (b.status === 'TOREVIEW' || verdicts.has(b.id)) verdict = to
        return { ...b, ...marks, status: to, isStatusManual: true, statusAt: now }
      }
      const marks = b.needsMe.map((_, i) => b.needsMeStatus?.[i] ?? null)
      const from = itemStatus(b, index)
      marks[index] = pick(from)
      change = { key, what: `需要用户做的「${b.needsMe[index] ?? ''}」（块 [${b.id}]「${b.title}」）`, from, to: marks[index]! }
      return { ...b, needsMeStatus: marks }
    }),
  )
  if (change !== undefined) await noteChange($, change)
  if (verdict !== undefined) noteVerdict($, blockId, verdict)
}

// ---------- 验收没通过：交给 Claude 回应 ----------

/** 验收时我给了这个状态，Claude 该怎么接 */
const VERDICT: Partial<Record<Status, string>> = {
  FAILED: '没做成。先对照这一轮的改动和命令结果找原因：原因清楚就直接返工，改完让我再验收；拿不准哪里不对，先追问我，别瞎改。',
  ERRORED: '出错卡住了。先排查报错、修好再继续；缺信息就追问我。',
  HITLIMIT: '撞上了额度或用量上限。先停下，说明卡在哪个上限、大概什么时候能继续，别反复重试。',
  SUSPENDED: '先搁置。别再动它，用两三句话记下现在做到哪、还差什么，方便以后接上。',
  CANCELLED: '不做了。停下；这件事要是已经改了文件，列出改动，问我要不要撤回，我没同意之前别动。',
  DOING: '还没做完。说清还差什么，接着做完，做完让我再验收。',
}

/** 等我停手再发：N 要连按几下才换到想要的状态 */
const VERDICT_DELAY = 4000

/** 验收时被我改了状态、还没交给 Claude 的块 */
const verdicts = new Set<string>()
let verdictRound = 0

function noteVerdict($: EngineInterface, id: string, to: Status) {
  verdicts.add(id)
  const round = ++verdictRound
  if (VERDICT[to] !== undefined) $.ui.toast(`${VERDICT_DELAY / 1000} 秒后交给 Claude 回应（${STATUS_INFO[to].label}），这期间还能接着换状态`)
  $.clock.after(VERDICT_DELAY, () => {
    if (round === verdictRound) void sendVerdicts($)
  })
}

/** 停手以后看最终状态：没通过的发一条消息给 Claude，按状态说清怎么接；改回 Done 的就算了 */
async function sendVerdicts($: EngineInterface) {
  const ids = [...verdicts]
  verdicts.clear()
  const all = await read($, blocks)
  const lines = ids.flatMap(id => {
    const b = all.find(one => one.id === id)
    const how = b === undefined ? undefined : VERDICT[b.status]
    return b === undefined || how === undefined ? [] : [`- 块 [${b.id}]「${b.title}」：${STATUS_INFO[b.status].label}。${how}`]
  })
  if (lines.length === 0) return
  // mod 自己发的消息不经过自己的 prompt.submit 钩子：侧栏里改过的状态直接接在正文后面
  const told = await takeChanges($)
  await $.prompt.submit({ text: ['我在大纲侧栏验收时，没让下面这些事通过。请逐条回应：', ...lines, ...(told === undefined ? [] : ['', told])].join('\n') })
}

/** 同一处改了几次只记最后一次；改回原样就不用说了 */
async function noteChange($: EngineInterface, change: StatusChange) {
  await update($, changes, list => {
    const before = (list ?? []).find(one => one.key === change.key)
    const rest = (list ?? []).filter(one => one.key !== change.key)
    const from = before?.from ?? change.from
    return from === change.to ? rest : [...rest, { ...change, from }]
  })
}

/** 发消息时附给 Claude 的一段话：侧栏里改了哪些状态 */
async function takeChanges($: EngineInterface) {
  const list = await read($, changes)
  if (list.length === 0) return undefined
  await update($, changes, () => [])
  const lines = list.map(c => `- ${c.what}：${c.from} → ${c.to}`)
  return [
    '用户在会话大纲侧栏里手动改了下面这些状态。这是用户在告诉你进展：「需要用户做」的事改成 DONE，表示用户已经做完了；块的状态改动表示用户对那件事的判断：DONE 是认可做完；FAILED 是用户认为没做成，要返工，先弄清哪里不对；ERRORED 是出了错卡住；HITLIMIT 是撞上额度或用量上限；SUSPENDED 是先搁置、暂时别碰；CANCELLED 是不做了。据此接着做，不用复述这段说明。',
    ...lines,
  ].join('\n')
}

/** ⌘/：照 todoseq 的流转在 Todo、Doing、Done 之间切 */
async function cycleStatus($: EngineInterface) {
  await changeStatus($, nextStatus)
}

async function setStatus($: EngineInterface, status: Status) {
  await changeStatus($, () => status)
}

async function toggleLegend($: EngineInterface) {
  await update($, legend, on => !on)
}

/** 回车弹出的菜单：只用方向键和回车就能做完所有操作 */
const statusMenu = (): MenuItem[] => STATUSES.map(st => ({ id: `status:${st}`, label: statusText(st), color: STATUS_INFO[st].color }))

const menuFor = (lvl: Level, isZoomed: boolean, isBodyAll: boolean): MenuItem[] => [
  { id: 'detail', label: '详情' },
  ...statusMenu(),
  { id: 'fold', label: '折叠子块' },
  { id: 'zoom', label: isZoomed ? '退出聚焦' : '聚焦这一块' },
  { id: 'body', label: '正文里折叠这一轮' },
  { id: 'body-all', label: isBodyAll ? '正文全部展开' : '正文全折' },
  { id: 'jump', label: '跳到对话' },
  { id: 'progress', label: '刷新进度' },
  { id: 'recap', label: '回顾' },
  { id: 'level', label: `全局层级：${LEVEL_LABEL[LEVELS[(LEVELS.indexOf(lvl) + 1) % LEVELS.length]!]}` },
  { id: 'export', label: '导出' },
  { id: 'legend', label: '图例' },
]

/** 光标在「需要我做」的某一条上时，菜单只有改状态 */
const itemMenu = (): MenuItem[] => statusMenu()

/** 层级按钮（O）：只看顶层 → 全部标题 → 全部展开（连详情） */
async function cycleLevel($: EngineInterface) {
  const all = await read($, blocks)
  const next = LEVELS[(LEVELS.indexOf(await read($, level)) + 1) % LEVELS.length]!
  await update($, level, () => next)
  await update($, folded, () => (next === 'overview' ? all.filter(b => childrenOf(all, b.id).length > 0).map(b => b.id) : []))
  await update($, open, () => (next === 'all' ? all.map(b => b.id) : []))
  await keepCursorVisible($)
  $.ui.toast(LEVEL_LABEL[next])
}

/** 折起来以后光标要是被藏住了，挪到看得见的那个祖先块上 */
async function keepCursorVisible($: EngineInterface) {
  const rows = await currentRows($)
  const key = await read($, cursor)
  if (key === null || rows.some(r => r.key === key)) return
  const all = await read($, blocks)
  const b = all.find(one => one.id === parseKey(key).blockId)
  const seen = b === undefined ? [] : [b, ...ancestorsOf(all, b).reverse()]
  const visible = seen.find(one => rows.some(r => r.key === one.id))
  if (visible !== undefined) await update($, cursor, () => visible.id)
  else await keepCursorInView($)
}

async function toggleZoom($: EngineInterface) {
  const id = await read($, cursor)
  const current = await read($, zoom)
  await update($, zoom, () => (current !== null ? null : id === null ? null : parseKey(id).blockId))
}

async function exportView($: EngineInterface, v: View, path?: string) {
  const list = await read($, blocks)
  const rows = visibleRows(list, v, await read($, folded), await read($, zoom))
  const now = new Date(await $.clock.now())
  const md = toMarkdown(list, rows, v, await read($, open), now.toISOString().slice(0, 16).replace('T', ' '))
  const count = rows.filter(r => !r.isContext).length
  if (path !== undefined) {
    await $.fs.write(path, md)
    return `已导出「${VIEW_INFO[v].label}」视图（${count} 块）到 ${path}`
  }
  const copied = await $.ui.copy({ text: md })
  return copied.isCopied
    ? `已复制「${VIEW_INFO[v].label}」视图（${count} 块）的 Markdown`
    : `复制失败（${copied.reason}），可以用 /outline export ${v} <文件路径> 存成文件`
}

async function jump($: EngineInterface) {
  const id = await cursorBlockId($)
  const b = (await read($, blocks)).find(one => one.id === id)
  const messageId = b?.kind === 'turn' ? b.messageId : (await read($, blocks)).find(one => one.id === b?.parent)?.messageId
  if (messageId === undefined) {
    $.ui.toast('这一块没有对应的消息可跳')
    return
  }
  const moved = await $.ui.scroll({ to: { requestId: messageId }, block: 'start' })
  if (moved.deny !== undefined) $.ui.toast(`跳不过去：${moved.deny}`)
}

async function runAction($: EngineInterface, action: string) {
  if (action === 'down') return moveCursor($, 1)
  if (action === 'up') return moveCursor($, -1)
  if (action === 'fold') return toggleFold($)
  if (action === 'fold-up') return foldUp($)
  if (action === 'unfold-down') return unfoldDown($)
  if (action === 'detail') return toggleDetail($)
  if (action === 'indent') return reparent($, 'in')
  if (action === 'outdent') return reparent($, 'out')
  if (action === 'status') return cycleStatus($)
  if (action === 'status-bad') return changeStatus($, nextBadStatus)
  if (action === 'level') return cycleLevel($)
  if (action === 'zoom') return toggleZoom($)
  if (action === 'body') return toggleBodyFold($)
  if (action === 'body-all') return toggleBodyFoldAll($)
  if (action === 'jump') return jump($)
  if (action === 'export') return $.ui.toast(await exportView($, await read($, view)))
  if (action === 'recap') return generateRecap($)
  if (action === 'progress') return refreshProgress($)
  if (action === 'legend') return toggleLegend($)
  if (action.startsWith('status:')) return setStatus($, normalizeStatus(action.slice('status:'.length)))
  if (action === 'cycle') return cycleStatus($)
}

/**
 * 展开到第几层：⇧1 / ⇧2 / ⇧3 打出来的 ! @ #（中文输入法下是全角的），
 * 以及 ⌥1 / ⌥2 / ⌥3 在美式键盘上打出来的 ¡ ™ £。
 * 主推 ⇧：Tern、iTerm 这类终端默认拿 ⌥ 加数字切标签页，按键到不了 Claude Code
 */
const DEPTH_KEYS: Record<string, number> = { '!': 1, '@': 2, '#': 3, '！': 1, '＠': 2, '＃': 3, '¡': 1, '™': 2, '£': 3 }

type KeyMessage = { type: 'key'; key: string; shift: boolean; ctrl: boolean; meta: boolean }

/** 树视图里收到的按键，按 Logseq 的习惯来 */
async function handleKey($: EngineInterface, k: KeyMessage, keys: readonly View[]) {
  const isUp = k.key === 'up'
  const isDown = k.key === 'down'
  // ⇧ 或 ⌥ 加 1～3：终端可能报成 ! @ #、¡ ™ £，也可能报成数字带 shift / meta
  const depth = DEPTH_KEYS[k.key] ?? ((k.meta || k.shift) && /^[1-3]$/.test(k.key) ? Number(k.key) : undefined)
  if (depth !== undefined) return showDepth($, depth)
  // 缩进照 Org 的 ⌥→ / ⌥←
  if ((k.key === 'left' || k.key === 'right') && k.meta) return reparent($, k.key === 'right' ? 'in' : 'out')
  if ((isUp || isDown) && k.ctrl) return toggleFold($, isUp)
  if (isUp || k.key === 'k') return moveCursor($, -1)
  if (isDown || k.key === 'j') return moveCursor($, 1)
  if (k.key === 'left') return toggleFold($, true)
  if (k.key === 'right') return toggleFold($, false)
  if (k.key === 'return' || k.key === 'space') return toggleDetail($)
  if (/^[1-9]$/.test(k.key)) {
    const v = keys[Number(k.key) - 1]
    if (v !== undefined) await switchView($, v)
    return
  }
  // ⇧S：在负面状态之间转（终端可能报成大写 S，也可能是 s 带 shift）
  if (k.key === 'S' || (k.key === 's' && k.shift)) return runAction($, 'status-bad')
  const action = ACTIONS.find(a => a.hotkey === k.key.toLowerCase())
  if (action !== undefined) return runAction($, action.key)
}

/** 敲完几秒还没开新一轮，说明这条命令不走模型，记到最近一轮上 */
async function settleSlash($: EngineInterface, name: string) {
  if (!pendingSlash.includes(name) || current !== undefined) return
  pendingSlash = pendingSlash.filter(one => one !== name)
  await setBlocks($, all => {
    const last = all.filter(b => b.kind === 'turn' && b.tech !== undefined).at(-1)
    if (last?.tech === undefined) return all
    const slash = last.tech.slash ?? []
    if (slash.includes(name)) return all
    return all.map(b => (b.id === last.id && b.tech !== undefined ? { ...b, tech: { ...b.tech, slash: [...slash, name] } } : b))
  })
}

// ---------- 进行中的一轮：实时进度和手动刷新 ----------

const base = (path: unknown) => (typeof path === 'string' ? (path.split('/').pop() ?? path) : '')

/** 一步工具调用用一句话说清楚，给进度用（技术信息视图不记内置工具，这里只是说做到哪了） */
const describeStep = (tool: string, input: Record<string, unknown>) => {
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') return `改 ${base(input.file_path)}`
  if (tool === 'Read') return `读 ${base(input.file_path)}`
  if (tool === 'Bash') return `跑 ${clip(String(input.command ?? '').split('\n')[0] ?? '', 60)}`
  if (tool === 'Grep' || tool === 'Glob') return `搜「${clip(String(input.pattern ?? ''), 40)}」`
  if (tool === 'Skill') return `技能 ${String(input.skill ?? '')}`
  if (tool === 'Agent' || tool === 'Task') return `子任务 ${clip(String(input.description ?? ''), 40)}`
  if (tool === 'WebSearch' || tool === 'WebFetch') return `查 ${clip(String(input.query ?? input.url ?? ''), 50)}`
  if (tool.startsWith('mcp__')) {
    const [, server = '', ...rest] = tool.split('__')
    return `MCP ${server.replace(/^claude_ai_/, '')}/${rest.join('__')}`
  }
  return tool
}

let isLiveQueued = false

/** 工具调用很密，攒一下再写，最多一秒一次 */
function queueLive($: EngineInterface) {
  if (isLiveQueued) return
  isLiveQueued = true
  $.clock.after(1000, () => {
    isLiveQueued = false
    void writeLive($)
  })
}

async function writeLive($: EngineInterface) {
  const turn = current
  if (turn === undefined) return
  await setBlocks($, all =>
    all.map(b =>
      b.id === turn.blockId && b.live !== undefined
        ? { ...b, files: [...turn.files], commands: turn.commands.length, live: { ...b.live, steps: turn.steps.length, last: turn.steps.at(-1) ?? '' } }
        : b,
    ),
  )
}

const PROGRESS_SYSTEM = `Claude Code 还在处理用户的一个请求，用户想知道它做到哪一步了。根据给你的原话、已经做过的步骤和它目前写出的文字，只输出一个 JSON 对象，不要别的文字：
- title：用户要它做什么，一句话，中文，不超过 30 字
- did：到目前为止已经做完的事，每条一短句
- note：一句话说现在做到哪了、接下来要做什么
- needsMe：现在就需要用户做的事，没有就空数组`

/** 手动刷新：这一轮还没结束也先给个小结 */
async function refreshProgress($: EngineInterface) {
  const turn = current
  if (turn === undefined) {
    $.ui.toast('现在没有进行中的一轮，大纲已经是最新的')
    return
  }
  await writeLive($)
  const mark = (patch: Partial<Block>, live: Partial<Block['live'] & object>) =>
    setBlocks($, all => all.map(b => (b.id === turn.blockId && b.live !== undefined ? { ...b, ...patch, live: { ...b.live, ...live } } : b)))
  await mark({}, { isRefreshing: true })
  const prompt = [
    `用户原话：${clip(turn.text, 1500)}`,
    `已经做过的步骤（共 ${turn.steps.length} 步）：\n${turn.steps.slice(-40).map(step => `- ${step}`).join('\n') || '（还没有）'}`,
    `它目前写出的文字：${clip(turn.texts.join('\n'), 3000) || '（还没有）'}`,
  ].join('\n\n')
  const reply = await $.model.complete({ model: 'haiku', system: PROGRESS_SYSTEM, prompt, maxTokens: 512, timeoutMs: 30000 })
  const data = reply.isAnswered ? parseJson(reply.text) : undefined
  if (current?.turnId !== turn.turnId) return // 刷新期间这一轮已经结束，交给正式总结
  if (data === undefined) {
    await mark({}, { isRefreshing: false })
    $.ui.toast(`进度没刷新出来（${reply.isAnswered ? '格式不对' : reply.reason}）`)
    return
  }
  const now = await $.clock.now()
  await mark(
    {
      ...(typeof data.title === 'string' && data.title !== '' ? { title: data.title } : {}),
      did: strings(data.did),
      needsMe: strings(data.needsMe),
    },
    { isRefreshing: false, note: typeof data.note === 'string' ? data.note : '', refreshedAt: now },
  )
}

/** 重载或崩溃后 current 没了，留下的「进行中」块收尾成普通块 */
async function settleStaleLive($: EngineInterface) {
  const list = await read($, blocks)
  if (!list.some(b => b.live !== undefined)) return
  await setBlocks($, all => all.map(b => (b.live === undefined ? b : { ...b, live: undefined, isPending: false })))
}

// ---------- 回顾 ----------

const RECAP_SUFFIX = /\s*\(disable recaps in \/config\)\s*$/

/** 记下一次回顾：面板顶部显示最新的一条，大纲里挂在最近一轮下面 */
async function addRecap($: EngineInterface, text: string, source: Recap['source']) {
  const clean = text.replace(RECAP_SUFFIX, '').trim()
  if (clean === '') return
  const at = await $.clock.now()
  await update($, recap, () => ({ text: clean, source, at }))
  await setBlocks($, all => {
    const parent = all.filter(b => b.kind === 'turn').at(-1)
    const n = all.filter(b => b.kind === 'recap').length + 1
    return [
      ...all,
      { ...emptyBlock(`r${n}`, 'recap', parent?.turn ?? 0, parent?.id ?? null), title: clip(clean, 40), conclusion: clean, ask: source === 'claude' ? 'Claude Code 自带的 recap' : '大纲回顾' },
    ]
  })
}

const RECAP_SYSTEM = `你在给一段 Claude Code 会话写回顾，读的人刚回到电脑前。根据给你的大纲，用 2 到 4 句中文写：做到哪了、定下了什么、还有什么在等用户做。只写这段话，不要标题、不要列表。`

/** 大纲自己的回顾：只读大纲里的块，不读主对话，不占主对话上下文 */
async function generateRecap($: EngineInterface) {
  const list = (await read($, blocks)).filter(b => b.kind === 'turn' && !b.isPending)
  if (list.length === 0) {
    $.ui.toast('还没有可以回顾的内容')
    return
  }
  const previous = await read($, recap)
  await update($, recap, () => ({ text: previous?.text ?? '', source: 'outline' as const, at: previous?.at ?? 0, isPending: true }))
  const lines = list.slice(-30).map(b =>
    [
      `- [${b.status}] ${b.title}`,
      b.did.length > 0 ? `  做了：${b.did.join('；')}` : '',
      b.conclusion !== '' ? `  结论：${b.conclusion}` : '',
      b.needsMe.length > 0 && isOpenStatus(b.status) ? `  等用户：${b.needsMe.join('；')}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  )
  const reply = await $.model.complete({ model: 'haiku', system: RECAP_SYSTEM, prompt: lines.join('\n'), maxTokens: 512, timeoutMs: 60000 })
  if (!reply.isAnswered) {
    await update($, recap, () => previous)
    $.ui.toast(`回顾没生成出来（${reply.reason}）`)
    return
  }
  await addRecap($, reply.text, 'outline')
}

// ---------- Agenda：所有会话里需要我做的事 ----------

async function collectAgenda($: EngineInterface) {
  const sid = await $.session.id()
  const groups: (AgendaGroup & { savedAt: number })[] = []
  const toGroup = (id: string, list: readonly Block[], where: string, savedAt: number, isCurrent: boolean) => {
    const items = list
      .filter(b => b.live === undefined && matches(b, 'me') && isOpenStatus(b.status))
      .map(b => ({ sid: id, blockId: b.id, title: b.title, needsMe: b.needsMe, status: b.status }))
    if (items.length === 0) return
    const date = new Date(savedAt).toISOString().slice(5, 16).replace('T', ' ')
    const first = list.find(b => b.kind === 'turn')?.title ?? ''
    groups.push({ sid: id, label: `${isCurrent ? '🟢' : `🕘 ${date}`}  📁 ${where || '?'}  ${clip(first, 20)}`, isCurrent, items, savedAt })
  }
  toGroup(sid, await read($, blocks), cwd.split('/').pop() ?? '', Number.MAX_SAFE_INTEGER, true)
  for (const key of await $.store.keys()) {
    if (!key.startsWith(STORE_PREFIX) || key === `${STORE_PREFIX}${sid}`) continue
    const saved = (await $.store.get(key)) as Saved | undefined
    if (!Array.isArray(saved?.blocks)) continue
    toGroup(key.slice(STORE_PREFIX.length), saved.blocks, saved.cwd?.split('/').pop() ?? '', saved.savedAt ?? 0, false)
  }
  groups.sort((a, b) => b.savedAt - a.savedAt)
  await update($, agenda, () => groups.map(({ savedAt: _, ...g }) => g))
}

async function markAgendaDone($: EngineInterface, sid: string, blockId: string) {
  const done = (b: Block) => (b.id === blockId ? { ...b, status: 'DONE' as const, isStatusManual: true } : b)
  if (sid === (await $.session.id())) {
    await setBlocks($, all => all.map(done))
  } else {
    const key = `${STORE_PREFIX}${sid}`
    const saved = (await $.store.get(key)) as Saved | undefined
    if (Array.isArray(saved?.blocks)) await $.store.set(key, { ...saved, blocks: saved.blocks.map(done) })
  }
  await collectAgenda($)
}

// ---------- 注册 ----------

export const register: Register = (on, options) => {
  const keys = parseKeys(typeof options.views === 'string' ? options.views : DEFAULT_KEYS)

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    await $.command.register({
      name: 'outline',
      description: '打开会话大纲。可带视图名（conclusions / me / asks / all / done / tech），或 export [视图] [文件路径] 导出',
      argumentHint: '[视图] | export [视图] [路径]',
    })
    await $.command.register({ name: 'agenda', description: '所有会话里需要我做、还没办完的事' })
    await restore($)
    if (current === undefined) await settleStaleLive($)
    await refreshBody($)
    void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  on('command.run', { command: 'outline' }, async ($, e) => {
    const words = e.args.trim().split(/\s+/).filter(Boolean)
    if (words[0]?.toLowerCase() === 'export') {
      const named = words[1] === undefined ? undefined : viewFromArg(words[1])
      const v = named ?? (await read($, view))
      const raw = words.slice(named === undefined ? 1 : 2).join(' ')
      const path = raw === '' ? undefined : raw.startsWith('/') ? raw : `${cwd}/${raw}`
      return { text: await exportView($, v, path) }
    }
    const chosen = words[0] === undefined ? undefined : viewFromArg(words[0])
    if (words[0] !== undefined && chosen === undefined) return { text: `没有「${words[0]}」这个视图。可选：${keys.join('、')}` }
    if (chosen !== undefined) await update($, view, () => chosen)
    await $.ui.open({ id: PANE, title: TITLE, focus: true })
    return { text: chosen === undefined ? '大纲面板已打开。' : `大纲：${VIEW_INFO[chosen].label}` }
  })

  on('command.run', { command: 'agenda' }, async $ => {
    await collectAgenda($)
    await $.ui.open({ id: AGENDA, title: 'Agenda', focus: true })
    const count = (await read($, agenda)).reduce((n, g) => n + g.items.length, 0)
    return { text: count === 0 ? '所有会话都没有需要你做的事。' : `${count} 件需要你做的事。` }
  })

  // /btw 的旁支问题：它不进主对话，单独挂一块
  on('command.run', { command: 'btw' }, async ($, e, next) => {
    const result = await next(e)
    const question = e.args.trim()
    if (question !== '') {
      await addBranch($, { kind: 'btw', title: clip(question.split('\n')[0] ?? '', 40), ask: clip(question, 500), conclusion: clip(result.text ?? '', 300), status: 'DONE', tokens: 0 }, current?.turnId ?? lastTurnId)
    }
    return result
  })

  on('session.append', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      // Claude Code 自带的 recap：一行 away_summary 系统消息
      const message = e.message as { type?: string; name?: string; content?: unknown }
      if (message.type === 'system' && message.name === 'away_summary') {
        const content = message.content
        const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map(c => (c as { text?: string }).text ?? '').join('') : ''
        $.clock.after(0, () => void addRecap($, text, 'claude'))
      }
      if (e.door === 'prompt') lastPromptId = result.uuid
      else if (e.door === 'response' && current !== undefined) {
        if (result.uuid !== undefined) current.rowIds.push(result.uuid)
        const content = (e.message as { content?: unknown }).content
        if (Array.isArray(content)) {
          for (const c of content) {
            const block = c as { type?: string; text?: string }
            if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') current.texts.push(block.text)
          }
        }
      }
    }
    return result
  })

  // 从大纲树回到对话框：敲的第一个键用来切回原来的输入法，不打进对话框
  on('prompt.edit', async ($, e, next) => {
    const back = restoreInput
    if (back === undefined || e.key === undefined) return next(e)
    restoreInput = undefined
    void $.process.run([`${$.plugin.root}/bin/ascii-input`, back], { timeoutMs: 3000 }).catch(() => undefined)
    return /^[a-zA-Z]$/.test(e.key.key) ? { text: e.text, cursor: e.cursor } : next(e)
  })

  // 斜杠命令：记进它所在的那一轮；不开新一轮的命令（/recap、/outline 这类）记到最近一轮
  on('prompt.submit', async ($, e, next) => {
    // 侧栏里改过的状态，跟着这条消息一起告诉 Claude
    const told = e.command === undefined && e.isMeta !== true ? await takeChanges($) : undefined
    const result = await next(told === undefined ? e : { ...e, context: [...(e.context ?? []), told] })
    const name = e.command?.name
    if (name === undefined) return result
    if (current !== undefined) {
      if (!current.slash.includes(name)) current.slash.push(name)
      return result
    }
    if (!pendingSlash.includes(name)) pendingSlash.push(name)
    $.clock.after(3000, () => void settleSlash($, name))
    return result
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const owner = current?.turnId ?? lastTurnId
      if (owner !== undefined && !agentOwner.has(e.agentId)) agentOwner.set(e.agentId, owner)
    } else if (e.text.trim() !== '') {
      const slash = pendingSlash
      pendingSlash = []
      current = {
        turnId: e.turnId,
        text: e.text,
        messageId: lastPromptId,
        rowIds: [],
        files: new Set(),
        commands: [],
        slash,
        skills: [],
        mcp: [],
        branches: [],
        agentTokens: 0,
        blockId: '',
        startedAt: await $.clock.now(),
        steps: [],
        texts: [],
        evidence: [],
      }
      const turn = current
      const number = (await read($, blocks)).reduce((n, b) => Math.max(n, b.turn), 0) + 1
      turn.blockId = `b${number}`
      await setBlocks($, list => [
        ...list,
        {
          ...emptyBlock(turn.blockId, 'turn', number, null),
          ask: clip(turn.text, 500),
          title: clip(turn.text.split('\n')[0] ?? '', 40),
          status: 'DOING',
          messageId: turn.messageId,
          live: { startedAt: turn.startedAt, steps: 0, last: '' },
        },
      ])
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // 先记下是哪一轮：工具跑完的时候，这一轮可能已经结束了
    const turn = e.agentId === undefined ? current : undefined
    const input = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    if (current !== undefined && e.agentId === undefined) {
      current.steps.push(describeStep(tool, input))
      queueLive($)
      if (typeof input.tool_use_id === 'string') current.rowIds.push(input.tool_use_id)
      if ((tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') && typeof input.file_path === 'string') {
        current.files.add(input.file_path.split('/').pop() ?? input.file_path)
      }
      if (tool === 'Bash' && typeof input.command === 'string') current.commands.push(input.command)
      if (tool === 'Skill' && typeof input.skill === 'string' && !current.skills.includes(input.skill)) current.skills.push(input.skill)
      if (tool.startsWith('mcp__')) {
        const [, server = '', ...rest] = tool.split('__')
        const name = `${server.replace(/^claude_ai_/, '')}/${rest.join('__')}`
        if (!current.mcp.includes(name)) current.mcp.push(name)
      }
    }
    const result = await next(e)
    if (turn !== undefined) addEvidence(turn, tool, input, result.isError === true || result.deny !== undefined, result.text)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    if (e.agentId !== undefined) {
      // 引擎自己的 fork（压缩、记忆）不在列表里，跳过
      const info = (await $.agent.list()).find(a => a.id === e.agentId)
      if (info === undefined) return result
      const tokens = usageTotal(e.usage)
      const owner = agentOwner.get(e.agentId)
      if (current !== undefined && owner === current.turnId) current.agentTokens += tokens
      await addBranch(
        $,
        {
          kind: info.type === 'fork' ? 'fork' : 'agent',
          title: clip(info.description || info.name || info.type, 40),
          ask: '',
          conclusion: clip((e.answer.trim().split('\n')[0] ?? '').trim(), 300),
          status: e.isAborted ? 'CANCELLED' : 'DONE',
          tokens,
        },
        owner,
      )
      return result
    }

    const turn = current
    if (turn === undefined || turn.turnId !== e.turnId) return result
    current = undefined
    lastTurnId = turn.turnId

    const all = await read($, blocks)
    const live = all.find(b => b.id === turn.blockId)
    const number = live?.turn ?? all.reduce((n, b) => Math.max(n, b.turn), 0) + 1
    const id = live?.id ?? `b${number}`
    turnBlock.set(turn.turnId, id)
    const tech: Tech = {
      durationMs: e.durationMs,
      model: e.usage?.model ?? '',
      input: e.usage?.input_tokens ?? 0,
      output: e.usage?.output_tokens ?? 0,
      cacheRead: e.usage?.cache_read_input_tokens ?? 0,
      cacheWrite: e.usage?.cache_creation_input_tokens ?? 0,
      slash: turn.slash,
      skills: turn.skills,
      mcp: turn.mcp,
      agents: turn.branches.filter(br => br.kind !== 'btw').length,
      agentTokens: turn.agentTokens,
      outlineTokens: 0,
    }
    const block: Block = {
      ...emptyBlock(id, 'turn', number, null),
      // 进行中时我手动改过的层级和状态留着
      ...(live === undefined ? {} : { parent: live.parent, isManual: live.isManual, isStatusManual: live.isStatusManual }),
      ask: clip(turn.text, 500),
      title: clip(turn.text.split('\n')[0] ?? '', 40),
      status: 'DOING',
      isPending: true,
      files: [...turn.files],
      commands: turn.commands.length,
      messageId: turn.messageId,
      rowIds: turn.rowIds,
      tech,
    }
    const branches = turn.branches.map((br, i) => branchBlock(br, `${id}.${i + 1}`, number, id))
    await setBlocks($, list =>
      live === undefined ? [...list, block, ...branches] : [...list.map(b => (b.id === id ? { ...block, status: b.isStatusManual ? b.status : block.status } : b)), ...branches],
    )
    // 总结放到这次分发之外，不拖慢回合结束
    $.clock.after(0, () => void summarize($, id, turn, e.answer, e.isAborted))
    return result
  })

  // 树视图里的按键和点击
  on('ui.message', { requestId: PANE }, async ($, e, next) => {
    const data = e.data as { type?: string; id?: string; key?: string; shift?: boolean; ctrl?: boolean; meta?: boolean }
    if (data.type === 'click' && typeof data.id === 'string') {
      void asciiInput($)
      await pick($, data.id)
    }
    else if (data.type === 'focus') void asciiInput($)
    else if (data.type === 'action' && typeof (data as { action?: unknown }).action === 'string') {
      const action = (data as { action: string }).action
      if (action === 'view-prev' || action === 'view-next') await stepView($, keys, action === 'view-prev' ? -1 : 1)
      else if (action === 'enter-view') await enterView($)
      else if (action === 'leave-view') await update($, scope, () => 'tabs')
      else await runAction($, action)
    }
    else if (data.type === 'key' && typeof data.key === 'string') await handleKey($, { type: 'key', key: data.key, shift: data.shift === true, ctrl: data.ctrl === true, meta: data.meta === true }, keys)
    else return next(e)
    return {}
  })

  // ---------- 正文折叠：改写对话里的行 ----------

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const label = (await read($, body)).labels[e.requestId]
    return label === undefined ? next(e) : next({ ...e, props: { ...e.props, text: label } })
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!(await hideRow($, e.requestId, undefined))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(await hideRow($, e.requestId, e.props.isExpanded))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!(await hideRow($, e.requestId, e.props.isExpanded))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })

  // ---------- 大纲面板 ----------

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // 面板拿到键盘（点了视图栏、工具栏，或 Tab 进来）也切英文：按钮的字母快捷键一样会被输入法拿去组字
    if (e.surface === 'terminal') {
      if (e.props.isFocused && !isPaneFocused) void asciiInput($)
      isPaneFocused = e.props.isFocused
    }
    const list = await read($, blocks)
    const v = await read($, view)
    const foldedIds = await read($, folded)
    const openIds = await read($, open)
    const at = await read($, cursor)
    const zoomId = await read($, zoom)
    const isBodyAll = await read($, bodyFoldAll)
    const latest = await read($, recap)
    const isLegend = await read($, legend)
    const now = await $.clock.now()
    const width = e.props.bodyColumns
    // 终端用图标字体；桌面（以及别的能画 SVG 的界面）用 SVG
    const desk = e.surface !== 'terminal' && 'Svg' in els ? (els as unknown as DesktopEls) : undefined
    // 视图栏的高亮只在终端的树里有意义（别的界面是按钮，焦点由界面自己管）
    const isTabs = e.surface === 'terminal' && (await read($, scope)) === 'tabs'

    const rows = visibleRows(list, v, foldedIds, zoomId, openIds)
    const zoomed = zoomId === null ? undefined : list.find(b => b.id === zoomId)
    const waiting = waitingCount(list)
    const total = v === 'tech' ? sumTech(list) : undefined
    const allMetrics = v === 'tech' ? await read($, metricsAll) : null

    const drawIcon = (icon: PhosphorIcon, color: string) =>
      desk === undefined ? <Text color={color}>{PH[icon]}</Text> : <desk.Svg source={phosphorIconSvg(icon, color)} alt={icon} width={ICON_PX} height={ICON_PX} />
    const drawStatus = (st: Status, isContext = false, changedAt?: number) =>
      desk === undefined ? (
        <Text color={STATUS_INFO[st].color} bold={isOpenStatus(st)} dimColor={isContext}>{statusText(st)}</Text>
      ) : (
        desktopStatus(desk, st, changedAt !== undefined && now - changedAt < FIRE_MS, isContext)
      )
    const drawLine = (line: Line, lead: string) => {
      if (line.bullet === true) {
        return (
          <Box flexDirection="row">
            <Text dimColor>{lead}• </Text>
            <Box flexShrink={1}>
              <Text color={line.color} dimColor={line.color === undefined}>{line.parts[0]?.text ?? ''}</Text>
            </Box>
          </Box>
        )
      }
      return (
        <Box flexDirection="row">
          {lead !== '' && <Text dimColor>{lead}</Text>}
          {desk === undefined ? (
            <Box flexShrink={1}>
              <Text color={line.color} dimColor={line.color === undefined}>{lineText(line)}</Text>
            </Box>
          ) : (
            desktopLine(desk, line)
          )}
        </Box>
      )
    }

    const header = (
      <Box flexDirection="column">
        <Box flexWrap="wrap" columnGap={1}>
          {keys.map((one, i) => (
            <Button
              key={`view-${one}`}
              plain
              hotkey={String(i + 1)}
              {...(v === one ? { autoFocus: true as const } : {})}
              onPress={() => (v === one && e.surface === 'terminal' ? $.ui.toast(ENTER_TIP) : switchView($, one))}
            >
              {v === one ? <Text bold color="claude" inverse={isTabs}>{VIEW_INFO[one].label}</Text> : <Text dimColor>{VIEW_INFO[one].label}</Text>}
              {one === 'me' && waiting > 0 ? <Text color="warning"> {String(waiting)}</Text> : ''}
            </Button>
          ))}
        </Box>
        <Box flexWrap="wrap" columnGap={1}>
          {ACTIONS.map(a => (
            <Button key={a.key} plain hotkey={a.hotkey} onPress={() => runAction($, a.key)}>
              {a.key === 'zoom' && zoomId !== null ? '退出聚焦' : a.key === 'body-all' && isBodyAll ? '正文全开' : a.label}
            </Button>
          ))}
        </Box>
        {latest !== null && (
          <Box flexDirection="column">
            <Box flexDirection="row" columnGap={1}>
              {drawIcon('recap', '#8f7fb6')}
              <Text bold color="remember">
                {latest.source === 'claude' ? 'Claude Code' : TITLE}
                {latest.at > 0 ? ` · ${new Date(latest.at).toTimeString().slice(0, 5)}` : ''}
                {latest.isPending === true ? ' · …' : ''}
              </Text>
            </Box>
            {latest.text !== '' && (
              <Box paddingLeft={2}>
                <Text>{latest.text}</Text>
              </Box>
            )}
          </Box>
        )}
        {isLegend && (
          <Box flexDirection="column">
            <Box flexWrap="wrap" columnGap={2}>
              {STATUSES.map(st => drawStatus(st))}
            </Box>
            <Box flexWrap="wrap" columnGap={2}>
              {LEGEND_FIELDS.map(f => drawLine({ parts: [{ field: f, text: FIELD[f].label }] }, ''))}
            </Box>
          </Box>
        )}
        {zoomed !== undefined && <Text dimColor>{[...ancestorsOf(list, zoomed), zoomed].map(b => b.title).join(' › ')}</Text>}
        {total !== undefined && (
          <Box flexDirection="column">
            <Box flexDirection="row" columnGap={1}>
              {drawIcon('total', '#8a8f98')}
              <Text bold>合计</Text>
            </Box>
            {techLines(total).map(line => drawLine(line, '  '))}
          </Box>
        )}
        {v === 'tech' && (
          <Box flexDirection="column">
            <Text bold>验收与返工 · 本次会话</Text>
            {metricsLines(measure(list)).map(line => drawLine(line, '  '))}
            {allMetrics !== null && <Text bold>验收与返工 · 所有会话</Text>}
            {allMetrics !== null && metricsLines(allMetrics).map(line => drawLine(line, '  '))}
          </Box>
        )}
        <Text dimColor>{'─'.repeat(Math.max(1, Math.min(width, 60)))}</Text>
      </Box>
    )

    const empty = list.length === 0 ? `${PH.empty} 聊一轮，这里就会长出第一块` : rows.length === 0 ? '∅' : undefined

    // 终端里用树视图接 Logseq 式按键（中文输入法下也能用）；别的界面退回成按钮
    const Client = e.surface === 'terminal' && 'Client' in els ? els.Client : undefined
    if (Client !== undefined) {
      const viewLabels = keys.map((one, i) => `${i + 1}: ${VIEW_INFO[one].label}${one === 'me' && waiting > 0 ? ` ${waiting}` : ''}`)
      const actionLabels = ACTIONS.map(a => `${a.hotkey}: ${a.label}`)
      const headerRows =
        estimateWrappedRows(viewLabels, width) +
        estimateWrappedRows(actionLabels, width) +
        (latest === null ? 0 : 1 + (latest.text === '' ? 0 : textRows(latest.text, width - 2))) +
        (isLegend ? legendRows(width) : 0) +
        (zoomed === undefined ? 0 : 1) +
        (total === undefined ? 0 : 1 + techLines(total).length) +
        (v === 'tech' ? 3 + (allMetrics === null ? 0 : 3) : 0) +
        1
      const height = Math.max(6, e.props.scroll.bodyRows - headerRows)
      return (
        <Box flexDirection="column" width={width}>
          {header}
          <Client
            key={TREE}
            module="./tree-view.tsx"
            props={{
              rows: toTreeRows(rows, v, openIds, at, now),
              height,
              scope: isTabs ? 'tabs' : 'tree',
              menu: menuFor(await read($, level), zoomId !== null, isBodyAll),
              itemMenu: itemMenu(),
              ...(empty === undefined ? {} : { empty }),
            }}
            width={width}
          />
        </Box>
      )
    }

    return (
      <Box flexDirection="column" width={width}>
        {header}
        {empty !== undefined && <Text dimColor>{empty}</Text>}
        {rows.map(row => {
          const b = row.block
          const isAt = row.key === at
          if (row.item !== undefined) {
            const st = row.item.status
            return (
              <Box key={`row-${row.key}`} flexDirection="row" columnGap={1}>
                {row.prefix !== '' && <Text dimColor>{row.prefix.trimEnd()}</Text>}
                <Button key={`block-${row.key}`} plain onPress={() => pick($, row.key)}>
                  <Text inverse={isAt}>{ITEM_MARK}</Text>
                </Button>
                {/* 状态和标题之间固定两格：列间距一格，再补一格 */}
                <Box marginRight={1}>{drawStatus(st)}</Box>
                <Box flexShrink={1}>
                  <Text dimColor={!isOpenStatus(st)} strikethrough={st === 'CANCELLED'} bold={isAt}>{row.item.text}</Text>
                </Box>
              </Box>
            )
          }
          const arrow = row.hasChildren ? (row.isFolded ? '▸' : '▾') : '•'
          const badge = KIND_BADGE[b.kind]
          const isOpenRow = isOpenStatus(b.status)
          const lines = row.isContext ? [] : blockLines(b, v, openIds.includes(b.id), now)
          return (
            <Box key={`row-${row.key}`} flexDirection="column" marginTop={row.isGap ? 1 : 0}>
              <Box flexDirection="row" columnGap={1}>
                {row.prefix !== '' && <Text dimColor>{row.prefix.trimEnd()}</Text>}
                <Button key={`block-${row.key}`} plain onPress={() => pick($, row.key)}>
                  <Text inverse={isAt}>{arrow}</Text>
                </Button>
                <Box marginRight={1}>{b.isPending ? <Text dimColor>…</Text> : drawStatus(b.status, row.isContext, b.statusAt)}</Box>
                {badge !== undefined && <Text color={badge.color}>[{badge.text}]</Text>}
                <Box flexShrink={1}>
                  <Text dimColor={row.isContext || (!isOpenRow && b.live === undefined)} strikethrough={b.status === 'CANCELLED'} bold={isAt || (isOpenRow && !row.isContext)} color={badge?.color}>
                    {b.title}
                  </Text>
                </Box>
              </Box>
              {lines.map(line => drawLine(line, `${row.cont}${line.level === 1 ? '   ' : ''}`))}
            </Box>
          )
        })}
      </Box>
    )
  })

  // ---------- Agenda 面板 ----------

  on('ui.render', { component: 'Pane', requestId: AGENDA }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const desk = e.surface !== 'terminal' && 'Svg' in els ? (els as unknown as DesktopEls) : undefined
    const groups = await read($, agenda)
    const drawStatus = (st: Status) =>
      desk === undefined ? <Text color={STATUS_INFO[st].color} bold>{statusText(st)}</Text> : desktopStatus(desk, st, false)
    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        <Box columnGap={1}>
          <Button key="agenda-refresh" plain hotkey="r" onPress={() => collectAgenda($)}>刷新</Button>
        </Box>
        {groups.length === 0 && <Text dimColor>{desk === undefined ? `${PH.celebrate} ` : ''}没有要你做的事</Text>}
        {groups.map(g => (
          <Box key={`group-${g.sid}`} flexDirection="column" marginTop={1}>
            <Text bold color={g.isCurrent ? 'claude' : undefined}>{g.label}</Text>
            {g.items.map(item => (
              <Box key={`item-${g.sid}-${item.blockId}`} flexDirection="column" paddingLeft={2}>
                <Box flexDirection="row" columnGap={1}>
                  <Button key={`ag-${g.sid}-${item.blockId}`} plain onPress={() => markAgendaDone($, g.sid, item.blockId)}>
                    {desk === undefined ? <Text color={STATUS_INFO[item.status].color} bold>{statusText(item.status)}</Text> : STATUS_INFO[item.status].label}
                  </Button>
                  {desk !== undefined && drawStatus(item.status)}
                  <Box flexShrink={1} marginLeft={1}>
                    <Text>{item.title}</Text>
                  </Box>
                </Box>
                {item.needsMe.map(one => (
                  <Box paddingLeft={4}>
                    <Text color="warning">- {one}</Text>
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}
