/* The one refresh mechanism of the cockpit pages: a refresh button and, where a
 * page watches something that changes, a "Live" switch that refreshes every
 * five seconds while the switch is on, skips while the tab is hidden, and
 * turns itself off when what it watches has reached a final state. */
sap.ui.define(["sap/m/Button", "sap/m/Switch", "sap/m/Label", "sap/m/Text"], function (Button, Switch, Label, Text) {
  "use strict";
  var INTERVAL = 5000;
  function pad(n) {return (n < 10 ? "0" : "") + n;}
  function clock(d) {return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());}
  // spec: {id: function (name) -> stable id, text: function (key) -> label,
  //   refresh: function () -> Promise, final: function () -> true when nothing changes any more,
  //   live: false for a refresh button only}
  function Live(spec) {
    var self = this;
    this.spec = spec;
    this.timer = null;
    this.busy = false;
    this.button = new Button(spec.id("liveRefresh"), {icon: "sap-icon://refresh", text: spec.text("refresh"),
      tooltip: spec.text("refresh"), press: function () {self.now();}});
    this.stamp = new Text(spec.id("liveStamp"), {text: ""});
    this.controls = [this.button];
    if (spec.live !== false) {
      this.toggle = new Switch(spec.id("liveSwitch"), {state: false,
        tooltip: spec.text("liveHint"), change: function (e) {self.set(e.getParameter("state"));}});
      this.label = new Label(spec.id("liveLabel"), {text: spec.text("live"), labelFor: this.toggle});
      this.controls.push(this.label, this.toggle);
    }
    this.controls.push(this.stamp);
  }
  Live.INTERVAL = INTERVAL;
  Live.prototype.isOn = function () {return !!(this.toggle && this.toggle.getState());};
  Live.prototype.set = function (on) {
    if (!this.toggle) return;
    this.toggle.setState(!!on);
    clearTimeout(this.timer);
    if (on) this.schedule();
  };
  Live.prototype.schedule = function () {
    var self = this;
    clearTimeout(this.timer);
    this.timer = setTimeout(function () {self.tick();}, INTERVAL);
  };
  Live.prototype.tick = function () {
    if (!this.isOn()) return;
    // a hidden tab reads nothing; it looks again in one interval
    if (document.visibilityState === "hidden") {this.schedule(); return;}
    var self = this;
    this.now().then(function () {if (self.isOn()) self.schedule();});
  };
  // one refresh now; while one runs, a second press waits for it
  Live.prototype.now = function () {
    var self = this;
    if (this.busy) return this.busy;
    this.busy = Promise.resolve(this.spec.refresh()).catch(function () {}).then(function () {
      self.busy = false;
      self.stamp.setText(self.spec.text("updated") + " " + clock(new Date()));
      if (self.isOn() && self.spec.final && self.spec.final()) self.set(false);
    });
    return this.busy;
  };
  Live.prototype.destroy = function () {
    clearTimeout(this.timer);
    this.controls.forEach(function (c) {c.destroy();});
  };
  return Live;
});
