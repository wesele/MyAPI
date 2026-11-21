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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FieldLabel } from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import {
  getSurveySummary,
  getSurveyVote,
  publicSurveyResults,
  saveSurveyVote,
} from './api'
import { SharedPortalLayout } from './layout'
import {
  formatSurveyYuan,
  surveyAmounts,
  surveyLaunchGoal,
  surveySubscriptionLabel,
  type SurveyAmount,
} from './survey-amounts'
import { SurveyDistribution } from './survey-distribution'

const voteQueryKey = ['shared-survey-vote'] as const

export function SubscriptionSurvey() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const amountsId = useId()
  const [choice, setChoice] = useState<SurveyAmount>()
  const client = useQueryClient()
  const vote = useQuery({
    queryKey: voteQueryKey,
    queryFn: ({ signal }) => getSurveyVote(signal),
    meta: { errorToast: false },
  })
  const save = useMutation({
    mutationFn: saveSurveyVote,
    meta: { errorToast: false },
    onSuccess: (amount) => {
      setChoice(undefined)
      client.setQueryData(voteQueryKey, amount)
      void client.invalidateQueries({ queryKey: publicSurveyResults.queryKey })
    },
  })
  const selected = choice ?? vote.data

  return (
    <SharedPortalLayout wide>
      <section className='rounded-3xl bg-teal-950 px-6 py-8 text-teal-50 sm:px-9'>
        <p className='text-sm font-medium text-teal-100/80'>
          {t('Shared subscription survey')}
        </p>
        <h1 className='mt-1 font-mono text-4xl font-semibold tracking-tight sm:text-5xl'>
          OpenCode
        </h1>
        <p className='mt-4 text-sm leading-relaxed text-teal-50/85'>
          {t(
            'We’ll open shared subscriptions when {{target}} people have responded.',
            {
              target: formatNumber(surveyLaunchGoal, locale),
            }
          )}
        </p>
        <p className='mt-1 text-sm text-teal-100/80'>
          {t('This survey measures interest. No payment is required.')}
        </p>
      </section>

      <div className='mt-5 grid items-start gap-5 lg:grid-cols-2'>
        <Card className='border-border/70 rounded-2xl'>
          <CardContent className='px-5 sm:px-6'>
            <fieldset disabled={!vote.isSuccess || save.isPending}>
              <legend id={amountsId} className='mb-4 text-lg font-semibold'>
                {t('How much would you contribute?')}
              </legend>
              <RadioGroup
                aria-labelledby={amountsId}
                value={selected ?? 0}
                disabled={!vote.isSuccess || save.isPending}
                onValueChange={(value) => {
                  const amount = surveyAmounts.find((item) => item === value)
                  if (amount === undefined) return
                  setChoice(amount)
                  save.reset()
                }}
              >
                {surveyAmounts.map((amount) => (
                  <FieldLabel
                    key={amount}
                    htmlFor={`${amountsId}-${amount}`}
                    className='has-data-checked:border-primary has-data-checked:bg-accent/40 flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3'
                  >
                    <RadioGroupItem
                      id={`${amountsId}-${amount}`}
                      value={amount}
                    />
                    <span className='grid gap-1'>
                      <span className='text-base font-semibold tabular-nums'>
                        {formatSurveyYuan(t, amount, locale)}
                      </span>
                      <span className='text-muted-foreground text-xs font-normal'>
                        {surveySubscriptionLabel(t, amount, locale)}
                      </span>
                    </span>
                  </FieldLabel>
                ))}
              </RadioGroup>
            </fieldset>
            {vote.isPending && (
              <Spinner className='mt-4' aria-label={t('Loading...')} />
            )}
            {vote.isError && (
              <Button
                className='mt-4'
                variant='outline'
                onClick={() => void vote.refetch()}
              >
                {t('Refresh')}
              </Button>
            )}
            {vote.isSuccess && (
              <Button
                className='mt-4'
                disabled={!selected || selected === vote.data || save.isPending}
                onClick={() => {
                  if (selected) save.mutate(selected)
                }}
              >
                {t('Submit')}
              </Button>
            )}
            {vote.data !== undefined && vote.data > 0 && (
              <p className='mt-3 text-sm' role='status'>
                {t('Your response: {{amount}}', {
                  amount: formatSurveyYuan(t, vote.data, locale),
                })}
              </p>
            )}
            {save.isError && (
              <Alert className='mt-3' variant='destructive'>
                <AlertDescription>
                  {t('Could not save your response. Try again.')}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
        <SurveyDistribution />
      </div>
    </SharedPortalLayout>
  )
}

export function SubscriptionSurveySummary() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const summary = useQuery({
    queryKey: ['shared-survey-summary'],
    queryFn: getSurveySummary,
    retry: false,
    meta: { errorToast: false },
  })
  const total =
    summary.data?.reduce((sum, vote) => sum + vote.amount * vote.count, 0) ?? 0
  return (
    <SharedPortalLayout>
      <h1 className='text-3xl font-bold tracking-tight'>
        {t('Survey results')} · OpenCode
      </h1>
      {summary.isPending && (
        <Spinner className='mt-4' aria-label={t('Loading...')} />
      )}
      {summary.isError && (
        <Alert className='mt-4' variant='destructive'>
          <AlertDescription>
            {t('Could not load survey results.')}
          </AlertDescription>
        </Alert>
      )}
      {summary.data && (
        <div className='bg-background mt-6 rounded-xl border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Amount')}</TableHead>
                <TableHead>{t('Responses')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {surveyAmounts.map((amount) => (
                <TableRow key={amount}>
                  <TableCell>{formatSurveyYuan(t, amount, locale)}</TableCell>
                  <TableCell>
                    {formatNumber(
                      summary.data?.find((entry) => entry.amount === amount)
                        ?.count ?? 0,
                      locale
                    )}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell>{t('Total pledged')}</TableCell>
                <TableCell>{formatSurveyYuan(t, total, locale)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </SharedPortalLayout>
  )
}
