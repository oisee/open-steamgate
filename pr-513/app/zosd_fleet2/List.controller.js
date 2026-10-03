sap.ui.define(["sap/m/MessageStrip", "l3/fleet2/Cockpit.controller"], function (MessageStrip, Cockpit) {
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
  var methods = {
    onInit: function () {
      this.initTexts();
      this.strip = new MessageStrip(this.getView().createId("listCockpitAnswer"), {showIcon: true, visible: false});
    },
    onAfterRendering: function () {
      if (this.strip.getParent()) return;
      var pages = this.getView().findAggregatedObjects(true, function (c) {return c.isA("sap.f.DynamicPage");});
      if (pages.length) {this.page = pages[0]; this.page.getHeader().addContent(this.strip);}
    },
    app: Cockpit.app,
    initTexts: Cockpit.initTexts,
    text: Cockpit.text,
    ask: Cockpit.ask,
    answer: function (answer) {
      this.strip.setText(typeof answer === "string" ? answer : JSON.stringify(answer)).setVisible(true);
      if (this.page) this.page.setHeaderExpanded(true);
    },
    refresh: function () {this.getView().getModel().refresh(true);}
  };
  config.actions.forEach(function (a) {methods["ask" + a.name] = function () {this.ask(a);};});
  return methods;
});
