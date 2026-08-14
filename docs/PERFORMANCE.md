# Performance baseline

Run `pnpm benchmark:db` to create a disposable 100,000-row SQLite database and measure representative daily, model and project aggregations. Run `pnpm benchmark:startup -- <packaged-executable>` on Windows to measure time to the first window and the settled process working set.

Release gates:

- 100,000-row aggregation p95 below 250 ms on the release machine.
- Cold start below 2 seconds and settled working set below 120 MB on the release machine.
- NSIS installer below 20 MB, excluding the WebView2 online bootstrap download.

Results are machine-dependent and must be captured from the final Tauri executable; the roadmap item remains open until those final measurements are recorded here.

## 2026-08-15 development-machine database baseline

- Rows: 100,000
- Transactional fixture insertion: 924.32 ms
- Representative aggregation latency: median 14.38 ms, p95 51.66 ms, max 56.06 ms
- SQLite size: 33.31 MB
- Benchmark Node process RSS: 81.68 MB (this is not application resident memory)
