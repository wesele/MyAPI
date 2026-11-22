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
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, expect, test, vi } from 'vitest'

import { SharedPortalLayout } from '../layout'

afterEach(async () => {
  vi.restoreAllMocks()
  await act(() => i18next.changeLanguage('en'))
})

test('renders the language switcher in the header and translates navigation on switch', async () => {
  i18next.addResourceBundle(
    'zhCN',
    'translation',
    {
      'Change language': '更改语言',
      Home: '首页',
      Models: '模型',
      Navigation: '导航',
    },
    true,
    true
  )

  const root = createRootRoute({ component: Outlet })
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <SharedPortalLayout>
        <p>Portal body</p>
      </SharedPortalLayout>
    ),
  })
  const catalog = createRoute({
    getParentRoute: () => root,
    path: '/catalog',
    component: () => <div>Catalog</div>,
  })
  const router = createRouter({
    routeTree: root.addChildren([home, catalog]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )

  const header = await screen.findByRole('banner')
  const main = screen.getByRole('main')
  expect(main).toHaveClass('pt-4', 'sm:pt-5')
  expect(main).not.toHaveClass('pt-9')
  expect(main).not.toHaveClass('sm:pt-12')
  expect(within(header).getByRole('link', { name: 'Home' })).toBeVisible()
  expect(within(header).getByRole('link', { name: 'Models' })).toBeVisible()

  const user = userEvent.setup()
  await user.click(
    within(header).getByRole('button', { name: 'Change language' })
  )
  await user.click(await screen.findByRole('menuitem', { name: '简体中文' }))

  expect(within(header).getByRole('link', { name: '首页' })).toBeVisible()
  expect(within(header).getByRole('link', { name: '模型' })).toBeVisible()

  await user.click(within(header).getByRole('button', { name: '更改语言' }))
  await user.click(await screen.findByRole('menuitem', { name: 'English' }))

  expect(within(header).getByRole('link', { name: 'Home' })).toBeVisible()
  expect(within(header).getByRole('link', { name: 'Models' })).toBeVisible()
})
