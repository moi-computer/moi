import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { jsonRequest, requestJson, requestVoid } from '@/client/api/http'
import type { HarnessStatuses, HarnessLogin, HarnessType } from '@/lib/types'

export function startHarnessLogin(harness: HarnessType): Promise<HarnessLogin> {
  return requestJson(
    `/api/harnesses/${harness}/auth/login`,
    { method: 'POST' },
    'Could not start sign-in'
  )
}

export type LoginHarness = 'claude-code' | 'codex'

export type { HarnessStatus } from '@/lib/types'

const harnessStatusOptions = queryOptions({
  queryKey: ['harness-status'],
  queryFn: ({ signal }) => requestJson<HarnessStatuses>('/api/harnesses/status', { signal }),
  staleTime: Infinity,
  gcTime: Infinity,
  refetchOnWindowFocus: 'always',
  refetchInterval: query =>
    Object.values(query.state.data ?? {}).some(
      status => status.login?.state === 'starting' || status.login?.state === 'pending'
    )
      ? 2_000
      : false
})

// Only user-requested retries bypass the server's availability cache.
export function useRetryHarnessStatus() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => requestJson<HarnessStatuses>('/api/harnesses/status?refresh=true'),
    onMutate: async () => {
      await client.cancelQueries({ queryKey: harnessStatusOptions.queryKey })
      return client.getQueryData(harnessStatusOptions.queryKey)
    },
    onSuccess: (statuses, _variables, previous) => {
      // An auth event received during the retry is newer than this response.
      if (client.getQueryData(harnessStatusOptions.queryKey) === previous)
        client.setQueryData(harnessStatusOptions.queryKey, statuses)
    }
  })
}

export function useHarnessStatuses() {
  return useQuery(harnessStatusOptions)
}

export function useHarnessStatus(harness: HarnessType | undefined) {
  return useQuery({
    ...harnessStatusOptions,
    enabled: harness === 'claude-code' || harness === 'codex',
    select: statuses => (harness ? statuses[harness] : undefined)
  })
}

export function submitHarnessLoginCode(harness: HarnessType, id: string, code: string) {
  return requestVoid(
    `/api/harnesses/${harness}/auth/login/${id}/code`,
    jsonRequest('POST', { code })
  )
}

export function installHarness(harness: LoginHarness) {
  return requestVoid(`/api/harnesses/${harness}/auth/install`, { method: 'POST' })
}
