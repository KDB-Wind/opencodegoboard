# Release, update and rollback

## Windows manual downloads

The maintainer authorized v1.3.4 on 2026-10-17 to continue the unsigned Windows installer distribution used by v1.3.3. Users download and install the NSIS executable from GitHub Releases. Release notes must state that the installer is unsigned; Windows may show an unknown-publisher or SmartScreen prompt. This distribution does not enable in-app automatic updates.

For a manual installer release:

1. Keep package.json, Cargo.toml, Cargo.lock and tauri.conf.json application versions consistent. Verify CI for the final commit.
2. Build on Windows with `pnpm exec tauri build --ci --bundles nsis`, using the standard configuration. Do not use `tauri.release.conf.json`, which requests signed updater artifacts.
3. Run `pnpm release:checksums` and `pnpm release:verify`. For flat GitHub assets, provide a SHA256SUMS.txt containing the uploaded installer filename and its digest.
4. Validate the exact installer on an isolated Windows environment: fresh install, upgrade from the previous release, synthetic data and settings retention, startup and uninstall. Record any runtime prerequisites or untested flows.
5. Upload the validated bytes, checksum and validation report to a draft Release. Check the final tag/commit and asset digests, then publish. Do not overwrite published installers or create an unsigned latest.json.

Windows Authenticode signing is a separate future improvement for publisher identity. It is not required by the current manual-download policy. Do not describe a checksum or Tauri updater signature as an Authenticode certificate.

## Signed in-app updates

Tauri updater signing is required when enabling in-app updates. A public key and HTTPS update endpoint are injected at compile time through `OPENCODEGOBOARD_UPDATER_PUBKEY` and `OPENCODEGOBOARD_UPDATER_ENDPOINT`; no private key belongs in this repository.

Before enabling signed updates:

1. Generate and securely back up a signing identity on an offline/restricted machine using `pnpm tauri signer generate -w <private-key-path>`. If an existing update identity is in use, recover it or plan an explicit migration instead of silently replacing it.
2. Store the private key and optional password as GitHub Actions secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
3. Store the public key as repository variable `UPDATER_PUBLIC_KEY`.
4. Explicitly dispatch the signed-release workflow for the intended commit/tag. It checks that key configuration is present and builds a draft with `tauri.release.conf.json`. Version tags do not automatically run this workflow, so publishing a manually validated release cannot overwrite its installer with an unvalidated build.
5. Validate the signed update from an installed previous version before publishing latest.json. When configured, the updater enforces HTTPS and signatures and installs only after the user requests an update.

Keep the previous installer and database schema compatibility for at least one release. If a signed update is bad, remove its latest.json pointer and restore the previous installer as the recommended download, then publish repaired code with a higher patch version; updaters do not downgrade versions. Never replace a user database to roll back. Use the automatic before-restore.db safety copy or the in-app validated backup flow.
