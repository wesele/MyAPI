package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSharedReferencePricesCurrency(t *testing.T) {
	const valid = `{"model":{"input_cny":2.345,"output_usd":0,"source":"https://example.com/prices","checked":"2026-11-21"}}`
	prices, ok := parseSharedReferencePrices(valid)
	require.True(t, ok)
	require.NotNil(t, prices["model"].InputCNY)
	require.NotNil(t, prices["model"].OutputUSD)
	assert.Equal(t, 2.345, *prices["model"].InputCNY)
	assert.Zero(t, *prices["model"].OutputUSD)
	assert.Nil(t, prices["model"].InputUSD)

	for _, raw := range []string{
		`{"model":{"input_usd":1,"input_cny":2,"source":"https://example.com","checked":"2026-11-21"}}`,
		`{"model":{"request_cny":-1,"source":"https://example.com","checked":"2026-11-21"}}`,
		`{"model":{"request_cny":1,"source":"https://user@example.com","checked":"2026-11-21"}}`,
		`null`,
	} {
		body, err := common.Marshal(OptionUpdateRequest{Key: sharedReferencePricesOption, Value: raw})
		require.NoError(t, err)
		response := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(response)
		ctx.Request = httptest.NewRequest(http.MethodPut, "/api/option/", strings.NewReader(string(body)))
		UpdateOption(ctx)
		assert.Contains(t, response.Body.String(), "Invalid official reference prices")
	}
}
