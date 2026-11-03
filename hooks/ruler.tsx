import type { ClientModule } from 'claude-code'

import { rulerRoom, wrapCells } from './outline'
import type { RulerProps } from './outline'

/** 格子的高低，从矮到高 */
const BARS = '▁▂▃▄▅▆▇█'

/** 桌面版悬停时，那一格和左右第一、第二个邻居各加高几级：像 Dock 那样鼓起来 */
const BUMP = [3, 2, 1]

/** 一格最宽占几列：轮数少时把格子放宽，轮数多了退回一轮一列；都只铺到 rulerRoom，右边留空 */
const MAX_CELL = 3

/** 一轮跑完时那一格闪两下：灭、亮、灭，每步停多少毫秒，播完就停，不循环 */
const BLINK_MS = 180
const BLINK_STEPS = 3

/** hover：鼠标停在第几格上，null 是没停在刻度尺上；live：上次画的时候还在跑的格子；blink：正在闪的那一格和闪到第几步 */
type State = { hover: number | null; live: string[]; blink: { id: string; step: number } | null }

const EMPTY: State = { hover: null, live: [], blink: null }

/**
 * 刻度尺：整场会话一轮一格，颜色跟状态走，高低看要不要我管（见 rulerTicks）。点一格，光标跳到那一轮。
 * 格子一样宽（轮数少时放宽，最多 MAX_CELL 列），鼓起来也只是变高，鼠标的列号除以格宽就是第几格。
 * 格子用等宽字体画：桌面版的正文字体把 ▁…█ 画成全角，一个占两列，按列算好的一排会挤不下、折成两行；
 * 万一还是挤不下，格子不收缩，多出来的从右边裁掉，永远只占一行。
 * 桌面版鼠标扫过时，那一格和左右邻居鼓起来，下面一行显示它的标题，没停在上面时显示光标那一轮的；终端只画一排，不跟着鼠标动。
 * 还在跑的那一轮跑完时，它那一格闪两下，告诉我轮到我了
 */
const Ruler: ClientModule<RulerProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const ticks = props.ticks
  const state = surface.state ?? EMPTY
  const cell = Math.max(1, Math.min(MAX_CELL, Math.floor(rulerRoom(props.columns) / Math.max(1, ticks.length))))
  const hover = props.isHover ? state.hover : null
  const level = (i: number) => Math.min(BARS.length - 1, ticks[i]!.height + (hover === null ? 0 : (BUMP[Math.abs(i - hover)] ?? 0)))
  const isDark = (id: string) => state.blink !== null && state.blink.id === id && state.blink.step % 2 === 0

  // 上次还在跑、这次停了的格子：那一轮跑完了，让它闪；已经在闪就换成这一格从头闪，计时器接着用
  const live = ticks.filter(t => t.isLive).map(t => t.id)
  if (live.join() !== state.live.join()) {
    const done = state.live.find(id => !live.includes(id) && ticks.some(t => t.id === id))
    surface.setState({ ...state, live, blink: done === undefined ? state.blink : { id: done, step: 0 } })
    if (done !== undefined && state.blink === null) {
      const stop = surface.every(BLINK_MS, () => {
        const now = surface.state ?? EMPTY
        const step = now.blink === null ? BLINK_STEPS : now.blink.step + 1
        if (step >= BLINK_STEPS) stop()
        surface.setState({ ...now, blink: step >= BLINK_STEPS ? null : { id: now.blink!.id, step } })
      })
    }
  }

  surface.onPointer(event => {
    const at = Math.floor(event.x / cell)
    const isOnTick = event.x >= 0 && at < ticks.length
    if (event.type === 'down') {
      if (event.y === 0 && isOnTick) surface.post({ type: 'ruler', id: ticks[at]!.id })
      return
    }
    if (!props.isHover) return
    const next = event.type === 'leave' || !isOnTick ? null : at
    const now = surface.state ?? EMPTY
    if (next !== now.hover) surface.setState({ ...now, hover: next })
  })

  const shown = ticks[hover ?? ticks.findIndex(t => t.isAt)]
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" overflow="hidden">
        {ticks.map((t, i) => (
          <Box flexShrink={0}>
            <Text color={t.color} dimColor={isDark(t.id) || level(i) === 0} bold={t.isAt} mono>
              {BARS[isDark(t.id) ? 0 : level(i)]!.repeat(cell)}
            </Text>
          </Box>
        ))}
      </Box>
      {props.isHover && <Text dimColor>{shown === undefined ? ' ' : (wrapCells(`${shown.turns} ${shown.title}`, surface.columns > 0 ? surface.columns : 60)[0] ?? '')}</Text>}
    </Box>
  )
}

export default Ruler
