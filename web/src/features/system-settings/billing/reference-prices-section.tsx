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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  publicReferencePrices,
  referencePricesSchema,
  type ReferencePrice,
} from '@/features/shared-portal/api'
import {
  getReferenceAmount,
  referencePriceKinds,
} from '@/features/shared-portal/pricing'

import { FormNavigationGuard } from '../components/form-navigation-guard'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

type PriceDraft = { amount: string; currency: 'USD' | 'CNY' }
type ReferenceDraft = {
  model: string
  input: PriceDraft
  output: PriceDraft
  request: PriceDraft
  source: string
  checked: string
  maxInputTokens: string
}

function referenceDraft(
  model: string,
  reference?: ReferencePrice
): ReferenceDraft {
  const prices = Object.fromEntries(
    referencePriceKinds.map((kind) => {
      const price = getReferenceAmount(reference, kind)
      return [
        kind,
        {
          amount: price ? String(price.amount) : '',
          currency: price?.currency ?? 'USD',
        },
      ]
    })
  ) as Pick<ReferenceDraft, (typeof referencePriceKinds)[number]>
  return {
    ...prices,
    model,
    source: reference?.source ?? '',
    checked: reference?.checked ?? '',
    maxInputTokens: reference?.max_input_tokens?.toString() ?? '',
  }
}

