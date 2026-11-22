package controller

import (
	"crypto/sha1"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"io"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// The suffix keeps the whole value out of the generic settings response.
const wechatOfficialAccountOption = "WeChatOfficialAccountSecret"

const (
	wechatPlain      = "plain"
	wechatCompatible = "compatible"
	wechatSafe       = "safe"
	wechatWindow     = int64(5 * time.Minute / time.Second)
)

var (
	wechatTokenPattern = regexp.MustCompile(`^[A-Za-z0-9]{3,32}$`)
	wechatAESPattern   = regexp.MustCompile(`^[A-Za-z0-9]{43}$`)
)

type wechatOfficialAccountSettings struct {
	Enabled         bool   `json:"enabled"`
	Mode            string `json:"mode"`
	AppID           string `json:"app_id"`
	OriginalID      string `json:"original_id"`
	GroupID         int    `json:"group_id"`
	MessageTemplate string `json:"message_template"`
}

type wechatOfficialAccountConfig struct {
	wechatOfficialAccountSettings
	Token          string `json:"token"`
	EncodingAESKey string `json:"encoding_aes_key"`
}

func loadWeChatOfficialAccountConfig() (wechatOfficialAccountConfig, error) {
	config := wechatOfficialAccountConfig{}
	config.Mode = wechatSafe
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[wechatOfficialAccountOption]
	common.OptionMapRWMutex.RUnlock()
	if raw == "" {
		return config, nil
	}
	err := common.UnmarshalJsonStr(raw, &config)
	return config, err
}

func GetWeChatOfficialAccountSettings(c *gin.Context) {
	config, err := loadWeChatOfficialAccountConfig()
	if err != nil {
		common.ApiErrorT(c, "Could not load WeChat Official Account settings")
		return
	}
	common.ApiSuccess(c, struct {
		wechatOfficialAccountSettings
		TokenConfigured bool `json:"token_configured"`
		KeyConfigured   bool `json:"key_configured"`
	}{config.wechatOfficialAccountSettings, config.Token != "", config.EncodingAESKey != ""})
}

func UpdateWeChatOfficialAccountSettings(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
	var change struct {
		wechatOfficialAccountSettings
		Token          *string `json:"token"`
		EncodingAESKey *string `json:"encoding_aes_key"`
	}
	if err := common.DecodeJson(c.Request.Body, &change); err != nil {
		common.ApiErrorT(c, "Invalid request")
		return
	}
	config, err := loadWeChatOfficialAccountConfig()
	if err != nil {
		common.ApiErrorT(c, "Could not load WeChat Official Account settings")
		return
	}
	config.wechatOfficialAccountSettings = change.wechatOfficialAccountSettings
	config.AppID = strings.TrimSpace(config.AppID)
	config.OriginalID = strings.TrimSpace(config.OriginalID)
	config.MessageTemplate = strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(config.MessageTemplate, "\r\n", "\n"), "\r", "\n"))
	if change.Token != nil {
		config.Token = strings.TrimSpace(*change.Token)
	}
	if change.EncodingAESKey != nil {
		config.EncodingAESKey = strings.TrimSpace(*change.EncodingAESKey)
	}
	if config.Mode != wechatPlain && config.Mode != wechatCompatible && config.Mode != wechatSafe {
		common.ApiErrorT(c, "Invalid request")
		return
	}
	if (config.Token != "" || config.Enabled) && !wechatTokenPattern.MatchString(config.Token) {
		common.ApiErrorT(c, "The WeChat Token must contain 3 to 32 letters or digits")
		return
	}
	if (config.EncodingAESKey != "" || (config.Enabled && config.Mode != wechatPlain)) && len(wechatAESKey(config.EncodingAESKey)) == 0 {
		common.ApiErrorT(c, "Enter a valid 43-character EncodingAESKey")
		return
	}
	if config.Enabled && (config.OriginalID == "" || (config.Mode != wechatPlain && config.AppID == "")) {
		common.ApiErrorT(c, "Enter the WeChat original ID and the AppID required for encrypted mode")
		return
	}
	if len(config.AppID) > 64 || len(config.OriginalID) > 64 || config.GroupID < 0 || strings.ContainsRune(config.MessageTemplate, '\x00') {
		common.ApiErrorT(c, "Invalid request")
		return
	}
	if utf8.RuneCountInString(config.MessageTemplate) > 500 || len(config.MessageTemplate) > 1800 {
		common.ApiErrorT(c, "Message template cannot exceed 500 characters")
		return
	}
	if config.MessageTemplate != "" && !strings.Contains(config.MessageTemplate, "{{code}}") {
		common.ApiErrorT(c, "Message template must include {{placeholder}}", map[string]any{"placeholder": "{{code}}"})
		return
	}
	if config.Enabled {
		var group model.RedemptionGroup
		err := model.DB.Select("id").First(&group, "id = ?", config.GroupID).Error
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				common.ApiErrorT(c, "Select a redemption group")
			} else {
				common.ApiErrorT(c, "Could not load WeChat Official Account settings")
			}
			return
		}
	}
	raw, err := common.Marshal(config)
	if err != nil || model.UpdateOptionsBulk(map[string]string{wechatOfficialAccountOption: string(raw)}) != nil {
		common.ApiErrorT(c, "Could not save WeChat Official Account settings")
		return
	}
	recordManageAudit(c, "wechat_official_account.update", map[string]any{
		"enabled": config.Enabled, "mode": config.Mode, "group_id": config.GroupID, "custom_message": config.MessageTemplate != "",
	})
	GetWeChatOfficialAccountSettings(c)
}

