// One-time HANA Express password preparation for the all-in-one demo stack.
// This runs as root in a short-lived container, never in the OSD server.
import {chownSync, chmodSync, existsSync, readFileSync, writeFileSync} from "node:fs";

if (process.env.ACCEPT_SAP_LICENSE !== "YES") {
  throw new Error("Set ACCEPT_SAP_LICENSE=YES after accepting the SAP HANA Express license");
}
const password = process.env.HANA_PASSWORD;
if (!password) throw new Error("HANA_PASSWORD is required");
const dir = "/hana/mounts";
const file = `${dir}/password.json`;
chownSync(dir, 12000, 79); // hxeadm:sapsys in the pinned HXE image
chmodSync(dir, 0o700);
if (existsSync(file)) {
  if (JSON.parse(readFileSync(file, "utf8")).master_password !== password) {
    throw new Error("The existing HXE volume has a different password; reuse it or use a new Stack name");
  }
} else {
  writeFileSync(file, JSON.stringify({master_password: password}), {mode: 0o600});
}
chownSync(file, 12000, 79);
chmodSync(file, 0o600);
