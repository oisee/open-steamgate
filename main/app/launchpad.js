sap.ui.define([], function () {
  "use strict";
  // Started by flp.html once the core is up: the sandbox bootstrap
  // (test-resources/sap/ushell/bootstrap/sandbox.js) has created
  // sap.ushell.Container from window["sap-ushell-config"]; render the shell.
  // The sandbox mixes its own catalog (RTA Demo App, AppNavSample...) into
  // window["sap-ushell-config"]; only the open-steamgate group stays.
  var config = window["sap-ushell-config"] || {};
  var launchPage = config.services && config.services.LaunchPage && config.services.LaunchPage.adapter && config.services.LaunchPage.adapter.config;
  if (launchPage) {
    launchPage.groups = window["stg-launchpad-groups"] || [];
    launchPage.catalogs = [];
  }
  sap.ushell.Container.createRenderer("fiori2", true).then(function (renderer) {
    renderer.placeAt("content");
  });
});
