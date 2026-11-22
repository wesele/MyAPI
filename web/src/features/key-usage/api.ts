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
import { getFreshAuthHeaders } from '@/lib/auth-session'
import { useAuthStore } from '@/stores/auth-store'

const trialRefillSchema = z.object({
  eligible: z.boolean(),
  can_refill: z.boolean(),
  already_full: z.boolean(),
  next_refill_at: z.number(),
  target_quota: z.number(),
})

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
    masked_key: z.string().optional(),
    trial_refill: trialRefillSchema.optional(),
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
        quota: z.number().default(0),
      })
    )
    .nullable(),
})

const redeemCodeSchema = z.object({
  success: z.literal(true),
  data: z.object({
    key: z.string().min(1),
  }),
})

const trialKeySchema = z.object({
  success: z.literal(true),
  data: z.object({
    key: z.string().min(1),
    expired_time: z.number().optional(),
  }),
})

const trialRefillResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    remain_quota: z.number(),
    expired_time: z.number(),
    next_refill_at: z.number(),
  }),
})

export type KeyUsage = z.infer<typeof keyUsageSchema>['data']
export type TrialRefillStatus = z.infer<typeof trialRefillSchema>
export type KeyLog = NonNullable<z.infer<typeof keyLogsSchema>['data']>[number]
type LookupError = 'unauthorized' | 'rateLimited' | 'unavailable'
export type TrialClaimError =
  | 'alreadyClaimed'
  | 'ipCooldown'
  | 'dailyLimitReached'
  | 'unavailable'
export type TrialRefillError =
  | 'notEligible'
  | 'cooldown'
  | 'alreadyFull'
  | 'unauthorized'
  | 'rateLimited'
  | 'unavailable'

export type LookupResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: LookupError }

export type TrialClaimResult =
  | { ok: true; data: { key: string; expired_time?: number } }
  | { ok: false; error: TrialClaimError }

export type TrialRefillResult =
  | {
      ok: true
      data: {
        remain_quota: number
        expired_time: number
        next_refill_at: number
      }
    }
  | { ok: false; error: TrialRefillError; nextRefillAt?: number }

const SHARED_TRIAL_KEY_STORAGE = 'shared_trial_key'

export function getStoredTrialKey(): string | null {
  try {
    const value = window.localStorage.getItem(SHARED_TRIAL_KEY_STORAGE)?.trim()
    return value ? value : null
  } catch {
    return null
  }
}

export function setStoredTrialKey(key: string): void {
  try {
    window.localStorage.setItem(SHARED_TRIAL_KEY_STORAGE, key.trim())
  } catch {
    // Ignore storage quota or private-mode errors.
  }
}

export function clearStoredTrialKey(): void {
  try {
    window.localStorage.removeItem(SHARED_TRIAL_KEY_STORAGE)
  } catch {
    // Ignore storage access errors.
  }
}

export function maskApiKey(fullKey: string): string {
  const raw = fullKey.startsWith('sk-') ? fullKey.slice(3) : fullKey
  if (!raw) return ''
  if (raw.length <= 4) return `sk-${'*'.repeat(raw.length)}`
  if (raw.length <= 8) return `sk-${raw.slice(0, 2)}****${raw.slice(-2)}`
  return `sk-${raw.slice(0, 4)}**********${raw.slice(-4)}`
}

export function matchesMaskedKey(fullKey: string, maskedKey?: string): boolean {
  if (!fullKey || !maskedKey) return false
  return maskApiKey(fullKey) === maskedKey
}

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
    if (
      response.status === 400 ||
      response.status === 401 ||
      response.status === 403
    ) {
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

export function redeemCode(
  key: string
): Promise<LookupResult<{ key: string }>> {
  return readKeyEndpoint(
    '/api/shared/redeem',
    {
      method: 'POST',
      headers: {
        ...portalHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key }),
    },
    redeemCodeSchema
  )
}

export async function claimTrialKey(): Promise<TrialClaimResult> {
  try {
    const headers: Record<string, string> = { ...portalHeaders }
    const authState = useAuthStore.getState().auth
    if (authState.user || authState.accessToken) {
      try {
        const authHeaders = await getFreshAuthHeaders()
        if (authHeaders.Authorization) {
          headers.Authorization = authHeaders.Authorization
        }
      } catch {
        // Fall back to anonymous claim when session refresh is unavailable.
      }
    }
    const response = await fetch('/api/shared/trial-key', {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    })
    if (response.ok) {
      const parsed = trialKeySchema.safeParse(await response.json())
      if (parsed.success) return { ok: true, data: parsed.data.data }
    }
    const body = await response.json().catch(() => null)
    const code =
      body && typeof body === 'object' && 'code' in body
        ? String((body as { code?: unknown }).code ?? '')
        : ''
    if (response.status === 409 || code === 'already_claimed') {
      return { ok: false, error: 'alreadyClaimed' }
    }
    if (code === 'daily_limit_reached') {
      return { ok: false, error: 'dailyLimitReached' }
    }
    if (response.status === 429 || code === 'ip_cooldown') {
      return { ok: false, error: 'ipCooldown' }
    }
  } catch {
    // Request errors can contain credentials. Keep them out of the UI and logs.
  }
  return { ok: false, error: 'unavailable' }
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

export async function refillTrialKey(id: string): Promise<TrialRefillResult> {
  try {
    const response = await fetch(
      `/api/shared/usage/${encodeURIComponent(id)}/refill`,
      {
        method: 'POST',
        headers: portalHeaders,
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
      }
    )
    if (response.ok) {
      const parsed = trialRefillResponseSchema.safeParse(await response.json())
      if (parsed.success) return { ok: true, data: parsed.data.data }
    }
    if (response.status === 401) {
      return { ok: false, error: 'unauthorized' }
    }
    const body = await response.json().catch(() => null)
    const code =
      body && typeof body === 'object' && 'code' in body
        ? String((body as { code?: unknown }).code ?? '')
        : ''
    const nextRefillAt =
      body &&
      typeof body === 'object' &&
      'next_refill_at' in body &&
      typeof (body as { next_refill_at?: unknown }).next_refill_at === 'number'
        ? (body as { next_refill_at: number }).next_refill_at
        : undefined
    if (response.status === 403 || code === 'not_eligible') {
      return { ok: false, error: 'notEligible' }
    }
    if (response.status === 409 || code === 'already_full') {
      return { ok: false, error: 'alreadyFull' }
    }
    if (code === 'refill_cooldown') {
      return { ok: false, error: 'cooldown', nextRefillAt }
    }
    if (response.status === 429) {
      return { ok: false, error: 'rateLimited' }
    }
  } catch {
    // Request errors can contain credentials. Keep them out of the UI and logs.
  }
  return { ok: false, error: 'unavailable' }
}
