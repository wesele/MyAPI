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
import { api } from '@/lib/api'

import type {
  Redemption,
  ApiResponse,
  GetRedemptionsParams,
  GetRedemptionsResponse,
  SearchRedemptionsParams,
  RedemptionFormData,
  RedemptionGroup,
} from './types'

// ============================================================================
// Redemption Code Management
// ============================================================================

// Get paginated redemption codes list
export async function getRedemptions(
  params: GetRedemptionsParams = {}
): Promise<GetRedemptionsResponse> {
  const { p = 1, page_size = 10, group_id } = params
  const res = await api.get('/api/redemption/', {
    params: { p, page_size, group_id },
  })
  return res.data
}

// Search redemption codes by keyword
export async function searchRedemptions(
  params: SearchRedemptionsParams
): Promise<GetRedemptionsResponse> {
  const { keyword = '', status = '', p = 1, page_size = 10, group_id } = params
  const queryParams = new URLSearchParams()
  queryParams.set('keyword', keyword)
  if (status) queryParams.set('status', status)
  if (group_id !== undefined) queryParams.set('group_id', String(group_id))
  queryParams.set('p', String(p))
  queryParams.set('page_size', String(page_size))
  const res = await api.get(`/api/redemption/search?${queryParams.toString()}`)
  return res.data
}

// Get single redemption code by ID
export async function getRedemption(
  id: number
): Promise<ApiResponse<Redemption>> {
  const res = await api.get(`/api/redemption/${id}`)
  return res.data
}

// Create redemption code(s)
export async function createRedemption(
  data: RedemptionFormData
): Promise<ApiResponse<string[]>> {
  const res = await api.post('/api/redemption/', data)
  return res.data
}

// Update redemption code
export async function updateRedemption(
  data: RedemptionFormData & { id: number }
): Promise<ApiResponse<Redemption>> {
  const res = await api.put('/api/redemption/', data)
  return res.data
}

// Update redemption code status (enable/disable)
export async function updateRedemptionStatus(
  id: number,
  status: number
): Promise<ApiResponse<Redemption>> {
  const res = await api.put('/api/redemption/?status_only=true', { id, status })
  return res.data
}

// Delete a single redemption code
export async function deleteRedemption(id: number): Promise<ApiResponse> {
  const res = await api.delete(`/api/redemption/${id}/`)
  return res.data
}

// Delete invalid redemption codes (used, disabled, expired)
export async function deleteInvalidRedemptions(): Promise<ApiResponse<number>> {
  const res = await api.delete('/api/redemption/invalid')
  return res.data
}

export async function disableRedemptionGroupCodes(
  groupId: number
): Promise<ApiResponse<number>> {
  const res = await api.post(`/api/redemption/groups/${groupId}/disable`)
  return res.data
}

export async function batchDeleteRedemptions(
  ids: number[]
): Promise<ApiResponse<number>> {
  const res = await api.post('/api/redemption/batch', { ids })
  return res.data
}

export const redemptionGroupsQueryKey = ['redemption-groups'] as const

export async function getRedemptionGroups(): Promise<
  ApiResponse<RedemptionGroup[]>
> {
  const res = await api.get('/api/redemption/groups')
  return res.data
}

export async function saveRedemptionGroup(
  name: string,
  id?: number
): Promise<ApiResponse<RedemptionGroup>> {
  const res =
    id === undefined
      ? await api.post('/api/redemption/groups', { name })
      : await api.put(`/api/redemption/groups/${id}`, { name })
  return res.data
}

export async function deleteRedemptionGroup(id: number): Promise<ApiResponse> {
  const res = await api.delete(`/api/redemption/groups/${id}`)
  return res.data
}

export async function downloadRedemptionGroupCodes(id: number): Promise<Blob> {
  const response = await api.get<Blob>(
    `/api/redemption/groups/${id}/download`,
    { responseType: 'blob' }
  )
  return response.data
}

export async function moveRedemptionsToGroup(
  ids: number[],
  group_id: number
): Promise<ApiResponse> {
  const res = await api.put('/api/redemption/groups/members', { ids, group_id })
  return res.data
}
