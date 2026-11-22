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
export type WeChatClaim = {
  id: number
  event_id: string
  open_id: string
  original_id: string
  group_id: number
  group_name: string
  redemption_id: number
  redemption_key: string
  claimed_at: number
  redemption_name: string
  redemption_status: number
  used_user_id: number
  redeemed_time: number
}

export type WeChatClaimsPage = {
  page: number
  page_size: number
  total: number
  items: WeChatClaim[]
}
