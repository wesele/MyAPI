/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { z } from 'zod'

import { LOG_TYPE_ENUM } from '@/features/usage-logs/constants'

const keyUsageSchema = z.object({
  code: z.literal(true),
  data: z.object({
    total_available: z.number(),
    total_used: z.number(),
    total_granted: z.number(),
    unlimited_quota: z.boolean(),
    expires_at: z.number().min(0),
    model_limits_enabled: z.boolean(),
    model_limits: z.record(z.string(), z.boolean()),
  }),
})

const keyLogsSchema = z.object({
  success: z.literal(true),
  data: z
    .array(
      z.object({
        id: z.number(),
        created_at: z.number(),
        type: z.number(),
        model_name: z.string(),
        prompt_tokens: z.number(),
        completion_tokens: z.number(),
      })
    )
    .nullable(),
})

export type KeyUsage = z.infer<typeof keyUsageSchema>['data']
export type KeyLog = NonNullable<z.infer<typeof keyLogsSchema>['data']>[number]
type LookupError = 'unauthorized' | 'rateLimited' | 'unavailable'

export type LookupResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: LookupError }

const portalHeaders = { 'X-Shared-Portal': '1' }

async function readKeyEndpoint<T>(
  path: string,
  init: RequestInit,
  schema: z.ZodType<{ data: T }>
): Promise<LookupResult<T>> {
  try {
    const response = await fetch(path, {
      ...init,
      cache: 'no-store',
      redirect: 'error',
    })
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: 'unauthorized' }
    }
    if (response.status === 429) return { ok: false, error: 'rateLimited' }
    if (response.ok) {
      const parsed = schema.safeParse(await response.json())
      if (parsed.success) return { ok: true, data: parsed.data.data }
    }
  } catch {
    // Request errors can contain credentials. Keep them out of the UI and logs.
  }
  return { ok: false, error: 'unavailable' }
}

export function startKeyUsage(
  key: string
): Promise<LookupResult<{ id: string }>> {
  return readKeyEndpoint(
    '/api/shared/usage',
    {
      method: 'POST',
      headers: { ...portalHeaders, Authorization: `Bearer ${key}` },
    },
    z
      .object({ id: z.string().regex(/^[A-Z2-7]{26}$/) })
      .transform((data) => ({ data }))
  )
}

export function fetchKeyUsage(
  id: string,
  signal: AbortSignal
): Promise<LookupResult<KeyUsage>> {
  return readKeyEndpoint(
    `/api/shared/usage/${encodeURIComponent(id)}/totals`,
    { headers: portalHeaders, signal },
    keyUsageSchema
  )
}

export async function fetchKeyLogs(
  id: string,
  signal: AbortSignal
): Promise<LookupResult<KeyLog[]>> {
  const result = await readKeyEndpoint(
    `/api/shared/usage/${encodeURIComponent(id)}/logs`,
    { headers: portalHeaders, signal },
    keyLogsSchema
  )
  if (!result.ok) return result

  return {
    ok: true,
    data: (result.data ?? []).filter(
      (log) => log.type === LOG_TYPE_ENUM.CONSUME
    ),
  }
}
