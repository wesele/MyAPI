package controller

import (
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

type sharedRedeemRequest struct {
	Key string `json:"key"`
}

// RedeemToAdminToken exchanges a valid redemption code from the public portal
// for a single-concurrency API token owned by the 'admin' user.
func RedeemToAdminToken(c *gin.Context) {
	if !operation_setting.IsPaymentComplianceConfirmed() {
		common.ApiErrorStatus(c, http.StatusForbidden, common.NewMessage("Payment, redemption, subscription, and invitation reward features are disabled. The administrator must confirm compliance terms before enabling them."))
		return
	}

	var req sharedRedeemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
		return
	}
	code := strings.TrimSpace(req.Key)
	if code == "" || strings.ContainsAny(code, " \t\r\n") {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
		return
	}

	token, err := model.RedeemToAdminToken(code)
	if err != nil {
		// Return a uniform error to anonymous callers so code states cannot be enumerated.
		logger.LogError(c, common.LogText("shared portal redeem failed: %s", err.Error()))
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Redemption failed, please try again later"))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"key": "sk-" + token.Key,
		},
	})
}
