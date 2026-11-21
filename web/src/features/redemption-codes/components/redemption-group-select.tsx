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
import { useTranslation } from 'react-i18next'

import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

import type { RedemptionGroup } from '../types'

type RedemptionGroupSelectProps = {
  groups: RedemptionGroup[]
  value?: number
  onChange: (id: number | undefined) => void
  allowAll?: boolean
  allowUngrouped?: boolean
  disabled?: boolean
  id?: string
}

export function RedemptionGroupSelect(props: RedemptionGroupSelectProps) {
  const { t } = useTranslation()
  const missing =
    props.value && !props.groups.some((group) => group.id === props.value)

  return (
    <NativeSelect
      id={props.id}
      aria-label={t('Group')}
      className='max-w-full'
      disabled={props.disabled}
      value={props.value ?? ''}
      onChange={(event) =>
        props.onChange(
          event.target.value === '' ? undefined : Number(event.target.value)
        )
      }
    >
      {props.allowAll && (
        <NativeSelectOption value=''>{t('All Groups')}</NativeSelectOption>
      )}
      {!props.allowAll && props.value === undefined && (
        <NativeSelectOption value='' disabled>
          {t('Select a group')}
        </NativeSelectOption>
      )}
      {props.allowUngrouped !== false && (
        <NativeSelectOption value={0}>{t('Ungrouped')}</NativeSelectOption>
      )}
      {missing ? (
        <NativeSelectOption value={props.value} disabled>
          {t('Select a group')}
        </NativeSelectOption>
      ) : null}
      {props.groups.map((group) => (
        <NativeSelectOption key={group.id} value={group.id}>
          {group.name}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  )
}
