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
import { useNavigate } from '@tanstack/react-router'
import { ArrowRight, Gift, KeyRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { PortalHighlights } from '@/features/shared-portal/highlights'
import { SharedPortalLayout } from '@/features/shared-portal/layout'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

import {
  claimTrialKey,
  clearStoredTrialKey,
  fetchKeyUsage,
  getStoredTrialKey,
  redeemCode,
  setStoredTrialKey,
  startKeyUsage,
} from './api'

type ErrorKind =
  | 'invalid'
  | 'unauthorized'
  | 'rateLimited'
  | 'unavailable'
  | 'blocked'
  | 'redeemFailed'
  | 'redeemUnavailable'
  | 'trialAlreadyClaimed'
  | 'trialCooldown'
  | 'trialDailyLimit'
  | 'trialUnavailable'

type IssuedKeyDialogState = {
  key: string
  mode: 'redeem' | 'trial'
}

type StoredTrialStatus =
  | { state: 'unclaimed' }
  | { state: 'valid'; lookupId: string; key: string }
  | { state: 'inactive'; lookupId: string; key: string }
  | { state: 'unknown'; lookupId?: string; key: string }

const REDEMPTION_CODE_PATTERN = /^[0-9a-f]{32}$/i

export function KeyUsagePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [error, setError] = useState<ErrorKind>()
  const [pending, setPending] = useState(false)
  const [trialPending, setTrialPending] = useState(false)
  const [issuedDialog, setIssuedDialog] = useState<IssuedKeyDialogState | null>(
    null
  )
  const [storedTrialKey, setStoredTrialKeyState] = useState<string | null>(() =>
    getStoredTrialKey()
  )
  const { copyToClipboard } = useCopyToClipboard()

  const trialCheck = useQuery<StoredTrialStatus>({
    queryKey: ['shared-trial-key-status', storedTrialKey],
    enabled: Boolean(storedTrialKey),
    retry: false,
    gcTime: 0,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      if (!storedTrialKey) return { state: 'unclaimed' }
      const startResult = await startKeyUsage(storedTrialKey)
      if (!startResult.ok) {
        if (startResult.error === 'unauthorized') {
          clearStoredTrialKey()
          return { state: 'unclaimed' }
        }
        return { state: 'unknown', key: storedTrialKey }
      }
      const usageResult = await fetchKeyUsage(startResult.data.id, signal)
      if (!usageResult.ok) {
        if (usageResult.error === 'unauthorized') {
          clearStoredTrialKey()
          return { state: 'unclaimed' }
        }
        return {
          state: 'unknown',
          lookupId: startResult.data.id,
          key: storedTrialKey,
        }
      }
      const expiryMs = usageResult.data.expires_at * 1000
      const notExpired = expiryMs === 0 || expiryMs > Date.now()
      const hasQuota =
        usageResult.data.unlimited_quota || usageResult.data.total_available > 0
      if (notExpired && hasQuota) {
        return {
          state: 'valid',
          lookupId: startResult.data.id,
          key: storedTrialKey,
        }
      }
      return {
        state: 'inactive',
        lookupId: startResult.data.id,
        key: storedTrialKey,
      }
    },
  })

  const isCheckingTrial = Boolean(storedTrialKey) && trialCheck.isPending
  const claimedTrial =
    trialCheck.data?.state === 'valid' || trialCheck.data?.state === 'unknown'
      ? trialCheck.data
      : null
  const inactiveTrial =
    trialCheck.data?.state === 'inactive' ? trialCheck.data : null

  async function openClaimedTrialUsage(
    key: string,
    existingLookupId?: string
  ): Promise<void> {
    if (pending || trialPending) return
    if (existingLookupId) {
      await navigate({
        to: '/key-usage/$lookupId',
        params: { lookupId: existingLookupId },
      })
      return
    }
    setTrialPending(true)
    setError(undefined)
    const result = await startKeyUsage(key)
    setTrialPending(false)
    if (!result.ok) {
      if (result.error === 'unauthorized') {
        clearStoredTrialKey()
        setStoredTrialKeyState(null)
      }
      setError(result.error)
      return
    }
    await navigate({
      to: '/key-usage/$lookupId',
      params: { lookupId: result.data.id },
    })
  }

  async function submitInput(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const value = String(new FormData(form).get('key') ?? '').trim()
    if (!/^\S+$/.test(value)) {
      setError('invalid')
      return
    }

    if (REDEMPTION_CODE_PATTERN.test(value)) {
      setPending(true)
      setError(undefined)
      const result = await redeemCode(value)
      setPending(false)
      if (!result.ok) {
        if (result.error === 'unauthorized') {
          setError('redeemFailed')
        } else if (result.error === 'rateLimited') {
          setError('rateLimited')
        } else {
          setError('redeemUnavailable')
        }
        return
      }
      form.reset()
      setIssuedDialog({ key: result.data.key, mode: 'redeem' })
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
    const result = await startKeyUsage(value)
    setPending(false)
    if (!result.ok) {
      tab.close()
      setError(result.error)
      return
    }
    form.reset()
    tab.location.replace(`/key-usage/${result.data.id}`)
  }

  async function handleClaimTrial() {
    if (pending || trialPending || isCheckingTrial) return
    setTrialPending(true)
    setError(undefined)
    const result = await claimTrialKey()
    if (!result.ok) {
      setTrialPending(false)
      if (result.error === 'alreadyClaimed') {
        setError('trialAlreadyClaimed')
      } else if (result.error === 'ipCooldown') {
        setError('trialCooldown')
      } else if (result.error === 'dailyLimitReached') {
        setError('trialDailyLimit')
      } else {
        setError('trialUnavailable')
      }
      return
    }

    setStoredTrialKey(result.data.key)
    setStoredTrialKeyState(result.data.key)

    const usageResult = await startKeyUsage(result.data.key)
    setTrialPending(false)
    if (usageResult.ok) {
      await navigate({
        to: '/key-usage/$lookupId',
        params: { lookupId: usageResult.data.id },
      })
      return
    }
    setIssuedDialog({ key: result.data.key, mode: 'trial' })
  }

  async function handleCopyAndClose() {
    if (!issuedDialog) return
    const copied = await copyToClipboard(issuedDialog.key)
    if (copied) {
      setIssuedDialog(null)
    }
  }

  const errors: Record<ErrorKind, string> = {
    invalid: t('Enter your API Key or redemption code without spaces.'),
    unauthorized: t('This API Key is invalid or unavailable.'),
    rateLimited: t('Too many queries. Try again shortly.'),
    unavailable: t('Could not query this API Key. Try again.'),
    blocked: t('Allow new tabs for this site and try again.'),
    redeemFailed: t('This redemption code is invalid or unavailable.'),
    redeemUnavailable: t('Could not redeem this code. Try again.'),
    trialAlreadyClaimed: t('You have already claimed a free trial API key.'),
    trialCooldown: t(
      'Too many claims from this IP. Please try again in 10 minutes.'
    ),
    trialDailyLimit: t(
      "Today's free trial keys have been fully claimed. Please try again tomorrow."
    ),
    trialUnavailable: t('Could not claim a free trial API key. Try again.'),
  }

  const dialogTitle =
    issuedDialog?.mode === 'trial'
      ? t('Free trial API Key claimed')
      : t('API Key redeemed')

  function renderTrialButton() {
    if (isCheckingTrial) {
      return (
        <Button type='button' variant='secondary' disabled>
          <Spinner aria-hidden='true' />
          {t('Checking claimed Key...')}
        </Button>
      )
    }

    if (claimedTrial) {
      return (
        <Button
          type='button'
          variant='secondary'
          disabled={pending || trialPending}
          onClick={() =>
            void openClaimedTrialUsage(claimedTrial.key, claimedTrial.lookupId)
          }
        >
          <KeyRound className='size-4' aria-hidden='true' />
          {t('Free Key claimed — click to check quota & usage guide')}
          <ArrowRight className='size-4' aria-hidden='true' />
        </Button>
      )
    }

    return (
      <Button
        type='button'
        variant='secondary'
        disabled={pending || trialPending}
        onClick={() => void handleClaimTrial()}
      >
        {trialPending ? (
          <Spinner aria-hidden='true' />
        ) : (
          <Gift className='size-4' aria-hidden='true' />
        )}
        {trialPending
          ? t('Claiming...')
          : t(
              'Permanent free trial Key — click to claim, works great for translation'
            )}
      </Button>
    )
  }

  return (
    <SharedPortalLayout wide>
      <section className='border-border/70 bg-background rounded-3xl border px-5 py-8 sm:px-10 sm:py-10'>
        <h1 className='text-foreground text-3xl font-semibold tracking-tight sm:text-4xl'>
          {t('Check or redeem')}
        </h1>
        <form
          method='post'
          noValidate
          onSubmit={submitInput}
          className='mt-5 max-w-2xl'
        >
          <Field data-invalid={error === 'invalid'}>
            <FieldLabel htmlFor='usage-key' className='sr-only'>
              {t('API Key or redemption code')}
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
                placeholder={t('Paste API Key or redemption code')}
                className='h-11 min-w-0 flex-1 text-base'
                onChange={() => setError(undefined)}
              />
              <Button
                type='submit'
                className='h-11 px-4'
                disabled={pending || trialPending}
              >
                {pending && <Spinner aria-hidden='true' />}
                {pending ? t('Processing...') : t('Confirm')}
              </Button>
            </div>
            {error === 'invalid' && (
              <FieldError id='usage-key-error'>{errors.invalid}</FieldError>
            )}
          </Field>
        </form>
        <div className='mt-5 flex flex-wrap items-center gap-3 border-t pt-4'>
          {renderTrialButton()}
          {inactiveTrial && (
            <Button
              type='button'
              variant='outline'
              disabled={pending || trialPending}
              onClick={() =>
                void openClaimedTrialUsage(
                  inactiveTrial.key,
                  inactiveTrial.lookupId
                )
              }
            >
              {t('View claimed Key')}
            </Button>
          )}
        </div>
        {error && error !== 'invalid' && (
          <Alert variant='destructive' className='mt-4'>
            <AlertDescription>{errors[error]}</AlertDescription>
          </Alert>
        )}
      </section>
      <PortalHighlights />
      <Dialog
        open={issuedDialog !== null}
        onOpenChange={(open) => {
          if (!open) setIssuedDialog(null)
        }}
        title={dialogTitle}
        description={t(
          'Save this API Key now. It will not be shown again after you close this dialog.'
        )}
        contentClassName='sm:max-w-lg'
        footer={
          <Button type='button' onClick={handleCopyAndClose}>
            {t('Copy and close')}
          </Button>
        }
      >
        {issuedDialog && (
          <div className='bg-muted/50 rounded-lg border px-3 py-2.5'>
            <code className='block font-mono text-sm break-all select-all'>
              {issuedDialog.key}
            </code>
          </div>
        )}
      </Dialog>
    </SharedPortalLayout>
  )
}
