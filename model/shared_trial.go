package model

import (
	"errors"
	"math"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"gorm.io/gorm"
)

const (
	SharedTrialTokenName               = "free-trial"
	SharedTrialTokenGroupName          = "Direct"
	SharedTrialDefaultConcurrencyLimit = 1
	SharedTrialDailyLimit              = 100
	SharedTrialAmountCNY               = 1.0
	SharedTrialRefillIntervalSeconds   = int64(7 * 24 * 60 * 60)
	defaultTrialQuotaPerUnit           = 500000.0
	defaultTrialExchangeRate           = 7.3
)

var (
	ErrSharedTrialDailyLimitReached = errors.New("shared trial daily limit reached")
	ErrSharedTrialAdminUnavailable  = errors.New("admin user not available")
	ErrSharedTrialRefillNotEligible = errors.New("token is not eligible for free trial refill")
	ErrSharedTrialRefillCooldown    = errors.New("free trial refill is limited to once per week")
	ErrSharedTrialRefillAlreadyFull = errors.New("free trial quota is already full")
)

type SharedTrialRefillStatus struct {
	Eligible     bool  `json:"eligible"`
	CanRefill    bool  `json:"can_refill"`
	AlreadyFull  bool  `json:"already_full"`
	NextRefillAt int64 `json:"next_refill_at"`
	TargetQuota  int   `json:"target_quota"`
}

// SharedTrialQuota returns the quota units corresponding to 1 RMB based on the
// configured QuotaPerUnit and USDExchangeRate.
func SharedTrialQuota() int {
	quotaPerUnit := common.QuotaPerUnit
	if quotaPerUnit <= 0 || math.IsNaN(quotaPerUnit) || math.IsInf(quotaPerUnit, 0) {
		quotaPerUnit = defaultTrialQuotaPerUnit
	}
	exchangeRate := operation_setting.USDExchangeRate
	if exchangeRate <= 0 || math.IsNaN(exchangeRate) || math.IsInf(exchangeRate, 0) {
		exchangeRate = defaultTrialExchangeRate
	}
	quota := common.QuotaRound(quotaPerUnit * SharedTrialAmountCNY / exchangeRate)
	return max(quota, 1)
}

// ClaimSharedTrialToken issues a 1-RMB, 1-month trial API token under the
// 'admin' user's 'Direct' API key group, subject to SharedTrialDailyLimit unless
// bypassDailyLimit is true.
func ClaimSharedTrialToken(bypassDailyLimit bool) (*Token, error) {
	tokenKey, err := common.GenerateKey()
	if err != nil {
		return nil, err
	}

	var createdToken *Token
	var tokenGroupId int
	trialQuota := SharedTrialQuota()

	err = DB.Transaction(func(tx *gorm.DB) error {
		var admin User
		if err := tx.Where("username = ? AND status = ?", "admin", common.UserStatusEnabled).First(&admin).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrSharedTrialAdminUnavailable
			}
			return err
		}

		if err := lockForUpdate(tx).Select("id").First(&admin, "id = ?", admin.Id).Error; err != nil {
			return err
		}

		nowTime := time.Now()
		now := nowTime.Unix()
		if !bypassDailyLimit {
			y, m, d := nowTime.Date()
			dayStart := time.Date(y, m, d, 0, 0, 0, 0, nowTime.Location()).Unix()

			var dailyCount int64
			if err := tx.Unscoped().Model(&Token{}).
				Where("user_id = ? AND name = ? AND created_time >= ?", admin.Id, SharedTrialTokenName, dayStart).
				Count(&dailyCount).Error; err != nil {
				return err
			}
			if dailyCount >= SharedTrialDailyLimit {
				return ErrSharedTrialDailyLimitReached
			}
		}

		var tokenGroup TokenGroup
		err := tx.Where("user_id = ? AND name = ?", admin.Id, SharedTrialTokenGroupName).Order("id").First(&tokenGroup).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			tokenGroup = TokenGroup{
				UserId:           admin.Id,
				Name:             SharedTrialTokenGroupName,
				ConcurrencyLimit: SharedTrialDefaultConcurrencyLimit,
			}
			if err := tx.Create(&tokenGroup).Error; err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
		tokenGroupId = tokenGroup.Id

		expiredTime := nowTime.AddDate(0, 1, 0).Unix()
		createdToken = &Token{
			UserId:              admin.Id,
			Name:                SharedTrialTokenName,
			Key:                 tokenKey,
			Status:              common.TokenStatusEnabled,
			CreatedTime:         now,
			AccessedTime:        now,
			ExpiredTime:         expiredTime,
			RemainQuota:         trialQuota,
			UnlimitedQuota:      false,
			GroupId:             tokenGroupId,
			AllowUserQuotaQuery: false,
			TrialRefilledAt:     now,
		}
		return tx.Create(createdToken).Error
	})
	if err != nil {
		return nil, err
	}

	common.SysLog(common.LogText("issued shared trial token ID %d (quota=%s, group_id=%d)", createdToken.Id, logger.FormatQuota(trialQuota), tokenGroupId))
	return createdToken, nil
}

func peekPendingTokenQuotaDelta(tokenId int) int {
	if !common.BatchUpdateEnabled {
		return 0
	}
	batchUpdateLocks[BatchUpdateTypeTokenQuota].Lock()
	defer batchUpdateLocks[BatchUpdateTypeTokenQuota].Unlock()
	return batchUpdateStores[BatchUpdateTypeTokenQuota][tokenId]
}

