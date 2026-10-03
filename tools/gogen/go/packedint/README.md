# Integral packed checksums

A checked int64 addition replaces parsing and formatting big integers for
zero-decimal packed values in owned-memory classes. The representation remains
an ordinary string. Values outside int64, fractional input, addition overflow
or target-width overflow return false and retain the existing exact path.
