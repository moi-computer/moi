import { createStore } from 'zustand/vanilla'

const statuses = [
  'none',
  'stopped',
  'hibernated',
  'stopping',
  'provisioning',
  'running',
  'error'
] as const
type MachineStatus = (typeof statuses)[number]
export type MachineSnapshot = {
  status: MachineStatus
  revision: number
  step?: string
  errorCode?: string
}

export function isMachineStatus(value: unknown): value is MachineStatus {
  return statuses.some(status => status === value)
}

// The cloud can publish before React mounts. Start responses and socket events
// carry the same revision, so a late response cannot undo a newer transition.
const store = createStore<MachineSnapshot | undefined>(() => undefined)
export const machine = {
  getSnapshot: store.getState,
  subscribe: store.subscribe,
  set(snapshot: MachineSnapshot) {
    if (!isMachineStatus(snapshot?.status) || !Number.isSafeInteger(snapshot.revision)) return
    const current = store.getState()
    if (current && snapshot.revision < current.revision) return
    store.setState(snapshot, true)
  }
}