function ReferencePricesForm(props: {
  prices: Record<string, ReferencePrice>
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const updateOption = useUpdateOption()
  const form = useForm<{ rows: ReferenceDraft[] }>({
    defaultValues: {
      rows: Object.entries(props.prices).map(([name, price]) =>
        referenceDraft(name, price)
      ),
    },
  })
  const rows = useFieldArray({ control: form.control, name: 'rows' })
  const { errors, isDirty, isSubmitting } = form.formState
  const currencies = [
    { value: 'USD', label: t('US dollar (USD)') },
    { value: 'CNY', label: t('Chinese yuan (CNY)') },
  ] as const
  const labels = {
    input: t('Input'),
    output: t('Output'),
    request: t('Per request'),
  }

  const submit = form.handleSubmit(async (values) => {
    const prices = new Map<string, ReferencePrice>()
    for (const row of values.rows) {
      const name = row.model.trim()
      const price: ReferencePrice = {
        source: row.source.trim(),
        checked: row.checked,
      }
      if (row.maxInputTokens) {
        price.max_input_tokens = Number(row.maxInputTokens)
      }
      let hasAmount = false
      for (const kind of referencePriceKinds) {
        const { amount, currency } = row[kind]
        if (amount === '') continue
        hasAmount = true
        price[`${kind}_${currency === 'CNY' ? 'cny' : 'usd'}`] = Number(amount)
      }
      if (!name || prices.has(name) || !hasAmount) {
        form.setError('root', {
          message: t(
            'Enter a unique model name and at least one price per model.'
          ),
        })
        return
      }
      prices.set(name, price)
    }
    const config = Object.fromEntries(prices)
    if (!referencePricesSchema.safeParse(config).success) {
      form.setError('root', { message: t('Invalid official reference prices') })
      return
    }

    try {
      await updateOption.mutateAsync({
        key: 'SharedReferencePrices',
        value: JSON.stringify(config),
      })
      queryClient.setQueryData(publicReferencePrices.queryKey, config)
      await queryClient.invalidateQueries({
        queryKey: publicReferencePrices.queryKey,
      })
      form.reset({
        rows: Object.entries(config).map(([name, price]) =>
          referenceDraft(name, price)
        ),
      })
    } catch {
      // The system option mutation displays the server error.
    }
  })

  return (
    <form onSubmit={submit} className='space-y-4'>
      <FormNavigationGuard when={isDirty && !isSubmitting} />
      <p className='text-muted-foreground text-sm'>
        {t(
          'Enter token prices per million tokens and request prices per request.'
        )}
      </p>
      <fieldset disabled={isSubmitting} className='space-y-4'>
        {rows.fields.map((row, index) => (
          <fieldset key={row.id} className='space-y-3 rounded-lg border p-4'>
            <div className='flex items-end gap-3'>
              <Field className='flex-1'>
                <FieldLabel htmlFor={`${row.id}-model`}>
                  {t('Model name')}
                </FieldLabel>
                <Input
                  id={`${row.id}-model`}
                  required
                  {...form.register(`rows.${index}.model`)}
                />
              </Field>
              <Button
                type='button'
                variant='outline'
                onClick={() => rows.remove(index)}
              >
                {t('Remove')}
              </Button>
            </div>
            <div className='grid gap-3 lg:grid-cols-3'>
              {referencePriceKinds.map((kind) => {
                const currencyField = `rows.${index}.${kind}.currency` as const
                return (
                  <Field key={kind}>
                    <FieldLabel htmlFor={`${row.id}-${kind}`}>
                      {labels[kind]}
                    </FieldLabel>
                    <div className='flex gap-2'>
                      <Input
                        id={`${row.id}-${kind}`}
                        type='number'
                        min={0}
                        step='any'
                        {...form.register(`rows.${index}.${kind}.amount`)}
                      />
                      <Select
                        items={currencies}
                        value={form.watch(currencyField)}
                        disabled={isSubmitting}
                        onValueChange={(currency) => {
                          if (currency) {
                            form.setValue(currencyField, currency, {
                              shouldDirty: true,
                            })
                          }
                        }}
                      >
                        <SelectTrigger
                          aria-label={`${labels[kind]} · ${t('Pricing currency')}`}
                        >
                          <SelectValue>{form.watch(currencyField)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {currencies.map((currency) => (
                            <SelectItem
                              key={currency.value}
                              value={currency.value}
                            >
                              {currency.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </Field>
                )
              })}
            </div>
            <div className='grid gap-3 lg:grid-cols-3'>
              <Field>
                <FieldLabel htmlFor={`${row.id}-source`}>
                  {t('Source')} · {t('URL')}
                </FieldLabel>
                <Input
                  id={`${row.id}-source`}
                  type='url'
                  required
                  {...form.register(`rows.${index}.source`)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${row.id}-checked`}>
                  {t('Verification date')}
                </FieldLabel>
                <Input
                  id={`${row.id}-checked`}
                  type='date'
                  required
                  {...form.register(`rows.${index}.checked`)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${row.id}-context`}>
                  {t('Context Window')}
                </FieldLabel>
                <Input
                  id={`${row.id}-context`}
                  type='number'
                  min={1}
                  step={1}
                  {...form.register(`rows.${index}.maxInputTokens`)}
                />
              </Field>
            </div>
          </fieldset>
        ))}
      </fieldset>
      {errors.root?.message && (
        <Alert variant='destructive'>
          <AlertDescription>{errors.root.message}</AlertDescription>
        </Alert>
      )}
      <div className='flex flex-wrap gap-2'>
        <Button
          type='button'
          variant='outline'
          disabled={isSubmitting}
          onClick={() => rows.append(referenceDraft(''))}
        >
          {t('Add model')}
        </Button>
        <Button
          type='button'
          variant='outline'
          disabled={!isDirty || isSubmitting}
          onClick={() => form.reset()}
        >
          {t('Reset')}
        </Button>
        <Button type='submit' disabled={!isDirty || isSubmitting}>
          {t('Save Changes')}
        </Button>
      </div>
    </form>
  )
}

export function ReferencePricesSection() {
  const { t } = useTranslation()
  const query = useQuery(publicReferencePrices)
  return (
    <SettingsSection title={t('Official reference prices')}>
      {query.data && <ReferencePricesForm prices={query.data} />}
      {query.isPending && <p role='status'>{t('Loading...')}</p>}
      {query.isError && (
        <Alert variant='destructive'>
          <AlertDescription>
            {t('Could not load official reference prices.')}
            <Button variant='outline' onClick={() => void query.refetch()}>
              {t('Retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </SettingsSection>
  )
}
