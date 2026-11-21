package controller

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"encoding/xml"
	"errors"
	"strconv"
)

const wechatPaddingSize = 32

var errWeChatCiphertext = errors.New("invalid WeChat ciphertext")

func decryptWeChatMessage(key []byte, encoded, appID string) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(data) == 0 || len(data)%wechatPaddingSize != 0 {
		return nil, errWeChatCiphertext
	}
	cipher.NewCBCDecrypter(block, key[:aes.BlockSize]).CryptBlocks(data, data)
	padding := int(data[len(data)-1])
	if padding == 0 || padding > wechatPaddingSize || !bytes.Equal(data[len(data)-padding:], bytes.Repeat([]byte{byte(padding)}, padding)) {
		return nil, errWeChatCiphertext
	}
	data = data[:len(data)-padding]
	if len(data) < 20 {
		return nil, errWeChatCiphertext
	}
	size := binary.BigEndian.Uint32(data[16:20])
	if uint64(size) > uint64(len(data)-20) {
		return nil, errWeChatCiphertext
	}
	message, receiver := data[20:20+size], data[20+size:]
	if subtle.ConstantTimeCompare(receiver, []byte(appID)) != 1 {
		return nil, errWeChatCiphertext
	}
	return message, nil
}

func encryptWeChatReply(key, message []byte, appID, token string, timestamp int64) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	// WeChat's envelope is 16 random bytes, the message length in network
	// byte order, the message, the AppID, and PKCS#7 padding to 32 bytes.
	data := make([]byte, 20, 20+len(message)+len(appID)+wechatPaddingSize)
	rand.Read(data[:16])
	binary.BigEndian.PutUint32(data[16:20], uint32(len(message)))
	data = append(data, message...)
	data = append(data, appID...)
	padding := wechatPaddingSize - len(data)%wechatPaddingSize
	data = append(data, bytes.Repeat([]byte{byte(padding)}, padding)...)
	cipher.NewCBCEncrypter(block, key[:aes.BlockSize]).CryptBlocks(data, data)
	encoded := base64.StdEncoding.EncodeToString(data)
	timeText, nonce := strconv.FormatInt(timestamp, 10), rand.Text()
	return xml.Marshal(struct {
		XMLName   xml.Name `xml:"xml"`
		Encrypt   string   `xml:"Encrypt"`
		Signature string   `xml:"MsgSignature"`
		Time      string   `xml:"TimeStamp"`
		Nonce     string   `xml:"Nonce"`
	}{Encrypt: encoded, Signature: wechatSignature(token, timeText, nonce, encoded), Time: timeText, Nonce: nonce})
}
