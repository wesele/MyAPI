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
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { PortalHighlights } from '@/features/shared-portal/highlights'
import { SharedPortalLayout } from '@/features/shared-portal/layout'

import { startKeyUsage } from './api'

type ErrorKind =
  | 'invalid'
  | 'unauthorized'
  | 'rateLimited'
  | 'unavailable'
  | 'blocked'

export function KeyUsagePage() {
  const { t } = useTranslation()
  const [error, setError] = useState<ErrorKind>()
  const [pending, setPending] = useState(false)

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const key = String(new FormData(form).get('key') ?? '').trim()
    if (!/^\S+$/.test(key)) {
      setError('invalid')
      return
    }
    const tab = window.open('about:blank', '_blank')
    if (!tab) {
      setError('blocked')
      return
    }
    tab.opener = null
    setPending(true)
    setError(undefined)
    const result = await startKeyUsage(key)
    setPending(false)
    if (!result.ok) {
      tab.close()
      setError(result.error)
      return
    }
    form.reset()
    tab.location.replace(`/key-usage/${result.data.id}`)
  }

  const errors = {
    invalid: t('Enter your API Key without spaces.'),
    unauthorized: t('This API Key is invalid or unavailable.'),
    rateLimited: t('Too many queries. Try again shortly.'),
    unavailable: t('Could not query this API Key. Try again.'),
    blocked: t('Allow new tabs for this site and try again.'),
  }

  return (
    <SharedPortalLayout wide>
      <section className='border-border/70 bg-background rounded-3xl border px-5 py-8 sm:px-10 sm:py-10'>
        <h1 className='text-foreground text-3xl font-semibold tracking-tight sm:text-4xl'>
          {t('Check API Key usage')}
        </h1>
        <form
          method='post'
          noValidate
          onSubmit={lookup}
          className='mt-5 max-w-2xl'
        >
          <Field data-invalid={error === 'invalid'}>
            <FieldLabel htmlFor='usage-key' className='sr-only'>
              {t('API Key')}
            </FieldLabel>
            <div className='flex items-start gap-2'>
              <Input
                id='usage-key'
                name='key'
                type='password'
                maxLength={256}
                autoComplete='off'
                autoCapitalize='none'
                spellCheck={false}
                aria-invalid={error === 'invalid'}
                aria-describedby={
                  error === 'invalid' ? 'usage-key-error' : undefined
                }
                placeholder={t('Paste your API Key')}
                className='h-11 min-w-0 flex-1 text-base'
                onChange={() => setError(undefined)}
              />
              <Button type='submit' className='h-11 px-4' disabled={pending}>
                {pending && <Spinner aria-hidden='true' />}
                {pending ? t('Querying...') : t('Query')}
              </Button>
            </div>
            {error === 'invalid' && (
              <FieldError id='usage-key-error'>{errors.invalid}</FieldError>
            )}
          </Field>
        </form>
        {error && error !== 'invalid' && (
          <Alert variant='destructive' className='mt-4'>
            <AlertDescription>{errors[error]}</AlertDescription>
          </Alert>
        )}
      </section>
      <PortalHighlights />
    </SharedPortalLayout>
  )
}
