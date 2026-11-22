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
import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { requireServerSuccess } from '@/lib/server-error-message'

import { apiKeyGroupsQueryKey, getApiKeyGroups } from './api'
import { ApiKeysDialogs } from './components/api-keys-dialogs'
import { ApiKeysPrimaryButtons } from './components/api-keys-primary-buttons'
import { ApiKeysProvider } from './components/api-keys-provider'
import { ApiKeysTable } from './components/api-keys-table'
import type { ApiKeyGroup } from './types'

const route = getRouteApi('/_authenticated/keys/')
const emptyGroups: ApiKeyGroup[] = []

export function ApiKeys() {
  const { t } = useTranslation()
  const groupId = route.useSearch({ select: (search) => search.groupId })
  const navigate = route.useNavigate()
  const groupsQuery = useQuery({
    queryKey: apiKeyGroupsQueryKey,
    queryFn: async () =>
      requireServerSuccess(await getApiKeyGroups()).data ?? emptyGroups,
  })
  const groups = groupsQuery.data ?? emptyGroups
  const currentGroup =
    groupId === 0
      ? { id: 0, name: t('Ungrouped') }
      : groups.find((group) => group.id === groupId)
  const selectGroup = (id?: number) => {
    void navigate({
      search: (previous) => ({ ...previous, groupId: id, page: undefined }),
    })
  }

  return (
    <ApiKeysProvider>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>{t('API Keys')}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <ApiKeysPrimaryButtons currentGroup={currentGroup} />
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <ApiKeysTable
            key={groupId ?? 'all'}
            groupId={groupId}
            groups={groups}
            groupsLoaded={groupsQuery.isSuccess}
            onSelectGroup={selectGroup}
          />
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <ApiKeysDialogs groups={groups} groupId={groupId} />
    </ApiKeysProvider>
  )
}
