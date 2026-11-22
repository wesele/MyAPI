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
import { AlertTriangle, RefreshCw, Terminal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { ModelPerfBadge } from '@/features/pricing/components/model-perf-badge'
import {
  getPublicPerfMetricsSummary,
  publicCatalog,
} from '@/features/shared-portal/api'
import { useStatus } from '@/hooks/use-status'
import { useSystemConfig } from '@/hooks/use-system-config'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'

import {
  getStoredTrialKey,
  matchesMaskedKey,
  refillTrialKey,
  type KeyLog,
  type KeyUsage,
  type LookupResult,
  type TrialRefillStatus,
} from './api'

type ModelTotals = {
  count: number
  input: number
  output: number
  quota: number
}

type RefillFeedback = {
  type: 'success' | 'error'
  text: string
}

function getBaseOrigin(serverAddress?: unknown): string {
  if (typeof serverAddress === 'string' && serverAddress.trim()) {
    return serverAddress.trim().replace(/\/+$/, '')
  }
  if (typeof window !== 'undefined') {
    return window.location.origin
  }
  return ''
}

function formatDateTime(timestampSec: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestampSec * 1000)
}

function getRefillHint(
  refill: TrialRefillStatus,
  locale: string,
  t: (key: string, options?: Record<string, string>) => string
): string {
  if (refill.next_refill_at > 0) {
    return t(
      'Free refill is available once per week. Next refill available on {{date}}.',
      {
        date: formatDateTime(refill.next_refill_at, locale),
      }
    )
  }
  if (refill.already_full) {
    return t('Quota is already full (¥1).')
  }
  return t('Reset quota to ¥1 for free (once per week)')
}

