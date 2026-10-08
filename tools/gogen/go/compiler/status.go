package compiler

import (
	"context"
	"encoding/json"
	"fmt"
)

func StatusJSON(ctx context.Context, options Options) ([]byte, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	client := New(options)
	defer client.Close()
	_ = client.Hello(ctx)
	raw, err := json.Marshal(client.Status())
	if err != nil {
		return nil, fmt.Errorf("compiler status JSON: %w", err)
	}
	return raw, nil
}
