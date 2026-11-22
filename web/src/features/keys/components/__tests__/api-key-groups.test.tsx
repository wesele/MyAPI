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
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { Toaster, toast } from 'sonner'
import { afterEach, expect, test, vi } from 'vitest'

import { useDataTable } from '@/components/data-table'
import { api } from '@/lib/api'

import { getApiKeys } from '../../api'
import type { ApiKey, ApiKeyGroup } from '../../types'
import { ApiKeyGroups } from '../api-key-groups'
import { ApiKeysPrimaryButtons } from '../api-keys-primary-buttons'
import { ApiKeysProvider, useApiKeys } from '../api-keys-provider'
import { DataTableBulkActions } from '../data-table-bulk-actions'

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
  initAsync: false,
})

const keysFixture: ApiKey[] = [11, 22, 33].map((id) => ({
  id,
  name: `key-${id}`,
  key: `demo****${id}`,
  status: 1,
  remain_quota: 100,
  used_quota: 0,
  unlimited_quota: true,
  expired_time: -1,
  created_time: 1,
  accessed_time: 0,
  group: 'default',
  group_id: 0,
  auto_groups: null,
  cross_group_retry: false,
  model_limits_enabled: false,
  model_limits: '',
  allow_ips: '',
  allow_user_quota_query: true,
}))

const columns = [{ accessorKey: 'name' }]
const clients: QueryClient[] = []

function KeyList(props: { groups: ApiKeyGroup[]; groupId?: number }) {
  const { refreshTrigger } = useApiKeys()
  const { data } = useQuery({
    queryKey: ['keys', refreshTrigger],
    queryFn: () => getApiKeys(),
  })
  const { table } = useDataTable({
    data: data?.data?.items ?? [],
    columns,
    enableRowSelection: true,
    getRowId: (row) => String(row.id),
  })
  return (
    <>
      {table.getRowModel().rows.map((row) => (
        <label key={row.id}>
          <input
            type='checkbox'
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
          />
          {row.original.name}
        </label>
      ))}
      <DataTableBulkActions
        table={table}
        groups={props.groups}
        groupId={props.groupId}
      />
    </>
  )
}

async function setup(options?: {
  currentGroup?: ApiKeyGroup
  groups?: ApiKeyGroup[]
  onSelectGroup?: (id?: number) => void
}) {
  const groups = options?.groups ?? [{ id: 5, name: 'Production' }]
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/token/') {
      return {
        data: {
          success: true,
          data: { items: keysFixture, total: keysFixture.length },
        },
      }
    }
    if (url === '/api/token/groups/5/download') {
      return { data: new Blob(['sk-usable-1'], { type: 'text/plain' }) }
    }
    return { data: { success: true, data: {} } }
  })
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: 4 },
  })
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: { success: true },
  })
  const del = vi.spyOn(api, 'delete').mockResolvedValue({
    data: { success: true },
  })

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['status'], {})
  clients.push(client)

  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ApiKeysProvider>
          <ApiKeysPrimaryButtons currentGroup={options?.currentGroup} />
          <ApiKeyGroups
            groups={groups}
            groupId={options?.currentGroup?.id}
            groupsLoaded
            onSelectGroup={options?.onSelectGroup ?? (() => {})}
          />
          <KeyList groups={groups} groupId={options?.currentGroup?.id} />
        </ApiKeysProvider>
        <Toaster />
      </QueryClientProvider>
    </I18nextProvider>
  )
  await screen.findByRole('checkbox', { name: 'key-11' })
  return { user: userEvent.setup(), post, put, del }
}

afterEach(() => {
  cleanup()
  toast.dismiss()
  vi.restoreAllMocks()
  for (const client of clients) client.clear()
  clients.length = 0
})

test('disabling current group is unavailable in all-groups view', async () => {
  await setup()
  expect(
    screen.getByRole('button', { name: 'Disable Current Group' })
  ).toBeDisabled()
})

