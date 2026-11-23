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
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Layers3, Terminal } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress, ProgressLabel } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { ModelPriceCell } from '@/features/pricing/components/model-price-cell'
import { useStatus } from '@/hooks/use-status'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { getLobeIcon } from '@/lib/lobe-icon'

import {
  publicCatalog,
  publicReferencePrices,
  publicSurveyResults,
} from './api'
import {
  HIGHLIGHT_MODEL_LIMIT,
  createQuoteFormatters,
  formatDiscountLabel,
  getReferenceAmount,
  selectHighlightModels,
} from './pricing'
import {
  formatSurveyYuan,
  surveyAmounts,
  surveyLaunchGoal,
  surveySubscriptionLabel,
} from './survey-amounts'

export function PortalHighlights() {
  const { t, i18n } = useTranslation()
  const modelsTitleId = useId()
  const surveyTitleId = useId()
  const language = i18n.resolvedLanguage || i18n.language
  const locale = toIntlLocale(language)
  const { status } = useStatus()
  const format = createQuoteFormatters(locale, status?.usd_exchange_rate)
  const catalog = useQuery(publicCatalog)
  const references = useQuery(publicReferencePrices)
  const survey = useQuery(publicSurveyResults)
  const rates = catalog.data?.group_ratio ?? {}
  const preview = selectHighlightModels(catalog.data?.data, rates)
  const participants = survey.data?.reduce((sum, entry) => sum + entry.count, 0)
  return (
    <div className='mt-5 grid gap-5 lg:grid-cols-5'>
      <Card
        role='region'
        aria-labelledby={modelsTitleId}
        className='border-border/70 rounded-3xl py-6 lg:col-span-3'
      >
        <CardHeader className='gap-3 px-6 sm:px-8'>
          <div className='flex items-center gap-3'>
            <span className='bg-accent text-accent-foreground grid size-10 place-items-center rounded-xl'>
              <Layers3 className='size-5' aria-hidden='true' />
            </span>
            <CardTitle
              id={modelsTitleId}
              role='heading'
              aria-level={2}
              className='text-xl font-semibold sm:text-2xl'
            >
              {t('Models and pricing')}
            </CardTitle>
          </div>
          <p className='text-muted-foreground text-sm'>
            {t('Compare our input and output rates with official prices.')}
          </p>
        </CardHeader>
        <CardContent className='flex flex-1 flex-col gap-4 px-6 sm:px-8'>
          {catalog.isPending && (
            <div
              className='grid gap-2 sm:grid-cols-2'
              aria-label={t('Loading...')}
            >
              {Array.from({ length: HIGHLIGHT_MODEL_LIMIT }, (_, index) => (
                <Skeleton key={index} className='h-[74px] rounded-xl' />
              ))}
            </div>
          )}
          {preview.length > 0 && (
            <ul
              className={
                preview.length === 1
                  ? 'grid gap-2'
                  : 'grid gap-2 sm:grid-cols-2'
              }
            >
              {preview.map(({ model, group, price }) => {
                const vendor = catalog.data?.vendors?.find(
                  (item) => item.id === model.vendor_id
                )
                const iconName = model.icon || vendor?.icon
                const icon = iconName ? getLobeIcon(iconName, 14) : null
                const original =
                  price &&
                  getReferenceAmount(
                    references.data?.[model.model_name],
                    price.kind
                  )
                const discountLabel =
                  price &&
                  formatDiscountLabel({
                    t,
                    language,
                    locale,
                    usd: price.current,
                    original,
                    format,
                  })
                return (
                  <li
                    key={model.model_name}
                    className='border-border/70 bg-muted/45 flex flex-col justify-between gap-1 rounded-xl border px-3.5 py-2.5'
                  >
                    <div className='flex items-start justify-between gap-2'>
                      <div className='flex min-w-0 items-center gap-1.5'>
                        {icon && (
                          <span className='text-muted-foreground shrink-0'>
                            {icon}
                          </span>
                        )}
                        <span className='min-w-0 font-mono text-sm font-medium wrap-anywhere'>
                          {model.model_name}
                        </span>
                      </div>
                      {discountLabel && (
                        <Badge className='h-4 shrink-0 bg-emerald-500/12 px-1.5 py-0 text-[10px] font-medium text-emerald-800 dark:text-emerald-300'>
                          {discountLabel}
                        </Badge>
                      )}
                    </div>
                    <div className='space-y-0.5 text-xs'>
                      {price && Number.isFinite(price.current) && (
                        <div className='flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5'>
                          <span className='text-sm font-semibold tabular-nums'>
                            {format.quote(price.current)}
                          </span>
                          <span className='text-muted-foreground'>
                            {price.kind === 'request'
                              ? t('Per request')
                              : t('Per 1M input tokens')}
                          </span>
                        </div>
                      )}
                      {!price && (
                        <ModelPriceCell
                          model={{ ...model, group_ratio: rates }}
                          options={{
                            selectedGroup: group,
                            formatAmount: format.quote,
                          }}
                          showExpression={false}
                        />
                      )}
                      {original && (
                        <p className='text-muted-foreground'>
                          {t('Official reference price')} ·{' '}
                          {format.reference(original)}
                        </p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          <div className='mt-auto'>
            <Link
              to='/catalog'
              className={buttonVariants({ variant: 'outline' })}
            >
              {t('Browse models')}
              <ArrowUpRight aria-hidden='true' />
            </Link>
          </div>
        </CardContent>
      </Card>
      <Card
        role='region'
        aria-labelledby={surveyTitleId}
        className='border-border/70 rounded-3xl py-6 lg:col-span-2'
      >
        <CardHeader className='gap-3 px-6 sm:px-8'>
          <div className='flex items-center gap-3'>
            <span className='bg-accent text-accent-foreground grid size-10 shrink-0 place-items-center rounded-xl'>
              <Terminal className='size-5' aria-hidden='true' />
            </span>
            <div>
              <CardTitle
                id={surveyTitleId}
                role='heading'
                aria-level={2}
                className='text-xl font-semibold sm:text-2xl'
              >
                OpenCode
              </CardTitle>
              <p className='text-muted-foreground text-xs'>
                {t('Shared subscription survey')}
              </p>
            </div>
          </div>
          <CardDescription>
            {t(
              'Choose how much you would contribute toward a shared OpenCode subscription.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-1 flex-col gap-4 px-6 sm:px-8'>
          <ul className='grid gap-2'>
            {surveyAmounts.map((amount) => (
              <li
                className='border-border/70 bg-muted/45 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border px-3 py-2 text-sm tabular-nums'
                key={amount}
              >
                <span className='font-semibold'>
                  {formatSurveyYuan(t, amount, locale)}
                </span>
                <span className='text-muted-foreground text-xs'>
                  {surveySubscriptionLabel(t, amount, locale)}
                </span>
              </li>
            ))}
          </ul>
          {participants !== undefined && (
            <Progress
              value={Math.min(participants, surveyLaunchGoal)}
              max={surveyLaunchGoal}
              className='gap-2'
            >
              <ProgressLabel className='text-muted-foreground'>
                {t('{{current}} of {{target}} participants', {
                  current: formatNumber(participants, locale),
                  target: formatNumber(surveyLaunchGoal, locale),
                })}
              </ProgressLabel>
            </Progress>
          )}
          <div className='mt-auto'>
            <Link
              to='/survey'
              className={buttonVariants({ variant: 'secondary' })}
            >
              {t('Take the survey')}
              <ArrowUpRight aria-hidden='true' />
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
