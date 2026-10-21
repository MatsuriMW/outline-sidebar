import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { wrapCells } from './outline'

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

const USAGE = { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 }

const REPLIES = () => [
  { title: '给随机漫步加时间筛选', status: 'WAITING', did: ['加了 7 天 / 1 个月 / 全部三档'], conclusion: '默认全部', questions: [], needsMe: ['确认第 4 档是什么'], asks: [0], parent: null, resolved: [] },
  { title: '修 Hexo 部署', status: 'DONE', did: ['改了 _config.yml'], conclusion: '', questions: [], needsMe: [], parent: null, resolved: [] },
  { title: '第 4 档定为 3 个月', status: 'DONE', did: ['加了 3 个月档'], conclusion: '', questions: [], needsMe: [], parent: 'b1', resolved: ['b1'] },
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
  await ui.press({ key: 'export' })
  expect(copied.at(-1)).toContain('# 会话大纲：技术信息')
  expect(copied.at(-1)).toContain('缓存命中率 90%')
  await ui.press({ key: 'view-me' })
  await ui.press({ key: 'export' })
  expect(copied.at(-1)).toContain('Done 确认第 4 档是什么')

  // 缩进、折叠
  await ui.press({ key: 'view-all' })
  await ui.press({ key: 'block-b2' })
  await ui.press({ key: 'indent' })
  // 光标在子块 b2 上，T 折到母块 b1，光标跟到 b1；b1 是顶层，再按就是开合它自己
  await ui.press({ key: 'fold-up' })
  expect(await has(/修 Hexo 部署/)).toBe(false)
  await ui.press({ key: 'fold-up' })
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
  await ui.press({ key: 'status' })
  expect(await has(/^Todo$/)).toBe(true)
  // 角标跟着这一条走
  expect(await has(/^ 1$/)).toBe(true)
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
  for (let i = 0; i < 3; i++) await ui.press({ key: 'status' })
  await $.prompt.submit({ text: '继续' } as never)
  expect(contexts.at(-1)?.join('')).not.toContain('侧栏')
  await ui.press({ key: 'status' })
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

  // 先 ⏎ 进入视图；选中 b2，⌥→ 缩进到 b1 下；光标回 b1，Ctrl+↑ 折叠
  await ui.key({ key: 'return', in: 'tree' })
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
  await ui.key({ key: '2', in: 'tree' })
  expect(await has(/^确认第 4 档是什么$/)).toBe(true)
  await ui.unmount()
})

