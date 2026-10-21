import type { ClientModule, RenderElement } from 'claude-code'

import { SPIN } from './icons'
import { STATUS_GAP, cellWidth, wrapCells } from './outline'
import type { TreeLine, TreeProps, TreeRow } from './outline'

/** 详情行的字能用几格：去掉续行的竖线、小节缩进和圆点 */
const lineRoom = (line: TreeLine, room: number) => room - (line.level === 1 ? 3 : 0) - (line.isBullet === true ? 2 : 0) - 1

/** 折出来的续行前面：竖线照画，后面补空格到 width 格，让引导线一行一行连下去 */
const padTo = (guide: string, width: number) => guide + ' '.repeat(Math.max(0, width - cellWidth(guide)))

/** 标题前面那一截（树枝、箭头、状态、角标）占几格 */
const headWidth = (row: TreeRow) =>
  cellWidth(row.prefix) + cellWidth(row.arrow) + 1 + cellWidth(row.status) + STATUS_GAP.length + (row.badge === undefined ? 0 : cellWidth(row.badge.text) + 3) + (row.tag === undefined ? 0 : cellWidth(row.tag) + 3)

/** 菜单画在光标所在行下面，带一圈边框 */
const menuHeight = (count: number) => count + 2

/** Doing 的图标换成第 frame 个角度 */
const spun = (status: string, frame: number) => {
  const [first = '', ...rest] = Array.from(status)
  return `${SPIN[frame % SPIN.length] ?? first}${rest.join('')}`
}

/** top：窗口从第几行（终端的行，不是块）开始；wheel：上次看到的滚轮累计格数；at：上次画的时候光标在第几块；isWheeled：光标上次动过以后用滚轮翻过 */
type State = { top: number; menu: number | null; frame: number; wheel?: number; at?: number; isWheeled?: boolean }

/** 摊平以后的一项：哪一块的、从第几行开始、占几行（菜单一整个算一项，不切半个）；gap 是块前面的空行，menu 是回车菜单 */
type Flat = { row: number; start: number; height: number; kind?: 'gap' | 'menu'; node: RenderElement }

/** 滚轮一格翻几行 */
const WHEEL_LINES = 3

/** 计时器只开一个，它看这个变量决定要不要转（模块里只有一棵树） */
let hasSpinning = false

/**
 * ⌘/（终端把 ⌘ 报成 meta 时）或 Ctrl+/：在 Todo、Doing、Done 之间切。
 * 有的终端把 Ctrl+/ 报成 0x1f 这个控制字符；按编码比，源码里不写控制字符（mod 清单的扫描会把它当成 UI 兼容性问题）
 */
const isCycleKey = (key: string, ctrl: boolean, meta: boolean) =>
  (key === '/' && (ctrl || meta)) || (key === '_' && ctrl) || (key.length === 1 && key.charCodeAt(0) === 0x1f)

/**
 * 大纲的树：点一下拿到键盘。只用方向键、Tab、回车、空格、数字就能做完所有操作，
 * 中文输入法开着也不受影响（字母键会被输入法拿去组字，到不了这里）。
 */