test.each([
  { id: 5, name: 'Production' },
  { id: 0, name: 'Ungrouped' },
])('only disables $name after confirmation', async (group) => {
  const { user, post } = await setup({ currentGroup: group })
  await user.click(
    screen.getByRole('button', { name: 'Disable Current Group' })
  )
  const dialog = within(await screen.findByRole('alertdialog'))
  expect(
    dialog.getByText(`Disable all enabled API keys in “${group.name}”?`)
  ).toBeVisible()
  expect(post).not.toHaveBeenCalled()
  await user.click(dialog.getByRole('button', { name: 'Disable' }))

  expect(await screen.findByText('Disabled 4 API keys')).toBeVisible()
  expect(post).toHaveBeenCalledWith(`/api/token/groups/${group.id}/disable`)
})

test('moving selected API keys requires a group and submits only selected keys', async () => {
  const { user, put } = await setup()

  await user.click(screen.getByRole('checkbox', { name: 'key-11' }))
  await user.click(screen.getByRole('checkbox', { name: 'key-33' }))
  await user.click(screen.getByRole('button', { name: 'Move to Group' }))

  const dialog = within(await screen.findByRole('alertdialog'))
  expect(dialog.getByRole('button', { name: 'Move' })).toBeDisabled()
  await user.selectOptions(dialog.getByRole('combobox', { name: 'Group' }), '5')
  await user.click(dialog.getByRole('button', { name: 'Move' }))

  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
  expect(put).toHaveBeenCalledWith('/api/token/groups/members', {
    ids: [11, 33],
    group_id: 5,
  })
  expect(screen.getByRole('checkbox', { name: 'key-11' })).not.toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'key-33' })).not.toBeChecked()
})

test('creates, edits concurrency limit, and deletes an API key group via Manage Key Groups menu', async () => {
  const onSelectGroup = vi.fn()
  const { user, post, put, del } = await setup({
    groups: [{ id: 5, name: 'Production', concurrency_limit: 2 }],
    currentGroup: { id: 5, name: 'Production', concurrency_limit: 2 },
    onSelectGroup,
  })
  post.mockResolvedValueOnce({
    data: {
      success: true,
      data: { id: 9, name: 'Staging', concurrency_limit: 3 },
    },
  })

  expect(screen.getByText('Concurrency Limit: 2')).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'Manage Key Groups' }))
  await user.click(await screen.findByRole('menuitem', { name: 'New Group' }))
  const createDialog = within(await screen.findByRole('dialog'))
  await user.type(createDialog.getByLabelText('Group Name'), 'Staging')
  const createLimitInput = createDialog.getByLabelText('Concurrency Limit')
  await user.clear(createLimitInput)
  await user.type(createLimitInput, '3')
  await user.click(createDialog.getByRole('button', { name: 'Save' }))

  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/token/groups', {
      name: 'Staging',
      concurrency_limit: 3,
    })
  )
  expect(onSelectGroup).toHaveBeenCalledWith(9)

  put.mockResolvedValueOnce({
    data: {
      success: true,
      data: { id: 5, name: 'Production EU', concurrency_limit: 5 },
    },
  })
  await user.click(screen.getByRole('button', { name: 'Manage Key Groups' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Edit Group' }))
  const editDialog = within(await screen.findByRole('dialog'))
  const nameInput = editDialog.getByLabelText('Group Name')
  await user.clear(nameInput)
  await user.type(nameInput, 'Production EU')
  const editLimitInput = editDialog.getByLabelText('Concurrency Limit')
  expect(editLimitInput).toHaveValue(2)
  await user.clear(editLimitInput)
  await user.type(editLimitInput, '5')
  await user.click(editDialog.getByRole('button', { name: 'Save' }))

  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/token/groups/5', {
      name: 'Production EU',
      concurrency_limit: 5,
    })
  )

  await user.click(screen.getByRole('button', { name: 'Manage Key Groups' }))
  await user.click(
    await screen.findByRole('menuitem', { name: 'Delete Group' })
  )
  const confirm = within(await screen.findByRole('alertdialog'))
  expect(
    confirm.getByText('Keys in this group will become ungrouped.')
  ).toBeVisible()
  await user.click(confirm.getByRole('button', { name: 'Delete' }))

  await waitFor(() => expect(del).toHaveBeenCalledWith('/api/token/groups/5'))
  expect(onSelectGroup).toHaveBeenCalledWith(0)
})
