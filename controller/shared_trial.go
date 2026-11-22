package controller

import (
	"context"
	"crypto/rand"
	"errors"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

const (
	sharedTrialCookieName   = "shared_trial_claimed"
	sharedTrialCookieMaxAge = 30 * 24 * 60 * 60
	sharedTrialCooldown     = 10 * time.Minute
	sharedTrialRedisPrefix  = "shared:trial:ip:"
)

var (
	sharedTrialCookiePattern = regexp.MustCompile("^[A-Z2-7]{26}$")
	sharedTrialIPLimiter     common.InMemoryRateLimiter
)

func normalizeSharedTrialClientIP(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	ip := net.ParseIP(trimmed)
	if ip == nil {
		return trimmed
	}
	if v4 := ip.To4(); v4 != nil {
		return v4.String()
	}
	return ip.Mask(net.CIDRMask(64, 128)).String() + "/64"
}

func reserveSharedTrialIPSlot(ctx context.Context, ipKey string) (allowed bool, retryAfterSeconds int64, complete func(success bool), err error) {
	if common.RedisEnabled && common.RDB != nil {
		redisKey := sharedTrialRedisPrefix + ipKey
		ok, setErr := common.RDB.SetNX(ctx, redisKey, "1", sharedTrialCooldown).Result()
		if setErr != nil {
			return false, 0, nil, setErr
		}
		if !ok {
			ttl, ttlErr := common.RDB.TTL(ctx, redisKey).Result()
			retryAfter := int64(sharedTrialCooldown.Seconds())
			if ttlErr == nil && ttl > 0 {
				retryAfter = max(int64(ttl.Seconds()), 1)
			}
			return false, retryAfter, nil, nil
		}
		return true, 0, func(success bool) {
			if !success {
				_ = common.RDB.Del(context.Background(), redisKey).Err()
			}
		}, nil
	}

	sharedTrialIPLimiter.Init(sharedTrialCooldown)
	durationSeconds := int64(sharedTrialCooldown.Seconds())
	reservation := sharedTrialIPLimiter.Reserve(ipKey, 1, durationSeconds)
	if reservation == nil {
		return false, durationSeconds, nil, nil
	}
	return true, 0, reservation.Complete, nil
}

func writeSharedTrialError(c *gin.Context, status int, code string, message string) {
	common.ApiErrorStatus(c, status, common.NewMessage(message), gin.H{"code": code})
}

// ClaimSharedTrialKey issues a 1-RMB, 1-month trial API token under the
// 'admin' user's 'Direct' group, enforcing cookie deduplication, a 10-minute
// per-IP cooldown, and the global daily limit. Logged-in admin accounts bypass
// these limits for testing.
func ClaimSharedTrialKey(c *gin.Context) {
	isAdmin := c.GetInt("role") >= common.RoleAdminUser
	if isAdmin {
		token, err := model.ClaimSharedTrialToken(true)
		if err != nil {
			logger.LogError(c, common.LogText("shared trial key claim failed: %s", err.Error()))
			writeSharedTrialError(c, http.StatusServiceUnavailable, "unavailable", "Could not claim a free trial API key. Try again.")
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "",
			"data": gin.H{
				"key":          "sk-" + token.Key,
				"expired_time": token.ExpiredTime,
			},
		})
		return
	}

	if claimed, err := c.Cookie(sharedTrialCookieName); err == nil && sharedTrialCookiePattern.MatchString(claimed) {
		writeSharedTrialError(c, http.StatusConflict, "already_claimed", "You have already claimed a free trial API key.")
		return
	}

	ipKey := normalizeSharedTrialClientIP(c.ClientIP())
	if ipKey == "" {
		writeSharedTrialError(c, http.StatusForbidden, "client_ip_unresolved", "Client IP could not be resolved.")
		return
	}

	allowed, retryAfter, complete, err := reserveSharedTrialIPSlot(c.Request.Context(), ipKey)
	if err != nil {
		logger.LogError(c, common.LogText("shared trial IP cooldown check failed: %s", err.Error()))
		writeSharedTrialError(c, http.StatusServiceUnavailable, "unavailable", "Could not claim a free trial API key. Try again.")
		return
	}
	if !allowed {
		if retryAfter > 0 {
			c.Header("Retry-After", strconv.FormatInt(retryAfter, 10))
		}
		writeSharedTrialError(c, http.StatusTooManyRequests, "ip_cooldown", "Too many claims from this IP. Please try again in 10 minutes.")
		return
	}

	token, err := model.ClaimSharedTrialToken(false)
	if err != nil {
		complete(false)
		if errors.Is(err, model.ErrSharedTrialDailyLimitReached) {
			writeSharedTrialError(c, http.StatusTooManyRequests, "daily_limit_reached", "Today's free trial keys have been fully claimed. Please try again tomorrow.")
			return
		}
		logger.LogError(c, common.LogText("shared trial key claim failed: %s", err.Error()))
		writeSharedTrialError(c, http.StatusServiceUnavailable, "unavailable", "Could not claim a free trial API key. Try again.")
		return
	}

	complete(true)
	cookieSecure := common.SessionCookieSecure ||
		c.Request.TLS != nil ||
		strings.EqualFold(c.Request.URL.Scheme, "https") ||
		strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https")
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     sharedTrialCookieName,
		Value:    rand.Text(),
		Path:     "/api/shared",
		MaxAge:   sharedTrialCookieMaxAge,
		Secure:   cookieSecure,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"key":          "sk-" + token.Key,
			"expired_time": token.ExpiredTime,
		},
	})
}

