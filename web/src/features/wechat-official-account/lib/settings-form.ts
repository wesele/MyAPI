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
import { z } from 'zod'

export const wechatSettingsSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['plain', 'compatible', 'safe']),
  app_id: z.string(),
  original_id: z.string(),
  group_id: z.number().int().nonnegative(),
  token: z.string(),
  encoding_aes_key: z.string(),
})

export type WeChatSettingsFormValues = z.infer<typeof wechatSettingsSchema>

export type WeChatSettings = Omit<
  WeChatSettingsFormValues,
  'token' | 'encoding_aes_key'
> & {
  token_configured: boolean
  key_configured: boolean
}

export function wechatSettingsFormValues(
  settings: WeChatSettings
): WeChatSettingsFormValues {
  const { token_configured: _token, key_configured: _key, ...values } = settings
  return {
    ...values,
    token: '',
    encoding_aes_key: '',
  }
}
