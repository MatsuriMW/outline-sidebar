import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { clampParent, jumpTarget, relayout, rulerTicks, wrapCells } from '../hooks/outline'

const PANE = {
  plugin: 'outline-sidebar',
  component: 'Pane',
  requestId: 'outline',
  props: {
    title: '大纲',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const USAGE ={ input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 }

const REPLIES = () => [
  { title: '给随机漫步加时间筛选', status: 'WAITING', did: ['加了 7 天 / 1 个月 / 全部三档'], conclusion: '默认全部', questions: [], needsMe: ['确认第 4 档是什么'], asks: [0], parent: null, resolved: [] },
  { title: '修 Hexo 部署', status: 'DONE', did: ['改了 _config.yml'], conclusion: '', questions: [], needsMe: [], parent: null, resolved: [] },
  { title: '第 4 档定为 3 个月', status: 'DONE', did: ['加了 3 个月档'], conclusion: '', questions: [], needsMe: [], parent: 'b1', resolved: [{ key: 'b1#0', by: 'user' }] },
]

/** 引擎这一侧：每个 hook 替引擎回答 */
const engine = (on: On, copied: string[], stored: Record<string, unknown> = {}, replies: unknown[] = REPLIES()) => {
  const clock = mock.clock(on)
  mock.store(on, stored)
  on('model.complete', (_, e) => {
    const system = String((e as { system?: string }).system ?? '')
    const isRecap = system.includes('回顾')
    const isProgress = system.includes('做到哪一步')
    const text = isProgress
      ? JSON.stringify({ title: '修 Hexo 部署', did: ['找到了出错的目录'], note: '正在改配置，改完要重新部署', needsMe: [] })
      : isRecap
        ? '三件事都做完了，第 4 档定为 3 个月，没有在等你的事。'
        : JSON.stringify(replies.shift())
    return { value: { isAnswered: true, text, usage: USAGE } } as never
  })
  on('command.register', () => ({ value: { command: 'outline' } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.copy', (_, e) => {
    copied.push((e as { text: string }).text)
    return { value: { isCopied: true } } as never
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('agent.list', () => ({ value: [{ id: 'ag1', description: '查 Hexo 文档', type: 'Explore', status: 'completed' }] }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // Bash 的命令里带 fail 就当报错
  on('tool.call', (_, e) => {
    const command = String((e as { command?: unknown }).command ?? '')
    return (command.includes('fail') ? { result: {}, isError: true, text: 'boom' } : { result: {}, text: 'ok\n13 pass' }) as never
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('prompt.submit', (_, e) => {
    contexts.push([...((e as { context?: string[] }).context ?? [])])
    prompts.push((e as { text: string }).text)
    return { text: (e as { text: string }).text } as never
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  return clock
}

/** 工具栏上的操作：终端里是按钮；桌面这类图形界面只摆几个常用的，其余在「更多操作」下拉框里 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const act = async (ui: any, key: string) =>
  (await ui.find({ type: 'Button', key })) !== undefined ? ui.press({ key }) : ui.select({ key: 'more', value: key })

/** 光标默认停在最新一行；要从第一块看起的测试先点一下第一块，再等离开的那块过了自动折叠的延迟，起点就和光标在第一块时一样 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const startAtFirst = async (ui: any, clock: { advance: (ms: number) => Promise<void> }) => {
  await ui.post({ type: 'click', id: 'b1' }, { in: 'tree' })
  await clock.advance(3000)
}

/** 每次发消息时附带的 context，看侧栏的状态改动有没有告诉 Claude */
const contexts: string[][] = []
/** 每次发出去的消息正文，看验收没通过时 mod 有没有替我发消息给 Claude */
const prompts: string[] = []

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const play = async ($: any, clock: { settle: () => Promise<void> }) => {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const complete = (turnId: string, answer: string, agentId?: string) =>
    $.turn.complete({ answer, durationMs: 12000, isAborted: false, turnId, reason: 'answer', usage: { ...USAGE, model: 'claude-opus-5-5' }, ...(agentId === undefined ? {} : { agentId }) })

  await $.prompt.submit({ text: '/obsidian-cli', command: { name: 'obsidian-cli', args: '' } } as never)
  await $.turn.start({ text: '每日回顾的随机漫步加个时间筛选', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: '/vault/plugin/main.ts', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Skill', skill: 'obsidian-cli' } as never)
  await $.tool.call({ tool: 'mcp__claude_ai_Linear__save_issue', title: 'x' } as never)
  await complete('t1', '加好了，第 4 档你没说是什么')
  await clock.settle()

  await $.turn.start({ text: '博客部署挂了，帮我看看', turnId: 't2' })
  await $.turn.start({ text: '查 Hexo 文档', turnId: 'sub1', agentId: 'ag1' })
  await complete('sub1', 'Hexo 会忽略下划线开头的目录', 'ag1')
  await complete('t2', '修好了')
  await clock.settle()

  await $.turn.start({ text: '第 4 档就 3 个月吧', turnId: 't3' })
  await complete('t3', '加上了')
  await clock.settle()
}

test('三轮对话：视图、子任务、技术信息、待办消解、导出（SVG 版）', async ($, on) => {
  const copied: string[] = []
  const clock = engine(on, copied)
  await play($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text })) !== undefined

  await ui.press({ key: 'view-all' })
  expect(await has(/给随机漫步加时间筛选/)).toBe(true)
  // 光标默认停在最新一行 b2 上，b2 不折；挪到 b1、过了自动折叠的延迟，整棵都做完的 b2 折起来，子任务看不到；光标回到 b2 上就不折
  expect(await has(/查 Hexo 文档/)).toBe(true)
  await ui.press({ key: 'block-b1' })
  await clock.advance(3000)
  expect(await has(/查 Hexo 文档/)).toBe(false)
  await ui.press({ key: 'block-b2' })
  expect(await has(/\[子任务\]/)).toBe(true)
  expect(await has(/查 Hexo 文档/)).toBe(true)
  expect(await has(/^Done$/)).toBe(true)

  // 我让它做的：每件事带上我的原话、做了几件、结论
  await ui.press({ key: 'view-asks' })
  expect(await has(/每日回顾的随机漫步加个时间筛选/)).toBe(true)
  expect(await has(/做了 1 件/)).toBe(true)
  expect(await has(/默认全部/)).toBe(true)

  // 需要我做的：第 4 档那一条单独一行，第 3 轮解决了，是 Done
  await ui.press({ key: 'view-me' })
  expect(await has(/^确认第 4 档是什么$/)).toBe(true)
  expect(await has(/修 Hexo 部署/)).toBe(false)

  // 我让它做的：不含子任务
  await ui.press({ key: 'view-asks' })
  expect(await has(/修 Hexo 部署/)).toBe(true)
  expect(await has(/查 Hexo 文档/)).toBe(false)

  // 它已做的：子任务的结论也在
  await ui.press({ key: 'view-done' })
  expect(await has(/改了 _config.yml/)).toBe(true)
  expect(await has(/下划线开头/)).toBe(true)

  // 技术信息：一行里几段「图标 字」，不记内置工具
  await ui.press({ key: 'view-tech' })
  expect(await has(/^90%$/)).toBe(true)
  expect(await has(/^opus-5-5$/)).toBe(true)
  expect(await has(/^obsidian-cli$/)).toBe(true)
  expect(await has(/^Linear\/save_issue$/)).toBe(true)
  expect(await has(/^×1$/)).toBe(true)
  expect(await has(/^\/obsidian-cli$/)).toBe(true)
  expect(await has(/^Edit$/)).toBe(false)
  expect(await has(/^合计$/)).toBe(true)

  // 导出：不用图标字体，换个地方打开也看得懂
  await act(ui, 'export')
  expect(copied.at(-1)).toContain('# 会话大纲：技术信息')
  expect(copied.at(-1)).toContain('缓存命中率 90%')
  await ui.press({ key: 'view-me' })
  await act(ui, 'export')
  expect(copied.at(-1)).toContain('Done 确认第 4 档是什么')

  // 缩进、折叠
  await ui.press({ key: 'view-all' })
  await ui.press({ key: 'block-b2' })
  await act(ui, 'indent')
  // 光标在子块 b2 上，T 折到母块 b1，光标跟到 b1；b1 是顶层，再按就是开合它自己
  await act(ui, 'fold-up')
  expect(await has(/修 Hexo 部署/)).toBe(false)
  await act(ui, 'fold-up')
  expect(await has(/修 Hexo 部署/)).toBe(true)
  await ui.unmount()
})

test('「需要我做」的每一条能单独改状态', async ($, on) => {
  const clock = engine(on, [])
  await play($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text })) !== undefined
  await ui.press({ key: 'view-me' })
  expect(await has(/^Done$/)).toBe(true)
  // 点只挪光标，点几下状态都不变
  await ui.press({ key: 'block-b1#0' })
  await ui.press({ key: 'block-b1#0' })
  expect(await has(/^Done$/)).toBe(true)
  // S 切状态：Done → Todo（照 todoseq 的流转）
  await act(ui, 'status')
  expect(await has(/^Todo$/)).toBe(true)
  // 角标跟着这一条走（并在视图名后面，按钮里的字只用一种样式）
  expect(await has(/^需要我做的 1$/)).toBe(true)
  // 块本身的状态没动
  await ui.press({ key: 'view-all' })
  expect(await has(/^Done$/)).toBe(true)
  await ui.unmount()
})

test('侧栏里改的状态，下一条消息带给 Claude', async ($, on) => {
  const clock = engine(on, [])
  await play($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'view-me' })
  // Done → Todo → Doing → Done：改回原样不用说
  await ui.press({ key: 'block-b1#0' })
  for (let i = 0; i < 3; i++) await act(ui, 'status')
  await $.prompt.submit({ text: '继续' } as never)
  expect(contexts.at(-1)?.join('')).not.toContain('侧栏')
  await act(ui, 'status')
  await $.prompt.submit({ text: '继续' } as never)
  expect(contexts.at(-1)?.join('')).toContain('「确认第 4 档是什么」')
  expect(contexts.at(-1)?.join('')).toContain('DONE → TODO')
  // 说过一次就清掉
  await $.prompt.submit({ text: '再继续' } as never)
  expect(contexts.at(-1)).toEqual([])
  await ui.unmount()
})

test('数字键对应的视图可以自定义', { options: { views: 'tech,all' } }, async ($, on) => {
  const clock = engine(on, [])
  await play($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ key: 'view-tech' })).toBeDefined()
  await ui.unmount()
})

test('--resume 后从存档恢复大纲（旧状态词换成新的）', async ($, on) => {
  mock.clock(on)
  mock.store(on, {
    'session:sess-1': { blocks: [{ id: 'b1', turn: 1, ask: '', title: '上次聊的旧话题', status: 'CANCELED', did: [], conclusion: '', questions: [], needsMe: [], parent: null, isManual: false, isStatusManual: false, isPending: false, files: [], commands: 0 }] },
  })
  on('command.register', () => ({ value: { command: 'outline' } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'view-all' })
  expect(await ui.find({ type: 'Text', text: /上次聊的旧话题/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Cancelled$/ })).toBeDefined()
  await ui.unmount()
})

test('终端里的树：Logseq 式按键，⌘/ 切状态', async ($, on) => {
  const clock = engine(on, [])
  await play($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text, in: 'tree' })) !== undefined

  await ui.press({ key: 'view-all' })
  expect(await has(/给随机漫步加时间筛选/)).toBe(true)
  // 不再有 Org 式的 [x] 记号
  expect(await has(/\[x\]|\[ \]/)).toBe(false)

  // 先 ⏎ 进入视图，光标挪到第一块；选中 b2，⌥→ 缩进到 b1 下；光标回 b1，Ctrl+↑ 折叠
  await ui.key({ key: 'return', in: 'tree' })
  await startAtFirst(ui, clock)
  for (let i = 0; i < 2; i++) await ui.key({ key: 'down', in: 'tree' })
  await ui.key({ key: 'right', meta: true, in: 'tree' })
  for (let i = 0; i < 4; i++) await ui.key({ key: 'up', in: 'tree' })
  await ui.key({ key: 'up', ctrl: true, in: 'tree' })
  expect(await has(/修 Hexo 部署/)).toBe(false)
  await ui.key({ key: 'down', ctrl: true, in: 'tree' })
  expect(await has(/修 Hexo 部署/)).toBe(true)

  // ⇧1 只看第 1 层，⇧2 展开到第 2 层（终端打出 ! @，或者报成数字带 shift；中文输入法下是全角的）
  await ui.key({ key: '!', in: 'tree' })
  expect(await has(/修 Hexo 部署/)).toBe(false)
  await ui.key({ key: '@', in: 'tree' })
  expect(await has(/修 Hexo 部署/)).toBe(true)
  await ui.key({ key: '1', shift: true, in: 'tree' })
  expect(await has(/修 Hexo 部署/)).toBe(false)
  await ui.key({ key: '＠', in: 'tree' })
  expect(await has(/修 Hexo 部署/)).toBe(true)
  // ⌥ 的写法也认（终端把 ⌥ 报成 meta，或者打出 ¡ ™）
  await ui.key({ key: '1', meta: true, in: 'tree' })
  expect(await has(/修 Hexo 部署/)).toBe(false)
  await ui.key({ key: '™', in: 'tree' })
  expect(await has(/修 Hexo 部署/)).toBe(true)
  await ui.key({ key: '¡', in: 'tree' })
  expect(await has(/修 Hexo 部署/)).toBe(false)
  // E 展开光标所在块的子块，光标跟到子块上；T 再折回母块
  await ui.key({ key: 'e', in: 'tree' })
  expect(await has(/修 Hexo 部署/)).toBe(true)
  await ui.key({ key: 't', in: 'tree' })
  expect(await has(/修 Hexo 部署/)).toBe(false)
  await ui.key({ key: 'e', in: 'tree' })

  // ⌘/（终端报成 meta）：Done → Todo → Doing
  await ui.key({ key: '/', meta: true, in: 'tree' })
  expect(await has(/Todo/)).toBe(true)
  await ui.key({ key: '/', ctrl: true, in: 'tree' })
  expect(await has(/Doing/)).toBe(true)

  // ⇧ 加首字母直接标负面状态：终端报成大写字母，或者小写带 shift
  await ui.key({ key: 'F', shift: true, in: 'tree' })
  expect(await has(/Failed/)).toBe(true)
  await ui.key({ key: 'c', shift: true, in: 'tree' })
  expect(await has(/Cancelled/)).toBe(true)
  await ui.key({ key: 'U', in: 'tree' })
  expect(await has(/Unclear\?/)).toBe(true)

  // 数字键切视图：需要我做的
  await ui.key({ key: '1', in: 'tree' })
  expect(await has(/^确认第 4 档是什么$/)).toBe(true)
  await ui.unmount()
})

test('视图栏和树分两层：数字选视图、⏎ 进入、⌫ 回视图栏', async ($, on) => {
  const clock = engine(on, [])
  await play($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text, in: 'tree' })) !== undefined
  // 一开始在视图栏：数字和 ←→ 换视图，⌘/ 这类树里的键碰不到块
  await ui.key({ key: '5', in: 'tree' })
  await ui.key({ key: 'left', in: 'tree' })
  await ui.key({ key: 'right', in: 'tree' })
  expect(await has(/给随机漫步加时间筛选/)).toBe(true)
  await ui.key({ key: '/', meta: true, in: 'tree' })
  expect(await has(/Todo/)).toBe(false)
  // ⏎ 进入：光标落在这个视图的第一行，树里的键才生效
  await ui.key({ key: 'return', in: 'tree' })
  await ui.key({ key: '/', meta: true, in: 'tree' })
  expect(await has(/Todo/)).toBe(true)
  // 在树里直接按数字也能换视图
  await ui.key({ key: '1', in: 'tree' })
  expect(await has(/^确认第 4 档是什么$/)).toBe(true)
  // ⌫ 回视图栏，树里的键又碰不到了
  await ui.key({ key: 'backspace', in: 'tree' })
  await ui.key({ key: '5', in: 'tree' })
  await ui.key({ key: '/', meta: true, in: 'tree' })
  expect(await has(/Doing/)).toBe(false)
  await ui.unmount()
})

test('终端里视图栏、工具栏都是按钮：侧栏有键盘、树没有时，数字和 J / K / E 这些字母也有按钮接住，不会掉回对话框', async ($, on) => {
  const clock = engine(on, [])
  await play($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (const key of ['view-all', 'down', 'up', 'unfold-down', 'fold-up']) expect(await ui.press({ key })).toBeDefined()
  await ui.unmount()
})
test('Agenda：汇总所有会话里需要我做的事', async ($, on) => {
  const clock = engine(on, [], {
    'session:old': { cwd: '/Users/me/blog', savedAt: 1, blocks: [{ id: 'b1', kind: 'turn', turn: 1, ask: '', title: '换博客主题', status: 'NEEDOK', did: [], conclusion: '', questions: [], needsMe: ['挑一个配色'], parent: null, isManual: false, isStatusManual: false, isPending: false, files: [], commands: 0 }] },
  })
  await play($, clock)
  await $.command.run({ command: 'agenda', args: '' } as never)
  const ui = await $.ui.mount({ ...PANE, requestId: 'agenda', props: { ...PANE.props, title: 'Agenda' }, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /换博客主题/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /挑一个配色/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /NeedOK\?/ })).toBeDefined()
  await ui.press({ key: 'ag-old-b1' })
  expect(await ui.find({ type: 'Text', text: /换博客主题/ })).toBeUndefined()
  await ui.unmount()
})

test('回顾：接住 Claude Code 自带的 recap，也能按 r 生成大纲回顾', async ($, on) => {
  const clock = engine(on, [])
  await play($, clock)

  await $.session.append({ door: 'notice', origin: { kind: 'engine' }, message: { type: 'system', name: 'away_summary', content: [{ type: 'text', text: '做完了三件事，下一步等你确认。 (disable recaps in /config)' }] } } as never)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text })) !== undefined
  expect(await has(/^Claude Code/)).toBe(true)
  expect(await has(/做完了三件事，下一步等你确认。$/)).toBe(true)

  await act(ui, 'recap')
  expect(await has(/^大纲/)).toBe(true)
  expect(await has(/第 4 档定为 3 个月/)).toBe(true)

  // 回顾也进了大纲，问题与结论视图里能看到
  await ui.press({ key: 'view-conclusions' })
  expect(await has(/\[回顾\]/)).toBe(true)
  await ui.unmount()
})

