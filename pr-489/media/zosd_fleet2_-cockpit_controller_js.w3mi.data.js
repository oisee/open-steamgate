sap.ui.define(["sap/m/Button", "sap/m/Dialog", "sap/m/Input", "sap/m/Label", "sap/m/VBox", "sap/m/Text", "l3/fleet2/Series"],
function (Button, Dialog, Input, Label, VBox, Text, Series) {
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
     "name": "piles.checks.size",
     "default": "2",
     "min": "1",
     "max": "2147483647"
    }
   ],
   "governor": true
  };
  return {
    onInit: function () {
      this.initTexts();
      this.extensionAPI.attachPageDataLoaded(this.loaded.bind(this));
      this.timer = null;
    },
    onExit: function () {clearTimeout(this.timer);},
    app: function () {var owner = this.getOwnerComponent(); return owner.getAppComponent ? owner.getAppComponent() : owner;},
    initTexts: function () {this.getView().setModel(this.app().getModel("cockpitI18n"), "cockpitI18n");},
    text: function (key) {return this.app().getModel("cockpitI18n").getResourceBundle().getText(key);},
    loaded: function () {
      clearTimeout(this.timer);
      var bar = this.byId("cockpitActions"), self = this;
      bar.destroyItems();
      config.actions.forEach(function (action) {bar.addItem(new Button({text: self.text(action.name), press: function () {self.ask(action);}}));});
      this.refresh();
    },
    read: function (set, filter) {
      var model = this.getView().getModel();
      return new Promise(function (resolve, reject) {model.read("/" + set, {urlParameters: {$filter: filter || "", $top: "100000"}, success: function (r) {resolve(r.results);}, error: reject});});
    },
    refresh: function () {
      var self = this, context = this.getView().getBindingContext(), dom = this.getView().getDomRef();
      clearTimeout(this.timer);
      // one polling chain per page, and none once the object page is no longer shown
      if (!context || !dom || !dom.isConnected || !dom.getClientRects().length) return;
      var run = context.getObject(), filter = "RunId eq '" + run.RunId + "'";
      var names = ["Pile", "Stage"].concat(config.governor ? ["Event", "Budget"] : []);
      Promise.all(names.map(function (n) {return self.read(n + "Set", filter);})).then(function (rows) {
        var plotted = Series.compute(rows[0], rows[2] || [], rows[1], rows[3] && rows[3][0], Date.now());
        var html = Series.svg(plotted, plotted.plan, ["planned", "done"], [self.text("planned"), self.text("done")]);
        if (plotted.capacity.length) html += Series.svg(plotted, plotted.capacity, ["reserved", "glass", "warn", "narrow"], [self.text("reserved"), self.text("glass"), self.text("warn"), self.text("narrow")]);
        self.byId("cockpitChart").setContent(html);
        var durations = self.byId("cockpitDurations"); durations.destroyItems();
        rows[0].forEach(function (p) {var started = Series.time(p.Started), ended = Series.time(p.Ended);
          durations.addItem(new Text({text: p.RuleName + " #" + p.PileNo + ": " + (started ? Math.max(0, (ended || Date.now()) - started) / 1000 : 0) + " s"}));
        });
        if (rows[1].some(function (s) {return ["OPEN", "WAITING", "SUBMITTED"].indexOf(s.Status) >= 0;})) self.timer = setTimeout(function () {self.refresh();}, 5000);
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
    answer: function (answer) {this.byId("cockpitAnswer").setText(typeof answer === "string" ? answer : answer && answer.Answer !== undefined ? answer.Answer : JSON.stringify(answer)).setVisible(true);},
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
