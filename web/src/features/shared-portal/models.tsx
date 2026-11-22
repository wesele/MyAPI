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
import { ArrowDown, ArrowUp, Layers3, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ModelPerfBadge,
  type ModelPerfBadgeData,
} from '@/features/pricing/components/model-perf-badge'
import { ModelPriceCell } from '@/features/pricing/components/model-price-cell'
import type { PricingModel } from '@/features/pricing/types'
import { useStatus } from '@/hooks/use-status'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { getLobeIcon } from '@/lib/lobe-icon'

import {
  getPublicPerfMetricsSummary,
  publicCatalog,
  publicReferencePrices,
  type ReferencePrice,
} from './api'
import { SharedPortalLayout } from './layout'
import {
  comparablePrices,
  createQuoteFormatters,
  formatDiscountLabel,
  getPublicModelGroup,
  getReferenceAmount,
  referencePriceKinds,
} from './pricing'

function CatalogModel(props: {
  model: PricingModel
  group: string
  ratio: number
  reference?: ReferencePrice
  perf?: ModelPerfBadgeData
  format: ReturnType<typeof createQuoteFormatters>
}) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage || i18n.language
  const locale = toIntlLocale(language)
  const prices = comparablePrices(props.model, props.ratio)
  const iconName = props.model.icon || props.model.vendor_icon
  const icon = iconName ? getLobeIcon(iconName, 14) : null
  const priceLabels = {
    input: t('Input'),
    output: t('Output'),
    request: t('Per request'),
  }
  const source = props.reference
  const extraReferenceKinds = source
    ? referencePriceKinds.filter((kind) => {
        const original = getReferenceAmount(source, kind)
        return Boolean(original && !prices.some((price) => price.kind === kind))
      })
    : []

  return (
    <Card
      size='sm'
      className='border-border/75 flex h-full flex-col gap-1.5 rounded-xl py-2.5'
    >
      <CardHeader className='flex items-center gap-2 px-3'>
        <span className='bg-accent text-accent-foreground grid size-6 shrink-0 place-items-center rounded-md'>
          {icon ?? <Layers3 className='size-3.5' aria-hidden='true' />}
        </span>
        <CardTitle className='min-w-0 font-mono text-sm leading-snug font-semibold wrap-anywhere'>
          {props.model.model_name}
        </CardTitle>
      </CardHeader>
      <CardContent className='flex-1 space-y-1.5 px-3'>
        {props.model.description && (
          <p className='text-muted-foreground text-xs leading-snug'>
            {props.model.description}
          </p>
        )}
        {Boolean(props.model.context_length) && (
          <Badge variant='outline' className='h-4 px-1.5 text-[11px]'>
            {t('Context Window')} ·{' '}
            {formatNumber(props.model.context_length, locale)}
          </Badge>
        )}
        {prices.length === 0 ? (
          <div className='bg-muted/40 rounded-lg px-2.5 py-2 text-xs'>
            <ModelPriceCell
              model={props.model}
              options={{
                selectedGroup: props.group,
                formatAmount: props.format.quote,
              }}
              showExpression={false}
            />
          </div>
        ) : (
          <dl
            className={
              prices.length > 1 ? 'grid grid-cols-2 gap-2' : 'grid gap-2'
            }
          >
            {prices.map((price) => {
              const original = getReferenceAmount(props.reference, price.kind)
              const discountLabel = formatDiscountLabel({
                t,
                language,
                locale,
                usd: price.current,
                original,
                format: props.format,
              })
              const direction = price.kind === 'output' ? ArrowUp : ArrowDown
              const Icon = price.kind === 'request' ? Layers3 : direction
              return (
                <div
                  key={price.kind}
                  className='bg-muted/45 rounded-lg px-2.5 py-1.5'
                >
                  <dt className='text-muted-foreground flex items-center justify-between gap-1 text-[11px] font-medium'>
                    <span className='inline-flex items-center gap-1'>
                      <Icon className='size-3 shrink-0' aria-hidden='true' />
                      {priceLabels[price.kind]}
                    </span>
                    {price.kind !== 'request' && (
                      <span className='text-[10px] font-normal'>
                        {t('Per 1M tokens')}
                      </span>
                    )}
                  </dt>
                  <dd className='mt-0.5 text-base leading-tight font-semibold tracking-tight tabular-nums'>
                    {props.format.quote(price.current)}
                  </dd>
                  {(original || discountLabel) && (
                    <dd className='mt-0.5 flex flex-wrap items-center justify-between gap-x-1.5 gap-y-0.5 text-[11px] leading-tight'>
                      {original && (
                        <span className='text-muted-foreground'>
                          {t('Official reference price')} ·{' '}
                          {props.format.reference(original)}
                        </span>
                      )}
                      {discountLabel && (
                        <Badge className='h-4 shrink-0 bg-emerald-500/12 px-1.5 py-0 text-[10px] font-medium text-emerald-800 dark:text-emerald-300'>
                          {discountLabel}
                        </Badge>
                      )}
                    </dd>
                  )}
                </div>
              )
            })}
          </dl>
        )}
        {source && extraReferenceKinds.length > 0 && (
          <dl className='text-muted-foreground space-y-1 text-[11px]'>
            {extraReferenceKinds.map((kind) => {
              const original = getReferenceAmount(source, kind)
              if (!original) return null
              return (
                <div key={kind} className='flex flex-wrap gap-1'>
                  <dt>
                    {t('Official reference price')} · {priceLabels[kind]}
                  </dt>
                  <dd>
                    {props.format.reference(original)}{' '}
                    {kind !== 'request' && t('Per 1M tokens')}
                  </dd>
                </div>
              )
            })}
          </dl>
        )}
      </CardContent>
      <CardFooter className='mt-auto border-0 bg-transparent px-3 pt-0 pb-2.5'>
        <ModelPerfBadge
          perf={props.perf}
          className='border-border/60 border-t pt-1.5'
        />
      </CardFooter>
    </Card>
  )
}

