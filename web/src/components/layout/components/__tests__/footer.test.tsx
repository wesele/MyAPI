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
import { render } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { useSystemConfigStore } from '@/stores/system-config-store'

import { Footer } from '../footer'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({
    status: null,
    loading: false,
    error: null,
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: (props: {
    to: string
    children: React.ReactNode
    className?: string
  }) => (
    <a href={props.to} className={props.className}>
      {props.children}
    </a>
  ),
}))

describe('Footer custom HTML sanitization', () => {
  afterEach(() => {
    useSystemConfigStore.setState((state) => ({
      ...state,
      config: {
        ...state.config,
        footerHtml: undefined,
      },
    }))
  })

  test('strips dangerous tags and event handlers while keeping safe links', () => {
    useSystemConfigStore.setState((state) => ({
      ...state,
      config: {
        ...state.config,
        footerHtml:
          '<div class="custom"><script>window.__xss=1</script><img src="x" onerror="window.__xss=2" /><a href="https://example.com" onclick="alert(1)">Docs</a></div>',
      },
    }))

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const view = render(
      <QueryClientProvider client={queryClient}>
        <Footer />
      </QueryClientProvider>
    )
    const customFooter = view.container.querySelector('.custom-footer')

    expect(customFooter).not.toBeNull()
    expect(customFooter?.querySelector('script')).toBeNull()
    const img = customFooter?.querySelector('img')
    expect(img?.getAttribute('onerror')).toBeNull()
    const link = customFooter?.querySelector('a[href="https://example.com"]')
    expect(link).not.toBeNull()
    expect(link?.getAttribute('onclick')).toBeNull()
    expect(link).toHaveTextContent('Docs')
  })
})
