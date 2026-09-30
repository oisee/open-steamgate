package hashchar

import "testing"

func TestCalculate(t *testing.T) {
	var hexValue, textValue, b64Value string
	Calculate(nil, "SHA256", "a", &hexValue, &textValue, &b64Value)
	if hexValue != "CA978112CA1BBDCAFAC231B39A23DC4DA786EFF8147C4E72B9807785AFEE48BB" {
		t.Fatalf("unexpected SHA-256 hex: %q", hexValue)
	}
	if textValue != hexValue || b64Value != "ypeBEsobvcr6wjGzmiPcTaeG7/gUfE5yuYB3ha/uSLs=" {
		t.Fatalf("unexpected character hash outputs: %q %q", textValue, b64Value)
	}
}
