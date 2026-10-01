// These approvals apply to the reviewed commits, not to every later commit
// in the same forks. A changed lock ref needs its own license review.
const approved = new Map([
  ["oisee/open-abap-odata", "bd9f1fb175e7b26678e48eb2e311a278a13ef91b"],
  // f1fbd36 = 238c5bfe (reviewed) + the converter's native mode (open-steamgate's
  // own MIT code, oisee/open-abap-gui#1); LICENSE and package.json unchanged.
  // 9b3b985 = f1fbd36 + the converter's chained-WRITE comma fix
  // (open-abap/open-abap-gui#182); LICENSE and package.json unchanged.
  ["oisee/open-abap-gui", "9b3b985976e87e0cbe19eb23affa7356cca32353"],
]);

export function approvedLicenseAssumption(source) {
  return approved.has(source.repo) && approved.get(source.repo) === source.ref
    && source.licenseAssumption?.license === "MIT";
}
