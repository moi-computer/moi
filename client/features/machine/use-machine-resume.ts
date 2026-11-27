import { useEffect, useLayoutEffect, useState } from 'react'
import { type Query, useQueryClient } from '@tanstack/react-query'

import { HttpError, requestJson } from '@/client/api/http'
import { isMachineStatus, machine, type MachineSnapshot } from './store'

const WAKE_UPDATE_TIMEOUT_MS = 15_000

type ResumeState = 'idle' | 'checking' | 'waiting-for-stop' | 'waking' | 'failed'

function resumeState(status: MachineSnapshot['status'] | undefined): ResumeState {
  if (!status || status === 'running') return 'idle'
  if (status === 'stopping') return 'waiting-for-stop'
  if (status === 'error') return 'failed'
  return 'waking'
}

// Mounted only in the cloud. The host bridge owns the WebSocket.
export function useMachineResume() {
  const queries = useQueryClient()
  const [state, setState] = useState<ResumeState>('idle')

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    const wake = (event: Event) => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return
      let next = resumeState(machine.getSnapshot()?.status)
      if (next === 'idle' || next === 'waiting-for-stop') {
        if (event.type !== 'focus' && event.type !== 'visibilitychange') return
        next = 'checking'
      }
      setState(current => (current === 'idle' || current === 'waiting-for-stop' ? next : current))
    }
    const unsubscribe = machine.subscribe((next, prev) => {
      if (next?.status === 'running') return setState('idle')
      setState(current => {
        if (current === 'waiting-for-stop') return resumeState(next?.status)
        if (current === 'checking' && next?.status === 'stopping' && prev?.status !== 'stopping')
          return 'idle'
        if (current === 'waking' && next?.status === 'error') return 'failed'
        return current
      })
    })
    document.addEventListener('pointerdown', wake, { capture: true, signal })
    document.addEventListener('keydown', wake, { capture: true, signal })
    document.addEventListener('visibilitychange', wake, { signal })
    window.addEventListener('focus', wake, { signal })
    return () => {
      controller.abort()
      unsubscribe()
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
    if (state !== 'checking' && state !== 'waking') return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>

    async function request(action: 'start' | 'status') {
      try {
        const next = await requestJson<MachineSnapshot>('/cloud/api/machine/' + action, {
          method: action === 'start' ? 'POST' : 'GET',
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)])
        })
        if (controller.signal.aborted) return
        machine.set(next)
        const status = machine.getSnapshot()?.status
        if (state === 'checking') return setState(resumeState(status))
        if (action === 'start' && status === 'provisioning') {
          // Batiok normally pushes running. Check once if we missed the update.
          timer = setTimeout(() => void request('status'), WAKE_UPDATE_TIMEOUT_MS)
          return
        }
      } catch (error) {
        if (controller.signal.aborted) return
        if (state === 'checking') return setState(resumeState(machine.getSnapshot()?.status))
        if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
          const returnTo = location.pathname + location.search + location.hash
          location.replace('/cloud/login?returnTo=' + encodeURIComponent(returnTo))
          return
        }
      }
      if (machine.getSnapshot()?.status !== 'running') setState('failed')
    }

    void request(state === 'checking' ? 'status' : 'start')
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [state])

  return {
    visible: state === 'waking' || state === 'failed',
    failed: state === 'failed',
    retry: () => setState('waking')
  }
}
