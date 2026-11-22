package model

import (
	"fmt"
	"os"
	"sync"
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

// The redemption table schema shipped in v1.0.0-rc.51, before group membership.
type releasedRedemption struct {
	Id           int
	UserId       int
	Key          string `gorm:"type:char(32);uniqueIndex"`
	Status       int    `gorm:"default:1"`
	Name         string `gorm:"index"`
	Quota        int    `gorm:"default:100"`
	CreatedTime  int64  `gorm:"bigint"`
	RedeemedTime int64  `gorm:"bigint"`
	UsedUserId   int
	DeletedAt    gorm.DeletedAt `gorm:"index"`
	ExpiredTime  int64          `gorm:"bigint"`
}

func (releasedRedemption) TableName() string { return "redemptions" }

func TestRedemptionGroupsDatabaseMatrix(t *testing.T) {
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
					checkRedemptionGroupMigration(t, dialect.open(dsn), dialect.kind, upgrade)
				})
			}
		})
	}
}

func checkRedemptionGroupMigration(t *testing.T, driver gorm.Dialector, kind common.DatabaseType, upgrade bool) {
	t.Helper()
	db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "redeem_group_test_"}})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	previousDB, previousType := DB, common.MainDatabaseType()
	DB = db
	common.SetMainDatabaseType(kind)
	t.Cleanup(func() {
		assert.NoError(t, db.Migrator().DropTable(&Redemption{}, &RedemptionGroup{}))
		assert.NoError(t, sqlDB.Close())
		DB = previousDB
		common.SetMainDatabaseType(previousType)
	})
	versionSQL := "SELECT version()"
	if kind == common.DatabaseTypeSQLite {
		versionSQL = "SELECT sqlite_version()"
	}
	var version string
	require.NoError(t, db.Raw(versionSQL).Scan(&version).Error)
	t.Logf("database version: %s", version)

	const legacyKey = "00000000000000000000000000001101"
	if upgrade {
		require.NoError(t, db.Table("redeem_group_test_redemptions").AutoMigrate(&releasedRedemption{}))
		require.NoError(t, db.Table("redeem_group_test_redemptions").Create(&releasedRedemption{
			Name: "legacy-code", Key: legacyKey, Quota: 500,
		}).Error)
	}
	for range 2 {
		require.NoError(t, db.AutoMigrate(&Redemption{}, &RedemptionGroup{}))
	}
	for _, column := range []string{"group_id", "name", "deleted_at"} {
		index := db.NamingStrategy.IndexName("redeem_group_test_redemptions", column)
		assert.True(t, db.Migrator().HasIndex(&Redemption{}, index), index)
	}

	const usableKey = "00000000000000000000000000001102"
	group, err := CreateRedemptionGroup("Conference")
	require.NoError(t, err)
	require.NoError(t, RenameRedemptionGroup(group.Id, "November Conference"))
	groups, err := ListRedemptionGroups()
	require.NoError(t, err)
	require.Equal(t, []RedemptionGroup{{Id: group.Id, Name: "November Conference"}}, groups)
	codes := []Redemption{
		{Name: "conference-active", Key: usableKey, Quota: 100},
		{Name: "conference-used", Key: "00000000000000000000000000001103", Quota: 100, Status: common.RedemptionCodeStatusUsed},
		{Name: "conference-disabled", Key: "00000000000000000000000000001104", Quota: 100, Status: common.RedemptionCodeStatusDisabled},
		{Name: "conference-expired", Key: "00000000000000000000000000001105", Quota: 100, ExpiredTime: common.GetTimestamp() - 60},
	}
	require.NoError(t, CreateGroupedRedemptions(group.Id, codes))
	require.Error(t, db.Create(&Redemption{Key: usableKey}).Error, "unique code constraint")
	keys, err := ListUsableRedemptionGroupKeys(group.Id)
	require.NoError(t, err)
	assert.Equal(t, []string{usableKey}, keys)

	ungrouped := 0
	if upgrade {
		rows, total, err := SearchRedemptionsInGroup("", "", &ungrouped, 0, 1)
		require.NoError(t, err)
		require.EqualValues(t, 1, total)
		assert.Equal(t, legacyKey, rows[0].Key)
		assert.Equal(t, 500, rows[0].Quota)
		_, total, err = SearchRedemptionsInGroup(fmt.Sprint(rows[0].Id), "", &group.Id, 0, 10)
		require.NoError(t, err)
		assert.Zero(t, total, "numeric search stays within the selected group")
	}
	rows, total, err := SearchRedemptionsInGroup("conference", "1", &group.Id, 0, 1)
	require.NoError(t, err)
	require.EqualValues(t, 1, total)
	require.Len(t, rows, 1)
	assert.Equal(t, usableKey, rows[0].Key)

	require.NoError(t, MoveRedemptionsToGroup([]int{rows[0].Id}, ungrouped))
	t.Run("disabling a group only affects its enabled codes", func(t *testing.T) {
		other, err := CreateRedemptionGroup("Other event")
		require.NoError(t, err)
		otherCodes := []Redemption{{Key: "00000000000000000000000000001108", Quota: 100}}
		require.NoError(t, CreateGroupedRedemptions(other.Id, otherCodes))
		deleted := Redemption{Key: "00000000000000000000000000001107", Quota: 100}
		require.NoError(t, deleted.Insert())
		require.NoError(t, MoveRedemptionsToGroup([]int{deleted.Id}, group.Id))
		require.NoError(t, deleted.Delete())
		count, err := DisableRedemptionsInGroup(group.Id)
		require.NoError(t, err)
		assert.EqualValues(t, 1, count)
		for index, status := range []int{
			common.RedemptionCodeStatusEnabled,
			common.RedemptionCodeStatusUsed,
			common.RedemptionCodeStatusDisabled,
			common.RedemptionCodeStatusDisabled,
		} {
			code, err := GetRedemptionById(codes[index].Id)
			require.NoError(t, err)
			assert.Equal(t, status, code.Status)
		}
		var deletedCode Redemption
		require.NoError(t, db.Unscoped().First(&deletedCode, deleted.Id).Error)
		assert.Equal(t, common.RedemptionCodeStatusEnabled, deletedCode.Status)
		count, err = DisableRedemptionsInGroup(group.Id)
		require.NoError(t, err)
		assert.Zero(t, count)

		count, err = DisableRedemptionsInGroup(0)
		require.NoError(t, err)
		want := int64(1)
		if upgrade {
			want++
		}
		assert.Equal(t, want, count)
		// An editor opened before disabling must preserve the new status.
		require.NoError(t, rows[0].Update())
		code, err := GetRedemptionById(rows[0].Id)
		require.NoError(t, err)
		assert.Equal(t, common.RedemptionCodeStatusDisabled, code.Status)
		otherCode, err := GetRedemptionById(otherCodes[0].Id)
		require.NoError(t, err)
		assert.Equal(t, common.RedemptionCodeStatusEnabled, otherCode.Status)
	})
	require.NoError(t, DeleteRedemptionGroup(group.Id))
	assert.Error(t, MoveRedemptionsToGroup([]int{rows[0].Id}, group.Id))
	assert.Error(t, CreateGroupedRedemptions(group.Id, []Redemption{{Name: "invalid", Key: "00000000000000000000000000001106", Quota: 100}}))
	_, total, err = SearchRedemptionsInGroup("conference", "", &ungrouped, 0, 2)
	require.NoError(t, err)
	assert.EqualValues(t, 4, total, "deleting a group preserves all its codes")
}

