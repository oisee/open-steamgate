// DSL L3: resilience as generated, traced features (docs/dsl-l3.md,
// "Resilience"). A set's `resilience:` block gives its runner a retry budget
// with a backoff, a stale time after which the doctor takes over a lock, a
// pile or a gate, two fuses (a maximum of alerts per rule and run, and a kill
// switch row), a dry-run default and a retention period. Every value becomes
// a constant or a branch of the generated runner and traces to its own line
// of the manifest. tools/dsl-l3.mjs calls this; it knows the set language and
// nothing of any domain.

export const RESILIENCE_KEYS = ["retry", "stale", "fuses", "dry_run", "keep", "doctor"];
// the generic tables the runner knows: the kill switch and the doctor's audit
export const KILL_TABLE = "ZOSD_L3_KILL";
export const DOCTOR_TABLE = "ZOSD_L3_DOCTOR";
const INT4 = {built_in: "INT4"};
const CHAR = (length) => ({built_in: "CHAR", length});
const MAX_INT4 = 2147483647;

// A whole number from `min` to `max`, or a refusal at the key's line.
const whole = (value, {min, max, at, fail, what}) => {
  if (!/^[0-9]{1,10}$/.test(String(value ?? "")) || Number(value) < min || Number(value) > max) {
    fail(at, `${what} is a whole number from ${min} to ${max}, not ${JSON.stringify(value)}`);
  }
  return String(Number(value));
};