export function KeyUsageResults(props: {
  lookupId: string
  usage: KeyUsage
  logs: LookupResult<KeyLog[]> | null
  onUsageUpdated?: () => void
}) {
  const { t, i18n } = useTranslation()
  const { loading } = useSystemConfig()
  const { status } = useStatus()
  const usage = props.usage
  const expiry = usage.expires_at * 1000
  const expired = expiry > 0 && expiry <= Date.now()
  const exhausted = !usage.unlimited_quota && usage.total_available <= 0
  const permittedModels = Object.keys(usage.model_limits).filter(
    (model) => usage.model_limits[model]
  )
  const catalog = useQuery({
    ...publicCatalog,
    retry: false,
    enabled: !usage.model_limits_enabled || permittedModels.length === 0,
  })
  const [refillPending, setRefillPending] = useState(false)
  const [refillFeedback, setRefillFeedback] = useState<RefillFeedback | null>(
    null
  )
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const amount = (quota: number) =>
    loading ? '—' : formatQuotaWithCurrency(quota, { locale })

  const storedTrialKey = getStoredTrialKey()
  const matchedKey =
    storedTrialKey && matchesMaskedKey(storedTrialKey, usage.masked_key)
      ? storedTrialKey
      : null

  const baseOrigin = getBaseOrigin(status?.server_address)
  const apiBaseUrl = `${baseOrigin}/v1`

  let firstConfiguredModel = catalog.data?.data?.[0]?.model_name
  if (usage.model_limits_enabled && permittedModels.length > 0) {
    firstConfiguredModel = permittedModels[0]
  }
  const exampleModel = firstConfiguredModel || 'gpt-6-luna'
  const displayedKeyValue = matchedKey ?? usage.masked_key ?? 'YOUR_API_KEY'

  async function handleRefill() {
    if (refillPending) return
    setRefillPending(true)
    setRefillFeedback(null)
    const result = await refillTrialKey(props.lookupId)
    setRefillPending(false)

    if (result.ok) {
      setRefillFeedback({
        type: 'success',
        text: t('Quota refilled to ¥1.'),
      })
      props.onUsageUpdated?.()
      return
    }

    if (result.error === 'alreadyFull') {
      setRefillFeedback({
        type: 'error',
        text: t('Quota is already full (¥1).'),
      })
      props.onUsageUpdated?.()
      return
    }
    if (result.error === 'cooldown') {
      const dateText = result.nextRefillAt
        ? formatDateTime(result.nextRefillAt, locale)
        : '—'
      setRefillFeedback({
        type: 'error',
        text: t(
          'Free refill is available once per week. Next refill available on {{date}}.',
          { date: dateText }
        ),
      })
      props.onUsageUpdated?.()
      return
    }
    if (result.error === 'notEligible') {
      setRefillFeedback({
        type: 'error',
        text: t('This API Key is not eligible for free weekly refills.'),
      })
      return
    }
    if (result.error === 'rateLimited') {
      setRefillFeedback({
        type: 'error',
        text: t('Too many queries. Try again shortly.'),
      })
      return
    }
    setRefillFeedback({
      type: 'error',
      text: t('Could not refill quota. Try again.'),
    })
  }

  let statusBadge = <Badge variant='outline'>{t('Active')}</Badge>
  if (expired) {
    statusBadge = <Badge variant='secondary'>{t('Expired')}</Badge>
  } else if (exhausted) {
    statusBadge = <Badge variant='secondary'>{t('Exhausted')}</Badge>
  }

  const refill = usage.trial_refill

  return (
    <div className='mt-6 space-y-5'>
      <div className='grid gap-5 lg:grid-cols-12'>
        <Card
          data-card-hover='false'
          className='bg-primary/5 flex flex-col lg:col-span-5'
        >
          <CardContent className='flex flex-1 flex-col justify-between gap-5 pt-6'>
            <div className='space-y-4'>
              <div className='flex flex-wrap items-start justify-between gap-2'>
                <div>
                  <h2 className='text-muted-foreground text-sm font-medium'>
                    {t('Remaining quota')}
                  </h2>
                  <p className='mt-1 text-4xl font-semibold tracking-tight tabular-nums'>
                    {usage.unlimited_quota
                      ? t('Unlimited')
                      : amount(Math.max(0, usage.total_available))}
                  </p>
                </div>
                {statusBadge}
              </div>

              {refill?.eligible && (
                <div className='bg-background/80 space-y-2.5 rounded-2xl border p-3.5'>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <p className='text-muted-foreground text-xs'>
                      {getRefillHint(refill, locale, t)}
                    </p>
                    <Button
                      type='button'
                      size='sm'
                      disabled={!refill.can_refill || refillPending}
                      onClick={() => void handleRefill()}
                    >
                      {refillPending ? (
                        <Spinner aria-hidden='true' />
                      ) : (
                        <RefreshCw className='size-3.5' aria-hidden='true' />
                      )}
                      {refillPending ? t('Refilling...') : t('Free refill')}
                    </Button>
                  </div>
                  {refillFeedback && (
                    <Alert
                      variant={
                        refillFeedback.type === 'error'
                          ? 'destructive'
                          : 'default'
                      }
                    >
                      <AlertDescription>{refillFeedback.text}</AlertDescription>
                    </Alert>
                  )}
                </div>
              )}

              <dl className='space-y-2 border-t pt-4 text-sm'>
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
                  <dt className='text-muted-foreground'>
                    {t('Expiration Time')}
                  </dt>
                  <dd className='font-medium'>
                    {expiry
                      ? new Intl.DateTimeFormat(locale, {
                          dateStyle: 'medium',
                        }).format(expiry)
                      : t('Never expires')}
                  </dd>
                </div>
              </dl>
            </div>

            <dl className='flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t pt-4 text-sm'>
              <dt className='text-muted-foreground'>{t('Available Models')}</dt>
              <dd className='min-w-0 font-medium wrap-anywhere'>
                {usage.model_limits_enabled
                  ? permittedModels.join(', ') || '—'
                  : t('All models')}
              </dd>
            </dl>
          </CardContent>
        </Card>

        <Card data-card-hover='false' className='lg:col-span-7'>
          <CardHeader className='pb-3'>
            <div className='flex items-center gap-2'>
              <Terminal className='text-primary size-5' aria-hidden='true' />
              <CardTitle className='text-lg'>{t('Usage example')}</CardTitle>
            </div>
            <CardDescription>
              {t(
                'Use the API URL, Key, and model below in any OpenAI-compatible client.'
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <dl className='divide-y rounded-xl border'>
              <div className='flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-sm'>
                <dt className='text-muted-foreground font-medium'>
                  {t('API URL (Base URL)')}
                </dt>
                <dd className='flex min-w-0 items-center gap-2'>
                  <code className='font-mono text-xs break-all sm:text-sm'>
                    {apiBaseUrl}
                  </code>
                  <CopyButton
                    value={apiBaseUrl}
                    variant='outline'
                    size='sm'
                    aria-label={t('API URL (Base URL)')}
                  >
                    {t('Copy')}
                  </CopyButton>
                </dd>
              </div>
              <div className='flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-sm'>
                <dt className='text-muted-foreground font-medium'>
                  {t('API Key')}
                </dt>
                <dd className='flex min-w-0 items-center gap-2'>
                  <code className='font-mono text-xs break-all sm:text-sm'>
                    {displayedKeyValue}
                  </code>
                  {matchedKey && (
                    <CopyButton
                      value={matchedKey}
                      variant='outline'
                      size='sm'
                      aria-label={t('API Key')}
                    >
                      {t('Copy')}
                    </CopyButton>
                  )}
                </dd>
              </div>
              <div className='space-y-1 px-3.5 py-2.5 text-sm'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <dt className='text-muted-foreground font-medium'>
                    {t('Model')}
                  </dt>
                  <dd className='flex min-w-0 items-center gap-2'>
                    <code className='font-mono text-xs break-all sm:text-sm'>
                      {exampleModel}
                    </code>
                    <CopyButton
                      value={exampleModel}
                      variant='outline'
                      size='sm'
                      aria-label={t('Model')}
                    >
                      {t('Copy')}
                    </CopyButton>
                  </dd>
                </div>
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'Shows the first configured model by default; you can switch to other available models.'
                  )}{' '}
                  <Link
                    to='/catalog'
                    className='text-foreground underline underline-offset-3'
                  >
                    {t('View all models')}
                  </Link>
                </p>
              </div>
            </dl>

            <Alert className='border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200'>
              <AlertTriangle aria-hidden='true' />
              <AlertDescription className='text-amber-800 dark:text-amber-200'>
                {t(
                  'Low-quota Keys are not recommended for Hermes or coding Agents—they will drain in seconds. Best suited for non-Agent tasks like translation.'
                )}
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>

      <RecordedUsage logs={props.logs} formatAmount={amount} />
    </div>
  )
}

