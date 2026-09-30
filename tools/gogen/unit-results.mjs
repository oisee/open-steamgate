export function reconcile(expected, actual) {
  const key = (r) => `${r.class}/${r.testclass}/${r.method}`;
  const got = new Map(actual.map((r) => [key(r), r]));
  return expected.map((r) => {
    const found = got.get(key(r));
    return found ? {...r, status: found.status, message: found.message}
      : {...r, status: "FAILED", message: "runner dropped this method"};
  });
}
