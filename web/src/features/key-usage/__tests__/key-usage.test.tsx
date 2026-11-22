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
import { useAuthStore } from '@/stores/auth-store'
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
  useAuthStore.getState().auth.reset()
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
  expect(
    await screen.findByRole('heading', { name: 'Check or redeem' })
  ).toBeVisible()
  const field = await screen.findByLabelText('API Key or redemption code')
  expect(field).toHaveAttribute('type', 'password')
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
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
  expect(screen.getByPlaceholderText('Paste API Key or redemption code')).toBe(
    field
  )
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
  await user.type(
    await screen.findByLabelText('API Key or redemption code'),
    fakeKey
  )
  await user.keyboard('{Enter}')
  expect(
    await screen.findByText('This API Key is invalid or unavailable.')
  ).toBeVisible()
  expect(tab.close).toHaveBeenCalledOnce()
  expect(tab.location.replace).not.toHaveBeenCalled()
})

test('redeems a 32-char code into a dialog and copies before closing', async () => {
  const redemptionCode = '0123456789abcdef0123456789abcdef'
  const issuedKey = 'sk-issued-admin-token-value'
  const fetchMock = vi.fn(async (path: string) => {
    if (path === '/api/shared/redeem') {
      return Response.json({ success: true, data: { key: issuedKey } })
    }
    return Response.json({ success: true, data: [] })
  })
  vi.stubGlobal('fetch', fetchMock)
  const open = vi.spyOn(window, 'open')
  Object.defineProperty(window, 'isSecureContext', {
    value: true,
    configurable: true,
  })

  const user = userEvent.setup()
  const writeText = vi
    .spyOn(navigator.clipboard, 'writeText')
    .mockResolvedValue(undefined)
  renderPage()
  const field = await screen.findByLabelText('API Key or redemption code')
  await user.type(field, ` ${redemptionCode} `)
  await user.click(screen.getByRole('button', { name: 'Confirm' }))

  expect(open).not.toHaveBeenCalled()
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/shared/redeem',
    expect.objectContaining({
      method: 'POST',
      headers: {
        'X-Shared-Portal': '1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key: redemptionCode }),
    })
  )
  expect(await screen.findByRole('dialog')).toBeVisible()
  expect(screen.getByText(issuedKey)).toBeVisible()
  expect(field).toHaveValue('')

  await user.click(screen.getByRole('button', { name: 'Copy and close' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(issuedKey))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
})

test('keeps redemption dialog open when clipboard copy fails and shows error on invalid code', async () => {
  const redemptionCode = 'fedcba9876543210fedcba9876543210'
  const issuedKey = 'sk-keep-visible-on-copy-fail'
  let attempt = 0
  const fetchMock = vi.fn(async (path: string) => {
    if (path === '/api/shared/redeem') {
      attempt += 1
      if (attempt === 1) {
        return new Response(null, { status: 400 })
      }
      return Response.json({ success: true, data: { key: issuedKey } })
    }
    return Response.json({ success: true, data: [] })
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(window, 'open')
  Object.defineProperty(window, 'isSecureContext', {
    value: true,
    configurable: true,
  })
  document.execCommand = vi.fn().mockReturnValue(false)

  const user = userEvent.setup()
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
    new Error('denied')
  )
  renderPage()
  const field = await screen.findByLabelText('API Key or redemption code')

  await user.type(field, redemptionCode)
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(
    await screen.findByText('This redemption code is invalid or unavailable.')
  ).toBeVisible()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(await screen.findByRole('dialog')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Copy and close' }))
  await waitFor(() => expect(screen.getByText(issuedKey)).toBeVisible())
})

test('claims a free trial API key via POST, stores it, and navigates directly to key usage results', async () => {
  const trialKey = 'sk-free-trial-token-value'
  const fetchMock = vi.fn(async (path: string) => {
    if (path === '/api/shared/trial-key') {
      return Response.json({
        success: true,
        data: { key: trialKey, expired_time: 1800000000 },
      })
    }
    if (path === '/api/shared/usage') {
      return Response.json({ id: lookupId })
    }
    if (path === `${pathPrefix}/totals`) {
      return Response.json({
        code: true,
        data: {
          ...usage.data,
          masked_key: 'sk-free**********alue',
          trial_refill: {
            eligible: true,
            can_refill: false,
            already_full: true,
            next_refill_at: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
            target_quota: 68493,
          },
        },
      })
    }
    if (path === `${pathPrefix}/logs`) {
      return Response.json({ success: true, data: [] })
    }
    if (path === '/api/pricing') {
      return Response.json({
        success: true,
        data: [
          {
            model_name: 'gpt-6-luna',
            model_ratio: 0.15,
            completion_ratio: 2,
            quota_type: 0,
            enable_groups: ['default'],
          },
        ],
        group_ratio: { default: 1 },
      })
    }
    return Response.json({ success: true, data: [] })
  })
  vi.stubGlobal('fetch', fetchMock)

  const user = userEvent.setup()
  renderPage()
  expect(
    screen.queryByText('Direct group · Valid for 1 month')
  ).not.toBeInTheDocument()
  await user.click(
    await screen.findByRole('button', {
      name: 'Permanent free trial Key — click to claim, works great for translation',
    })
  )

  expect(fetchMock).toHaveBeenCalledWith(
    '/api/shared/trial-key',
    expect.objectContaining({
      method: 'POST',
      headers: { 'X-Shared-Portal': '1' },
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    })
  )
  await waitFor(() =>
    expect(localStorage.getItem('shared_trial_key')).toBe(trialKey)
  )
  expect(
    await screen.findByRole('heading', { name: 'API Key usage' })
  ).toBeVisible()
  expect(await screen.findByText(trialKey)).toBeVisible()
  expect(screen.getAllByText('gpt-6-luna').length).toBeGreaterThanOrEqual(1)
  expect(
    screen.getByText(
      /Shows the first configured model by default; you can switch to other available models\./
    )
  ).toBeVisible()
  expect(screen.queryByText('cURL example')).not.toBeInTheDocument()
  expect(
    screen.getByText(
      'Low-quota Keys are not recommended for Hermes or coding Agents—they will drain in seconds. Best suited for non-Agent tasks like translation.'
    )
  ).toBeVisible()
  expect(
    screen.getByText(/Free refill is available once per week\./)
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Free refill' })).toBeDisabled()
})

test('keeps claimed state on home page when usage verification is rate-limited', async () => {
  const trialKey = 'sk-stored-rate-limited-key'
  localStorage.setItem('shared_trial_key', trialKey)
  const fetchMock = vi.fn(async (path: string) => {
    if (path === '/api/shared/usage') {
      return new Response(null, { status: 429 })
    }
    return Response.json({ success: true, data: [] })
  })
  vi.stubGlobal('fetch', fetchMock)

  renderPage()
  expect(
    await screen.findByRole('button', {
      name: 'Free Key claimed — click to check quota & usage guide',
    })
  ).toBeVisible()
  expect(localStorage.getItem('shared_trial_key')).toBe(trialKey)
})

test('shows claimed button on home when stored key is valid and opens usage page on click', async () => {
  const trialKey = 'sk-valid-stored-trial-key'
  localStorage.setItem('shared_trial_key', trialKey)
  const fetchMock = vi.fn(async (path: string) => {
    if (path === '/api/shared/usage') {
      return Response.json({ id: lookupId })
    }
    if (path === `${pathPrefix}/totals`) {
      return Response.json({
        code: true,
        data: {
          ...usage.data,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          total_available: 1000,
          masked_key: 'sk-vali**********-key',
        },
      })
    }
    if (path === `${pathPrefix}/logs`) {
      return Response.json({ success: true, data: [] })
    }
    return Response.json({ success: true, data: [] })
  })
  vi.stubGlobal('fetch', fetchMock)

  const user = userEvent.setup()
  renderPage()
  const claimedButton = await screen.findByRole('button', {
    name: 'Free Key claimed — click to check quota & usage guide',
  })
  expect(claimedButton).toBeVisible()

  await user.click(claimedButton)
  expect(
    await screen.findByRole('heading', { name: 'API Key usage' })
  ).toBeVisible()
})

test('supports free weekly refill on Direct trial key usage page', async () => {
  let refilled = false
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === `${pathPrefix}/refill` && init?.method === 'POST') {
      refilled = true
      return Response.json({
        success: true,
        data: {
          remain_quota: 700000,
          expired_time: 1900000000,
          next_refill_at: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
        },
      })
    }
    if (path === `${pathPrefix}/totals`) {
      return Response.json({
        code: true,
        data: {
          ...usage.data,
          total_available: refilled ? 700000 : 100000,
          trial_refill: {
            eligible: true,
            can_refill: !refilled,
            already_full: refilled,
            next_refill_at: refilled
              ? Math.floor(Date.now() / 1000) + 7 * 24 * 3600
              : 0,
            target_quota: 700000,
          },
        },
      })
    }
    if (path === `${pathPrefix}/logs`) {
      return Response.json({ success: true, data: [] })
    }
    return Response.json({ success: true, data: [] })
  })
  vi.stubGlobal('fetch', fetchMock)

  const user = userEvent.setup()
  renderPage(`/key-usage/${lookupId}`)

  const refillBtn = await screen.findByRole('button', { name: 'Free refill' })
  expect(refillBtn).toBeEnabled()
  await user.click(refillBtn)

  expect(fetchMock).toHaveBeenCalledWith(
    `${pathPrefix}/refill`,
    expect.objectContaining({ method: 'POST' })
  )
  expect(await screen.findByText('Quota refilled to ¥1.')).toBeVisible()
  await waitFor(() => expect(refillBtn).toBeDisabled())
})

test('shows distinct error messages for trial already claimed, IP cooldown, and daily limit', async () => {
  const responses = [
    Response.json(
      { success: false, code: 'already_claimed', message: 'already claimed' },
      { status: 409 }
    ),
    Response.json(
      { success: false, code: 'ip_cooldown', message: 'cooldown' },
      { status: 429 }
    ),
    Response.json(
      { success: false, code: 'daily_limit_reached', message: 'daily limit' },
      { status: 429 }
    ),
  ]
  const fetchMock = vi.fn(async (path: string) => {
    if (path === '/api/shared/trial-key') {
      return responses.shift() ?? new Response(null, { status: 503 })
    }
    return Response.json({ success: true, data: [] })
  })
  vi.stubGlobal('fetch', fetchMock)

  const user = userEvent.setup()
  renderPage()
  const claimButton = await screen.findByRole('button', {
    name: 'Permanent free trial Key — click to claim, works great for translation',
  })

  await user.click(claimButton)
  expect(
    await screen.findByText('You have already claimed a free trial API key.')
  ).toBeVisible()

  await user.click(claimButton)
  expect(
    await screen.findByText(
      'Too many claims from this IP. Please try again in 10 minutes.'
    )
  ).toBeVisible()

  await user.click(claimButton)
  expect(
    await screen.findByText(
      "Today's free trial keys have been fully claimed. Please try again tomorrow."
    )
  ).toBeVisible()
})

test('attaches bearer token when claiming while logged in', async () => {
  const trialKey = 'sk-admin-trial-token-value'
  const fetchMock = vi.fn(async (path: string) => {
    if (path === '/api/shared/trial-key') {
      return Response.json({
        success: true,
        data: { key: trialKey, expired_time: 1800000000 },
      })
    }
    if (path === '/api/shared/usage') {
      return Response.json({ id: lookupId })
    }
    if (path === `${pathPrefix}/totals`) {
      return Response.json(usage)
    }
    return Response.json({ success: true, data: [] })
  })
  vi.stubGlobal('fetch', fetchMock)

  useAuthStore.getState().auth.setBundle({
    access_token: 'admin-jwt-token',
    token_type: 'Bearer',
    access_expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: 1,
      username: 'admin',
      display_name: 'Admin',
      role: 100,
      status: 1,
      email: '',
      group: 'default',
    },
    session: {
      sid: 'sid-1',
      created_at: 0,
      last_seen_at: 0,
      expires_at: Math.floor(Date.now() / 1000) + 86400,
    },
  })

  const user = userEvent.setup()
  renderPage()
  await user.click(
    await screen.findByRole('button', {
      name: 'Permanent free trial Key — click to claim, works great for translation',
    })
  )

  expect(fetchMock).toHaveBeenCalledWith(
    '/api/shared/trial-key',
    expect.objectContaining({
      method: 'POST',
      headers: {
        'X-Shared-Portal': '1',
        Authorization: 'Bearer admin-jwt-token',
      },
    })
  )
})

test('shows call count, tokens, total spent, and performance status in model usage cards', async () => {
  const fetchMock = vi.fn(async (path: string) => {
    if (path === `${pathPrefix}/totals`) {
      return Response.json(usage)
    }
    if (path === `${pathPrefix}/logs`) {
      return Response.json({
        success: true,
        data: [
          {
            id: 1,
            created_at: 1800000000,
            type: 2,
            model_name: 'mercury-3',
            prompt_tokens: 1000,
            completion_tokens: 2000,
            quota: 50000,
          },
          {
            id: 2,
            created_at: 1800000100,
            type: 2,
            model_name: 'mercury-3',
            prompt_tokens: 5212,
            completion_tokens: 7988,
            quota: 100000,
          },
          {
            id: 3,
            created_at: 1800000200,
            type: 2,
            model_name: 'gpt-6-luna',
            prompt_tokens: 2789,
            completion_tokens: 1602,
            quota: 25000,
          },
        ],
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
              model_name: 'mercury-3',
              avg_latency_ms: 4320,
              avg_tps: 41.2,
              success_rate: 100,
              recent_success_series: [
                { ts: 3600, success_rate: 100 },
                { ts: 7200, success_rate: 100 },
              ],
            },
          ],
          recent_success_series: {
            'mercury-3': [
              { ts: 3600, success_rate: 100 },
              { ts: 7200, success_rate: 100 },
            ],
          },
        },
      })
    }
    return Response.json({ success: true, data: [] })
  })
  vi.stubGlobal('fetch', fetchMock)

  renderPage(`/key-usage/${lookupId}`)

  const mercuryCard = (await screen.findByText('mercury-3')).closest('li')
  expect(mercuryCard).not.toBeNull()
  if (!mercuryCard) throw new Error('mercury-3 card not found')
  const mercuryStats = within(mercuryCard).getAllByRole('term')
  expect(mercuryStats.slice(0, 4).map((term) => term.textContent)).toEqual([
    'Call count',
    'Input tokens',
    'Output tokens',
    'Total spent',
  ])
  const mercuryValues = within(mercuryCard).getAllByRole('definition')
  expect(
    mercuryValues.slice(0, 4).map((definition) => definition.textContent)
  ).toEqual(['2', '6,212', '9,988', '¥2.1'])

  const mercuryPerf = await within(mercuryCard).findByLabelText(
    'Performance metrics for the last 24 hours'
  )
  expect(within(mercuryPerf).getByText('100.00%')).toBeVisible()
  expect(within(mercuryPerf).getByText('4.32s')).toBeVisible()
  expect(within(mercuryPerf).getByText('41.2t/s')).toBeVisible()

  const gptCard = screen
    .getAllByText('gpt-6-luna')
    .find((el) => el.closest('li'))
    ?.closest('li')
  expect(gptCard).not.toBeNull()
  if (!gptCard) throw new Error('gpt-6-luna card not found')
  expect(
    within(gptCard)
      .getAllByRole('definition')
      .slice(0, 4)
      .map((d) => d.textContent)
  ).toEqual(['1', '2,789', '1,602', '¥0.35'])
  const gptPerf = within(gptCard).getByLabelText(
    'Performance metrics for the last 24 hours'
  )
  expect(within(gptPerf).getByText('—s')).toBeVisible()
  expect(within(gptPerf).getByText('—t/s')).toBeVisible()
})
