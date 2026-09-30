package main

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"fmt"
	"io"

	"github.com/oisee/open-diag-go/pkg/diag"
)

// sapGUIWrapperAsset is the identifier-free first dynpro wrapper from
// open-diag-go's embedded lsd show asset at 62029ee085bc, reduced to its first
// frame and gzip/base64 encoded. That project derives this structural template
// from a capture, scrubs every system/session/user identifier, and verifies the
// result before committing it. The fuller wrapper is required by real SAP GUI;
// diag.LogonScreen is deliberately only a minimal synthetic protocol fixture.
const sapGUIWrapperAsset = "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"

func sapGUIWrapper() (diag.ServerFrame, error) {
	compressed, err := base64.StdEncoding.DecodeString(sapGUIWrapperAsset)
	if err != nil {
		return diag.ServerFrame{}, fmt.Errorf("SAP GUI wrapper base64: %w", err)
	}
	zr, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return diag.ServerFrame{}, fmt.Errorf("SAP GUI wrapper gzip: %w", err)
	}
	payload, err := io.ReadAll(zr)
	if err != nil {
		return diag.ServerFrame{}, fmt.Errorf("SAP GUI wrapper inflate: %w", err)
	}
	if err := zr.Close(); err != nil {
		return diag.ServerFrame{}, fmt.Errorf("SAP GUI wrapper close: %w", err)
	}
	message, err := diag.ParseMessage(payload, false)
	if err != nil {
		return diag.ServerFrame{}, fmt.Errorf("SAP GUI wrapper DIAG: %w", err)
	}
	return diag.ServerFrame{Header: message.Header, Items: diag.ParseItems(message.Body)}, nil
}
