sap.ui.define(["sap/ui/core/mvc/Controller", "sap/ui/model/json/JSONModel", "sap/ui/core/format/DateFormat", "sap/m/Dialog", "sap/m/Button",
  "sap/m/Input", "sap/m/Label", "sap/m/Text", "sap/m/VBox", "sap/m/MessageBox", "sap/m/MessageToast", "l3/{{set}}/set/Live"],
function (Controller, JSONModel, DateFormat, Dialog, Button, Input, Label, Text, VBox, MessageBox, MessageToast, Live) {
  "use strict";
  // what the set can do, from its DSL (actions, settings with bounds)
  var config = {{config}};
  var has = function (name) {return config.actions.some(function (a) {return a.name === name;});};
  var stamp = DateFormat.getDateTimeInstance({style: "medium"});
  var when = function (v) {return v instanceof Date && v.getTime() > 0 ? stamp.format(v) : "";};
  return Controller.extend("l3.{{set}}.set.Set", {
    onInit: function () {
      var view = this.getView(), self = this;
      var cfg = {hasSettings: config.settings.length > 0 && has("SetSetting"), hasSchedule: has("Schedule"), hasKill: has("SetKill"), hasDoctor: has("Doctor")};
      cfg.first = cfg.hasSettings ? "settings" : cfg.hasSchedule ? "schedule" : cfg.hasKill ? "kill" : "doctor";
      view.setModel(new JSONModel(cfg), "cfg");
      view.setModel(new JSONModel({settings: [], changes: [], doctor: [], schedule: "", scheduled: false, kill: {set: false, text: "", since: ""}}), "set");
      this.live = new Live({id: function (name) {return view.createId(name);}, text: this.text.bind(this), live: false,
        refresh: function () {return self.refresh();}});
      this.live.controls.forEach(function (c) {self.byId("liveBox").addItem(c);});
      this.live.now();
    },
    onExit: function () {this.live.destroy();},
    text: function (key) {return this.getOwnerComponent().getModel("i18n").getResourceBundle().getText(key);},
    read: function (set, params) {
      var model = this.getOwnerComponent().getModel();
      return new Promise(function (resolve, reject) {
        model.read("/" + set, {urlParameters: params || {}, success: function (r) {resolve(r.results);}, error: reject});
      });
    },
    call: function (name, params, method) {
      var model = this.getOwnerComponent().getModel();
      return new Promise(function (resolve, reject) {
        model.callFunction("/" + name, {method: method || "POST", urlParameters: params || {}, success: resolve, error: reject});
      });
    },
    refresh: function () {
      var self = this, data = this.getView().getModel("set"), cfg = this.getView().getModel("cfg").getData(), reads = [];
      if (cfg.hasSettings) {
        reads.push(this.read("SettingSet").then(function (rows) {
          data.setProperty("/settings", rows.map(function (r) {
            var def = config.settings.find(function (s) {return s.name === r.ParamName;}) || {};
            return Object.assign({}, r, {bounds: def.min + " .. " + def.max, changed: r.Origin === "DSL" ? self.text("fromDsl") : r.ChangedBy + ", " + when(r.ChangedAt)});
          }));
        }));
        reads.push(this.read("ChangeSet").then(function (rows) {
          rows.sort(function (a, b) {return (b.ChangedAt || 0) - (a.ChangedAt || 0);});
          data.setProperty("/changes", rows.map(function (r) {
            return Object.assign({}, r, {change: (r.OldValue || "-") + " -> " + r.NewValue, changed: r.ChangedBy + ", " + when(r.ChangedAt)});
          }));
        }));
      }
      if (cfg.hasSchedule) {
        reads.push(this.call("ScheduleStatus", {}, "GET").then(function (r) {
          data.setProperty("/schedule", r.Answer);
          data.setProperty("/scheduled", /SCHEDULED \d/.test(r.Answer));
        }));
      }
      if (cfg.hasDoctor || cfg.hasKill) {
        reads.push(this.read("DoctorSet").then(function (rows) {
          rows.sort(function (a, b) {return ((b.Acted || 0) - (a.Acted || 0)) || (+b.Seq - +a.Seq);});
          data.setProperty("/doctor", rows.map(function (r) {
            return Object.assign({}, r, {when: when(r.Acted), where: r.RunId === "SET" ? self.text("wholeSet") : r.RunId + (r.RuleName ? " / " + r.RuleName + " #" + r.PileNo : "")});
          }));
          // the switch's state is its last audited change
          var last = rows.filter(function (r) {return r.RunId === "SET" && /^(SET|CLEAR)-KILL$/.test(r.DocAction);})[0];
          var on = !!last && last.DocAction === "SET-KILL";
          data.setProperty("/kill", {set: on, text: self.text(on ? "killOn" : "killOff"),
            since: last ? self.text("killSince") + " " + when(last.Acted) + ": " + last.Reason : ""});
        }));
      }
      return Promise.all(reads).catch(function (e) {self.say("REFUSED: " + (e.message || e.responseText));});
    },
    // the runner's answer: OK is a toast, a refusal a message box with its text
    say: function (answer) {
      var strip = this.byId("answer");
      if (/^REFUSED:/.test(answer)) {
        strip.setVisible(false);
        MessageBox.error(answer.replace(/^REFUSED:\s*/, ""), {title: this.text("refused")});
        return false;
      }
      if (answer === "OK") MessageToast.show(this.text("done"));
      else strip.setType("Information").setText(answer).setVisible(true);
      return true;
    },
    run: function (name, params) {
      var self = this;
      return this.call(name, params).then(function (r) {self.say(r.Answer); return self.live.now();},
        function (e) {self.say("REFUSED: " + (e.responseText || e.message));});
    },
    // a dialog for the fields a person types; a note or a reason is required and audited
    ask: function (title, fields, go) {
      var self = this, inputs = {}, box = new VBox({width: "26rem"});
      box.addStyleClass("sapUiSmallMargin");
      fields.forEach(function (f) {
        box.addItem(new Label({text: self.text(f.label), required: !!f.required}));
        if (f.fixed !== undefined) {box.addItem(new Text({text: f.fixed})); return;}
        inputs[f.name] = new Input({value: f.value || "", placeholder: f.hint ? self.text(f.hint) : ""});
        box.addItem(inputs[f.name]);
      });
      var dialog = new Dialog({title: title, content: box, beginButton: new Button({text: this.text("confirm"), type: "Emphasized", press: function () {
        var values = {}, missing = false;
        fields.forEach(function (f) {
          values[f.name] = f.fixed !== undefined ? f.fixed : inputs[f.name].getValue();
          if (f.required && !values[f.name].trim()) {inputs[f.name].setValueState("Error").setValueStateText(self.text("required")); missing = true;}
        });
        if (missing) return;
        dialog.close();
        go(values);
      }}), endButton: new Button({text: this.text("cancel"), press: function () {dialog.close();}}), afterClose: function () {dialog.destroy();}});
      this.getView().addDependent(dialog);
      dialog.open();
      return dialog;
    },
    askChange: function (e) {
      var row = e.getSource().getBindingContext("set").getObject(), self = this;
      this.ask(this.text("SetSetting") + ": " + row.ParamName, [{name: "Param", label: "Param", fixed: row.ParamName},
        {name: "Value", label: "Value", value: row.ParamVal, required: true}, {name: "Note", label: "Note", hint: "noteHint", required: true}],
      function (v) {self.run("SetSetting", v);});
    },
    askReset: function (e) {
      var row = e.getSource().getBindingContext("set").getObject(), self = this;
      this.ask(this.text("ResetSetting") + ": " + row.ParamName, [{name: "Param", label: "Param", fixed: row.ParamName},
        {name: "Default", label: "colDefault", fixed: row.DslValue}, {name: "Note", label: "Note", hint: "noteHint", required: true}],
      function (v) {self.run("ResetSetting", {Param: v.Param, Note: v.Note});});
    },
    askSetKill: function () {
      var self = this;
      this.ask(this.text("SetKill"), [{name: "Reason", label: "Reason", required: true}], function (v) {self.run("SetKill", v);});
    },
    askClearKill: function () {
      var self = this;
      this.ask(this.text("ClearKill"), [{name: "Reason", label: "Reason", required: true}], function (v) {self.run("ClearKill", v);});
    },
    doSchedule: function () {this.run("Schedule");},
    doUnschedule: function () {this.run("Unschedule");},
    doDoctor: function () {this.run("Doctor");}
  });
});
