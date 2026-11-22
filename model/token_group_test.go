package model

import (
	"fmt"
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

// Pre-group token table schema before group_id was added.
type releasedToken struct {
	Id                  int    `gorm:"primaryKey"`
	UserId              int    `gorm:"index"`
	Key                 string `gorm:"column:key;type:varchar(128);uniqueIndex"`
	Status              int    `gorm:"default:1"`
	Name                string `gorm:"index"`
	CreatedTime         int64  `gorm:"bigint"`
	AccessedTime        int64  `gorm:"bigint"`
	ExpiredTime         int64  `gorm:"bigint;default:-1"`
	RemainQuota         int    `gorm:"default:0"`
	UnlimitedQuota      bool
	ModelLimitsEnabled  bool
	ModelLimits         string  `gorm:"type:text"`
	AllowIps            *string `gorm:"default:''"`
	UsedQuota           int     `gorm:"default:0"`
	Group               string  `gorm:"column:group;default:''"`
	CrossGroupRetry     bool
	AutoGroups          string         `gorm:"type:text"`
	DeletedAt           gorm.DeletedAt `gorm:"index"`
	AllowUserQuotaQuery bool
}

func (releasedToken) TableName() string { return "tokens" }

type releasedTokenGroup struct {
	Id     int    `gorm:"primaryKey"`
	UserId int    `gorm:"not null;index"`
	Name   string `gorm:"size:64;not null"`
}

func (releasedTokenGroup) TableName() string { return "token_groups" }

func TestTokenGroupsDatabaseMatrix(t *testing.T) {
	dialects := []struct {
		kind   common.DatabaseType
		dsnEnv string
		open   func(string) gorm.Dialector
	}{
		{common.DatabaseTypeSQLite, "", sqlite.Open},
		{common.DatabaseTypeMySQL, "TEST_MYSQL_DSN", mysql.Open},
		{common.DatabaseTypePostgreSQL, "TEST_POSTGRES_DSN", postgres.Open},
	}
	for _, dialect := range dialects {
		t.Run(string(dialect.kind), func(t *testing.T) {
			dsn := ":memory:"
			if dialect.dsnEnv != "" {
				dsn = os.Getenv(dialect.dsnEnv)
				if dsn == "" {
					t.Skipf("%s is not configured", dialect.dsnEnv)
				}
			}
			for _, upgrade := range []bool{false, true} {
				t.Run(fmt.Sprintf("upgrade=%v", upgrade), func(t *testing.T) {
					checkTokenGroupMigration(t, dialect.open(dsn), dialect.kind, upgrade)
				})
			}
		})
	}
}

func checkTokenGroupMigration(t *testing.T, driver gorm.Dialector, kind common.DatabaseType, upgrade bool) {
	t.Helper()
	db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "token_group_test_"}})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	previousDB, previousType := DB, common.MainDatabaseType()
	DB = db
	common.SetMainDatabaseType(kind)
	initCol()
	t.Cleanup(func() {
		assert.NoError(t, db.Migrator().DropTable(&Token{}, &TokenGroup{}))
		assert.NoError(t, sqlDB.Close())
		DB = previousDB
		common.SetMainDatabaseType(previousType)
		initCol()
	})
	versionSQL := "SELECT version()"
	if kind == common.DatabaseTypeSQLite {
		versionSQL = "SELECT sqlite_version()"
	}
	var version string
	require.NoError(t, db.Raw(versionSQL).Scan(&version).Error)
	t.Logf("database version: %s", version)

	const ownerID = 101
	const otherID = 202
	const legacyKey = "legacy-token-key-0001"
	if upgrade {
		require.NoError(t, db.Table("token_group_test_tokens").AutoMigrate(&releasedToken{}))
		require.NoError(t, db.Table("token_group_test_token_groups").AutoMigrate(&releasedTokenGroup{}))
		require.NoError(t, db.Table("token_group_test_tokens").Create(&releasedToken{
			UserId: ownerID, Name: "legacy-token", Key: legacyKey, Status: common.TokenStatusEnabled,
			ExpiredTime: -1, RemainQuota: 500,
		}).Error)
	}
	for range 2 {
		require.NoError(t, db.AutoMigrate(&Token{}, &TokenGroup{}))
	}
	for _, column := range []string{"group_id", "name", "deleted_at"} {
		index := db.NamingStrategy.IndexName("token_group_test_tokens", column)
		assert.True(t, db.Migrator().HasIndex(&Token{}, index), index)
	}

	group, err := CreateTokenGroup(ownerID, "Production", 2)
	require.NoError(t, err)
	assert.Equal(t, 2, group.ConcurrencyLimit)
	newLimit := 4
	updatedGroup, err := UpdateTokenGroup(ownerID, group.Id, "Production EU", &newLimit)
	require.NoError(t, err)
	assert.Equal(t, 4, updatedGroup.ConcurrencyLimit)
	otherGroup, err := CreateTokenGroup(otherID, "Other User Group", 0)
	require.NoError(t, err)

	ownerGroups, err := ListTokenGroups(ownerID)
	require.NoError(t, err)
	require.Equal(t, []TokenGroup{{Id: group.Id, UserId: ownerID, Name: "Production EU", ConcurrencyLimit: 4}}, ownerGroups)

	loadedLimit, err := GetTokenGroupConcurrencyLimit(group.Id)
	require.NoError(t, err)
	assert.Equal(t, 4, loadedLimit)

	// Cross-user isolation on update, delete, move, list keys, disable.
	_, err = UpdateTokenGroup(otherID, group.Id, "Hijack", nil)
	assert.Error(t, err)
	assert.Error(t, DeleteTokenGroup(otherID, group.Id))
	_, err = ListUsableTokenGroupKeys(otherID, group.Id)
	assert.Error(t, err)
	_, err = DisableTokensInGroup(otherID, group.Id)
	assert.Error(t, err)

	activeKey := "token-group-usable-1"
	unlimitedKey := "token-group-unlimited-2"
	tokens := []*Token{
		{Name: "proj-active", Key: activeKey, Status: common.TokenStatusEnabled, ExpiredTime: -1, RemainQuota: 100},
		{Name: "proj-unlimited", Key: unlimitedKey, Status: common.TokenStatusEnabled, ExpiredTime: common.GetTimestamp() + 3600, UnlimitedQuota: true},
		{Name: "proj-disabled", Key: "token-group-disabled-3", Status: common.TokenStatusDisabled, ExpiredTime: -1, RemainQuota: 100},
		{Name: "proj-expired", Key: "token-group-expired-4", Status: common.TokenStatusEnabled, ExpiredTime: common.GetTimestamp() - 60, RemainQuota: 100},
		{Name: "proj-exhausted", Key: "token-group-exhausted-5", Status: common.TokenStatusEnabled, ExpiredTime: -1, RemainQuota: 0, UnlimitedQuota: false},
	}
	for _, tk := range tokens {
		require.NoError(t, CreateGroupedToken(ownerID, group.Id, tk))
	}
	// Cannot create a token inside another user's group.
	assert.Error(t, CreateGroupedToken(ownerID, otherGroup.Id, &Token{Name: "bad", Key: "token-bad-owner"}))

	keys, err := ListUsableTokenGroupKeys(ownerID, group.Id)
	require.NoError(t, err)
	assert.Equal(t, []string{activeKey, unlimitedKey}, keys)

	ungrouped := 0
	if upgrade {
		rows, total, err := SearchUserTokensInGroup(ownerID, "", "", &ungrouped, 0, 10)
		require.NoError(t, err)
		require.EqualValues(t, 1, total)
		assert.Equal(t, legacyKey, rows[0].Key)
	}

	rows, total, err := SearchUserTokensInGroup(ownerID, "proj%", "", &group.Id, 0, 10)
	require.NoError(t, err)
	require.EqualValues(t, 5, total)
	require.Len(t, rows, 5)

	// Move one active key to Ungrouped and verify cross-user MoveTokensToGroup cannot touch ownerID's token.
	require.NoError(t, MoveTokensToGroup(otherID, []int{tokens[0].Id}, otherGroup.Id))
	reloaded, err := GetTokenByIds(tokens[0].Id, ownerID)
	require.NoError(t, err)
	assert.Equal(t, group.Id, reloaded.GroupId)

	require.NoError(t, MoveTokensToGroup(ownerID, []int{tokens[0].Id}, ungrouped))
	reloaded, err = GetTokenByIds(tokens[0].Id, ownerID)
	require.NoError(t, err)
	assert.Equal(t, 0, reloaded.GroupId)

	// Soft-deleted token in group stays untouched when disabling enabled tokens.
	deleted := &Token{UserId: ownerID, Name: "deleted-in-group", Key: "token-group-deleted-6", Status: common.TokenStatusEnabled, ExpiredTime: -1, UnlimitedQuota: true}
	require.NoError(t, CreateGroupedToken(ownerID, group.Id, deleted))
	require.NoError(t, deleted.Delete())

	otherUserToken := &Token{Name: "other-user-token", Key: "token-other-user-7", Status: common.TokenStatusEnabled, ExpiredTime: -1, UnlimitedQuota: true}
	require.NoError(t, CreateGroupedToken(otherID, otherGroup.Id, otherUserToken))

	disabledCount, err := DisableTokensInGroup(ownerID, group.Id)
	require.NoError(t, err)
	// tokens[1] (unlimited), tokens[3] (expired timestamp with status=1), tokens[4] (exhausted with status=1) all had Status=Enabled.
	assert.EqualValues(t, 3, disabledCount)

	var deletedRow Token
	require.NoError(t, db.Unscoped().First(&deletedRow, deleted.Id).Error)
	assert.Equal(t, common.TokenStatusEnabled, deletedRow.Status)

	otherReloaded, err := GetTokenByIds(otherUserToken.Id, otherID)
	require.NoError(t, err)
	assert.Equal(t, common.TokenStatusEnabled, otherReloaded.Status)

	// Deleting the group resets all of its tokens (including soft-deleted) to group_id = 0 without deleting tokens.
	require.NoError(t, DeleteTokenGroup(ownerID, group.Id))
	assert.Error(t, MoveTokensToGroup(ownerID, []int{tokens[0].Id}, group.Id))
	assert.Error(t, CreateGroupedToken(ownerID, group.Id, &Token{Name: "gone", Key: "token-group-gone-8"}))

	require.NoError(t, db.Unscoped().First(&deletedRow, deleted.Id).Error)
	assert.Equal(t, 0, deletedRow.GroupId)

	_, total, err = SearchUserTokensInGroup(ownerID, "proj%", "", &ungrouped, 0, 10)
	require.NoError(t, err)
	assert.EqualValues(t, 5, total, "deleting a group preserves all its tokens")
}

