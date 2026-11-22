package controller

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type tokenGroupRequest struct {
	Name             string `json:"name"`
	ConcurrencyLimit *int   `json:"concurrency_limit"`
}

func bindTokenGroupRequest(c *gin.Context) (string, *int, error) {
	var request tokenGroupRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		return "", nil, common.NewMessage("Invalid parameters")
	}
	name := strings.TrimSpace(request.Name)
	if name == "" || utf8.RuneCountInString(name) > 64 {
		return "", nil, common.NewMessage("Group name must contain 1 to 64 characters")
	}
	if request.ConcurrencyLimit != nil && *request.ConcurrencyLimit < 0 {
		return "", nil, common.NewMessage("Concurrency limit must be 0 or greater")
	}
	return name, request.ConcurrencyLimit, nil
}

func ListTokenGroups(c *gin.Context) {
	groups, err := model.ListTokenGroups(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, groups)
}

func CreateTokenGroup(c *gin.Context) {
	name, concurrencyLimit, err := bindTokenGroupRequest(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	limit := 0
	if concurrencyLimit != nil {
		limit = *concurrencyLimit
	}
	group, err := model.CreateTokenGroup(c.GetInt("id"), name, limit)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	params := tokenAuditParams(c)
	params["group_id"] = group.Id
	params["concurrency_limit"] = group.ConcurrencyLimit
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	common.ApiSuccess(c, group)
}

func UpdateTokenGroup(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("group_id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	name, concurrencyLimit, err := bindTokenGroupRequest(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	group, err := model.UpdateTokenGroup(c.GetInt("id"), id, name, concurrencyLimit)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	params := tokenAuditParams(c)
	params["group_id"] = id
	params["concurrency_limit"] = group.ConcurrencyLimit
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	common.ApiSuccess(c, group)
}

func DownloadTokenGroupKeys(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("group_id"))
	if err != nil || id <= 0 {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"), nil)
		return
	}
	keys, err := model.ListUsableTokenGroupKeys(c.GetInt("id"), id)
	if err != nil {
		var message *common.Message
		if errors.As(err, &message) {
			common.ApiErrorStatus(c, http.StatusNotFound, message, nil)
			return
		}
		common.SysError(common.LogText("failed to export token keys: %s", err.Error()))
		common.ApiErrorStatus(c, http.StatusInternalServerError, common.NewMessage("Failed to load"), nil)
		return
	}
	lines := make([]string, len(keys))
	for i, key := range keys {
		lines[i] = "sk-" + key
	}
	params := tokenAuditParams(c)
	params["group_id"] = id
	params["count"] = len(keys)
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=api-key-group-%d.txt", id))
	c.String(http.StatusOK, "%s", strings.Join(lines, "\n"))
}

func DeleteTokenGroup(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("group_id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := model.DeleteTokenGroup(c.GetInt("id"), id); err != nil {
		common.ApiError(c, err)
		return
	}
	params := tokenAuditParams(c)
	params["group_id"] = id
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	common.ApiSuccess(c, nil)
}

func DisableTokenGroupKeys(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("group_id"))
	if err != nil || id < 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	count, err := model.DisableTokensInGroup(c.GetInt("id"), id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	params := tokenAuditParams(c)
	params["group_id"] = id
	params["count"] = count
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	common.ApiSuccess(c, count)
}

func MoveTokenGroupMembers(c *gin.Context) {
	var request struct {
		Ids     []int `json:"ids" binding:"required,min=1,max=1000,dive,gt=0"`
		GroupId *int  `json:"group_id" binding:"required,gte=0"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := model.MoveTokensToGroup(c.GetInt("id"), request.Ids, *request.GroupId); err != nil {
		common.ApiError(c, err)
		return
	}
	params := tokenAuditParams(c)
	params["group_id"] = *request.GroupId
	params["requested_token_ids"] = request.Ids
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	common.ApiSuccess(c, nil)
}
