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

  withPackTiles().then(function () {
    return sap.ushell.Container.createRenderer("fiori2", true);
  }).then(function (renderer) {
    renderer.placeAt("content");
  });
});
