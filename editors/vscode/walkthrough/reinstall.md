## Reinstall from this checkout

From the open-steamgate checkout, run:

```sh
npm run vsix
```

In VS Code, run **Extensions: Install from VSIX...** and choose the newly written `.vsix` under `build/vsix/`. If an older build is already installed, uninstall **open-steamgate (osd)** first, then install the VSIX and reload the window.

The packaged extension carries a bundled system copy. It materializes that copy in VS Code's extension storage on first start; opening the open-steamgate checkout uses that checkout as `osd.home` instead.
