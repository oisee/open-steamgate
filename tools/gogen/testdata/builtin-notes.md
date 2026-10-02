# Built-in oracle follow-up

The supplied IPOW oracle is **11/12** in Go and IR-as-JS. Case 8,
`I_M2P31`, computes `ipow( base = -2 exp = 31 )` and assigns the resulting
minimum i to string. Its expectation is `-2147483648`; the shared,
A4H-measured i-to-string assignment rule produces `2147483648-`.
The oracle expectation remains unchanged and this case remains failing.

Case 8 is **pending re-measurement on A4H**. ABAPiti is re-probing
`string ← i` for -5 and -2147483648. Until those measurements arrive,
every i-to-string assignment uses the existing trailing-sign rule.