test('进行中的一轮：实时显示跑了多久、改了几个文件，按 p 刷新出小结，结束后转成普通块', async ($, on) => {
  const clock = engine(on, [])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: '博客部署挂了，帮我看看', turnId: 't1' })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text })) !== undefined
  await ui.press({ key: 'view-all' })
  expect(await has(/博客部署挂了，帮我看看/)).toBe(true)
  expect(await has(/^Doing$/)).toBe(true)

  await $.tool.call({ tool: 'Read', file_path: '/blog/_config.yml' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/blog/_config.yml', old_string: 'a', new_string: 'b' } as never)
  await clock.advance(1500)
  expect(await has(/^1 个文件$/)).toBe(true)
  expect(await has(/^改 _config.yml$/)).toBe(true)

  // 一轮还没结束，手动刷新
  await act(ui, 'progress')
  expect(await has(/^正在改配置/)).toBe(true)
  expect(await has(/^找到了出错的目录$/)).toBe(true)

  await $.turn.complete({ answer: '修好了', durationMs: 5000, isAborted: false, turnId: 't1', reason: 'answer', usage: { ...USAGE, model: 'claude-opus-5-5' } })
  await clock.settle()
  expect(await has(/^正在改配置/)).toBe(false)
  expect(await has(/给随机漫步加时间筛选/)).toBe(true) // 第一条正式总结
  await ui.unmount()
})

