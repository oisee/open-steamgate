sap.ui.define(["sap/m/MessageStrip", "l3/{{set}}/Cockpit.controller"], function (MessageStrip, Cockpit) {
  "use strict";
  var config = {{config}};
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
