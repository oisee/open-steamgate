import {expect} from "chai";
import {startServer} from "./start.mjs";
// the port of the gateway under test: STG_PORT, as test/start.mjs reads it, so sessions do not collide on 3030
const PORT = process.env.STG_PORT ?? 3030;

// A click in HTML rendered through cl_gui_html_viewer comes back into ABAP as
// sapevent, against abapGit's own markup (backlog G.2, docs/webgui.md).
//
// ZCL_OSD_SAPEVENT draws abapGit's document into abapGit's own viewer wrapper
// (zcl_abapgit_html_viewer_gui over cl_gui_html_viewer), the rendering turns
// its sapevent anchors and forms into forms posting back to the same path,
// and a POST is dispatched to the viewer, which raises the event; the handler
// does what zcl_abapgit_gui=>on_event does, builds zcl_abapgit_gui_event, and
// the answer is what that class made of the click.
//
// The browser is played by this test: it reads the rendered forms out of the
// page the way a browser would and posts what a browser posts. The real
// browser does the same in test/e2e/sapevent.spec.mjs.
const BASE = `http://localhost:${PORT}/sap/bc/gui/sap/its/webgui/sapevent/`;

// the srcdoc attribute of the viewer's iframe, unescaped: the document the
// browser would show inside the frame
function frameDocument(page) {
  const match = /srcdoc="([^"]*)"/.exec(page);
  expect(match, "the HTML viewer's iframe").to.not.equal(null);
  return match[1]
    .replaceAll("&quot;", "\"")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

// every <form ...>...</form> of a document, with its action and the fields a
// browser would submit: hidden inputs, text inputs (with a value the test
// fills in), and the submit button that was clicked, if it has a name
function forms(doc) {
  const out = [];
  const re = /<form([^>]*)>([\s\S]*?)<\/form>/g;
  let m;
  while ((m = re.exec(doc)) !== null) {
    const attrs = m[1];
    const body = m[2];
    const action = /action="([^"]*)"/.exec(attrs)?.[1] ?? "";
    const id = /id="([^"]*)"/.exec(attrs)?.[1] ?? "";
    const inputs = [...body.matchAll(/<(input|button|select)([^>]*)>/g)].map(([, tag, a]) => ({
      tag,
      type: /type="([^"]*)"/.exec(a)?.[1] ?? "text",
      name: /name="([^"]*)"/.exec(a)?.[1],
      value: /value="([^"]*)"/.exec(a)?.[1] ?? "",
      formaction: /formaction="([^"]*)"/.exec(a)?.[1],
      label: body.slice(body.indexOf(a) + a.length + 1, body.indexOf("</button>", body.indexOf(a))),
    }));
    out.push({action, id, body, inputs});
  }
  return out;
}

// what a browser posts for a form: the fields in document order, the clicked
// submit included when it has a name, application/x-www-form-urlencoded
function submit(form, filled = {}, clicked) {
  const params = new URLSearchParams();
  for (const one of form.inputs) {
    if (one.name === undefined) {
      continue;
    }
    if (one.type === "hidden") {
      params.append(one.name, one.value);
    } else if (one.type === "submit") {
      if (one === clicked) {
        params.append(one.name, one.value);
      }
    } else if (one.tag === "select") {
      params.append(one.name, filled[one.name] ?? "PREFIX");
    } else {
      params.append(one.name, filled[one.name] ?? one.value);
    }
  }
  const url = new URL(clicked?.formaction ?? form.action, BASE);
  return fetch(url, {method: "POST", headers: {"content-type": "application/x-www-form-urlencoded"}, body: params.toString()});
}

function upper(map) {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toUpperCase(), v]));
}

