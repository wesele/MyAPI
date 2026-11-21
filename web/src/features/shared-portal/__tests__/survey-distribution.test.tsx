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
import { render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { SurveyDistribution } from '../survey-distribution'

afterEach(() => vi.unstubAllGlobals())

function renderResults(data: { amount: number; count: number }[] | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ success: true, data }))
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SurveyDistribution />
    </QueryClientProvider>
  )
}

test('shows the launch goal and each amount in yuan when ten people respond', async () => {
  renderResults([
    { amount: 10, count: 3 },
    { amount: 50, count: 7 },
  ])
  expect(await screen.findByText('10 of 10 participants')).toBeVisible()
  expect(screen.getByText('Launch goal reached')).toBeVisible()
  const list = screen.getByRole('list', { name: 'Responses by amount' })
  const rows = within(list).getAllByRole('listitem')
  expect(rows).toHaveLength(3)
  expect(rows[0]).toHaveTextContent('10 yuanResponses 3')
  expect(rows[1]).toHaveTextContent('20 yuanResponses 0')
  expect(rows[2]).toHaveTextContent('50 yuanResponses 7')
  expect(list).not.toHaveTextContent(/\$|USD/)
})

test('shows zero responses in all three tiers when there are no votes', async () => {
  renderResults(null)
  expect(await screen.findByText('0 of 10 participants')).toBeVisible()
  expect(screen.queryByText('Launch goal reached')).not.toBeInTheDocument()
  expect(screen.getAllByText('0')).toHaveLength(3)
})
