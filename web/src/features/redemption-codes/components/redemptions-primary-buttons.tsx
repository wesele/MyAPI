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
import { Ban, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import { deleteInvalidRedemptions, disableRedemptionGroupCodes } from '../api'
import { ERROR_MESSAGES } from '../constants'
import type { RedemptionGroup } from '../types'
import { useRedemptions } from './redemptions-provider'

export function RedemptionsPrimaryButtons(props: {
  currentGroup?: RedemptionGroup
}) {
  const { t } = useTranslation()
  const { setOpen, triggerRefresh } = useRedemptions()
  const [showDeleteInvalidConfirm, setShowDeleteInvalidConfirm] =
    useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [disableTarget, setDisableTarget] = useState<RedemptionGroup>()
  const currentDisableTarget =
    disableTarget?.id === props.currentGroup?.id ? disableTarget : undefined
  const disableGroup = useMutation({
    mutationFn: async (groupId: number) =>
      requireServerSuccess(await disableRedemptionGroupCodes(groupId)).data ??
      0,
    onSuccess: (count) => {
      toast.success(t('Disabled {{count}} redemption codes', { count }))
      triggerRefresh()
      setDisableTarget(undefined)
    },
  })

  const handleDeleteInvalid = async () => {
    setIsDeleting(true)
    try {
      const result = await deleteInvalidRedemptions()
      if (result.success) {
        const count = result.data || 0
        toast.success(
          t('Successfully deleted {{count}} invalid redemption codes', {
            count,
          })
        )
        triggerRefresh()
        setShowDeleteInvalidConfirm(false)
      } else {
        handleServerError(result, t(ERROR_MESSAGES.DELETE_INVALID_FAILED))
      }
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
      <div className='flex flex-wrap gap-2'>
        <Button
          size='sm'
          variant='outline'
          disabled={!props.currentGroup || disableGroup.isPending}
          onClick={() => setDisableTarget(props.currentGroup)}
        >
          <Ban className='text-destructive size-4' aria-hidden='true' />
          {t('Disable Current Group')}
        </Button>
        <Button
          size='sm'
          variant='outline'
          onClick={() => setShowDeleteInvalidConfirm(true)}
        >
          <Trash2 className='text-destructive h-4 w-4' />
          {t('Delete Invalid')}
        </Button>
        <Button size='sm' onClick={() => setOpen('create')}>
          <Plus className='h-4 w-4' />
          {t('Create Code')}
        </Button>
      </div>

      <ConfirmDialog
        destructive
        open={currentDisableTarget !== undefined}
        onOpenChange={(open) => {
          if (!open && !disableGroup.isPending) setDisableTarget(undefined)
        }}
        handleConfirm={() => {
          if (currentDisableTarget && !disableGroup.isPending) {
            disableGroup.mutate(currentDisableTarget.id)
          }
        }}
        isLoading={disableGroup.isPending}
        title={t('Disable Current Group')}
        desc={t('Disable all enabled redemption codes in “{{group}}”?', {
          group: currentDisableTarget?.name ?? '',
        })}
        confirmText={disableGroup.isPending ? t('Disabling...') : t('Disable')}
      />

      <ConfirmDialog
        destructive
        open={showDeleteInvalidConfirm}
        onOpenChange={setShowDeleteInvalidConfirm}
        handleConfirm={handleDeleteInvalid}
        isLoading={isDeleting}
        className='max-w-md'
        title={t('Delete Invalid Redemption Codes?')}
        desc={
          <>
            <Trans
              t={t}
              i18nKey='This will delete all <strong>used</strong>, <strong>disabled</strong>, and <strong>expired</strong> redemption codes.'
              components={{ strong: <strong /> }}
            />
            <br />
            {t('This action cannot be undone.')}
          </>
        }
        confirmText={t('Delete Invalid')}
      />
    </>
  )
}
