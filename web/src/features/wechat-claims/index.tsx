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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { RefreshCw, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTablePage, useDataTable } from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  getRedemptionGroups,
  redemptionGroupsQueryKey,
} from '@/features/redemption-codes/api'
import { RedemptionGroupSelect } from '@/features/redemption-codes/components/redemption-group-select'
import type { RedemptionGroup } from '@/features/redemption-codes/types'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import { deleteWeChatClaim, getWeChatClaims, wechatClaimsQueryKey } from './api'
import { useWeChatClaimsColumns } from './components/claims-columns'
import type { WeChatClaim } from './types'

const emptyClaims: WeChatClaim[] = []
const emptyGroups: RedemptionGroup[] = []
const emptyColumnFilters: [] = []

export function WeChatClaims() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [globalFilter, setGlobalFilter] = useState('')
  const [groupId, setGroupId] = useState<number | undefined>(undefined)
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [deleteTarget, setDeleteTarget] = useState<WeChatClaim | null>(null)

  const groupsQuery = useQuery({
    queryKey: redemptionGroupsQueryKey,
    queryFn: async () =>
      requireServerSuccess(await getRedemptionGroups()).data ?? emptyGroups,
  })
  const groups = groupsQuery.data ?? emptyGroups

  const claimsQuery = useQuery({
    queryKey: [
      ...wechatClaimsQueryKey,
      pagination.pageIndex + 1,
      pagination.pageSize,
      globalFilter,
      groupId,
    ],
    queryFn: async () =>
      requireServerSuccess(
        await getWeChatClaims({
          p: pagination.pageIndex + 1,
          page_size: pagination.pageSize,
          keyword: globalFilter,
          group_id: groupId,
        })
      ).data,
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) =>
      requireServerSuccess(await deleteWeChatClaim(id)),
    onSuccess: async () => {
      setDeleteTarget(null)
      toast.success(t('Claim record deleted'))
      await queryClient.invalidateQueries({ queryKey: wechatClaimsQueryKey })
    },
    onError: (error) =>
      handleServerError(error, t('Could not delete WeChat redemption claim')),
  })

  const columns = useWeChatClaimsColumns((claim) => setDeleteTarget(claim))
  const { table } = useDataTable({
    columns,
    data: claimsQuery.data?.items ?? emptyClaims,
    getRowId: (claim) => String(claim.id),
    totalCount: claimsQuery.data?.total ?? 0,
    pagination,
    onPaginationChange: setPagination,
    columnFilters: emptyColumnFilters,
    globalFilter,
    onGlobalFilterChange: (updater) => {
      const next =
        typeof updater === 'function' ? updater(globalFilter) : updater
      setGlobalFilter(next)
      setPagination((previous) => ({ ...previous, pageIndex: 0 }))
    },
    enableRowSelection: false,
    enableSorting: false,
    manualFiltering: true,
    manualPagination: true,
  })

  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          {t('WeChat Claim Records')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button
            variant='outline'
            size='sm'
            nativeButton={false}
            render={<Link to='/wechat-official-account' />}
          >
            <Settings2 className='size-4' aria-hidden='true' />
            {t('WeChat Official Account API')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <DataTablePage
            table={table}
            columns={columns}
            isLoading={claimsQuery.isPending}
            isFetching={claimsQuery.isFetching}
            emptyTitle={t('No WeChat claim records found')}
            emptyDescription={t(
              'Records will appear here when subscribers receive a redemption code through WeChat.'
            )}
            toolbarProps={{
              searchPlaceholder: t(
                'Search OpenID, redemption code, or group...'
              ),
              searchDebounceMs: 300,
              additionalSearch: (
                <RedemptionGroupSelect
                  groups={groups}
                  value={groupId}
                  onChange={(id) => {
                    setGroupId(id)
                    setPagination((previous) => ({
                      ...previous,
                      pageIndex: 0,
                    }))
                  }}
                  allowAll
                />
              ),
              hasAdditionalFilters: groupId !== undefined,
              onReset: () => {
                setGroupId(undefined)
                setGlobalFilter('')
                setPagination((previous) => ({ ...previous, pageIndex: 0 }))
              },
              preActions: (
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => void claimsQuery.refetch()}
                  disabled={claimsQuery.isFetching}
                >
                  <RefreshCw
                    aria-hidden='true'
                    className={
                      claimsQuery.isFetching ? 'animate-spin' : undefined
                    }
                  />
                  {t('Refresh')}
                </Button>
              ),
            }}
          />
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) setDeleteTarget(null)
        }}
        title={t('Delete claim record?')}
        desc={t(
          'This removes claim record #{{id}} ({{openId}}) from the log table. The issued redemption code itself will not be deleted or re-issued.',
          {
            id: deleteTarget?.id ?? '',
            openId: deleteTarget?.open_id ?? '',
          }
        )}
        confirmText={t('Delete')}
        destructive
        isLoading={deleteMutation.isPending}
        handleConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
        }}
      />
    </>
  )
}
