package model

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

type TokenGroup struct {
	Id               int    `json:"id"`
	UserId           int    `json:"user_id" gorm:"not null;index"`
	Name             string `json:"name" gorm:"size:64;not null"`
	ConcurrencyLimit int    `json:"concurrency_limit" gorm:"not null;default:0"`
}

type tokenGroupConcurrencyCacheEntry struct {
	ConcurrencyLimit int
	CacheExpiresAt   int64
	CacheMAC         string
}

func getTokenGroupConcurrencyCacheKey(groupId int) string {
	return fmt.Sprintf("token_group:concurrency:%d", groupId)
}

func getTokenGroupConcurrencyCacheFenceKey(groupId int) string {
	return fmt.Sprintf("token_group:concurrency:fence:{%s}", getTokenGroupConcurrencyCacheKey(groupId))
}

func redisReady() bool {
	return common.RedisEnabled && common.RDB != nil
}

func invalidateTokenGroupConcurrencyCacheForMutation(groupId int) error {
	if !redisReady() || groupId <= 0 {
		return nil
	}
	ctx := context.Background()
	if err := common.RDB.Set(ctx, getTokenGroupConcurrencyCacheFenceKey(groupId), 1, time.Duration(tokenCacheFenceSeconds)*time.Second).Err(); err != nil {
		return err
	}
	return common.RDB.Del(ctx, getTokenGroupConcurrencyCacheKey(groupId)).Err()
}

func tokenGroupConcurrencyCacheMAC(cacheKey string, limit int, expiresAt int64) (string, error) {
	return authCacheMAC(cacheKey, struct {
		ConcurrencyLimit int
		CacheExpiresAt   int64
	}{
		ConcurrencyLimit: limit,
		CacheExpiresAt:   expiresAt,
	})
}

func cacheGetTokenGroupConcurrencyLimit(groupId int) (int, error) {
	cacheKey := getTokenGroupConcurrencyCacheKey(groupId)
	var entry tokenGroupConcurrencyCacheEntry
	if err := common.RedisHGetObj(cacheKey, &entry); err != nil {
		return 0, err
	}
	expectedMAC, err := tokenGroupConcurrencyCacheMAC(cacheKey, entry.ConcurrencyLimit, entry.CacheExpiresAt)
	if err != nil || !validAuthCacheMAC(expectedMAC, entry.CacheMAC, entry.CacheExpiresAt) {
		return 0, fmt.Errorf("token group concurrency cache integrity check failed")
	}
	return max(entry.ConcurrencyLimit, 0), nil
}

func cacheInitTokenGroupConcurrencyLimit(groupId int, limit int) error {
	if !redisReady() || groupId <= 0 {
		return nil
	}
	cacheKey := getTokenGroupConcurrencyCacheKey(groupId)
	expiresAt := time.Now().Add(time.Duration(tokenCacheTTLSeconds()) * time.Second).UnixMilli()
	mac, err := tokenGroupConcurrencyCacheMAC(cacheKey, limit, expiresAt)
	if err != nil {
		return err
	}
	const script = `
if redis.call('EXISTS', KEYS[2]) == 1 then
  return 0
end
redis.call('HSET', KEYS[1], 'ConcurrencyLimit', ARGV[1], 'CacheExpiresAt', ARGV[2], 'CacheMAC', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 1`
	return common.RDB.Eval(
		context.Background(),
		script,
		[]string{cacheKey, getTokenGroupConcurrencyCacheFenceKey(groupId)},
		limit,
		expiresAt,
		mac,
		tokenCacheTTLSeconds(),
	).Err()
}

func GetTokenGroupConcurrencyLimit(groupId int) (int, error) {
	if groupId <= 0 {
		return 0, nil
	}
	if redisReady() {
		if limit, err := cacheGetTokenGroupConcurrencyLimit(groupId); err == nil {
			return limit, nil
		}
	}
	if DB == nil {
		return 0, ErrDatabase
	}
	var group TokenGroup
	if err := DB.Select("concurrency_limit").First(&group, "id = ?", groupId).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, nil
		}
		return 0, err
	}
	limit := max(group.ConcurrencyLimit, 0)
	if redisReady() {
		if err := cacheInitTokenGroupConcurrencyLimit(groupId, limit); err != nil {
			common.SysLog(common.LogText("failed to init token group concurrency cache: %s", err.Error()))
		}
	}
	return limit, nil
}

func ListTokenGroups(userId int) (groups []TokenGroup, err error) {
	err = DB.Where("user_id = ?", userId).Order("name, id").Find(&groups).Error
	return groups, err
}

func CreateTokenGroup(userId int, name string, concurrencyLimit int) (TokenGroup, error) {
	if concurrencyLimit < 0 {
		return TokenGroup{}, common.NewMessage("Concurrency limit must be 0 or greater")
	}
	group := TokenGroup{UserId: userId, Name: name, ConcurrencyLimit: concurrencyLimit}
	err := DB.Create(&group).Error
	return group, err
}

func UpdateTokenGroup(userId int, id int, name string, concurrencyLimit *int) (TokenGroup, error) {
	if concurrencyLimit != nil && *concurrencyLimit < 0 {
		return TokenGroup{}, common.NewMessage("Concurrency limit must be 0 or greater")
	}
	var group TokenGroup
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := findTokenGroupForUpdate(tx, userId, id, &group); err != nil {
			return err
		}
		updates := map[string]any{
			"name": name,
		}
		group.Name = name
		if concurrencyLimit != nil {
			if err := invalidateTokenGroupConcurrencyCacheForMutation(id); err != nil {
				common.SysLog(common.LogText("failed to invalidate token group concurrency cache before update: %s", err.Error()))
			}
			updates["concurrency_limit"] = *concurrencyLimit
			group.ConcurrencyLimit = *concurrencyLimit
		}
		return tx.Model(&group).Updates(updates).Error
	})
	return group, err
}