export function SharedModelsPage() {
  const { t, i18n } = useTranslation()
  const { status } = useStatus()
  const format = createQuoteFormatters(
    toIntlLocale(i18n.resolvedLanguage || i18n.language),
    status?.usd_exchange_rate
  )
  const [search, setSearch] = useState('')
  const pricing = useQuery(publicCatalog)
  const references = useQuery(publicReferencePrices)
  const data = pricing.data
  const allModelNames = useMemo(
    () =>
      (data?.data ?? [])
        .map((model) => model.model_name)
        .filter((name): name is string => Boolean(name)),
    [data?.data]
  )
  const perfQuery = useQuery({
    queryKey: ['shared-model-perf-metrics', 24, allModelNames],
    queryFn: ({ signal }) => getPublicPerfMetricsSummary(allModelNames, signal),
    enabled: allModelNames.length > 0,
    staleTime: 60_000,
    retry: false,
    meta: { errorToast: false },
  })
  const term = search.trim().toLowerCase()
  const models = (data?.data ?? []).flatMap((model) => {
    if (!data) return []
    const group = getPublicModelGroup(model, data.group_ratio)
    if (!group) return []
    const vendor = data.vendors?.find((item) => item.id === model.vendor_id)
    if (
      term &&
      ![model.model_name, vendor?.name, model.description].some((value) =>
        value?.toLowerCase().includes(term)
      )
    ) {
      return []
    }
    return [
      {
        model: {
          ...model,
          vendor_name: vendor?.name,
          vendor_icon: vendor?.icon,
          group_ratio: data.group_ratio,
        },
        group,
        ratio: data.group_ratio[group],
      },
    ]
  })
  return (
    <SharedPortalLayout wide>
      <section className='border-border/70 via-background to-background flex flex-col gap-3 rounded-2xl border bg-linear-to-br from-teal-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-3.5'>
        <div className='min-w-0'>
          <h1 className='text-xl font-semibold tracking-tight sm:text-2xl'>
            {t('Models and pricing')}
          </h1>
          <p className='text-muted-foreground mt-0.5 text-xs sm:text-sm'>
            {t('Compare our input and output rates with official prices.')}
          </p>
        </div>
        <div className='relative w-full shrink-0 sm:w-64 md:w-72'>
          <Search
            className='text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2'
            aria-hidden='true'
          />
          <Input
            className='bg-background h-9 ps-9 text-sm'
            type='search'
            aria-label={t('Search models')}
            placeholder={t('Search models')}
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </div>
      </section>
      {pricing.isPending && (
        <Skeleton
          className='mt-4 h-36 rounded-xl'
          aria-label={t('Loading...')}
        />
      )}
      {pricing.isError && (
        <Alert className='mt-4' variant='destructive'>
          <AlertDescription className='flex flex-wrap items-center gap-2'>
            {t('Could not load models.')}
            <Button variant='outline' onClick={() => void pricing.refetch()}>
              {t('Refresh')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {data && !models.length && (
        <p className='text-muted-foreground mt-5 text-sm' role='status'>
          {t('No models found')}
        </p>
      )}
      <div className='mt-3.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        {models.map(({ model, group, ratio }) => (
          <CatalogModel
            key={model.model_name}
            model={model}
            group={group}
            ratio={ratio}
            format={format}
            reference={references.data?.[model.model_name]}
            perf={perfQuery.data?.get(model.model_name)}
          />
        ))}
      </div>
    </SharedPortalLayout>
  )
}
