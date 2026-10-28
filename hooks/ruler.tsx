import type { ClientModule } from 'claude-code'

import { wrapCells } from './outline'
import type { RulerProps } from './outline'

/** 格子的高低，从矮到高 */
const BARS = '▁▂▃▄▅▆▇█'

/** 桌面版悬停时，那一格和左右第一、第二个邻居各加高几级：像 Dock 那样鼓起来 */
const BUMP = [3, 2, 1]

/** hover：鼠标停在第几格上，null 是没停在刻度尺上 */
type State = { hover: number | null }

/**
 * 刻度尺：整场会话一轮一格，颜色跟状态走，高低看要不要我管（见 rulerTicks）。点一格，光标跳到那一轮。
 * 格子都只占一格宽，鼓起来也只是变高，鼠标的列号直接就是第几格。
 * 桌面版鼠标扫过时，那一格和左右邻居鼓起来，下面一行显示它的标题，没停在上面时显示光标那一轮的；终端只画一排，不跟着鼠标动
 */
const Ruler: ClientModule<RulerProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const ticks = props.ticks
  const hover = props.isHover ? (surface.state?.hover ?? null) : null
  const level = (i: number) => Math.min(BARS.length - 1, ticks[i]!.height + (hover === null ? 0 : (BUMP[Math.abs(i - hover)] ?? 0)))

  surface.onPointer(event => {
    const isOnTick = event.x >= 0 && event.x < ticks.length
    if (event.type === 'down') {
      if (event.y === 0 && isOnTick) surface.post({ type: 'ruler', id: ticks[event.x]!.id })
      return
    }
    if (!props.isHover) return
    const next = event.type === 'leave' || !isOnTick ? null : event.x
    if (next !== (surface.state?.hover ?? null)) surface.setState({ hover: next })
  })

  const shown = ticks[hover ?? ticks.findIndex(t => t.isAt)]
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        {ticks.map((t, i) => (
          <Text color={t.color} dimColor={level(i) === 0} bold={t.isAt}>
            {BARS[level(i)]}
          </Text>
        ))}
      </Box>
      {props.isHover && <Text dimColor>{shown === undefined ? ' ' : (wrapCells(`${shown.turns} ${shown.title}`, surface.columns > 0 ? surface.columns : 60)[0] ?? '')}</Text>}
    </Box>
  )
}

export default Ruler
