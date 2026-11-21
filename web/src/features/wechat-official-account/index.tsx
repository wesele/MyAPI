/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CopyButton } from '@/components/copy-button'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { PasswordInput } from '@/components/password-input'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import {
  getRedemptionGroups,
  redemptionGroupsQueryKey,
} from '@/features/redemption-codes/api'
import { RedemptionGroupSelect } from '@/features/redemption-codes/components/redemption-group-select'
import type {
  ApiResponse,
  RedemptionGroup,
} from '@/features/redemption-codes/types'
import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '@/features/system-settings/components/settings-form-layout'
import { useStatus } from '@/hooks/use-status'
import { api } from '@/lib/api'
import { isHttpUrl } from '@/lib/content-format'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  wechatSettingsFormValues,
  wechatSettingsSchema,
  type WeChatSettings,
  type WeChatSettingsFormValues,
} from './lib/settings-form'

const endpoint = '/api/wechat-official-account'
const settingsQueryKey = ['wechat-official-account'] as const
const emptyGroups: RedemptionGroup[] = []

export function WeChatOfficialAccount() {
  const { t } = useTranslation()
  const settings = useQuery({
    queryKey: settingsQueryKey,
    queryFn: async () => {
      const response = await api.get<ApiResponse<WeChatSettings>>(endpoint)
      return requireServerSuccess(response.data).data ?? null
    },
  })
  const groups = useQuery({
    queryKey: redemptionGroupsQueryKey,
    queryFn: async () =>
      requireServerSuccess(await getRedemptionGroups()).data ?? emptyGroups,
  })

  let content
  if (settings.isPending || groups.isPending) {
    content = <LoadingState />
  } else if (!settings.data || groups.isError) {
    content = (
      <ErrorState
        description={t('Could not load WeChat Official Account settings')}
        onRetry={() => {
          void settings.refetch()
          void groups.refetch()
        }}
      />
    )
  } else {
    content = (
      <WeChatSettingsForm settings={settings.data} groups={groups.data} />
    )
  }
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('WeChat Official Account API')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>{content}</SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

function WeChatSettingsForm(props: {
  settings: WeChatSettings
  groups: RedemptionGroup[]
}) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const serverAddress = status?.server_address
  const configuredAddress =
    typeof serverAddress === 'string' && isHttpUrl(serverAddress)
      ? new URL(serverAddress)
      : null
  const callbackUrl = new URL(
    '/wechat',
    configuredAddress?.protocol === 'https:'
      ? configuredAddress.origin
      : window.location.origin
  )
  const queryClient = useQueryClient()
  const form = useForm({
    resolver: zodResolver(wechatSettingsSchema),
    defaultValues: wechatSettingsFormValues(props.settings),
  })
  const save = useMutation({
    mutationFn: async (values: WeChatSettingsFormValues) => {
      const response = await api.put<ApiResponse<WeChatSettings>>(endpoint, {
        ...values,
        token: values.token.trim() || undefined,
        encoding_aes_key: values.encoding_aes_key.trim() || undefined,
      })
      return requireServerSuccess(response.data).data
    },
    onSuccess: (settings) => {
      if (settings) {
        queryClient.setQueryData(settingsQueryKey, settings)
        form.reset(wechatSettingsFormValues(settings))
      }
      toast.success(t('Saved successfully'))
    },
    onError: (error) =>
      handleServerError(
        error,
        t('Could not save WeChat Official Account settings')
      ),
  })
  return (
    <Form {...form}>
      <SettingsForm
        className='max-w-2xl'
        onSubmit={form.handleSubmit((values) => save.mutate(values))}
        autoComplete='off'
      >
        <fieldset className='grid gap-5' disabled={save.isPending}>
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable WeChat callback')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Send a redemption code when someone follows the Official Account.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />
          <div className='grid gap-2'>
            <p className='text-sm font-medium'>{t('Callback URL')}</p>
            <div className='flex items-center gap-2'>
              <code className='min-w-0 text-sm break-all'>
                {callbackUrl.href}
              </code>
              <CopyButton value={callbackUrl.href} tooltip={t('Copy URL')} />
            </div>
            <p className='text-muted-foreground text-sm'>
              {callbackUrl.protocol === 'https:'
                ? t(
                    'Use this URL in the WeChat Official Account message push settings.'
                  )
                : t(
                    'Use a publicly reachable HTTPS address with the /wechat path in WeChat.'
                  )}
            </p>
          </div>
          <div className='grid gap-5 sm:grid-cols-2'>
            <FormField
              control={form.control}
              name='token'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Token</FormLabel>
                  <FormControl>
                    <PasswordInput
                      {...field}
                      maxLength={32}
                      autoComplete='new-password'
                      placeholder={
                        props.settings.token_configured
                          ? t('Configured')
                          : undefined
                      }
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='encoding_aes_key'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>EncodingAESKey</FormLabel>
                  <FormControl>
                    <PasswordInput
                      {...field}
                      maxLength={43}
                      autoComplete='new-password'
                      placeholder={
                        props.settings.key_configured
                          ? t('Configured')
                          : undefined
                      }
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='app_id'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>AppID</FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={64} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='original_id'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('WeChat original ID')}</FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={64} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='mode'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Message encryption mode')}</FormLabel>
                  <FormControl>
                    <NativeSelect {...field}>
                      <NativeSelectOption value='safe'>
                        {t('Safe mode (recommended)')}
                      </NativeSelectOption>
                      <NativeSelectOption value='compatible'>
                        {t('Compatible mode')}
                      </NativeSelectOption>
                      <NativeSelectOption value='plain'>
                        {t('Plaintext mode')}
                      </NativeSelectOption>
                    </NativeSelect>
                  </FormControl>
                </FormItem>
              )}
            />
            <div className='grid content-start gap-2'>
              <Label htmlFor='wechat-push-format'>{t('Message format')}</Label>
              <Input id='wechat-push-format' value='XML' readOnly />
            </div>
          </div>
          <FormField
            control={form.control}
            name='group_id'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Redemption group')}</FormLabel>
                <FormControl>
                  <RedemptionGroupSelect
                    groups={props.groups}
                    value={field.value || undefined}
                    onChange={(id) => field.onChange(id ?? 0)}
                    allowUngrouped={false}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Disabled codes are enabled and sent in ID order. Expired and previously sent codes are skipped.'
                  )}
                </FormDescription>
              </FormItem>
            )}
          />
          <div>
            <Button type='submit' disabled={!form.formState.isDirty}>
              {t('Save changes')}
            </Button>
          </div>
        </fieldset>
      </SettingsForm>
    </Form>
  )
}