// GetSharedTokenUsage returns token usage details for the shared portal along
// with the masked key hint and Direct free-trial weekly refill eligibility.
func GetSharedTokenUsage(c *gin.Context) {
	token, ok := resolveTokenFromAuthHeader(c)
	if !ok {
		return
	}

	data, err := buildTokenUsageData(token)
	if err != nil {
		common.SysError(common.LogText("failed to get user quota: %s", err.Error()))
		common.ApiErrorI18n(c, i18n.MsgTokenGetInfoFailed)
		return
	}

	data["masked_key"] = "sk-" + token.GetMaskedKey()
	refillStatus, err := model.GetSharedTrialRefillStatus(token)
	if err != nil {
		logger.LogError(c, common.LogText("failed to inspect shared trial refill status: %s", err.Error()))
	} else {
		data["trial_refill"] = refillStatus
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    true,
		"message": "ok",
		"data":    data,
	})
}

// RefillSharedTrialKey resets a Direct-group free-trial API key's remaining
// quota back to 1 RMB once per week.
func RefillSharedTrialKey(c *gin.Context) {
	tokenKey := c.GetString("token_key")
	if tokenKey == "" {
		writeSharedTrialError(c, http.StatusUnauthorized, "unauthorized", "This API Key is invalid or unavailable.")
		return
	}

	token, nextRefillAt, err := model.RefillSharedTrialToken(tokenKey)
	if err != nil {
		switch {
		case errors.Is(err, model.ErrSharedTrialRefillNotEligible):
			writeSharedTrialError(c, http.StatusForbidden, "not_eligible", "This API Key is not eligible for free weekly refills.")
		case errors.Is(err, model.ErrSharedTrialRefillCooldown):
			common.ApiErrorStatus(c, http.StatusTooManyRequests, common.NewMessage("Free refill is limited to once per week."), gin.H{
				"code":           "refill_cooldown",
				"next_refill_at": nextRefillAt,
			})
		case errors.Is(err, model.ErrSharedTrialRefillAlreadyFull):
			writeSharedTrialError(c, http.StatusConflict, "already_full", "Your API Key quota is already full.")
		default:
			logger.LogError(c, common.LogText("shared trial key refill failed: %s", err.Error()))
			writeSharedTrialError(c, http.StatusInternalServerError, "unavailable", "Could not refill quota. Try again.")
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"remain_quota":   token.RemainQuota,
			"expired_time":   token.ExpiredTime,
			"next_refill_at": nextRefillAt,
		},
	})
}
