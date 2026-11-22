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
import type { ColumnDef } from '@tanstack/react-table'
import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { TimestampCell } from '@/components/activity-time-cell'
import { CopyButton } from '@/components/copy-button'
import { MaskedValueDisplay } from '@/components/masked-value-display'
import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { REDEMPTION_STATUSES } from '@/features/redemption-codes/constants'
import { toIntlLocale } from '@/i18n/languages'

import type { WeChatClaim } from '../types'

function maskRedemptionCode(key: string): string {
  if (key.length <= 8) return key
  const hiddenCount = Math.min(12, Math.max(4, key.length - 8))
  return `${key.slice(0, 4)}${'*'.repeat(hiddenCount)}${key.slice(-4)}`
}

export function useWeChatClaimsColumns(
  onDelete: (claim: WeChatClaim) => void
): ColumnDef<WeChatClaim>[] {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  return [
    {
      accessorKey: 'id',
      header: t('ID'),
      meta: { mobileHidden: true },
      cell: ({ row }) => (
        <TableId value={row.original.id} className='w-[60px]' />
      ),
      size: 80,
    },
    {
      accessorKey: 'open_id',
      header: 'OpenID',
      meta: { mobileTitle: true },
      cell: ({ row }) => {
        const openId = row.original.open_id
        return (
          <div className='flex max-w-[220px] min-w-0 items-center gap-1'>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className='truncate font-mono text-xs' tabIndex={0}>
                    {openId}
                  </span>
                }
              />
              <TooltipContent>
                <span className='font-mono text-xs'>{openId}</span>
              </TooltipContent>
            </Tooltip>
            <CopyButton
              value={openId}
              className='size-7 shrink-0'
              iconClassName='size-3.5'
              tooltip={t('Copy OpenID')}
              aria-label={t('Copy OpenID')}
            />
          </div>
        )
      },
      size: 240,
    },
    {
      accessorKey: 'redemption_key',
      header: t('Redemption Code'),
      cell: ({ row }) => {
        const code = row.original.redemption_key
        return (
          <MaskedValueDisplay
            label={t('Full Code')}
            fullValue={code}
            maskedValue={maskRedemptionCode(code)}
            copyTooltip={t('Copy code')}
            copyAriaLabel={t('Copy redemption code')}
          />
        )
      },
      size: 230,
    },
    {
      accessorKey: 'group_name',
      header: t('Group'),
      cell: ({ row }) => {
        const name =
          row.original.group_name ||
          (row.original.group_id ? `#${row.original.group_id}` : '-')
        return (
          <span className='block max-w-40 truncate' title={name}>
            {name}
          </span>
        )
      },
      size: 140,
    },
    {
      accessorKey: 'redemption_status',
      header: t('Code status'),
      meta: { mobileBadge: true },
      cell: ({ row }) => {
        const claim = row.original
        const statusConfig = REDEMPTION_STATUSES[claim.redemption_status]
        if (!statusConfig) {
          return (
            <StatusBadge
              label={t('Deleted')}
              variant='neutral'
              copyable={false}
              className='-ml-1.5'
            />
          )
        }
        const badge = (
          <StatusBadge
            label={t(statusConfig.labelKey)}
            variant={statusConfig.variant}
            copyable={false}
            className='-ml-1.5'
          />
        )
        if (claim.used_user_id > 0) {
          return (
            <Tooltip>
              <TooltipTrigger render={<span className='inline-flex' />}>
                {badge}
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  {t('User ID:')} {claim.used_user_id}
                </span>
              </TooltipContent>
            </Tooltip>
          )
        }
        return badge
      },
      size: 120,
    },
    {
      accessorKey: 'claimed_at',
      header: t('Claimed at'),
      cell: ({ row }) => (
        <TimestampCell
          timestamp={row.original.claimed_at}
          locale={locale}
          justNowLabel={t('Just now')}
          className='text-muted-foreground text-xs'
        />
      ),
      size: 160,
    },
    {
      id: 'actions',
      header: t('Actions'),
      cell: ({ row }) => (
        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          className='text-destructive hover:text-destructive'
          onClick={() => onDelete(row.original)}
          aria-label={t('Delete claim record')}
          title={t('Delete claim record')}
        >
          <Trash2 className='size-4' aria-hidden='true' />
        </Button>
      ),
      enableSorting: false,
      enableHiding: false,
      size: 80,
    },
  ]
}
