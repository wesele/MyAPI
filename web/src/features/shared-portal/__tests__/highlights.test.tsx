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

test('renders the top six lowest input-price models in a multi-column grid', async () => {
  const root = createRootRoute({ component: Outlet })
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: PortalHighlights,
  })
  const catalogRoute = createRoute({
    getParentRoute: () => root,
    path: '/catalog',
  })
  const router = createRouter({
    routeTree: root.addChildren([home, catalogRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(publicCatalog.queryKey, {
    success: true,
    data: [
      {
        id: 1,
        model_name: 'model-expensive',
        model_ratio: 5,
        completion_ratio: 2,
        quota_type: 0,
        enable_groups: ['default'],
      },
      {
        id: 2,
        model_name: 'model-tier-6',
        model_ratio: 0.6,
        completion_ratio: 2,
        quota_type: 0,
        enable_groups: ['default'],
      },
      {
        id: 3,
        model_name: 'model-tier-3',
        model_ratio: 0.3,
        completion_ratio: 2,
        quota_type: 0,
        enable_groups: ['default'],
      },
      {
        id: 4,
        model_name: 'model-tier-1',
        model_ratio: 0.05,
        completion_ratio: 2,
        quota_type: 0,
        enable_groups: ['default'],
      },
      {
        id: 5,
        model_name: 'model-tier-5',
        model_ratio: 0.5,
        completion_ratio: 2,
        quota_type: 0,
        enable_groups: ['default'],
      },
      {
        id: 6,
        model_name: 'model-tier-2',
        model_ratio: 0.1,
        completion_ratio: 2,
        quota_type: 0,
        enable_groups: ['default'],
      },
      {
        id: 7,
        model_name: 'model-tier-4',
        model_ratio: 0.4,
        completion_ratio: 2,
        quota_type: 0,
        enable_groups: ['default'],
      },
    ],
    vendors: [],
    group_ratio: { default: 1 },
    usable_group: {},
    supported_endpoint: {},
    auto_groups: [],
  })
  client.setQueryData(publicReferencePrices.queryKey, {
    'model-tier-1': {
      input_usd: 1,
      source: 'https://example.com/pricing',
      checked: '2026-11-21',
    },
  })
  client.setQueryData(publicSurveyResults.queryKey, [])

  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  try {
    const region = await screen.findByRole('region', {
      name: 'Models and pricing',
    })
    const list = within(region).getByRole('list')
    expect(list).toHaveClass('sm:grid-cols-2')

    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(6)
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('model-tier-1'),
      expect.stringContaining('model-tier-2'),
      expect.stringContaining('model-tier-3'),
      expect.stringContaining('model-tier-4'),
      expect.stringContaining('model-tier-5'),
      expect.stringContaining('model-tier-6'),
    ])
    expect(
      within(region).queryByText('model-expensive')
    ).not.toBeInTheDocument()
    expect(within(items[0]).getByText('90% off')).toBeVisible()
  } finally {
    view.unmount()
    client.clear()
  }
})
