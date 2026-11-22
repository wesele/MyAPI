package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func ListRedemptionGroups(c *gin.Context) {
	groups, err := model.ListRedemptionGroups()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, groups)
}

func CreateRedemptionGroup(c *gin.Context) {
	name, err := bindGroupName(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	group, err := model.CreateRedemptionGroup(name)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "redemption.group_create", map[string]any{"group_id": group.Id})
	common.ApiSuccess(c, group)
}

func RenameRedemptionGroup(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("group_id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	name, err := bindGroupName(c)
	if err == nil {
		err = model.RenameRedemptionGroup(id, name)
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "redemption.group_rename", map[string]any{"group_id": id})
	common.ApiSuccess(c, nil)
}

func DownloadRedemptionGroupCodes(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("group_id"))
	if err != nil || id <= 0 {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"), nil)
		return
	}
	keys, err := model.ListUsableRedemptionGroupKeys(id)
	if err != nil {
		common.SysError(common.LogText("failed to export redemption codes: %s", err.Error()))
		common.ApiErrorStatus(c, http.StatusInternalServerError, common.NewMessage("Failed to load"), nil)
		return
	}
	recordManageAudit(c, "redemption.group_export", map[string]any{"group_id": id, "count": len(keys)})
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=redemption-group-%d.txt", id))
	c.String(http.StatusOK, "%s", strings.Join(keys, "\n"))
}

func DeleteRedemptionGroup(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("group_id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := model.DeleteRedemptionGroup(id); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "redemption.group_delete", map[string]any{"group_id": id})
	common.ApiSuccess(c, nil)
}

func DisableRedemptionGroupCodes(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("group_id"))
	if err != nil || id < 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	count, err := model.DisableRedemptionsInGroup(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "redemption.group_disable", map[string]any{"group_id": id, "count": count})
	common.ApiSuccess(c, count)
}

func MoveRedemptionGroupMembers(c *gin.Context) {
	var request struct {
		Ids     []int `json:"ids" binding:"required,min=1,max=1000,dive,gt=0"`
		GroupId *int  `json:"group_id" binding:"required,gte=0"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := model.MoveRedemptionsToGroup(request.Ids, *request.GroupId); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "redemption.group_move", map[string]any{
		"group_id":                 *request.GroupId,
		"requested_redemption_ids": request.Ids,
	})
	common.ApiSuccess(c, nil)
}

func bindGroupName(c *gin.Context) (string, error) {
	var request struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		return "", common.NewMessage("Invalid parameters")
	}
	name := strings.TrimSpace(request.Name)
	if name == "" || utf8.RuneCountInString(name) > 64 {
		return "", common.NewMessage("Group name must contain 1 to 64 characters")
	}
	return name, nil
}
