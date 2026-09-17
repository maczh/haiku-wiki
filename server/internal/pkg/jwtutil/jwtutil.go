// Package jwtutil JWT 签发与解析（HS256，有效期 7 天）。
package jwtutil

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims 自定义声明：uid + role。
type Claims struct {
	UID  uint64 `json:"uid"`
	Role string `json:"role"`
	jwt.RegisteredClaims
}

const validity = 7 * 24 * time.Hour

var secret []byte

// Init 注入签名密钥（服务启动时调用）。
func Init(s string) { secret = []byte(s) }

// Create 为用户签发 token。
func Create(uid uint64, role string) (string, error) {
	now := time.Now()
	claims := Claims{
		UID:  uid,
		Role: role,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(validity)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
}

// Parse 校验并解析 token。
func Parse(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return secret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}
