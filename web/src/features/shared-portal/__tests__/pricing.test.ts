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
import i18next from 'i18next'
import { expect, test } from 'vitest'

import type { PricingModel } from '@/features/pricing/types'
import { toIntlLocale } from '@/i18n/languages'
import zhTW from '@/i18n/locales/zh-TW.json'
import zhCN from '@/i18n/locales/zh.json'

import {
  comparablePrices,
  createQuoteFormatters,
  discountFold,
  discountPercent,
  formatDiscountLabel,
  getReferenceAmount,
} from '../pricing'

const model: PricingModel = {
  id: 1,
  model_name: 'test-model',
  model_ratio: 0.15,
  completion_ratio: 2,
  quota_type: 0,
  enable_groups: ['default'],
}

const reference = {
  input_usd: 1,
  output_usd: 2,
  source: 'https://example.com/pricing',
  checked: '2026-11-21',
}

test('compares input and output and hides the discount without a lower comparable price', () => {
  const prices = comparablePrices(model, 1)
  const format = createQuoteFormatters('en', 7.3)
  expect(
    prices.map((price) =>
      format.discount(price.current, getReferenceAmount(reference, price.kind))
    )
  ).toEqual([70, 70])
  expect(
    prices.map((price) =>
      format.fold(price.current, getReferenceAmount(reference, price.kind))
    )
  ).toEqual([3, 3])
  expect(discountPercent(1, 1)).toBeUndefined()
  expect(discountPercent(2, 1)).toBeUndefined()
  expect(discountPercent(0.3, undefined)).toBeUndefined()
  expect(discountFold(0.1, 1)).toBe(1)
  expect(discountFold(0.1429, 1)).toBe(1.4)
  expect(discountFold(0.004, 1)).toBe(0.04)
  expect(discountFold(0, 1)).toBe(0)
  expect(discountFold(0.996, 1)).toBeUndefined()
  expect(discountFold(1, 1)).toBeUndefined()
  expect(discountFold(2, 1)).toBeUndefined()
  expect(discountFold(0.3, undefined)).toBeUndefined()
})

test('formats discount as fold in Chinese locales and percentage off in English', async () => {
  const i18n = i18next.createInstance()
  await i18n.init({
    lng: 'zhCN',
    fallbackLng: 'en',
    resources: {
      en: { translation: { '{{discount}}% off': '{{discount}}% off' } },
      zhCN,
      zhTW,
    },
  })
  const format = createQuoteFormatters('zh-CN', 7.3)
  expect(
    formatDiscountLabel({
      t: i18n.getFixedT('zhCN'),
      language: 'zhCN',
      locale: 'zh-CN',
      usd: 0.1,
      original: { amount: 1, currency: 'USD' },
      format,
    })
  ).toBe('1折')
  expect(
    formatDiscountLabel({
      t: i18n.getFixedT('zhTW'),
      language: 'zhTW',
      locale: 'zh-TW',
      usd: 0.1429,
      original: { amount: 1, currency: 'USD' },
      format,
    })
  ).toBe('1.4折')
  expect(
    formatDiscountLabel({
      t: i18n.getFixedT('en'),
      language: 'en',
      locale: 'en',
      usd: 0.1,
      original: { amount: 1, currency: 'USD' },
      format,
    })
  ).toBe('90% off')
})

test('compares a flat token expression and skips context tiers and request multipliers', () => {
  const flat = {
    ...model,
    billing_mode: 'tiered_expr',
    billing_expr: 'tier("base", p * 0.05 + c * 0.25 + cr * 0.005)',
  }
  expect(comparablePrices(flat, 2)).toEqual([
    { kind: 'input', current: 0.1 },
    { kind: 'output', current: 0.5 },
  ])
  expect(
    comparablePrices(
      {
        ...flat,
        billing_expr:
          'len <= 1000 ? tier("short", p * 0.05 + c * 0.25) : tier("long", p * 0.1 + c * 0.5)',
      },
      1
    )
  ).toEqual([])
  expect(
    comparablePrices(
      {
        ...flat,
        billing_expr: `${flat.billing_expr}|||when(header("speed") has "fast") * 2`,
      },
      1
    )
  ).toEqual([])
})

test.each(['en', 'zhCN', 'zhTW', 'fr', 'ja', 'ru', 'vi', 'invalid_locale'])(
  'rounds USD and CNY independently with locale %s',
  (language) => {
    const locale = toIntlLocale(language)
    const format = createQuoteFormatters(locale, 2)
    const decimals = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
    const quote = format.quote(1.125)
    expect(quote).toContain(decimals.format(1.13))
    expect(quote).toContain(decimals.format(2.25))
    expect(format.reference({ currency: 'CNY', amount: 1.235 })).toContain(
      decimals.format(1.24)
    )
  }
)

test('rounds a converted half-cent up despite binary floating-point drift', () => {
  expect(createQuoteFormatters('en', 7.3).quote(0.35)).toBe('$0.35 / ¥2.56')
})