type wechatPush struct {
	XMLName    xml.Name `xml:"xml"`
	To         string   `xml:"ToUserName"`
	From       string   `xml:"FromUserName"`
	CreatedAt  int64    `xml:"CreateTime"`
	Type       string   `xml:"MsgType"`
	Event      string   `xml:"Event"`
	Ciphertext string   `xml:"Encrypt"`
}

func HandleWeChatOfficialAccount(c *gin.Context) {
	config, err := loadWeChatOfficialAccountConfig()
	if err != nil || !config.Enabled || !wechatTokenPattern.MatchString(config.Token) {
		c.Status(http.StatusNotFound)
		return
	}
	query := c.Request.URL.Query()
	timestamp, nonce := query.Get("timestamp"), query.Get("nonce")
	now := time.Now().Unix()
	sent, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || sent < now-wechatWindow || sent > now+wechatWindow || len(nonce) == 0 || len(nonce) > 128 {
		c.Status(http.StatusForbidden)
		return
	}
	if c.Request.Method == http.MethodGet {
		echo := query.Get("echostr")
		if echo == "" || len(echo) > 1024 || !validWeChatSignature(query.Get("signature"), config.Token, timestamp, nonce) {
			c.Status(http.StatusForbidden)
			return
		}
		c.String(http.StatusOK, "%s", echo)
		return
	}
	if config.Mode == wechatPlain && !validWeChatSignature(query.Get("signature"), config.Token, timestamp, nonce) {
		c.Status(http.StatusForbidden)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10))
	var message wechatPush
	if err != nil || xml.Unmarshal(body, &message) != nil {
		c.Status(http.StatusBadRequest)
		return
	}
	var key []byte
	switch config.Mode {
	case wechatSafe, wechatCompatible:
		key = wechatAESKey(config.EncodingAESKey)
		if len(key) == 0 || message.Ciphertext == "" || config.AppID == "" ||
			!validWeChatSignature(query.Get("msg_signature"), config.Token, timestamp, nonce, message.Ciphertext) {
			c.Status(http.StatusForbidden)
			return
		}
		decoded, err := decryptWeChatMessage(key, message.Ciphertext, config.AppID)
		message = wechatPush{}
		if err != nil || xml.Unmarshal(decoded, &message) != nil {
			c.Status(http.StatusBadRequest)
			return
		}
	case wechatPlain:
		if message.Ciphertext != "" || query.Get("encrypt_type") != "" || query.Get("msg_signature") != "" {
			c.Status(http.StatusForbidden)
			return
		}
	default:
		c.Status(http.StatusForbidden)
		return
	}
	if message.To == "" || message.To != config.OriginalID {
		c.Status(http.StatusForbidden)
		return
	}
	if message.Type != "event" || message.Event != "subscribe" {
		c.String(http.StatusOK, "success")
		return
	}
	if message.From == "" || len(message.From) > 128 || strings.ContainsRune(message.From, '\x00') ||
		message.CreatedAt < now-wechatWindow || message.CreatedAt > now+wechatWindow {
		c.Status(http.StatusForbidden)
		return
	}
	event := sha256.Sum256([]byte(message.To + "\x00" + message.From + "\x00" + strconv.FormatInt(message.CreatedAt, 10)))
	code, err := model.IssueWeChatRedemption(c.Request.Context(), config.GroupID, hex.EncodeToString(event[:]), message.From, message.To)
	if err != nil {
		// Never log the callback signature, subscriber identifiers or redemption key.
		c.Status(http.StatusServiceUnavailable)
		return
	}
	var content string
	if code != "" && config.MessageTemplate != "" {
		content = strings.ReplaceAll(config.MessageTemplate, "{{code}}", code)
	} else {
		language := i18n.StatedLang(c)
		if language == "" && common.DefaultLanguage == "" {
			language = i18n.LangZhCN
		}
		if code != "" {
			content = i18n.Translate(language, i18n.MsgWeChatRedemptionIssued, map[string]any{"Code": code})
		} else {
			content = i18n.Translate(language, i18n.MsgWeChatRedemptionUnavailable)
		}
	}
	reply, err := xml.Marshal(struct {
		XMLName   xml.Name `xml:"xml"`
		To        string   `xml:"ToUserName"`
		From      string   `xml:"FromUserName"`
		CreatedAt int64    `xml:"CreateTime"`
		Type      string   `xml:"MsgType"`
		Content   string   `xml:"Content"`
	}{To: message.From, From: message.To, CreatedAt: now, Type: "text", Content: content})
	if err == nil && len(key) != 0 {
		reply, err = encryptWeChatReply(key, reply, config.AppID, config.Token, now)
	}
	if err != nil {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	c.Data(http.StatusOK, "application/xml; charset=utf-8", reply)
}

