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
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { LanguageSwitcher } from '../language-switcher'

afterEach(async () => {
  useAuthStore.getState().auth.reset()
  vi.restoreAllMocks()
  await act(() => i18next.changeLanguage('en'))
})

describe('LanguageSwitcher', () => {
  test('lists only Simplified Chinese and English options and switches language', async () => {
    if (!i18next.hasResourceBundle('zhCN', 'translation')) {
      i18next.addResourceBundle('zhCN', 'translation', {
        'Change language': '更改语言',
      })
    }

    const putSpy = vi.spyOn(api, 'put')
    const user = userEvent.setup()

    render(<LanguageSwitcher />)

    await user.click(screen.getByRole('button', { name: 'Change language' }))

    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      '简体中文',
      'English',
    ])
    expect(screen.queryByRole('menuitem', { name: 'Français' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '繁體中文' })).toBeNull()

    await user.click(screen.getByRole('menuitem', { name: '简体中文' }))

    expect(i18next.language).toBe('zhCN')
    expect(screen.getByRole('button', { name: '更改语言' })).toBeInTheDocument()
    expect(putSpy).not.toHaveBeenCalled()
  })

  test('persists the selected language when a user is signed in', async () => {
    useAuthStore.getState().auth.setUser({
      id: 1,
      username: 'tester',
      role: 1,
    })
    const putSpy = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true } })

    const user = userEvent.setup()
    render(<LanguageSwitcher />)

    await user.click(screen.getByRole('button', { name: 'Change language' }))
    await user.click(await screen.findByRole('menuitem', { name: '简体中文' }))

    expect(i18next.language).toBe('zhCN')
    expect(putSpy).toHaveBeenCalledWith('/api/user/self', {
      language: 'zhCN',
    })
  })
})
