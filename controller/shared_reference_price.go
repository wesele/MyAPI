package controller

import (
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

// Reference prices are display-only. Administrators can maintain the
// SharedReferencePrices option through the existing root options API.
type sharedReferencePrice struct {
	InputUSD       *float64 `json:"input_usd,omitempty"`
	OutputUSD      *float64 `json:"output_usd,omitempty"`
	RequestUSD     *float64 `json:"request_usd,omitempty"`
	InputCNY       *float64 `json:"input_cny,omitempty"`
	OutputCNY      *float64 `json:"output_cny,omitempty"`
	RequestCNY     *float64 `json:"request_cny,omitempty"`
	MaxInputTokens int      `json:"max_input_tokens,omitempty"`
	Source         string   `json:"source"`
	Checked        string   `json:"checked"`
}

const sharedReferencePricesOption = "SharedReferencePrices"

func (price sharedReferencePrice) valid() bool {
	source, err := url.Parse(price.Source)
	_, dateErr := time.Parse(time.DateOnly, price.Checked)
	if err != nil || source.Scheme != "https" || source.Hostname() == "" || source.User != nil || dateErr != nil || price.MaxInputTokens < 0 {
		return false
	}
	hasPrice := false
	for _, pair := range [][2]*float64{
		{price.InputUSD, price.InputCNY},
		{price.OutputUSD, price.OutputCNY},
		{price.RequestUSD, price.RequestCNY},
	} {
		if pair[0] != nil && pair[1] != nil {
			return false
		}
		for _, value := range pair {
			if value == nil {
				continue
			}
			if *value < 0 || math.IsNaN(*value) || math.IsInf(*value, 0) {
				return false
			}
			hasPrice = true
		}
	}
	return hasPrice
}

func parseSharedReferencePrices(raw string) (map[string]sharedReferencePrice, bool) {
	var prices map[string]sharedReferencePrice
	if common.UnmarshalJsonStr(raw, &prices) != nil || prices == nil {
		return nil, false
	}
	valid := true
	for name, price := range prices {
		if strings.TrimSpace(name) == "" || !price.valid() {
			delete(prices, name)
			valid = false
		}
	}
	return prices, valid
}

func GetSharedReferencePrices(c *gin.Context) {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[sharedReferencePricesOption]
	common.OptionMapRWMutex.RUnlock()

	prices := make(map[string]sharedReferencePrice)
	if raw == "" {
		// OpenAI Standard text-token pricing for the short-context band.
		input, output := 0.10, 0.50
		prices["gpt-6-luna"] = sharedReferencePrice{
			InputUSD: &input, OutputUSD: &output, MaxInputTokens: 272000,
			Source: "https://developers.openai.com/api/docs/models/gpt-6-luna#pricing", Checked: "2026-11-21",
		}
	} else {
		storedPrices, _ := parseSharedReferencePrices(raw)
		if storedPrices != nil {
			prices = storedPrices
		}
	}
	c.JSON(http.StatusOK, prices)
}