func TestSearchRedemptionsFiltersAndPaginates(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&Redemption{}))
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
	})

	now := common.GetTimestamp()
	redemptions := []Redemption{
		{Id: 1, Name: "alpha-active", Key: "00000000000000000000000000000001", Status: common.RedemptionCodeStatusEnabled, ExpiredTime: 0},
		{Id: 2, Name: "alpha-future", Key: "00000000000000000000000000000002", Status: common.RedemptionCodeStatusEnabled, ExpiredTime: now + 3600},
		{Id: 3, Name: "alpha-expired", Key: "00000000000000000000000000000003", Status: common.RedemptionCodeStatusEnabled, ExpiredTime: now - 10},
		{Id: 4, Name: "beta-disabled", Key: "00000000000000000000000000000004", Status: common.RedemptionCodeStatusDisabled, ExpiredTime: 0},
		{Id: 5, Name: "beta-used", Key: "00000000000000000000000000000005", Status: common.RedemptionCodeStatusUsed, ExpiredTime: 0},
	}
	require.NoError(t, DB.Create(&redemptions).Error)

	tests := []struct {
		name      string
		keyword   string
		status    string
		startIdx  int
		num       int
		wantTotal int64
		wantIds   []int
	}{
		{
			name:      "no filters returns all rows",
			num:       10,
			wantTotal: 5,
			wantIds:   []int{5, 4, 3, 2, 1},
		},
		{
			name:      "keyword filters by name prefix",
			keyword:   "alpha",
			num:       10,
			wantTotal: 3,
			wantIds:   []int{3, 2, 1},
		},
		{
			name:      "enabled status excludes expired rows",
			status:    "1",
			num:       10,
			wantTotal: 2,
			wantIds:   []int{2, 1},
		},
		{
			name:      "expired status returns enabled expired rows",
			status:    "expired",
			num:       10,
			wantTotal: 1,
			wantIds:   []int{3},
		},
		{
			name:      "disabled status",
			status:    "2",
			num:       10,
			wantTotal: 1,
			wantIds:   []int{4},
		},
		{
			name:      "used status",
			status:    "3",
			num:       10,
			wantTotal: 1,
			wantIds:   []int{5},
		},
		{
			name:      "pagination keeps unpaged total",
			startIdx:  1,
			num:       2,
			wantTotal: 5,
			wantIds:   []int{4, 3},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rows, total, err := SearchRedemptions(tt.keyword, tt.status, tt.startIdx, tt.num)
			require.NoError(t, err)
			assert.Equal(t, tt.wantTotal, total)
			gotIds := make([]int, 0, len(rows))
			for _, row := range rows {
				gotIds = append(gotIds, row.Id)
			}
			assert.Equal(t, tt.wantIds, gotIds)
		})
	}
}

