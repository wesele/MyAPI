package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupSharedTrialTest(t *testing.T) (*gorm.DB, *gin.Engine, model.User) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)

	previousDB, previousType := model.DB, common.MainDatabaseType()
	previousQuotaPerUnit := common.QuotaPerUnit
	previousExchangeRate := operation_setting.USDExchangeRate
	previousRedisEnabled := common.RedisEnabled
	previousCookieSecure := common.SessionCookieSecure

	model.DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.QuotaPerUnit = 500000
	operation_setting.USDExchangeRate = 7.3
	common.RedisEnabled = false
	common.SessionCookieSecure = false
	sharedTrialIPLimiter = common.InMemoryRateLimiter{}

	t.Cleanup(func() {
		model.DB = previousDB
		common.SetMainDatabaseType(previousType)
		common.QuotaPerUnit = previousQuotaPerUnit
		operation_setting.USDExchangeRate = previousExchangeRate
		common.RedisEnabled = previousRedisEnabled
		common.SessionCookieSecure = previousCookieSecure
		sharedTrialIPLimiter = common.InMemoryRateLimiter{}
		_ = sqlDB.Close()
	})

	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Token{}, &model.TokenGroup{}))

	admin := model.User{
		Username: "admin",
		Password: "password",
		Role:     common.RoleAdminUser,
		Status:   common.UserStatusEnabled,
		Quota:    100000,
	}
	require.NoError(t, db.Create(&admin).Error)

	router := gin.New()
	require.NoError(t, router.SetTrustedProxies(nil))
	sharedPortal := router.Group("/api/shared", middleware.SharedPortalRequest)
	sharedPortal.POST("/trial-key", ClaimSharedTrialKey)

	return db, router, admin
}