test('中文输入法下也能用：回车弹菜单改状态，空格展开详情', async ($, on) => {
  const clock = engine(on, [])
  await play($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text, in: 'tree' })) !== undefined
  await ui.press({ key: 'view-all' })

  // ↓ 进入视图，选中第一块，空格展开详情
  await ui.key({ key: 'down', in: 'tree' })
  await startAtFirst(ui, clock)
  expect(await has(/默认全部/)).toBe(false)
  await ui.key({ key: ' ', in: 'tree' })
  expect(await has(/默认全部/)).toBe(true)

  // 回车弹菜单，往下选到 Failed，回车（详情之后是各个状态，Failed 排第 19 项）
  await ui.key({ key: 'return', in: 'tree' })
  expect(await has(/^详情$/)).toBe(true)
  for (let i = 0; i < 19; i++) await ui.key({ key: 'down', in: 'tree' })
  await ui.key({ key: 'return', in: 'tree' })
  expect(await has(/^详情$/)).toBe(false)
  expect(await has(/Failed/)).toBe(true)
  await ui.unmount()
})

test('按格子宽度折行：中文随处可断，英文单词不拆', async () => {
  // 一长串中文不会整段挪到下一行，每行都尽量占满
  expect(wrapCells('确认 J、K 上下移动仍可用，仅删除了工具栏按钮', 20)).toEqual(['确认 J、K 上下移动仍', '可用，仅删除了工具栏', '按钮'])
  // 英文单词整个挪到下一行
  expect(wrapCells('运行 /reload-plugins 使改动生效', 16)).toEqual(['运行', '/reload-plugins', '使改动生效'])
  expect(wrapCells('短', 20)).toEqual(['短'])
})

