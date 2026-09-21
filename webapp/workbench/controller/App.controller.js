sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageBox"
], function (Controller, JSONModel, MessageBox) {
  "use strict";

  // Absolute `/sap/...` escapes the repository prefix on GitHub Pages.
  const componentRoot = new URL(sap.ui.require.toUrl("stg/workbench") + "/", window.location.href);
  const ADT = new URL("../../../adt", componentRoot).pathname.replace(/\/$/, "");
  const attr = (node, local) => [...node.attributes].find((a) => a.localName === local)?.value || "";
  const nodes = (doc, local) => [...doc.getElementsByTagName("*")].filter((node) => node.localName === local);
  const xml = (text) => new DOMParser().parseFromString(text, "application/xml");
  const escapeXml = (text) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const short = (value) => value ? String(value).slice(0, 8) : "-";

  function findings(text) {
    const doc = xml(text);
    const checks = nodes(doc, "checkMessage").map((item) => {
      const at = attr(item, "uri").match(/#start=(\d+),(\d+)/);
      return {line: Number(at?.[1] || 1), column: Number(at?.[2] || 1),
        severity: attr(item, "type") || "E", message: attr(item, "shortText")};
    });
    const activations = nodes(doc, "msg").map((item) => {
      const at = attr(item, "href").match(/#start=(\d+),(\d+)/);
      return {line: Number(attr(item, "line") || at?.[1] || 1), column: Number(at?.[2] || 1),
        severity: attr(item, "type") || "E",
        message: nodes(item, "txt")[0]?.textContent || "Activation failed"};
    });
    return [...checks, ...activations];
  }

  return Controller.extend("stg.workbench.controller.App", {
    onInit() {
      this._token = "";
      this._etag = "";
      this._searchTimer = 0;
      this.getView().setModel(new JSONModel({
        busy: false, query: "ZCL_OSD*", objects: [], selected: {}, source: "", dirty: false,
        diagnostics: [], identity: {},
        message: {text: "Search for a class and open it.", type: "Information"}
      }), "ui");
      // Token and cookies are one handshake: no parallel first request may
      // create a second session and leave the token paired with its cookie.
      this._session().then(() => this._loadIdentity()).then(() => this._search("ZCL_OSD*"))
        .catch((error) => this._fail(error));
    },

    _model() { return this.getView().getModel("ui"); },
    _set(path, value) { this._model().setProperty(path, value); },
    _message(text, type = "Information") { this._set("/message", {text, type}); },
    _busy(value) { this._set("/busy", value); },

    async _session() {
      const response = await fetch(`${ADT}/core/discovery`, {
        method: "HEAD", headers: {"x-csrf-token": "fetch"}
      });
      if (!response.ok) throw new Error(`ADT discovery failed: HTTP ${response.status}`);
      this._token = response.headers.get("x-csrf-token") || "";
    },

    async _request(path, options = {}) {
      const headers = new Headers(options.headers || {});
      if (options.method && options.method !== "GET" && options.method !== "HEAD") {
        headers.set("x-csrf-token", this._token);
        headers.set("x-sap-adt-sessiontype", "stateful");
      }
      const canonical = "/sap/bc/adt";
      const target = path.startsWith(canonical) ? ADT + path.slice(canonical.length) : ADT + path;
      const response = await fetch(target, {...options, headers});
      if (!response.ok && response.status !== 304) {
        const detail = (await response.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        throw new Error(`${options.method || "GET"} ${path}: HTTP ${response.status}${detail ? ` — ${detail}` : ""}`);
      }
      return response;
    },

    async _loadIdentity() {
      const build = await (await this._request("/core/http/build")).json();
      const system = build.system || {};
      const identity = {commit: short(build.commit), source: short(system.source),
        live: short(system.live), serving: short(system.serving), synchronized: system.synchronized === true,
        sourceFull: system.source || "", liveFull: system.live || "", servingFull: system.serving || ""};
      this._set("/identity", identity);
      return identity;
    },

    onSearch(event) { this._search(event.getParameter("query") || event.getSource().getValue()); },
    onSearchLive(event) {
      clearTimeout(this._searchTimer);
      const value = event.getParameter("newValue");
      this._searchTimer = setTimeout(() => this._search(value), 250);
    },
    async _search(query) {
      const wanted = String(query || "").trim();
      if (!wanted) return;
      try {
        const response = await this._request(
          `/repository/informationsystem/search?operation=quickSearch&query=${encodeURIComponent(wanted)}` +
          `&objectType=${encodeURIComponent("CLAS/OC")}&maxResults=100`
        );
        const doc = xml(await response.text());
        this._set("/objects", nodes(doc, "objectReference").map((item) => ({
          name: attr(item, "name"), uri: attr(item, "uri"), type: attr(item, "type"),
          packageName: attr(item, "packageName"), description: attr(item, "description")
        })));
      } catch (error) { this._fail(error); }
    },

    async onObjectSelect(event) {
      const object = event.getParameter("listItem").getBindingContext("ui").getObject();
      if (this._model().getProperty("/dirty")) {
        const action = await new Promise((resolve) => MessageBox.confirm(
          "Discard the unsaved editor buffer?", {onClose: resolve}
        ));
        if (action !== MessageBox.Action.OK) return;
      }
      this._busy(true);
      try {
        const response = await this._request(object.uri + "/source/main");
        const source = await response.text();
        this._etag = response.headers.get("etag") || "";
        this._set("/selected", object);
        this._set("/source", source);
        this._set("/dirty", false);
        this._showDiagnostics([]);
        this._message(`${object.name} opened.`, "Success");
      } catch (error) { this._fail(error); }
      finally { this._busy(false); }
    },

    onSourceChange(event) {
      // The editor owns its live buffer. Feeding every keystroke back through
      // the JSON model re-renders the editor and can overwrite its own caret.
      // Programmatic source loads also fire this event, so dirty is a real
      // comparison with the stored baseline rather than simply "changed".
      const value = event.getParameter("value") ?? this.byId("source").getCurrentValue();
      const dirty = value !== this._model().getProperty("/source");
      if (dirty !== this._model().getProperty("/dirty")) this._set("/dirty", dirty);
    },

    _checkBody(object, source) {
      return `<?xml version="1.0" encoding="UTF-8"?>` +
        `<chkrun:checkObjectList xmlns:chkrun="http://www.sap.com/adt/checkrun" xmlns:adtcore="http://www.sap.com/adt/core">` +
        `<chkrun:checkObject adtcore:uri="${object.uri}" chkrun:version="active"><chkrun:artifacts>` +
        `<chkrun:artifact chkrun:contentType="text/plain; charset=utf-8" chkrun:uri="${object.uri}/source/main">` +
        `<chkrun:content>${escapeXml(source)}</chkrun:content></chkrun:artifact>` +
        `</chkrun:artifacts></chkrun:checkObject></chkrun:checkObjectList>`;
    },
    _showDiagnostics(items) {
      this._set("/diagnostics", items);
      this.byId("source").setDiagnostics(items);
    },
    async _check() {
      const object = this._model().getProperty("/selected");
      const source = this.byId("source").getCurrentValue();
      const response = await this._request("/checkruns?reporters=abapCheckRun", {
        method: "POST", headers: {"content-type": "application/*"}, body: this._checkBody(object, source)
      });
      const text = await response.text();
      const reports = nodes(xml(text), "checkReport");
      if (reports.length === 0) throw new Error("Check returned no report.");
      const incomplete = reports.find((report) => attr(report, "status") !== "processed");
      if (incomplete) {
        throw new Error("Check did not complete: " +
          (attr(incomplete, "statusText") || attr(incomplete, "status")));
      }
      const items = findings(text);
      this._showDiagnostics(items);
      this._message(items.length ? `${items.length} problem(s). Nothing was saved or activated.`
        : "Check passed. Nothing was saved or activated.", items.length ? "Error" : "Success");
      return items.length === 0;
    },
    async onCheck() {
      this._busy(true);
      try { await this._check(); } catch (error) { this._fail(error); }
      finally { this._busy(false); }
    },

    async _save() {
      const object = this._model().getProperty("/selected");
      const source = this.byId("source").getCurrentValue();
      const locked = await this._request(`${object.uri}?_action=LOCK&accessMode=MODIFY`, {method: "POST"});
      const handle = (await locked.text()).match(/<LOCK_HANDLE>([^<]*)<\/LOCK_HANDLE>/)?.[1] || "";
      if (!handle) throw new Error(`${object.name} is read-only in this system.`);
      try {
        const saved = await this._request(`${object.uri}/source/main?lockHandle=${encodeURIComponent(handle)}`, {
          method: "PUT", headers: {"content-type": "text/plain; charset=utf-8",
            ...(this._etag ? {"if-match": this._etag} : {})}, body: source
        });
        this._etag = saved.headers.get("etag") || this._etag;
        this._set("/source", source);
        this._set("/dirty", false);
        this._message("Saved as inactive source. Runtime is unchanged until Activate.", "Success");
      } finally {
        await this._request(`${object.uri}?_action=UNLOCK&lockHandle=${encodeURIComponent(handle)}`, {method: "POST"});
      }
    },
    async onSave() {
      this._busy(true);
      try { await this._save(); await this._loadIdentity(); } catch (error) { this._fail(error); }
      finally { this._busy(false); }
    },

    async onActivate() {
      this._busy(true);
      try {
        if (!(await this._check())) return;
        if (this._model().getProperty("/dirty")) await this._save();
        const object = this._model().getProperty("/selected");
        const body = `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">` +
          `<adtcore:objectReference adtcore:uri="${object.uri}" adtcore:name="${object.name}"/>` +
          `</adtcore:objectReferences>`;
        const response = await this._request("/activation?method=activate&preauditRequested=true", {
          method: "POST", headers: {"content-type": "application/xml",
            ...(this._etag ? {"if-match": this._etag} : {})}, body
        });
        const text = await response.text();
        const items = findings(text);
        const successful = /activationExecuted="true"/.test(text) && items.length === 0;
        this._showDiagnostics(items);
        const identity = await this._loadIdentity();
        let message = String(items.length || 1) + " activation problem(s). Current source, live and serving identities are shown above.";
        if (successful && identity.synchronized && identity.servingFull === identity.liveFull && identity.servingFull !== "") {
          message = "Activated and serving generation " + identity.serving + ".";
        } else if (successful && identity.sourceFull === identity.liveFull && identity.sourceFull !== "") {
          message = "Activated and built, but the serving runtime has not switched to this generation; restart or child runtime is required.";
        } else if (successful) {
          message = "Activation was accepted, but source, live and serving identities are not synchronized.";
        }
        this._message(message, successful ? (identity.synchronized ? "Success" : "Warning") : "Error");
      } catch (error) { this._fail(error); }
      finally { this._busy(false); }
    },

    onProblemSelect(event) {
      const item = event.getParameter("listItem").getBindingContext("ui").getObject();
      this.byId("source").reveal(item.line, item.column);
    },
    _fail(error) { this._message(error.message || String(error), "Error"); }
  });
});
