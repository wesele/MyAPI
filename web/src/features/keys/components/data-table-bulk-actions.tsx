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
import { useMutation } from '@tanstack/react-query'
import type { Table } from '@tanstack/react-table'
import { Copy, FolderInput, Loader2, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTableBulkActions as BulkActionsToolbar } from '@/components/data-table'
import { ResourceGroupSelect } from '@/components/resource-group-select'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { copyToClipboard } from '@/lib/copy-to-clipboard'
import { requireServerSuccess } from '@/lib/server-error-message'

import { moveApiKeysToGroup } from '../api'
import type { ApiKey, ApiKeyGroup } from '../types'
import { ApiKeysMultiDeleteDialog } from './api-keys-multi-delete-dialog'
import { useApiKeys } from './api-keys-provider'

type DataTableBulkActionsProps<TData> = {
  table: Table<TData>
  groups?: ApiKeyGroup[]
  groupId?: number
}

export function DataTableBulkActions<TData>({
  table,
  groups,
  groupId,
}: DataTableBulkActionsProps<TData>) {
  const { t } = useTranslation()
  const { resolveRealKeysBatch, triggerRefresh } = useApiKeys()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [moveTargets, setMoveTargets] = useState<number[] | null>(null)
  const [destination, setDestination] = useState<number>()
  const [isCopying, setIsCopying] = useState(false)
  const selectedRows = table.getFilteredSelectedRowModel().rows

  const move = useMutation({
    mutationFn: async (request: { targets: number[]; destination: number }) =>
      requireServerSuccess(
        await moveApiKeysToGroup(request.targets, request.destination)
      ),
    onSuccess: (_, request) => {
      setMoveTargets(null)
      const targetIds = new Set(request.targets)
      table.setRowSelection((previous) => {
        const next = { ...previous }
        for (const row of table.getSelectedRowModel().rows) {
          if (targetIds.has((row.original as ApiKey).id)) {
            delete next[row.id]
          }
        }
        return next
      })
      triggerRefresh()
    },
  })

  const handleBatchCopy = useCallback(async () => {
    if (selectedRows.length === 0) return

    setIsCopying(true)
    try {
      const ids = selectedRows.map((row) => (row.original as ApiKey).id)
      const keysMap = await resolveRealKeysBatch(ids)

      const lines: string[] = []
      for (const row of selectedRows) {
        const apiKey = row.original as ApiKey
        const realKey = keysMap[apiKey.id]
        if (realKey) {
          lines.push(`${apiKey.name}\t${realKey}`)
        }
      }

      if (lines.length > 0) {
        const ok = await copyToClipboard(lines.join('\n'))
        if (ok) {
          toast.success(t('Copied {{count}} key(s)', { count: lines.length }))
        } else {
          toast.error(t('Failed to copy keys'))
        }
      }
    } catch {
      toast.error(t('Failed to copy keys'))
    } finally {
      setIsCopying(false)
    }
  }, [selectedRows, resolveRealKeysBatch, t])

  return (
    <>
      <BulkActionsToolbar table={table} entityName='API key'>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='outline'
                size='icon'
                className='size-8'
                onClick={handleBatchCopy}
                disabled={isCopying}
                aria-label={t('Copy selected keys')}
              />
            }
          >
            {isCopying ? (
              <Loader2 className='size-4 animate-spin' />
            ) : (
              <Copy className='size-4' />
            )}
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('Copy selected keys')}</p>
          </TooltipContent>
        </Tooltip>

        {groups && groups.length > 0 && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant='outline'
                  size='icon'
                  className='size-8'
                  aria-label={t('Move to Group')}
                  onClick={() => {
                    setDestination(undefined)
                    setMoveTargets(
                      selectedRows.map((row) => (row.original as ApiKey).id)
                    )
                  }}
                />
              }
            >
              <FolderInput aria-hidden='true' />
            </TooltipTrigger>
            <TooltipContent>{t('Move to Group')}</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='destructive'
                size='icon'
                onClick={() => setShowDeleteConfirm(true)}
                className='size-8'
                aria-label={t('Delete selected API keys')}
              />
            }
          >
            <Trash2 />
            <span className='sr-only'>{t('Delete selected API keys')}</span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('Delete selected API keys')}</p>
          </TooltipContent>
        </Tooltip>
      </BulkActionsToolbar>

      <ConfirmDialog
        open={moveTargets !== null}
        onOpenChange={(open) => {
          if (!open && !move.isPending) setMoveTargets(null)
        }}
        title={t('Move to Group')}
        desc={t('Select a group')}
        confirmText={t('Move')}
        disabled={
          !moveTargets?.length ||
          destination === undefined ||
          destination === groupId
        }
        isLoading={move.isPending}
        handleConfirm={() => {
          if (
            moveTargets?.length &&
            destination !== undefined &&
            !move.isPending
          ) {
            move.mutate({ targets: moveTargets, destination })
          }
        }}
      >
        <ResourceGroupSelect
          groups={groups ?? []}
          value={destination}
          onChange={setDestination}
          disabled={move.isPending}
        />
      </ConfirmDialog>

      <ApiKeysMultiDeleteDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        table={table}
      />
    </>
  )
}
