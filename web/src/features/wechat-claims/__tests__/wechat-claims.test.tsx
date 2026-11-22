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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { WeChatClaims } from '../index'

afterEach(() => vi.restoreAllMocks())

describe('WeChatClaims', () => {
  test('renders claim records and deletes a selected record after confirmation', async () => {
    let deleted = false
    const getSpy = vi.spyOn(api, 'get').mockImplementation(async (url) => {
      if (url === '/api/redemption/groups') {
        return {
          data: {
            success: true,
            message: '',
            data: [{ id: 1, name: 'Official Account' }],
          },
        }
      }
      if (url === '/api/wechat-official-account/claims') {
        return {
          data: {
            success: true,
            message: '',
            data: {
              page: 1,
              page_size: 20,
              total: deleted ? 0 : 1,
              items: deleted
                ? []
                : [
                    {
                      id: 42,
                      event_id: 'evt-1',
                      open_id: 'oWeChatSubscriber001',
                      original_id: 'gh_official',
                      group_id: 1,
                      group_name: 'Official Account',
                      redemption_id: 7,
                      redemption_key: '1234567890abcdef1234567890abcdef',
                      claimed_at: 1795280000,
                      redemption_name: 'WeChat Gift',
                      redemption_status: 1,
                      used_user_id: 0,
                      redeemed_time: 0,
                    },
                  ],
            },
          },
        }
      }
      throw new Error(`Unexpected GET ${url}`)
    })
    const deleteSpy = vi.spyOn(api, 'delete').mockImplementation(async () => {
      deleted = true
      return { data: { success: true, message: '', data: null } }
    })

    const root = createRootRoute({ component: Outlet })
    const claimsRoute = createRoute({
      getParentRoute: () => root,
      path: '/wechat-claims',
      component: WeChatClaims,
    })
    const settingsRoute = createRoute({
      getParentRoute: () => root,
      path: '/wechat-official-account',
      component: () => null,
    })
    const router = createRouter({
      routeTree: root.addChildren([claimsRoute, settingsRoute]),
      history: createMemoryHistory({ initialEntries: ['/wechat-claims'] }),
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
      expect(
        await screen.findByText('oWeChatSubscriber001')
      ).toBeInTheDocument()
      expect(
        within(screen.getByRole('table')).getByText('Official Account')
      ).toBeInTheDocument()

      const user = userEvent.setup()
      await user.click(
        screen.getByRole('button', { name: 'Delete claim record' })
      )
      expect(
        await screen.findByText('Delete claim record?')
      ).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Delete' }))

      await waitFor(() => {
        expect(deleteSpy).toHaveBeenCalledWith(
          '/api/wechat-official-account/claims/42'
        )
      })
      expect(
        await screen.findByText('No WeChat claim records found')
      ).toBeInTheDocument()
      expect(getSpy).toHaveBeenCalledWith(
        '/api/wechat-official-account/claims',
        expect.anything()
      )
    } finally {
      view.unmount()
      client.clear()
    }
  })
})
