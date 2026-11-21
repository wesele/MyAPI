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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import {
  publicCatalog,
  publicReferencePrices,
  publicSurveyResults,
} from '../api'
import { PortalHighlights } from '../highlights'

test('shows the OpenCode goal when responses exceed it and keeps the survey link accessible', async () => {
  const root = createRootRoute({ component: Outlet })
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: PortalHighlights,
  })
  const survey = createRoute({
    getParentRoute: () => root,
    path: '/survey',
  })
  const router = createRouter({
    routeTree: root.addChildren([home, survey]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(publicCatalog.queryKey, {
    success: true,
    data: [],
    vendors: [],
    group_ratio: {},
    usable_group: {},
    supported_endpoint: {},
    auto_groups: [],
  })
  client.setQueryData(publicReferencePrices.queryKey, {})
  client.setQueryData(publicSurveyResults.queryKey, [
    { amount: 10, count: 5 },
    { amount: 50, count: 7 },
  ])

  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  try {
    const card = await screen.findByRole('region', { name: 'OpenCode' })
    const tiers = within(card).getAllByRole('listitem')
    expect(tiers.map((tier) => tier.textContent)).toEqual([
      '10 yuanRoughly equivalent to the 39 yuan subscription in China',
      '20 yuanRoughly equivalent to the 79 yuan subscription in China',
      '50 yuanRoughly equivalent to the 199 yuan subscription in China',
    ])
    const progress = within(card).getByRole('progressbar')
    expect(progress).toHaveAccessibleName('12 of 10 participants')
    expect(progress).toHaveAttribute('aria-valuenow', '10')
    expect(progress).toHaveAttribute('aria-valuemax', '10')

    const link = within(card).getByRole('link', { name: 'Take the survey' })
    expect(link).toHaveAttribute('href', '/survey')
    link.focus()
    await userEvent.setup().keyboard('{Enter}')
    await vi.waitFor(() =>
      expect(router.state.location.pathname).toBe('/survey')
    )
  } finally {
    view.unmount()
    client.clear()
  }
})
