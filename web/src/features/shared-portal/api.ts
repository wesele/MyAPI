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
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

import type { PricingData } from '@/features/pricing/types'
import { api } from '@/lib/api'

import { surveyAmounts, type SurveyAmount } from './survey-amounts'

const headers = { 'X-Shared-Portal': '1' }
const voteSchema = z.object({
  amount: z.literal([0, ...surveyAmounts]),
})
const surveySummarySchema = z.object({
  success: z.literal(true),
  data: z
    .array(
      z.object({
        amount: z.literal(surveyAmounts),
        count: z.number().int().nonnegative(),
      })
    )
    .nullable(),
})

export const referencePricesSchema = z.record(
  z.string(),
  z.object({
    input_usd: z.number().nonnegative().optional(),
    output_usd: z.number().nonnegative().optional(),
    request_usd: z.number().nonnegative().optional(),
    input_cny: z.number().nonnegative().optional(),
    output_cny: z.number().nonnegative().optional(),
    request_cny: z.number().nonnegative().optional(),
    max_input_tokens: z.number().int().positive().optional(),
    source: z.url({ protocol: /^https$/ }),
    checked: z.iso.date(),
  })
)
export type ReferencePrice = z.infer<typeof referencePricesSchema>[string]

export async function getPublicPricing(
  signal: AbortSignal
): Promise<PricingData> {
  const response = await fetch('/api/pricing', { credentials: 'omit', signal })
  if (!response.ok) throw new Error('Pricing unavailable')
  const pricing: PricingData = await response.json()
  if (!pricing.success) throw new Error('Pricing unavailable')
  return pricing
}

export async function getReferencePrices(signal: AbortSignal) {
  const response = await fetch('/api/shared/reference-prices', {
    headers,
    signal,
  })
  if (!response.ok) throw new Error('Reference prices unavailable')
  return referencePricesSchema.parse(await response.json())
}

export async function getSurveyVote(signal: AbortSignal) {
  const response = await fetch('/api/shared/survey', { headers, signal })
  if (!response.ok) throw new Error('Survey unavailable')
  return voteSchema.parse(await response.json()).amount
}

export async function saveSurveyVote(amount: SurveyAmount) {
  const response = await fetch('/api/shared/survey', {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }),
  })
  if (!response.ok) throw new Error('Survey unavailable')
  return voteSchema.parse(await response.json()).amount
}

export async function getSurveySummary() {
  const response = await api.get('/api/shared/survey/summary', { headers })
  return surveySummarySchema.parse(response.data).data ?? []
}

export const publicSurveyResults = queryOptions({
  queryKey: ['shared-survey-results'],
  queryFn: async ({ signal }) => {
    const response = await fetch('/api/shared/survey/results', {
      headers,
      signal,
      credentials: 'omit',
    })
    if (!response.ok) throw new Error('Survey results unavailable')
    return surveySummarySchema.parse(await response.json()).data ?? []
  },
  staleTime: 30_000,
  meta: { errorToast: false },
})

export const publicCatalog = queryOptions({
  queryKey: ['shared-model-pricing'],
  queryFn: ({ signal }) => getPublicPricing(signal),
  staleTime: 60_000,
  meta: { errorToast: false },
})

export const publicReferencePrices = queryOptions({
  queryKey: ['shared-reference-prices'],
  queryFn: ({ signal }) => getReferencePrices(signal),
  staleTime: 60_000,
  meta: { errorToast: false },
})
