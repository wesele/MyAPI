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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { useTranslation } from 'react-i18next'
import { afterEach, expect, test, vi } from 'vitest'

import { AuthLayout } from '../auth-layout'

function SampleAuthBody() {
  const { t } = useTranslation()
  return <h2>{t('Sign in')}</h2>
}

afterEach(async () => {
  vi.restoreAllMocks()
  await act(() => i18next.changeLanguage('en'))
})

test('renders the language switcher in AuthLayout and switches between Chinese and English', async () => {
  i18next.addResourceBundle(
    'zhCN',
    'translation',
    {
      'Change language': '更改语言',
      'Sign in': '登录',
    },
    true,
    true
  )

  const root = createRootRoute({ component: Outlet })
  const signIn = createRoute({
    getParentRoute: () => root,
    path: '/sign-in',
    component: () => (
      <AuthLayout>
        <SampleAuthBody />
      </AuthLayout>
    ),
  })
  const home = createRoute({
    getParentRoute: () => root,
    path: '/home',
    component: () => <div>Home</div>,
  })
  const router = createRouter({
    routeTree: root.addChildren([signIn, home]),
    history: createMemoryHistory({ initialEntries: ['/sign-in'] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )

  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible()

  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Change language' }))
  await user.click(await screen.findByRole('menuitem', { name: '简体中文' }))

  expect(screen.getByRole('heading', { name: '登录' })).toBeVisible()
})
