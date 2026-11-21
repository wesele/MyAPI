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

import { getRedemptionGroups, redemptionGroupsQueryKey } from './api'
import { RedemptionsDialogs } from './components/redemptions-dialogs'
import { RedemptionsPrimaryButtons } from './components/redemptions-primary-buttons'
import { RedemptionsProvider } from './components/redemptions-provider'
import { RedemptionsTable } from './components/redemptions-table'
import type { RedemptionGroup } from './types'

const route = getRouteApi('/_authenticated/redemption-codes/')
const emptyGroups: RedemptionGroup[] = []

export function Redemptions() {
  const { t } = useTranslation()
  const groupId = route.useSearch({ select: (search) => search.groupId })
  const navigate = route.useNavigate()
  const groupsQuery = useQuery({
    queryKey: redemptionGroupsQueryKey,
    queryFn: async () =>
      requireServerSuccess(await getRedemptionGroups()).data ?? emptyGroups,
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
    <RedemptionsProvider>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          {t('Redemption Codes')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <RedemptionsPrimaryButtons currentGroup={currentGroup} />
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <RedemptionsTable
            key={groupId ?? 'all'}
            groupId={groupId}
            groups={groups}
            groupsLoaded={groupsQuery.isSuccess}
            onSelectGroup={selectGroup}
          />
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <RedemptionsDialogs groups={groups} groupId={groupId} />
    </RedemptionsProvider>
  )
}
