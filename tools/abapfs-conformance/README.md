# abapfs-conformance dependencies

These files pin the ADT client that `tools/abapfs-conformance.mjs` drives:

- `abap-adt-api` 8.4.3, Copyright (c) 2019 Marcello Urbani, MIT licence;
- its 41 transitive packages.

Every version and integrity equals ABAP-FS 2.10.3's `pnpm-lock.yaml`. The
`overrides` in `package.json` force the two packages npm would otherwise
float.

This package is not part of the root install. The tool copies the two files
into `.local/conformance/abapfs/deps` and runs `npm ci` there on first use.
See `docs/abapfs-conformance.md`.

To move to a newer ABAP-FS:

1. Take the new versions and integrities from its `pnpm-lock.yaml`.
2. Update `package.json` and its `overrides`.
3. Regenerate the lock with `npm install --package-lock-only`.
4. Compare every integrity with the pnpm lock.
5. Change `PIN` in the tool and `client` in
   `test/fixtures/abapfs-conformance/expected.json`.
