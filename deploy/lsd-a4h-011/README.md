# LSD: isolated A4H installation

Import `/mnt/safe/osd/lsd-a4h-abapgit-011.zip` as a new offline abapGit repository and select or create package `$ZOSD_011`. The package name is chosen in abapGit; it is intentionally not embedded in the ZIP. Do not pull this ZIP into `$ZOSD_010`.

| Object | Name |
| --- | --- |
| SAPC | `ZOSD_011_LSD` |
| APC handler | `ZCL_ZOSD_011_LSD_APC` |
| HTTP handler | `ZCL_ZOSD_011_LSD_HTTP` |
| Media loader | `ZCL_ZOSD_011_LSD_MEDIA` |
| SMW0 recording | `ZOSD_011_SHOW` |
| SMW0 music | `ZOSD_011_MUSIC` |
| Player URL | `/sap/bc/zosd_011_lsd/` |
| WebSocket URL | `/sap/bc/apc/sap/zosd_011_lsd/` |

The ZIP carries two distinct SICF nodes, one for each URL. Their abapGit filenames include a 15-character padded node name and the first 25 hexadecimal characters of the URL's SHA-1 hash, as required by the abapGit version observed on A4H.

After import, activate both SICF services, then run the SAPC consistency check. The SAPC record specifies stateful plain WebSocket: `STATEFUL = X`, with blank connection and protocol types, matching the superclass `CL_APC_WSP_EXT_STATEFUL_BASE`. Open `http://<A4H_HOST>:50000/sap/bc/zosd_011_lsd/?sap-client=001` and press Play. Keep the existing LSD installation active until the new URL and WebSocket are verified.

Operator report, 2026-09-20: the `$ZOSD_011` installation in A4H passed Play through the end of the show, SAPC consistency check, and an A4H restart. This is reported live-system evidence, not a test this repository can repeat without that system.

Local checks: `npx mocha test/lsd-a4h-011.mjs test/osd-abapgit-zip.mjs` and `unzip -t` on the ZIP. These checks do not replace an A4H import, activation, SAPC consistency check, or browser test.
