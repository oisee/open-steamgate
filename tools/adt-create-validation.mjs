// Read-only preflight for the creation wizards; create still checks under its
// mutation lock, so passing this request never reserves a repository name.
import {nameProblem, packageChildName} from "./osd-object-name.mjs";
import {xmlEscape} from "./adt-documents.mjs";
const kinds = {"CLAS/OC": "CLAS", "INTF/OI": "INTF", "DEVC/K": "DEVC", "PROG/P": "PROG", "PROG/I": "INCL"};
export function validateCreation(store, input) {
  const type = kinds[String(input.objtype ?? "").toUpperCase()];
  const name = String(input.objname ?? "").toUpperCase();
  const parent = String(input.packagename ?? "").toUpperCase();
  let message;
  if (!type) message = "Unsupported object type";
  else if (input.kind === "PACKAGE" && type !== "DEVC" || input.kind === "OO" && !["CLAS", "INTF"].includes(type)) message = "Object type does not match the validation resource";
  else if ((message = nameProblem(type, name)) !== undefined) { /* repository name policy */ }
  else if (store.find(type, name)) message = `${type} ${name} already exists`;
  else {
    const home = store.find("DEVC", parent);
    if (!home) message = `Package ${parent || "(missing)"} does not exist`;
    else if (home.writable === false) message = `Package ${parent} is read-only`;
    else if (type === "DEVC" && !packageChildName(parent, name)) message = `A package under ${parent} must be named ${parent}_<FOLDER>`;
  }
  return {success: message === undefined, message: message ?? ""};
}
export function validationDocument(result) {
  return `<?xml version="1.0" encoding="utf-8"?>\n<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA><CHECK_RESULT>${result.success ? "X" : ""}</CHECK_RESULT><SEVERITY>${result.success ? "SUCCESS" : "ERROR"}</SEVERITY><SHORT_TEXT>${xmlEscape(result.message)}</SHORT_TEXT></DATA></asx:values></asx:abap>`;
}
