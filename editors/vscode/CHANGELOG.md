# Changelog

## Unreleased

- Ship the bundled system's generation prebuilt, so the first start reuses it instead of transpiling (build step 21.7 s -> 0.35 s measured; first start 35 s -> 14 s).
- Add a Marketplace build profile with staged third-party notices and no web extension entry. The sample interactive-fiction pack now uses a story rebuilt from an MIT source release.
- Add publisher metadata, Marketplace README, screenshots, and optional prerelease manifest property.