test('视图栏和树分两层：数字选视图、⏎ 进入、⌫ 回视图栏', async ($, on) => {
  const clock = engine(on, [])
  await play($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const has = async (text: RegExp) => (await ui.find({ type: 'Text', text, in: 'tree' })) !== undefined
  // 一开始在视图栏：数字和 ←→ 换视图，⌘/ 这类树里的键碰不到块
  await ui.key({ key: '4', in: 'tree' })
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
  await ui.key({ key: '2', in: 'tree' })
  expect(await has(/^确认第 4 档是什么$/)).toBe(true)
  // ⌫ 回视图栏，树里的键又碰不到了
  await ui.key({ key: 'backspace', in: 'tree' })
  await ui.key({ key: '4', in: 'tree' })
  await ui.key({ key: '/', meta: true, in: 'tree' })
  expect(await has(/Doing/)).toBe(false)
  await ui.unmount()
})

test('正文折叠：消息改成一行摘要，这一轮的工具行藏起来', async ($, on) => {
  // 测试里没有真实的消息行，用一份带消息 id 的存档代替
  const saved = (id: string, title: string, messageId: string, rowIds: string[]) => ({
    id, kind: 'turn', turn: Number(id.slice(1)), ask: '', title, status: 'DONE', did: ['改了配置'], conclusion: '', questions: [], needsMe: [],
    parent: null, isManual: false, isStatusManual: false, isPending: false, files: [], commands: 0, messageId, rowIds,
  })
  engine(on, [], { 'session:sess-1': { blocks: [saved('b1', '修 Hexo 部署', 'm1', ['tool-1']), saved('b2', '换主题', 'm2', [])] } })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{String((e.props as { text?: string }).text ?? 'engine')}</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await pane.press({ key: 'view-all' })
  await pane.press({ key: 'block-b1' })
  await pane.press({ key: 'body' })
  await pane.unmount()

  const prompt = (requestId: string) =>
    $.ui.mount({ plugin: 'outline-sidebar', surface: 'terminal', component: 'UserMessage', requestId, props: { text: '原话', origin: { kind: 'composer' }, isExpanded: false } } as never)
  const folded = await prompt('m1')
  expect(await folded.find({ type: 'Text', text: /▸ Done  修 Hexo 部署/ })).toBeDefined()
  await folded.unmount()
  const other = await prompt('m2')
  expect(await other.find({ type: 'Text', text: /原话/ })).toBeDefined()
  await other.unmount()

  const tool = await $.ui.mount({ plugin: 'outline-sidebar', surface: 'terminal', component: 'ToolUse', requestId: 'tool-1', props: { isExpanded: false } } as never)
  expect(await tool.find({ type: 'Text', text: /engine/ })).toBeUndefined()
  await tool.unmount()
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

  await ui.press({ key: 'recap' })
  expect(await has(/^大纲/)).toBe(true)
  expect(await has(/第 4 档定为 3 个月/)).toBe(true)

  // 回顾也进了大纲，结论视图里能看到
  await ui.press({ key: 'view-conclusions' })
  expect(await has(/\[回顾\]/)).toBe(true)
  await ui.unmount()
})

test('进行中的一轮：实时步数，按 p 刷新出小结，结束后转成普通块', async ($, on) => {
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
  expect(await has(/^2$/)).toBe(true)
  expect(await has(/^改 _config.yml$/)).toBe(true)

  // 一轮还没结束，手动刷新
  await ui.press({ key: 'progress' })
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

  // 选中第一块，空格展开详情
  await ui.key({ key: 'down', in: 'tree' })
  expect(await has(/默认全部/)).toBe(false)
  await ui.key({ key: ' ', in: 'tree' })
  expect(await has(/默认全部/)).toBe(true)

  // 回车弹菜单，往下选到 Failed，回车（详情之后是各个状态，Failed 排第 18 项）
  await ui.key({ key: 'return', in: 'tree' })
  expect(await has(/^详情$/)).toBe(true)
  for (let i = 0; i < 18; i++) await ui.key({ key: 'down', in: 'tree' })
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
  await ui.press({ key: 'status' })
  expect(await has(/^ToReview$/)).toBe(true)
  expect(await has(/跑通了测试/)).toBe(true)
  await ui.press({ key: 'status' })
  expect(await has(/^Done$/)).toBe(true)
  // 下一条消息告诉 Claude：看过证据才验收，哪几条没证据
  await $.prompt.submit({ text: '继续' } as never)
  expect(contexts.at(-1)?.join('')).toContain('用户看过证据后验收；其中这几条没有工具调用能证明：顺手优化了性能')

  // 负面状态循环，从轻到重：Rework → Unclear? → Failed → Errored → Hit Limit! → Suspended → Cancelled
  await ui.press({ key: 'status-bad' })
  expect(await has(/^Rework$/)).toBe(true)
  await ui.press({ key: 'status-bad' })
  expect(await has(/^Unclear\?$/)).toBe(true)
  await ui.press({ key: 'status-bad' })
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
  await ui.press({ key: 'status-bad' })
  await clock.advance(2000)
  await ui.press({ key: 'status-bad' })
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
  await ui.press({ key: 'status' })
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
    for (let i = 0; i < 3; i++) await ui.press({ key: 'status-bad' })
  }
  await clock.advance(5000)
  expect(prompts.length).toBe(sent + 1)
  expect(prompts.at(-1)).toContain('「修登录页」：Failed')
  expect(prompts.at(-1)).toContain('「改导出格式」：Failed')
  expect(prompts.at(-1)).toContain('开子代理（Agent 工具）并行处理')

  // 只打回一件：不提子代理
  await ui.press({ key: 'block-b1' })
  await ui.press({ key: 'status' })
  await ui.press({ key: 'status' })
  await ui.press({ key: 'status' })
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
  await ui.press({ key: 'level' })
  await ui.press({ key: 'level' })
  expect(await has(/做完的另一块/)).toBe(false)
  expect(await has(/不做了的块/)).toBe(false)
  expect(await has(/还在做的子块/)).toBe(true)
  expect(await has(/做完的母块/)).toBe(true)
  // 再按一下回到「只看顶层」，Done 的块又出来了
  await ui.press({ key: 'level' })
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
  await ui.press({ key: 'level' })
  await ui.press({ key: 'level' })
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
