# Performance baseline

Run `pnpm benchmark:db` to create a disposable 100,000-row database through the Rust SQLite layer and measure representative aggregation. Run `pnpm benchmark:startup -- <packaged-executable>` on Windows to measure time to the first window and the settled process working set.

Release targets:

- 100,000-row aggregation p95 below 250 ms on the release machine.
- Cold start below 2 seconds. Track both process-tree private memory and working set because WebView2 shared pages make working-set totals substantially larger.
- NSIS installer below 20 MB, excluding the WebView2 online bootstrap download.

Results are machine-dependent and must be captured from the final packaged Tauri executable.

## 2026-08-15 final Tauri release baseline

- Release executable: 7,894,528 bytes (7.53 MiB)
- NSIS online installer: 3,149,908 bytes (3.00 MiB)
- Cold start to first window: 195 ms
- Settled process tree: 7 processes, 136.40 MiB private memory, 364.45 MiB working set
- Rows: 100,000
- Transactional fixture insertion: 1,236.53 ms
- Representative aggregation latency: median 70.20 ms, p95 87.04 ms

The aggregation, startup and installer-size targets pass. The original 120 MiB working-set target does not pass when all WebView2 child processes and shared pages are counted. Private memory is the more useful ownership metric here, but both values remain recorded so future releases can be compared without changing measurement definitions.

## 2026-08-15 pre-migration Node database baseline

- Rows: 100,000
- Transactional fixture insertion: 924.32 ms
- Representative aggregation latency: median 14.38 ms, p95 51.66 ms, max 56.06 ms
- SQLite size: 33.31 MB
- Benchmark Node process RSS: 81.68 MB (this is not application resident memory)
