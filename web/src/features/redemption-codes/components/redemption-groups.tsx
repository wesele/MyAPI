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
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { ResourceGroupManager } from '@/components/resource-group-manager'
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  deleteRedemptionGroup,
  downloadRedemptionGroupCodes,
  redemptionGroupsQueryKey,
  saveRedemptionGroup,
} from '../api'
import type { RedemptionGroup } from '../types'

type RedemptionGroupsProps = {
  groups: RedemptionGroup[]
  groupId?: number
  groupsLoaded: boolean
  onSelectGroup: (id?: number) => void
}

export function RedemptionGroups(props: RedemptionGroupsProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  return (
    <ResourceGroupManager
      groups={props.groups}
      groupId={props.groupId}
      groupsLoaded={props.groupsLoaded}
      onSelectGroup={props.onSelectGroup}
      manageLabel={t('Manage Redemption Groups')}
      deleteDescription={t('Codes in this group will become ungrouped.')}
      downloadLabel={t('Download Usable Codes')}
      emptyDownloadMessage={t('No usable codes in this group')}
      downloadFilename={(id) => `redemption-group-${id}.txt`}
      formId='redemption-group-form'
      onSave={async (values) => {
        const response = requireServerSuccess(
          await saveRedemptionGroup(values.name, values.id)
        )
        await queryClient.invalidateQueries({
          queryKey: redemptionGroupsQueryKey,
        })
        return response.data
      }}
      onDelete={async (id) => {
        requireServerSuccess(await deleteRedemptionGroup(id))
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: redemptionGroupsQueryKey }),
          queryClient.invalidateQueries({ queryKey: ['redemptions'] }),
        ])
      }}
      onDownload={downloadRedemptionGroupCodes}
    />
  )
}
