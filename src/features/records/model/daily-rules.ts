import {
  defaultDailyProgress,
  emptyDaily,
  type DailyGoalId,
  type DailyGoalSpec,
  type DailyProgress,
  type DailyState,
  type PinballDocument,
} from '@/shared/document'

export interface DailyGoalView {
  id: DailyGoalId
  label: string
  detail: string
  done: boolean
  progress: number
  target: number
}

interface GoalTemplate {
  id: DailyGoalId
  label: string
  unit: string
  targets: number[]
}

const GOAL_TEMPLATES: GoalTemplate[] = [
  { id: 'score', label: '当日累计得分', unit: '分', targets: [3000, 5000, 7000, 10000] },
  { id: 'bonus', label: '进入奖励', unit: '次', targets: [1, 2, 3] },
  { id: 'bank', label: '清空落靶', unit: '次', targets: [1, 2] },
  { id: 'clean', label: '无倾斜收台', unit: '次', targets: [1] },
]

const LEDGER_LIMIT = 31

function hashDay(day: string): number {
  let hash = 2166136261
  for (let index = 0; index < day.length; index += 1) {
    hash ^= day.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function localDayKey(now = new Date()): string {
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const date = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${date}`
}

/** 同一天永远得到同样的三项，换一天才会换题。 */
export function dailyGoalSpecs(day: string): DailyGoalSpec[] {
  const hash = hashDay(day)
  const pool = [...GOAL_TEMPLATES]
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = (hash >>> (index * 4)) % (index + 1)
    const held = pool[index]
    pool[index] = pool[swap]
    pool[swap] = held
  }
  return pool.slice(0, 3).map((template, index) => {
    const shift = 9 + index * 5
    return {
      id: template.id,
      target: template.targets[(hash >>> shift) % template.targets.length],
    }
  })
}

function progressFor(daily: DailyState, day: string): DailyProgress {
  const stored = daily.ledger[day]
  return stored ? { ...stored } : defaultDailyProgress()
}

export function mergeProgress(a: DailyProgress | undefined, b: DailyProgress | undefined): DailyProgress {
  return {
    score: Math.max(a?.score ?? 0, b?.score ?? 0),
    bonusEntries: Math.max(a?.bonusEntries ?? 0, b?.bonusEntries ?? 0),
    bankClears: Math.max(a?.bankClears ?? 0, b?.bankClears ?? 0),
    cleanFinishes: Math.max(a?.cleanFinishes ?? 0, b?.cleanFinishes ?? 0),
  }
}

function sameProgress(a: DailyProgress, b: DailyProgress): boolean {
  return a.score === b.score
    && a.bonusEntries === b.bonusEntries
    && a.bankClears === b.bankClears
    && a.cleanFinishes === b.cleanFinishes
}

function pruneLedger(daily: DailyState): void {
  const days = Object.keys(daily.ledger)
  if (days.length <= LEDGER_LIMIT) return
  days.sort()
  for (const day of days.slice(0, days.length - LEDGER_LIMIT)) {
    delete daily.ledger[day]
  }
}

/**
 * 让当日状态落到本地日期上。若同一天再次打开，取存档与当前进度里较高的那份，
 * 因此把时钟往回拨不会让当天进度倒退。正在进行的这一局保留开局那天，
 * 只有还没有开局的局面才会跟随当前日期。
 */
export function openDaily(doc: PinballDocument, now = new Date()): boolean {
  if (!doc.daily) doc.daily = emptyDaily()
  const daily = doc.daily
  let changed = false

  if (daily.day) {
    const archived = mergeProgress(daily.ledger[daily.day], daily.progress)
    if (!sameProgress(archived, daily.ledger[daily.day] ?? defaultDailyProgress())) {
      daily.ledger[daily.day] = archived
      changed = true
    }
  }

  const inRun = doc.run.launched && !doc.run.committed && doc.run.dailyDay !== ''
  const day = inRun ? doc.run.dailyDay : localDayKey(now)
  if (daily.day === day) {
    const merged = mergeProgress(daily.progress, daily.ledger[day])
    if (!sameProgress(merged, daily.progress)) {
      daily.progress = merged
      changed = true
    }
    daily.ledger[day] = { ...merged }
    if (daily.goals.length !== 3) {
      daily.goals = dailyGoalSpecs(day)
      changed = true
    }
    return changed
  }

  daily.day = day
  daily.goals = dailyGoalSpecs(day)
  daily.progress = progressFor(daily, day)
  daily.ledger[day] = { ...daily.progress }
  pruneLedger(daily)
  return true
}

/** 一局开始时把当日状态定下来，整局（包括跨过午夜之后）都算这一天。 */
export function pinDailyForRun(doc: PinballDocument, now = new Date()): void {
  openDaily(doc, now)
  const daily = doc.daily
  doc.run.dailyDay = daily.day
  doc.run.dailyScoreMark = daily.progress.score
  doc.run.dailyBonusMark = daily.progress.bonusEntries
  doc.run.dailyBankMark = daily.progress.bankClears
}

export function syncDaily(doc: PinballDocument): boolean {
  if (!doc.run.launched) return false
  if (!doc.run.dailyDay) pinDailyForRun(doc)

  const day = doc.run.dailyDay
  const current = day === doc.daily.day
  const base = current ? doc.daily.progress : progressFor(doc.daily, day)
  const next = mergeProgress(base, {
    score: doc.run.dailyScoreMark + doc.score,
    bonusEntries: doc.run.dailyBonusMark + doc.live.bonusEntries,
    bankClears: doc.run.dailyBankMark + doc.live.bankClears,
    cleanFinishes: base.cleanFinishes,
  })
  const ledgerChanged = !sameProgress(next, doc.daily.ledger[day] ?? defaultDailyProgress())
  if (ledgerChanged) doc.daily.ledger[day] = { ...next }
  const progressChanged = current && !sameProgress(next, doc.daily.progress)
  if (progressChanged) doc.daily.progress = next
  return ledgerChanged || progressChanged
}

export function creditDailyCleanFinish(doc: PinballDocument): boolean {
  const day = doc.run.dailyDay || doc.daily.day
  if (!day) return false
  const base = day === doc.daily.day ? doc.daily.progress : progressFor(doc.daily, day)
  const next = { ...base, cleanFinishes: base.cleanFinishes + 1 }
  if (day === doc.daily.day) doc.daily.progress = next
  doc.daily.ledger[day] = { ...next }
  return true
}

function valueOf(progress: DailyProgress, id: DailyGoalId): number {
  if (id === 'score') return progress.score
  if (id === 'bonus') return progress.bonusEntries
  if (id === 'bank') return progress.bankClears
  return progress.cleanFinishes
}

export function dailyGoalViews(doc: PinballDocument): DailyGoalView[] {
  const daily = doc.daily
  const specs = daily.goals.length === 3 ? daily.goals : dailyGoalSpecs(daily.day || localDayKey())
  return specs.map((spec) => {
    const template = GOAL_TEMPLATES.find((item) => item.id === spec.id)
    const value = valueOf(daily.progress, spec.id)
    return {
      id: spec.id,
      label: template?.label ?? spec.id,
      detail: `${value} / ${spec.target} ${template?.unit ?? ''}`.trim(),
      done: value >= spec.target,
      progress: value,
      target: spec.target,
    }
  })
}
