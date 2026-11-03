import type { ClientModule } from 'claude-code'

/**
 * 桌面版一行的点击层：盖在整行上（图标、标题、字段行都算），自己什么都不画，按下时把这一行的 key 交给钩子。
 * 单击、双击由钩子按两下的间隔分（见 pressRow）。
 * 桌面版的 Button 只画一行纯文字（不换行、不加粗、不上色），标题和图标做不成按钮，所以另盖一层来接点击
 */
const RowPress: ClientModule<{ id: string }> = (props, surface) => {
  const { Box } = surface.elements
  surface.onPointer(event => {
    if (event.type === 'down') surface.post({ type: 'row', key: props.id })
  })
  return <Box />
}

export default RowPress
