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
import { describe, expect, test } from 'vitest'

import {
  wechatSettingsFormValues,
  wechatSettingsSchema,
} from '../lib/settings-form'

const baseValues = {
  enabled: true,
  mode: 'safe' as const,
  app_id: 'wx123',
  original_id: 'gh_123',
  group_id: 1,
  message_template: '',
  token: '',
  encoding_aes_key: '',
}

describe('wechatSettingsSchema', () => {
  test('accepts blank template or template containing {{code}}', () => {
    expect(wechatSettingsSchema.safeParse(baseValues).success).toBe(true)
    expect(
      wechatSettingsSchema.safeParse({
        ...baseValues,
        message_template: '   ',
      }).success
    ).toBe(true)
    expect(
      wechatSettingsSchema.safeParse({
        ...baseValues,
        message_template: 'Welcome!\nYour code: {{code}}',
      }).success
    ).toBe(true)
  })

  test('rejects non-empty template without {{code}} or over 500 characters', () => {
    const missingCode = wechatSettingsSchema.safeParse({
      ...baseValues,
      message_template: 'Welcome without variable',
    })
    expect(missingCode.success).toBe(false)

    const tooLong = wechatSettingsSchema.safeParse({
      ...baseValues,
      message_template: `${'a'.repeat(493)}{{code}}`,
    })
    expect(tooLong.success).toBe(false)
  })

  test('wechatSettingsFormValues clears secrets and defaults message_template', () => {
    const formValues = wechatSettingsFormValues({
      enabled: false,
      mode: 'plain',
      app_id: '',
      original_id: '',
      group_id: 0,
      message_template: 'Code: {{code}}',
      token_configured: true,
      key_configured: false,
    })
    expect(formValues).toEqual({
      enabled: false,
      mode: 'plain',
      app_id: '',
      original_id: '',
      group_id: 0,
      message_template: 'Code: {{code}}',
      token: '',
      encoding_aes_key: '',
    })
  })
})
