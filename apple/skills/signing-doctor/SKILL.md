---
name: signing-doctor
description: Diagnose code signing, provisioning profile, certificate expiry and keychain errors for the {{TEAM_NAME}} team, and renew certificates.
---

# Signing doctor

Run the one check that matches the error. Do not run them all.

| Symptom | Check | Fix |
|---|---|---|
| "No signing certificate" / "no identity found" | `{{ENV_DIR}}/scripts/verify.sh` | Identity missing or expired: renew (`{{ENV_DIR}}/docs/account-setup.md`) |
| "No profiles for ..." / "requires a provisioning profile" | Is Xcode signed in to the team's account? | Add `-allowProvisioningUpdates`; owner signs Xcode in |
| Signed with the wrong team | `codesign -dvv <path> 2>&1 \| grep TeamIdentifier` | Set `DEVELOPMENT_TEAM = {{TEAM_ID}}`; name the identity in full |
| `errSecInternalComponent` or codesign hangs | Keychain locked or key access not granted | Owner unlocks the login keychain and clicks Always Allow |
| "unable to build chain to self-signed root" | Apple intermediate missing | Open Xcode once, or install WWDR G3 / Developer ID G2 from apple.com/certificateauthority |
| Device not eligible | Device UDID not on the team | Owner registers it (portal > Devices) |
| App "is damaged" / blocked by Gatekeeper | `spctl -a -vv <app>` | Not notarized or not stapled: release-mac skill |

Inspect a signature: `codesign -dvv --entitlements - <path> 2>&1 | head -30`
Inspect a profile: `security cms -D -i <profile> | plutil -p - | head -40`

## Limits
- Private keys are non-extractable in the login keychain. Never export one,
  never write a key or `.p12` to disk, never run `set-key-partition-list`
  with a password.
- Never revoke a certificate and never register a device without the owner
  saying so. Revoking a Developer ID certificate blocks every app signed
  with it.
- Portal changes (new certificate, App ID, device, profile) are made by the
  owner or with the owner's go-ahead in their signed-in browser.
