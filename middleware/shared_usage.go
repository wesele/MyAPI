package middleware

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/chacha20poly1305"
	"gorm.io/gorm"
)

const (
	usageCookie   = "shared_usage"
	usageLifetime = 30 * time.Minute
)

var publicSessionID = regexp.MustCompile("^[A-Z2-7]{26}$")

type usageSession struct {
	TokenID int
	KeyHash [32]byte
	Expires int64
}

// SharedPortalRequest requires a same-origin browser request. A custom header
// also forces a preflight for cross-origin scripts. These routes do not use CORS.
func SharedPortalRequest(c *gin.Context) {
	site := c.GetHeader("Sec-Fetch-Site")
	if c.GetHeader("X-Shared-Portal") != "1" || (site != "" && site != "same-origin") {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}
	c.Next()
}

func isSharedUsageCookieSecure(c *gin.Context) bool {
	if common.SessionCookieSecure || c.Request.TLS != nil {
		return true
	}
	if strings.EqualFold(c.Request.URL.Scheme, "https") {
		return true
	}
	return strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https")
}

// StartSharedUsage exchanges a relay key for a path-scoped read-only cookie.
func StartSharedUsage(c *gin.Context) {
	scheme, keyHeader, ok := strings.Cut(c.GetHeader("Authorization"), " ")
	keyText := c.GetString("token_key")
	if !ok || !strings.EqualFold(scheme, "bearer") || subtle.ConstantTimeCompare([]byte(strings.TrimPrefix(keyHeader, "sk-")), []byte(keyText)) != 1 {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	id := rand.Text()
	session := usageSession{
		TokenID: c.GetInt("token_id"),
		KeyHash: sha256.Sum256([]byte(keyText)),
		Expires: time.Now().Add(usageLifetime).Unix(),
	}
	key := sha256.Sum256([]byte("shared-api-key-usage:" + common.SessionSecret))
	cipher, err := chacha20poly1305.NewX(key[:])
	if err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	payload, err := common.Marshal(session)
	if err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	var nonce [chacha20poly1305.NonceSizeX]byte
	rand.Read(nonce[:])
	value := cipher.Seal(nonce[:], nonce[:], payload, []byte(id))
	http.SetCookie(c.Writer, &http.Cookie{
		Name: usageCookie, Value: base64.RawURLEncoding.EncodeToString(value),
		Path:   "/api/shared/usage/" + id + "/",
		MaxAge: int(usageLifetime.Seconds()), Secure: isSharedUsageCookieSecure(c), HttpOnly: true, SameSite: http.SameSiteStrictMode,
	})
	c.JSON(http.StatusOK, gin.H{"id": id})
}

// ResumeSharedUsage only restores authorization for the two read-only routes
// that install it. The normal read-only middleware still checks current access.
func ResumeSharedUsage(c *gin.Context) {
	id := c.Param("id")
	value, err := c.Cookie(usageCookie)
	if err != nil || len(value) > 512 || !publicSessionID.MatchString(id) {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil || len(raw) <= chacha20poly1305.NonceSizeX {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	key := sha256.Sum256([]byte("shared-api-key-usage:" + common.SessionSecret))
	cipher, err := chacha20poly1305.NewX(key[:])
	if err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	payload, err := cipher.Open(nil, raw[:chacha20poly1305.NonceSizeX], raw[chacha20poly1305.NonceSizeX:], []byte(id))
	var session usageSession
	if err != nil || common.Unmarshal(payload, &session) != nil || session.Expires <= time.Now().Unix() {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	token, err := model.GetTokenById(session.TokenID)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		c.AbortWithStatus(http.StatusServiceUnavailable)
		return
	}
	if err != nil || token.Status == common.TokenStatusDisabled {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	hash := sha256.Sum256([]byte(token.Key))
	if subtle.ConstantTimeCompare(hash[:], session.KeyHash[:]) != 1 {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	c.Request.Header.Set("Authorization", "Bearer sk-"+token.Key)
	defer c.Request.Header.Del("Authorization")
	c.Next()
}
