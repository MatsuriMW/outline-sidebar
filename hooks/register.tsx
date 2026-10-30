import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { AgendaGroup, Block, Evidence, Kind, Level, Metrics, Recap, Resolution, Status, StatusChange, Tech, View } from '../types'
import type { Field, Line, MenuItem, RulerProps, TreeProps } from './outline'
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
  applyResolutions,
  isForMe,
  isMark,
  nextBadStatus,
  nextStatus,
  parseKey,
  FIELD,
  ITEM_MARK,
  MAX_DEPTH,
  UNTITLED,
  STALE_MIN,
  STALE_TURNS,
  normalizeStatus,
  statusText,
  VIEW_INFO,
  ancestorsOf,
  blockLines,
  childrenOf,
  clampParent,
  clip,
  estimateWrappedRows,
  isOpenStatus,
  jumpTarget,
  latestKey,
  matches,
  moreRunId,
  parseKeys,
  relayout,
  rulerTicks,
  staleBlocks,
  sumTech,
  techLines,
  type AutoFold,
  addMetrics,
  measure,
  metricsLines,
  textRows,
  titleIn,
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
const STORE_KEEP = 100
const TREE = 'tree'
const RULER = 'ruler'

const blocks = atom({ plugin: 'outline-sidebar', key: 'blocks' } as const, [])
const folded = atom({ plugin: 'outline-sidebar', key: 'folded' } as const, [])
const unfolded = atom({ plugin: 'outline-sidebar', key: 'unfolded' } as const, [])
const shownRuns = atom({ plugin: 'outline-sidebar', key: 'shownRuns' } as const, [])
const doneFolded = atom({ plugin: 'outline-sidebar', key: 'doneFolded' } as const, false)
const lingering = atom({ plugin: 'outline-sidebar', key: 'lingering' } as const, {})
const wheel = atom({ plugin: 'outline-sidebar', key: 'wheel' } as const, 0)
const open = atom({ plugin: 'outline-sidebar', key: 'open' } as const, [])
const view = atom({ plugin: 'outline-sidebar', key: 'view' } as const, 'all')
const level = atom({ plugin: 'outline-sidebar', key: 'level' } as const, 'contents')
const cursor = atom({ plugin: 'outline-sidebar', key: 'cursor' } as const, null)
const anchor = atom({ plugin: 'outline-sidebar', key: 'anchor' } as const, null)
const query = atom({ plugin: 'outline-sidebar', key: 'query' } as const, '')
const searching = atom({ plugin: 'outline-sidebar', key: 'searching' } as const, false)
const replyTo = atom({ plugin: 'outline-sidebar', key: 'replyTo' } as const, null)
const staleSkipped = atom({ plugin: 'outline-sidebar', key: 'staleSkipped' } as const, [])
const zoom = atom({ plugin: 'outline-sidebar', key: 'zoom' } as const, null)
const corrections = atom({ plugin: 'outline-sidebar', key: 'corrections' } as const, 0)
const agenda = atom({ plugin: 'outline-sidebar', key: 'agenda' } as const, [])
const recap = atom({ plugin: 'outline-sidebar', key: 'recap' } as const, null)
const legend = atom({ plugin: 'outline-sidebar', key: 'legend' } as const, false)
const changes = atom({ plugin: 'outline-sidebar', key: 'changes' } as const, [])
const scope = atom({ plugin: 'outline-sidebar', key: 'scope' } as const, 'tabs')
const metricsAll = atom({ plugin: 'outline-sidebar', key: 'metricsAll' } as const, null)
const sessionTitle = atom({ plugin: 'outline-sidebar', key: 'sessionTitle' } as const, null)
const undoLayout = atom({ plugin: 'outline-sidebar', key: 'undoLayout' } as const, null)

const LEVELS: Level[] = ['overview', 'contents', 'all', 'undone']
const LEVEL_LABEL: Record<Level, string> = { overview: '只看顶层', contents: '全部标题', all: '全部展开', undone: '去掉 Done' }

/** 层级「去掉 Done」：Done 的块不显示 */
async function isHidingDone($: EngineInterface) {
  return (await read($, level)) === 'undone'
}

/** 工具栏：文字按钮（中文输入法下用不了字母快捷键时，点按钮或在树里按回车用菜单） */
const ACTIONS: { key: string; hotkey: string; label: string }[] = [
  { key: 'down', hotkey: 'j', label: '下' },
  { key: 'up', hotkey: 'k', label: '上' },
  { key: 'fold-up', hotkey: 't', label: '折叠到母块' },
  { key: 'unfold-down', hotkey: 'e', label: '展开子块' },
  { key: 'done', hotkey: 'd', label: 'Done' },
  { key: 'yes', hotkey: 'y', label: 'Yes' },
  { key: 'no', hotkey: 'n', label: 'No' },
  { key: 'reply', hotkey: 'a', label: '回复' },
  { key: 'indent', hotkey: 'l', label: '缩进' },
  { key: 'outdent', hotkey: 'h', label: '反缩进' },
  { key: 'status', hotkey: 's', label: '切状态' },
  { key: 'status-bad', hotkey: 'b', label: '负面状态' },
  { key: 'level', hotkey: 'o', label: '层级' },
  { key: 'zoom', hotkey: 'z', label: '聚焦' },
  { key: 'fold-done', hotkey: 'f', label: '收起已完成' },
  { key: 'relayout', hotkey: 'm', label: '重新排版' },
  { key: 'progress', hotkey: 'p', label: '刷新进度' },
  { key: 'recap', hotkey: 'r', label: '回顾' },
  { key: 'jump', hotkey: 'g', label: '跳到原文' },
  { key: 'export', hotkey: 'x', label: '导出' },
  { key: 'legend', hotkey: 'i', label: '图例' },
  // 树里按 / 也行（Button 的 hotkey 只认数字和字母，/ 由树自己接）
  { key: 'search', hotkey: 'q', label: '搜索' },
]

/** 搜索框的 key */
const SEARCH = 'search'

/** 回复框的 key */
const REPLY = 'reply-box'

/** 视图名，「需要我做的」后面带还剩几件 */
const viewLabel = (one: View, waiting: number) => `${VIEW_INFO[one].label}${one === 'me' && waiting > 0 ? ` ${waiting}` : ''}`

/** 聚焦时「聚焦」变「退出聚焦」，收起已完成时「收起已完成」变「恢复已完成」，刚重新排过版「重新排版」变「撤销排版」 */
const actionLabel = (a: (typeof ACTIONS)[number], isZoomed: boolean, isDoneFolded: boolean, canUndoLayout: boolean) =>
  a.key === 'zoom' && isZoomed ? '退出聚焦' : a.key === 'fold-done' && isDoneFolded ? '恢复已完成' : a.key === 'relayout' && canUndoLayout ? '撤销排版' : a.label

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

/** 桌面版工具栏上直接摆出来的几个，其余进「更多操作」下拉框 */
const DESK_ACTIONS = ['done', 'yes', 'no', 'reply', 'jump', 'search']

/** 桌面版每深一层缩进几格（不画终端那套 │ ├─ 引导线：比例字体下竖线对不齐） */
const DESK_INDENT = 2

/** 桌面版的标题和字段：中文字之间插零宽空格，一长串中文才折得了行（桌面版对整串中文不断行，超出面板的部分被截掉） */
const breakable = (text: string) => text.replace(/([\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uffef])(?=[\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uffef])/g, '$1\u200b')

/** 桌面版行的底色：光标所在行、鼠标悬停的行。半透明灰，深浅色主题下都看得出又不抢眼 */
const DESK_CURSOR_BG = 'rgba(127, 127, 127, 0.16)'
const DESK_HOVER_BG = 'rgba(127, 127, 127, 0.08)'

type DesktopEls = Elements['desktop']

