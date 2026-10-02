`ZCL_GOGEN_T_SINGLEBYTES` is unmeasured on A4H. Its expectations describe
our current byte-section contract, not a kernel measurement.

In particular, `replace_fit` expects `12FF/2` after replacing offset 1,
length 1 of a fixed x(2) value `1234` with x(2) `FFFF`. The replacement
first splices to `12FFFF`, then fits the fixed target to `12FF` and sets
`sy-subrc` to 2, consistent with #473's bytesection rules. ABAPiti should
probe this exact operation on A4H before treating that expectation as
measured. The xstring case retains `12FFFF` and reports 0.
