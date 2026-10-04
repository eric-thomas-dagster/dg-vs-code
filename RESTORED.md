# dg-vs-code — archival

This repository is the **recovered source** of the `dagster-power-user` VS Code extension at version 0.4.1 as it existed on Eric Thomas's laptop in late 2026.

## How this was recovered

The source directory (`~/dg-vs-code/`) had been deleted from disk. The compiled .vsix was installed in `~/.vscode/extensions/dagster-community.dagster-power-user-0.4.1/`, but the TypeScript source was gone.

The source was reconstructed from **Cursor's per-file edit history** (`~/Library/Application Support/Cursor/User/History/`). Cursor keeps timestamped snapshots of every file edited inside the editor. 94 files from `~/dg-vs-code/` were present in that history; the latest non-empty snapshot of each was copied back to form this tree.

One file (`src/providers/askDagsterProvider.ts`) had an empty latest snapshot (looked like a mid-edit wipe moments before the directory was deleted). The 261KB snapshot from ~1 day before was used instead.

## Status: stale, archival only

This code is **not actively maintained**. It represents a point-in-time snapshot — the extension was never actually published anywhere public (the `package.json` repository URL pointed at a GitHub repo that didn't exist).

Forward-looking work is in the clean 1.0 rewrite at:
→ **https://github.com/eric-thomas-dagster/dagster-power-user-vscode**

## What's here

- **~15,700 lines of TypeScript** across 23 .ts files
- 53 VS Code commands (asset lineage, catalog browser, AI assistant, Airflow converter, Dagster+ publisher, Cloud validator, onboarding flow, …)
- An "Ask Daggy" AI assistant webview with full conversation UI
- A dependency graph webview, lineage webview, import analysis webview, asset metadata webview
- Rich provider stack: completion, config validation, diagnostics, navigation
- ~30 dev-note markdown files chronicling the 0.1 → 0.4 iteration
- Example Dagster projects (`example/`, `healthcare_dagster/`)
- `package.json` manifest, `tsconfig.json`, lint config

## What's missing

- `node_modules/` (never captured by Cursor history — just run `npm install`)
- `out/` (compiled output — regenerate with `npm run compile`)
- Any `.git/` history (there was none in the original either — this was the first time the source has ever been in a git repo)
- Any secrets or env files (good — never captured)

## If you want to run it

```bash
cd dg-vs-code
npm install
npm run compile
# Then in VS Code: F5 to launch the Extension Development Host
```

If that compiles cleanly, great. If not, you'll see mid-development state — the recovered snapshots are from whenever Eric last edited each file in Cursor, not necessarily a known-good commit boundary.