/** 桌面版一行：每段「图标 字」 */
function desktopLine(els: DesktopEls, line: Line, isDesktop: boolean) {
  const { Box, Text, Svg } = els
  const props = { line, isDesktop }
  const color = line.color === undefined ? '#8a8f98' : line.color === 'claude' ? '#c8635f' : line.color === 'warning' ? '#b39a3e' : line.color
  return (
    <Box flexDirection="row" columnGap={1} flexWrap="wrap">
      {props.line.parts.map(part => {
        const svg = phosphorSvg(part.field, color)
        // 图标顶对齐第一行字：字折成几行时图标不落到中间
        return (
          <Box flexDirection="row" columnGap={1} alignItems="flex-start" flexShrink={1} minWidth={0}>
            {svg === undefined ? <Text>{glyph(part.field)}</Text> : <Box flexShrink={0} paddingTop="xs"><Svg source={svg} alt={FIELD[part.field].label} width={ICON_PX} height={ICON_PX} /></Box>}
            {part.text !== '' && <Box flexShrink={1} minWidth={0}><Text color={props.line.color} dimColor={props.line.color === undefined}>{props.isDesktop ? breakable(part.text) : part.text}</Text></Box>}
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
      <Text color={info.color} size="footnote" weight={isOpenStatus(props.status) ? 'semibold' : 'regular'} dimColor={props.isContext === true}>{info.label}</Text>
    </Box>
  )
}

/** 桌面版大纲行里只画状态图标：只占一个图标宽，标题紧跟在后面，状态名挪到标题下面那行打头 */
function desktopStatusIcon(els: DesktopEls, status: Status, isFire: boolean) {
  const { Box, Svg } = els
  const isAnimated = status === 'DOING' || isFire
  return (
    <Box flexShrink={0} paddingTop="xs">
      <Svg source={statusSvg(status, isFire)} alt={STATUS_INFO[status].label} width={ICON_PX} height={ICON_PX} {...(isAnimated ? { isInteractive: true } : {})} />
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
  /** 最后一条带文字的回答的 id */
  answerId?: string
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
  const all = await $.store.keys()
  const keys = all.filter(k => k.startsWith(STORE_PREFIX))
  if (keys.length <= STORE_KEEP) return
  // 超了才删，按最后保存的时间删最久没动过的：键的顺序是第一次写入的顺序，一直在用的老会话也排在前面
  const dated = await Promise.all(
    keys.map(async key => {
      const stored = await $.store.get(key)
      return { key, at: (stored as Saved | undefined)?.savedAt ?? 0 }
    }),
  )
  dated.sort((a, b) => a.at - b.at)
  for (const old of dated.slice(0, dated.length - STORE_KEEP)) await $.store.delete(old.key)
}

async function setBlocks($: EngineInterface, change: (list: Block[]) => Block[]) {
  await update($, blocks, list => change(list ?? []))
  await persist($)
}

async function restore($: EngineInterface) {
  const sid = await $.session.id()
  const stored = await $.store.get(`${STORE_PREFIX}${sid}`)
  const list = (stored as Saved | undefined)?.blocks
  if ((await read($, blocks)).length === 0 && Array.isArray(list) && list.length > 0) {
    // 旧版本存下的块没有 kind，状态也是旧写法
    await update($, blocks, () => list.map(b => ({ ...b, kind: b.kind ?? 'turn', status: normalizeStatus(String(b.status)) })))
  }
  // 当前会话里已有的旧状态（CANCELED、DOING 以外的旧词）也换成新写法
  const existing = await read($, blocks)
  if (existing.some(b => !(STATUSES as string[]).includes(b.status))) {
    await update($, blocks, all => (all ?? []).map(b => ({ ...b, status: normalizeStatus(String(b.status)) })))
  }
}

// ---------- 总结 ----------

/** 交给模型的状态说明：关键词 + 什么时候用 */
const STATUS_LINES = STATUSES.filter(st => STATUS_INFO[st].isVerdict !== true).map(st => `\n  ${st}：${STATUS_INFO[st].meaning}`).join('')

const SYSTEM = `你在给一段 Claude Code 会话做大纲。每次给你「现有大纲」和「刚结束的一轮」，你把这一轮变成大纲里的一个块。
只输出一个 JSON 对象，不要任何别的文字，不要代码块标记。字段：
- title：用户要 Claude Code 做什么，一句话，中文，不超过 30 字，动词开头
- status：从下面选一个最贴切的关键词（照用户在 Obsidian todoseq 里的那一套）：${STATUS_LINES}
- did：Claude Code 这一轮实际做了的事，数组，每条是 { "text": 一短句, "evidence": [证据编号] }；evidence 只能填下面「证据」里列出的编号，哪条证据能证明这件事做了就填哪条，没有能证明它的证据就填空数组，不许编；没做事就空数组
- userQuestion：用户这一轮如果是在提问（想知道是什么、为什么、怎么办、行不行），把他的问题写成一个问句，中文，不超过 40 字，以「？」结尾；用户是在让 Claude Code 做事、不是在提问，填空字符串
- conclusion：这一轮定下来的结论，一句话；用户在提问的，写这个问题的结论；没有就空字符串
- questions：还没解决的问题，没有就空数组
- needsMe：需要用户做的事（确认、选择、手动操作），没有就空数组
- asks：needsMe 里哪几条是在问用户、要用户回答是或否或做选择才能往下走的（比如「要我接着加吗」「仓库保持公开吗」），填它们的下标数组（从 0 开始）；交给用户自己去做的事（比如「重开终端看效果」）不算，没有就空数组
- parent：这一轮属于现有大纲里哪个话题或功能，就填那个话题的块 id——通常是这个话题开头的那一块，不是上一块。同一话题接着往下做的几轮是并列的，都挂在同一个话题块下面，不要一轮挂在上一轮下面一路往下套；只有这一轮专门处理某一块里冒出来的一个具体子问题时，才挂在那一块下面。大纲最多 ${MAX_DEPTH + 1} 层。换了新话题或新功能，填 null
- resolved：上面「待用户处理」里被这一轮了结的，数组，每一项是 { "key": 列表里方括号中的编号（比如 b4#0 或 b5）, "by": "user" 或 "claude" }。用户在这一轮的原话里说已经做完、给了答复或做了决定，by 填 user；Claude Code 说它替用户做了、或者判断不需要用户做了，by 填 claude。按条判断，没了结的别填，拿不准就不填；没有就空数组
用户在一轮进行中的插话只是引导和补充，不单独当成任务；以这一轮从提问到做完的整体为准。`

const describeOutline = (list: readonly Block[]) => {
  const turns = list.filter(b => b.kind === 'turn')
  const lines = turns.slice(-40).map(b => `${'  '.repeat(ancestorsOf(list, b).length)}- [${b.id}] ${b.status} ${b.title}`)
  // 按条列：每一条还没了结的「需要我做」单独一行；没有条目、只是在等我的块（待验收的除外）列块本身
  const pending = turns.flatMap(b => {
    const open = b.needsMe.flatMap((text, i) => (isOpenStatus(itemStatus(b, i)) ? [`- [${b.id}#${i}] ${text}（块 [${b.id}] ${b.title}）`] : []))
    if (b.needsMe.length > 0) return open
    return isForMe(b.status) && b.status !== 'TOREVIEW' ? [`- [${b.id}] ${b.title}（等用户确认）`] : []
  })
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

/** 模型给的 resolved：{ key, by } 的数组；只给了编号字符串（旧写法）的，当成 Claude 说的，宁可让我再看一眼 */
const parseResolutions = (value: unknown): Resolution[] =>
  (Array.isArray(value) ? value : []).flatMap(one => {
    if (typeof one === 'string' && one !== '') return [{ key: one, by: 'claude' as const }]
    const item = one as { key?: unknown; by?: unknown }
    return typeof item?.key === 'string' && item.key !== '' ? [{ key: item.key, by: item.by === 'user' ? ('user' as const) : ('claude' as const) }] : []
  })

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

/** 一轮因 API 出错结束时，回答里出现这些字就当是撞上了用量上限（引擎在这里不给错误种类，只能看字） */
const LIMIT_WORDS = /rate.?limit|usage limit|quota|429|额度|上限|限额/i

/**
 * Errored、Hit Limit! 是 Agent 那边的事，不用我告诉它：这一轮因 API 出错结束，mod 直接标，不等模型判断
 */
const errorStatus = (answer: string): Status => (LIMIT_WORDS.test(answer) ? 'HITLIMIT' : 'ERRORED')

async function summarize($: EngineInterface, id: string, turn: Turn, answer: string, isAborted: boolean, isErrored = false) {
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
    const resolved = parseResolutions(data?.resolved)
    const self = all.find(b => b.id === id)
    return all.map(b => {
      if (b.id === id) {
        return {
          ...b,
          isPending: false,
          // 模型没给标题、我又只贴了内容没打字时，拿回答的第一行顶上
          title: typeof data?.title === 'string' && data.title !== '' ? data.title : b.title !== '' ? b.title : clip(answer.trim().split('\n')[0] ?? '', 30),
          // 验收用的状态（Rework、Unclear?）只归我用，模型给了也不认
          status: isErrored
            ? errorStatus(answer)
            : (STATUSES as string[]).includes(status) && STATUS_INFO[status as Status].isVerdict !== true ? (status as Status) : isAborted ? 'PAUSED' : 'DONE',
          statusAt: now,
          needsMeStatus: undefined,
          did: didParsed.did,
          evidence: turn.evidence,
          didEvidence: didParsed.proofs,
          // 模型没给就留空，按原话猜（见 questionOf）
          myQuestion: typeof data?.userQuestion === 'string' ? data.userQuestion : undefined,
          conclusion: typeof data?.conclusion === 'string' ? data.conclusion : '',
          questions: strings(data?.questions),
          needsMe: strings(data?.needsMe),
          // 模型没给 asks 就留空，按字面猜
          needsMeAsks: Array.isArray(data?.asks) ? data.asks.filter((n): n is number => Number.isInteger(n) && n >= 0) : undefined,
          // 模型挂得太深就往上提，免得同一话题一轮套一轮
          parent: b.isManual ? b.parent : clampParent(all, parent),
          tech: b.tech === undefined ? undefined : { ...b.tech, outlineTokens: b.tech.outlineTokens + spent },
        }
      }
      // 被这一轮了结的等我的事：按条改，我说的 Done，Claude 说替我办了的 ToReview
      return applyResolutions(b, resolved, self?.turn, now)
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
  return visibleRows(await read($, blocks), await read($, view), await read($, folded), await read($, zoom), await read($, open), await isHidingDone($), await autoFold($), await read($, query))
}

// ---------- 多选 ----------

/** 多选的行：从起点拉到光标（看得见的行里），只当上下文露出来的祖先不算；没在多选、或者只选了一行，就是空的 */
async function selectedKeys($: EngineInterface) {
  const from = await read($, anchor)
  if (from === null) return []
  const rows = await currentRows($)
  const to = await read($, cursor)
  const a = rows.findIndex(r => r.key === from)
  const b = rows.findIndex(r => r.key === to)
  if (a < 0 || b < 0 || a === b) return []
  return rows.slice(Math.min(a, b), Math.max(a, b) + 1).filter(r => !r.isContext).map(r => r.key)
}

/** ⇧↑ / ⇧↓：从光标所在行起，往上或往下多选一行 */
async function extendSelection($: EngineInterface, step: number) {
  if ((await read($, anchor)) === null) {
    const at = await read($, cursor)
    await update($, anchor, () => at)
  }
  await moveCursor($, step)
}

async function clearSelection($: EngineInterface) {
  if ((await read($, anchor)) !== null) await update($, anchor, () => null)
}

// ---------- 自动折叠 ----------

/** 光标离开一棵已了结的子树后，等这么久再自动折，给个缓冲 */
const FOLD_DELAY = 3000

/** 自动折叠用的：我手动打开过的块，和先别折的块（光标所在的块和它的祖先，加上光标刚离开、还在缓冲期的） */
async function autoFold($: EngineInterface): Promise<AutoFold> {
  const all = await read($, blocks)
  const key = await read($, cursor)
  const now = await $.clock.now()
  const hold = Object.entries(await read($, lingering)).filter(([, until]) => until > now).map(([id]) => id)
  const at = key === null ? undefined : all.find(b => b.id === parseKey(key).blockId)
  if (at !== undefined) hold.push(at.id, ...ancestorsOf(all, at).map(b => b.id))
  return { unfolded: await read($, unfolded), hold, shownRuns: await read($, shownRuns), isDoneFolded: await read($, doneFolded) }
}

/** 挪光标：刚离开的那一块和它的祖先先缓冲一会儿，到点再重画，该折的才折起来 */
async function setCursor($: EngineInterface, key: string | null) {
  const before = await read($, cursor)
  await update($, cursor, () => key)
  if (before === null || before === key) return
  const all = await read($, blocks)
  const left = all.find(b => b.id === parseKey(before).blockId)
  if (left === undefined) return
  const now = await $.clock.now()
  const until = now + FOLD_DELAY
  await update($, lingering, map => ({ ...map, ...Object.fromEntries([left, ...ancestorsOf(all, left)].map(b => [b.id, until])) }))
  $.clock.after(FOLD_DELAY, () => void expireLingering($))
}

async function expireLingering($: EngineInterface) {
  const now = await $.clock.now()
  await update($, lingering, map => Object.fromEntries(Object.entries(map ?? {}).filter(([, until]) => until > now)))
  await keepCursorVisible($)
}

/** 折起或打开一块。打开的记进 unfolded：整棵都了结的块被我打开过，就不再自动折 */
async function setFold($: EngineInterface, id: string, isFold: boolean) {
  await update($, folded, ids => (isFold ? ((ids ?? []).includes(id) ? (ids ?? []) : [...(ids ?? []), id]) : (ids ?? []).filter(one => one !== id)))
  await update($, unfolded, ids => (isFold ? (ids ?? []).filter(one => one !== id) : (ids ?? []).includes(id) ? (ids ?? []) : [...(ids ?? []), id]))
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
  const target = at < 0 ? (step > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, at + step))
  await setCursor($, rows[target]!.key)
}

/** 换了视图，光标要是不在这个视图的行里：还没动过光标就放到最新一行（默认位置），动过就放到第一行 */
async function keepCursorInView($: EngineInterface) {
  const rows = await currentRows($)
  const key = await read($, cursor)
  if (rows.some(r => r.key === key)) return
  const fallback = key === null ? latestKey(rows) : (rows.find(r => !r.isContext) ?? rows[0])?.key
  await setCursor($, fallback ?? null)
}

/**
 * 切视图：切走前光标停在最新一行（默认状态，正在做的事），切过去也落在那个视图的最新一行，树把它放到窗口中间；
 * 自己挪过光标的，保留切走时的样子
 */
async function switchView($: EngineInterface, v: View) {
  const at = await read($, cursor)
  const isAtLatest = at === null || at === latestKey(await currentRows($))
  await update($, view, () => v)
  await clearSelection($)
  if (isAtLatest) await setCursor($, latestKey(await currentRows($)) ?? null)
  else await keepCursorInView($)
  if (v === 'tech') await measureAll($)
}

/** 所有会话的验收指标：当前会话加上各个会话存下的大纲 */
async function measureAll($: EngineInterface) {
  const sid = await $.session.id()
  let total: Metrics = measure(await read($, blocks))
  for (const key of await $.store.keys()) {
    if (!key.startsWith(STORE_PREFIX) || key === `${STORE_PREFIX}${sid}`) continue
    const stored = await $.store.get(key)
    const saved = stored as Saved | undefined
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

/** 这次加载里有没有试过编译 bin/input-source */
let isBuildTried = false

/** 面板上一次画的时候有没有键盘，用来只在刚拿到键盘那一下切输入法 */
let isPaneFocused = false

/** 终端里大纲树（Client）要的数据：画面板的钩子算好放这里，外层的终端钩子拿去画树 */
let paneTree: TreeProps | undefined

/** 终端里刻度尺（Client）要的数据，和 paneTree 一样由画面板的钩子算好；没有一轮对话时不画 */
let paneRuler: RulerProps | undefined

/**
 * 点进大纲树时切到英文键盘：中文输入法开着，J/K、T 这些字母会被拿去组字。
 * 用 tools/ascii-input.swift（第一次用时编译到 bin/），只在 macOS 上，失败了也不打扰。
 * 命令都写成固定文本、在插件目录里跑，官方目录才认得出这个 mod 只跑这几个程序
 */
async function asciiInput($: EngineInterface) {
  if ((await switchToAscii($)) || isBuildTried) return
  // 编译最多试一次：编不出来、或者编出来也跑不了，就别每点一下都再编
  isBuildTried = true
  try {
    await $.process.run(['/bin/mkdir', '-p', 'bin'], { cwd: $.plugin.root })
    // 编成 input-source：旧版编的 bin/switch-input 从环境变量读输入法 ID，换个名字让装过旧版的机器重编一次
    const built = await $.process.run(['/usr/bin/swiftc', '-O', 'tools/ascii-input.swift', '-o', 'bin/input-source'], { cwd: $.plugin.root, timeoutMs: 120000 })
    if (built.exitCode === 0) await switchToAscii($)
  } catch {
    // 不是 macOS，或者没装 Xcode 命令行工具：就不切了
  }
}

/** 切到英文键盘，记下原来的输入法；还没编译过（或者切不了）就返回 false */
async function switchToAscii($: EngineInterface) {
  try {
    const r = await $.process.run(['./bin/input-source'], { cwd: $.plugin.root, stdin: 'com.apple.keylayout.US', timeoutMs: 3000 })
    const before = r.stdout.trim()
    // 原来就是英文就不用切回去；连着点几下，记的还是最早那个
    if (r.exitCode === 0 && before !== '' && before !== 'com.apple.keylayout.US' && restoreInput === undefined) restoreInput = before
    return r.exitCode === 0
  } catch {
    return false
  }
}

async function pick($: EngineInterface, key: string) {
  await update($, scope, () => 'tree')
  await clearSelection($)
  // 点「…」那一行：一下就展开
  if (moreRunId(key) !== undefined) {
    await setCursor($, key)
    await expandRun($)
    return
  }
  const { blockId, index } = parseKey(key)
  // 点块：第二下展开详情。点只挪光标，不改状态，改状态用 S
  if ((await read($, cursor)) === key) {
    if (index === undefined) {
      await update($, open, ids => toggle(ids, blockId))
      if ((await read($, open)).includes(blockId)) await markReviewed($, blockId)
    }
  } else await setCursor($, key)
}

/**
 * 刻度尺上点了一轮：光标挪到那一块。当前视图里看不到它（搜索、聚焦、折着的祖先、「去掉 Done」藏起来了），
 * 就把这些清掉；还看不到（视图本身不收它），换到「全部」。在「…」里的不用管，光标落上去那一串就断开了
 */
async function goToBlock($: EngineInterface, id: string) {
  const all = await read($, blocks)
  const b = all.find(one => one.id === id)
  if (b === undefined) return
  await update($, scope, () => 'tree')
  await clearSelection($)
  await setCursor($, id)
  const isShown = async () => (await currentRows($)).some(r => r.key === id)
  if (await isShown()) return
  const above = ancestorsOf(all, b).map(a => a.id)
  await update($, query, () => '')
  await update($, searching, () => false)
  const z = await read($, zoom)
  if (z !== null && z !== id && !above.includes(z)) await update($, zoom, () => null)
  await update($, folded, ids => (ids ?? []).filter(one => !above.includes(one)))
  if (await isHidingDone($)) await update($, level, () => 'contents')
  if (!(await isShown())) await update($, view, () => 'all')
}

/**
 * 光标在「…」那一行上：把这一串展开，光标落到这一串的第一块。这一串的块都记下来，这次会话里不再折进「…」：
 * 只记第一块不行，光标落上去它就不算了结的一串，剩下几块会马上又折起来。不在「…」上就什么都不做，返回 false
 */
async function expandRun($: EngineInterface) {
  const key = await read($, cursor)
  const runId = moreRunId(key)
  if (runId === undefined) return false
  const run = (await currentRows($)).find(r => r.key === key)?.more ?? [runId]
  await update($, shownRuns, ids => [...ids, ...run])
  await setCursor($, runId)
  return true
}

/**
 * F：一键收起已完成，整棵了结的顶层块全折进「…」（展开过的也重新折上）；再按一次恢复。
 * 光标所在的块被折进去了，光标挪到那一行「…」上；恢复时「…」没了，光标回到这一串的第一块
 */
async function toggleDoneFold($: EngineInterface) {
  const isOn = !(await read($, doneFolded))
  await update($, doneFolded, () => isOn)
  if (isOn) await update($, shownRuns, () => [])
  const key = await read($, cursor)
  const rows = await currentRows($)
  if (key === null || rows.some(r => r.key === key)) return
  const all = await read($, blocks)
  const id = moreRunId(key) ?? parseKey(key).blockId
  const b = all.find(one => one.id === id)
  // ancestorsOf 从最顶上排起，第一个就是它所在的顶层块
  const top = b === undefined ? undefined : (ancestorsOf(all, b)[0] ?? b)
  const into = top === undefined ? undefined : rows.find(r => r.more?.includes(top.id))
  if (into !== undefined) await setCursor($, into.key)
  else if (rows.some(r => r.key === id)) await setCursor($, id)
  else await keepCursorInView($)
}

async function toggleFold($: EngineInterface, force?: boolean) {
  // ← 是折，「…」本来就折着；→ 和菜单里的「折叠子块」把它展开
  if (force !== true && (await expandRun($))) return
  const id = await cursorBlockId($)
  if (id === null) return
  // 看眼下是不是折着（手动折的、自动折的都算），不是只看折叠列表
  const isFolded = (await currentRows($)).find(r => r.key === id)?.isFolded ?? false
  const want = force ?? !isFolded
  if (want !== isFolded) await setFold($, id, want)
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
  await setFold($, target, true)
  await setCursor($, target)
}

/** E：和 T 反过来，展开光标所在的块，光标跳到它的第一个子块上；再按就再往下一层 */
async function unfoldDown($: EngineInterface) {
  const id = await cursorBlockId($)
  if (id === null) return
  await setFold($, id, false)
  const rows = await currentRows($)
  const at = rows.findIndex(r => r.key === id)
  const below = rows[at + 1]
  if (at >= 0 && below !== undefined && parseKey(below.key).blockId !== id && below.block.parent === id) await setCursor($, below.key)
}

/** ⌥1 / ⌥2 / ⌥3：整棵大纲展开到第几层，更深的折起来 */
async function showDepth($: EngineInterface, depth: number) {
  const all = await read($, blocks)
  const atDepth = all.filter(b => ancestorsOf(all, b).length === depth - 1 && (childrenOf(all, b.id).length > 0 || b.needsMe.length > 0))
  await update($, folded, () => atDepth.map(b => b.id))
  // 指定了层数就照办：这一层以上都打开，自动折叠不再插手
  await update($, unfolded, () => all.filter(b => ancestorsOf(all, b).length < depth - 1).map(b => b.id))
  await keepCursorVisible($)
}

async function toggleDetail($: EngineInterface) {
  if (await expandRun($)) return
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
  // 不说一声，看着就像按错了键：这一下只展开、不改状态
  void $.ui.toast('待验收：先看一眼展开的证据，再按一次就验收通过')
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

/** 改光标所在那一行的状态：块，或者「需要我做」的某一条；多选时选中的每一行各按自己的状态改 */
async function changeStatus($: EngineInterface, choose: (current: Status) => Status) {
  const picked = await selectedKeys($)
  const key = await read($, cursor)
  for (const one of picked.length > 0 ? picked : key === null ? [] : [key]) await changeRow($, one, choose)
}

async function changeRow($: EngineInterface, key: string, choose: (current: Status) => Status) {
  const { blockId, index } = parseKey(key)
  const now = await $.clock.now()
  const target = (await read($, blocks)).find(b => b.id === blockId)
  if (index === undefined && target !== undefined && !(await passesReview($, target, choose(target.status)))) return
  let change: StatusChange | undefined
  let verdict: Status | undefined
  await setBlocks($, all =>
    all.map(b => {
      if (b.id !== blockId) return b
      if (index === undefined) {
        const to = choose(b.status)
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
        if (b.status === 'TOREVIEW' || verdicts.has(key) || isAnswer(to)) verdict = to
        return { ...b, ...marks, status: to, isStatusManual: true, statusAt: now, autoResolved: undefined }
      }
      const marks = b.needsMe.map((_, i) => b.needsMeStatus?.[i] ?? null)
      const from = itemStatus(b, index)
      marks[index] = choose(from)
      change = { key, what: `需要用户做的「${b.needsMe[index] ?? ''}」（块 [${b.id}]「${b.title}」）`, from, to: marks[index]! }
      if (verdicts.has(key) || (isAnswer(marks[index]!) && isQuestion(b, index))) verdict = marks[index]!
      // 我手动改过的，「自动」记号清掉
      const auto = b.needsMe.map((_, i) => (i === index ? null : (b.needsMeAuto?.[i] ?? null)))
      const updated = { ...b, needsMeStatus: marks, needsMeAuto: auto }
      // 最后一条也了结了，在等我的块跟着 Done；待验收的块还得我验收，不跟着变
      const isAllSettled = b.needsMe.every((_, i) => !isOpenStatus(itemStatus(updated, i)))
      return isAllSettled && isForMe(b.status) && b.status !== 'TOREVIEW' ? { ...updated, status: 'DONE' as const, statusAt: now } : updated
    }),
  )
  if (change !== undefined) await noteChange($, change)
  if (verdict !== undefined) noteVerdict($, key, verdict)
}

// ---------- 验收没通过、回答了是或否：交给 Claude 回应 ----------

/** Yes / No 是我对它问题的回答 */
const isAnswer = (st: Status) => st === 'YES' || st === 'NO'

/** 旧的条目没有模型标过是不是问题，按字面猜：问号结尾，或者带「是否」「要不要」「要我」 */
const LOOKS_ASKED = /[？?]\s*$|是否|要不要|要我/

/** 「需要我做」第 index 条是不是问我的问题：是的话答 Yes / No 要马上告诉 Claude，交给我做的事就等下一条消息 */
const isQuestion = (b: Block, index: number) => (b.needsMeAsks === undefined ? LOOKS_ASKED.test(b.needsMe[index] ?? '') : b.needsMeAsks.includes(index))

/** 我给了这个状态，Claude 该怎么接 */
const VERDICT: Partial<Record<Status, string>> = {
  YES: '我的回答是「是」，同意。照这个接着做。',
  NO: '我的回答是「否」，不同意。别照原来的打算做；不清楚我想要什么就先问我。',
  REWORK: '方向对，细节要改。先复述你理解的要改哪几处，我确认了再动手，改完让我再验收。',
  UNCLEAR: '我没看懂你做了什么、为什么这么做。先别改代码，拿这一轮的改动和命令结果解释清楚：做了什么、为什么这样做、怎么验证的。',
  FAILED: '没做成。先对照这一轮的改动和命令结果找原因：原因清楚就直接返工，改完让我再验收；拿不准哪里不对，先追问我，别瞎改。',
  SUSPENDED: '先搁置。别再动它，用两三句话记下现在做到哪、还差什么，方便以后接上。',
  CANCELLED: '不做了。停下；这件事要是已经改了文件，列出改动，问我要不要撤回，我没同意之前别动。',
  DOING: '还没做完。说清还差什么，接着做完，做完让我再验收。',
}

/** 一次打回好几件时附上：能并行的交给子代理，碰同一批文件的按顺序来 */
const PARALLEL =
  '这几件里互不相干、不改同一批文件的，开子代理（Agent 工具）并行处理，一个子代理只管一件，做完把结果汇总给我；会改同一批文件的按顺序做，免得互相覆盖。Rework 要先复述等我确认、Unclear? 只做解释，这两种不用开子代理。'

/** 等我停手再发：B 要连按几下才换到想要的状态 */
const VERDICT_DELAY = 4000

/** 被我改了状态、还没交给 Claude 的行：块的 id，或者「需要我做」那一条的「块 id#第几条」 */
const verdicts = new Set<string>()
let verdictRound = 0

function noteVerdict($: EngineInterface, id: string, to: Status) {
  verdicts.add(id)
  const round = ++verdictRound
  $.clock.after(VERDICT_DELAY, () => {
    if (round === verdictRound) void sendVerdicts($)
  })
}

/** 停手以后看最终状态：没通过的、回答了是或否的，发一条消息给 Claude，按状态说清怎么接；改回 Done 的就算了 */
async function sendVerdicts($: EngineInterface) {
  const keys = [...verdicts]
  verdicts.clear()
  const all = await read($, blocks)
  const found = keys.flatMap(key => {
    const { blockId, index } = parseKey(key)
    const b = all.find(one => one.id === blockId)
    if (b === undefined) return []
    const st = index === undefined ? b.status : itemStatus(b, index)
    const how = VERDICT[st]
    const what = index === undefined ? `块 [${b.id}]「${b.title}」` : `「${b.needsMe[index] ?? ''}」（块 [${b.id}]「${b.title}」）`
    return how === undefined ? [] : [{ st, line: `- ${what}：${STATUS_INFO[st].label}。${how}` }]
  })
  if (found.length === 0) return
  const lines = found.map(one => one.line)
  const answers = found.filter(one => isAnswer(one.st)).length
  const head = answers === found.length ? '我在大纲侧栏里回答了你问的这些事，请照着接着做：' : answers === 0 ? '我在大纲侧栏验收时，没让下面这些事通过。请逐条回应：' : '我在大纲侧栏里对下面这些事做了回复，请逐条接着处理：'
  // 简单的回答别展开：答完不需要再做事的，回一句就够了
  const brief = answers > 0 ? ['', '这些回答要是不需要你再做什么，回一句「收到」就行，别展开。'] : []
  // mod 自己发的消息不经过自己的 prompt.submit 钩子：侧栏里改过的状态直接接在正文后面
  const told = await takeChanges($)
  const parallel = lines.length > 1 ? ['', PARALLEL] : []
  await $.prompt.submit({ text: [head, ...lines, ...brief, ...parallel, ...(told === undefined ? [] : ['', told])].join('\n') })
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
    '用户在会话大纲侧栏里手动改了下面这些状态。这是用户在告诉你进展：「需要用户做」的事改成 DONE，表示用户已经做完了；块的状态改动表示用户对那件事的判断：DONE 是认可做完；YES、NO 是用户对你的问题答了「是」或「否」；SKIP 是用户跳过了这件事，不用做也不用再提；REWORK 是方向对、细节要改；UNCLEAR 是用户没看懂，先解释别改；FAILED 是用户认为没做成，要返工，先弄清哪里不对；SUSPENDED 是先搁置、暂时别碰；CANCELLED 是不做了。据此接着做，不用复述这段说明。',
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
  await update($, legend, isOn => !isOn)
}

/** 回车弹出的菜单：只用方向键和回车就能做完所有操作 */
const statusMenu = (): MenuItem[] => STATUSES.map(st => ({ id: `status:${st}`, label: statusText(st), color: STATUS_INFO[st].color }))

const menuFor = (lvl: Level, isZoomed: boolean, isDoneFolded: boolean, canUndoLayout: boolean): MenuItem[] => [
  { id: 'detail', label: '详情' },
  ...statusMenu(),
  { id: 'reply', label: '回复' },
  { id: 'fold', label: '折叠子块' },
  { id: 'zoom', label: isZoomed ? '退出聚焦' : '聚焦这一块' },
  { id: 'fold-done', label: isDoneFolded ? '恢复已完成' : '收起已完成' },
  { id: 'relayout', label: canUndoLayout ? '撤销重新排版' : '按话题重新排版' },
  { id: 'jump', label: '跳到原文' },
  { id: 'next-sibling', label: '下一个同级，跳到原文（]）' },
  { id: 'prev-sibling', label: '上一个同级，跳到原文（[）' },
  { id: 'progress', label: '刷新进度' },
  { id: 'recap', label: '回顾' },
  { id: 'level', label: `全局层级：${LEVEL_LABEL[LEVELS[(LEVELS.indexOf(lvl) + 1) % LEVELS.length]!]}` },
  { id: 'export', label: '导出' },
  { id: 'legend', label: '图例' },
]

/** 光标在「需要我做」的某一条上时，菜单只有改状态 */
const itemMenu = (): MenuItem[] => [...statusMenu(), { id: 'reply', label: '回复' }]

/** 层级按钮（O）：只看顶层 → 全部标题 → 全部展开（连详情）→ 去掉 Done（不折、不展开详情，Done 的块藏起来） */
async function cycleLevel($: EngineInterface) {
  const all = await read($, blocks)
  const nextLevel = LEVELS[(LEVELS.indexOf(await read($, level)) + 1) % LEVELS.length]!
  await update($, level, () => nextLevel)
  await update($, folded, () => (nextLevel === 'overview' ? all.filter(b => childrenOf(all, b.id).length > 0).map(b => b.id) : []))
  await update($, open, () => (nextLevel === 'all' ? all.map(b => b.id) : []))
  // 「全部展开」照办，别的档位交还给自动折叠
  await update($, unfolded, () => (nextLevel === 'all' ? all.map(b => b.id) : []))
  await keepCursorVisible($)
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
  if (visible !== undefined) await setCursor($, visible.id)
  else await keepCursorInView($)
}

async function toggleZoom($: EngineInterface) {
  const id = await read($, cursor)
  const current = await read($, zoom)
  // 「…」那一行不是一块，聚焦不进去
  if (current === null && moreRunId(id) !== undefined) return
  await update($, zoom, () => (current !== null ? null : id === null ? null : parseKey(id).blockId))
}

async function exportView($: EngineInterface, v: View, isToFile = false) {
  const list = await read($, blocks)
  const rows = visibleRows(list, v, await read($, folded), await read($, zoom), [], await isHidingDone($))
  const now = new Date(await $.clock.now())
  const md = toMarkdown(list, rows, v, await read($, open), now.toISOString().slice(0, 16).replace('T', ' '))
  const count = rows.filter(r => !r.isContext).length
  if (isToFile) {
    // 文件名写死在调用里：官方目录要读得出这个 mod 只写这一个文件，不会写到设置、启动脚本这类别的工具要读的文件
    await $.fs.write('outline-export.md', md)
    return `已导出「${VIEW_INFO[v].label}」视图（${count} 块）到工作目录的 outline-export.md`
  }
  const copied = await $.ui.copy({ text: md })
  return copied.isCopied
    ? `已复制「${VIEW_INFO[v].label}」视图（${count} 块）的 Markdown`
    : `复制失败（${copied.reason}），可以用 /outline export ${v} file 存成工作目录里的 outline-export.md`
}

/** G：对话滚到光标这一行的原文（跳到哪条见 jumpTarget） */
async function jump($: EngineInterface) {
  // 还没动过光标时，面板上光标画在最新一行（见 shownAt），跳也从那一行跳
  const key = (await read($, cursor)) ?? latestKey(await currentRows($)) ?? null
  const target = key === null ? undefined : jumpTarget(await read($, blocks), key)
  if (target === undefined) {
    void $.ui.toast('这一块没记下原文在哪（可能是重新打开会话之前的块）')
    return
  }
  const moved = await $.ui.scroll({ to: { requestId: target }, block: 'start' })
  if (moved.deny !== undefined) void $.ui.toast(`跳不过去：${moved.deny}`)
}

/**
 * ] / [：光标挪到下一个 / 上一个同级的块，对话跟着跳到它的原文。这一层走完了就到上一层的下一块，
 * 所以先 ⇧1 只留顶层，就能一个话题一个话题地往下翻；折起来的子块跳过
 */
async function stepLevel($: EngineInterface, step: number) {
  const rows = await currentRows($)
  const id = await cursorBlockId($)
  const at = rows.findIndex(r => r.key === id)
  if (at < 0) return
  const depth = rows[at]!.depth
  for (let i = at + step; i >= 0 && i < rows.length; i += step) {
    const row = rows[i]!
    if (row.item !== undefined || row.depth > depth) continue
    await clearSelection($)
    await setCursor($, row.key)
    return jump($)
  }
}

// ---------- 搜索 ----------

/** 点树时切成了英文键盘的，切回原来的输入法，好在搜索框、回复框里打中文 */
function restoreInputMethod($: EngineInterface) {
  const back = restoreInput
  if (back === undefined) return
  restoreInput = undefined
  void $.process.run(['./bin/input-source'], { cwd: $.plugin.root, stdin: back, timeoutMs: 3000 }).catch(() => undefined)
}

/** /：露出搜索框，焦点交过去 */
async function openSearch($: EngineInterface) {
  await update($, searching, () => true)
  restoreInputMethod($)
  // 搜索框要等下一次画面板才有，放到这次处理之外去等
  $.clock.after(0, () => void $.ui.focus({ requestId: PANE, key: SEARCH }))
}

// ---------- 回复 ----------

/** 回复的是哪一件：还没了结的块或「需要我做」的条目才回；已经了结的、「…」那一行不用回 */
const replyTarget = (list: readonly Block[], key: string | null) => {
  if (key === null || moreRunId(key) !== undefined) return undefined
  const { blockId, index } = parseKey(key)
  const b = list.find(one => one.id === blockId)
  if (b === undefined || !isOpenStatus(index === undefined ? b.status : itemStatus(b, index))) return undefined
  return index === undefined ? `块 [${b.id}]「${b.title}」` : `「${b.needsMe[index] ?? ''}」（块 [${b.id}]「${b.title}」）`
}

/** A：回复光标这一行，露出回复框，焦点交过去 */
async function openReply($: EngineInterface) {
  const key = await read($, cursor)
  if (replyTarget(await read($, blocks), key) === undefined) {
    await $.ui.toast('这一行已经了结，不用回复')
    return
  }
  await update($, replyTo, () => key)
  restoreInputMethod($)
  $.clock.after(0, () => void $.ui.focus({ requestId: PANE, key: REPLY }))
}

/** 回复框里回车：有字就发给 Claude，说清回的是哪一件；空着回车就是不回了 */
async function sendReply($: EngineInterface, text: string) {
  const key = await read($, replyTo)
  await update($, replyTo, () => null)
  const what = replyTarget(await read($, blocks), key)
  if (what === undefined || text.trim() === '') return
  // mod 自己发的消息不经过自己的 prompt.submit 钩子：侧栏里改过的状态直接接在正文后面
  const told = await takeChanges($)
  await $.prompt.submit({ text: ['我在大纲侧栏里回复了这件事，请照着接着处理：', `- ${what}：${text.trim()}`, ...(told === undefined ? [] : ['', told])].join('\n') })
}

/** 边打边搜：命中的块露出来，祖先留着当上下文 */
async function setQuery($: EngineInterface, text: string) {
  await update($, query, () => text)
  await clearSelection($)
  await keepCursorInView($)
}

/** 回车：有字就留着这次搜索；清空了回车就收起搜索框 */
async function submitSearch($: EngineInterface, text: string) {
  await setQuery($, text.trim() === '' ? '' : text)
  if (text.trim() === '') await update($, searching, () => false)
}

// ---------- 长期没动的块：提示一键 Done ----------

async function doneStale($: EngineInterface, ids: readonly string[]) {
  for (const id of ids) await changeRow($, id, () => 'DONE')
}

async function skipStale($: EngineInterface, ids: readonly string[]) {
  await update($, staleSkipped, list => [...new Set([...(list ?? []), ...ids])])
}

async function runAction($: EngineInterface, action: string) {
  if (action === 'down' || action === 'up') {
    await clearSelection($)
    return moveCursor($, action === 'down' ? 1 : -1)
  }
  if (action === SEARCH) return openSearch($)
  if (action === 'reply') return openReply($)
  if (action === 'fold') return toggleFold($)
  if (action === 'fold-up') return foldUp($)
  if (action === 'unfold-down') return unfoldDown($)
  if (action === 'detail') return toggleDetail($)
  if (action === 'indent') return reparent($, 'in')
  if (action === 'outdent') return reparent($, 'out')
  if (action === 'status') return cycleStatus($)
  if (action === 'status-bad') return changeStatus($, nextBadStatus)
  if (action === 'done') return setStatus($, 'DONE')
  // 待验收的块上按 Y 就是验收通过：走 Done 的路子（先看证据、算放行、不额外发消息）
  if (action === 'yes') return changeStatus($, st => (st === 'TOREVIEW' ? 'DONE' : 'YES'))
  if (action === 'no') return setStatus($, 'NO')
  if (action === 'level') return cycleLevel($)
  if (action === 'zoom') return toggleZoom($)
  if (action === 'fold-done') return toggleDoneFold($)
  if (action === 'relayout') return toggleLayout($)
  if (action === 'jump') return jump($)
  if (action === 'next-sibling' || action === 'prev-sibling') return stepLevel($, action === 'next-sibling' ? 1 : -1)
  if (action === 'export') {
    await exportView($, await read($, view))
    return
  }
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

/** ⇧ 加这些字母：直接标成对应的负面状态，不用按 N 一个个转 */
const VERDICT_KEYS: Record<string, Status> = { r: 'REWORK', u: 'UNCLEAR', f: 'FAILED', s: 'SUSPENDED', c: 'CANCELLED' }

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
  // ⇧↑ / ⇧↓ 多选，照 Logseq；不按 ⇧ 直接走就取消
  if ((isUp || isDown) && k.shift) return extendSelection($, isUp ? -1 : 1)
  if (isUp || k.key === 'k') return runAction($, 'up')
  if (isDown || k.key === 'j') return runAction($, 'down')
  // ] / [：同级的下一块 / 上一块，对话跟着跳（中文输入法下是 】【）
  if (k.key === ']' || k.key === '】') return stepLevel($, 1)
  if (k.key === '[' || k.key === '【') return stepLevel($, -1)
  // /：搜索（中文输入法下是全角的）
  if (k.key === '/' || k.key === '／') return openSearch($)
  if (k.key === 'left') return toggleFold($, true)
  if (k.key === 'right') return toggleFold($, false)
  if (k.key === 'return' || k.key === 'space') return toggleDetail($)
  if (/^[1-9]$/.test(k.key)) {
    const v = keys[Number(k.key) - 1]
    if (v !== undefined) await switchView($, v)
    return
  }
  // -：跳过这件事（中文输入法下是全角的）。按钮只认字母，桌面版走回车菜单
  if (k.key === '-' || k.key === '－') return setStatus($, 'SKIP')
  // ⇧ 加首字母直接标成对应的负面状态（终端可能报成大写字母，也可能是小写带 shift）
  const verdict = /^[a-zA-Z]$/.test(k.key) && (k.shift || k.key !== k.key.toLowerCase()) ? VERDICT_KEYS[k.key.toLowerCase()] : undefined
  if (verdict !== undefined) return setStatus($, verdict)
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
  if (turn === undefined) return
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
  if (list.length === 0) return
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
    return
  }
  await addRecap($, reply.text, 'outline')
}

// ---------- 一键重新排版 ----------

const RELAYOUT_SYSTEM = `你在给一段 Claude Code 会话重新排大纲。给你按时间顺序列出的每一轮（方括号里是编号），你按话题把它们重新分组成一棵浅的树。
只输出一个 JSON 对象，不要任何别的文字，不要代码块标记：{"parents": {"编号": 母块编号或 null, ...}}，每一轮都要给。
- 一个话题、一个功能开头的那一轮放顶层，填 null；同一话题后面接着做的几轮都挂在开头那一块下面，彼此并列，不要一轮挂在上一轮下面一路往下套
- 话题里分出一个明确的子问题、连着做了好几轮的，以子问题开头的那一轮为母块再挂一层；大纲最多 ${MAX_DEPTH + 1} 层
- 母块只能是更早的一轮
- 插进来的不相关的事（系统通知、顺手问的一句）单独放顶层`

/** 模型还在排，别重复发 */
let isRelayingOut = false

/** M：整份大纲交给模型按话题重排成浅的树，手动改过层级的块不动；排完到下一轮开始之前再按 M 就是撤销 */
async function toggleLayout($: EngineInterface) {
  const before = await read($, undoLayout)
  if (before !== null) {
    await setBlocks($, all =>
      all.map(b => {
        const was = before[b.id]
        return was === undefined || b.isManual ? b : { ...b, parent: was }
      }),
    )
    await update($, undoLayout, () => null)
    await keepCursorVisible($)
    await $.ui.toast('已撤销重新排版')
    return
  }
  const turns = (await read($, blocks)).filter(b => b.kind === 'turn' && !b.isPending && b.live === undefined)
  if (isRelayingOut || turns.length < 2) return
  isRelayingOut = true
  await $.ui.toast('正在按话题重新排版…')
  const prompt = turns.map(b => `[${b.id}] ${b.title}${b.conclusion === '' ? '' : `（结论：${clip(b.conclusion, 60)}）`}`).join('\n')
  const reply = await $.model.complete({ model: 'haiku', system: RELAYOUT_SYSTEM, prompt, maxTokens: 4096, timeoutMs: 90000 })
  isRelayingOut = false
  const parents = reply.isAnswered ? parseJson(reply.text)?.parents : undefined
  if (typeof parents !== 'object' || parents === null) {
    await $.ui.toast(`没排成${reply.isAnswered ? '' : `（${reply.reason}）`}，大纲没动`)
    return
  }
  const old = await read($, blocks)
  await update($, undoLayout, () => Object.fromEntries(old.filter(b => b.kind === 'turn').map(b => [b.id, b.parent])))
  await setBlocks($, all => relayout(all, parents as Record<string, unknown>))
  await keepCursorVisible($)
  await $.ui.toast('排好了：同一话题的几轮并列，最多 3 层。发下一条消息之前再按 M 撤销')
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
    // 当前会话的 savedAt 是排序用的最大数，不能拿去格式化日期
    const date = isCurrent ? '' : new Date(savedAt).toISOString().slice(5, 16).replace('T', ' ')
    const first = list.find(b => b.kind === 'turn')?.title ?? ''
    groups.push({ sid: id, label: `${isCurrent ? '🟢' : `🕘 ${date}`}  📁 ${where || '?'}  ${clip(first, 20)}`, isCurrent, items, savedAt })
  }
  toGroup(sid, await read($, blocks), cwd.split('/').pop() ?? '', Number.MAX_SAFE_INTEGER, true)
  for (const key of await $.store.keys()) {
    if (!key.startsWith(STORE_PREFIX) || key === `${STORE_PREFIX}${sid}`) continue
    const stored = await $.store.get(key)
    const saved = stored as Saved | undefined
    if (!Array.isArray(saved?.blocks)) continue
    toGroup(key.slice(STORE_PREFIX.length), saved.blocks, saved.cwd?.split('/').pop() ?? '', saved.savedAt ?? 0, false)
  }
  groups.sort((a, b) => b.savedAt - a.savedAt)
  await update($, agenda, () => groups.map(({ savedAt: _, ...g }) => g))
}

async function markAgendaDone($: EngineInterface, sid: string, blockId: string) {
  const done = (b: Block) => (b.id === blockId ? { ...b, status: 'DONE' as const, isStatusManual: true } : b)
  const own = await $.session.id()
  if (sid === own) {
    await setBlocks($, all => all.map(done))
  } else {
    const key = `${STORE_PREFIX}${sid}`
    const stored = await $.store.get(key)
    const saved = stored as Saved | undefined
    if (Array.isArray(saved?.blocks)) await $.store.set(key, { ...saved, blocks: saved.blocks.map(done) })
  }
  await collectAgenda($)
}

/** 记下会话的名字；没给、空的就不动 */
async function noteTitle($: EngineInterface, title: string | undefined) {
  if (title === undefined || title.trim() === '') return
  await update($, sessionTitle, () => title.trim())
}

// ---------- 注册 ----------

export const register: Register = (on, options) => {
  const keys = parseKeys(typeof options.views === 'string' ? options.views : DEFAULT_KEYS)

  // 会话的名字只在设置里那种 hook 的输入里有：开场、每条消息各带一份，改名了下一条消息就跟上
  // 先记名字再原样放行，写成 return next(e) 官方目录才认得出这里不替用户做决定
  on('classic.SessionStart', async ($, e, next) => {
    await noteTitle($, e.session_title)
    return next(e)
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteTitle($, e.session_title)
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    await $.command.register({
      name: 'outline',
      description: '打开会话大纲。可带视图名（me / conclusions / asks / done / all / tech），或 export [视图] [file] 导出（带 file 存成工作目录的 outline-export.md）',
      argumentHint: '[视图] | export [视图] [file]',
    })
    await $.command.register({ name: 'agenda', description: '所有会话里需要我做、还没办完的事' })
    await restore($)
    if (current === undefined) await settleStaleLive($)
    void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  on('command.run', { command: 'outline' }, async ($, e) => {
    const words = e.args.trim().split(/\s+/).filter(Boolean)
    if (words[0]?.toLowerCase() === 'export') {
      const named = words[1] === undefined ? undefined : viewFromArg(words[1])
      const v = named ?? (await read($, view))
      const rest = words.slice(named === undefined ? 1 : 2).join(' ')
      if (rest !== '' && rest.toLowerCase() !== 'file') return { text: '导出只能复制，或者用 file 存到工作目录的 outline-export.md，不能指定路径' }
      return { text: await exportView($, v, rest !== '') }
    }
    const chosen = words[0] === undefined ? undefined : viewFromArg(words[0])
    if (words[0] !== undefined && chosen === undefined) return { text: `没有「${words[0]}」这个视图。可选：${keys.join('、')}` }
    if (chosen !== undefined) await switchView($, chosen)
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
        const content = (e.message as { content?: unknown }).content
        if (Array.isArray(content)) {
          for (const c of content) {
            const block = c as { type?: string; text?: string }
            if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
              current.texts.push(block.text)
              if (result.uuid !== undefined) current.answerId = result.uuid
            }
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
    void $.process.run(['./bin/input-source'], { cwd: $.plugin.root, stdin: back, timeoutMs: 3000 }).catch(() => undefined)
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
      // 新的一轮开始，重新排版就不能撤销了
      await update($, undoLayout, () => null)
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
      const agents = await $.agent.list()
      const info = agents.find(a => a.id === e.agentId)
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
      ...(turn.answerId === undefined ? {} : { answerId: turn.answerId }),
      tech,
    }
    const branches = turn.branches.map((br, i) => branchBlock(br, `${id}.${i + 1}`, number, id))
    await setBlocks($, list =>
      live === undefined ? [...list, block, ...branches] : [...list.map(b => (b.id === id ? { ...block, status: b.isStatusManual ? b.status : block.status } : b)), ...branches],
    )
    // 总结放到这次分发之外，不拖慢回合结束
    $.clock.after(0, () => void summarize($, id, turn, e.answer, e.isAborted, e.reason === 'error'))
    return result
  })

  // 滚轮：大纲树是自己画的，收不到滚轮；人在面板上滚的格数累加起来交给树自己翻，引擎的窗口不动。
  // 键盘翻页（没有指针位置的）照旧交给引擎
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    if (e.origin.kind !== 'person' || e.pointer === undefined) return next(e)
    await update($, wheel, n => (n ?? 0) + e.by)
    return {}
  })

  // 树视图里的按键和点击
  on('ui.message', { requestId: PANE }, async ($, e, next) => {
    const data = e.data as { type?: string; id?: string; key?: string; shift?: boolean; ctrl?: boolean; meta?: boolean }
    if (data.type === 'click' && typeof data.id === 'string') {
      void asciiInput($)
      await pick($, data.id)
    }
    else if (data.type === 'focus') void asciiInput($)
    else if (data.type === 'ruler' && typeof data.id === 'string') {
      const id = data.id
      await goToBlock($, id)
      // 终端的树自己把光标那块翻进窗口；桌面版的面板是引擎在滚，等这次重画完再把那一行滚到中间
      if (e.surface !== 'terminal') $.clock.after(0, () => void $.ui.scroll({ to: { key: `block-${id}` }, in: PANE, block: 'center' }))
    }
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

  // ---------- 大纲面板 ----------

  // 终端：大纲树是自绘区域（Client），单独一个钩子画；上面那一截（视图栏、工具栏、回顾……）照旧由下面的钩子画。
  // 同一个模块里先注册的钩子在外层
  on('ui.render', { component: 'Pane', requestId: PANE, surface: 'terminal' }, async ($, e, next) => {
    const els = $.ui.resolve(e)
    const { Box } = els
    paneTree = undefined
    paneRuler = undefined
    const header = await next(e)
    if (paneTree === undefined) return header
    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        {header}
        {paneRuler !== undefined && els.Client({ module: './ruler.tsx', key: RULER, props: paneRuler, width: e.props.bodyColumns })}
        {/* 从元素表上直接调用，不把 Client 取成一个变量：目录的扫描把声明出来的 Client 当成认不出的元素 */}
        {els.Client({ module: './tree-view.tsx', key: TREE, props: paneTree, width: e.props.bodyColumns })}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // 手机端没有输入框和下拉框，搜索框、「更多操作」不画
    const Input = 'Input' in els ? els.Input : undefined
    const Select = 'Select' in els ? els.Select : undefined
    const isTerm = e.surface === 'terminal'
    // 一长串中文不断行的毛病只在 Claude 桌面版上见过，零宽空格只加在那里
    const isDesktop = e.surface === 'desktop'
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
    const isDoneFolded = await read($, doneFolded)
    const canUndoLayout = (await read($, undoLayout)) !== null
    const latest = await read($, recap)
    const isLegend = await read($, legend)
    const title = await read($, sessionTitle)
    const q = await read($, query)
    const isSearch = (await read($, searching)) || q !== ''
    const replyWhat = replyTarget(list, await read($, replyTo))
    const skipped = await read($, staleSkipped)
    const stale = staleBlocks(list).filter(b => !skipped.includes(b.id))
    const staleIds = stale.length >= STALE_MIN ? stale.map(b => b.id) : []
    const staleText = `${staleIds.length} 块隔了 ${STALE_TURNS} 轮以上还开着，没人动过`
    const now = await $.clock.now()
    const width = e.props.bodyColumns
    // 终端用图标字体；桌面（以及别的能画 SVG 的界面）用 SVG
    const desk = e.surface !== 'terminal' && 'Svg' in els ? (els as unknown as DesktopEls) : undefined
    // 视图栏的高亮只在终端的树里有意义（别的界面是按钮，焦点由界面自己管）
    const isTabs = e.surface === 'terminal' && (await read($, scope)) === 'tabs'

    const rows = visibleRows(list, v, foldedIds, zoomId, openIds, await isHidingDone($), await autoFold($), q)
    // 还没动过光标：当它停在最新一行（默认位置）
    const latestRow = latestKey(rows)
    const shownAt = at ?? latestRow ?? null
    const ticks = rulerTicks(list, shownAt, width)
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
              <Text color={line.color} dimColor={line.color === undefined}>{isDesktop ? breakable(line.parts[0]?.text ?? '') : (line.parts[0]?.text ?? '')}</Text>
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
            desktopLine(desk, line, isDesktop)
          )}
        </Box>
      )
    }

    const header = (
      <Box flexDirection="column" rowGap={isTerm ? 0 : 'sm'}>
        {/* 会话的名字当大纲的标题，顶格；终端只有一种字号，靠加粗突出 */}
        {title !== null && (
          <Text bold size="heading">
            {title}
          </Text>
        )}
        {/* 视图栏留成按钮：侧栏有键盘时数字键才切得了视图。按钮在指针下一定反色，里面的字只用一种样式，反出来才是一整块 */}
        <Box flexWrap="wrap" columnGap={1} rowGap={isTerm ? 0 : 'xs'}>
          {keys.map((one, i) => (
            <Button
              key={`view-${one}`}
              {...(isTerm ? { plain: true as const } : { variant: v === one ? ('primary' as const) : ('secondary' as const) })}
              hotkey={String(i + 1)}
              dimColor={isTerm && v !== one}
              {...(v === one ? { autoFocus: true as const } : {})}
              onPress={() => (v === one && e.surface === 'terminal' ? undefined : switchView($, one))}
            >
              {v === one ? (
                <Text bold underline={isTabs}>
                  {viewLabel(one, waiting)}
                </Text>
              ) : (
                viewLabel(one, waiting)
              )}
            </Button>
          ))}
        </Box>
        <Box flexWrap="wrap" columnGap={1} rowGap={isTerm ? 0 : 'xs'} alignItems="center">
          {ACTIONS.filter(a => isTerm || Select === undefined || DESK_ACTIONS.includes(a.key)).map(a => (
            <Button key={a.key} plain hotkey={a.hotkey} onPress={() => runAction($, a.key)}>
              {actionLabel(a, zoomId !== null, isDoneFolded, canUndoLayout)}
            </Button>
          ))}
          {!isTerm && Select !== undefined && (
            <Select
              key="more"
              value=""
              options={[
                { value: '', label: '更多操作…' },
                ...ACTIONS.filter(a => !DESK_ACTIONS.includes(a.key) && a.key !== 'up' && a.key !== 'down').map(a => ({ value: a.key, label: `${a.hotkey.toUpperCase()}　${actionLabel(a, zoomId !== null, isDoneFolded, canUndoLayout)}` })),
              ]}
              onSelect={(value: string) => (value === '' ? undefined : runAction($, value))}
            />
          )}
        </Box>
        {/* 收进下拉框的操作，按钮照样画出来但藏着：下拉框里标的字母照样按得动 */}
        {!isTerm && Select !== undefined && (
          <Box display="none">
            {ACTIONS.filter(a => !DESK_ACTIONS.includes(a.key)).map(a => (
              <Button key={a.key} plain hotkey={a.hotkey} onPress={() => runAction($, a.key)}>
                {actionLabel(a, zoomId !== null, isDoneFolded, canUndoLayout)}
              </Button>
            ))}
          </Box>
        )}
        {isSearch && Input !== undefined && (
          <Box flexDirection="row" columnGap={1}>
            <Input key={SEARCH} label="搜索" placeholder="关键词；清空后回车收起" value={q} onInput={(text: string) => setQuery($, text)} onSubmit={(text: string) => submitSearch($, text)} />
            {q.trim() !== '' && <Text dimColor>命中 {String(rows.filter(r => !r.isContext && r.item === undefined).length)} 块</Text>}
          </Box>
        )}
        {replyWhat !== undefined && Input !== undefined && (
          <Box flexDirection="column">
            {/* 终端里只占一行：中文占两格，按半宽截 */}
            <Text dimColor>{isTerm ? clip(`回复 ${replyWhat}`, Math.max(8, Math.floor(width / 2) - 2)) : breakable(`回复 ${replyWhat}`)}</Text>
            <Input key={REPLY} label="回复" placeholder="写好回车发给 Claude；空着回车就不回了" onSubmit={(text: string) => sendReply($, text)} />
          </Box>
        )}
        {staleIds.length > 0 && (
          <Box flexWrap="wrap" columnGap={1}>
            <Text color="warning">{staleText}</Text>
            <Button key="stale-done" plain onPress={() => doneStale($, staleIds)}>
              全部 Done
            </Button>
            <Button key="stale-skip" plain onPress={() => skipStale($, staleIds)}>
              不用
            </Button>
          </Box>
        )}
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
        {/* 分隔线只在终端画：桌面是比例字体，按格数画的横线会折成两行 */}
        {isTerm ? <Text dimColor>{'─'.repeat(Math.max(1, Math.min(width, 60)))}</Text> : <Box marginBottom="sm" />}
      </Box>
    )

    const empty = list.length === 0 ? `${PH.empty} 聊一轮，这里就会长出第一块` : rows.length === 0 ? '∅' : undefined

    // 终端里用树视图接 Logseq 式按键（中文输入法下也能用）；别的界面退回成按钮
    if (e.surface === 'terminal') {
      const viewLabels = keys.map((one, i) => `${i + 1}: ${viewLabel(one, waiting)}`)
      const actionLabels = ACTIONS.map(a => `${a.hotkey}: ${actionLabel(a, zoomId !== null, isDoneFolded, canUndoLayout)}`)
      const headerRows =
        (title === null ? 0 : textRows(title, width)) +
        estimateWrappedRows(viewLabels, width) +
        estimateWrappedRows(actionLabels, width) +
        (isSearch ? 1 : 0) +
        (replyWhat === undefined ? 0 : 2) +
        (ticks.length === 0 ? 0 : 1) +
        (staleIds.length > 0 ? estimateWrappedRows([staleText, '全部 Done', '不用'], width) : 0) +
        (latest === null ? 0 : 1 + (latest.text === '' ? 0 : textRows(latest.text, width - 2))) +
        (isLegend ? legendRows(width) : 0) +
        (zoomed === undefined ? 0 : 1) +
        (total === undefined ? 0 : 1 + techLines(total).length) +
        (v === 'tech' ? 3 + (allMetrics === null ? 0 : 3) : 0) +
        1
      const height = Math.max(6, e.props.scroll.bodyRows - headerRows)
      const wheelAt = await read($, wheel)
      const levelNow = await read($, level)
      paneRuler = ticks.length === 0 ? undefined : { ticks, isHover: false }
      paneTree = {
        rows: toTreeRows(rows, v, openIds, shownAt, now, await selectedKeys($)),
        height,
        scope: isTabs ? 'tabs' : 'tree',
        wheel: wheelAt,
        view: v,
        follow: shownAt !== null && shownAt === latestRow,
        menu: menuFor(levelNow, zoomId !== null, isDoneFolded, canUndoLayout),
        itemMenu: itemMenu(),
        ...(empty === undefined ? {} : { empty }),
      }
      // 树由外层的终端钩子接着画
      return (
        <Box flexDirection="column" width={width}>
          {header}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" width={width}>
        {header}
        {/* 桌面版的刻度尺跟着鼠标鼓起来；VS Code、手机端没有 Client，不画 */}
        {ticks.length > 0 && 'Client' in els && <Box marginBottom="sm">{els.Client({ module: './ruler.tsx', key: RULER, props: { ticks, isHover: isDesktop }, width })}</Box>}
        {empty !== undefined && <Text dimColor>{empty}</Text>}
        {rows.map(row => {
          const b = row.block
          const isAt = row.key === at
          // 一串整棵都了结的顶层块折成的「…」：点箭头或「展开」就展开
          if (row.more !== undefined) {
            return (
              <Box
                key={`row-${row.key}`}
                flexDirection="row"
                columnGap={1}
                marginTop={row.isGap ? 'sm' : 0}
                paddingY={desk === undefined ? 0 : 'xs'}
                {...(isAt ? { backgroundColor: DESK_CURSOR_BG } : {})}
              >
                <Box width={2} flexShrink={0}>
                  <Button key={`block-${row.key}`} plain onPress={() => pick($, row.key)}>
                    ▸
                  </Button>
                </Box>
                <Text dimColor>… 已了结 {String(row.more.length)} 块</Text>
                <Button key={`more-${row.key}`} plain onPress={() => pick($, row.key)}>
                  展开
                </Button>
              </Box>
            )
          }
          const st = row.item?.status ?? b.status
          // 悬停时整行变色
          const scope = `os-row-${row.key}`
          const badge = row.item === undefined ? KIND_BADGE[b.kind] : undefined
          const isOpenRow = isOpenStatus(st)
          const lines = row.item !== undefined || row.isContext ? [] : blockLines(b, v, openIds.includes(b.id), now)
          const arrow = row.item !== undefined ? ITEM_MARK : row.hasChildren ? (row.isFolded ? '▸' : '▾') : '•'
          return (
            <Box
              key={`row-${row.key}`}
              flexDirection="column"
              marginTop={row.isGap ? 'sm' : 0}
              paddingY={desk === undefined ? 0 : 'xs'}
              {...(isAt ? { backgroundColor: DESK_CURSOR_BG } : {})}
              hover={{ scope, backgroundColor: isAt ? DESK_CURSOR_BG : DESK_HOVER_BG }}
            >
              {/* 桌面版的圆点本身是带内边距的按钮，再隔 1 格就空得比图标到标题还大：只隔最小一档 */}
              <Box flexDirection="row" alignItems="flex-start" columnGap={desk === undefined ? 1 : 'xs'} paddingLeft={row.depth * DESK_INDENT}>
                <Box width={2} flexShrink={0}>
                  <Button key={`block-${row.key}`} plain onPress={() => pick($, row.key)}>
                    {arrow}
                  </Button>
                </Box>
                {b.isPending && row.item === undefined ? (
                  <Text dimColor>…</Text>
                ) : desk === undefined ? (
                  drawStatus(st, row.isContext, row.item === undefined ? b.statusAt : undefined)
                ) : (
                  desktopStatusIcon(desk, st, row.item === undefined && b.statusAt !== undefined && now - b.statusAt < FIRE_MS)
                )}
                {/* 标题和下面的字段行同在一列：字段行天然和标题左边对齐，不用按格数去凑 */}
                <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
                  <Box flexDirection="row" columnGap={1}>
                    {badge !== undefined && <Text color={badge.color}>[{badge.text}]</Text>}
                    <Box flexShrink={1} minWidth={0}>
                      <Text
                        dimColor={row.isContext || (!isOpenRow && b.live === undefined)}
                        strikethrough={st === 'CANCELLED'}
                        bold={isAt || (isOpenRow && !row.isContext)}
                        color={badge?.color}
                      >
                        {(isDesktop ? breakable : String)(row.item === undefined ? titleIn(b, v) || UNTITLED : row.item.text)}
                      </Text>
                    </Box>
                  </Box>
                  {/* 状态名打头，块接着第一行字段；上下文行只有图标 */}
                  {desk !== undefined && !row.isContext && !(b.isPending && row.item === undefined) ? (
                    <Box flexDirection="row" columnGap={1} alignItems="flex-start">
                      <Text color={STATUS_INFO[st].color} size="footnote" weight={isOpenRow ? 'semibold' : 'regular'}>
                        {STATUS_INFO[st].label}
                      </Text>
                      {lines[0] !== undefined && <Box flexShrink={1} minWidth={0}>{drawLine(lines[0], '')}</Box>}
                    </Box>
                  ) : (
                    lines[0] !== undefined && drawLine(lines[0], '')
                  )}
                  {lines.slice(1).map(line => drawLine(line, ''))}
                </Box>
              </Box>
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
