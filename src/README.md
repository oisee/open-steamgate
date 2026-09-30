# ABAP source

`gateway/` and `http/` hold the OData request path and its HTTP entry point; `segw/` and `sadl/` hold generated-service and mapped data-source support. Start with [prior art](../docs/prior-art.md), [SEGW mapping](../docs/segw-mapping.md), and [the feature map](../docs/where-is.md).

`cds/`, `ddic/`, and `amdp/` hold data definitions and database procedure examples. [SQLScript surface](../docs/sqlscript-surface.md) and [portable AMDP](../docs/amdp-portable-runtime.md) describe those paths.

`luw/`, `jobs/`, `bal/`, and `status/` hold transaction, background job, application log, and status objects. The relevant behavior is covered by [transactional buffering](../docs/luw-buffer.md), [job identity](../docs/job-identity.md), and [BAL storage](../docs/bal-store.md).

`demo/`, `demo_data/`, `demo_odc/`, `demo_sadl/`, and `regression/` provide runnable services and regression objects. [Demo data](../docs/demo-data.md) and [the regression contract](../docs/devux-gateway-regression-contract.md) give the surrounding context.

`amc/`, `apc/`, `bsp/`, `icf/`, `rfc/`, and `webgui/` hold communication and UI entry points. See [RFC channel](../docs/rfc-channel.md) and [WebGUI](../docs/webgui.md).
