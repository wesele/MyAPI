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
import { afterEach, expect, test, vi } from 'vitest'

import { SubscriptionSurvey } from '../survey'

afterEach(() => vi.unstubAllGlobals())

test('selects a yuan option by its label and sends the selected amount', async () => {
  const request = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'PUT') return Response.json({ amount: 20 })
    if (url === '/api/shared/survey') return Response.json({ amount: 0 })
    return Response.json({ success: true, data: [] })
  })
  vi.stubGlobal('fetch', request)

  const root = createRootRoute({ component: Outlet })
  const survey = createRoute({
    getParentRoute: () => root,
    path: '/survey',
    component: SubscriptionSurvey,
  })
  const router = createRouter({
    routeTree: root.addChildren([survey]),
    history: createMemoryHistory({ initialEntries: ['/survey'] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  try {
    await screen.findByRole('button', { name: 'Submit' })
    const group = screen.getByRole('radiogroup', {
      name: 'How much would you contribute?',
    })
    expect(within(group).getAllByRole('radio')).toHaveLength(3)
    const radio = within(group).getByRole('radio', { name: /20 yuan.*79 yuan/ })
    const user = userEvent.setup()
    await user.click(within(group).getByText('20 yuan'))
    expect(radio).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Your response: 20 yuan'
    )
    expect(request).toHaveBeenCalledWith(
      '/api/shared/survey',
      expect.objectContaining({
        method: 'PUT',
        body: '{"amount":20}',
      })
    )
  } finally {
    view.unmount()
    client.clear()
  }
})
