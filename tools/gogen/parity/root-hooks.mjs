// mocha --require: one record per test -- its title, its outcome and the
// requests it sent to the server under test -- written to PARITY_OUT at exit.
import {writeFileSync} from "node:fs";

const records = [];
const probe = () => globalThis.__parity;

export const mochaHooks = {
  beforeEach() {
    if (probe()) probe().current = {requests: []};
  },
  afterEach() {
    const t = this.currentTest;
    const p = probe();
    records.push({
      title: t.fullTitle(),
      state: t.state ?? (t.pending ? "pending" : "unknown"),
      duration: t.duration,
      err: t.err ? {message: String(t.err.message ?? t.err).slice(0, 800), expected: short(t.err.expected), actual: short(t.err.actual), timeout: /Timeout of \d+ms/.test(String(t.err.message))} : undefined,
      requests: p?.current?.requests ?? [],
    });
    if (p) p.current = undefined;
  },
};

function short(v) {
  if (v === undefined) return undefined;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s === undefined ? undefined : s.slice(0, 300);
}

process.on("exit", () => {
  if (process.env.PARITY_OUT) writeFileSync(process.env.PARITY_OUT, JSON.stringify(records));
});
