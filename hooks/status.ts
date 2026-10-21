import type { Status } from '../types'
import { LU, SPIN } from './icons'
import type { LucideIcon } from './icons'

/**
 * 任务状态照 Obsidian 里 todoseq 的配置来（关键词、分组、颜色、流转、图标）：
 * .obsidian/plugins/todoseq/data.json 和 styles.css 末尾「关键词按状态上色」「关键词图标」两节。
 * 图标是 Lucide（todoseq 照 lucide-animated 做的动效），颜色是那边压低饱和度的那套，按浅色底调的。
 */
export type StatusGroup = 'inactive' | 'active' | 'waiting' | 'completed'

export type StatusInfo = {
  /** 显示出来的词，首字母大写 */
  label: string
  color: string
  group: StatusGroup
  icon: LucideIcon
  /** 交给模型判断状态时的说明 */
  meaning: string
  /** 停下来等我处理的：算进「需要我做的」 */
  isForMe?: true
}

export const STATUS_INFO: Record<Status, StatusInfo> = {
  TODO: { label: 'Todo', color: '#5c86b4', group: 'inactive', icon: 'todo', meaning: '定下要做、还没开始' },
  TODOFORAI: { label: 'Todo4AI', color: '#5c86b4', group: 'inactive', icon: 'bot', meaning: '留给 AI 之后去做的事' },
  DOING: { label: 'Doing', color: '#c8635f', group: 'active', icon: 'doing', meaning: '还没做完，下一轮接着做' },
  TOREVIEW: { label: 'ToReview', color: '#b39a3e', group: 'inactive', icon: 'review', meaning: '做完了，等用户看一眼结果', isForMe: true },
  NEEDOK: { label: 'NeedOK?', color: '#bf7a45', group: 'inactive', icon: 'needok', meaning: '停在等用户批准、确认或选择上', isForMe: true },
  ERRORED: { label: 'Errored', color: '#93606b', group: 'inactive', icon: 'errored', meaning: '出错停下了，需要用户处理', isForMe: true },
  HITLIMIT: { label: 'Hit Limit!', color: '#8a5a8c', group: 'inactive', icon: 'hitlimit', meaning: '额度或用量上限到了，等重置' },
  QUEUED: { label: 'Queued', color: '#6f86a8', group: 'inactive', icon: 'queued', meaning: '排上队了，到点自己接着跑' },
  DELEGATED: { label: 'Delegated', color: '#5b9690', group: 'inactive', icon: 'delegated', meaning: '交给子代理或别的 Agent 在跑' },
  PAUSED: { label: 'Paused', color: '#b39a3e', group: 'inactive', icon: 'paused', meaning: '停在半路（被打断），之后再接着做' },
  WAITING: { label: 'Waiting', color: '#8f7fb6', group: 'waiting', icon: 'waiting', meaning: '在等用户或外部的东西', isForMe: true },
  SUSPENDED: { label: 'Suspended', color: '#a17f66', group: 'waiting', icon: 'suspended', meaning: '先搁置，暂时不做' },
  DONE: { label: 'Done', color: '#629c7f', group: 'completed', icon: 'done', meaning: '做完了' },
  FAILED: { label: 'Failed', color: '#93606b', group: 'completed', icon: 'failed', meaning: '做了但没成功' },
  CANCELLED: { label: 'Cancelled', color: '#a4a8ac', group: 'completed', icon: 'cancelled', meaning: '放弃了，不做了' },
}

export const STATUSES = Object.keys(STATUS_INFO) as Status[]

/** ⌘/ 循环：照 todoseq 的流转，TODO → DOING → DONE，别的（PAUSED、TOREVIEW、NEEDOK…）都回 DOING */
export const nextStatus = (st: Status): Status => {
  if (st === 'TODO') return 'DOING'
  if (st === 'DOING') return 'DONE'
  if (st === 'DONE' || st === 'FAILED' || st === 'CANCELLED') return 'TODO'
  return 'DOING'
}

export const isOpenStatus = (st: Status) => STATUS_INFO[st].group !== 'completed'

export const isForMe = (st: Status) => STATUS_INFO[st].isForMe === true

/** 状态和后面的字之间固定空两格，不按最长的状态词补齐 */
export const STATUS_GAP = '  '

/** 终端里的状态：Lucide 字 + 首字母大写的词；Doing 的图标按 frame 转 */
export const statusText = (st: Status, frame = 0) => {
  const info = STATUS_INFO[st]
  const glyph = st === 'DOING' ? (SPIN[frame % SPIN.length] ?? LU.doing) : LU[info.icon]
  return `${glyph} ${info.label}`
}

/** 旧版本存下的状态换成现在的写法 */
export const normalizeStatus = (st: string): Status => {
  const up = st.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (up === 'CANCELED') return 'CANCELLED'
  if (up === 'TODO4AI' || up === 'TODO2AI' || up === 'TODOTOAI') return 'TODOFORAI'
  if (up === 'NOW' || up === 'INPROGRESS') return 'DOING'
  if (up === 'LATER') return 'TODO'
  if (up === 'WAIT') return 'WAITING'
  return (STATUSES as string[]).includes(up) ? (up as Status) : 'DONE'
}

// ---------- 桌面版：todoseq 原样的 SVG 和动效 ----------

