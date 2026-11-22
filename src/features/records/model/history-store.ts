import { STORAGE_KEY } from '@/shared/ids'
import {
  defaultCareer,
  defaultDailyProgress,
  emptyDaily,
  flashNote,
  type CareerState,
  type DailyGoalId,
  type DailyGoalSpec,
  type DailyProgress,
  type DailyState,
  type HistoryEntry,
  type PinballDocument,
} from '@/shared/document'
import type { KeptRecords } from '@/features/table'
import { latchCareer } from '@/features/records/model/challenge-rules'
import {
  creditDailyCleanFinish,
  dailyGoalSpecs,
  mergeProgress,
  syncDaily,
} from '@/features/records/model/daily-rules'

interface SaveBlob {
  version: number
  bestScore: number
  career: CareerState
  history: HistoryEntry[]
  daily: DailyState
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function parseCareer(value: unknown): CareerState {
  const career = defaultCareer()
  if (!value || typeof value !== 'object') return career
  const raw = value as Partial<CareerState>
  career.score10k = raw.score10k === true
  career.bonusOnce = raw.bonusOnce === true
  career.bankTwice = raw.bankTwice === true
  career.cleanFinish = raw.cleanFinish === true
  return career
}

const GOAL_IDS = new Set<DailyGoalId>(['score', 'bonus', 'bank', 'clean'])

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function parseProgress(value: unknown): DailyProgress {
  const progress = defaultDailyProgress()
  if (!value || typeof value !== 'object') return progress
  const raw = value as Partial<Record<keyof DailyProgress, unknown>>
  progress.score = count(raw.score)
  progress.bonusEntries = count(raw.bonusEntries)
  progress.bankClears = count(raw.bankClears)
  progress.cleanFinishes = count(raw.cleanFinishes)
  return progress
}

function parseGoals(value: unknown, day: string): DailyGoalSpec[] {
  if (!Array.isArray(value) || value.length !== 3) return day ? dailyGoalSpecs(day) : []
  const specs: DailyGoalSpec[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return day ? dailyGoalSpecs(day) : []
    const raw = item as Partial<DailyGoalSpec>
    if (typeof raw.id !== 'string' || !GOAL_IDS.has(raw.id as DailyGoalId)) return day ? dailyGoalSpecs(day) : []
    const target = count(raw.target)
    if (target <= 0) return day ? dailyGoalSpecs(day) : []
    specs.push({ id: raw.id as DailyGoalId, target })
  }
  return specs
}

/** 旧存档没有当日字段时，当日从空开始。 */
function parseDaily(value: unknown): DailyState {
  const daily = emptyDaily()
  if (!value || typeof value !== 'object') return daily
  const raw = value as Partial<DailyState>
  daily.day = typeof raw.day === 'string' ? raw.day : ''
  daily.goals = parseGoals(raw.goals, daily.day)
  daily.progress = parseProgress(raw.progress)
  if (raw.ledger && typeof raw.ledger === 'object') {
    for (const [day, progress] of Object.entries(raw.ledger)) {
      if (!day) continue
      daily.ledger[day] = parseProgress(progress)
    }
  }
  if (daily.day) daily.ledger[daily.day] = mergeProgress(daily.ledger[daily.day], daily.progress)
  return daily
}

function parseEntry(value: unknown): HistoryEntry | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<HistoryEntry>
  if (typeof raw.id !== 'string' || typeof raw.score !== 'number' || !Number.isFinite(raw.score)) return null
  return {
    id: raw.id,
    endedAt: typeof raw.endedAt === 'number' ? raw.endedAt : 0,
    score: raw.score,
    playMs: typeof raw.playMs === 'number' ? raw.playMs : 0,
    abandoned: raw.abandoned === true,
    tilted: raw.tilted === true,
    bonusEntries: typeof raw.bonusEntries === 'number' ? raw.bonusEntries : 0,
    bankClears: typeof raw.bankClears === 'number' ? raw.bankClears : 0,
    cleanFinish: raw.cleanFinish === true,
  }
}

export function emptyKept(): KeptRecords {
  return { career: defaultCareer(), history: [], bestScore: 0, daily: emptyDaily() }
}

export function readSave(): KeptRecords {
  const bin = storage()
  if (!bin) return emptyKept()
  try {
    const text = bin.getItem(STORAGE_KEY)
    if (!text) return emptyKept()
    const parsed = JSON.parse(text) as Partial<SaveBlob>
    if (parsed.version !== 1 && parsed.version !== 2) return emptyKept()
    const history = Array.isArray(parsed.history) ? parsed.history.map(parseEntry).filter((item) => item !== null) : []
    return {
      career: parseCareer(parsed.career),
      history,
      bestScore: typeof parsed.bestScore === 'number' && parsed.bestScore > 0 ? parsed.bestScore : 0,
      daily: parsed.version === 2 ? parseDaily(parsed.daily) : emptyDaily(),
    }
  } catch {
    return emptyKept()
  }
}

export function persist(doc: PinballDocument): void {
  const bin = storage()
  if (!bin) return
  const blob: SaveBlob = {
    version: 2,
    bestScore: Math.max(doc.bestScore, doc.score),
    career: doc.career,
    history: doc.history,
    daily: doc.daily,
  }
  try {
    bin.setItem(STORAGE_KEY, JSON.stringify(blob))
  } catch {
    if (!doc.run.storageWarned) {
      doc.run.storageWarned = true
      flashNote(doc, '这台浏览器没能写下记录')
    }
  }
}

export function commitSession(doc: PinballDocument, abandoned: boolean): void {
  if (!doc.run.launched || doc.run.committed) return
  const clean = !abandoned && doc.phase === 'gameover' && !doc.live.tilted
  if (clean) {
    doc.career.cleanFinish = true
    creditDailyCleanFinish(doc)
  }
  syncDaily(doc)
  if (doc.score > doc.bestScore) doc.bestScore = doc.score
  doc.history.unshift({
    id: makeId(),
    endedAt: Date.now(),
    score: doc.score,
    playMs: doc.run.playMs,
    abandoned,
    tilted: doc.live.tilted,
    bonusEntries: doc.live.bonusEntries,
    bankClears: doc.live.bankClears,
    cleanFinish: clean,
  })
  if (doc.history.length > 20) doc.history.length = 20
  doc.run.committed = true
  doc.run.storedScore = doc.score
  persist(doc)
}

export function syncRecords(doc: PinballDocument): void {
  const careerChanged = latchCareer(doc)
  const dailyChanged = syncDaily(doc)
  const scoreChanged = doc.score !== doc.run.storedScore
  if (doc.score > doc.bestScore) doc.bestScore = doc.score
  if (!careerChanged && !dailyChanged && !scoreChanged) return
  doc.run.storedScore = doc.score
  persist(doc)
}

export function formatPlay(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`
}