/** 一轮待验收的活：改了一个文件、跑了两条命令（一条报错），三条「做了」里一条没证据 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reviewTurn = async ($: any, on: On) => {
  const reply = {
    title: '把测试修好', status: 'TOREVIEW', conclusion: '', questions: [], needsMe: [], parent: null, resolved: [],
    // 编号 9 对不上任何证据，要丢掉
    did: [{ text: '改了大纲', evidence: [1] }, { text: '跑通了测试', evidence: [2, 9] }, { text: '顺手优化了性能', evidence: [] }],
  }
  const clock = engine(on, [], {}, [reply])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: '把测试修好', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: '/x/outline.ts', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Bash', command: 'claude plugin test .' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm run fail' } as never)
  await $.turn.complete({ answer: '修好了', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', usage: { ...USAGE, model: 'claude-opus-5-5' } })
  await clock.settle()
  return clock
}

test('「做了」挂证据；ToReview 先看证据才能改成 Done；⇧S 在负面状态之间转；技术信息视图里的验收指标', async ($, on) => {
  await reviewTurn($, on)

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text })) !== undefined
  await ui.press({ key: 'view-done' })
  expect(await has(/改 outline\.ts/)).toBe(true)
  expect(await has(/✓ claude plugin test \. → 13 pass/)).toBe(true)
  expect(await has(/顺手优化了性能（无证据）/)).toBe(true)
  // 没被哪条「做了」引用的证据不画
  expect(await has(/npm run fail/)).toBe(false)

  // 验收关口：光标已经在 b1 上、详情没展开。第一下只展开证据，第二下才改成 Done
  await ui.press({ key: 'view-all' })
  expect(await has(/跑通了测试/)).toBe(false)
  await act(ui, 'status')
  expect(await has(/^ToReview$/)).toBe(true)
  expect(await has(/跑通了测试/)).toBe(true)
  await act(ui, 'status')
  expect(await has(/^Done$/)).toBe(true)
  // 下一条消息告诉 Claude：看过证据才验收，哪几条没证据
  await $.prompt.submit({ text: '继续' } as never)
  expect(contexts.at(-1)?.join('')).toContain('用户看过证据后验收；其中这几条没有工具调用能证明：顺手优化了性能')

  // 负面状态循环，从轻到重：Rework → Unclear? → Failed → Errored → Hit Limit! → Suspended → Cancelled
  await act(ui, 'status-bad')
  expect(await has(/^Rework$/)).toBe(true)
  await act(ui, 'status-bad')
  expect(await has(/^Unclear\?$/)).toBe(true)
  await act(ui, 'status-bad')
  expect(await has(/^Failed$/)).toBe(true)

  // 指标：3 条「做了」2 条有证据；验收 1 块、没拦下；Done 之后重开了 1 块
  await ui.press({ key: 'view-tech' })
  expect(await has(/证据 2\/3 · 67%/)).toBe(true)
  expect(await has(/拦下 0\/1 · 0%/)).toBe(true)
  expect(await has(/重开 1\/1 · 100%/)).toBe(true)
  await ui.unmount()
})

test('验收没通过：停手 4 秒后交给 Claude，按最终状态说清返工还是追问；改回 Done 就不发', async ($, on) => {
  const clock = await reviewTurn($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text })) !== undefined
  await ui.press({ key: 'view-all' })
  const sent = prompts.length

  // ToReview → Rework → Unclear?：连按的时候不发，停手 4 秒后按最终的 Unclear? 发一条
  await act(ui, 'status-bad')
  await clock.advance(2000)
  await act(ui, 'status-bad')
  expect(await has(/^Unclear\?$/)).toBe(true)
  await clock.advance(3000)
  expect(prompts.length).toBe(sent)
  await clock.advance(2000)
  expect(prompts.length).toBe(sent + 1)
  expect(prompts.at(-1)).toContain('没让下面这些事通过')
  expect(prompts.at(-1)).toContain('「把测试修好」：Unclear?。我没看懂你做了什么')
  expect(prompts.at(-1)).not.toContain('Rework')
  // 状态改动本身也作为结构化信息接在这条消息后面
  expect(prompts.at(-1)).toContain('TOREVIEW → UNCLEAR')

  // 又改回 Done：看最终状态，不发
  await act(ui, 'status')
  await clock.advance(5000)
  expect(prompts.length).toBe(sent + 1)
  await ui.unmount()
})

test('一次打回好几件：消息里让 Claude 把互不相干的交给子代理并行做；只打回一件就不提', async ($, on) => {
  const reply = (title: string) => ({ title, status: 'TOREVIEW', did: [], conclusion: '', questions: [], needsMe: [], parent: null, resolved: [] })
  const clock = engine(on, [], {}, [reply('修登录页'), reply('改导出格式')])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const [turnId, text] of [['t1', '修登录页'], ['t2', '改导出格式']] as const) {
    await $.turn.start({ text, turnId })
    await $.turn.complete({ answer: '好了', durationMs: 1000, isAborted: false, turnId, reason: 'answer', usage: { ...USAGE, model: 'claude-opus-5-5' } })
    await clock.settle()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'view-all' })
  const sent = prompts.length

  // 两块都打回成 Rework → Unclear? → Failed
  for (const key of ['block-b1', 'block-b2']) {
    await ui.press({ key })
    for (let i = 0; i < 3; i++) await act(ui, 'status-bad')
  }
  await clock.advance(5000)
  expect(prompts.length).toBe(sent + 1)
  expect(prompts.at(-1)).toContain('「修登录页」：Failed')
  expect(prompts.at(-1)).toContain('「改导出格式」：Failed')
  expect(prompts.at(-1)).toContain('开子代理（Agent 工具）并行处理')

  // 只打回一件：不提子代理
  await ui.press({ key: 'block-b1' })
  await act(ui, 'status')
  await act(ui, 'status')
  await act(ui, 'status')
  await clock.advance(5000)
  await ui.unmount()
})

test('Errored、Hit Limit! 由 mod 标：一轮因 API 出错结束就是 Errored，回答里说撞了用量上限就是 Hit Limit!', async ($, on) => {
  // 模型说这两轮都做完了，但引擎说是出错结束的，以引擎为准
  const reply = (title: string) => ({ title, status: 'DONE', did: [], conclusion: '', questions: [], needsMe: [], parent: null, resolved: [] })
  const clock = engine(on, [], {}, [reply('修登录页'), reply('改导出格式')])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const [turnId, text, answer] of [['t1', '修登录页', 'API Error: 500 Internal server error'], ['t2', '改导出格式', 'API Error: Rate limit reached']] as const) {
    await $.turn.start({ text, turnId })
    await $.turn.complete({ answer, durationMs: 1000, isAborted: false, turnId, reason: 'error' } as never)
    await clock.settle()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text })) !== undefined
  await ui.press({ key: 'view-all' })
  expect(await has(/^Errored$/)).toBe(true)
  expect(await has(/^Hit Limit!$/)).toBe(true)
  expect(await has(/^Done$/)).toBe(false)
  await ui.unmount()
})

test('存档超过上限时删最久没保存的会话，不按写入顺序删：一直在用的老会话 resume 回来大纲还在', async ($, on) => {
  // 101 个旧会话，每个留一件没办完的事：第一个写入的 old0 最近才保存过，old1、old2 最久没动（模拟时钟从 0 开始，旧的都记在 0 之前）
  const block = (title: string) => ({ id: 'b1', kind: 'turn', turn: 1, ask: '', title, status: 'NEEDOK', did: [], conclusion: '', questions: [], needsMe: ['确认'], parent: null, isManual: false, isStatusManual: false, isPending: false, files: [], commands: 0 })
  const stored: Record<string, unknown> = {}
  for (let i = 0; i <= 100; i++) stored[`session:old${i}`] = { blocks: [block(`会话old${i}`)], cwd: '/', savedAt: i === 0 ? 9_000_000 : i - 1000 }
  const clock = engine(on, [], stored, REPLIES())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: '随便做点什么', turnId: 't1' })
  await $.turn.complete({ answer: '好了', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', usage: { ...USAGE, model: 'claude-opus-5-5' } })
  await clock.settle()

  // 当前会话存进去以后一共 102 个，删掉最久没保存的两个；Agenda 读的就是这些存档
  await $.command.run({ command: 'agenda', args: '' } as never)
  const ui = await $.ui.mount({ ...PANE, requestId: 'agenda', props: { ...PANE.props, title: 'Agenda' }, surface: 'terminal' })
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text })) !== undefined
  expect(await has(/^会话old0$/)).toBe(true)
  expect(await has(/^会话old3$/)).toBe(true)
  expect(await has(/^会话old1$/)).toBe(false)
  expect(await has(/^会话old2$/)).toBe(false)
  await ui.unmount()
})

test('「需要我做」的事用 Y / N / D 回复：Yes、No 停手 4 秒后作为回答发给 Claude，Done 不发', async ($, on) => {
  const clock = engine(on, [])
  await play($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text })) !== undefined
  await ui.press({ key: 'view-me' })
  await ui.press({ key: 'block-b1#0' })
  const sent = prompts.length

  await ui.press({ key: 'yes' })
  expect(await has(/^Yes$/)).toBe(true)
  await clock.advance(5000)
  expect(prompts.length).toBe(sent + 1)
  expect(prompts.at(-1)).toContain('我在大纲侧栏里回答了你问的这些事')
  expect(prompts.at(-1)).toContain('「确认第 4 档是什么」（块 [b1]「给随机漫步加时间筛选」）：Yes。我的回答是「是」')

  await ui.press({ key: 'no' })
  expect(await has(/^No$/)).toBe(true)
  await clock.advance(5000)
  expect(prompts.at(-1)).toContain('：No。我的回答是「否」')

  // Done 只在下一条消息里附带，不单独发
  await ui.press({ key: 'done' })
  expect(await has(/^Done$/)).toBe(true)
  await clock.advance(5000)
  expect(prompts.length).toBe(sent + 2)
  await ui.unmount()
})

test('引导线不断：标题和字段折成几行时，每一行左边都接着画竖线', async ($, on) => {
  const long = '这是一段很长的结论，'.repeat(8)
  const reply = (title: string, parent: string | null, conclusion: string) => ({ title, status: 'DONE', did: [], conclusion, questions: [], needsMe: [], parent, resolved: [] })
  const clock = engine(on, [], {}, [reply('一个标题也很长很长很长很长很长很长很长很长很长很长很长很长的母块', null, long), reply('子块', 'b1', '短')])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const turnId of ['t1', 't2']) {
    await $.turn.start({ text: '做点事', turnId })
    await $.turn.complete({ answer: '好了', durationMs: 1000, isAborted: false, turnId, reason: 'answer', usage: { ...USAGE, model: 'claude-opus-5-5' } })
    await clock.settle()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'view-conclusions' })
  // 母块有子块，它的标题续行、结论的每一行前面都是「│」加空格；结论折成好几行，竖线就有好几段
  const guides = await ui.findAll({ type: 'Text', text: /^│ +$/, in: 'tree' })
  expect(guides.length).toBeGreaterThanOrEqual(4)
  await ui.unmount()
})

test('层级「去掉 Done」：Done 的块藏起来，下面还有没做完的子块就变暗留着当上下文', async ($, on) => {
  const reply = (title: string, status: string, parent: string | null) => ({ title, status, did: [], conclusion: '', questions: [], needsMe: [], parent, resolved: [] })
  const clock = engine(on, [], {}, [reply('做完的母块', 'DONE', null), reply('还在做的子块', 'DOING', 'b1'), reply('做完的另一块', 'DONE', null), reply('不做了的块', 'CANCELLED', null)])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const turnId of ['t1', 't2', 't3', 't4']) {
    await $.turn.start({ text: '做点事', turnId })
    await $.turn.complete({ answer: '好了', durationMs: 1000, isAborted: false, turnId, reason: 'answer', usage: { ...USAGE, model: 'claude-opus-5-5' } })
    await clock.settle()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text })) !== undefined
  await ui.press({ key: 'view-all' })
  expect(await has(/做完的另一块/)).toBe(true)
  // 默认是「全部标题」，O 两下：全部展开 → 去掉 Done
  await act(ui, 'level')
  await act(ui, 'level')
  expect(await has(/做完的另一块/)).toBe(false)
  expect(await has(/不做了的块/)).toBe(false)
  expect(await has(/还在做的子块/)).toBe(true)
  expect(await has(/做完的母块/)).toBe(true)
  // 再按一下回到「只看顶层」，Done 的块又出来了
  await act(ui, 'level')
  expect(await has(/做完的另一块/)).toBe(true)
  await ui.unmount()
})

test('层级「去掉 Done」也藏起「需要我做」里答过 Yes / No、做完或取消的条目', async ($, on) => {
  const reply = { title: '等我拍板', status: 'WAITING', did: [], conclusion: '', questions: [], needsMe: ['问题甲', '问题乙'], parent: null, resolved: [] }
  const clock = engine(on, [], {}, [reply])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: '做点事', turnId: 't1' })
  await $.turn.complete({ answer: '好了', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', usage: { ...USAGE, model: 'claude-opus-5-5' } })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text })) !== undefined
  await ui.press({ key: 'view-me' })
  await ui.press({ key: 'block-b1#0' })
  await ui.press({ key: 'yes' })
  await act(ui, 'level')
  await act(ui, 'level')
  expect(await has(/^问题甲$/)).toBe(false)
  expect(await has(/^问题乙$/)).toBe(true)
  await ui.unmount()
})

test('待验收的块上按 Y 就是验收通过：同样要先看证据，算放行，不额外发消息', async ($, on) => {
  const clock = await reviewTurn($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text })) !== undefined
  await ui.press({ key: 'view-all' })
  const sent = prompts.length
  // 第一下只展开证据，第二下才通过，变成 Done 而不是 Yes
  await ui.press({ key: 'yes' })
  expect(await has(/^ToReview$/)).toBe(true)
  await ui.press({ key: 'yes' })
  expect(await has(/^Done$/)).toBe(true)
  expect(await has(/^Yes$/)).toBe(false)
  await clock.advance(5000)
  expect(prompts.length).toBe(sent)
  await ui.press({ key: 'view-tech' })
  expect(await has(/拦下 0\/1 · 0%/)).toBe(true)
  await ui.unmount()
})

test('「需要我做」里交给我做的事答 Yes 不单独发；问我的问题才马上发，并让 Claude 不用做事时只回一句', async ($, on) => {
  const reply = { title: '等我', status: 'WAITING', did: [], conclusion: '', questions: [], needsMe: ['重开终端看效果', '要我接着加吗？'], asks: [1], parent: null, resolved: [] }
  const clock = engine(on, [], {}, [reply])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: '做点事', turnId: 't1' })
  await $.turn.complete({ answer: '好了', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', usage: { ...USAGE, model: 'claude-opus-5-5' } })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'view-me' })
  const sent = prompts.length

  // 交给我做的事：答 Yes 只记下，等下一条消息
  await ui.press({ key: 'block-b1#0' })
  await ui.press({ key: 'yes' })
  await clock.advance(5000)
  expect(prompts.length).toBe(sent)

  // 问我的问题：马上发
  await ui.press({ key: 'block-b1#1' })
  await ui.press({ key: 'yes' })
  await clock.advance(5000)
  expect(prompts.length).toBe(sent + 1)
  expect(prompts.at(-1)).toContain('「要我接着加吗？」')
  expect(prompts.at(-1)).toContain('回一句「收到」就行')
  // 前面那条交给我做的事，作为状态改动一起带上
  expect(prompts.at(-1)).toContain('「重开终端看效果」')
  await ui.unmount()
})

test('自动折叠：整棵都了结的块，光标离开 3 秒后折起来；手动打开过的不再自动折；结论视图不折', async ($, on) => {
  const reply = (title: string, status: string, parent: string | null) => ({ title, status, did: [], conclusion: `${title}的结论`, questions: [], needsMe: [], parent, resolved: [] })
  const clock = engine(on, [], {}, [reply('母块', 'DONE', null), reply('子块', 'DOING', 'b1'), reply('别的事', 'DOING', null)])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const turnId of ['t1', 't2', 't3']) {
    await $.turn.start({ text: '做点事', turnId })
    await $.turn.complete({ answer: '好了', durationMs: 1000, isAborted: false, turnId, reason: 'answer', usage: { ...USAGE, model: 'claude-opus-5-5' } })
    await clock.settle()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text })) !== undefined
  await ui.press({ key: 'view-all' })

  // 把最后一个没做完的子块标成 Done：光标还在它上面，先不折
  await ui.press({ key: 'block-b2' })
  await ui.press({ key: 'done' })
  expect(await has(/^子块$/)).toBe(true)
  // 光标挪开：3 秒缓冲期里还在，过了才折
  await ui.press({ key: 'block-b3' })
  await clock.advance(2000)
  expect(await has(/^子块$/)).toBe(true)
  await clock.advance(2000)
  expect(await has(/^子块$/)).toBe(false)
  expect(await has(/^母块$/)).toBe(true)

  // 结论视图不自动折：做完的事本来就是要看的
  await ui.press({ key: 'view-conclusions' })
  expect(await has(/^子块$/)).toBe(true)

  // 手动打开过的，光标走开也不再自动折
  await ui.press({ key: 'view-all' })
  await ui.press({ key: 'block-b1' })
  await act(ui, 'unfold-down')
  expect(await has(/^子块$/)).toBe(true)
  await ui.press({ key: 'block-b3' })
  await clock.advance(5000)
  expect(await has(/^子块$/)).toBe(true)
  await ui.unmount()
})

test('窗口按行截、滚轮按行翻：底下不空一截，↑ ↓ 数的是行；滚过以后光标一动再拉回来', async ($, on) => {
  const reply = (n: number) => ({ title: `第 ${n} 件事`, status: 'DOING', did: [], conclusion: '', questions: [], needsMe: [], parent: null, resolved: [] })
  const clock = engine(on, [], {}, Array.from({ length: 12 }, (_, i) => reply(i + 1)))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (let i = 1; i <= 12; i++) {
    await $.turn.start({ text: '做点事', turnId: `t${i}` })
    await $.turn.complete({ answer: '好了', durationMs: 1000, isAborted: false, turnId: `t${i}`, reason: 'answer', usage: { ...USAGE, model: 'claude-opus-5-5' } })
    await clock.settle()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, scroll: { offset: 0, bodyRows: 18 } } })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern, in: 'tree' }))?.text
  await ui.press({ key: 'view-all' })
  await startAtFirst(ui, clock)
  // 光标在第 1 件事上，窗口从头开始；底下还有几行，数的是行不是块
  expect(await text(/↑/)).toBeUndefined()
  const below = Number((await text(/↓ \d+ 行/))?.match(/\d+/)?.[0])
  expect(below).toBeGreaterThan(12)

  // 人滚一格滚轮：往下翻 3 行
  const wheel = (by: number) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ($ as any).ui.scroll({ component: 'Pane', requestId: 'outline', offset: 0, by, bodyRows: 18, contentRows: 18, origin: { kind: 'person' }, pointer: { column: 1, row: 5 } })
  await wheel(1)
  expect(await text(/↑ \d+ 行/)).toContain('↑ 3 行')
  await wheel(2)
  expect(await text(/↑ \d+ 行/)).toContain('↑ 9 行')
  // 光标一动，窗口拉回光标所在的块：光标到第 2 件事，窗口从它开始，上面只剩第 1 件事和一行空行
  await ui.key({ key: 'down', in: 'tree' })
  expect(await text(/↑ \d+ 行/)).toContain('↑ 2 行')
  await ui.unmount()
})

test('切视图：光标停在最新一行，切过去也落在那个视图的最新一行、放到窗口中间；自己挪过光标的，切走再切回来还在原处', async ($, on) => {
  const reply = (n: number) => ({ title: `第 ${n} 件事`, status: 'DOING', did: [], conclusion: '', questions: [], needsMe: [], parent: null, resolved: [] })
  const clock = engine(on, [], {}, Array.from({ length: 12 }, (_, i) => reply(i + 1)))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (let i = 1; i <= 12; i++) {
    await $.turn.start({ text: '做点事', turnId: `t${i}` })
    await $.turn.complete({ answer: '好了', durationMs: 1000, isAborted: false, turnId: `t${i}`, reason: 'answer', usage: { ...USAGE, model: 'claude-opus-5-5' } })
    await clock.settle()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, scroll: { offset: 0, bodyRows: 18 } } })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern, in: 'tree' }))?.text
  const above = async () => Number((await text(/↑ \d+ 行/))?.match(/\d+/)?.[0] ?? 0)
  // 光标那一行的箭头是反色的，找它所在的标题
  const at = async () => {
    const texts = (await ui.findAll({ type: 'Text', in: 'tree' })) as { text?: string; props?: { inverse?: boolean } }[]
    const i = texts.findIndex(t => t.props?.inverse === true)
    return texts.slice(i).find(t => /第 \d+ 件事/.test(t.text ?? ''))?.text
  }

  // 一打开：光标默认在最新一行，放到窗口中间，下面空着，没有「↓ 还有几行」
  await ui.press({ key: 'view-all' })
  await ui.key({ key: 'return', in: 'tree' })
  expect(await at()).toBe('第 12 件事')
  expect(await text(/↓/)).toBeUndefined()
  const centered = await above()
  expect(centered).toBeGreaterThan(0)
  // 光标一动就不再居中，窗口贴回列表末尾，上面露出来的比居中时多
  await ui.key({ key: 'up', in: 'tree' })
  expect(await above()).toBeLessThan(centered)

  // 光标回到最新一行再切视图：落在那个视图的最新一行，又放到中间
  await ui.key({ key: 'down', in: 'tree' })
  await ui.press({ key: 'view-asks' })
  expect(await at()).toBe('第 12 件事')
  expect(await text(/↓/)).toBeUndefined()

  // 自己把光标挪到第 3 件事：切走再切回来，光标还在第 3 件事
  await ui.post({ type: 'click', id: 'b3' }, { in: 'tree' })
  await ui.press({ key: 'view-all' })
  expect(await at()).toBe('第 3 件事')
  await ui.press({ key: 'view-asks' })
  expect(await at()).toBe('第 3 件事')
  await ui.unmount()
})

test('「需要我做」的事按条自动了结：我说的直接 Done，Claude 说替我办了的改成 ToReview，都带「自动」；- 跳过', async ($, on) => {
  const replies = [
    { title: '等我两件事', status: 'WAITING', did: [], conclusion: '', questions: [], needsMe: ['重开终端', '挑一个配色', '看一眼日志'], parent: null, resolved: [] },
    // 下一轮：我说重开过了；Claude 说配色它替我挑了；日志没提
    { title: '接着做', status: 'DONE', did: [], conclusion: '', questions: [], needsMe: [], parent: null, resolved: [{ key: 'b1#0', by: 'user' }, { key: 'b1#1', by: 'claude' }] },
  ]
  const clock = engine(on, [], {}, replies)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const turnId of ['t1', 't2']) {
    await $.turn.start({ text: '重开过了', turnId })
    await $.turn.complete({ answer: '好了', durationMs: 1000, isAborted: false, turnId, reason: 'answer', usage: { ...USAGE, model: 'claude-opus-5-5' } })
    await clock.settle()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const row = async (text: string) => (await ui.findAll({ type: 'Text', in: 'tree' })).map(f => (f as { text?: string }).text ?? '').join('|')
  await ui.press({ key: 'view-me' })
  const shown = await row('')
  // 按条：一件 Done、一件 ToReview、一件还是 Todo；块还在等我，不跟着 Done
  expect(shown).toContain('Done|  |[自动] |重开终端')
  expect(shown).toContain('ToReview|  |[自动] |挑一个配色')
  expect(shown).toContain('Todo|  |看一眼日志')
  expect(shown).toContain('Waiting')

  // - 跳过剩下那件：光标挪到它上面
  for (let i = 0; i < 4; i++) await ui.key({ key: 'down', in: 'tree' })
  await ui.key({ key: '-', in: 'tree' })
  expect(await row('')).toContain('Skip|  |看一眼日志')
  await ui.unmount()
})

test('手动把「需要我做」的最后一条标完，在等我的块跟着 Done；待验收的块不跟着变', async ($, on) => {
  const reply = (title: string, status: string) => ({ title, status, did: [], conclusion: '', questions: [], needsMe: ['甲', '乙'], parent: null, resolved: [] })
  const clock = engine(on, [], {}, [reply('等我两件事', 'WAITING'), reply('等我验收', 'TOREVIEW')])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const turnId of ['t1', 't2']) {
    await $.turn.start({ text: '做点事', turnId })
    await $.turn.complete({ answer: '好了', durationMs: 1000, isAborted: false, turnId, reason: 'answer', usage: { ...USAGE, model: 'claude-opus-5-5' } })
    await clock.settle()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text })) !== undefined
  await ui.press({ key: 'view-me' })
  for (const key of ['block-b1#0', 'block-b2#0']) {
    await ui.press({ key })
    await ui.press({ key: 'done' })
  }
  expect(await has(/^Waiting$/)).toBe(true)
  for (const key of ['block-b1#1', 'block-b2#1']) {
    await ui.press({ key })
    await ui.press({ key: 'done' })
  }
  expect(await has(/^Waiting$/)).toBe(false)
  expect(await has(/^ToReview$/)).toBe(true)
  await ui.unmount()
})

test('会话的名字画在大纲最上面当标题：顶格、加粗；改名了跟着变', async ($, on) => {
  const clock = engine(on, [])
  // 引擎这一侧：没有设置里的 hook，什么都不拦
  on('classic.UserPromptSubmit', () => ({}))
  await play($, clock)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const classic = ($ as any).classic
  await classic.UserPromptSubmit({ prompt: '继续', session_title: '整理大纲侧栏' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const first = async () => (await ui.findAll({ type: 'Text' }))[0]
  expect((await first())?.text).toBe('整理大纲侧栏')
  expect((await first())?.props).toMatchObject({ bold: true })
  await classic.UserPromptSubmit({ prompt: '再继续', session_title: '修审核报告' })
  expect((await first())?.text).toBe('修审核报告')
  await ui.unmount()
})

test('多选：⇧↓ 拉出一段，改状态一起改；不按 ⇧ 直接走就取消', async ($, on) => {
  const clock = engine(on, [])
  await play($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const row = async () => (await ui.findAll({ type: 'Text', in: 'tree' })).map(f => (f as { text?: string }).text ?? '').join('|')
  const count = (text: string, word: string) => text.split(word).length - 1
  await ui.press({ key: 'view-all' })
  await ui.key({ key: 'return', in: 'tree' })
  const before = count(await row(), 'Cancelled')
  await ui.key({ key: 'down', shift: true, in: 'tree' })
  expect(await row()).toContain('已选 2 行')
  // ⇧C 直接标 Cancelled：两行都改
  await ui.key({ key: 'C', in: 'tree' })
  expect(count(await row(), 'Cancelled')).toBe(before + 2)
  // 两处改动下一条消息都告诉 Claude
  await $.prompt.submit({ text: '接着来' } as never)
  expect((contexts.at(-1) ?? []).join('\n').split('→ CANCELLED').length - 1).toBe(2)
  // 不按 ⇧ 往下走：选区没了，再改只改光标这一行
  await ui.key({ key: 'down', in: 'tree' })
  expect(await row()).not.toContain('已选')
  await ui.unmount()
})

test('搜索：按 / 露出搜索框，边打边过滤，祖先留着当上下文；清空后回车收起', async ($, on) => {
  const clock = engine(on, [])
  await play($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text, in: 'tree' })) !== undefined
  await ui.press({ key: 'view-all' })
  await ui.key({ key: 'return', in: 'tree' })
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  await ui.key({ key: '/', in: 'tree' })
  expect(await ui.find({ type: 'Input' })).toBeDefined()
  // 子任务「查 Hexo 文档」命中，它的母块「修 Hexo 部署」也命中；第 1 轮那棵整个不露
  await ui.input({ key: 'search', text: 'hexo' })
  expect(await has(/查 Hexo 文档/)).toBe(true)
  expect(await has(/修 Hexo 部署/)).toBe(true)
  expect(await has(/给随机漫步加时间筛选/)).toBe(false)
  expect(await ui.find({ type: 'Text', text: /命中 2 块/ })).toBeDefined()
  // 搜原话、做了、结论也算：「3 个月」只在第 3 轮的做了里
  await ui.input({ key: 'search', text: '3 个月档' })
  expect(await has(/第 4 档定为 3 个月/)).toBe(true)
  expect(await has(/给随机漫步加时间筛选/)).toBe(true)
  expect(await has(/修 Hexo 部署/)).toBe(false)
  // 清空后回车：搜索框收起，全部回来
  await ui.input({ key: 'search', text: '', kind: 'submit' })
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  expect(await has(/修 Hexo 部署/)).toBe(true)
  // Q 也能打开（工具栏上画成「q: 搜索」，不和 i: 图例 挤在一起）
  await ui.key({ key: 'q', in: 'tree' })
  expect(await ui.find({ type: 'Input' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: '搜索' })).toBeDefined()
  await ui.unmount()
})

/** 跑 n 轮，每轮的总结按 statuses 给状态 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const playTurns = async ($: any, clock: { settle: () => Promise<void> }, statuses: string[]) => {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const [i, status] of statuses.entries()) {
    const turnId = `t${i + 1}`
    await $.turn.start({ text: `第 ${i + 1} 件事`, turnId })
    await $.turn.complete({ answer: '好', durationMs: 1000, isAborted: false, turnId, reason: 'answer', usage: { ...USAGE, model: 'claude-opus-5-5' } })
    await clock.settle()
  }
}
const STALE_REPLIES = (statuses: string[]) => statuses.map((status, i) => ({ title: `第 ${i + 1} 件事`, status, did: [], conclusion: '', questions: [], needsMe: [], parent: null, resolved: [] }))
// 第 1 轮待验收（不算），2～6 轮 Todo，后面都 Done：最新是第 16 轮，隔 10 轮以上还开着的正好 5 块
const STALE_STATUSES = ['TOREVIEW', 'TODO', 'TODO', 'TODO', 'TODO', 'TODO', ...Array(10).fill('DONE')]

test('长期没动的块攒到 5 块，提示一键 Done；待验收的不算，一起改的状态告诉 Claude', async ($, on) => {
  const clock = engine(on, [], {}, STALE_REPLIES(STALE_STATUSES))
  await playTurns($, clock, STALE_STATUSES)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /5 块隔了 10 轮以上还开着/ })).toBeDefined()
  await ui.press({ key: 'stale-done' })
  expect(await ui.find({ type: 'Text', text: /隔了 10 轮以上/ })).toBeUndefined()
  await ui.press({ key: 'view-all' })
  await startAtFirst(ui, clock)
  const shown = (await ui.findAll({ type: 'Text', in: 'tree' })).map(f => (f as { text?: string }).text ?? '').join('|')
  expect(shown).toContain('ToReview')
  expect(shown).not.toContain('Todo')
  await $.prompt.submit({ text: '接着来' } as never)
  expect((contexts.at(-1) ?? []).join('\n').split('TODO → DONE').length - 1).toBe(5)
  await ui.unmount()
})

test('长期没动的提示点「不用」就不再为这几块提示', async ($, on) => {
  const clock = engine(on, [], {}, STALE_REPLIES(STALE_STATUSES))
  await playTurns($, clock, STALE_STATUSES)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'stale-skip' })
  expect(await ui.find({ type: 'Text', text: /隔了 10 轮以上/ })).toBeUndefined()
  await ui.press({ key: 'view-all' })
  await startAtFirst(ui, clock)
  expect((await ui.findAll({ type: 'Text', in: 'tree' })).map(f => (f as { text?: string }).text ?? '').join('|')).toContain('Todo')
  await ui.unmount()
})

/** 带消息 id 的存档块（测试里没有真实的消息行） */
const savedBlock = (id: string, parent: string | null, extra: Record<string, unknown> = {}) => ({
  id, kind: 'turn', turn: Number(id.replace(/\D/g, '')), ask: '', title: `块 ${id}`, status: 'DONE', did: [], conclusion: '', questions: [], needsMe: [],
  parent, isManual: false, isStatusManual: false, isPending: false, files: [], commands: 0, messageId: `m-${id}`, answerId: `a-${id}`, ...extra,
})

