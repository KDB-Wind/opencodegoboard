# Release, update and rollback

OpenCodeGoBoard uses Tauri's signed updater artifacts. A public key and HTTPS update endpoint are injected at compile time through `OPENCODEGOBOARD_UPDATER_PUBKEY` and `OPENCODEGOBOARD_UPDATER_ENDPOINT`; no private key belongs in this repository.

Before the first public release:

1. Run `pnpm tauri signer generate -w <private-key-path>` on an offline/restricted machine.
2. Store the private key and password as GitHub Actions secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
3. Store the public key as repository variable `UPDATER_PUBLIC_KEY`.
4. Build from a signed version tag. The workflow produces signed Tauri update artifacts and `SHA256SUMS`.
5. Install the artifact on a clean Windows VM, exercise account/quota/sync/backup flows, and only then publish `latest.json`.

The updater does not silently install: the user explicitly chooses “Check and install updates”. Production builds enforce HTTPS and Ed25519 signatures. Unsigned or incorrectly signed artifacts are rejected by the updater.

Rollback keeps the previous installer and database schema compatibility for at least one release. If a release is bad, remove its `latest.json` pointer, restore the previous installer as the recommended download, then publish the repaired previous code with a higher patch version; updaters do not downgrade versions. Never roll back a user database by replacing it. Use the automatic `before-restore.db` safety copy or the in-app validated backup flow.

Run `pnpm release:checksums` after packaging and `pnpm release:verify` before uploading. A code-signing certificate for Windows Authenticode is a separate external requirement from Tauri updater signing and must be configured before public distribution.
