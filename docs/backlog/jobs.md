
## Next application spike after background jobs

After the [lean jobs and events plan](open-issues/lean-jobs-business-log.md),
run an ABAP-written ZIP/XML converter in OSG, with server-file, interactive
client-upload and HTTP-download inputs feeding one conversion core. The scoped
probe and acceptance checks are in [ABAP ZIP/XML converter spike](open-issues/abap-zip-xml-converter-spike.md).
Use a synthetic public fixture in CI; validate private inputs locally without
committing their bytes, credentials or converted output. The current runtime
transpiles ABAP to JavaScript; a Go output target is a separate research item.
