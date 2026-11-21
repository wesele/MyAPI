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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ModelPriceCell } from '@/features/pricing/components/model-price-cell'
import type { PricingModel } from '@/features/pricing/types'
import { useStatus } from '@/hooks/use-status'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { getLobeIcon } from '@/lib/lobe-icon'

import {
  publicCatalog,
  publicReferencePrices,
  type ReferencePrice,
} from './api'
import { SharedPortalLayout } from './layout'
import {
  comparablePrices,
  createQuoteFormatters,
  getPublicModelGroup,
  getReferenceAmount,
  referencePriceKinds,
} from './pricing'

function CatalogModel(props: {
  model: PricingModel
  group: string
  ratio: number
  reference?: ReferencePrice
  format: ReturnType<typeof createQuoteFormatters>
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const prices = comparablePrices(props.model, props.ratio)
  const iconName = props.model.icon || props.model.vendor_icon
  const icon = iconName ? getLobeIcon(iconName, 24) : null
  const priceLabels = {
    input: t('Input'),
    output: t('Output'),
    request: t('Per request'),
  }
  const source = props.reference

  return (
    <Card className='border-border/75 rounded-2xl py-5'>
      <CardHeader className='flex items-start gap-3 px-5'>
        <span className='bg-accent text-accent-foreground grid size-11 shrink-0 place-items-center rounded-xl'>
          {icon ?? <Layers3 className='size-5' aria-hidden='true' />}
        </span>
        <div className='min-w-0'>
          <CardTitle className='font-mono text-lg font-semibold wrap-anywhere sm:text-xl'>
            {props.model.model_name}
          </CardTitle>
          {props.model.vendor_name && (
            <p className='text-muted-foreground mt-1 text-sm'>
              {props.model.vendor_name}
            </p>
          )}
        </div>
      </CardHeader>
      <CardContent className='space-y-4 px-5'>
        {props.model.description && (
          <p className='text-muted-foreground text-sm leading-relaxed'>
            {props.model.description}
          </p>
        )}
        {Boolean(props.model.context_length) && (
          <Badge variant='outline'>
            {t('Context Window')} ·{' '}
            {formatNumber(props.model.context_length, locale)}
          </Badge>
        )}
        {prices.length === 0 ? (
          <div className='bg-muted/40 rounded-xl p-3'>
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
          <dl className='grid gap-2 sm:grid-cols-2'>
            {prices.map((price) => {
              const original = getReferenceAmount(props.reference, price.kind)
              const discount = props.format.discount(price.current, original)
              const direction = price.kind === 'output' ? ArrowUp : ArrowDown
              const Icon = price.kind === 'request' ? Layers3 : direction
              return (
                <div key={price.kind} className='bg-muted/45 rounded-xl p-3'>
                  <dt className='text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs font-medium'>
                    <Icon className='size-3.5' aria-hidden='true' />
                    {priceLabels[price.kind]}
                  </dt>
                  <dd className='mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1'>
                    <span className='text-2xl font-semibold tracking-tight tabular-nums'>
                      {props.format.quote(price.current)}
                    </span>
                    {price.kind !== 'request' && (
                      <span className='text-muted-foreground text-xs'>
                        {t('Per 1M tokens')}
                      </span>
                    )}
                    {discount !== undefined && discount > 0 && (
                      <Badge className='bg-emerald-500/12 text-emerald-800 dark:text-emerald-300'>
                        {t('{{discount}}% off', {
                          discount: formatNumber(discount, locale),
                        })}
                      </Badge>
                    )}
                  </dd>
                  {original && (
                    <dd className='text-muted-foreground mt-1 text-xs'>
                      {t('Official reference price')} ·{' '}
                      {props.format.reference(original)}
                    </dd>
                  )}
                </div>
              )
            })}
          </dl>
        )}
        {source && (
          <dl className='text-muted-foreground space-y-1 text-xs'>
            {referencePriceKinds.map((kind) => {
              const original = getReferenceAmount(source, kind)
              if (!original || prices.some((price) => price.kind === kind)) {
                return null
              }
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
        {source && (
          <div className='text-muted-foreground flex flex-wrap gap-x-2 gap-y-1 text-xs'>
            <a
              href={source.source}
              className='text-foreground underline underline-offset-3'
              target='_blank'
              rel='noreferrer'
            >
              {t('Source')}
            </a>
            {source.max_input_tokens && (
              <span>
                {t('Input')} ≤ {formatNumber(source.max_input_tokens, locale)}{' '}
                {t('tokens')}
              </span>
            )}
            <time dateTime={source.checked}>{source.checked}</time>
          </div>
        )}
      </CardContent>
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
      <section className='border-border/70 via-background to-background rounded-3xl border bg-linear-to-br from-teal-500/10 px-5 py-7 sm:px-8 sm:py-9'>
        <h1 className='text-3xl font-semibold tracking-tight sm:text-4xl'>
          {t('Models and pricing')}
        </h1>
        <p className='text-muted-foreground mt-2 text-sm'>
          {t('Compare our input and output rates with official prices.')}
        </p>
        <div className='relative mt-5 max-w-md'>
          <Search
            className='text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2'
            aria-hidden='true'
          />
          <Input
            className='bg-background h-11 ps-9'
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
          className='mt-5 h-44 rounded-2xl'
          aria-label={t('Loading...')}
        />
      )}
      {pricing.isError && (
        <Alert className='mt-5' variant='destructive'>
          <AlertDescription className='flex flex-wrap items-center gap-2'>
            {t('Could not load models.')}
            <Button variant='outline' onClick={() => void pricing.refetch()}>
              {t('Refresh')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {data && !models.length && (
        <p className='text-muted-foreground mt-6' role='status'>
          {t('No models found')}
        </p>
      )}
      <div className='mt-5 grid gap-4 lg:grid-cols-2'>
        {models.map(({ model, group, ratio }) => (
          <CatalogModel
            key={model.model_name}
            model={model}
            group={group}
            ratio={ratio}
            format={format}
            reference={references.data?.[model.model_name]}
          />
        ))}
      </div>
    </SharedPortalLayout>
  )
}
