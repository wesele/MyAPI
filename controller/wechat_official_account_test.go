package controller

import (
	"encoding/xml"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestWeChatOfficialAccountMatrix(t *testing.T) {
	require.NoError(t, i18n.Init())
	previousLanguage := common.DefaultLanguage
	common.DefaultLanguage = i18n.LangZhCN
	t.Cleanup(func() { common.DefaultLanguage = previousLanguage })
	for _, database := range []struct {
		kind common.DatabaseType
		env  string
		open func(string) gorm.Dialector
	}{
		{common.DatabaseTypeSQLite, "", sqlite.Open},
		{common.DatabaseTypeMySQL, "TEST_MYSQL_DSN", mysql.Open},
		{common.DatabaseTypePostgreSQL, "TEST_POSTGRES_DSN", postgres.Open},
	} {
		t.Run(string(database.kind), func(t *testing.T) {
			dsn := filepath.Join(t.TempDir(), "wechat.db") + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_txlock=immediate"
			if database.env != "" {
				dsn = os.Getenv(database.env)
				if dsn == "" {
					t.Skipf("%s is not configured", database.env)
				}
			}
			db, err := gorm.Open(database.open(dsn), &gorm.Config{
				NamingStrategy: schema.NamingStrategy{TablePrefix: "wechat_callback_test_"},
			})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			auditDB, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "audit.db")), &gorm.Config{})
			require.NoError(t, err)
			auditSQL, err := auditDB.DB()
			require.NoError(t, err)
			previousDB, previousLogDB := model.DB, model.LOG_DB
			previousType, previousLogType := common.MainDatabaseType(), common.LogDatabaseType()
			previousOptions, previousRedis := common.OptionMap, common.RedisEnabled
			model.DB, model.LOG_DB = db, auditDB
			common.OptionMap, common.RedisEnabled = make(map[string]string), false
			common.SetDatabaseTypes(database.kind, common.DatabaseTypeSQLite)
			tables := []any{&model.Redemption{}, &model.RedemptionGroup{}, &model.WeChatRedemptionDelivery{}, &model.Option{}, &model.SystemTask{}, &model.User{}}
			t.Cleanup(func() {
				assert.NoError(t, db.Migrator().DropTable(tables...))
				assert.NoError(t, sqlDB.Close())
				assert.NoError(t, auditSQL.Close())
				model.DB, model.LOG_DB = previousDB, previousLogDB
				common.OptionMap, common.RedisEnabled = previousOptions, previousRedis
				common.SetDatabaseTypes(previousType, previousLogType)
			})
			versionQuery := "SELECT version()"
			if database.kind == common.DatabaseTypeSQLite {
				versionQuery = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("database version: %s", version)
			require.NoError(t, db.AutoMigrate(&model.Redemption{}, &model.RedemptionGroup{}))
			group, err := model.CreateRedemptionGroup("Official Account")
			require.NoError(t, err)
			now := time.Now().Unix()
			key := func(id int) string { return fmt.Sprintf("wechat-fixture-%017d", id) }
			codes := []model.Redemption{
				{Key: key(1), GroupId: group.Id, Status: common.RedemptionCodeStatusDisabled, ExpiredTime: now - 1},
				{Key: key(2), GroupId: 0, Status: common.RedemptionCodeStatusDisabled},
				{Key: key(3), GroupId: group.Id, Status: common.RedemptionCodeStatusEnabled},
				{Key: key(4), GroupId: group.Id, Status: common.RedemptionCodeStatusDisabled},
				{Key: key(5), GroupId: group.Id, Status: common.RedemptionCodeStatusDisabled},
				{Key: key(6), GroupId: group.Id, Status: common.RedemptionCodeStatusDisabled},
			}
			require.NoError(t, db.Create(&codes).Error)
			for range 2 {
				require.NoError(t, db.AutoMigrate(tables...))
			}
			require.NoError(t, auditDB.AutoMigrate(&model.AuditLog{}))
			var originalGroup model.RedemptionGroup
			require.NoError(t, db.First(&originalGroup, group.Id).Error)
			assert.Equal(t, group, originalGroup)
			require.True(t, db.Migrator().HasIndex(&model.WeChatRedemptionDelivery{}, "RedemptionID"))
			admin := model.User{Username: "wechat-test", Role: common.RoleAdminUser, Status: common.UserStatusEnabled}
			require.NoError(t, db.Create(&admin).Error)

			engine := gin.New()
			engine.GET("/wechat", HandleWeChatOfficialAccount)
			engine.POST("/wechat", HandleWeChatOfficialAccount)
			engine.GET("/settings", GetWeChatOfficialAccountSettings)
			engine.PUT("/settings", func(c *gin.Context) {
				c.Set("id", admin.Id)
				c.Set("role", admin.Role)
			}, UpdateWeChatOfficialAccountSettings)
			request := func(method, target, body string) *httptest.ResponseRecorder {
				response := httptest.NewRecorder()
				engine.ServeHTTP(response, httptest.NewRequest(method, target, strings.NewReader(body)))
				return response
			}
			assert.Equal(t, http.StatusNotFound, request(http.MethodGet, "/wechat", "").Code)
			const token, appID, originalID = "FixtureToken0123456789", "wxFixtureAppID", "gh_fixture"
			const encodingKey = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ"
			configure := func(mode, credentials string) *httptest.ResponseRecorder {
				return request(http.MethodPut, "/settings", fmt.Sprintf(`{"enabled":true,"group_id":%d,"mode":%q,"app_id":%q,"original_id":%q%s}`, group.Id, mode, appID, originalID, credentials))
			}
			invalid := configure(wechatSafe, `,"token":"invalid token"`)
			assert.Contains(t, invalid.Body.String(), `"success":false`)
			credentials := fmt.Sprintf(`,"token":%q,"encoding_aes_key":%q`, token, encodingKey)
			saved := configure(wechatPlain, credentials)
			require.Contains(t, saved.Body.String(), `"success":true`)
			settings := request(http.MethodGet, "/settings", "").Body.String()
			assert.Contains(t, settings, `"token_configured":true`)
			assert.NotContains(t, settings, `"url":`)
			assert.NotContains(t, settings, token)
			assert.NotContains(t, settings, encodingKey)
			assert.NotContains(t, saved.Body.String(), token)
			assert.NotContains(t, saved.Body.String(), encodingKey)
			var audit model.AuditLog
			require.NoError(t, auditDB.Where("action = ?", "wechat_official_account.update").First(&audit).Error)
			auditJSON, err := common.Marshal(audit)
			require.NoError(t, err)
			assert.NotContains(t, string(auditJSON), token)
			assert.NotContains(t, string(auditJSON), encodingKey)

			timestamp := strconv.FormatInt(now, 10)
			plainURL := func(timeText, nonce string) string {
				return "/wechat?" + (url.Values{"signature": {wechatSignature(token, timeText, nonce)}, "timestamp": {timeText}, "nonce": {nonce}}).Encode()
			}
			echo := request(http.MethodGet, plainURL(timestamp, "challenge")+"&echostr=verified", "")
			assert.Equal(t, http.StatusOK, echo.Code)
			assert.Equal(t, "verified", echo.Body.String())
			message := func(user, event, recipient string) string {
				return fmt.Sprintf("<xml><ToUserName>%s</ToUserName><FromUserName>%s</FromUserName><CreateTime>%d</CreateTime><MsgType>event</MsgType><Event>%s</Event></xml>", recipient, user, now, event)
			}
			payload := message("subscriber-a", "subscribe", originalID)
			assert.Equal(t, http.StatusForbidden, request(http.MethodPost, "/wechat?timestamp="+timestamp+"&nonce=bad", payload).Code)
			stale := plainURL(strconv.FormatInt(now-wechatWindow-1, 10), "stale")
			assert.Equal(t, http.StatusForbidden, request(http.MethodPost, stale, payload).Code)
			assert.Equal(t, http.StatusForbidden, request(http.MethodPost, plainURL(timestamp, "wrong-recipient"), message("x", "subscribe", "gh_other")).Code)
			assert.Equal(t, "success", request(http.MethodPost, plainURL(timestamp, "unfollow"), message("x", "unsubscribe", originalID)).Body.String())
			requestA := plainURL(timestamp, "follow-a")
			first := request(http.MethodPost, requestA, payload)
			require.Equal(t, http.StatusOK, first.Code)
			assert.Contains(t, first.Body.String(), key(4))
			assert.Equal(t, "application/xml; charset=utf-8", first.Header().Get("Content-Type"))
			assert.Contains(t, request(http.MethodPost, plainURL(timestamp, "retry-a"), payload).Body.String(), key(4))
			// A group bulk-disable must not put a previously distributed key back into stock.
			require.NoError(t, db.Model(&codes[3]).Update("status", common.RedemptionCodeStatusDisabled).Error)

			saved = configure(wechatCompatible, `,"url":"http://legacy.example.com/wechat"`)
			require.Contains(t, saved.Body.String(), `"success":true`)
			assert.Equal(t, http.StatusForbidden, request(http.MethodPost, requestA, payload).Code)
			aesKey := wechatAESKey(encodingKey)
			encryptedRequest := func(t *testing.T, user, receiver string) (string, string) {
				t.Helper()
				body, err := encryptWeChatReply(aesKey, []byte(message(user, "subscribe", originalID)), receiver, token, now)
				require.NoError(t, err)
				var push struct {
					Ciphertext string `xml:"Encrypt"`
					Signature  string `xml:"MsgSignature"`
					Nonce      string `xml:"Nonce"`
				}
				require.NoError(t, xml.Unmarshal(body, &push))
				query := url.Values{"msg_signature": {push.Signature}, "timestamp": {timestamp}, "nonce": {push.Nonce}, "encrypt_type": {"aes"}}
				return "/wechat?" + query.Encode(), "<xml><MsgType>text</MsgType><Encrypt>" + push.Ciphertext + "</Encrypt></xml>"
			}
			wrongAppURL, wrongAppBody := encryptedRequest(t, "subscriber-b", "wrong-app")
			assert.Equal(t, http.StatusBadRequest, request(http.MethodPost, wrongAppURL, wrongAppBody).Code)
			bURL, bBody := encryptedRequest(t, "subscriber-b", appID)
			cURL, cBody := encryptedRequest(t, "subscriber-c", appID)
			var replies [3]*httptest.ResponseRecorder
			var concurrent sync.WaitGroup
			for i, event := range [][2]string{{bURL, bBody}, {bURL, bBody}, {cURL, cBody}} {
				concurrent.Go(func() { replies[i] = request(http.MethodPost, event[0], event[1]) })
			}
			concurrent.Wait()
			var contents [3]string
			for i, reply := range replies {
				require.Equal(t, http.StatusOK, reply.Code, reply.Body.String())
				assert.NotContains(t, reply.Body.String(), "wechat-fixture-")
				var envelope struct {
					Encrypted string `xml:"Encrypt"`
					Signature string `xml:"MsgSignature"`
					Timestamp string `xml:"TimeStamp"`
					Nonce     string `xml:"Nonce"`
				}
				require.NoError(t, xml.Unmarshal(reply.Body.Bytes(), &envelope))
				assert.True(t, validWeChatSignature(envelope.Signature, token, envelope.Timestamp, envelope.Nonce, envelope.Encrypted))
				decoded, err := decryptWeChatMessage(aesKey, envelope.Encrypted, appID)
				require.NoError(t, err)
				var text struct{ Content string }
				require.NoError(t, xml.Unmarshal(decoded, &text))
				contents[i] = strings.TrimPrefix(text.Content, "感谢关注！你的兑换码：")
			}
			assert.Equal(t, contents[0], contents[1])
			assert.ElementsMatch(t, []string{key(5), key(6)}, []string{contents[0], contents[2]})

			require.Contains(t, configure(wechatSafe, "").Body.String(), `"success":true`)
			emptyURL, emptyBody := encryptedRequest(t, "subscriber-d", appID)
			assert.Equal(t, http.StatusOK, request(http.MethodPost, emptyURL, emptyBody).Code)
			var deliveries int64
			require.NoError(t, db.Model(&model.WeChatRedemptionDelivery{}).Count(&deliveries).Error)
			assert.EqualValues(t, 3, deliveries)
			var statuses []int
			require.NoError(t, db.Model(&model.Redemption{}).Order("id").Pluck("status", &statuses).Error)
			assert.Equal(t, []int{2, 2, 1, 2, 1, 1}, statuses)
		})
	}
}