function RecordedUsage(props: {
  logs: LookupResult<KeyLog[]> | null
  formatAmount: (quota: number) => string
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const logs = useMemo(
    () => (props.logs?.ok ? props.logs.data : []),
    [props.logs]
  )
  const models = useMemo(() => {
    const map = new Map<string, ModelTotals>()
    for (const log of logs) {
      const totals = map.get(log.model_name) ?? {
        count: 0,
        input: 0,
        output: 0,
        quota: 0,
      }
      totals.count += 1
      totals.input += log.prompt_tokens
      totals.output += log.completion_tokens
      totals.quota += log.quota
      map.set(log.model_name, totals)
    }
    return map
  }, [logs])
  const modelNames = useMemo(() => [...models.keys()].filter(Boolean), [models])
  const perfQuery = useQuery({
    queryKey: ['shared-model-perf-metrics', 24, modelNames],
    queryFn: ({ signal }) => getPublicPerfMetricsSummary(modelNames, signal),
    enabled: modelNames.length > 0,
    staleTime: 60_000,
    retry: false,
    meta: { errorToast: false },
  })
  const dateTime = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return (
    <Card data-card-hover='false'>
      <CardContent className='space-y-3 pt-6'>
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
            <ul className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
              {Array.from(models, ([model, totals]) => (
                <li
                  key={model}
                  className='bg-muted/35 flex h-full flex-col gap-2.5 rounded-xl border p-3'
                >
                  <p className='font-mono text-sm font-medium wrap-anywhere'>
                    {model || '—'}
                  </p>
                  <dl className='grid grid-cols-2 gap-x-2 gap-y-2 text-sm sm:grid-cols-4'>
                    <div>
                      <dt className='text-muted-foreground text-xs'>
                        {t('Call count')}
                      </dt>
                      <dd className='font-medium tabular-nums'>
                        {formatNumber(totals.count, locale)}
                      </dd>
                    </div>
                    <div>
                      <dt className='text-muted-foreground text-xs'>
                        {t('Input tokens')}
                      </dt>
                      <dd className='font-medium tabular-nums'>
                        {formatNumber(totals.input, locale)}
                      </dd>
                    </div>
                    <div>
                      <dt className='text-muted-foreground text-xs'>
                        {t('Output tokens')}
                      </dt>
                      <dd className='font-medium tabular-nums'>
                        {formatNumber(totals.output, locale)}
                      </dd>
                    </div>
                    <div>
                      <dt className='text-muted-foreground text-xs'>
                        {t('Total spent')}
                      </dt>
                      <dd className='font-medium tabular-nums'>
                        {props.formatAmount(totals.quota)}
                      </dd>
                    </div>
                  </dl>
                  <ModelPerfBadge
                    perf={perfQuery.data?.get(model)}
                    className='border-border/60 mt-auto border-t pt-2'
                  />
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
                        <span className='font-mono wrap-anywhere'>
                          {log.model_name}
                        </span>
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
