sap.ui.define([], function () {
  "use strict";
  // Started by flp.html once the core is up: the sandbox bootstrap
  // (test-resources/sap/ushell/bootstrap/sandbox.js) has created
  // sap.ushell.Container from window["sap-ushell-config"]; render the shell.
  sap.ushell.Container.createRenderer("fiori2", true).then(function (renderer) {
    renderer.placeAt("content");
  });
});
