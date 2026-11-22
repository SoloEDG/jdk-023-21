import { commandFromInput, type FrameInput } from '@/shared/commands'
import type { PinballDocument } from '@/shared/document'
import { absorbZones, tickBonus } from '@/features/bonus'
import { advanceControls } from '@/features/flippers'
import { openDaily, persist, pinDailyForRun, syncRecords } from '@/features/records'
import { simulateBall } from '@/features/scoring'
import { anchors, consumeContacts, publishGates, sampleRamp, sampleScoop, stickPlunger, syncTable } from '@/features/table'
import { applyDrain, restartGame, togglePause } from '@/app/cabinet-actions'

export function runFrame(doc: PinballDocument, input: FrameInput, dtMs: number): void {
  const command = commandFromInput(input)
  if (command?.type === 'restart') {
    restartGame(doc)
    return
  }
  if (command?.type === 'pause-toggle') {
    togglePause(doc)
    return
  }
  if (doc.phase !== 'paused' && doc.note.ms > 0) doc.note.ms -= dtMs
  if (doc.phase === 'paused' || doc.phase === 'gameover') return

  advanceControls(doc, input, dtMs, anchors())
  if (doc.ball.held === 'plunger') stickPlunger(doc)
  if (doc.phase !== 'playing') return

  doc.run.playMs += dtMs
  // 这一局开始时定下当日目标，之后即使跨过午夜也不再换。
  if (doc.run.launched && !doc.run.dailyDay) pinDailyForRun(doc)
  tickBonus(doc, dtMs)
  const solids = syncTable(doc, dtMs)
  if (doc.ball.held !== 'plunger') {
    const events = simulateBall(doc, solids, dtMs, { ramp: sampleRamp, scoop: sampleScoop })
    consumeContacts(doc, events)
    absorbZones(doc, events)
    publishGates(doc)
    if (doc.signals.drain) applyDrain(doc)
  }
  syncRecords(doc)
}

const DAY_CHECK_MS = 15000

export function startLoop(doc: PinballDocument, pull: () => FrameInput): () => void {
  let last = performance.now()
  let lastDayCheck = last
  let handle = 0
  const onHide = (): void => {
    if (document.hidden) persist(doc)
  }
  const onLeave = (): void => persist(doc)
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', onLeave)
  const tick = (now: number): void => {
    const step = Math.min(32, Math.max(0, now - last))
    last = now
    // 还没开局（或这一局已经收台）时，跨过午夜就让暗盘换成新的一天；
    // 正在进行的这一局由开局时定下的日子说了算。
    const inActiveRun = doc.run.launched && !doc.run.committed
    if (!inActiveRun && now - lastDayCheck >= DAY_CHECK_MS) {
      lastDayCheck = now
      openDaily(doc)
    }
    runFrame(doc, pull(), step)
    handle = requestAnimationFrame(tick)
  }
  handle = requestAnimationFrame(tick)
  return () => {
    cancelAnimationFrame(handle)
    document.removeEventListener('visibilitychange', onHide)
    window.removeEventListener('pagehide', onLeave)
  }
}
