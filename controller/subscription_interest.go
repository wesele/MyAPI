package controller

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"regexp"

	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const subscriptionVoterCookie = "__Host-shared_opencode_voter"

var subscriptionVoterID = regexp.MustCompile("^[A-Z2-7]{26}$")

func GetSubscriptionInterest(c *gin.Context) {
	voter, _ := c.Cookie(subscriptionVoterCookie)
	if !subscriptionVoterID.MatchString(voter) {
		http.SetCookie(c.Writer, &http.Cookie{
			Name: subscriptionVoterCookie, Value: rand.Text(), Path: "/",
			MaxAge: 365 * 24 * 60 * 60, Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode,
		})
		c.JSON(http.StatusOK, gin.H{"amount": 0})
		return
	}
	vote, err := model.GetSubscriptionInterest(subscriptionInterestVoterHash(voter))
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	c.JSON(http.StatusOK, gin.H{"amount": vote.Amount})
}

func SaveSubscriptionInterest(c *gin.Context) {
	voter, err := c.Cookie(subscriptionVoterCookie)
	if err != nil || !subscriptionVoterID.MatchString(voter) {
		c.Status(http.StatusForbidden)
		return
	}
	var request struct {
		Amount int `json:"amount"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256)
	if err := c.ShouldBindJSON(&request); err != nil {
		c.Status(http.StatusBadRequest)
		return
	}
	if !model.IsSubscriptionInterestAmount(request.Amount) {
		c.Status(http.StatusBadRequest)
		return
	}
	if err := model.SaveSubscriptionInterest(model.SubscriptionInterest{
		VoterHash: subscriptionInterestVoterHash(voter), Amount: request.Amount,
	}); err != nil {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	c.JSON(http.StatusOK, gin.H{"amount": request.Amount})
}

func subscriptionInterestVoterHash(voter string) string {
	// Keep responses to the previous currency survey under their original keys.
	hash := sha256.Sum256([]byte("opencode-cny:" + voter))
	return hex.EncodeToString(hash[:])
}

func GetSubscriptionInterestSummary(c *gin.Context) {
	counts, err := model.CountSubscriptionInterest()
	if err != nil {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": counts})
}
