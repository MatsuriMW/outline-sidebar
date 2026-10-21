import type { ClientModule } from 'claude-code'

import { SPIN } from './icons'
import { STATUS_GAP, cellWidth, wrapCells } from './outline'
import type { TreeLine, TreeProps, TreeRow } from './outline'

const linesFor = (text: string, room: number) => wrapCells(text, room).length

/** 详情行的字能用几格：去掉续行的竖线、小节缩进和圆点 */
const lineRoom = (line: TreeLine, room: number) => room - (line.level === 1 ? 3 : 0) - (line.isBullet === true ? 2 : 0) - 1

const lineHeight = (line: TreeLine, room: number) => linesFor(line.text, lineRoom(line, room))

/** 标题前面那一截（树枝、箭头、状态、角标）占几格 */
const headWidth = (row: TreeRow) =>
  cellWidth(row.prefix) + cellWidth(row.arrow) + 1 + cellWidth(row.status) + STATUS_GAP.length + (row.badge === undefined ? 0 : cellWidth(row.badge.text) + 3)

/** 估算一行占几行（不含菜单），用来把点击的行号换回是哪一行，以及让光标所在行始终在可见范围里 */
const bodyHeight = (row: TreeRow, columns: number) => {
  let n = (row.isGap ? 1 : 0) + linesFor(row.title, columns - headWidth(row))
  for (const line of row.lines) n += lineHeight(line, columns - cellWidth(row.cont))
  return n
}

/** 菜单画在光标所在行下面，带一圈边框 */
const menuHeight = (count: number) => count + 2

/** Doing 的图标换成第 frame 个角度 */
const spun = (status: string, frame: number) => {
  const [first = '', ...rest] = Array.from(status)
  return `${SPIN[frame % SPIN.length] ?? first}${rest.join('')}`
}

type State = { top: number; menu: number | null; frame: number }

/** 计时器只开一个，它看这个变量决定要不要转（模块里只有一棵树） */
let hasSpinning = false

/** ⌘/（终端把 ⌘ 报成 meta 时）或 Ctrl+/：在 Todo、Doing、Done 之间切 */
const isCycleKey = (key: string, ctrl: boolean, meta: boolean) => (key === '/' && (ctrl || meta)) || (key === '_' && ctrl) || key === '\u001f'

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
  const heights = rows.map((r, i) => bodyHeight(r, columns) + (isMenuOpen && i === at ? menuHeight(menuItems.length) : 0))
  // 留两行给「上面 / 下面还有几行」
  const room = Math.max(3, props.height - 2)
  hasSpinning = rows.some(r => r.isSpinning)

  // 只画能放下的一段，光标所在行不出窗口
  let top = Math.min(surface.state?.top ?? 0, Math.max(0, rows.length - 1))
  if (at >= 0) {
    if (at < top) top = at
    let used = 0
    for (let i = top; i <= at; i++) used += heights[i] ?? 1
    while (used > room && top < at) used -= heights[top++] ?? 1
  }
  let end = top
  let used = 0
  while (end < rows.length && used + (heights[end] ?? 1) <= room) used += heights[end++] ?? 1
  if (end === top && top < rows.length) end = top + 1

  if (surface.state === undefined) {
    surface.setState({ top, menu: null, frame: 0 })
    // Doing 的 loader-circle 转起来：8 个角度，0.8 秒一圈，和 todoseq 一样
    surface.every(100, () => {
      if (hasSpinning) surface.setState({ ...(surface.state ?? { top: 0, menu: null, frame: 0 }), frame: ((surface.state?.frame ?? 0) + 1) % SPIN.length })
    })
  } else if (surface.state.top !== top) surface.setState({ ...surface.state, top })

  const set = (patch: Partial<State>) => surface.setState({ top, menu, frame, ...patch })
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
    let y = event.y - (top > 0 ? 1 : 0)
    for (let i = top; i < end; i++) {
      const body = bodyHeight(rows[i]!, columns)
      if (y < body) {
        surface.post({ type: 'click', id: rows[i]!.key })
        return
      }
      if (isMenuOpen && i === at) {
        const item = y - body - 1
        if (item >= 0 && item < menuItems.length) {
          runMenu(item)
          return
        }
      }
      y -= heights[i] ?? 1
    }
    // 没点中哪一行（空白处、「↑ n」、空视图），树也拿到了键盘：照样切英文
    surface.post({ type: 'focus' })
  })

  const shown = rows.slice(top, end)
  return (
    <Box flexDirection="column">
      {top > 0 && <Text dimColor>  ↑ {String(top)}</Text>}
      {props.empty !== undefined && <Text dimColor>{props.empty}</Text>}
      {shown.map(row => (
        <Box flexDirection="column" marginTop={row.isGap ? 1 : 0}>
          <Box flexDirection="row">
            {/* 标题前面这一截不许被挤，挤了状态图标和字会被拆成两行 */}
            <Box flexShrink={0} flexDirection="row">
              {row.prefix !== '' && <Text dimColor>{row.prefix}</Text>}
              <Text inverse={row.isAt && scope === 'tree'}>{row.arrow}</Text>
              <Text> </Text>
              <Text color={row.statusColor} bold={row.isOpen} dimColor={row.isContext}>{row.isSpinning ? spun(row.status, frame) : row.status}</Text>
              <Text>{STATUS_GAP}</Text>
              {row.badge !== undefined && <Text color={row.badge.color}>[{row.badge.text}] </Text>}
            </Box>
            <Box flexDirection="column">
              {wrapCells(row.title, columns - headWidth(row)).map(part => (
                <Text dimColor={row.isContext || row.isClosed} strikethrough={row.isCanceled} bold={(row.isAt && scope === 'tree') || (row.isOpen && !row.isContext)} color={row.badge?.color}>
                  {part}
                </Text>
              ))}
            </Box>
          </Box>
          {row.lines.map(line => (
            <Box flexDirection="row">
              <Box flexShrink={0}>
                <Text dimColor>{row.cont}{line.level === 1 ? '   ' : ''}{line.isBullet === true ? '• ' : ''}</Text>
              </Box>
              <Box flexDirection="column">
                {wrapCells(line.text, lineRoom(line, columns - cellWidth(row.cont))).map(part => (
                  <Text color={line.color} dimColor={line.color === undefined}>{part}</Text>
                ))}
              </Box>
            </Box>
          ))}
          {isMenuOpen && row.isAt && scope === 'tree' && (
            <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
              {menuItems.map((item, i) => (
                <Text inverse={i === menu} color={item.color}>{item.label}</Text>
              ))}
            </Box>
          )}
        </Box>
      ))}
      {end < rows.length && <Text dimColor>  ↓ {String(rows.length - end)}</Text>}
    </Box>
  )
}

export default TreeView