describe("sapevent: a click in abapGit's markup comes back into ABAP", () => {
  let server;
  let page;
  let doc;

  before(async () => {
    server = startServer(true);
    page = await (await fetch(BASE)).text();
    doc = frameDocument(page);
  });

  after(() => {
    server.close();
  });

  it("renders abapGit's document inside a sandboxed HTML viewer, its sapevents rewritten", () => {
    expect(page).to.contain('title="HTML viewer"');
    expect(page).to.contain('sandbox="allow-forms allow-top-navigation-by-user-activation"');
    // abapGit's anchor, written by zcl_abapgit_html=>a, is gone from the document ...
    expect(doc).to.not.contain('href="sapevent:');
    expect(doc).to.not.contain('action="sapevent:');
    expect(doc).to.not.contain('formaction="sapevent:');
    // ... and its data-sapevent marker, which is abapGit's, is still there
    expect(doc).to.contain('data-sapevent="select?key=000000000001"');
    // the form of the "New Online Repository" page posts back here, the action in its url
    expect(doc).to.contain(`action="${new URL(BASE).pathname}?sapevent=add-repo-online" target="_top"`);
    expect(doc).to.contain(`formaction="${new URL(BASE).pathname}?sapevent=choose-package"`);
    // every rewritten form names the viewer it belongs to
    expect(doc).to.match(/name="gg_control" value="GUI-\d+"/);
  });

  it("an anchor of the repository list: the event arrives with the action and the query abapGit wrote", async () => {
    const all = forms(doc);
    const repo = all.find((f) => f.inputs.some((i) => i.name === "sapevent" && i.value === "select?key=000000000002"));
    expect(repo, "the form made of the second repository's anchor").to.not.equal(undefined);
    const button = repo.inputs.find((i) => i.name === "sapevent");
    const res = await submit(repo, {}, button);
    expect(res.status).to.equal(200);
    const trace = await res.json();
    expect(trace.dispatched).to.equal(true);
    expect(trace.raised).to.equal(1);
    // zcl_abapgit_gui_event: mv_action is the url before "?", lower-cased
    expect(trace.action).to.equal("select");
    // and query( ) is the text after it, parsed the way abapGit parses it: into
    // a case-insensitive zcl_abapgit_string_map, which keeps its keys upper-cased
    expect(trace.getdata).to.equal("key=000000000002");
    expect(trace.query).to.deep.equal({KEY: "000000000002"});
    expect(trace.postdata).to.deep.equal([]);
    expect(trace.error).to.equal("");
  });

  it("the New Online Repository form: the fields arrive as abapGit's form_data( )", async () => {
    const form = forms(doc).find((f) => f.id === "add-repo-online-form");
    expect(form, "the add-repo-online form").to.not.equal(undefined);
    const filled = {
      url: "https://github.com/oisee/open-steamgate.git",
      package: "$OSD",
      branch_name: "refs/heads/main",
      display_name: "open steamgate & friends, 100% offline",
    };
    // the main button has no name and no formaction: the form's own action
    const res = await submit(form, filled);
    expect(res.status).to.equal(200);
    const trace = await res.json();
    expect(trace.dispatched).to.equal(true);
    expect(trace.action).to.equal("add-repo-online");
    expect(trace.getdata).to.equal("");
    // postdata: the document's own fields, nothing of the transport's, the
    // text as typed and only the pair delimiters escaped
    expect(trace.postdata).to.have.length(1);
    expect(trace.postdata[0]).to.equal(
      "url=https://github.com/oisee/open-steamgate.git&package=$OSD&branch_name=refs/heads/main" +
      "&display_name=open steamgate %26 friends, 100%25 offline&folder_logic=PREFIX",
    );
    expect(trace.postdata[0]).to.not.contain("gg_control");
    // and what abapGit reads out of it, through its own event class: the
    // string map's keys are upper-cased, the values are what was typed
    expect(trace.form).to.deep.equal(upper({...filled, folder_logic: "PREFIX"}));
    expect(trace.error).to.equal("");
  });

  it("a side action of the same form: the submit's own formaction is the event", async () => {
    const form = forms(doc).find((f) => f.id === "add-repo-online-form");
    const choose = form.inputs.find((i) => i.type === "submit" && i.formaction?.includes("choose-branch"));
    expect(choose, "the branch picker").to.not.equal(undefined);
    const res = await submit(form, {url: "https://example.org/r.git"}, choose);
    const trace = await res.json();
    expect(trace.dispatched).to.equal(true);
    expect(trace.action).to.equal("choose-branch");
    expect(trace.form.URL).to.equal("https://example.org/r.git");
  });

  it("a long form fills the post data lines to their width, and abapGit joins them back", async () => {
    const form = forms(doc).find((f) => f.id === "add-repo-online-form");
    const long = "x".repeat(700);
    const res = await submit(form, {url: "https://example.org/r.git", display_name: long});
    const trace = await res.json();
    expect(trace.postdata.length).to.be.greaterThan(2);
    for (const line of trace.postdata.slice(0, -1)) {
      expect(line.length).to.equal(256);
    }
    expect(trace.form.DISPLAY_NAME).to.equal(long);
  });

  it("a post that names no viewer of this process is not dispatched", async () => {
    const res = await fetch(BASE, {
      method: "POST",
      headers: {"content-type": "application/x-www-form-urlencoded"},
      body: "gg_control=GUI-999&sapevent=select",
    });
    const trace = await res.json();
    expect(trace.dispatched).to.equal(false);
  });
});