func DeleteTokenGroup(userId int, id int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var group TokenGroup
		if err := findTokenGroupForUpdate(tx, userId, id, &group); err != nil {
			return err
		}
		var tokens []Token
		if err := tx.Unscoped().Select("id", tokenKeyColumn()).
			Where("user_id = ? AND group_id = ?", userId, id).
			Find(&tokens).Error; err != nil {
			return err
		}
		if len(tokens) > 0 {
			if err := invalidateTokensCache(tokens); err != nil {
				common.SysLog(common.LogText("failed to invalidate token cache before group delete: %s", err.Error()))
			}
		}
		if err := invalidateTokenGroupConcurrencyCacheForMutation(id); err != nil {
			common.SysLog(common.LogText("failed to invalidate token group concurrency cache before delete: %s", err.Error()))
		}
		if err := tx.Unscoped().Model(&Token{}).Where("user_id = ? AND group_id = ?", userId, id).Update("group_id", 0).Error; err != nil {
			return err
		}
		return tx.Delete(&group).Error
	})
}

func CreateGroupedToken(userId int, groupId int, token *Token) error {
	token.UserId = userId
	token.GroupId = groupId
	return DB.Transaction(func(tx *gorm.DB) error {
		var group TokenGroup
		if err := findTokenGroupForUpdate(tx, userId, groupId, &group); err != nil {
			return err
		}
		return tx.Create(token).Error
	})
}

func UpdateGroupedToken(userId int, groupId int, token *Token) error {
	if cacheErr := invalidateTokenCacheForMutation(token.Key); cacheErr != nil {
		common.SysLog(common.LogText("failed to invalidate token cache before update: %s", cacheErr.Error()))
	}
	token.GroupId = groupId
	return DB.Transaction(func(tx *gorm.DB) error {
		var group TokenGroup
		if err := findTokenGroupForUpdate(tx, userId, groupId, &group); err != nil {
			return err
		}
		return token.updateWithDB(tx)
	})
}

func MoveTokensToGroup(userId int, ids []int, groupId int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if groupId != 0 {
			var group TokenGroup
			if err := findTokenGroupForUpdate(tx, userId, groupId, &group); err != nil {
				return err
			}
		}
		var tokens []Token
		if err := tx.Select("id", tokenKeyColumn()).
			Where("user_id = ? AND id IN ?", userId, ids).
			Find(&tokens).Error; err != nil {
			return err
		}
		if len(tokens) > 0 {
			if err := invalidateTokensCache(tokens); err != nil {
				common.SysLog(common.LogText("failed to invalidate token cache before group move: %s", err.Error()))
			}
		}
		return tx.Model(&Token{}).Where("user_id = ? AND id IN ?", userId, ids).Update("group_id", groupId).Error
	})
}

func ListUsableTokenGroupKeys(userId int, groupId int) ([]string, error) {
	var group TokenGroup
	if err := DB.First(&group, "id = ? AND user_id = ?", groupId, userId).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, common.NewMessage("API key group not found")
		}
		return nil, err
	}
	var tokens []Token
	err := DB.Select(tokenKeyColumn()).Where(
		"user_id = ? AND group_id = ? AND status = ? AND (expired_time = -1 OR expired_time >= ?) AND (unlimited_quota = ? OR remain_quota > 0)",
		userId, groupId, common.TokenStatusEnabled, common.GetTimestamp(), true,
	).Order("id").Find(&tokens).Error
	if err != nil {
		return nil, err
	}
	keys := make([]string, 0, len(tokens))
	for _, token := range tokens {
		keys = append(keys, token.Key)
	}
	return keys, nil
}

func DisableTokensInGroup(userId int, groupId int) (int64, error) {
	var affected int64
	err := DB.Transaction(func(tx *gorm.DB) error {
		if groupId > 0 {
			var group TokenGroup
			if err := findTokenGroupForUpdate(tx, userId, groupId, &group); err != nil {
				return err
			}
		}
		var tokens []Token
		if err := tx.Select("id", tokenKeyColumn()).
			Where("user_id = ? AND group_id = ? AND status = ?", userId, groupId, common.TokenStatusEnabled).
			Find(&tokens).Error; err != nil {
			return err
		}
		if len(tokens) == 0 {
			return nil
		}
		if err := invalidateTokensCache(tokens); err != nil {
			common.SysLog(common.LogText("failed to invalidate token cache before group disable: %s", err.Error()))
		}
		result := tx.Model(&Token{}).
			Where("user_id = ? AND group_id = ? AND status = ?", userId, groupId, common.TokenStatusEnabled).
			Update("status", common.TokenStatusDisabled)
		affected = result.RowsAffected
		return result.Error
	})
	return affected, err
}

func findTokenGroupForUpdate(tx *gorm.DB, userId int, id int, group *TokenGroup) error {
	err := lockForUpdate(tx).First(group, "id = ? AND user_id = ?", id, userId).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return common.NewMessage("API key group not found")
	}
	return err
}

func tokenKeyColumn() string {
	if commonKeyCol != "" {
		return commonKeyCol
	}
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		return `"key"`
	}
	return "`key`"
}
