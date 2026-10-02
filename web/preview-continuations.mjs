// Preview and its service worker cannot perform Node host work. For every
// kind retain the front's current unregistered-kind 500 document, byte for
// byte. A browser continuation slice starts here; it must supply RESUME in
// a new dialog step before replacing this stub.
export function previewContinuation(kind) {
  const esc = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const message = esc(`ZCL_OSD_ADT_HANDLER: no continuation ${JSON.stringify(kind)} is registered on this host`);
  const body = `<?xml version="1.0" encoding="utf-8"?>
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <namespace id="org.open-steamgate.osd"/>
  <type id="ExceptionInternalError"/>
  <message lang="EN">${message}</message>
  <localizedMessage lang="EN">${message}</localizedMessage>
  <properties/>
</exc:exception>
`;
  return {status: 500, headers: new Headers({"content-type": "application/xml; charset=utf-8"}), body: new TextEncoder().encode(body)};
}

// ICF record adapter shared by preview-backend and its service worker. No
// Node facade is mounted in these hosts. Only continuations use the stub;
// ordinary ICF answers retain the handler's status, headers and body.
export async function previewAdtAnswer(handler, {method, path, search = "", headers = {}, body}) {
  const a = globalThis.abap;
  const params = handler.METHODS.ANSWER.parameters;
  const request = params.IS_REQUEST.type();
  const r = request.get();
  r.method.set(String(method || "GET").toUpperCase()); r.path.set(path); r.uri.set(path + search);
  r.body.set(Array.from(body ?? [], (v) => v.toString(16).padStart(2, "0")).join("").toUpperCase());
  for (const [name, value] of new URLSearchParams(search)) {
    const row = r.query.appendInitial().get(); row.name.set(name); row.value.set(value);
  }
  for (const [name, value] of Object.entries(headers)) {
    const row = r.headers.appendInitial().get(); row.name.set(name); row.value.set(String(value));
  }
  const response = params.ES_RESPONSE.type();
  const servedBy = new a.types.String();
  await handler.answer({is_request: request, es_response: response, ev_served_by: servedBy});
  const s = response.get();
  const kind = s.continuation.get().kind.get();
  if (kind) return previewContinuation(kind);
  const resultHeaders = new Headers();
  if (servedBy.get() === "HOST") resultHeaders.set("x-osd-served-by", "HOST");
  for (const row of s.headers.array()) resultHeaders.append(row.get().name.get(), row.get().value.get());
  resultHeaders.set("content-type", s.content_type.get() || "text/html");
  return {status: s.status.get() || 200, headers: resultHeaders, body: new TextEncoder().encode(s.body.get())};
}