func consumePendingTokenQuotaDelta(tokenId int) int {
	if !common.BatchUpdateEnabled {
		return 0
	}
	batchUpdateLocks[BatchUpdateTypeTokenQuota].Lock()
	defer batchUpdateLocks[BatchUpdateTypeTokenQuota].Unlock()
	delta := batchUpdateStores[BatchUpdateTypeTokenQuota][tokenId]
	delete(batchUpdateStores[BatchUpdateTypeTokenQuota], tokenId)
	return delta
}

func isDirectTrialToken(tx *gorm.DB, token *Token) (bool, error) {
	if token == nil || token.Name != SharedTrialTokenName || token.UnlimitedQuota || token.Status == common.TokenStatusDisabled || token.GroupId <= 0 {
		return false, nil
	}
	var group TokenGroup
	err := tx.Where("id = ? AND user_id = ? AND name = ?", token.GroupId, token.UserId, SharedTrialTokenGroupName).First(&group).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func effectiveTrialRefillAnchor(token *Token) int64 {
	if token.TrialRefilledAt > 0 {
		return token.TrialRefilledAt
	}
	return token.CreatedTime
}

// GetSharedTrialRefillStatus reports whether liveToken is a Direct-group
// free-trial key and whether it can currently be refilled to 1 RMB.
func GetSharedTrialRefillStatus(liveToken *Token) (*SharedTrialRefillStatus, error) {
	if liveToken == nil {
		return &SharedTrialRefillStatus{}, nil
	}
	dbToken, err := GetTokenById(liveToken.Id)
	if err != nil {
		return nil, err
	}
	eligible, err := isDirectTrialToken(DB, dbToken)
	if err != nil {
		return nil, err
	}
	if !eligible {
		return &SharedTrialRefillStatus{Eligible: false}, nil
	}

	targetQuota := SharedTrialQuota()
	effectiveRemain := liveToken.RemainQuota
	if !common.RedisEnabled {
		effectiveRemain = dbToken.RemainQuota + peekPendingTokenQuotaDelta(dbToken.Id)
	}
	alreadyFull := effectiveRemain >= targetQuota

	now := time.Now().Unix()
	var nextRefillAt int64
	anchor := effectiveTrialRefillAnchor(dbToken)
	inCooldown := anchor > 0 && now < anchor+SharedTrialRefillIntervalSeconds
	if inCooldown {
		nextRefillAt = anchor + SharedTrialRefillIntervalSeconds
	}

	return &SharedTrialRefillStatus{
		Eligible:     true,
		CanRefill:    !alreadyFull && !inCooldown,
		AlreadyFull:  alreadyFull,
		NextRefillAt: nextRefillAt,
		TargetQuota:  targetQuota,
	}, nil
}

// RefillSharedTrialToken resets a Direct-group free-trial token's remaining
// quota back to 1 RMB at most once per week and extends near-term expiry to 1 month.
func RefillSharedTrialToken(tokenKey string) (*Token, int64, error) {
	liveToken, err := GetTokenByKey(tokenKey, false)
	if err != nil {
		return nil, 0, err
	}

	if cacheErr := invalidateTokenCacheForMutation(tokenKey); cacheErr != nil {
		common.SysLog(common.LogText("failed to invalidate token cache before trial refill: %s", cacheErr.Error()))
	}

	targetQuota := SharedTrialQuota()
	var updatedToken Token
	var nextRefillAt int64

	err = DB.Transaction(func(tx *gorm.DB) error {
		var dbToken Token
		if err := lockForUpdate(tx).First(&dbToken, "id = ?", liveToken.Id).Error; err != nil {
			return err
		}
		eligible, err := isDirectTrialToken(tx, &dbToken)
		if err != nil {
			return err
		}
		if !eligible {
			return ErrSharedTrialRefillNotEligible
		}

		nowTime := time.Now()
		now := nowTime.Unix()
		anchor := effectiveTrialRefillAnchor(&dbToken)
		if anchor > 0 && now < anchor+SharedTrialRefillIntervalSeconds {
			nextRefillAt = anchor + SharedTrialRefillIntervalSeconds
			return ErrSharedTrialRefillCooldown
		}

		pendingDelta := peekPendingTokenQuotaDelta(dbToken.Id)
		effectiveRemain := min(liveToken.RemainQuota, dbToken.RemainQuota+pendingDelta)
		if effectiveRemain >= targetQuota {
			return ErrSharedTrialRefillAlreadyFull
		}

		pendingDelta = consumePendingTokenQuotaDelta(dbToken.Id)
		newUsedQuota := max(0, dbToken.UsedQuota-pendingDelta)
		updates := map[string]any{
			"remain_quota":      targetQuota,
			"used_quota":        newUsedQuota,
			"status":            common.TokenStatusEnabled,
			"trial_refilled_at": now,
			"accessed_time":     now,
		}
		oneMonthLater := nowTime.AddDate(0, 1, 0).Unix()
		if dbToken.ExpiredTime != -1 && dbToken.ExpiredTime < oneMonthLater {
			updates["expired_time"] = oneMonthLater
		}
		if err := tx.Model(&Token{}).Where("id = ?", dbToken.Id).Updates(updates).Error; err != nil {
			return err
		}
		if err := tx.First(&updatedToken, "id = ?", dbToken.Id).Error; err != nil {
			return err
		}
		nextRefillAt = now + SharedTrialRefillIntervalSeconds
		return nil
	})
	if err != nil {
		return nil, nextRefillAt, err
	}

	if cacheErr := invalidateTokenCacheForMutation(tokenKey); cacheErr != nil {
		common.SysLog(common.LogText("failed to invalidate token cache after trial refill: %s", cacheErr.Error()))
	}
	common.SysLog(common.LogText("refilled shared trial token ID %d (quota=%s)", updatedToken.Id, logger.FormatQuota(targetQuota)))
	return &updatedToken, nextRefillAt, nil
}