func wechatSignature(parts ...string) string {
	slices.Sort(parts)
	// SHA-1 is part of the WeChat Official Account callback protocol.
	digest := sha1.Sum([]byte(strings.Join(parts, "")))
	return hex.EncodeToString(digest[:])
}

func validWeChatSignature(signature string, parts ...string) bool {
	return subtle.ConstantTimeCompare([]byte(signature), []byte(wechatSignature(parts...))) == 1
}

func wechatAESKey(encoded string) []byte {
	if !wechatAESPattern.MatchString(encoded) {
		return nil
	}
	key, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil || len(key) != 32 {
		return nil
	}
	return key
}

func GetWeChatRedemptionClaims(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	keyword := strings.TrimSpace(c.Query("keyword"))
	var groupID *int
	if raw, ok := c.GetQuery("group_id"); ok && raw != "" {
		id, err := strconv.Atoi(raw)
		if err != nil || id < 0 {
			common.ApiErrorT(c, "Invalid request")
			return
		}
		groupID = &id
	}
	claims, total, err := model.ListWeChatRedemptionClaims(c.Request.Context(), keyword, groupID, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiErrorT(c, "Could not load WeChat redemption claims")
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(claims)
	common.ApiSuccess(c, pageInfo)
}

func DeleteWeChatRedemptionClaim(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid request")
		return
	}
	if err := model.DeleteWeChatRedemptionClaim(c.Request.Context(), id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			common.ApiErrorT(c, "Claim record not found")
		} else {
			common.ApiErrorT(c, "Could not delete WeChat redemption claim")
		}
		return
	}
	recordManageAudit(c, "wechat_official_account.claim_delete", map[string]any{"id": id})
	common.ApiSuccess(c, nil)
}
