import {NotFound, ReadOnly, InvalidName, NotSupported, Conflict} from "./osd-store.mjs";
import {exceptionDocument} from "./adt-documents.mjs";

// The store's errors as the statuses a client expects.
//
// One status is deliberately not used: 403. vsp reads a 403 on a modifying
// request as "your token is stale", re-fetches one and retries exactly once,
// so a 403 that means anything else costs it its only retry and then fails
// with the wrong reason. A library object that cannot be written is
// therefore 405, not 403. 403 belongs to the session layer alone.
// A refusal is a document, not a sentence.
//
// These answers were text/plain, and the catch-all beside them was already
// serving exc:exception, so the façade refused in two different languages
// depending on which one said no. The client reads only the second: a
// ResourceException built from a body it cannot parse carries no exception
// data at all, and the first thing that asks it a question dereferences null.
// That is why expanding a package produced "Cannot invoke
// IExceptionData.getNamespace() because ... getExceptionData() is null" and
// the neighbouring nodes sat on "Loading repository tree ..." forever —
// the error never became an error, so the expansion never finished failing.
//
// The type ids are the client's own vocabulary, read out of its jars rather
// than invented, so that a refusal names something it can recognise. The one
// exception is a genuine 500, which is a defect here and not a condition the
// SAP framework has a name for; it answers in this project's namespace so
// that nobody reading it mistakes our bug for a system's.
export function answered(res, body, record) {
  const safeFailed = (e) => {
    try { failed(e); } catch (failure) {
      console.error(`ADT response error after headers were sent: ${String(failure?.message ?? failure)}`);
    }
  };
  const failed = (e) => {
    if (e instanceof NotFound) {
      // a 404 from here is a different animal from a 404 off the catch-all:
      // the resource is served and the object is not there. Both are things
      // a client asked for and did not get, so both are worth recording, and
      // telling them apart is the whole value of recording them
      record?.(res.req, "object", e.message);
      refuse(res, 404, "ExceptionResourceNotFound", e.message, {properties: e.properties});
    } else if (e instanceof ReadOnly) {
      refuse(res, 405, "ExceptionResourceNoAccess", e.message);
    } else if (e instanceof InvalidName) {
      refuse(res, 400, "ExceptionInvalidRequest", e.message);
    } else if (e instanceof NotSupported) {
      refuse(res, 501, "ExceptionResourceNoAccess", e.message);
    } else if (e instanceof Conflict) {
      // the id is the one the client shows for "already exists" on a
      // save over a changed object; there is no closer one in its vocabulary
      refuse(res, 409, "ExceptionResourceIsModified", e.message);
    } else {
      refuse(res, 500, "ExceptionInternalError", String(e?.message ?? e),
        {namespace: "org.open-steamgate.osd"});
    }
  };
  try {
    const result = body();
    return result?.catch(safeFailed);
  } catch (e) {
    safeFailed(e);
  }
}

// One way of saying no, so that every no is the same shape on the wire.
export function refuse(res, status, type, message, options) {
  res.status(status).type("application/xml").send(exceptionDocument(type, message, options));
}
