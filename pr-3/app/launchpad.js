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
  // The packs' own tiles, asked for at start: a content pack declares them in
  // its osd-pack.json and the server answers ./packs.json, so a pack reaches
  // the launchpad without this file or flp.html knowing its name (backlog
  // E.2). A tree with no packs answers an empty list, and a preview
  // deployment has no server at all, so a failure here is not an error.
  function withPackTiles() {
    return fetch("./packs.json").then(function (r) {
      return r.ok ? r.json() : {tiles: []};
    }).then(function (answer) {
      var tiles = (answer && answer.tiles) || [];
      if (tiles.length === 0 || !launchPage) {
        return;
      }
      var group = {id: "packs", title: "Content packs", isPreset: true, isVisible: true, isGroupLocked: false, tiles: []};
      tiles.forEach(function (tile) {
        // the tile goes straight to the pack's page: the sandbox resolves
        // an intent from the applications it was booted with, and one
        // added here, after the boot, answered "could not be opened"
        // (2026-09-17). A targetURL that is not a hash is followed as is.
        group.tiles.push({
          id: tile.id,
          tileType: "sap.ushell.ui.tile.StaticTile",
          properties: {
            title: tile.title,
            subtitle: tile.subtitle || "",
            info: tile.info || tile.pack,
            icon: tile.icon,
            targetURL: tile.url.charAt(0) === "/" ? ".." + tile.url : tile.url
          }
        });
      });
      launchPage.groups = (launchPage.groups || []).concat([group]);
    }).catch(function () {
      // no server, or no packs: the built-in tiles are the whole launchpad
    });
  }

  // The AMDP tile is only useful where something can run SQLScript. Ask,
  // rather than read a configuration: a name in a config says what somebody
  // intended, and /engine says what happens -- it runs the smallest possible
  // body and reports. A tile that looks alive and then cannot do anything is
  // worse than a grey one, and this is the same screen that refuses to draw
  // a menu entry for a transaction it cannot start.
  function greyAmdpWithoutEngine() {
    return fetch("../sap/bc/osd/amdp/engine").then(function (r) {
      return r.ok ? r.json() : {engine: "none"};
    }).then(function (answer) {
      if (!launchPage || (answer && answer.engine === "HDB")) {
        return;
      }
      (launchPage.groups || []).forEach(function (group) {
        (group.tiles || []).forEach(function (tile) {
          if (tile.id !== "amdp") {
            return;
          }
          tile.properties.info = "no SQLScript engine here";
          tile.properties.subtitle = "needs a database that speaks it";
          // no target: the sandbox would answer honestly, but a tile that
          // goes nowhere says so before the click rather than after
          delete tile.properties.targetURL;
        });
      });
    }).catch(function () {
      // no server (the browser preview) is the same answer as no engine
      greyAmdpWithoutEngine.failed = true;
    });
  }

  // The 1.120 sandbox renders SAPLogo.svg even when shellLogo is configured.
  // Replace only that image, retaining UI5's home link and its fixed header
  // slot. Watch for shell re-renders when navigation switches applications.
  function installHeaderLogo() {
    var root = document.getElementById("content");
    var logo = new URL("./pass-logo.png", document.baseURI).href;
    function update() {
      var icon = document.getElementById("shell-header-icon");
      if (icon && icon.getAttribute("src") !== logo) {
        icon.setAttribute("src", logo);
      }
      if (icon && icon.getAttribute("alt") !== "PASS logo") {
        icon.setAttribute("alt", "PASS logo");
      }
    }
    new MutationObserver(update).observe(root, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["src", "alt"]
    });
    update();
  }

  installHeaderLogo();
  withPackTiles().then(greyAmdpWithoutEngine).then(function () {
    return sap.ushell.Container.createRenderer("fiori2", true);
  }).then(function (renderer) {
    renderer.placeAt("content");
  });
});
