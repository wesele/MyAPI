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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { KeyUsagePage } from '../index'
import { KeyUsageResultPage } from '../result-page'

const fakeKey = 'sk-example-test-value'
const lookupId = 'A'.repeat(26)
const pathPrefix = `/api/shared/usage/${lookupId}`
const usage = {
  code: true,
  data: {
    total_available: 530000,
    total_used: 170000,
    total_granted: 700000,
    unlimited_quota: false,
    expires_at: 0,
    model_limits_enabled: true,
    model_limits: { 'gpt-6-luna': true },
  },
}
const originalConfig = useSystemConfigStore.getState().config
const originalLoading = useSystemConfigStore.getState().loading

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  useSystemConfigStore.getState().setConfig(originalConfig)
  useSystemConfigStore.getState().setLoading(originalLoading)
  localStorage.clear()
  sessionStorage.clear()
})

function renderPage(path = '/') {
  const root = createRootRoute({ component: Outlet })
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: KeyUsagePage,
  })
  const catalog = createRoute({
    getParentRoute: () => root,
    path: '/catalog',
    component: () => <h1>Catalog</h1>,
  })
  const result = createRoute({
    getParentRoute: () => root,
    path: '/key-usage/$lookupId',
    component: () => <KeyUsageResultPage lookupId={lookupId} />,
  })
  const router = createRouter({
    routeTree: root.addChildren([index, result, catalog]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, {})
  useSystemConfigStore.getState().setConfig({
    currency: {
      ...originalConfig.currency,
      quotaDisplayType: 'CNY',
      usdExchangeRate: 7,
    },
  })
  useSystemConfigStore.getState().setLoading(false)
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

test('opens results in a separate tab and sends the key only when creating the session', async () => {
  const fetchMock = vi.fn(async (path: string, _options?: RequestInit) => {
    if (path === '/api/pricing') {
      return Response.json({
        success: true,
        data: [
          {
            model_name: 'Example model',
            model_ratio: 0.15,
            completion_ratio: 2,
            quota_type: 0,
            enable_groups: ['default'],
          },
        ],
        group_ratio: { default: 1 },
      })
    }
    if (path === '/api/shared/survey/results') {
      return Response.json({ success: true, data: [{ amount: 10, count: 3 }] })
    }
    if (path === '/api/shared/reference-prices') return Response.json({})
    return Response.json({ id: lookupId })
  })
  vi.stubGlobal('fetch', fetchMock)
  const tab = { location: { replace: vi.fn() }, opener: window, close: vi.fn() }
  const open = vi
    .spyOn(window, 'open')
    .mockReturnValue(tab as unknown as Window)
  const user = userEvent.setup()
  renderPage()
  const field = await screen.findByLabelText('API Key')
  expect(field).toHaveAttribute('type', 'password')
  await user.click(screen.getByRole('button', { name: 'Query' }))
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(open).not.toHaveBeenCalled()

  await user.type(field, ` ${fakeKey} `)
  await user.keyboard('{Enter}')
  await waitFor(() =>
    expect(tab.location.replace).toHaveBeenCalledWith(`/key-usage/${lookupId}`)
  )
  expect(tab.opener).toBeNull()
  expect(
    fetchMock.mock.calls.filter(([path]) => path === '/api/shared/usage')
  ).toHaveLength(1)
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/shared/usage',
    expect.objectContaining({
      method: 'POST',
      headers: { Authorization: `Bearer ${fakeKey}`, 'X-Shared-Portal': '1' },
      cache: 'no-store',
      redirect: 'error',
    })
  )
  expect(field).toHaveValue('')
  expect(screen.getByPlaceholderText('Paste your API Key')).toBe(field)
  expect(
    screen.queryByText('Query results open in a new tab.')
  ).not.toBeInTheDocument()
  expect(await screen.findByText('Example model')).toBeVisible()
  expect(await screen.findByText('3 of 10 participants')).toBeVisible()
  expect(JSON.stringify(localStorage)).not.toContain(fakeKey)
  expect(JSON.stringify(sessionStorage)).not.toContain(fakeKey)
  expect(screen.queryByText('Remaining quota')).not.toBeInTheDocument()
  const nav = within(screen.getByRole('navigation'))
  expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
  expect(nav.getByRole('link', { name: 'Models' })).toHaveAttribute(
    'href',
    '/catalog'
  )
})

test('refreshes results without the key and preserves quota when logs fail', async () => {
  const fetchMock = vi.fn(async (path: string) =>
    path.endsWith('/totals')
      ? Response.json(usage)
      : new Response(null, { status: 503 })
  )
  vi.stubGlobal('fetch', fetchMock)
  const user = userEvent.setup()
  const initial = renderPage(`/key-usage/${lookupId}`)
  expect(await screen.findByText('Could not load recent usage.')).toBeVisible()
  expect(screen.getByText(/7\.42/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Refresh' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
  initial.unmount()
  renderPage(`/key-usage/${lookupId}`)
  expect(await screen.findByText(/7\.42/)).toBeVisible()
  for (const path of ['totals', 'logs']) {
    expect(fetchMock).toHaveBeenCalledWith(
      `${pathPrefix}/${path}`,
      expect.objectContaining({
        headers: { 'X-Shared-Portal': '1' },
      })
    )
  }
})

test('offers a new query when the result session is expired', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 401 }))
  )
  renderPage(`/key-usage/${lookupId}`)
  expect(
    await screen.findByText(
      'This query has expired or the API Key is no longer available.'
    )
  ).toBeVisible()
  expect(screen.getByRole('link', { name: 'New query' })).toHaveAttribute(
    'href',
    '/'
  )
})

test('closes the empty tab when the key is invalid', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 401 }))
  )
  const tab = { location: { replace: vi.fn() }, close: vi.fn() }
  vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
  const user = userEvent.setup()
  renderPage()
  await user.type(await screen.findByLabelText('API Key'), fakeKey)
  await user.keyboard('{Enter}')
  expect(
    await screen.findByText('This API Key is invalid or unavailable.')
  ).toBeVisible()
  expect(tab.close).toHaveBeenCalledOnce()
  expect(tab.location.replace).not.toHaveBeenCalled()
})
