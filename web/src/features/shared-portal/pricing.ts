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
import type { TFunction } from 'i18next'

import { readTokenTierChain } from '@/features/pricing/lib/billing-expression/display'
import { compileBillingExpression } from '@/features/pricing/lib/billing-expression/parser'
import { calculateTokenPrice } from '@/features/pricing/lib/price'
import type { PricingModel } from '@/features/pricing/types'
import { normalizeInterfaceLanguage } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { ReferencePrice } from './api'

export const referencePriceKinds = ['input', 'output', 'request'] as const
type ReferencePriceKind = (typeof referencePriceKinds)[number]

export function getReferenceAmount(
  reference: ReferencePrice | undefined,
  kind: ReferencePriceKind
) {
  const cny = reference?.[`${kind}_cny`]
  if (cny !== undefined) return { amount: cny, currency: 'CNY' } as const
  const usd = reference?.[`${kind}_usd`]
  if (usd !== undefined) return { amount: usd, currency: 'USD' } as const
}

function stabilizeHalfCent(amount: number): number {
  const cents = amount * 100
  const midpoint = Math.floor(cents) + 0.5
  // Currency and group multipliers can put a decimal half-cent just below the tie.
  const tolerance = Math.min(1e-9, Math.abs(cents) * Number.EPSILON * 4)
  return Math.abs(cents - midpoint) <= tolerance ? midpoint / 100 : amount
}

export function createQuoteFormatters(locale: string | undefined, rate = 0) {
  const formatters = {
    USD: new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }),
    CNY: new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'CNY',
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }),
  }
  const hasRate = Number.isFinite(rate) && rate > 0
  return {
    quote: (usd: number) => {
      if (!Number.isFinite(usd)) return '—'
      const cny = usd * rate
      const converted =
        hasRate && Number.isFinite(cny)
          ? formatters.CNY.format(stabilizeHalfCent(cny))
          : '—'
      return `${formatters.USD.format(stabilizeHalfCent(usd))} / ${converted}`
    },
    reference: (original: NonNullable<ReturnType<typeof getReferenceAmount>>) =>
      formatters[original.currency].format(original.amount),
    discount: (
      usd: number,
      original: ReturnType<typeof getReferenceAmount>
    ) => {
      if (!original || (original.currency === 'CNY' && !hasRate)) return
      return discountPercent(
        original.currency === 'CNY' ? usd * rate : usd,
        original.amount
      )
    },
    fold: (usd: number, original: ReturnType<typeof getReferenceAmount>) => {
      if (!original || (original.currency === 'CNY' && !hasRate)) return
      return discountFold(
        original.currency === 'CNY' ? usd * rate : usd,
        original.amount
      )
    },
  }
}

export function formatDiscountLabel(options: {
  t: TFunction
  language?: string
  locale?: string
  usd: number
  original: ReturnType<typeof getReferenceAmount>
  format: ReturnType<typeof createQuoteFormatters>
}): string | undefined {
  if (normalizeInterfaceLanguage(options.language) === 'zhCN') {
    const fold = options.format.fold(options.usd, options.original)
    if (fold === undefined) return undefined
    return options.t('{{rate}}/10 of official price', {
      rate: formatNumber(fold, options.locale),
    })
  }
  const discount = options.format.discount(options.usd, options.original)
  if (discount === undefined || discount <= 0) return undefined
  return options.t('{{discount}}% off', {
    discount: formatNumber(discount, options.locale),
  })
}

export function getPublicModelGroup(
  model: PricingModel,
  ratios: Record<string, number>
) {
  const groups = (model.enable_groups ?? []).filter((group) =>
    Number.isFinite(ratios[group])
  )
  return groups.includes('default') ? 'default' : groups[0]
}

export function comparablePrices(model: PricingModel, ratio: number) {
  if (
    model.billing_plugin_variants?.length ||
    Object.keys(model.billing_usage_schema ?? {}).length
  ) {
    return []
  }
  if (model.billing_mode === 'tiered_expr' && model.billing_expr) {
    const expression = compileBillingExpression(model.billing_expr)
    if (expression.status !== 'ready' || expression.requestRules.length) {
      return []
    }
    const tiers = readTokenTierChain(expression.ast)
    if (tiers?.length !== 1 || tiers[0].conditions.length) return []
    const tier = tiers[0]
    if (tier.billingUnit === 'request') {
      if (tier.imageCount || tier.fixedPrice === undefined) return []
      return [
        {
          kind: 'request',
          current: tier.fixedPrice * ratio,
        },
      ] as const
    }
    const { p, c } = tier.prices
    if (p === undefined || c === undefined) return []
    return [
      { kind: 'input', current: p * ratio },
      { kind: 'output', current: c * ratio },
    ] as const
  }
  if (model.billing_mode && model.billing_mode !== 'ratio') return []
  if (model.quota_type === 1 && model.model_price !== undefined) {
    return [
      {
        kind: 'request',
        current: model.model_price * ratio,
      },
    ] as const
  }
  if (model.quota_type !== 0) return []
  return [
    {
      kind: 'input',
      current: calculateTokenPrice(model, 'input', ratio),
    },
    {
      kind: 'output',
      current: calculateTokenPrice(model, 'output', ratio),
    },
  ] as const
}

export function discountPercent(current: number, original: number | undefined) {
  if (
    !original ||
    !Number.isFinite(current) ||
    current < 0 ||
    current >= original
  ) {
    return undefined
  }
  return Math.round((1 - current / original) * 1e4) / 100
}

export function discountFold(current: number, original: number | undefined) {
  if (
    !original ||
    !Number.isFinite(current) ||
    current < 0 ||
    current >= original
  ) {
    return undefined
  }
  if (current === 0) return 0
  const fold = (current / original) * 10
  if (fold >= 0.1) {
    const rounded = Math.round(fold * 10) / 10
    return rounded >= 10 ? undefined : rounded
  }
  return Math.max(0.01, Math.round(fold * 100) / 100)
}
