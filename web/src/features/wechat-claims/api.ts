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
import type { ApiResponse } from '@/features/redemption-codes/types'
import { api } from '@/lib/api'

import type { WeChatClaimsPage } from './types'

export type GetWeChatClaimsParams = {
  p: number
  page_size: number
  keyword?: string
  group_id?: number
}

export const wechatClaimsQueryKey = ['wechat-claims'] as const

export async function getWeChatClaims(params: GetWeChatClaimsParams) {
  const response = await api.get<ApiResponse<WeChatClaimsPage>>(
    '/api/wechat-official-account/claims',
    {
      params: {
        p: params.p,
        page_size: params.page_size,
        keyword: params.keyword?.trim() || undefined,
        group_id: params.group_id,
      },
    }
  )
  return response.data
}

export async function deleteWeChatClaim(id: number) {
  const response = await api.delete<ApiResponse<null>>(
    `/api/wechat-official-account/claims/${id}`
  )
  return response.data
}
