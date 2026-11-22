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
import { useMutation } from '@tanstack/react-query'
import { FolderCog } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import {
  ResourceGroupSelect,
  type ResourceGroup,
} from '@/components/resource-group-select'
import { Badge } from '@/components/ui/badge'
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

type ResourceGroupManagerProps = {
  groups: ResourceGroup[]
  groupId?: number
  groupsLoaded: boolean
  onSelectGroup: (id?: number) => void
  manageLabel: string
  deleteDescription: string
  formId: string
  selectAriaLabel?: string
  downloadLabel?: string
  emptyDownloadMessage?: string
  downloadFilename?: (id: number) => string
  showConcurrencyLimit?: boolean
  onSave: (values: {
    name: string
    concurrency_limit?: number
    id?: number
  }) => Promise<ResourceGroup | undefined>
  onDelete: (id: number) => Promise<void>
  onDownload?: (id: number) => Promise<Blob>
}

export function ResourceGroupManager(props: ResourceGroupManagerProps) {
  const { t } = useTranslation()
  const [action, setAction] = useState<'create' | 'rename' | 'delete' | null>(
    null
  )
  const selectedGroup = props.groups.find((group) => group.id === props.groupId)
  const editLabel = props.showConcurrencyLimit
    ? t('Edit Group')
    : t('Rename Group')
  const formSchema = z.object({
    name: z
      .string()
      .trim()
      .refine(
        (name) => name.length > 0 && [...name].length <= 64,
        t('Group name must contain 1 to 64 characters')
      ),
    concurrency_limit: z.preprocess(
      (value) => (value === '' || value === null ? Number.NaN : Number(value)),
      z
        .number({ message: t('Concurrency limit must be 0 or greater') })
        .int(t('Concurrency limit must be 0 or greater'))
        .min(0, t('Concurrency limit must be 0 or greater'))
    ),
  })
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', concurrency_limit: 0 },
  })

  const save = useMutation({
    mutationFn: props.onSave,
    onSuccess: (savedGroup) => {
      setAction(null)
      if (savedGroup) props.onSelectGroup(savedGroup.id)
    },
  })
  const deletion = useMutation({
    mutationFn: props.onDelete,
    onSuccess: () => {
      setAction(null)
      props.onSelectGroup(0)
    },
  })
  const download = useMutation({
    mutationFn: async (id: number) => {
      if (!props.onDownload) return new Blob()
      return props.onDownload(id)
    },
    onSuccess: (blob, id) => {
      if (!blob.size) {
        if (props.emptyDownloadMessage) {
          toast.info(props.emptyDownloadMessage)
        }
        return
      }
      const filename = props.downloadFilename
        ? props.downloadFilename(id)
        : `group-${id}.txt`
      triggerBlobDownload(blob, filename)
    },
  })

  return (
    <div className='flex min-w-0 items-center gap-2'>
      <ResourceGroupSelect
        groups={props.groups}
        value={props.groupId}
        onChange={props.onSelectGroup}
        ariaLabel={props.selectAriaLabel}
        allowAll
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant='outline'
              aria-label={props.manageLabel}
              title={props.manageLabel}
            />
          }
        >
          <FolderCog aria-hidden='true' />
          <span className='hidden sm:inline'>{props.manageLabel}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start'>
          <DropdownMenuItem
            onClick={() => {
              form.reset({ name: '', concurrency_limit: 0 })
              setAction('create')
            }}
          >
            {t('New Group')}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!props.groupsLoaded || !selectedGroup}
            onClick={() => {
              form.reset({
                name: selectedGroup?.name ?? '',
                concurrency_limit: selectedGroup?.concurrency_limit ?? 0,
              })
              setAction('rename')
            }}
          >
            {editLabel}
          </DropdownMenuItem>
          {props.onDownload && props.downloadLabel ? (
            <DropdownMenuItem
              disabled={!selectedGroup || download.isPending}
              onClick={() => {
                if (selectedGroup) download.mutate(selectedGroup.id)
              }}
            >
              {props.downloadLabel}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            disabled={!props.groupsLoaded || !selectedGroup}
            variant='destructive'
            onClick={() => setAction('delete')}
          >
            {t('Delete Group')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {props.showConcurrencyLimit &&
      selectedGroup &&
      (selectedGroup.concurrency_limit ?? 0) > 0 ? (
        <Badge variant='secondary' className='shrink-0'>
          {t('Concurrency Limit: {{limit}}', {
            limit: selectedGroup.concurrency_limit,
          })}
        </Badge>
      ) : null}
      <Dialog
        title={action === 'rename' ? editLabel : t('New Group')}
        open={action === 'create' || action === 'rename'}
        onOpenChange={(open) => {
          if (!open && !save.isPending) setAction(null)
        }}
        contentClassName='sm:max-w-md'
        footer={
          <Button type='submit' form={props.formId} disabled={save.isPending}>
            {t('Save')}
          </Button>
        }
      >
        <Form {...form}>
          <form
            id={props.formId}
            className='space-y-4'
            onSubmit={form.handleSubmit((values) => {
              if (!save.isPending && (action === 'create' || selectedGroup)) {
                save.mutate({
                  name: values.name,
                  ...(props.showConcurrencyLimit
                    ? { concurrency_limit: values.concurrency_limit }
                    : {}),
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
            {props.showConcurrencyLimit ? (
              <FormField
                control={form.control}
                name='concurrency_limit'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Concurrency Limit')}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={0}
                        step={1}
                        name={field.name}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        value={
                          field.value === undefined || field.value === null
                            ? ''
                            : String(field.value)
                        }
                        onChange={(event) => field.onChange(event.target.value)}
                        disabled={save.isPending}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Maximum concurrent requests per key in this group. Set to 0 for unlimited.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}
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
        desc={props.deleteDescription}
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