func setupRedeemFixture(t *testing.T, quota int) (userId int, key string) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&Redemption{}))
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
		DB.Exec("DELETE FROM users")
		DB.Exec("DELETE FROM logs")
	})

	user := &User{Username: "redeem-user", Password: "password", Status: common.UserStatusEnabled, Quota: 0}
	require.NoError(t, DB.Create(user).Error)

	key = "10000000000000000000000000000001"
	redemption := &Redemption{
		Name:        "redeem-test",
		Key:         key,
		Status:      common.RedemptionCodeStatusEnabled,
		Quota:       quota,
		CreatedTime: common.GetTimestamp(),
	}
	require.NoError(t, DB.Create(redemption).Error)
	return user.Id, key
}

func TestRedeemCreditsQuotaExactlyOnce(t *testing.T) {
	userId, key := setupRedeemFixture(t, 500)

	quota, err := Redeem(key, userId)
	require.NoError(t, err)
	assert.Equal(t, 500, quota)

	var user User
	require.NoError(t, DB.First(&user, "id = ?", userId).Error)
	assert.Equal(t, 500, user.Quota)

	var redemption Redemption
	require.NoError(t, DB.First(&redemption, "name = ?", "redeem-test").Error)
	assert.Equal(t, common.RedemptionCodeStatusUsed, redemption.Status)
	assert.Equal(t, userId, redemption.UsedUserId)

	// Redeeming the same code again must fail and must not credit quota.
	_, err = Redeem(key, userId)
	require.Error(t, err)
	require.NoError(t, DB.First(&user, "id = ?", userId).Error)
	assert.Equal(t, 500, user.Quota)
}

func TestRedeemRejectsWalletOverflow(t *testing.T) {
	userId, key := setupRedeemFixture(t, 11)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", userId).Update("quota", common.MaxWalletQuota-10).Error)

	_, err := Redeem(key, userId)
	require.ErrorIs(t, err, ErrRedeemFailed)

	var user User
	require.NoError(t, DB.First(&user, "id = ?", userId).Error)
	assert.Equal(t, common.MaxWalletQuota-10, user.Quota)

	var redemption Redemption
	require.NoError(t, DB.First(&redemption, "key = ?", key).Error)
	assert.Equal(t, common.RedemptionCodeStatusEnabled, redemption.Status)
}