const TreeView: ClientModule<TreeProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const columns = surface.columns > 0 ? surface.columns : 60
  const rows = props.rows
  const scope = props.scope ?? 'tree'
  const at = rows.findIndex(r => r.isAt)
  const menuItems = rows[at]?.lines === undefined || at < 0 ? props.menu : rows[at]!.isItem === true ? props.itemMenu : props.menu
  const menu = surface.state?.menu ?? null
  const frame = surface.state?.frame ?? 0
  const isMenuOpen = scope === 'tree' && menu !== null && at >= 0 && menuItems.length > 0
  // 留两行给「上面 / 下面还有几行」
  const room = Math.max(3, props.height - 2)
  hasSpinning = rows.some(r => r.isSpinning)

  // 先把所有块摊成一行一行：块之间的空行、标题的每个折行、每个字段行，光标那块下面的菜单
  const flats: Flat[] = []
  let total = 0
  const push = (row: number, node: RenderElement, height = 1, kind?: Flat['kind']) => {
    flats.push({ row, start: total, height, node, ...(kind === undefined ? {} : { kind }) })
    total += height
  }
  rows.forEach((row, i) => {
    if (row.isGap) push(i, <Text> </Text>, 1, 'gap')
    wrapCells(row.title, columns - headWidth(row)).forEach((part, k) =>
      push(
        i,
        <Box flexDirection="row">
          {/* 标题前面这一截不许被挤，挤了状态图标和字会被拆成两行 */}
          {k === 0 ? (
            <Box flexShrink={0} flexDirection="row">
              {row.prefix !== '' && <Text dimColor>{row.prefix}</Text>}
              <Text inverse={row.isAt && scope === 'tree'}>{row.arrow}</Text>
              <Text> </Text>
              <Text color={row.statusColor} bold={row.isOpen} dimColor={row.isContext}>{row.isSpinning ? spun(row.status, frame) : row.status}</Text>
              <Text>{STATUS_GAP}</Text>
              {row.badge !== undefined && <Text color={row.badge.color}>[{row.badge.text}] </Text>}
              {row.tag !== undefined && <Text dimColor>[{row.tag}] </Text>}
            </Box>
          ) : (
            <Box flexShrink={0}>
              <Text dimColor>{padTo(row.cont, headWidth(row))}</Text>
            </Box>
          )}
          <Text dimColor={row.isContext || row.isClosed} strikethrough={row.isCanceled} bold={(row.isAt && scope === 'tree') || (row.isOpen && !row.isContext)} color={row.badge?.color}>
            {part}
          </Text>
        </Box>,
      ),
    )
    for (const line of row.lines) {
      const lead = `${row.cont}${line.level === 1 ? '   ' : ''}${line.isBullet === true ? '• ' : ''}`
      wrapCells(line.text, lineRoom(line, columns - cellWidth(row.cont))).forEach((part, k) =>
        push(
          i,
          <Box flexDirection="row">
            <Box flexShrink={0}>
              <Text dimColor>{k === 0 ? lead : padTo(row.cont, cellWidth(lead))}</Text>
            </Box>
            <Text color={line.color} dimColor={line.color === undefined}>{part}</Text>
          </Box>,
        ),
      )
    }
    if (isMenuOpen && i === at) {
      push(
        i,
        <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
          {menuItems.map((item, n) => (
            <Text inverse={n === menu} color={item.color}>{item.label}</Text>
          ))}
        </Box>,
        menuHeight(menuItems.length),
        'menu',
      )
    }
  })

  const wheel = props.wheel ?? 0
  const scrolled = (wheel - (surface.state?.wheel ?? wheel)) * WHEEL_LINES
  const isCursorMoved = surface.state === undefined || surface.state.at !== at
  // 滚轮翻过以后，窗口停在翻到的地方，光标再动才拉回来；没翻过就和以前一样，光标那块始终在窗口里
  const isWheeled = scrolled !== 0 || (surface.state?.isWheeled === true && !isCursorMoved)

  // 窗口按行取，不按块：底下不会空出一截，翻也是一行一行地翻
  const lastTop = Math.max(0, total - room)
  let top = Math.max(0, Math.min((surface.state?.top ?? 0) + scrolled, lastTop))
  const own = flats.filter(f => f.row === at && f.kind !== 'gap')
  if (at >= 0 && !isWheeled && own.length > 0) {
    const from = own[0]!.start
    const to = own.at(-1)!.start + own.at(-1)!.height
    // 比窗口还高的块先露出开头；不然挪到刚好整块看得见
    if (to - from > room || from < top) top = from
    else if (to > top + room) top = to - room
  }
  // 菜单比窗口还高时也照画，从这一块的开头往下延伸，不能因为放不下就整个不见
  const shown = flats.filter(f => f.start >= top && (f.start + f.height <= top + room || (f.kind === 'menu' && f.start < top + room)))
  const below = total - (shown.length === 0 ? top : shown.at(-1)!.start + shown.at(-1)!.height)

  if (surface.state === undefined) {
    surface.setState({ top, menu: null, frame: 0, wheel, at, isWheeled })
    // Doing 的圆圈箭头转起来：8 个角度，1.6 秒一圈（0.8 秒一圈太快，看着闪）
    surface.every(200, () => {
      if (hasSpinning) surface.setState({ ...(surface.state ?? { top: 0, menu: null, frame: 0 }), frame: ((surface.state?.frame ?? 0) + 1) % SPIN.length })
    })
  } else if (surface.state.top !== top || surface.state.wheel !== wheel || surface.state.at !== at || surface.state.isWheeled !== isWheeled) {
    surface.setState({ ...surface.state, top, wheel, at, isWheeled })
  }

  const set = (patch: Partial<State>) => surface.setState({ top, menu, frame, wheel, at, isWheeled, ...patch })
  const runMenu = (i: number) => {
    const item = menuItems[i]
    set({ menu: null })
    if (item !== undefined) surface.post({ type: 'action', action: item.id })
  }

  surface.onKey(event => {
    const ctrl = event.ctrl === true
    const meta = event.meta === true
    // 视图栏：只能选视图和进入，碰不到树
    if (scope === 'tabs') {
      if (event.key === 'left' || event.key === 'right') surface.post({ type: 'action', action: event.key === 'left' ? 'view-prev' : 'view-next' })
      else if (/^[1-9!@#！＠＃¡™£]$/.test(event.key)) surface.post({ type: 'key', key: event.key, shift: event.shift === true, ctrl: false, meta: event.meta === true })
      else if (event.key === 'return' || event.key === 'down' || event.key === 'j' || event.key === ' ') surface.post({ type: 'action', action: 'enter-view' })
      return
    }
    if (event.key === 'backspace' && !isMenuOpen) {
      surface.post({ type: 'action', action: 'leave-view' })
      return
    }
    if (isCycleKey(event.key, ctrl, meta)) {
      surface.post({ type: 'action', action: 'cycle' })
      return
    }
    if (isMenuOpen) {
      const n = menuItems.length
      if (event.key === 'up') set({ menu: (menu - 1 + n) % n })
      else if (event.key === 'down') set({ menu: (menu + 1) % n })
      else if (event.key === 'return' || event.key === ' ' || event.key === 'right') runMenu(menu)
      else set({ menu: null })
      return
    }
    if (event.key === 'return' && at >= 0) {
      set({ menu: 0 })
      return
    }
    surface.post({ type: 'key', key: event.key === ' ' ? 'space' : event.key, shift: event.shift === true, ctrl, meta })
  })

  surface.onPointer(event => {
    if (event.type !== 'down') return
    const y = event.y - (top > 0 ? 1 : 0)
    for (const f of shown) {
      const at = f.start - top
      if (y < at || y >= at + f.height) continue
      // 菜单：上下各一行边框
      if (f.kind === 'menu') {
        const item = y - at - 1
        if (item >= 0 && item < menuItems.length) runMenu(item)
        return
      }
      if (f.kind !== 'gap') {
        surface.post({ type: 'click', id: rows[f.row]!.key })
        return
      }
    }
    // 没点中哪一行（空白处、「↑ n」、空视图），树也拿到了键盘：照样切英文
    surface.post({ type: 'focus' })
  })

  return (
    <Box flexDirection="column">
      {top > 0 && <Text dimColor>  ↑ {String(top)} 行</Text>}
      {props.empty !== undefined && <Text dimColor>{props.empty}</Text>}
      {shown.map(f => f.node)}
      {below > 0 && <Text dimColor>  ↓ {String(below)} 行</Text>}
    </Box>
  )
}

export default TreeView
