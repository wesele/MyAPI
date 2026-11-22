package middleware

import (
	"net/http"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/gin-gonic/gin"
)

type tokenConcurrencyTracker struct {
	mu       sync.Mutex
	inFlight map[int]int
}

var singleProcessTokenConcurrency = &tokenConcurrencyTracker{
	inFlight: make(map[int]int),
}

func (t *tokenConcurrencyTracker) acquire(tokenID, limit int) (func(), bool) {
	if tokenID <= 0 || limit <= 0 {
		return func() {}, true
	}
	t.mu.Lock()
	if t.inFlight[tokenID] >= limit {
		t.mu.Unlock()
		return nil, false
	}
	t.inFlight[tokenID]++
	t.mu.Unlock()

	var once sync.Once
	return func() {
		once.Do(func() {
			t.mu.Lock()
			if current := t.inFlight[tokenID]; current <= 1 {
				delete(t.inFlight, tokenID)
			} else {
				t.inFlight[tokenID] = current - 1
			}
			t.mu.Unlock()
		})
	}, true
}

// AcquireTokenConcurrencySlot reserves one in-process concurrent slot for the
// current token when a concurrency limit is configured.
func AcquireTokenConcurrencySlot(c *gin.Context) (func(), bool) {
	if c == nil {
		return func() {}, true
	}
	tokenID := c.GetInt("token_id")
	limit := common.GetContextKeyInt(c, constant.ContextKeyTokenConcurrencyLimit)
	return singleProcessTokenConcurrency.acquire(tokenID, limit)
}

// TokenConcurrencyLimit enforces the token's single-process concurrency limit.
func TokenConcurrencyLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		release, ok := AcquireTokenConcurrencySlot(c)
		if !ok {
			abortWithOpenAiMessage(c, http.StatusTooManyRequests, i18n.T(c, i18n.MsgTokenConcurrencyLimitReached))
			return
		}
		defer release()
		c.Next()
	}
}
