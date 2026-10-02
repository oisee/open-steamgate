# Built-in oracle follow-up

The corrected IPOW oracle is **12/12 SUCCESS** in Go and IR-as-JS.
ABAPiti re-measured case 8, `I_M2P31`, on A4H (TMP_21): assigning
`ipow( base = -2 exp = 31 )` to string gives `2147483648-`.
The original leading-sign expectation was a test error. The corrected
expectation matches the shared i-to-string assignment rule, including INT_MIN.
Case 8 is resolved; no formatting exception is needed.
