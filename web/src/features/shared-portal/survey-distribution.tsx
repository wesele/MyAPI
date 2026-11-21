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
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { publicSurveyResults } from './api'
import {
  formatSurveyYuan,
  surveyAmounts,
  surveyLaunchGoal,
} from './survey-amounts'

const colors = ['bg-teal-500', 'bg-sky-500', 'bg-violet-500'] as const

export function SurveyDistribution() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const results = useQuery({ ...publicSurveyResults, refetchInterval: 30_000 })
  const entries = results.data
  const total = entries?.reduce((sum, entry) => sum + entry.count, 0) ?? 0
  const progress = t('{{current}} of {{target}} participants', {
    current: formatNumber(total, locale),
    target: formatNumber(surveyLaunchGoal, locale),
  })
  return (
    <Card className='border-border/70 rounded-2xl'>
      <CardHeader className='px-5 sm:px-6'>
        <CardTitle className='text-lg font-semibold'>
          {t('Survey results')}
        </CardTitle>
      </CardHeader>
      <CardContent className='px-5 sm:px-6'>
        {results.isPending && (
          <Skeleton className='h-36 rounded-xl' aria-label={t('Loading...')} />
        )}
        {results.isError && !results.data && (
          <Alert variant='destructive'>
            <AlertDescription className='flex flex-wrap items-center gap-2'>
              {t('Could not load survey results.')}
              <Button variant='outline' onClick={() => void results.refetch()}>
                {t('Refresh')}
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {entries && (
          <>
            <div className='bg-muted/50 mb-5 rounded-xl p-3.5'>
              <p className='font-semibold tabular-nums' aria-live='polite'>
                {progress}
              </p>
              <div
                className='bg-background mt-2 h-2 overflow-hidden rounded-full'
                aria-hidden='true'
              >
                <div
                  className='h-full rounded-full bg-teal-500 transition-[width] motion-reduce:transition-none'
                  style={{
                    width: `${Math.min(total / surveyLaunchGoal, 1) * 100}%`,
                  }}
                />
              </div>
              {total >= surveyLaunchGoal && (
                <p className='text-muted-foreground mt-2 text-xs'>
                  {t('Launch goal reached')}
                </p>
              )}
            </div>
            <ul className='space-y-3' aria-label={t('Responses by amount')}>
              {surveyAmounts.map((amount, index) => {
                const count =
                  entries.find((entry) => entry.amount === amount)?.count ?? 0
                return (
                  <li key={amount}>
                    <div className='mb-1 flex flex-wrap items-center justify-between gap-x-2 text-sm tabular-nums'>
                      <span className='font-medium'>
                        {formatSurveyYuan(t, amount, locale)}
                      </span>
                      <span className='text-muted-foreground'>
                        {t('Responses')}{' '}
                        <strong className='text-foreground'>
                          {formatNumber(count, locale)}
                        </strong>
                      </span>
                    </div>
                    <div
                      className='bg-muted h-2 overflow-hidden rounded-full'
                      aria-hidden='true'
                    >
                      <div
                        className={`h-full rounded-full transition-[width] motion-reduce:transition-none ${colors[index]}`}
                        style={{
                          width: `${total ? (count / total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}
