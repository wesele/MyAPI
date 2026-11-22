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
  apiKeyGroupsQueryKey,
  deleteApiKeyGroup,
  downloadApiKeyGroupKeys,
  saveApiKeyGroup,
} from '../api'
import type { ApiKeyGroup } from '../types'

type ApiKeyGroupsProps = {
  groups: ApiKeyGroup[]
  groupId?: number
  groupsLoaded: boolean
  onSelectGroup: (id?: number) => void
}

export function ApiKeyGroups(props: ApiKeyGroupsProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  return (
    <ResourceGroupManager
      groups={props.groups}
      groupId={props.groupId}
      groupsLoaded={props.groupsLoaded}
      onSelectGroup={props.onSelectGroup}
      selectAriaLabel={t('Key Group')}
      manageLabel={t('Manage Key Groups')}
      deleteDescription={t('Keys in this group will become ungrouped.')}
      downloadLabel={t('Download Usable Keys')}
      emptyDownloadMessage={t('No usable keys in this group')}
      downloadFilename={(id) => `api-key-group-${id}.txt`}
      formId='api-key-group-form'
      showConcurrencyLimit
      onSave={async (values) => {
        const response = requireServerSuccess(
          await saveApiKeyGroup(
            values.name,
            values.id,
            values.concurrency_limit
          )
        )
        await queryClient.invalidateQueries({
          queryKey: apiKeyGroupsQueryKey,
        })
        return response.data
      }}
      onDelete={async (id) => {
        requireServerSuccess(await deleteApiKeyGroup(id))
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: apiKeyGroupsQueryKey }),
          queryClient.invalidateQueries({ queryKey: ['keys'] }),
        ])
      }}
      onDownload={downloadApiKeyGroupKeys}
    />
  )
}