// `resilience: {retry: {max, backoff}, stale, fuses: {max_alerts, kill}, dry_run, keep: {days}}`.
// Needs stages: the doctor reads the gates, and only a staged run completes in
// its jobs. Needs the alert sink's generated capture variant: a dry run binds it.
export function compileResilience(doc, {id, set, line, fail, staged, sink, schedule}) {
  if (doc.resilience === undefined) return undefined;
  const spec = doc.resilience;
  const map = (value, key, what) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(line(key), `${key} is ${what}`);
    return value;
  };
  map(spec, "resilience", "a mapping of retry, stale, fuses, dry_run and keep");
  for (const key of Object.keys(spec)) if (!RESILIENCE_KEYS.includes(key)) fail(line(`resilience/${key}`), `unknown key ${key} in resilience (${RESILIENCE_KEYS.join(", ")})`);
  if (!staged) fail(line("resilience"), "resilience needs stages: the doctor reads a run's stage gates, and only a staged run completes in its jobs; give the set stages:");
  const capture = sink.variants.find((v) => v.name === "capture" && v.generated);
  if (!capture) fail(line("resilience"), `resilience needs the generated capture variant of sink ${sink.name} (capture: generated): a dry run binds it, so nothing reaches the log`);
  const node = (key, extra) => ({"@id": `${id}/resilience/${key}`, set_line: line(`resilience/${key}`), ...extra});

  // retry: {max, backoff}: a FAILED or vanished pile is submitted again up to
  // max times, backoff seconds after it failed, doubled per attempt
  const retrySpec = map(spec.retry ?? {}, "resilience/retry", "{max, backoff}");
  for (const key of Object.keys(retrySpec)) if (!["max", "backoff"].includes(key)) fail(line(`resilience/retry/${key}`), `unknown key ${key} in retry (max, backoff)`);
  const retryAt = (key) => line(spec.retry === undefined ? "resilience" : retrySpec[key] === undefined ? "resilience/retry" : `resilience/retry/${key}`);
  const retry = {"@id": `${id}/resilience/retry`, set_line: line(spec.retry === undefined ? "resilience" : "resilience/retry"),
    max: whole(retrySpec.max ?? "0", {min: 0, max: 99, at: retryAt("max"), fail, what: "retry.max"}), "max@type": INT4,
    backoff: whole(retrySpec.backoff ?? "0", {min: 0, max: 86400, at: retryAt("backoff"), fail, what: "retry.backoff (seconds)"}), "backoff@type": INT4};

  // stale: seconds after which a HELD lock, a pile without its job or an OPEN gate without piles is the doctor's
  if (spec.stale === undefined) fail(line("resilience"), "resilience needs stale: the seconds after which the doctor takes over a lock, a pile or a gate");
  const stale = node("stale", {seconds: whole(spec.stale, {min: 60, max: 99 * 3600, at: line("resilience/stale"), fail, what: "stale (seconds)"}), "seconds@type": INT4});
  // the doctor's own job with a schedule: every stale seconds, rounded to minutes (hours past 99 minutes)
  if (schedule) {
    const minutes = Math.max(1, Math.round(Number(stale.seconds) / 60));
    const [field, count, unit] = minutes <= 99 ? ["prdmins", minutes, "minutes"] : ["prdhours", Math.round(minutes / 60), "hours"];
    stale.job = {name: `L3_${set.toUpperCase()}_DOC`, "name@type": CHAR(32), field, count: String(count), "count@type": INT4, word: `${count} ${unit}`};
  }

  const doctorSpec = map(spec.doctor ?? {}, "resilience/doctor", "{as: [daemon, event, job], tick, every}");
  for (const key of Object.keys(doctorSpec)) if (!["as", "tick", "every"].includes(key)) fail(line(`resilience/doctor/${key}`), `unknown doctor key ${key}`);
  const mechanisms = doctorSpec.as ?? ["daemon"];
  if (!Array.isArray(mechanisms) || !mechanisms.length || mechanisms.some((m) => !["daemon", "event", "job"].includes(m)) || new Set(mechanisms).size !== mechanisms.length) {
    fail(line("resilience/doctor/as"), "doctor.as is a nonempty list of distinct daemon, event, job mechanisms");
  }
  if (!mechanisms.includes("daemon") && !mechanisms.includes("job")) {
    fail(line("resilience/doctor/as"), "doctor.as needs daemon or job to catch a silent live job");
  }
  const doctor = node("doctor", {mechanisms,
    tick: whole(doctorSpec.tick ?? "10", {min: 1, max: 3600, at: line("resilience/doctor/tick"), fail, what: "doctor.tick"}),
    every: whole(doctorSpec.every ?? "15", {min: 1, max: 99, at: line("resilience/doctor/every"), fail, what: "doctor.every (minutes)"}),
    daemon: mechanisms.includes("daemon"), event: mechanisms.includes("event"), job: mechanisms.includes("job"),
    daemon_class: `zcl_l3_${set}_dmn`, doctor_report: `zl3_${set}_doc`, daemon_class_upper: `ZCL_L3_${set.toUpperCase()}_DMN`, doctor_report_upper: `ZL3_${set.toUpperCase()}_DOC`, name: `L3_${set.toUpperCase()}_DMN`});
  doctor.autonomous = doctor.daemon || doctor.event || !schedule;
  doctor.arm_job = doctor.job && doctor.autonomous;
  doctor.wake_retry = doctor.event && !doctor.daemon && !doctor.job;
  doctor.explicit_every = doctorSpec.every !== undefined;
  // An explicit job-only manifest retains the old recipe bytes by default.
  if (doctorSpec.every !== undefined && stale.job) Object.assign(stale.job, {field: "prdmins", count: doctor.every, word: `${doctor.every} minutes`});

  // fuses: {max_alerts, kill}
  const fuseSpec = map(spec.fuses ?? {}, "resilience/fuses", "{max_alerts, kill}");
  for (const key of Object.keys(fuseSpec)) if (!["max_alerts", "kill"].includes(key)) fail(line(`resilience/fuses/${key}`), `unknown key ${key} in fuses (max_alerts, kill)`);
  const fuses = {"@id": `${id}/resilience/fuses`, set_line: line(spec.fuses === undefined ? "resilience" : "resilience/fuses")};
  if (fuseSpec.max_alerts !== undefined) {
    fuses.max_alerts = {"@id": `${id}/resilience/fuses/max_alerts`, set_line: line("resilience/fuses/max_alerts"),
      count: whole(fuseSpec.max_alerts, {min: 1, max: MAX_INT4, at: line("resilience/fuses/max_alerts"), fail, what: "fuses.max_alerts"}), "count@type": INT4};
  }
  if (fuseSpec.kill !== undefined) {
    if (String(fuseSpec.kill).toUpperCase() !== KILL_TABLE) fail(line("resilience/fuses/kill"), `fuses.kill names ${KILL_TABLE}, the generic kill switch table the runner reads (a row of the set stops it), not ${JSON.stringify(fuseSpec.kill)}`);
    fuses.kill = {"@id": `${id}/resilience/fuses/kill`, set_line: line("resilience/fuses/kill"), table: KILL_TABLE.toLowerCase()};
  }

  // dry_run: the default of run( iv_dry_run )
  const dry = spec.dry_run ?? "false";
  if (dry !== "true" && dry !== "false") fail(line("resilience/dry_run"), `dry_run is true or false, not ${JSON.stringify(dry)}`);
  const dryRun = {"@id": `${id}/resilience/dry_run`, set_line: line(spec.dry_run === undefined ? "resilience" : "resilience/dry_run"),
    value: dry === "true" ? "abap_true" : "abap_false", capture: capture.class};

  // keep: {days}: plans, worklists, gates and doctor rows of final runs older than this go
  if (spec.keep === undefined) fail(line("resilience"), "resilience needs keep: {days: <n>}, how long the plan, worklist and gate rows of a final run are kept");
  const keepSpec = map(spec.keep, "resilience/keep", "{days}");
  for (const key of Object.keys(keepSpec)) if (key !== "days") fail(line(`resilience/keep/${key}`), `unknown key ${key} in keep (days)`);
  const keep = node("keep", {days: whole(keepSpec.days, {min: 1, max: 9999, at: line(keepSpec.days === undefined ? "resilience/keep" : "resilience/keep/days"), fail, what: "keep.days"}), "days@type": INT4});

  return {"@id": `${id}/resilience`, set_line: line("resilience"), retry, stale, fuses, dry_run: dryRun, keep, doctor,
    sink_iface: sink.iface, ...(schedule ? {scheduled: {"@id": `${id}/resilience/stale`, set_line: stale.set_line}} : {})};
}

// The model's view of a resilience node: the node itself, and the two fuses
// at the root, so a template section names the one manifest line it needs.
export const resilienceNodes = (resilience) => (resilience ? {resilience,
  ...(resilience.doctor.autonomous ? {autodoctor: resilience.doctor} : {}),
  ...(resilience.doctor.daemon ? {daemon: resilience.doctor} : {}),
  ...(resilience.doctor.event ? {doctor_event: resilience.doctor} : {}),
  ...(resilience.fuses.max_alerts ? {fused: resilience.fuses.max_alerts} : {}),
  ...(resilience.fuses.kill ? {killable: resilience.fuses.kill} : {})} : {});