func doSharedTrialRequest(router *gin.Engine, remoteAddr string, withPortalHeader bool, cookie *http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/shared/trial-key", nil)
	req.RemoteAddr = remoteAddr
	if withPortalHeader {
		req.Header.Set("X-Shared-Portal", "1")
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestSharedTrialKeyClaimCookieAndCooldown(t *testing.T) {
	db, router, admin := setupSharedTrialTest(t)

	// Missing X-Shared-Portal header is rejected.
	assert.Equal(t, http.StatusForbidden, doSharedTrialRequest(router, "198.51.100.10:1234", false, nil).Code)

	// First claim succeeds, creates Direct token under admin with 1 RMB quota and 1 month expiry.
	before := time.Now()
	firstRec := doSharedTrialRequest(router, "198.51.100.10:1234", true, nil)
	require.Equal(t, http.StatusOK, firstRec.Code)

	var firstResp struct {
		Success bool `json:"success"`
		Data    struct {
			Key         string `json:"key"`
			ExpiredTime int64  `json:"expired_time"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(firstRec.Body.Bytes(), &firstResp))
	assert.True(t, firstResp.Success)
	assert.True(t, strings.HasPrefix(firstResp.Data.Key, "sk-"))

	var issuedCookie *http.Cookie
	for _, cookie := range firstRec.Result().Cookies() {
		if cookie.Name == sharedTrialCookieName {
			issuedCookie = cookie
			break
		}
	}
	require.NotNil(t, issuedCookie)
	assert.True(t, issuedCookie.HttpOnly)
	assert.Equal(t, http.SameSiteStrictMode, issuedCookie.SameSite)
	assert.Equal(t, sharedTrialCookieMaxAge, issuedCookie.MaxAge)

	var tok model.Token
	require.NoError(t, db.First(&tok, "key = ?", strings.TrimPrefix(firstResp.Data.Key, "sk-")).Error)
	assert.Equal(t, admin.Id, tok.UserId)
	assert.Equal(t, model.SharedTrialTokenName, tok.Name)
	assert.Equal(t, common.QuotaRound(500000.0/7.3), tok.RemainQuota)
	assert.False(t, tok.UnlimitedQuota)
	assert.Equal(t, 0, tok.ConcurrencyLimit)
	assert.False(t, tok.AllowUserQuotaQuery)
	assert.Equal(t, tok.CreatedTime, tok.TrialRefilledAt)
	expectedExpiryMin := before.AddDate(0, 1, 0).Unix() - 5
	expectedExpiryMax := time.Now().AddDate(0, 1, 0).Unix() + 5
	assert.GreaterOrEqual(t, tok.ExpiredTime, expectedExpiryMin)
	assert.LessOrEqual(t, tok.ExpiredTime, expectedExpiryMax)

	var group model.TokenGroup
	require.NoError(t, db.First(&group, tok.GroupId).Error)
	assert.Equal(t, admin.Id, group.UserId)
	assert.Equal(t, model.SharedTrialTokenGroupName, group.Name)
	assert.Equal(t, model.SharedTrialDefaultConcurrencyLimit, group.ConcurrencyLimit)

	// Admin updates Direct group's concurrency limit; subsequent trial claims preserve it.
	newLimit := 3
	_, err := model.UpdateTokenGroup(admin.Id, group.Id, group.Name, &newLimit)
	require.NoError(t, err)
	secondRec := doSharedTrialRequest(router, "198.51.100.12:1234", true, nil)
	require.Equal(t, http.StatusOK, secondRec.Code)
	require.NoError(t, db.First(&group, tok.GroupId).Error)
	assert.Equal(t, 3, group.ConcurrencyLimit)

	// Reusing the issued cookie from another IP is blocked.
	cookieRec := doSharedTrialRequest(router, "198.51.100.11:1234", true, issuedCookie)
	require.Equal(t, http.StatusConflict, cookieRec.Code)
	var errResp struct {
		Success bool   `json:"success"`
		Code    string `json:"code"`
	}
	require.NoError(t, common.Unmarshal(cookieRec.Body.Bytes(), &errResp))
	assert.False(t, errResp.Success)
	assert.Equal(t, "already_claimed", errResp.Code)

	// Same IP without cookie within 10 minutes is blocked by IP cooldown.
	cooldownRec := doSharedTrialRequest(router, "198.51.100.10:5678", true, nil)
	require.Equal(t, http.StatusTooManyRequests, cooldownRec.Code)
	assert.NotEmpty(t, cooldownRec.Header().Get("Retry-After"))
	require.NoError(t, common.Unmarshal(cooldownRec.Body.Bytes(), &errResp))
	assert.Equal(t, "ip_cooldown", errResp.Code)

	// IPv6 addresses in the same /64 prefix share cooldown.
	v6First := doSharedTrialRequest(router, "[2001:db8:1:2::10]:1234", true, nil)
	require.Equal(t, http.StatusOK, v6First.Code)
	v6Second := doSharedTrialRequest(router, "[2001:db8:1:2::99]:4321", true, nil)
	require.Equal(t, http.StatusTooManyRequests, v6Second.Code)

	// Direct TokenGroup is reused rather than duplicated.
	var groupCount int64
	require.NoError(t, db.Model(&model.TokenGroup{}).Where("user_id = ? AND name = ?", admin.Id, model.SharedTrialTokenGroupName).Count(&groupCount).Error)
	assert.Equal(t, int64(1), groupCount)
}

func TestSharedTrialKeyDailyLimitAndYesterdayCarryover(t *testing.T) {
	db, router, admin := setupSharedTrialTest(t)

	nowTime := time.Now()
	y, m, d := nowTime.Date()
	dayStart := time.Date(y, m, d, 0, 0, 0, 0, nowTime.Location()).Unix()

	// Yesterday's tokens must not count toward today's daily quota.
	yesterdayToken := model.Token{
		UserId:      admin.Id,
		Name:        model.SharedTrialTokenName,
		Key:         "yesterday-trial-key",
		Status:      common.TokenStatusEnabled,
		CreatedTime: dayStart - 60,
		RemainQuota: 100,
	}
	require.NoError(t, db.Create(&yesterdayToken).Error)

	// Seed 99 tokens created today so one more succeeds and the next hits the 100/day cap.
	todayTokens := make([]model.Token, 0, model.SharedTrialDailyLimit-1)
	for i := range model.SharedTrialDailyLimit - 1 {
		todayTokens = append(todayTokens, model.Token{
			UserId:      admin.Id,
			Name:        model.SharedTrialTokenName,
			Key:         fmt.Sprintf("today-trial-key-%03d", i),
			Status:      common.TokenStatusEnabled,
			CreatedTime: dayStart + int64(i) + 1,
			RemainQuota: 100,
		})
	}
	require.NoError(t, db.Create(&todayTokens).Error)

	// 100th claim today succeeds.
	okRec := doSharedTrialRequest(router, "203.0.113.1:1000", true, nil)
	require.Equal(t, http.StatusOK, okRec.Code)

	// 101st claim today hits daily_limit_reached.
	limitRec := doSharedTrialRequest(router, "203.0.113.2:1000", true, nil)
	require.Equal(t, http.StatusTooManyRequests, limitRec.Code)
	var errResp struct {
		Success bool   `json:"success"`
		Code    string `json:"code"`
	}
	require.NoError(t, common.Unmarshal(limitRec.Body.Bytes(), &errResp))
	assert.Equal(t, "daily_limit_reached", errResp.Code)
}

func TestSharedTrialKeyAdminBypassLimits(t *testing.T) {
	db, _, admin := setupSharedTrialTest(t)

	nowTime := time.Now()
	y, m, d := nowTime.Date()
	dayStart := time.Date(y, m, d, 0, 0, 0, 0, nowTime.Location()).Unix()

	// Seed 100 tokens so daily limit is already reached for normal callers.
	todayTokens := make([]model.Token, 0, model.SharedTrialDailyLimit)
	for i := range model.SharedTrialDailyLimit {
		todayTokens = append(todayTokens, model.Token{
			UserId:      admin.Id,
			Name:        model.SharedTrialTokenName,
			Key:         fmt.Sprintf("seeded-trial-key-%03d", i),
			Status:      common.TokenStatusEnabled,
			CreatedTime: dayStart + int64(i) + 1,
			RemainQuota: 100,
		})
	}
	require.NoError(t, db.Create(&todayTokens).Error)

	roleRouter := gin.New()
	require.NoError(t, roleRouter.SetTrustedProxies(nil))
	roleRouter.Use(func(c *gin.Context) {
		switch c.GetHeader("X-Test-Role") {
		case "admin":
			c.Set("role", common.RoleAdminUser)
		case "root":
			c.Set("role", common.RoleRootUser)
		case "user":
			c.Set("role", common.RoleCommonUser)
		}
		c.Next()
	})
	roleRouter.POST("/api/shared/trial-key", middleware.SharedPortalRequest, ClaimSharedTrialKey)

	doWithRole := func(roleHeader string, cookie *http.Cookie) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/shared/trial-key", nil)
		req.RemoteAddr = "203.0.113.88:9999"
		req.Header.Set("X-Shared-Portal", "1")
		if roleHeader != "" {
			req.Header.Set("X-Test-Role", roleHeader)
		}
		if cookie != nil {
			req.AddCookie(cookie)
		}
		rec := httptest.NewRecorder()
		roleRouter.ServeHTTP(rec, req)
		return rec
	}

	existingCookie := &http.Cookie{Name: sharedTrialCookieName, Value: "ABCDEFGHIJKLMNOPQRSTUVWXYZ"}

	// Admin and root can claim repeatedly from the same IP, with an existing cookie, and past the daily limit.
	for _, role := range []string{"admin", "admin", "root"} {
		rec := doWithRole(role, existingCookie)
		require.Equal(t, http.StatusOK, rec.Code)
		assert.Empty(t, rec.Result().Cookies())
	}

	// Regular logged-in users remain subject to cookie, IP cooldown, and daily limit.
	userRec := doWithRole("user", existingCookie)
	assert.Equal(t, http.StatusConflict, userRec.Code)
	userNoCookieRec := doWithRole("user", nil)
	assert.Equal(t, http.StatusTooManyRequests, userNoCookieRec.Code)
}

func TestSharedTokenUsageAndWeeklyRefill(t *testing.T) {
	db, router, admin := setupSharedTrialTest(t)
	t.Setenv("LOG_SQL_DSN", "")
	require.NoError(t, model.InitLogDB())

	sharedUsage := router.Group("/api/shared/usage/:id", middleware.SharedPortalRequest, middleware.TokenAuthReadOnly())
	sharedUsage.GET("/totals", GetSharedTokenUsage)
	sharedUsage.POST("/refill", RefillSharedTrialKey)

	directGroup := model.TokenGroup{UserId: admin.Id, Name: model.SharedTrialTokenGroupName}
	require.NoError(t, db.Create(&directGroup).Error)
	otherGroup := model.TokenGroup{UserId: admin.Id, Name: "OtherGroup"}
	require.NoError(t, db.Create(&otherGroup).Error)

	trialQuota := model.SharedTrialQuota()
	lookupID := strings.Repeat("A", 26)

	trialToken := model.Token{
		UserId:         admin.Id,
		Name:           model.SharedTrialTokenName,
		Key:            "trialrefillkey123456",
		Status:         common.TokenStatusEnabled,
		CreatedTime:    time.Now().Unix(),
		ExpiredTime:    time.Now().AddDate(0, 1, 0).Unix(),
		RemainQuota:    trialQuota,
		UnlimitedQuota: false,
		GroupId:        directGroup.Id,
	}
	require.NoError(t, db.Create(&trialToken).Error)

	redeemDirectToken := model.Token{
		UserId:         admin.Id,
		Name:           "redeem",
		Key:            "redeemdirectkey12345",
		Status:         common.TokenStatusEnabled,
		CreatedTime:    time.Now().Unix(),
		ExpiredTime:    -1,
		RemainQuota:    100,
		UnlimitedQuota: false,
		GroupId:        directGroup.Id,
	}
	require.NoError(t, db.Create(&redeemDirectToken).Error)

	nonDirectTrialToken := model.Token{
		UserId:         admin.Id,
		Name:           model.SharedTrialTokenName,
		Key:            "othergrouptrial12345",
		Status:         common.TokenStatusEnabled,
		CreatedTime:    time.Now().Unix(),
		ExpiredTime:    -1,
		RemainQuota:    100,
		UnlimitedQuota: false,
		GroupId:        otherGroup.Id,
	}
	require.NoError(t, db.Create(&nonDirectTrialToken).Error)

	doTotals := func(key string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/shared/usage/"+lookupID+"/totals", nil)
		req.Header.Set("X-Shared-Portal", "1")
		req.Header.Set("Authorization", "Bearer sk-"+key)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	doRefill := func(key string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/shared/usage/"+lookupID+"/refill", nil)
		req.Header.Set("X-Shared-Portal", "1")
		req.Header.Set("Authorization", "Bearer sk-"+key)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}

	// 1. Freshly claimed trial key immediately starts a 7-day cooldown and is full.
	totalsRec := doTotals(trialToken.Key)
	require.Equal(t, http.StatusOK, totalsRec.Code)
	var totalsResp struct {
		Code bool `json:"code"`
		Data struct {
			MaskedKey   string                        `json:"masked_key"`
			TrialRefill model.SharedTrialRefillStatus `json:"trial_refill"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(totalsRec.Body.Bytes(), &totalsResp))
	assert.True(t, totalsResp.Code)
	assert.Equal(t, "sk-tria**********3456", totalsResp.Data.MaskedKey)
	assert.True(t, totalsResp.Data.TrialRefill.Eligible)
	assert.True(t, totalsResp.Data.TrialRefill.AlreadyFull)
	assert.False(t, totalsResp.Data.TrialRefill.CanRefill)
	assert.GreaterOrEqual(t, totalsResp.Data.TrialRefill.NextRefillAt, trialToken.CreatedTime+model.SharedTrialRefillIntervalSeconds-2)
	assert.Equal(t, trialQuota, totalsResp.Data.TrialRefill.TargetQuota)

	// Exhausting quota within the first week still hits cooldown (both TrialRefilledAt=0 fallback and TrialRefilledAt=CreatedTime).
	require.NoError(t, db.Model(&model.Token{}).Where("id = ?", trialToken.Id).Updates(map[string]any{
		"remain_quota": 0,
		"used_quota":   trialQuota,
		"status":       common.TokenStatusExhausted,
	}).Error)

	totalsRec = doTotals(trialToken.Key)
	require.Equal(t, http.StatusOK, totalsRec.Code)
	require.NoError(t, common.Unmarshal(totalsRec.Body.Bytes(), &totalsResp))
	assert.True(t, totalsResp.Data.TrialRefill.Eligible)
	assert.False(t, totalsResp.Data.TrialRefill.AlreadyFull)
	assert.False(t, totalsResp.Data.TrialRefill.CanRefill)
	assert.Greater(t, totalsResp.Data.TrialRefill.NextRefillAt, time.Now().Unix())
	assert.Equal(t, http.StatusTooManyRequests, doRefill(trialToken.Key).Code)

	// Once 7 days have passed since claim (or already full returns 409), refill is allowed when quota < target.
	require.NoError(t, db.Model(&model.Token{}).Where("id = ?", trialToken.Id).Updates(map[string]any{
		"created_time":      time.Now().Unix() - model.SharedTrialRefillIntervalSeconds - 10,
		"trial_refilled_at": 0,
		"remain_quota":      trialQuota,
	}).Error)
	assert.Equal(t, http.StatusConflict, doRefill(trialToken.Key).Code)

	// 2. Simulate partial usage, exhaustion, and near-term expiry after the initial 7 days; refill succeeds and resets quota + extends expiry.
	require.NoError(t, db.Model(&model.Token{}).Where("id = ?", trialToken.Id).Updates(map[string]any{
		"remain_quota": 0,
		"used_quota":   trialQuota,
		"status":       common.TokenStatusExhausted,
		"expired_time": time.Now().Add(-time.Hour).Unix(),
	}).Error)

	totalsRec = doTotals(trialToken.Key)
	require.Equal(t, http.StatusOK, totalsRec.Code)
	require.NoError(t, common.Unmarshal(totalsRec.Body.Bytes(), &totalsResp))
	assert.True(t, totalsResp.Data.TrialRefill.Eligible)
	assert.False(t, totalsResp.Data.TrialRefill.AlreadyFull)
	assert.True(t, totalsResp.Data.TrialRefill.CanRefill)
	assert.Zero(t, totalsResp.Data.TrialRefill.NextRefillAt)

	beforeRefill := time.Now()
	refillRec := doRefill(trialToken.Key)
	require.Equal(t, http.StatusOK, refillRec.Code, refillRec.Body.String())
	var refillResp struct {
		Success bool `json:"success"`
		Data    struct {
			RemainQuota  int   `json:"remain_quota"`
			ExpiredTime  int64 `json:"expired_time"`
			NextRefillAt int64 `json:"next_refill_at"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(refillRec.Body.Bytes(), &refillResp))
	assert.True(t, refillResp.Success)
	assert.Equal(t, trialQuota, refillResp.Data.RemainQuota)
	assert.GreaterOrEqual(t, refillResp.Data.ExpiredTime, beforeRefill.AddDate(0, 1, 0).Unix()-5)
	assert.GreaterOrEqual(t, refillResp.Data.NextRefillAt, beforeRefill.Unix()+model.SharedTrialRefillIntervalSeconds-5)

	var reloaded model.Token
	require.NoError(t, db.First(&reloaded, trialToken.Id).Error)
	assert.Equal(t, trialQuota, reloaded.RemainQuota)
	assert.Equal(t, trialQuota, reloaded.UsedQuota)
	assert.Equal(t, common.TokenStatusEnabled, reloaded.Status)

	// 3. Spending again within the same week hits weekly cooldown.
	require.NoError(t, db.Model(&model.Token{}).Where("id = ?", trialToken.Id).Update("remain_quota", 100).Error)
	totalsRec = doTotals(trialToken.Key)
	require.Equal(t, http.StatusOK, totalsRec.Code)
	require.NoError(t, common.Unmarshal(totalsRec.Body.Bytes(), &totalsResp))
	assert.False(t, totalsResp.Data.TrialRefill.CanRefill)
	assert.Greater(t, totalsResp.Data.TrialRefill.NextRefillAt, time.Now().Unix())

	cooldownRec := doRefill(trialToken.Key)
	assert.Equal(t, http.StatusTooManyRequests, cooldownRec.Code)

	// 4. After 7 days, refill is allowed again.
	require.NoError(t, db.Model(&model.Token{}).Where("id = ?", trialToken.Id).Update("trial_refilled_at", time.Now().Unix()-model.SharedTrialRefillIntervalSeconds-10).Error)
	secondRefillRec := doRefill(trialToken.Key)
	require.Equal(t, http.StatusOK, secondRefillRec.Code)

	// 5. Non-free-trial Direct keys and non-Direct keys are not eligible.
	for _, ineligibleKey := range []string{redeemDirectToken.Key, nonDirectTrialToken.Key} {
		rec := doTotals(ineligibleKey)
		require.Equal(t, http.StatusOK, rec.Code)
		require.NoError(t, common.Unmarshal(rec.Body.Bytes(), &totalsResp))
		assert.False(t, totalsResp.Data.TrialRefill.Eligible)
		assert.Equal(t, http.StatusForbidden, doRefill(ineligibleKey).Code)
	}
}
