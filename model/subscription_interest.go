package model

import (
	"slices"

	"gorm.io/gorm/clause"
)

var subscriptionInterestAmounts = []int{10, 20, 50}

func IsSubscriptionInterestAmount(amount int) bool {
	return slices.Contains(subscriptionInterestAmounts, amount)
}

type SubscriptionInterest struct {
	VoterHash string `gorm:"primaryKey;size:64"`
	Amount    int    `gorm:"not null"`
}

type SubscriptionInterestCount struct {
	Amount int   `json:"amount"`
	Count  int64 `json:"count"`
}

func GetSubscriptionInterest(voterHash string) (SubscriptionInterest, error) {
	var vote SubscriptionInterest
	err := DB.Where("voter_hash = ?", voterHash).Take(&vote).Error
	return vote, err
}

func SaveSubscriptionInterest(vote SubscriptionInterest) error {
	return DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "voter_hash"}},
		DoUpdates: clause.AssignmentColumns([]string{"amount"}),
	}).Create(&vote).Error
}

func CountSubscriptionInterest() ([]SubscriptionInterestCount, error) {
	var counts []SubscriptionInterestCount
	err := DB.Model(&SubscriptionInterest{}).
		Where("amount IN ?", subscriptionInterestAmounts).
		Select("amount, COUNT(*) AS count").
		Group("amount").Order("amount").Scan(&counts).Error
	return counts, err
}
