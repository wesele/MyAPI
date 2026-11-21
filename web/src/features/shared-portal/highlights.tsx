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

import {
  publicCatalog,
  publicReferencePrices,
  publicSurveyResults,
} from './api'
import {
  comparablePrices,
  createQuoteFormatters,
  getPublicModelGroup,
  getReferenceAmount,
} from './pricing'
import {
  formatSurveyYuan,
  surveyAmounts,
  surveyLaunchGoal,
  surveySubscriptionLabel,
} from './survey-amounts'

export function PortalHighlights() {
  const { t, i18n } = useTranslation()
  const surveyTitleId = useId()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { status } = useStatus()
  const format = createQuoteFormatters(locale, status?.usd_exchange_rate)
  const catalog = useQuery(publicCatalog)
  const references = useQuery(publicReferencePrices)
  const survey = useQuery(publicSurveyResults)
  const preview = catalog.data?.data?.slice(0, 2) ?? []
  const participants = survey.data?.reduce((sum, entry) => sum + entry.count, 0)
  return (
    <div className='mt-5 grid gap-5 lg:grid-cols-5'>
      <Card className='border-border/70 rounded-3xl py-6 lg:col-span-3'>
        <CardHeader className='gap-3 px-6 sm:px-8'>
          <div className='flex items-center gap-3'>
            <span className='bg-accent text-accent-foreground grid size-10 place-items-center rounded-xl'>
              <Layers3 className='size-5' aria-hidden='true' />
            </span>
            <CardTitle className='text-xl font-semibold sm:text-2xl'>
              {t('Models and pricing')}
            </CardTitle>
          </div>
          <p className='text-muted-foreground text-sm'>
            {t('Compare our input and output rates with official prices.')}
          </p>
        </CardHeader>
        <CardContent className='flex flex-1 flex-col gap-4 px-6 sm:px-8'>
          {catalog.isPending && <Skeleton className='h-16 rounded-xl' />}
          {preview.length > 0 && (
            <ul className='bg-muted/45 divide-border/70 divide-y rounded-xl px-4'>
              {preview.map((model) => {
                const rates = catalog.data?.group_ratio ?? {}
                const group = getPublicModelGroup(model, rates)
                const price = group
                  ? comparablePrices(model, rates[group]).find(
                      (item) => item.kind !== 'output'
                    )
                  : undefined
                const original =
                  price &&
                  getReferenceAmount(
                    references.data?.[model.model_name],
                    price.kind
                  )
                const discount =
                  price && format.discount(price.current, original)
                return (
                  <li
                    key={model.model_name}
                    className='flex flex-wrap items-center justify-between gap-2 py-3'
                  >
                    <span className='min-w-0 font-mono text-sm font-medium wrap-anywhere'>
                      {model.model_name}
                    </span>
                    <span className='flex flex-wrap items-center gap-2 text-sm'>
                      {price && Number.isFinite(price.current) && (
                        <span>
                          {format.quote(price.current)}{' '}
                          <span className='text-muted-foreground'>
                            {price.kind === 'request'
                              ? t('Per request')
                              : t('Per 1M input tokens')}
                          </span>
                        </span>
                      )}
                      {!price && group && (
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
                        <span className='text-muted-foreground'>
                          {t('Official reference price')} ·{' '}
                          {format.reference(original)}
                        </span>
                      )}
                      {discount !== undefined && discount > 0 && (
                        <Badge className='bg-emerald-500/12 text-emerald-800 dark:text-emerald-300'>
                          {t('{{discount}}% off', {
                            discount: formatNumber(discount, locale),
                          })}
                        </Badge>
                      )}
                    </span>
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
