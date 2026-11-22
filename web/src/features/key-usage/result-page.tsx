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
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { SharedPortalLayout } from '@/features/shared-portal/layout'

import { fetchKeyLogs, fetchKeyUsage } from './api'
import { KeyUsageResults } from './results'

export function KeyUsageResultPage(props: { lookupId: string }) {
  const { t } = useTranslation()
  const usage = useQuery({
    queryKey: ['shared-key-usage', props.lookupId, 'totals'],
    queryFn: ({ signal }) => fetchKeyUsage(props.lookupId, signal),
    gcTime: 0,
  })
  const logs = useQuery({
    queryKey: ['shared-key-usage', props.lookupId, 'logs'],
    queryFn: ({ signal }) => fetchKeyLogs(props.lookupId, signal),
    gcTime: 0,
  })
  const pending = usage.isFetching || logs.isFetching
  const expired =
    usage.data?.ok === false && usage.data.error === 'unauthorized'
  let message: string | undefined
  if (expired) {
    message = t('This query has expired or the API Key is no longer available.')
  } else if (usage.data?.ok === false) {
    message =
      usage.data.error === 'rateLimited'
        ? t('Too many queries. Try again shortly.')
        : t('Could not query this API Key. Try again.')
  }

  const isDirectTrial = Boolean(
    usage.data?.ok && usage.data.data.trial_refill?.eligible
  )

  return (
    <SharedPortalLayout wide>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex flex-wrap items-center gap-2.5'>
          <h1 className='text-3xl font-bold tracking-tight'>
            {t('API Key usage')}
          </h1>
          {isDirectTrial && (
            <Badge variant='secondary'>{t('Direct · Free Trial')}</Badge>
          )}
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          {!expired && (
            <Link to='/' className={buttonVariants({ variant: 'outline' })}>
              {t('New query')}
            </Link>
          )}
          {expired ? (
            <Link to='/' className={buttonVariants()}>
              {t('New query')}
            </Link>
          ) : (
            <Button
              variant='outline'
              disabled={pending}
              onClick={() => {
                void usage.refetch()
                void logs.refetch()
              }}
            >
              {pending && <Spinner aria-hidden='true' />}
              {t('Refresh')}
            </Button>
          )}
        </div>
      </div>
      {message && (
        <Alert variant='destructive' className='mt-4'>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      <div aria-live='polite' aria-busy={pending}>
        {usage.data?.ok && (
          <KeyUsageResults
            lookupId={props.lookupId}
            usage={usage.data.data}
            logs={logs.data ?? null}
            onUsageUpdated={() => {
              void usage.refetch()
            }}
          />
        )}
      </div>
    </SharedPortalLayout>
  )
}
