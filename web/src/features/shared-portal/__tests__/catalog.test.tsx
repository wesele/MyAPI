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
import i18next from 'i18next'
import { afterEach, expect, test, vi } from 'vitest'

import { ReferencePricesSection } from '@/features/system-settings/billing/reference-prices-section'
import zhCN from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { publicReferencePrices } from '../api'
import { SharedModelsPage } from '../models'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('shows a comparable price card and filters the catalog by model name', async () => {
  const root = createRootRoute({ component: Outlet })
  const catalog = createRoute({
    getParentRoute: () => root,
    path: '/catalog',
    component: SharedModelsPage,
  })
  const router = createRouter({
    routeTree: root.addChildren([catalog]),
    history: createMemoryHistory({ initialEntries: ['/catalog'] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, { usd_exchange_rate: 7.3 })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path === '/api/pricing') {
        return Response.json({
          success: true,
          data: [
            {
              model_name: 'Example model',
              description: 'An efficient text model',
              vendor_id: 1,
              model_ratio: 0.1675,
              completion_ratio: 2,
              quota_type: 0,
              enable_groups: ['default'],
            },
          ],
          group_ratio: { default: 1 },
          vendors: [{ id: 1, name: 'Hidden Vendor' }],
        })
      }
      if (path.startsWith('/api/perf-metrics/summary')) {
        return Response.json({
          success: true,
          data: {
            window_start: 0,
            window_end: 86400,
            models: [
              {
                model_name: 'Example model',
                avg_latency_ms: 2020,
                avg_tps: 90.3,
                success_rate: 100,
                recent_success_series: [
                  { ts: 3600, success_rate: 100 },
                  { ts: 7200, success_rate: 100 },
                ],
              },
            ],
            recent_success_series: {
              'Example model': [
                { ts: 3600, success_rate: 100 },
                { ts: 7200, success_rate: 100 },
              ],
            },
          },
        })
      }
      return Response.json({
        'Example model': {
          input_cny: 7.3,
          output_usd: 2,
          source: 'https://example.com/pricing',
          checked: '2026-11-21',
        },
      })
    })
  )
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )

  expect(await screen.findByText('Example model')).toBeVisible()
  expect(screen.queryByText('Hidden Vendor')).not.toBeInTheDocument()
  expect(screen.getByText('An efficient text model')).toBeVisible()
  expect(screen.getByText('$0.34 / ¥2.45')).toBeVisible()
  expect(screen.getByText('$0.67 / ¥4.89')).toBeVisible()
  const discounts = await screen.findAllByText('66.5% off')
  expect(discounts).toHaveLength(2)
  const firstRef = screen.getByText('Official reference price · ¥7.3')
  expect(firstRef).toBeVisible()
  expect(firstRef.parentElement).toContainElement(discounts[0])
  expect(screen.getByText('Official reference price · $2')).toBeVisible()
  expect(screen.queryByRole('link', { name: 'Source' })).not.toBeInTheDocument()
  expect(screen.queryByText('2026-11-21')).not.toBeInTheDocument()
  const perf = await screen.findByLabelText(
    'Performance metrics for the last 24 hours'
  )
  const card = screen.getByText('Example model').closest('[data-slot="card"]')
  expect(card).not.toBeNull()
  if (!card) throw new Error('Catalog card not found')
  const lists = card.querySelectorAll('dl')
  expect(lists).toHaveLength(2)
  expect(within(perf).getByText('100.00%')).toBeVisible()
  expect(within(perf).getByText('2.02s')).toBeVisible()
  expect(within(perf).getByText('90.3t/s')).toBeVisible()
  await userEvent
    .setup()
    .type(
      screen.getByRole('searchbox', { name: 'Search models' }),
      'does not exist'
    )
  expect(screen.getByText('No models found')).toBeVisible()
  expect(screen.queryByText('Example model')).not.toBeInTheDocument()
})

test('maintains legacy USD and new CNY prices in the same reference entry', async () => {
  const root = createRootRoute({ component: Outlet })
  const settings = createRoute({
    getParentRoute: () => root,
    path: '/settings',
    component: ReferencePricesSection,
  })
  const router = createRouter({
    routeTree: root.addChildren([settings]),
    history: createMemoryHistory({ initialEntries: ['/settings'] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  const source = 'https://example.com/pricing'
  const checked = '2026-11-21'
  const previous = { Example: { input_usd: 1, source, checked } }
  const updated = {
    Example: { input_usd: 1, output_cny: 2.345, source, checked },
  }
  client.setQueryData(publicReferencePrices.queryKey, previous)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(updated))
  )
  const save = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )

  const user = userEvent.setup()
  expect(await screen.findByRole('spinbutton', { name: 'Input' })).toHaveValue(
    1
  )
  await user.type(screen.getByRole('spinbutton', { name: 'Output' }), '2.345')
  await user.click(
    screen.getByRole('combobox', { name: 'Output · Pricing currency' })
  )
  await user.click(
    await screen.findByRole('option', { name: 'Chinese yuan (CNY)' })
  )
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  const request = save.mock.calls[0]
  expect(request?.[0]).toBe('/api/option/')
  expect(request?.[1]).toMatchObject({ key: 'SharedReferencePrices' })
  expect(
    JSON.parse((request?.[1] as { value: string } | undefined)?.value ?? '{}')
  ).toEqual(updated)
})

test('shows fold discount in Chinese locale on the catalog card', async () => {
  i18next.addResourceBundle('zhCN', 'translation', zhCN.translation, true, true)
  await i18next.changeLanguage('zhCN')
  try {
    const root = createRootRoute({ component: Outlet })
    const catalog = createRoute({
      getParentRoute: () => root,
      path: '/catalog',
      component: SharedModelsPage,
    })
    const router = createRouter({
      routeTree: root.addChildren([catalog]),
      history: createMemoryHistory({ initialEntries: ['/catalog'] }),
    })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    client.setQueryData(STATUS_QUERY_KEY, { usd_exchange_rate: 7.3 })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        if (path === '/api/pricing') {
          return Response.json({
            success: true,
            data: [
              {
                model_name: 'Fold model',
                model_ratio: 0.05,
                completion_ratio: 2,
                quota_type: 0,
                enable_groups: ['default'],
              },
            ],
            group_ratio: { default: 1 },
            vendors: [],
          })
        }
        if (path.startsWith('/api/perf-metrics/summary')) {
          return Response.json({
            success: true,
            data: { window_start: 0, window_end: 86400, models: [] },
          })
        }
        return Response.json({
          'Fold model': {
            input_usd: 1,
            output_usd: 2,
            source: 'https://example.com/pricing',
            checked: '2026-11-21',
          },
        })
      })
    )
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    expect(await screen.findByText('Fold model')).toBeVisible()
    expect(await screen.findAllByText('1折')).toHaveLength(2)
    expect(screen.getByText('官方参考价 · $1')).toBeVisible()
  } finally {
    await i18next.changeLanguage('en')
  }
})
