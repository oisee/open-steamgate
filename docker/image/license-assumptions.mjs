// These approvals apply to the reviewed commits, not to every later commit
// in the same forks. A changed lock ref needs its own license review.
const approved = new Map([
  ["oisee/open-abap-odata", "bd9f1fb175e7b26678e48eb2e311a278a13ef91b"],
  ["oisee/open-abap-gui", "238c5bfe8fd9cbc2d52e98bed650aaabfa61dc30"],
]);

export function approvedLicenseAssumption(source) {
  return approved.has(source.repo) && approved.get(source.repo) === source.ref
    && source.licenseAssumption?.license === "MIT";
}
