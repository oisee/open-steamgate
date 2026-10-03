# Checked int8 arithmetic

Native int64 add/subtract, `bits.Mul64` multiplication, Euclidean DIV/MOD,
and division rounded half away from zero. Unsigned magnitudes handle MIN,
including divisors of MIN; MIN divided by -1 raises arithmetic overflow.
Zero divided by zero follows the existing ABAP contract and returns zero.
Errors use `abaperr`, with no dependency on the ABAP runtime.

`Packed` retries the existing packed implementation only on arithmetic
overflow. The emitter uses it for integral packed trees with pure operands;
fractional intermediates and wider literals retain the packed path. The
fallback preserves packed intermediates beyond int64, including cancellation.
