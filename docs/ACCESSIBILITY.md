# Accessibility baseline

The UI preserves visible keyboard focus, offers a skip-to-content link, labels primary navigation and charts, enables Recharts' keyboard layer, and distinguishes comparison series by line pattern as well as color.

Run `pnpm a11y:check` for source-level regressions. Before a release, manually verify keyboard-only navigation at 200% zoom and Windows High Contrast, then run a screen-reader smoke test (Narrator + Edge WebView2). The source check is deliberately not presented as a full WCAG certification.
