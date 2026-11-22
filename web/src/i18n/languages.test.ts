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
  convertDetectedLanguage,
  INTERFACE_LANGUAGE_OPTIONS,
  normalizeInterfaceLanguage,
  toIntlLocale,
} from './languages'

describe('INTERFACE_LANGUAGE_OPTIONS', () => {
  test('only exposes Chinese and English', () => {
    expect(INTERFACE_LANGUAGE_OPTIONS).toEqual([
      { code: 'zhCN', label: '简体中文' },
      { code: 'en', label: 'English' },
    ])
  })
})

describe('convertDetectedLanguage', () => {
  test('maps Chinese BCP-47 tags and codes onto zhCN', () => {
    expect(convertDetectedLanguage('zh')).toBe('zhCN')
    expect(convertDetectedLanguage('zh-CN')).toBe('zhCN')
    expect(convertDetectedLanguage('zh-Hans')).toBe('zhCN')
    expect(convertDetectedLanguage('zh-TW')).toBe('zhCN')
    expect(convertDetectedLanguage('zh-HK')).toBe('zhCN')
    expect(convertDetectedLanguage('zh-MO')).toBe('zhCN')
    expect(convertDetectedLanguage('zh-Hant-TW')).toBe('zhCN')
    expect(convertDetectedLanguage('zhCN')).toBe('zhCN')
    expect(convertDetectedLanguage('zhTW')).toBe('zhCN')
  })

  test('maps non-Chinese values onto en', () => {
    expect(convertDetectedLanguage('en')).toBe('en')
    expect(convertDetectedLanguage('en-US')).toBe('en')
    expect(convertDetectedLanguage('fr-FR')).toBe('en')
    expect(convertDetectedLanguage('ja')).toBe('en')
  })
})

describe('normalizeInterfaceLanguage', () => {
  test('normalizes Chinese variants to zhCN and others to en', () => {
    expect(normalizeInterfaceLanguage('zhCN')).toBe('zhCN')
    expect(normalizeInterfaceLanguage('zhTW')).toBe('zhCN')
    expect(normalizeInterfaceLanguage('zh-CN')).toBe('zhCN')
    expect(normalizeInterfaceLanguage('zh-TW')).toBe('zhCN')
    expect(normalizeInterfaceLanguage('zh')).toBe('zhCN')
    expect(normalizeInterfaceLanguage('en')).toBe('en')
    expect(normalizeInterfaceLanguage('en-US')).toBe('en')
    expect(normalizeInterfaceLanguage('fr')).toBe('en')
    expect(normalizeInterfaceLanguage(undefined)).toBe('en')
    expect(normalizeInterfaceLanguage(null)).toBe('en')
  })
})

describe('toIntlLocale', () => {
  test('converts interface language codes and BCP-47 tags safely', () => {
    expect(toIntlLocale('zhCN')).toBe('zh-CN')
    expect(toIntlLocale('zhTW')).toBe('zh-TW')
    expect(toIntlLocale('en')).toBe('en')
    expect(toIntlLocale('fr')).toBe('fr')
    expect(toIntlLocale('ja')).toBe('ja')
    expect(toIntlLocale('ru')).toBe('ru')
    expect(toIntlLocale('vi')).toBe('vi')
    expect(toIntlLocale('not a language')).toBeUndefined()
    expect(toIntlLocale(undefined)).toBeUndefined()
  })
})
