package model

import (
	"context"
	"errors"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type WeChatRedemptionDelivery struct {
	EventID      string `gorm:"type:char(64);primaryKey"`
	RedemptionID *int   `gorm:"uniqueIndex"`
}

// IssueWeChatRedemption enables the oldest eligible code and associates it with
// the event in the same transaction. Retries return that event's original code.
func IssueWeChatRedemption(ctx context.Context, groupID int, eventID string) (string, error) {
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
		if err := lockForUpdate(tx).Select("id").First(&group, groupID).Error; err != nil {
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
		return tx.Model(&delivery).Update("redemption_id", code.Id).Error
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return code.Key, nil
}