test('G 跳到原文：块跳到我那条消息，「需要我做」的条目跳到那一轮的回答；子任务跳到它那一轮', async () => {
  const list = [savedBlock('b1', null, { needsMe: ['确认配色'] }), { ...savedBlock('b1.1', 'b1'), kind: 'agent' }, { ...savedBlock('b2', null), answerId: undefined, needsMe: ['看日志'] }] as never[]
  expect(jumpTarget(list, 'b1')).toBe('m-b1')
  expect(jumpTarget(list, 'b1#0')).toBe('a-b1')
  expect(jumpTarget(list, 'b1.1')).toBe('m-b1')
  // 旧存档没有回答的 id：照旧跳到我那条消息
  expect(jumpTarget(list, 'b2#0')).toBe('m-b2')
})

/** b1～b4 连着 4 块了结，b5 还没做完隔开，b6、b7 只连着 2 块，b8 是最新那块 */
const RUN_BLOCKS = () => [
  ...['b1', 'b2', 'b3', 'b4'].map(id => savedBlock(id, null)),
  savedBlock('b5', null, { status: 'TODO' }),
  ...['b6', 'b7', 'b8'].map(id => savedBlock(id, null)),
]

test('大纲上半截连着 3 块以上整棵都了结的顶层块折成一行「…」；最新那块总留着；→ 展开，光标落在这一串的第一块', async ($, on) => {
  engine(on, [], { 'session:sess-1': { blocks: RUN_BLOCKS() } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const shown = async () => (await ui.findAll({ type: 'Text', in: 'tree' })).map(f => (f as { text?: string }).text ?? '').join('|')
  // 光标那一行的箭头是反色的，找它所在的标题
  const at = async () => {
    const texts = (await ui.findAll({ type: 'Text', in: 'tree' })) as { text?: string; props?: { inverse?: boolean } }[]
    const i = texts.findIndex(t => t.props?.inverse === true)
    return texts.slice(i).find(t => /块 b\d|已了结/.test(t.text ?? ''))?.text
  }

  await ui.press({ key: 'view-all' })
  let text = await shown()
  expect(text).toContain('已了结 4 块')
  expect(text).not.toContain('块 b2')
  for (const id of ['b5', 'b6', 'b7', 'b8']) expect(text).toContain(`块 ${id}`)

  // 光标默认在最新一行 b8；往上走四行到「…」，按 → 展开
  await ui.key({ key: 'return', in: 'tree' })
  for (let i = 0; i < 4; i++) await ui.key({ key: 'up', in: 'tree' })
  expect(await at()).toContain('已了结 4 块')
  await ui.key({ key: 'right', in: 'tree' })
  text = await shown()
  expect(text).not.toContain('已了结')
  for (const id of ['b1', 'b2', 'b3', 'b4']) expect(text).toContain(`块 ${id}`)
  expect(await at()).toBe('块 b1')
  // 展开过的这一串，光标走开以后也不再折
  await ui.post({ type: 'click', id: 'b8' }, { in: 'tree' })
  expect(await shown()).not.toContain('已了结')
  await ui.unmount()
})

test('桌面版：「…」那一行点「展开」就展开', async ($, on) => {
  engine(on, [], { 'session:sess-1': { blocks: RUN_BLOCKS() } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text })) !== undefined
  await ui.press({ key: 'view-all' })
  expect(await has(/已了结 4 块/)).toBe(true)
  expect(await has(/块 b2/)).toBe(false)
  await ui.press({ key: 'more-more:b1' })
  expect(await has(/已了结/)).toBe(false)
  expect(await has(/块 b2/)).toBe(true)
  await ui.unmount()
})

test('] / [：光标在同级的块之间走，这一层走完到上一层的下一块；条目和更深的子块跳过', async ($, on) => {
  const clock = engine(on, [], { 'session:sess-1': { blocks: [savedBlock('b1', null), savedBlock('b2', 'b1'), savedBlock('b3', 'b2'), savedBlock('b4', 'b1'), savedBlock('b5', null)] } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // 光标那一行的箭头是反色的，找它所在的标题
  const at = async () => {
    const texts = (await ui.findAll({ type: 'Text', in: 'tree' })) as { text?: string; props?: { inverse?: boolean } }[]
    const i = texts.findIndex(t => t.props?.inverse === true)
    return texts.slice(i).find(t => /块 b\d/.test(t.text ?? ''))?.text
  }
  await ui.press({ key: 'view-all' })
  await ui.key({ key: 'return', in: 'tree' })
  await startAtFirst(ui, clock)
  await ui.key({ key: 'down', in: 'tree' })
  expect(await at()).toBe('块 b2')
  await ui.key({ key: ']', in: 'tree' })
  expect(await at()).toBe('块 b4')
  await ui.key({ key: '】', in: 'tree' })
  expect(await at()).toBe('块 b5')
  await ui.key({ key: '[', in: 'tree' })
  expect(await at()).toBe('块 b1')
  await ui.unmount()
})

test('桌面版：一长串中文的标题在字之间插零宽空格才折得了行；终端和别的界面不插', async ($, on) => {
  const title = '说明假设的博客换主题方案，并提出两个待确认问题'
  engine(on, [], { 'session:sess-1': { blocks: [{ ...savedBlock('b1', null), title }] } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await desk.press({ key: 'view-all' })
  expect(await desk.find({ type: 'Text', text: title.split('').join('\u200b') })).toBeDefined()
  await desk.unmount()
  const code = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await code.find({ type: 'Text', text: title })).toBeDefined()
  await code.unmount()
})

test('问题与结论：我问的问题拿问句当标题，下面跟着结论；只有结论的块照旧；旧块按原话的问号猜', async ($, on) => {
  const reply = (title: string, userQuestion: string, conclusion: string) => ({ title, status: 'DONE', did: [], userQuestion, conclusion, questions: [], needsMe: [], parent: null, resolved: [] })
  const clock = engine(on, [], {}, [
    reply('解释缓存为什么没命中', '缓存为什么没命中？', '系统提示词每轮都变'),
    reply('修 Hexo 部署', '', '下划线开头的目录被忽略'),
    reply('改按钮颜色', '', ''),
  ])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const [turnId, text] of [['t1', '缓存怎么老是不命中啊'], ['t2', '博客部署挂了'], ['t3', '按钮换成蓝色']] as const) {
    await $.turn.start({ text, turnId })
    await $.turn.complete({ answer: '好了', durationMs: 1000, isAborted: false, turnId, reason: 'answer', usage: { ...USAGE, model: 'claude-opus-5-5' } })
    await clock.settle()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text, in: 'tree' })) !== undefined
  // 数字键顺序：1 需要我做的、2 问题与结论、3 我让它做的、4 它已做的、5 全部、6 技术信息
  await ui.key({ key: '2', in: 'tree' })
  expect(await has(/缓存为什么没命中？/)).toBe(true)
  expect(await has(/解释缓存为什么没命中/)).toBe(false)
  expect(await has(/系统提示词每轮都变/)).toBe(true)
  expect(await has(/修 Hexo 部署/)).toBe(true)
  expect(await has(/改按钮颜色/)).toBe(false)
  // 别的视图还是用原来的标题
  await ui.key({ key: '5', in: 'tree' })
  expect(await has(/解释缓存为什么没命中/)).toBe(true)
  expect(await has(/改按钮颜色/)).toBe(true)
  await ui.unmount()
})

test('问题与结论：加问句字段之前总结的块，原话以问号结尾的算问题', async ($, on) => {
  mock.clock(on)
  const old = { kind: 'turn', turn: 1, status: 'DONE', did: [], conclusion: '', questions: [], needsMe: [], parent: null, isManual: false, isStatusManual: false, isPending: false, files: [], commands: 0 }
  mock.store(on, {
    'session:sess-1': {
      blocks: [
        { ...old, id: 'b1', ask: '这个按键为什么没反应？', title: '查按键没反应的原因' },
        { ...old, id: 'b2', turn: 2, ask: '把按键改成 F', title: '改按键' },
      ],
    },
  })
  on('command.register', () => ({ value: { command: 'outline' } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text })) !== undefined
  await ui.press({ key: 'view-conclusions' })
  expect(await has(/^这个按键为什么没反应？$/)).toBe(true)
  expect(await has(/改按键/)).toBe(false)
  await ui.unmount()
})

test('回复：A 在还没了结的条目上露出回复框，回车把回复连同是哪一件发给 Claude；已了结的不弹框，空着回车不发', async ($, on) => {
  const reply = { title: '给随机漫步加时间筛选', status: 'WAITING', did: [], conclusion: '', questions: [], needsMe: ['确认第 4 档是什么'], asks: [0], parent: null, resolved: [] }
  const clock = engine(on, [], {}, [reply])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: '加个时间筛选', turnId: 't1' })
  await $.turn.complete({ answer: '加好了', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', usage: { ...USAGE, model: 'claude-opus-5-5' } })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // 1 号视图「需要我做的」，进树，光标默认在最新一行，也就是那一条
  await ui.key({ key: '1', in: 'tree' })
  await ui.key({ key: 'return', in: 'tree' })
  await ui.key({ key: 'a', in: 'tree' })
  expect(await ui.find({ key: 'reply-box' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^回复 「确认第 4 档是什么」/ })).toBeDefined()
  const sent = prompts.length
  await ui.input({ key: 'reply-box', text: '就 3 个月吧' })
  expect(prompts.length).toBe(sent + 1)
  expect(prompts.at(-1)).toContain('我在大纲侧栏里回复了这件事')
  expect(prompts.at(-1)).toContain('「确认第 4 档是什么」（块 [b1]「给随机漫步加时间筛选」）：就 3 个月吧')
  expect(await ui.find({ key: 'reply-box' })).toBeUndefined()

  // 空着回车：收起，不发
  await ui.key({ key: 'a', in: 'tree' })
  await ui.input({ key: 'reply-box', text: '  ' })
  expect(prompts.length).toBe(sent + 1)
  expect(await ui.find({ key: 'reply-box' })).toBeUndefined()

  // 标成 Done 以后再按 A：不弹回复框
  await ui.key({ key: 'd', in: 'tree' })
  await ui.key({ key: 'a', in: 'tree' })
  expect(await ui.find({ key: 'reply-box' })).toBeUndefined()
  await ui.unmount()
})

/** 三轮：第 2 轮在等我，其余做完了 */
const RULER_REPLIES = () => [
  { title: '修 Hexo 部署', status: 'DONE', did: [], conclusion: '', questions: [], needsMe: [], parent: null, resolved: [] },
  { title: '给随机漫步加时间筛选', status: 'WAITING', did: [], conclusion: '', questions: [], needsMe: ['确认第 4 档是什么'], asks: [0], parent: null, resolved: [] },
  { title: '改按钮颜色', status: 'DONE', did: [], conclusion: '', questions: [], needsMe: [], parent: null, resolved: [] },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const playThree = async ($: any, clock: { settle: () => Promise<void> }) => {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const turnId of ['t1', 't2', 't3']) {
    await $.turn.start({ text: '做点事', turnId })
    await $.turn.complete({ answer: '好了', durationMs: 1000, isAborted: false, turnId, reason: 'answer', usage: { ...USAGE, model: 'claude-opus-5-5' } })
    await clock.settle()
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ruler = async (ui: any) => ((await ui.findAll({ type: 'Text', in: 'ruler' })) as { text?: string }[]).map(t => t.text ?? '')

test('刻度尺：一轮一格，等我的高、了结的矮、光标那一轮满格；点一格光标跳过去，当前视图里没有就换到「全部」', async ($, on) => {
  const clock = engine(on, [], {}, RULER_REPLIES())
  await playThree($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // 1 号视图「需要我做的」：光标默认在最新一行，是第 2 轮的那一条
  await ui.key({ key: '1', in: 'tree' })
  expect(await ruler(ui)).toEqual(['▁', '█', '▁'])
  // 点第 3 格：第 3 轮不在「需要我做的」里，换到「全部」，光标落在它上面
  await ui.pointer({ type: 'down', x: 2, y: 0, button: 'left', in: 'ruler' })
  expect(await ruler(ui)).toEqual(['▁', '▅', '█'])
  const texts = (await ui.findAll({ type: 'Text', in: 'tree' })) as { text?: string; props?: { inverse?: boolean } }[]
  const i = texts.findIndex(t => t.props?.inverse === true)
  expect(texts.slice(i).find(t => /改按钮颜色/.test(t.text ?? ''))).toBeDefined()
  // 终端不跟着鼠标鼓起来，也没有标题那一行
  await ui.pointer({ type: 'move', x: 0, y: 0, in: 'ruler' })
  expect(await ruler(ui)).toEqual(['▁', '▅', '█'])
  await ui.unmount()
})

test('刻度尺（桌面版）：鼠标扫过时那一格和邻居鼓起来，下面显示它的标题；移开就回去', async ($, on) => {
  const clock = engine(on, [], {}, RULER_REPLIES())
  await playThree($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'view-all' })
  // 光标默认在最新一行（第 3 轮）；没悬停时下面那行是光标那一轮的标题
  expect(await ruler(ui)).toEqual(['▁', '▅', '█', '#3 改按钮颜色'])
  await ui.pointer({ type: 'move', x: 0, y: 0, in: 'ruler' })
  expect(await ruler(ui)).toEqual(['▄', '▇', '█', '#1 修 Hexo 部署'])
  await ui.pointer({ type: 'leave', x: 0, y: 0, in: 'ruler' })
  expect(await ruler(ui)).toEqual(['▁', '▅', '█', '#3 改按钮颜色'])
  await ui.unmount()
})

test('刻度尺：轮数比面板宽时几轮并一格，挑等我的那轮代表', () => {
  const block = (turn: number, status: string, needsMe: string[] = []) =>
    ({ id: `b${turn}`, kind: 'turn', turn, ask: '', title: `第 ${turn} 轮`, status, did: [], conclusion: '', questions: [], needsMe, parent: null, isManual: false, isStatusManual: false, isPending: false, files: [], commands: 0 }) as never
  const list = [block(1, 'DONE'), block(2, 'WAITING', ['确认']), block(3, 'DONE'), block(4, 'DONE')]
  const ticks = rulerTicks(list, 'b4', 2)
  expect(ticks.map(t => [t.id, t.turns, t.height])).toEqual([['b2', '#1–#2', 4], ['b4', '#3–#4', 7]])
})

test('层级不往下套：母块太深就往上提，最多 3 层；重新排版只认更早的一轮，手动改过的、子任务不动，模型漏掉的留在原处', () => {
  const list = [savedBlock('b1', null), savedBlock('b2', 'b1'), savedBlock('b3', 'b2'), savedBlock('b4', 'b3', { isManual: true }), { ...savedBlock('b4.1', 'b4'), kind: 'agent' }, savedBlock('b5', 'b4'), savedBlock('b6', 'b1')] as never[]
  expect(clampParent(list, 'b1')).toBe('b1')
  expect(clampParent(list, 'b2')).toBe('b2')
  // b3 已经在第 2 层，挂它下面会到第 3 层：提到它的母块 b2
  expect(clampParent(list, 'b3')).toBe('b2')
  expect(clampParent(list, 'b4')).toBe('b2')
  expect(clampParent(list, 'b9')).toBe(null)
  expect(clampParent(list, null)).toBe(null)

  const out = relayout(list, { b1: 'b6', b2: null, b3: 'b2', b4: null, 'b4.1': null, b5: 'b4' }) as unknown as { id: string; parent: string | null }[]
  const parentOf = (id: string) => out.find(b => b.id === id)?.parent
  // 挂到后面的一轮不认，放顶层
  expect(parentOf('b1')).toBe(null)
  expect(parentOf('b2')).toBe(null)
  expect(parentOf('b3')).toBe('b2')
  // 手动改过的、子任务不动
  expect(parentOf('b4')).toBe('b3')
  expect(parentOf('b4.1')).toBe('b4')
  // b4 在第 2 层，b5 提到第 1 层的 b3 下面
  expect(parentOf('b5')).toBe('b3')
  // 模型漏掉的留在原来的母块下面
  expect(parentOf('b6')).toBe('b1')
})

test('同一话题一轮套一轮时总结只挂到第 3 层；M 按话题重新排版，下一轮之前再按 M 撤销，新的一轮开始后 M 又是重新排版', async ($, on) => {
  const reply = (title: string, parent: string | null) => ({ title, status: 'TODO', did: [], conclusion: '', questions: [], needsMe: [], parent, resolved: [] })
  const layout = (parents: Record<string, string | null>) => ({ parents })
  const copied: string[] = []
  const clock = engine(on, copied, {}, [
    reply('第一轮', null),
    reply('第二轮', 'b1'),
    reply('第三轮', 'b2'),
    reply('第四轮', 'b3'),
    layout({ b1: null, b2: 'b1', b3: 'b1', b4: null }),
    layout({ b1: null, b2: 'b1', b3: 'b1', b4: null }),
    reply('第五轮', 'b4'),
    layout({ b1: null, b2: 'b1', b3: 'b2', b4: 'b3', b5: 'b4' }),
  ])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const run = async (turnId: string) => {
    await $.turn.start({ text: '接着做', turnId })
    await $.turn.complete({ answer: '好了', durationMs: 1000, isAborted: false, turnId, reason: 'answer', usage: { ...USAGE, model: 'claude-opus-5-5' } })
    await clock.settle()
  }
  for (const turnId of ['t1', 't2', 't3', 't4']) await run(turnId)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'view-all' })
  // 导出的 Markdown 按层级缩进，每层两格
  const depthOf = async (title: string) => {
    await act(ui, 'export')
    const line = copied.at(-1)!.split('\n').find(l => l.endsWith(title))!
    return (line.length - line.trimStart().length) / 2
  }
  // 第四轮想挂在第三轮（第 2 层）下面，提到第二轮下面
  expect(await depthOf('第三轮')).toBe(2)
  expect(await depthOf('第四轮')).toBe(2)

  await act(ui, 'relayout')
  await clock.settle()
  expect(await depthOf('第三轮')).toBe(1)
  expect(await depthOf('第四轮')).toBe(0)

  // 再按一次是撤销
  await act(ui, 'relayout')
  expect(await depthOf('第三轮')).toBe(2)
  expect(await depthOf('第四轮')).toBe(2)

  await act(ui, 'relayout')
  await clock.settle()
  expect(await depthOf('第四轮')).toBe(0)
  // 新的一轮开始以后不能撤销了，M 又是重新排版；模型排得太深照样往上提
  await run('t5')
  await act(ui, 'relayout')
  await clock.settle()
  for (const title of ['第三轮', '第四轮', '第五轮']) expect(await depthOf(title)).toBe(2)
  await ui.unmount()
})