func TestRedemptionQuotaRejectsWalletOverflow(t *testing.T) {
	setupRedeemFixture(t, 500)

	redemption := &Redemption{
		Name:        "overflow-redemption",
		Key:         "10000000000000000000000000000002",
		Status:      common.RedemptionCodeStatusEnabled,
		Quota:       common.MaxWalletQuota + 1,
		CreatedTime: common.GetTimestamp(),
	}
	require.Error(t, redemption.Insert())
}

// Exactly one of several concurrent redeems of the same code may win, and
// quota must be credited exactly once.
func TestRedeemConcurrentSingleSuccess(t *testing.T) {
	userId, key := setupRedeemFixture(t, 300)

	const goroutines = 5
	successes := make([]bool, goroutines)
	var wg sync.WaitGroup
	wg.Add(goroutines)
	for i := range goroutines {
		go func(idx int) {
			defer wg.Done()
			if _, err := Redeem(key, userId); err == nil {
				successes[idx] = true
			}
		}(i)
	}
	wg.Wait()

	successCount := 0
	for _, ok := range successes {
		if ok {
			successCount++
		}
	}
	assert.Equal(t, 1, successCount, "exactly one concurrent redeem should succeed")

	var user User
	require.NoError(t, DB.First(&user, "id = ?", userId).Error)
	assert.Equal(t, 300, user.Quota, "quota must be credited exactly once")
}

func setupAdminTokenRedeemFixture(t *testing.T, adminStatus int) *User {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&User{}, &Token{}, &TokenGroup{}, &Redemption{}, &RedemptionGroup{}))
	t.Cleanup(func() {
		DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Token{})
		DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&TokenGroup{})
		DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{})
		DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&RedemptionGroup{})
		DB.Exec("DELETE FROM users")
	})

	DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Token{})
	DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&TokenGroup{})
	DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{})
	DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&RedemptionGroup{})
	DB.Exec("DELETE FROM users")

	if adminStatus == 0 {
		return nil
	}
	admin := &User{
		Username: "admin",
		Password: "password",
		Role:     common.RoleAdminUser,
		Status:   adminStatus,
		Quota:    100000,
	}
	require.NoError(t, DB.Create(admin).Error)
	return admin
}

