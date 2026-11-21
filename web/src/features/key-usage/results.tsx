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
import { useTranslation } from 'react-i18next'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { useSystemConfig } from '@/hooks/use-system-config'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'

import type { KeyLog, KeyUsage, LookupResult } from './api'

type ModelTotals = { input: number; output: number }

export function KeyUsageResults(props: {
  usage: KeyUsage
  logs: LookupResult<KeyLog[]> | null
}) {
  const { t, i18n } = useTranslation()
  const { loading } = useSystemConfig()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const usage = props.usage
  const expiry = usage.expires_at * 1000
  const expired = expiry > 0 && expiry <= Date.now()
  const exhausted = !usage.unlimited_quota && usage.total_available <= 0
  const permittedModels = Object.keys(usage.model_limits).filter(
    (model) => usage.model_limits[model]
  )
  const amount = (quota: number) =>
    loading ? '—' : formatQuotaWithCurrency(quota, { locale })

  return (
    <div className='mt-6 space-y-4'>
      <Card data-card-hover='false' className='bg-primary/5'>
        <CardContent className='grid gap-4 sm:grid-cols-2 sm:items-center'>
          <div>
            <h2 className='text-muted-foreground text-sm font-medium'>
              {t('Remaining quota')}
            </h2>
            <p className='mt-1 text-4xl font-semibold tracking-tight tabular-nums'>
              {usage.unlimited_quota
                ? t('Unlimited')
                : amount(Math.max(0, usage.total_available))}
            </p>
            {expired && (
              <Badge variant='secondary' className='mt-2'>
                {t('Expired')}
              </Badge>
            )}
            {!expired && exhausted && (
              <Badge variant='secondary' className='mt-2'>
                {t('Exhausted')}
              </Badge>
            )}
          </div>
          <dl className='space-y-1.5 text-sm'>
            <div className='flex flex-wrap justify-between gap-x-3'>
              <dt className='text-muted-foreground'>{t('Used Quota')}</dt>
              <dd className='font-medium tabular-nums'>
                {amount(usage.total_used)}
              </dd>
            </div>
            <div className='flex flex-wrap justify-between gap-x-3'>
              <dt className='text-muted-foreground'>{t('Total Quota')}</dt>
              <dd className='font-medium tabular-nums'>
                {usage.unlimited_quota
                  ? t('Unlimited')
                  : amount(usage.total_granted)}
              </dd>
            </div>
            <div className='flex flex-wrap justify-between gap-x-3'>
              <dt className='text-muted-foreground'>{t('Expiration Time')}</dt>
              <dd className='font-medium'>
                {expiry
                  ? new Intl.DateTimeFormat(locale, {
                      dateStyle: 'medium',
                    }).format(expiry)
                  : t('Never expires')}
              </dd>
            </div>
          </dl>
          <dl className='flex flex-wrap gap-x-3 border-t pt-3 text-sm sm:col-span-2'>
            <dt className='text-muted-foreground'>{t('Available Models')}</dt>
            <dd className='min-w-0 font-medium wrap-anywhere'>
              {usage.model_limits_enabled
                ? permittedModels.join(', ') || '—'
                : t('All models')}
            </dd>
          </dl>
        </CardContent>
      </Card>
      <RecordedUsage logs={props.logs} />
    </div>
  )
}

function RecordedUsage(props: { logs: LookupResult<KeyLog[]> | null }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const logs = props.logs?.ok ? props.logs.data : []
  const models = new Map<string, ModelTotals>()
  for (const log of logs) {
    const totals = models.get(log.model_name) ?? { input: 0, output: 0 }
    totals.input += log.prompt_tokens
    totals.output += log.completion_tokens
    models.set(log.model_name, totals)
  }
  const dateTime = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return (
    <Card data-card-hover='false'>
      <CardContent className='space-y-3'>
        <div className='flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1'>
          <h2 className='text-base font-semibold'>{t('Model usage')}</h2>
          <p className='text-muted-foreground text-sm'>
            {t('Recent recorded requests')}
          </p>
        </div>
        {props.logs === null && (
          <p className='text-muted-foreground text-sm'>{t('Loading...')}</p>
        )}
        {props.logs && !props.logs.ok && (
          <p className='text-muted-foreground text-sm'>
            {t('Could not load recent usage.')}
          </p>
        )}
        {props.logs?.ok && logs.length === 0 && (
          <p className='text-muted-foreground text-sm'>
            {t('No recent usage records.')}
          </p>
        )}
        {logs.length > 0 && (
          <>
            <ul className='divide-y'>
              {Array.from(models, ([model, totals]) => (
                <li key={model} className='space-y-2 py-2'>
                  <p className='font-medium wrap-anywhere'>{model || '—'}</p>
                  <dl className='grid grid-cols-2 gap-2 text-sm'>
                    <div>
                      <dt className='text-muted-foreground'>
                        {t('Input tokens')}
                      </dt>
                      <dd className='font-medium tabular-nums'>
                        {formatNumber(totals.input, locale)}
                      </dd>
                    </div>
                    <div>
                      <dt className='text-muted-foreground'>
                        {t('Output tokens')}
                      </dt>
                      <dd className='font-medium tabular-nums'>
                        {formatNumber(totals.output, locale)}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
            <Accordion className='border-t'>
              <AccordionItem>
                <AccordionTrigger>
                  {t('Recent request details')}
                </AccordionTrigger>
                <AccordionContent>
                  <ul className='divide-y'>
                    {logs.slice(0, 10).map((log) => (
                      <li
                        key={log.id}
                        className='flex flex-wrap justify-between gap-x-3 gap-y-1 py-2 text-sm'
                      >
                        <span className='text-muted-foreground'>
                          {dateTime.format(log.created_at * 1000)}
                        </span>
                        <span className='wrap-anywhere'>{log.model_name}</span>
                        <span className='tabular-nums'>
                          {t('Input tokens')}{' '}
                          {formatNumber(log.prompt_tokens, locale)}
                          {' · '}
                          {t('Output tokens')}{' '}
                          {formatNumber(log.completion_tokens, locale)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </>
        )}
      </CardContent>
    </Card>
  )
}
