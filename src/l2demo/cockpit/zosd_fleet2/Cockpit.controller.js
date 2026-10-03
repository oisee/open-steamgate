sap.ui.define(["sap/m/Button", "sap/m/Dialog", "sap/m/Input", "sap/m/Label", "sap/m/VBox", "sap/m/Text",
  "sap/ui/model/json/JSONModel", "l3/fleet2/Series"],
function (Button, Dialog, Input, Label, VBox, Text, JSONModel, Series) {
  "use strict";
  var config = {
   "service": "ZL3C_FLEET2_SRV",
   "actions": [
    {
     "name": "StartRun",
     "params": {
      "CheckDate": "String(8)",
      "Mode": "String(1)",
      "Work": "String(4)"
     },
     "reason": false
    },
    {
     "name": "ReleasePile",
     "params": {
      "RunId": "String(32)",
      "RuleName": "String(60)",
      "PileNo": "Int32",
      "PerPile": "Int32",
      "Reason": "String(80)"
     },
     "reason": true
    },
    {
     "name": "ContinueGlass",
     "params": {
      "RunId": "String(32)",
      "NewGlass": "Int32",
      "Reason": "String(80)"
     },
     "reason": true
    },
    {
     "name": "Resume",
     "params": {
      "RunId": "String(32)"
     },
     "reason": false
    },
    {
     "name": "Doctor",
     "params": {},
     "reason": false
    },
    {
     "name": "SetKill",
     "params": {
      "Reason": "String(80)"
     },
     "reason": true
    },
    {
     "name": "ClearKill",
     "params": {
      "Reason": "String(80)"
     },
     "reason": true
    },
    {
     "name": "SetSetting",
     "params": {
      "Param": "String(30)",
      "Value": "String(40)",
      "Note": "String(80)"
     },
     "reason": true
    },
    {
     "name": "ResetSetting",
     "params": {
      "Param": "String(30)",
      "Note": "String(80)"
     },
     "reason": true
    },
    {
     "name": "Schedule",
     "params": {},
     "reason": false
    },
    {
     "name": "Unschedule",
     "params": {},
     "reason": false
    }
   ],
   "settings": [
    {
     "name": "budget.glass",
     "default": "10",
     "min": "1",
     "max": "2147483647"
    },
    {
     "name": "budget.warn",
     "default": "7000",
     "min": "1",
     "max": "10000"
    },
    {
     "name": "budget.narrow_at",
     "default": "8000",
     "min": "1",
     "max": "10000"
    },
    {
     "name": "budget.per_pile",
     "default": "50",
     "min": "0",
     "max": "2147483647"
    },
    {
     "name": "retry.max",
     "default": "2",
     "min": "0",
     "max": "99"
    },
    {
     "name": "retry.backoff",
     "default": "60",
     "min": "0",
     "max": "86400"
    },
    {
     "name": "stale",
     "default": "900",
     "min": "60",
     "max": "356400"
    },
    {
     "name": "fuses.max_alerts",
     "default": "500",
     "min": "1",
     "max": "100000"
    },
    {
     "name": "keep.days",
     "default": "30",
     "min": "1",
     "max": "9999"
    },
    {
     "name": "simulate.seed",
     "default": "42",
     "min": "1",
     "max": "2147483646"
    },
    {
     "name": "simulate.time_scale",
     "default": "10000",
     "min": "0",
     "max": "1000000"
    },
    {
     "name": "simulate.profile",
     "default": "default",
     "min": "1",
     "max": "20"
    },
    {
     "name": "simulate.dump",
     "default": "-1",
     "min": "-1",
     "max": "1000"
    },
    {
     "name": "simulate.hang",
     "default": "-1",
     "min": "-1",
     "max": "1000"
    },
    {
     "name": "simulate.slow",
     "default": "-1",
     "min": "-1",
     "max": "1000"
    },
    {
     "name": "simulate.hits_mean",
     "default": "-1",
     "min": "-1",
     "max": "100"
    },
    {
     "name": "simulate.autoclose",
     "default": "-1",
     "min": "-1",
     "max": "1000"
    },
    {
     "name": "piles.checks.size",
     "default": "2",
     "min": "1",
     "max": "2147483647"
    }
   ],
   "governor": true,
   "simulate": true
  };
  // a run that still holds its lock may change; a final one does not
  var settled = ["DONE", "PARTIAL", "FAILED", "NOT-RUN", "SKIPPED", "KILLED"];
  return {
    isOpen: function (run) {return !!run && settled.indexOf(run.Status) < 0;},
    errorText: function (e) {
      var text = e && (e.responseText || e.message) || "";
      try {text = JSON.parse(text).error.message.value;} catch (ignored) {/* not a Gateway error body */}
      return text;
    },
    // the runner's answer in words: a known first word gets its sentence, the rest stays as said
    human: function (answer) {
      var text = typeof answer === "string" ? answer : answer && answer.Answer !== undefined ? answer.Answer : "";
      var word = text.split(":")[0].trim(), bundle = this.app().getModel("cockpitI18n").getResourceBundle();
      if (/^[A-Z][A-Z-]*$/.test(word) && bundle.hasText("answer" + word)) {
        var rest = text.slice(word.length).replace(/^:\s*/, "");
        return bundle.getText("answer" + word) + (rest ? " " + rest : "");
      }
      return text;
    },
    onInit: function () {
      this.initTexts();
      this.extensionAPI.attachPageDataLoaded(this.loaded.bind(this));
      this.timer = null;
    },
    onExit: function () {clearTimeout(this.timer);},
    app: function () {var owner = this.getOwnerComponent(); return owner.getAppComponent ? owner.getAppComponent() : owner;},
    // what the start dialog was answered, kept on the app so the run's page shows it again
    memo: function () {
      var app = this.app();
      if (!app.getModel("cockpit")) app.setModel(new JSONModel({answers: {}}), "cockpit");
      return app.getModel("cockpit");
    },
    initTexts: function () {this.getView().setModel(this.app().getModel("cockpitI18n"), "cockpitI18n");},
    text: function (key) {return this.app().getModel("cockpitI18n").getResourceBundle().getText(key);},
    loaded: function () {
      clearTimeout(this.timer);
      var bar = this.byId("cockpitActions"), self = this;
      bar.destroyItems();
      config.actions.forEach(function (action) {
        if (action.name !== "StartRun") bar.addItem(new Button({text: self.text(action.name), press: function () {self.ask(action);}}));
      });
      // the answer the start dialog got for this run, in words
      var context = this.getView().getBindingContext(), run = context && context.getObject();
      var said = run && this.memo().getProperty("/answers/" + run.RunId);
      if (said) this.answer(said);
      else this.byId("cockpitAnswer").setVisible(false);
      this.refresh();
    },
    read: function (set, filter) {
      var model = this.getView().getModel();
      return new Promise(function (resolve, reject) {model.read("/" + set, {urlParameters: {$filter: filter || "", $top: "100000"}, success: function (r) {resolve(r.results);}, error: reject});});
    },
    refresh: function () {
      var self = this, context = this.getView().getBindingContext(), dom = this.getView().getDomRef();
      clearTimeout(this.timer);
      // one polling chain per page; a page that is gone stops it, a hidden one (another tab, the
      // list in front) only looks again in two seconds without reading anything
      if (!context || !dom || !dom.isConnected) return;
      // the view's root may have no box of its own (display: contents); the table's is what shows
      var shown = self.byId("cockpitProgress").getDomRef();
      if (!shown || !shown.getClientRects().length) {
        this.timer = setTimeout(function () {self.refresh();}, 2000);
        return;
      }
      var run = context.getObject(), filter = "RunId eq '" + run.RunId + "'";
      var names = ["Pile", "Stage"].concat(config.governor ? ["Event", "Budget"] : []);
      Promise.all(names.map(function (n) {return self.read(n + "Set", filter);})).then(function (rows) {
        // a plain table for now (the chart multiplied on a system); the canvas comes in 6b
        var progress = self.byId("cockpitProgress"), counts = {}, lines = [];
        rows[0].forEach(function (p) {counts[p.Status] = (counts[p.Status] || 0) + 1;});
        var line = function (what, value) {lines.push({what: what, value: String(value)});};
        line(self.text("planned"), rows[0].length);
        Object.keys(counts).sort().forEach(function (k) {line(k, counts[k]);});
        var budget = rows[3] && rows[3][0];
        if (budget) {
          line(self.text("reserved"), budget.Reserved); line(self.text("glass"), budget.Glass); line("State", budget.State);
        }
        if (!progress.getModel("prog")) progress.setModel(new JSONModel({rows: []}), "prog");
        progress.getModel("prog").setData({rows: lines});
        // every pile, the open ones first (running, or left RUNNING by a job that is gone: the doctor's case);
        // a pile without an end counts up to now
        var states = {DONE: "Success", FAILED: "Error", HELD: "Warning", RUNNING: "Information"};
        var list = rows[0].map(function (p) {
          var started = Series.time(p.Started), ended = Series.time(p.Ended);
          return {rule: p.RuleName, no: +p.PileNo, pile: p.RuleName + " #" + p.PileNo, status: p.Status, state: states[p.Status] || "None", attempt: p.Attempt, open: !ended,
            seconds: started ? Math.round(((ended || Date.now()) - started) / 1000) + (ended ? "" : " (open)") : ""};
        }).sort(function (a, b) {return (b.open - a.open) || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : a.no - b.no);});
        var table = self.byId("cockpitDurations");
        if (!table.getModel("dur")) table.setModel(new JSONModel({rows: []}), "dur");
        table.getModel("dur").setData({rows: list});
        if (rows[1].some(function (s) {return ["OPEN", "WAITING", "SUBMITTED"].indexOf(s.Status) >= 0;})) {clearTimeout(self.timer); self.timer = setTimeout(function () {self.refresh();}, 5000);}
      }).catch(function (e) {self.answer(e.message || e.responseText);});
      if (config.settings.length) {
        this.read("SettingSet").then(function (rows) {
          var box = self.byId("cockpitSettings"); box.destroyItems();
          rows.forEach(function (r) {var def = config.settings.find(function (s) {return s.name === r.ParamName;});
            box.addItem(new Text({text: r.ParamName + ": " + r.ParamVal + " / " + r.DslValue + " [" + def.min + ".." + def.max + "]"}));
          });
        });
        this.read("ChangeSet").then(function (rows) {
          rows.sort(function (a, b) {return +b.ChangedAt - +a.ChangedAt;});
          var box = self.byId("cockpitChanges"); box.destroyItems();
          rows.forEach(function (r) {box.addItem(new Text({text: r.ParamName + ": " + r.OldValue + " → " + r.NewValue + " · " + r.NoteText + " · " + r.ChangedBy}));});
        });
      }
      if (config.actions.some(function (a) {return a.name === "Schedule";})) this.getView().getModel().callFunction("/ScheduleStatus", {method: "GET", success: function (r) {self.byId("cockpitSchedule").setText(r.Answer);}});
    },
    answer: function (answer) {this.byId("cockpitAnswer").setText(this.human(answer)).setVisible(true);},
    ask: function (action) {
      var self = this, inputs = {}, box = new VBox({width: "28rem"}), context = this.getView().getBindingContext();
      var run = context && context.getObject();
      Object.keys(action.params).forEach(function (p) {
        box.addItem(new Label({text: self.text(p), required: p === "Reason" || p === "Note"}));
        inputs[p] = new Input({value: p === "RunId" ? run.RunId : p === "Mode" ? "S" : p === "CheckDate" ? new Date().toISOString().slice(0, 10).replace(/-/g, "") : /Int32/.test(action.params[p]) ? "0" : ""});
        box.addItem(inputs[p]);
      });
      var dialog = new Dialog({title: this.text(action.name), content: box, beginButton: new Button({text: this.text("confirm"), press: function () {
        var params = {};
        Object.keys(inputs).forEach(function (p) {params[p] = inputs[p].getValue();});
        if (action.reason && !(params.Reason || params.Note || "").trim()) {self.answer(self.text("reasonRequired")); return;}
        self.getView().getModel().callFunction("/" + action.name, {method: "POST", urlParameters: params,
          success: function (r) {self.answer(r); dialog.close(); self.getView().getModel().refresh(true); self.refresh();},
          error: function (e) {self.answer(e.responseText || e.message); dialog.close();}});
      }}), endButton: new Button({text: this.text("cancel"), press: function () {dialog.close();}}), afterClose: function () {dialog.destroy();}});
      this.getView().addDependent(dialog); dialog.open();
    }
  };
});