const P = (d: string, cls?: string) => `<path${cls ? ` class="${cls}"` : ''} d="${d}"${cls?.includes('draw') ? ' pathLength="1"' : ''}/>`

/** 照搬 todoseq main.js「关键词前面的动效小图标」里的 ICON */
const BODY: Record<LucideIcon, string> = {
  todo: ['M10.1 2.182a10 10 0 0 1 3.8 0', 'M17.609 3.721a10 10 0 0 1 2.69 2.7', 'M21.818 10.1a10 10 0 0 1 0 3.8', 'M20.279 17.609a10 10 0 0 1-2.7 2.69',
    'M13.9 21.818a10 10 0 0 1-3.8 0', 'M6.391 20.279a10 10 0 0 1-2.69-2.7', 'M2.182 13.9a10 10 0 0 1 0-3.8', 'M3.721 6.391a10 10 0 0 1 2.7-2.69']
    .map((d, i) => `<path class="seg" style="--i:${i}" d="${d}"/>`).join(''),
  bot: P('M12 8V4H8') + '<rect x="4" y="8" width="16" height="12" rx="2"/>' + P('M2 14h2') + P('M20 14h2') + '<g class="eyes"><line x1="15" x2="15" y1="13" y2="15"/><line x1="9" x2="9" y1="13" y2="15"/></g>',
  doing: P('M21 12a9 9 0 1 1-6.219-8.56', 'spin'),
  done: '<circle cx="12" cy="12" r="10"/>' + P('m9 12 2 2 4-4', 'draw'),
  paused: '<rect class="l" x="6" y="4" width="4" height="16" rx="1"/><rect class="r" x="14" y="4" width="4" height="16" rx="1"/>',
  waiting: '<g class="flip">' + P('M5 22h14') + P('M5 2h14') + P('M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22') + P('M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2') + '</g>',
  suspended: '<g class="wob">' + ['m10 20-1.25-2.5L6 18', 'M10 4 8.75 6.5 6 6', 'm14 20 1.25-2.5L18 18', 'm14 4 1.25 2.5L18 6', 'm17 21-3-6h-4', 'm17 3-3 6 1.5 3',
    'M2 12h6.5L10 9', 'm20 10-1.5 2 1.5 2', 'M22 12h-6.5L14 15', 'm4 10 1.5 2L4 14', 'm7 21 3-6-1.5-3', 'm7 3 3 6h4'].map(d => P(d)).join('') + '</g>',
  cancelled: '<circle class="draw" pathLength="1" cx="12" cy="12" r="10"/>' + P('m4.9 4.9 14.2 14.2', 'draw slash'),
  failed: P('M18 6 6 18', 'draw') + P('m6 6 12 12', 'draw late'),
  review: P('M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0', 'lid') + '<circle class="pupil" cx="12" cy="12" r="3"/>',
  needok: '<g class="wave">' + P('M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2') + P('M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2') + P('M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8') + P('M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15') + '</g>',
  errored: '<g class="shake">' + P('M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z') + '<line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></g>',
  hitlimit: P('m12 14 4-4', 'needle') + P('M3.34 19a10 10 0 1 1 17.32 0'),
  delegated: '<g class="fly">' + P('M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z') + P('m21.854 2.147-10.94 10.939') + '</g>',
  queued: '<g class="ring">' + P('M18 20.5L19.5 22') + P('M6 20.5L4.5 22') + P('M21 13C21 17.968 16.968 22 12 22C7.032 22 3 17.968 3 13C3 8.032 7.032 4 12 4C16.968 4 21 8.032 21 13Z') + P('M15.339 15.862L12.549 14.197C12.063 13.909 11.667 13.216 11.667 12.649V8.95898') + '</g>' +
    '<g class="bells">' + P('M18 2L21.747 5.31064') + P('M6 2L2.25304 5.31064') + '</g>',
}

/** 动效照 todoseq styles.css：Doing 一直转；Todo、Done 只在刚换成这个状态时播一次 */
const CSS = `svg *{transform-box:view-box;transform-origin:12px 12px}
.spin{animation:s .8s linear infinite}@keyframes s{to{transform:rotate(360deg)}}
.hitlimit .needle{transform:translate(.5px,3px) rotate(72deg)}
.fire .draw{stroke-dasharray:1;animation:d .4s ease-out both}.fire .draw.late{animation-delay:.2s}.fire .draw.slash{animation-delay:.5s}
@keyframes d{from{stroke-dashoffset:1;opacity:0}25%{opacity:1}to{stroke-dashoffset:0;opacity:1}}
.fire .seg{animation:f .3s ease-out both;animation-delay:calc((var(--i) + 1)*.1s)}@keyframes f{from{opacity:0}to{opacity:1}}`

/** 一个状态图标的 SVG；isFire 是这个状态刚换上去，播一次出场动效 */
export const statusSvg = (st: Status, isFire: boolean) => {
  const info = STATUS_INFO[st]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 26 26" fill="none" stroke="${info.color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="${info.icon}${isFire ? ' fire' : ''}"><style>${CSS}</style>${BODY[info.icon]}</svg>`
}

/** 状态刚换上去之后多久内算「刚换」，播出场动效（和 todoseq 一样 2.5 秒） */
export const FIRE_MS = 2500
