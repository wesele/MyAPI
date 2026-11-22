package model

import (
	"context"
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type WeChatRedemptionDelivery struct {
	EventID      string `gorm:"type:char(64);primaryKey"`
	RedemptionID *int   `gorm:"uniqueIndex"`
}

// WeChatRedemptionClaim records each subscriber's issued redemption code for
// admin lookup and management, separate from delivery deduplication state.
type WeChatRedemptionClaim struct {
	Id            int    `json:"id"`
	EventID       string `json:"event_id" gorm:"type:char(64);uniqueIndex"`
	OpenID        string `json:"open_id" gorm:"size:128;not null;index"`
	OriginalID    string `json:"original_id" gorm:"size:64;not null;index"`
	GroupID       int    `json:"group_id" gorm:"not null;index"`
	GroupName     string `json:"group_name" gorm:"size:64;not null"`
	RedemptionID  int    `json:"redemption_id" gorm:"not null;index"`
	RedemptionKey string `json:"redemption_key" gorm:"size:64;not null;index"`
	ClaimedAt     int64  `json:"claimed_at" gorm:"bigint;not null;index"`
}

type WeChatRedemptionClaimDetail struct {
	WeChatRedemptionClaim
	RedemptionName   string `json:"redemption_name"`
	RedemptionStatus int    `json:"redemption_status"`
	UsedUserID       int    `json:"used_user_id"`
	RedeemedTime     int64  `json:"redeemed_time"`
}

// IssueWeChatRedemption enables the oldest eligible code and associates it with
// the event in the same transaction. Retries return that event's original code.
func IssueWeChatRedemption(ctx context.Context, groupID int, eventID, openID, originalID string) (string, error) {
	var code Redemption
	err := DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		delivery := WeChatRedemptionDelivery{EventID: eventID}
		// Start with a write so SQLite acquires its writer lock before any read.
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&delivery).Error; err != nil {
			return err
		}
		if err := lockForUpdate(tx).First(&delivery, "event_id = ?", eventID).Error; err != nil {
			return err
		}
		if delivery.RedemptionID != nil {
			return tx.Select("id", "key").First(&code, *delivery.RedemptionID).Error
		}

		var group RedemptionGroup
		if err := lockForUpdate(tx).Select("id", "name").First(&group, groupID).Error; err != nil {
			return err
		}
		now := common.GetTimestamp()
		eligible := "group_id = ? AND status = ? AND (expired_time = 0 OR expired_time >= ?)"
		issued := tx.Model(&WeChatRedemptionDelivery{}).Select("redemption_id").Where("redemption_id IS NOT NULL")
		if err := lockForUpdate(tx).Select("id", "key").
			Where(eligible, groupID, common.RedemptionCodeStatusDisabled, now).
			Where("id NOT IN (?)", issued).Order("id ASC").Take(&code).Error; err != nil {
			return err
		}
		result := tx.Model(&Redemption{}).Where("id = ?", code.Id).
			Where(eligible, groupID, common.RedemptionCodeStatusDisabled, now).
			Update("status", common.RedemptionCodeStatusEnabled)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("redemption code became unavailable during WeChat delivery")
		}
		if err := tx.Model(&delivery).Update("redemption_id", code.Id).Error; err != nil {
			return err
		}
		claim := WeChatRedemptionClaim{
			EventID:       eventID,
			OpenID:        openID,
			OriginalID:    originalID,
			GroupID:       groupID,
			GroupName:     group.Name,
			RedemptionID:  code.Id,
			RedemptionKey: code.Key,
			ClaimedAt:     now,
		}
		return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&claim).Error
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return code.Key, nil
}

func ListWeChatRedemptionClaims(ctx context.Context, keyword string, groupID *int, startIdx, num int) ([]WeChatRedemptionClaimDetail, int64, error) {
	query := DB.WithContext(ctx).Model(&WeChatRedemptionClaim{})
	if groupID != nil {
		query = query.Where("group_id = ?", *groupID)
	}
	if keyword != "" {
		escaped := strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(strings.ToLower(keyword))
		pattern := "%" + escaped + "%"
		query = query.Where(
			"LOWER(open_id) LIKE ? ESCAPE '!' OR LOWER(redemption_key) LIKE ? ESCAPE '!' OR LOWER(group_name) LIKE ? ESCAPE '!'",
			pattern, pattern, pattern,
		)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var claims []WeChatRedemptionClaim
	if err := query.Order("claimed_at DESC, id DESC").Limit(num).Offset(startIdx).Find(&claims).Error; err != nil {
		return nil, 0, err
	}

	details := make([]WeChatRedemptionClaimDetail, len(claims))
	if len(claims) == 0 {
		return details, total, nil
	}

	redemptionIDs := make([]int, 0, len(claims))
	groupIDs := make([]int, 0, len(claims))
	seenRedemptions := make(map[int]struct{}, len(claims))
	seenGroups := make(map[int]struct{}, len(claims))
	for _, claim := range claims {
		if _, ok := seenRedemptions[claim.RedemptionID]; !ok {
			seenRedemptions[claim.RedemptionID] = struct{}{}
			redemptionIDs = append(redemptionIDs, claim.RedemptionID)
		}
		if claim.GroupID > 0 {
			if _, ok := seenGroups[claim.GroupID]; !ok {
				seenGroups[claim.GroupID] = struct{}{}
				groupIDs = append(groupIDs, claim.GroupID)
			}
		}
	}

	redemptionByID := make(map[int]Redemption, len(redemptionIDs))
	if len(redemptionIDs) > 0 {
		var redemptions []Redemption
		if err := DB.WithContext(ctx).
			Select("id", "name", "status", "used_user_id", "redeemed_time").
			Where("id IN ?", redemptionIDs).
			Find(&redemptions).Error; err != nil {
			return nil, 0, err
		}
		for _, r := range redemptions {
			redemptionByID[r.Id] = r
		}
	}

	groupNameByID := make(map[int]string, len(groupIDs))
	if len(groupIDs) > 0 {
		var groups []RedemptionGroup
		if err := DB.WithContext(ctx).Select("id", "name").Where("id IN ?", groupIDs).Find(&groups).Error; err != nil {
			return nil, 0, err
		}
		for _, g := range groups {
			groupNameByID[g.Id] = g.Name
		}
	}

	for i, claim := range claims {
		if name, ok := groupNameByID[claim.GroupID]; ok {
			claim.GroupName = name
		}
		detail := WeChatRedemptionClaimDetail{WeChatRedemptionClaim: claim}
		if r, ok := redemptionByID[claim.RedemptionID]; ok {
			detail.RedemptionName = r.Name
			detail.RedemptionStatus = r.Status
			detail.UsedUserID = r.UsedUserId
			detail.RedeemedTime = r.RedeemedTime
		}
		details[i] = detail
	}
	return details, total, nil
}

func DeleteWeChatRedemptionClaim(ctx context.Context, id int) error {
	result := DB.WithContext(ctx).Where("id = ?", id).Delete(&WeChatRedemptionClaim{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
