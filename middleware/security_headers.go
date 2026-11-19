package middleware

import "github.com/gin-gonic/gin"

// SecurityHeaders applies baseline HTTP defense-in-depth headers to responses.
// Downstream handlers (such as the task media proxy) may overwrite specific
// headers with stricter values when needed.
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		headers := c.Writer.Header()
		if headers.Get("X-Content-Type-Options") == "" {
			headers.Set("X-Content-Type-Options", "nosniff")
		}
		if headers.Get("X-Frame-Options") == "" {
			headers.Set("X-Frame-Options", "SAMEORIGIN")
		}
		if headers.Get("Referrer-Policy") == "" {
			headers.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		}
		if headers.Get("Permissions-Policy") == "" {
			headers.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		}
		c.Next()
	}
}
