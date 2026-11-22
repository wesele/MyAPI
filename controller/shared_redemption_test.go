package controller

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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

func TestSharedRedeemToAdminToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)

	previousDB, previousType := model.DB, common.MainDatabaseType()
	model.DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		model.DB = previousDB
		common.SetMainDatabaseType(previousType)
		_ = sqlDB.Close()
	})

	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Token{}, &model.TokenGroup{}, &model.Redemption{}, &model.RedemptionGroup{}))

	paymentCfg := operation_setting.GetPaymentSetting()
	prevConfirmed := paymentCfg.ComplianceConfirmed
	prevVersion := paymentCfg.ComplianceTermsVersion
	paymentCfg.ComplianceConfirmed = true
	paymentCfg.ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
	t.Cleanup(func() {
		paymentCfg.ComplianceConfirmed = prevConfirmed
		paymentCfg.ComplianceTermsVersion = prevVersion
	})

	admin := model.User{
		Username: "admin",
		Password: "password",
		Role:     common.RoleAdminUser,
		Status:   common.UserStatusEnabled,
		Quota:    100000,
	}
	require.NoError(t, db.Create(&admin).Error)

	group, err := model.CreateRedemptionGroup("PortalGroup")
	require.NoError(t, err)

	const codeKey = "30000000000000000000000000000001"
	require.NoError(t, model.CreateGroupedRedemptions(group.Id, []model.Redemption{
		{
			Name:        "portal-code",
			Key:         codeKey,
			Status:      common.RedemptionCodeStatusEnabled,
			Quota:       8800,
			CreatedTime: common.GetTimestamp(),
		},
	}))

	router := gin.New()
	sharedPortal := router.Group("/api/shared", middleware.SharedPortalRequest)
	sharedPortal.POST("/redeem", RedeemToAdminToken)

	doRedeem := func(body string, withPortalHeader bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/shared/redeem", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		if withPortalHeader {
			req.Header.Set("X-Shared-Portal", "1")
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}

	// Missing X-Shared-Portal header is rejected.
	assert.Equal(t, http.StatusForbidden, doRedeem(`{"key":"`+codeKey+`"}`, false).Code)

	// Valid redemption code returns generated sk-... key.
	rec := doRedeem(`{"key":" `+codeKey+` "}`, true)
	require.Equal(t, http.StatusOK, rec.Code)
	var resp struct {
		Success bool `json:"success"`
		Data    struct {
			Key string `json:"key"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.True(t, resp.Success)
	assert.True(t, strings.HasPrefix(resp.Data.Key, "sk-"))

	// Verify DB token matches requirements.
	rawKey := strings.TrimPrefix(resp.Data.Key, "sk-")
	var tok model.Token
	require.NoError(t, db.First(&tok, "key = ?", rawKey).Error)
	assert.Equal(t, admin.Id, tok.UserId)
	assert.Equal(t, 8800, tok.RemainQuota)
	assert.Equal(t, 0, tok.ConcurrencyLimit)
	assert.False(t, tok.AllowUserQuotaQuery)
	assert.Equal(t, int64(-1), tok.ExpiredTime)

	var tokenGroup model.TokenGroup
	require.NoError(t, db.First(&tokenGroup, tok.GroupId).Error)
	assert.Equal(t, "PortalGroup", tokenGroup.Name)
	assert.Equal(t, 1, tokenGroup.ConcurrencyLimit)

	// Reused code and nonexistent code return identical 400 response without leaking state.
	reusedRec := doRedeem(`{"key":"`+codeKey+`"}`, true)
	missingRec := doRedeem(`{"key":"30000000000000000000000000009999"}`, true)
	assert.Equal(t, http.StatusBadRequest, reusedRec.Code)
	assert.Equal(t, http.StatusBadRequest, missingRec.Code)
	assert.Equal(t, reusedRec.Body.String(), missingRec.Body.String())

	// Compliance disabled blocks redemption.
	paymentCfg.ComplianceConfirmed = false
	assert.Equal(t, http.StatusForbidden, doRedeem(`{"key":"`+codeKey+`"}`, true).Code)
}
