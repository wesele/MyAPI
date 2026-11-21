package controller

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

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

func TestSubscriptionInterestYuanDatabaseMatrix(t *testing.T) {
	dialects := []struct {
		name string
		env  string
		open func(string) gorm.Dialector
	}{
		{"sqlite", "", sqlite.Open},
		{"mysql", "TEST_MYSQL_DSN", mysql.Open},
		{"postgres", "TEST_POSTGRES_DSN", postgres.Open},
	}
	for _, dialect := range dialects {
		t.Run(dialect.name, func(t *testing.T) {
			dsn := ":memory:"
			if dialect.env != "" {
				dsn = os.Getenv(dialect.env)
				if dsn == "" {
					t.Skipf("%s is not configured", dialect.env)
				}
			}
			db, err := gorm.Open(dialect.open(dsn), &gorm.Config{
				NamingStrategy: schema.NamingStrategy{TablePrefix: "opencode_yuan_test_"},
			})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			t.Cleanup(func() { assert.NoError(t, sqlDB.Close()) })
			require.False(t, db.Migrator().HasTable(&model.SubscriptionInterest{}))
			require.NoError(t, db.AutoMigrate(&model.SubscriptionInterest{}))
			t.Cleanup(func() { assert.NoError(t, db.Migrator().DropTable(&model.SubscriptionInterest{})) })
			originalDB := model.DB
			model.DB = db
			t.Cleanup(func() { model.DB = originalDB })
			var version string
			versionQuery := "SELECT version()"
			if dialect.name == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("database version: %s", version)

			const voter = "AAAAAAAAAAAAAAAAAAAAAAAAAA"
			old := model.SubscriptionInterest{VoterHash: fmt.Sprintf("%x", sha256.Sum256([]byte(voter))), Amount: 5}
			require.NoError(t, db.Create(&old).Error)
			router := gin.New()
			router.GET("/survey", GetSubscriptionInterest)
			router.PUT("/survey", SaveSubscriptionInterest)
			router.GET("/results", GetSubscriptionInterestSummary)

			request := func(method, path, body string) *httptest.ResponseRecorder {
				recorder := httptest.NewRecorder()
				req := httptest.NewRequest(method, path, strings.NewReader(body))
				req.Header.Set("Content-Type", "application/json")
				req.AddCookie(&http.Cookie{Name: subscriptionVoterCookie, Value: voter})
				router.ServeHTTP(recorder, req)
				return recorder
			}
			assert.JSONEq(t, `{"amount":0}`, request("GET", "/survey", "").Body.String())
			assert.Equal(t, http.StatusBadRequest, request("PUT", "/survey", `{"amount":5}`).Code)
			assert.JSONEq(t, `{"amount":10}`, request("PUT", "/survey", `{"amount":10}`).Body.String())
			assert.JSONEq(t, `{"amount":20}`, request("PUT", "/survey", `{"amount":20}`).Body.String())
			assert.JSONEq(t, `{"amount":50}`, request("PUT", "/survey", `{"amount":50}`).Body.String())
			assert.JSONEq(t, `{"amount":50}`, request("GET", "/survey", "").Body.String())
			assert.JSONEq(t, `{"success":true,"data":[{"amount":50,"count":1}]}`, request("GET", "/results", "").Body.String())
			savedOldVote, err := model.GetSubscriptionInterest(old.VoterHash)
			require.NoError(t, err)
			assert.Equal(t, 5, savedOldVote.Amount)
		})
	}
}
