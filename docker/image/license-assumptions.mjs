// These approvals apply to the reviewed commits, not to every later commit
// in the same forks. A changed lock ref needs its own license review.
const approved = new Map([
  ["oisee/open-abap-odata", "bd9f1fb175e7b26678e48eb2e311a278a13ef91b"],
  // f1fbd36 = 238c5bfe (reviewed) + the converter's native mode (open-steamgate's
  // own MIT code, oisee/open-abap-gui#1); LICENSE and package.json unchanged.
  ["oisee/open-abap-gui", "f1fbd36ed54ab7ac3e7b35afef42b0beb265c455"],
]);

export function approvedLicenseAssumption(source) {
  return approved.has(source.repo) && approved.get(source.repo) === source.ref
    && source.licenseAssumption?.license === "MIT";
}
