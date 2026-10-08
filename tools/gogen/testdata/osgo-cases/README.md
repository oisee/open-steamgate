# osgo divergence cases

Probes for constructs where osgo differed from the kernel (A4H 7.58) and
from the JS runtime, one class per case from the ABAPiti case table:
023 scalar `VALUE i( )`, 024 `IS [NOT] INSTANCE OF`, 027 `CONCATENATE`
with keywords inside a literal. The
recursive ABAP Unit runner discovers them through the `testdata` fixture
that the gogen workflow runs.
