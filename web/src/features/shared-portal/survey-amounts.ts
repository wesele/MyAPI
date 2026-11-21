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

import { formatNumber } from '@/lib/format'

export const surveyAmounts = [10, 20, 50] as const
export const surveyLaunchGoal = 10
export type SurveyAmount = (typeof surveyAmounts)[number]
const surveySubscriptionPrices = { 10: 39, 20: 79, 50: 199 }

export function formatSurveyYuan(
  t: TFunction,
  amount: number,
  locale?: string
) {
  return t('{{amount}} yuan', { amount: formatNumber(amount, locale) })
}

export function surveySubscriptionLabel(
  t: TFunction,
  amount: SurveyAmount,
  locale?: string
) {
  return t('Roughly equivalent to the {{price}} subscription in China', {
    price: formatSurveyYuan(t, surveySubscriptionPrices[amount], locale),
  })
}
