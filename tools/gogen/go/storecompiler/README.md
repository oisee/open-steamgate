# storecompiler -- objstore's compiler adapter

This package adapts the lifecycle-owning `compiler.Client` to objstore's narrow `Compiler` interface, keeping process ownership and snapshot construction out of the store package.

It pins the files objstore names with `compiler.BuildSnapshot`, checks active copies against the generation's built hashes, then forwards CHECK and OUTLINE. Contract-v1 snapshots cannot carry Node's in-memory `IV_SOURCE`, so that path returns `UNSUPPORTED_OP` instead of silently checking stale disk text.
