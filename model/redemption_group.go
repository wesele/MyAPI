package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

type RedemptionGroup struct {
	Id   int    `json:"id"`
	Name string `json:"name" gorm:"size:64;not null"`
}

func ListRedemptionGroups() (groups []RedemptionGroup, err error) {
	err = DB.Order("name, id").Find(&groups).Error
	return groups, err
}

func CreateRedemptionGroup(name string) (RedemptionGroup, error) {
	group := RedemptionGroup{Name: name}
	err := DB.Create(&group).Error
	return group, err
}

func RenameRedemptionGroup(id int, name string) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var group RedemptionGroup
		if err := findRedemptionGroupForUpdate(tx, id, &group); err != nil {
			return err
		}
		return tx.Model(&group).Update("name", name).Error
	})
}

func DeleteRedemptionGroup(id int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var group RedemptionGroup
		if err := findRedemptionGroupForUpdate(tx, id, &group); err != nil {
			return err
		}
		if err := tx.Unscoped().Model(&Redemption{}).Where("group_id = ?", id).Update("group_id", 0).Error; err != nil {
			return err
		}
		return tx.Delete(&group).Error
	})
}

func CreateGroupedRedemptions(groupId int, codes []Redemption) error {
	for i := range codes {
		if err := codes[i].validateQuota(); err != nil {
			return err
		}
		codes[i].GroupId = groupId
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var group RedemptionGroup
		if err := findRedemptionGroupForUpdate(tx, groupId, &group); err != nil {
			return err
		}
		return tx.Create(&codes).Error
	})
}

func MoveRedemptionsToGroup(ids []int, groupId int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if groupId != 0 {
			var group RedemptionGroup
			if err := findRedemptionGroupForUpdate(tx, groupId, &group); err != nil {
				return err
			}
		}
		return tx.Model(&Redemption{}).Where("id IN ?", ids).Update("group_id", groupId).Error
	})
}

func ListUsableRedemptionGroupKeys(groupId int) (keys []string, err error) {
	err = DB.Model(&Redemption{}).Where(
		"group_id = ? AND status = ? AND (expired_time = 0 OR expired_time >= ?)",
		groupId, common.RedemptionCodeStatusEnabled, common.GetTimestamp(),
	).Order("id").Pluck("key", &keys).Error
	return keys, err
}

func DisableRedemptionsInGroup(groupId int) (int64, error) {
	result := DB.Model(&Redemption{}).
		Where("group_id = ? AND status = ?", groupId, common.RedemptionCodeStatusEnabled).
		Update("status", common.RedemptionCodeStatusDisabled)
	return result.RowsAffected, result.Error
}

func findRedemptionGroupForUpdate(tx *gorm.DB, id int, group *RedemptionGroup) error {
	err := lockForUpdate(tx).First(group, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return common.NewMessage("Redemption group not found")
	}
	return err
}