func TestRedeemToAdminToken(t *testing.T) {
	t.Run("grouped and ungrouped redemptions create expected admin tokens", func(t *testing.T) {
		admin := setupAdminTokenRedeemFixture(t, common.UserStatusEnabled)

		group, err := CreateRedemptionGroup("VIP-Batch")
		require.NoError(t, err)

		futureExpiry := common.GetTimestamp() + 3600
		codes := []Redemption{
			{
				Name:        "vip-code-1",
				Key:         "20000000000000000000000000000001",
				Status:      common.RedemptionCodeStatusEnabled,
				Quota:       5000,
				ExpiredTime: 0,
				CreatedTime: common.GetTimestamp(),
			},
			{
				Name:        "vip-code-2",
				Key:         "20000000000000000000000000000002",
				Status:      common.RedemptionCodeStatusEnabled,
				Quota:       3000,
				ExpiredTime: futureExpiry,
				CreatedTime: common.GetTimestamp(),
			},
		}
		require.NoError(t, CreateGroupedRedemptions(group.Id, codes))

		ungrouped := Redemption{
			Name:        "ungrouped-code",
			Key:         "20000000000000000000000000000003",
			Status:      common.RedemptionCodeStatusEnabled,
			Quota:       2000,
			ExpiredTime: 0,
			CreatedTime: common.GetTimestamp(),
		}
		require.NoError(t, ungrouped.Insert())

		firstToken, err := RedeemToAdminToken("20000000000000000000000000000001")
		require.NoError(t, err)
		assert.Equal(t, admin.Id, firstToken.UserId)
		assert.Equal(t, 5000, firstToken.RemainQuota)
		assert.Equal(t, int64(-1), firstToken.ExpiredTime)
		assert.Equal(t, 0, firstToken.ConcurrencyLimit)
		assert.False(t, firstToken.AllowUserQuotaQuery)
		assert.False(t, firstToken.UnlimitedQuota)
		assert.Positive(t, firstToken.GroupId)

		tokenGroups, err := ListTokenGroups(admin.Id)
		require.NoError(t, err)
		require.Len(t, tokenGroups, 1)
		assert.Equal(t, "VIP-Batch", tokenGroups[0].Name)
		assert.Equal(t, 1, tokenGroups[0].ConcurrencyLimit)
		assert.Equal(t, tokenGroups[0].Id, firstToken.GroupId)

		// Updating the group's concurrency limit is preserved when redeeming another code into it.
		updatedLimit := 3
		_, err = UpdateTokenGroup(admin.Id, tokenGroups[0].Id, tokenGroups[0].Name, &updatedLimit)
		require.NoError(t, err)

		// Second code in the same group reuses the same TokenGroup.
		secondToken, err := RedeemToAdminToken("20000000000000000000000000000002")
		require.NoError(t, err)
		assert.Equal(t, tokenGroups[0].Id, secondToken.GroupId)
		assert.Equal(t, futureExpiry, secondToken.ExpiredTime)
		assert.Equal(t, 0, secondToken.ConcurrencyLimit)
		assert.False(t, secondToken.AllowUserQuotaQuery)

		tokenGroups, err = ListTokenGroups(admin.Id)
		require.NoError(t, err)
		assert.Len(t, tokenGroups, 1)
		assert.Equal(t, 3, tokenGroups[0].ConcurrencyLimit)

		// Ungrouped code produces an ungrouped token.
		thirdToken, err := RedeemToAdminToken("20000000000000000000000000000003")
		require.NoError(t, err)
		assert.Equal(t, 0, thirdToken.GroupId)
		assert.Equal(t, 2000, thirdToken.RemainQuota)
		assert.Equal(t, int64(-1), thirdToken.ExpiredTime)
		assert.Equal(t, 1, thirdToken.ConcurrencyLimit)
		assert.False(t, thirdToken.AllowUserQuotaQuery)

		// Reusing an already-redeemed code fails.
		_, err = RedeemToAdminToken("20000000000000000000000000000001")
		require.Error(t, err)

		// Admin wallet quota is unchanged by token issuance.
		var reloadedAdmin User
		require.NoError(t, DB.First(&reloadedAdmin, admin.Id).Error)
		assert.Equal(t, 100000, reloadedAdmin.Quota)
	})

	t.Run("missing or disabled admin fails without consuming code", func(t *testing.T) {
		setupAdminTokenRedeemFixture(t, common.UserStatusDisabled)
		code := Redemption{
			Name:        "disabled-admin-code",
			Key:         "20000000000000000000000000000004",
			Status:      common.RedemptionCodeStatusEnabled,
			Quota:       1000,
			CreatedTime: common.GetTimestamp(),
		}
		require.NoError(t, code.Insert())

		_, err := RedeemToAdminToken(code.Key)
		require.Error(t, err)

		var reloaded Redemption
		require.NoError(t, DB.First(&reloaded, "key = ?", code.Key).Error)
		assert.Equal(t, common.RedemptionCodeStatusEnabled, reloaded.Status)
	})
}

func TestRedeemToAdminTokenConcurrentSingleSuccess(t *testing.T) {
	admin := setupAdminTokenRedeemFixture(t, common.UserStatusEnabled)
	const codeKey = "20000000000000000000000000000005"
	code := Redemption{
		Name:        "concurrent-code",
		Key:         codeKey,
		Status:      common.RedemptionCodeStatusEnabled,
		Quota:       4000,
		CreatedTime: common.GetTimestamp(),
	}
	require.NoError(t, code.Insert())

	const goroutines = 5
	results := make(chan *Token, goroutines)
	var wg sync.WaitGroup
	wg.Add(goroutines)
	for range goroutines {
		go func() {
			defer wg.Done()
			if tok, err := RedeemToAdminToken(codeKey); err == nil {
				results <- tok
			}
		}()
	}
	wg.Wait()
	close(results)

	var issued []*Token
	for tok := range results {
		issued = append(issued, tok)
	}
	require.Len(t, issued, 1, "exactly one concurrent redeem should issue a token")

	var count int64
	require.NoError(t, DB.Model(&Token{}).Where("user_id = ?", admin.Id).Count(&count).Error)
	assert.Equal(t, int64(1), count)
}
