package hashchar

import (
	"crypto/md5"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"strings"
)

// Calculate implements the character input of CL_ABAP_MESSAGE_DIGEST.
// The open-abap-core Node implementation hashes UTF-8 bytes and writes
// uppercase hex to both string outputs.
func Calculate(_ any, algorithm, data string, hashX, hashString, hashB64 *string) {
	var sum []byte
	switch strings.ToLower(algorithm) {
	case "md5":
		x := md5.Sum([]byte(data))
		sum = x[:]
	case "sha1":
		x := sha1.Sum([]byte(data))
		sum = x[:]
	case "sha256":
		x := sha256.Sum256([]byte(data))
		sum = x[:]
	default:
		panic("CL_ABAP_MESSAGE_DIGEST: unsupported algorithm")
	}
	*hashX = strings.ToUpper(hex.EncodeToString(sum))
	*hashString = *hashX
	*hashB64 = base64.StdEncoding.EncodeToString(sum)
}
