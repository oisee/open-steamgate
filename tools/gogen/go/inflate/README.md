# inflate

Streaming DEFLATE decoder mirroring ZCL_OSD_INFLATE.

`Registry.Open` creates a handle for one stream.
`Registry.Feed` supplies bytes and an output budget.
`Registry.DropAll` releases every outstanding stream in a session.
A feed reports paused, finished, or corrupt state and any unused bytes.
The reason text matches the ABAP class byte for byte.
A failed or finished feed drops its handle.
The package does not depend on ABAP session or data values.
