sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/ui/model/Sorter",
  "sap/ui/core/Title",
  "sap/m/Label",
  "sap/m/Input",
  "sap/m/Dialog",
  "sap/m/Button",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
], function (Controller, JSONModel, Filter, FilterOperator, Sorter, Title, Label, Input, Dialog, Button, MessageToast, MessageBox) {
  "use strict";

  // The tree SEGW shows, in terms of the entity sets of ZSTG_SEGW_SRV (one
  // per /IWBEP/I_SB* table). A folder lists the rows of a set below a
  // parent; `by` names the property that points at the parent's NODE_UUID,
  // `text` the property shown, `children` the folders under each row.
  const TREE = [
    {text: "Data Model", icon: "sap-icon://tree", children: [
      {text: "Entity Types", set: "EntityTypeSet", entity: "EntityType", icon: "sap-icon://database", children: [
        {text: "Properties", set: "PropertySet", entity: "Property", by: "ParentUuid", icon: "sap-icon://text"},
        {text: "Navigation Properties", set: "NavPropertySet", entity: "NavProperty", by: "EntityGuid", icon: "sap-icon://chain-link"},
      ]},
      {text: "Complex Types", set: "ComplexTypeSet", entity: "ComplexType", icon: "sap-icon://group-2", children: [
        {text: "Properties", set: "PropertySet", entity: "Property", by: "ParentUuid", icon: "sap-icon://text"},
      ]},
      {text: "Associations", set: "AssociationSet", entity: "Association", icon: "sap-icon://connected", children: [
        {text: "Referential Constraints", set: "RefConstraintSet", entity: "RefConstraint", by: "AssociationGuid", icon: "sap-icon://key"},
      ]},
      {text: "Entity Sets", set: "EntitySetSet", entity: "EntitySet", icon: "sap-icon://list"},
      {text: "Association Sets", set: "AssociationSetSet", entity: "AssociationSet", icon: "sap-icon://multiselect-all"},
      {text: "Function Imports", set: "FunctionImportSet", entity: "FunctionImport", icon: "sap-icon://action", children: [
        {text: "Parameters", set: "FunctionParamSet", entity: "FunctionParam", by: "FunctionImport", icon: "sap-icon://text"},
      ]},
    ]},
    {text: "Service Implementation", icon: "sap-icon://provision", children: [
      {text: "", set: "ServiceEntitySet", entity: "ServiceEntity", icon: "sap-icon://list", children: [
        {text: "", set: "OperationSet", entity: "Operation", by: "ParentUuid", icon: "sap-icon://process", children: [
          {text: "", set: "MappingHeaderSet", entity: "MappingHeader", by: "ParentUuid", icon: "sap-icon://map-2", children: [
            {text: "", set: "MappingPropertySet", entity: "MappingProperty", by: "ParentUuid", icon: "sap-icon://arrow-right"},
          ]},
        ]},
      ]},
    ]},
    {text: "Data Sources", set: "DataSourceSet", entity: "DataSource", icon: "sap-icon://source-code"},
    {text: "Runtime Artifacts", set: "ArtifactSet", entity: "Artifact", icon: "sap-icon://syntax"},
    {text: "Service Maintenance", set: "ServiceSet", entity: "Service", icon: "sap-icon://settings"},
  ];
  // the text table of a node's table, where SEGW keeps the label
  const TEXTS = {
    Project: "ProjectTextSet", Model: "ModelTextSet", EntityType: "EntityTypeTextSet", Property: "PropertyTextSet",
    EntitySet: "EntitySetTextSet", NavProperty: "NavPropertyTextSet", AssociationSet: "AssociationSetTextSet",
    FunctionImport: "FunctionImportTextSet", FunctionParam: "FunctionParamTextSet", DataSource: "DataSourceTextSet",
    ComplexType: "ComplexTypeTextSet",
  };
  const label = (row, entity) => {
    if (entity === "MappingProperty") {
      // property (or constant) and the module parameter it maps to
      const source = row.PropertyPath || ("'" + (row.ConstantVal || "") + "'");
      return row.Direction === "O" ? source + " <- " + row.DsAttPath : source + " -> " + row.DsAttPath;
    }
    return row.Name || row.TechnicalName || row.TrobjName || row.DsGroup || row.NodeUuid;
  };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/[^0-9a-f]/gi, "").toUpperCase().padEnd(32, "0").slice(0, 32);

  return Controller.extend("stg.segw.controller.App", {
    onInit() {
      this.getView().setModel(new JSONModel({nodes: []}), "tree");
      this.getView().setModel(new JSONModel({}), "node");
      const model = this.getOwnerComponent().getModel();
      model.metadataLoaded().then(() => {
        // the first project once the Select has its items
        const select = this.byId("project");
        const binding = select.getBinding("items");
        const first = () => {
          if (select.getSelectedItem() === null && select.getItems().length > 0) {
            select.setSelectedItem(select.getItems()[0]);
          }
          if (select.getSelectedKey()) {
            binding.detachDataReceived(first);
            this.loadProject(select.getSelectedKey());
          }
        };
        binding.attachDataReceived(first);
        first();
      });
    },

    // an abapGit IWPR file into the tables: POST ImportSet {Content}, the
    // service replaces the project's rows (zcl_stg_segw_import), then the
    // project list and the tree are read again
    onImport() {
      let input = document.getElementById("stg-segw-import");
      if (!input) {
        input = document.createElement("input");
        input.type = "file";
        input.id = "stg-segw-import";
        input.accept = ".xml";
        input.hidden = true;
        input.addEventListener("change", () => {
          const file = input.files[0];
          input.value = "";
          if (!file) {
            return;
          }
          file.text().then((content) => this.importIwpr(content, file.name));
        });
        document.body.appendChild(input);
      }
      input.click();
    },

    importIwpr(content, name) {
      const model = this.getOwnerComponent().getModel();
      model.create("/ImportSet", {Content: content}, {
        success: (data) => {
          MessageToast.show(name + ": " + data.Rows + " rows in " + data.Tables + " tables of " + data.Project);
          const select = this.byId("project");
          const binding = select.getBinding("items");
          const pick = () => {
            binding.detachDataReceived(pick);
            select.setSelectedKey(data.Project);
            this.loadProject(data.Project);
          };
          binding.attachDataReceived(pick);
          binding.refresh(true);
        },
        error: (e) => MessageBox.error(String(e && (e.responseText || e.message))),
      });
      model.submitChanges();
    },

    onProjectChange(event) {
      this.loadProject(event.getParameter("selectedItem").getKey());
    },

    // one $batch of GETs: every set the tree shows, this project's rows in
    // STG_SEQ order, then the tree is assembled here by parent UUID
    async loadProject(project) {
      this.project = project;
      this.select(null);
      const model = this.getOwnerComponent().getModel();
      const sets = new Set();
      const collect = (folders) => folders.forEach((f) => { if (f.set) { sets.add(f.set); } if (f.children) { collect(f.children); } });
      collect(TREE);
      const rows = {};
      await Promise.all([...sets].map((set) => this.read(model, set, project).then((r) => { rows[set] = r; })));
      const folder = (spec, parent, indexFolder) => {
        const list = (rows[spec.set] || []).filter((r) => !spec.by || r[spec.by] === parent.NodeUuid);
        const nodes = list.map((r) => ({
          text: label(r, spec.entity), icon: spec.icon, entity: spec.entity, set: spec.set, row: r,
          path: "/" + model.createKey(spec.set, {Project: r.Project, NodeUuid: r.NodeUuid}),
          nodes: (spec.children || []).map((c) => folder(c, r, true)).filter((n) => n.nodes.length > 0 || n.text !== ""),
        }));
        return indexFolder && spec.text === "" ? {text: "", nodes} : {text: spec.text, icon: spec.icon, nodes};
      };
      const build = (spec, parent) => {
        if (spec.set) {
          const f = folder(spec, parent, false);
          // a nameless level lists its rows directly under the parent
          return f;
        }
        return {text: spec.text, icon: spec.icon, nodes: spec.children.map((c) => build(c, parent))};
      };
      const projectRow = (await this.read(model, "ProjectSet", project))[0] || {Project: project};
      const root = {
        text: project, icon: "sap-icon://folder-blank", entity: "Project", set: "ProjectSet", row: projectRow,
        path: "/" + model.createKey("ProjectSet", {Project: projectRow.Project, NodeUuid: projectRow.NodeUuid}),
        nodes: TREE.map((spec) => build(spec, projectRow)),
      };
      // nameless folders (the service implementation levels) collapse into their parent
      const flatten = (n) => {
        n.nodes = (n.nodes || []).flatMap((c) => (c.text === "" && !c.path ? c.nodes.map(flatten) : [flatten(c)]));
        return n;
      };
      this.getView().getModel("tree").setData({nodes: [flatten(root)]});
      this.byId("tree").expandToLevel(9);
    },

    read(model, set, project) {
      return new Promise((resolve, reject) => {
        model.read("/" + set, {
          filters: [new Filter("Project", FilterOperator.EQ, project)],
          sorters: [new Sorter("StgSeq")],
          success: (data) => resolve(data.results),
          error: reject,
        });
      });
    },

    onSelect(event) {
      const item = event.getParameter("listItem");
      const node = item && item.getBindingContext("tree").getObject();
      this.select(node && node.path ? node : null);
    },

    // the detail: a form with one field per property of the node's entity
    // type (from $metadata), the keys read-only; below it the text row
    select(node) {
      const nodeModel = this.getView().getModel("node");
      const form = this.byId("form");
      const textForm = this.byId("textForm");
      form.removeAllContent();
      textForm.removeAllContent();
      textForm.setVisible(false);
      form.unbindElement();
      textForm.unbindElement();
      if (!node) {
        nodeModel.setData({});
        return;
      }
      nodeModel.setData({path: node.path, entity: node.entity, set: node.set, title: node.entity + ": " + node.text, row: node.row});
      const model = this.getOwnerComponent().getModel();
      this.fields(form, node.entity, [], node.entity);
      form.bindElement({path: node.path});
      const textSet = TEXTS[node.entity];
      if (textSet) {
        const keys = {Language: "E", Project: node.row.Project, NodeUuid: node.row.NodeUuid};
        if (node.entity === "Project") {
          delete keys.NodeUuid;
        }
        const textPath = "/" + model.createKey(textSet, keys);
        this.fields(textForm, textSet.replace(/Set$/, ""), ["Language", "Project", "NodeUuid", "StgSeq"], "Texts (EN)");
        textForm.bindElement({
          path: textPath,
          events: {
            dataReceived: (e) => textForm.setVisible(!!e.getParameter("data")),
          },
        });
        const existing = model.getProperty(textPath);
        textForm.setVisible(!!existing);
      }
    },

    fields(form, entityName, skip, title) {
      const model = this.getOwnerComponent().getModel();
      const schema = model.getServiceMetadata().dataServices.schema[0];
      const type = schema.entityType.find((t) => t.name === entityName);
      if (!type) {
        return;
      }
      const keys = type.key.propertyRef.map((k) => k.name);
      form.addContent(new Title({text: title}));
      for (const p of type.property) {
        if (skip.includes(p.name)) {
          continue;
        }
        const input = new Input({value: "{" + p.name + "}", editable: !keys.includes(p.name)});
        form.addContent(new Label({text: p.name, labelFor: input}));
        form.addContent(input);
      }
    },

    onSave() {
      const model = this.getOwnerComponent().getModel();
      if (!model.hasPendingChanges()) {
        MessageToast.show("Nothing to save");
        return;
      }
      model.submitChanges({
        success: (data) => {
          const failed = (data.__batchResponses || []).some((r) => r.response && Number(r.response.statusCode) >= 400);
          if (failed) {
            MessageBox.error("The service rejected a change; see the message log.");
          } else {
            MessageToast.show("Saved");
            const node = this.getView().getModel("node").getData();
            if (node.path) {
              // the tree text follows a renamed node
              this.loadProject(this.project);
            }
          }
        },
        error: (e) => MessageBox.error(String(e && e.message)),
      });
    },

    onAddProperty() {
      const node = this.getView().getModel("node").getData();
      const model = this.getOwnerComponent().getModel();
      const input = new Input({placeholder: "Name, e.g. Price"});
      const dialog = new Dialog({
        title: "Add property to " + node.row.Name,
        content: [new Label({text: "Name", labelFor: input}), input],
        beginButton: new Button({
          text: "Add", type: "Emphasized",
          press: () => {
            const name = input.getValue().trim();
            if (!name) {
              return;
            }
            dialog.close();
            const siblings = this.byId("tree").getItems().map((i) => i.getBindingContext("tree").getObject()).filter((n) => n.row && n.set === "PropertySet" && n.row.ParentUuid === node.row.NodeUuid);
            const seq = Math.max(0, ...this.getView().getModel("tree").getData().nodes.map(() => 0)) + this.maxSeq() + 1;
            model.create("/PropertySet", {
              Project: node.row.Project, NodeUuid: uuid(), ParentUuid: node.row.NodeUuid, Name: name,
              EdmCoreType: "Edm.String", MaxLength: "10", Creatable: "X", Updatable: "X", Sortable: "X", Filterable: "X", IsNullable: "X",
              RefType: "T", AbapField: name.toUpperCase(), AbtyXu: "X", SortOrder: String(siblings.length + 1), StgSeq: seq,
            }, {
              success: () => { MessageToast.show("Property " + name + " added"); this.loadProject(this.project); },
              error: (e) => MessageBox.error(String(e && (e.message || e.responseText))),
            });
            model.submitChanges();
          },
        }),
        endButton: new Button({text: "Cancel", press: () => dialog.close()}),
        afterClose: () => dialog.destroy(),
      });
      dialog.open();
    },

    // STG_SEQ orders the rows of a table the way SEGW wrote them; a new row
    // goes after the last one of the project
    maxSeq() {
      let max = 0;
      const walk = (n) => { if (n.row && n.row.StgSeq > max) { max = Number(n.row.StgSeq); } (n.nodes || []).forEach(walk); };
      this.getView().getModel("tree").getData().nodes.forEach(walk);
      return max;
    },

    onDelete() {
      const node = this.getView().getModel("node").getData();
      const model = this.getOwnerComponent().getModel();
      MessageBox.confirm("Delete " + node.entity + " " + node.title.replace(/^.*: /, "") + "? Rows below it in the tree stay (SEGW deletes them with it; this is the row).", {
        onClose: (action) => {
          if (action !== MessageBox.Action.OK) {
            return;
          }
          model.remove(node.path, {
            success: () => { MessageToast.show("Deleted"); this.loadProject(this.project); },
            error: (e) => MessageBox.error(String(e && (e.message || e.responseText))),
          });
          model.submitChanges();
        },
      });
    },

    // the dev-time seam of the local runtime: test/start.mjs pulls the
    // project's rows back into an IWPR and runs segw-gen over it (on A4H the
    // same button is SEGW's own Generate)
    serverBase() {
      const model = this.getOwnerComponent().getModel();
      return new URL(model.sServiceUrl, document.baseURI).href.replace(/\/sap\/opu\/odata\/sap\/.*$/, "");
    },

    async onGenerate() {
      const project = this.project;
      try {
        const res = await fetch(this.serverBase() + "/segw/generate/" + encodeURIComponent(project), {method: "POST"});
        if (!res.ok) {
          throw new Error(res.status === 404 ? "Generate needs the local runtime (npm start); the browser preview has no generator." : await res.text());
        }
        const result = await res.json();
        const lines = [];
        if (result.skipped) {
          lines.push("Skipped: " + result.skipped);
        }
        lines.push(...Object.keys(result.files));
        lines.push(...result.warnings.map((w) => "Warning: " + w));
        MessageBox.information(lines.join("\n"), {title: "Generated " + project + " into " + result.folder, styleClass: "sapUiSizeCompact"});
      } catch (e) {
        MessageBox.error(String(e.message || e));
      }
    },

    onExport() {
      window.open(this.serverBase() + "/segw/export/" + encodeURIComponent(this.project), "_blank");
    },
  });
});