func TestTokenGroupConcurrencyCacheInvalidation(t *testing.T) {
	truncateTables(t)
	useUserCacheMiniRedis(t)

	group, err := CreateTokenGroup(101, "CachedGroup", 2)
	require.NoError(t, err)

	token := &Token{
		Name:           "cached-grouped-token",
		Key:            "cached-grouped-token-key",
		Status:         common.TokenStatusEnabled,
		ExpiredTime:    -1,
		UnlimitedQuota: true,
	}
	require.NoError(t, CreateGroupedToken(101, group.Id, token))

	cachedTok, err := GetTokenByKey(token.Key, false)
	require.NoError(t, err)
	assert.Equal(t, group.Id, cachedTok.GroupId)

	limit, err := GetTokenGroupConcurrencyLimit(group.Id)
	require.NoError(t, err)
	assert.Equal(t, 2, limit)

	updatedLimit := 5
	_, err = UpdateTokenGroup(101, group.Id, "CachedGroup", &updatedLimit)
	require.NoError(t, err)
	limit, err = GetTokenGroupConcurrencyLimit(group.Id)
	require.NoError(t, err)
	assert.Equal(t, 5, limit)

	require.NoError(t, MoveTokensToGroup(101, []int{token.Id}, 0))
	_, cacheErr := cacheGetTokenByKey(token.Key)
	require.Error(t, cacheErr, "moving token out of group must invalidate cached GroupId")

	reloadedTok, err := GetTokenByKey(token.Key, false)
	require.NoError(t, err)
	assert.Equal(t, 0, reloadedTok.GroupId)

	require.NoError(t, MoveTokensToGroup(101, []int{token.Id}, group.Id))
	require.NoError(t, DeleteTokenGroup(101, group.Id))
	_, cacheErr = cacheGetTokenByKey(token.Key)
	require.Error(t, cacheErr, "deleting group must invalidate cached member tokens")

	limit, err = GetTokenGroupConcurrencyLimit(group.Id)
	require.NoError(t, err)
	assert.Equal(t, 0, limit)
}
