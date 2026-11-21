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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FolderCog } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  deleteRedemptionGroup,
  downloadRedemptionGroupCodes,
  redemptionGroupsQueryKey,
  saveRedemptionGroup,
} from '../api'
import { downloadRedemptionFile } from '../lib/utils'
import type { RedemptionGroup } from '../types'
import { RedemptionGroupSelect } from './redemption-group-select'

type RedemptionGroupsProps = {
  groups: RedemptionGroup[]
  groupId?: number
  groupsLoaded: boolean
  onSelectGroup: (id?: number) => void
}

export function RedemptionGroups(props: RedemptionGroupsProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [action, setAction] = useState<'create' | 'rename' | 'delete' | null>(
    null
  )
  const selectedGroup = props.groups.find((group) => group.id === props.groupId)
  const form = useForm<{ name: string }>({
    resolver: zodResolver(
      z.object({
        name: z
          .string()
          .trim()
          .refine(
            (name) => name.length > 0 && [...name].length <= 64,
            t('Group name must contain 1 to 64 characters')
          ),
      })
    ),
    defaultValues: { name: '' },
  })

  const save = useMutation({
    mutationFn: async (values: { name: string; id?: number }) =>
      requireServerSuccess(await saveRedemptionGroup(values.name, values.id)),
    onSuccess: async (response) => {
      setAction(null)
      await queryClient.invalidateQueries({
        queryKey: redemptionGroupsQueryKey,
      })
      if (response.data) props.onSelectGroup(response.data.id)
    },
  })
  const deletion = useMutation({
    mutationFn: async (id: number) =>
      requireServerSuccess(await deleteRedemptionGroup(id)),
    onSuccess: async () => {
      setAction(null)
      props.onSelectGroup(0)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: redemptionGroupsQueryKey }),
        queryClient.invalidateQueries({ queryKey: ['redemptions'] }),
      ])
    },
  })
  const download = useMutation({
    mutationFn: downloadRedemptionGroupCodes,
    onSuccess: (blob, id) => {
      if (!blob.size) {
        toast.info(t('No usable codes in this group'))
        return
      }
      downloadRedemptionFile(blob, `redemption-group-${id}.txt`)
    },
  })

  return (
    <div className='flex min-w-0 items-center gap-2'>
      <RedemptionGroupSelect
        groups={props.groups}
        value={props.groupId}
        onChange={props.onSelectGroup}
        allowAll
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant='outline'
              aria-label={t('Manage Redemption Groups')}
              title={t('Manage Redemption Groups')}
            />
          }
        >
          <FolderCog aria-hidden='true' />
          <span className='hidden sm:inline'>
            {t('Manage Redemption Groups')}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start'>
          <DropdownMenuItem
            onClick={() => {
              form.reset({ name: '' })
              setAction('create')
            }}
          >
            {t('New Group')}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!props.groupsLoaded || !selectedGroup}
            onClick={() => {
              form.reset({ name: selectedGroup?.name ?? '' })
              setAction('rename')
            }}
          >
            {t('Rename Group')}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!selectedGroup || download.isPending}
            onClick={() => {
              if (selectedGroup) download.mutate(selectedGroup.id)
            }}
          >
            {t('Download Usable Codes')}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!props.groupsLoaded || !selectedGroup}
            variant='destructive'
            onClick={() => setAction('delete')}
          >
            {t('Delete Group')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        title={action === 'rename' ? t('Rename Group') : t('New Group')}
        open={action === 'create' || action === 'rename'}
        onOpenChange={(open) => {
          if (!open && !save.isPending) setAction(null)
        }}
        contentClassName='sm:max-w-md'
        footer={
          <Button
            type='submit'
            form='redemption-group-form'
            disabled={save.isPending}
          >
            {t('Save')}
          </Button>
        }
      >
        <Form {...form}>
          <form
            id='redemption-group-form'
            onSubmit={form.handleSubmit((values) => {
              if (!save.isPending && (action === 'create' || selectedGroup)) {
                save.mutate({
                  name: values.name,
                  id: action === 'rename' ? selectedGroup?.id : undefined,
                })
              }
            })}
          >
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Group Name')}</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={save.isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </Dialog>
      <ConfirmDialog
        destructive
        open={action === 'delete'}
        onOpenChange={(open) => {
          if (!open && !deletion.isPending) setAction(null)
        }}
        title={t('Delete Group')}
        desc={t('Codes in this group will become ungrouped.')}
        confirmText={t('Delete')}
        isLoading={deletion.isPending}
        disabled={!selectedGroup}
        handleConfirm={() => {
          if (selectedGroup) deletion.mutate(selectedGroup.id)
        }}
      />
    </div>
  )
}
