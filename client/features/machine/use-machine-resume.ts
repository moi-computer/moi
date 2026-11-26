import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { type Query, useQueryClient } from '@tanstack/react-query'

import { HttpError } from '@/client/api/http'
import { isMachineStatus, machine, type MachineSnapshot } from './store'

// Mounted only in the cloud. The host bridge owns the WebSocket.
export function useMachineResume() {
  const snapshot = useSyncExternalStore(machine.subscribe, machine.getSnapshot)
  const interrupted = snapshot !== undefined && snapshot.status !== 'running'
  const queries = useQueryClient()
  const [wakeRequested, setWakeRequested] = useState(interrupted)

  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let seenRunning = machine.getSnapshot()?.status === 'running'
    const observe = (next: MachineSnapshot | undefined) => {
      if (next?.status === 'error') setFailed(true)
      if (next?.status === 'running') {
        setFailed(false)
        seenRunning = true
        setWakeRequested(false)
      } else if (next && !seenRunning) {
        // The first snapshot belongs to a fresh navigation, not an idle tab.
        setWakeRequested(true)
      }
    }
    observe(machine.getSnapshot())
    return machine.subscribe(observe)
  }, [])

  useEffect(() => {
    const wake = () => {
      const current = machine.getSnapshot()
      if (current && current.status !== 'running' && document.visibilityState === 'visible')
        setWakeRequested(true)
    }
    document.addEventListener('pointerdown', wake, true)
    document.addEventListener('keydown', wake, true)
    document.addEventListener('visibilitychange', wake)
    return () => {
      document.removeEventListener('pointerdown', wake, true)
      document.removeEventListener('keydown', wake, true)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [])

  useLayoutEffect(() => {
    const interruptedReads = new Set<Query>()
    const startedAtRevision = new WeakMap<Query, number | undefined>()
    const unsubscribeQueries = queries.getQueryCache().subscribe(event => {
      if (event.type !== 'updated') return
      const { action, query } = event
      const current = machine.getSnapshot()
      if (action.type === 'fetch') {
        startedAtRevision.set(query, current?.revision)
        return
      }
      if (action.type !== 'failed' && action.type !== 'error') return
      const state = action.error instanceof HttpError && action.error.machineState
      if (!isMachineStatus(state) || state === 'running') return

      // A response from before the last wake cannot pause the app again.
      if (current?.status === 'running' && startedAtRevision.get(query) !== current.revision) {
        if (action.type === 'error') void queries.invalidateQueries({ predicate: q => q === query })
        return
      }
      interruptedReads.add(query)
      if (action.type === 'failed') void queries.cancelQueries({ predicate: q => q === query })
      if (!current || current.status === 'running')
        machine.set({ status: state, revision: current?.revision ?? 0 })
    })

    const unsubscribeMachine = machine.subscribe(next => {
      if (next?.status !== 'running' || !interruptedReads.size) return
      // Mounted reads refetch now. Inactive cache entries refresh on next use.
      const reads = new Set(interruptedReads)
      interruptedReads.clear()
      void queries.invalidateQueries({ predicate: q => reads.has(q) })
    })
    return () => {
      unsubscribeQueries()
      unsubscribeMachine()
    }
  }, [queries])

  useEffect(() => {
    if (!interrupted || !wakeRequested || failed) return
    let active = true
    let pending = false
    let accepted = false
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()

    async function resume() {
      clearTimeout(timer)
      if (
        pending ||
        document.visibilityState !== 'visible' ||
        machine.getSnapshot()?.status === 'running'
      )
        return
      pending = true
      let delay = 15_000
      try {
        // Normally the host pushes running before the recovery timer fires.
        const action = accepted ? 'status' : 'start'
        const response = await fetch('/cloud/api/machine/' + action, {
          method: accepted ? 'GET' : 'POST',
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)])
        })
        if (!active) return
        if (response.status === 401 || response.status === 403) {
          const returnTo = location.pathname + location.search + location.hash
          location.replace('/cloud/login?returnTo=' + encodeURIComponent(returnTo))
          return
        }
        if (response.status === 429) delay = 60_000
        else if (!response.ok) setFailed(true)
        else {
          const next: MachineSnapshot = await response.json()
          if (!active) return
          machine.set(next)
          const status = machine.getSnapshot()?.status
          accepted = status === 'provisioning' || status === 'stopping'
        }
      } catch {
        if (active) setFailed(true)
      } finally {
        pending = false
      }
      if (
        active &&
        document.visibilityState === 'visible' &&
        machine.getSnapshot()?.status !== 'running'
      )
        timer = setTimeout(resume, delay)
    }

    document.addEventListener('visibilitychange', resume)
    void resume()
    return () => {
      active = false
      controller.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [interrupted, wakeRequested, failed])

  return { visible: interrupted && wakeRequested, failed, retry: () => setFailed(false) }
}
