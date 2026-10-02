# Integer power

Checked i/int8 exponentiation and exact packed decimal exponentiation.
Errors use abaperr; packed multiplication is supplied by the host.
Negative exponents compute through float; integer assignment rounds half away from zero.
Integer string assignment keeps the measured trailing sign; minimum-i oracle case 8 awaits A4H re-measurement.
Floating string assignment formatting follows the supplied IPOW oracle.
BOOLX creates byte strings with documented one-based bit positions.
