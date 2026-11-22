# Apple Developer account setup for one Mac

What the environment expects to find. Do this once per Mac; it is the owner's job,
because it needs the account's sign-in.

## Certificates

Create each certificate at developer.apple.com/account > Certificates > +, from a
request whose private key never leaves the keychain:

```
openssl genrsa -out new.key 2048
openssl req -new -key new.key -out new.certSigningRequest \
  -subj "/emailAddress=<apple account email>/CN={{TEAM_NAME}}/C=<country>"
security import new.key -k ~/Library/Keychains/login.keychain-db -t priv -x \
  -T /usr/bin/codesign -T /usr/bin/productsign -T /usr/bin/productbuild
rm -P new.key
```

Upload the request, download the `.cer`, then
`security import the.cer -k ~/Library/Keychains/login.keychain-db`.

`-x` makes the key non-extractable: it cannot be exported to a `.p12`. Another Mac
gets its own certificate. Leave `-x` out only if you need a backup you will guard.

| Certificate type on the portal | Used for |
|---|---|
| Apple Development | Run and debug on devices |
| Apple Distribution | App Store and TestFlight, all platforms |
| Mac Installer Distribution | Mac App Store packages |
| Developer ID Application | Mac apps outside the App Store |
| Developer ID Installer | Mac `.pkg` installers outside the App Store |

Renewal is the same steps with a new request. Apps already signed and notarized
with a Developer ID certificate keep working after it expires. Never revoke a
Developer ID certificate unless its key is compromised.

Check what this Mac holds: `{{ENV_DIR}}/scripts/verify.sh`

## Xcode

- Settings > Accounts: sign in with the team's Apple Account. Xcode then creates
  App IDs and provisioning profiles itself.
- Settings > Intelligence > Agents: Get next to Claude Agent, Install, sign in.
- Settings > Intelligence > Model Context Protocol: set "Allow External Agents to
  Use Xcode Tools" to "While Xcode is Open".

## Notarization credential

Make an app-specific password at account.apple.com, then store it once:

```
xcrun notarytool store-credentials {{NOTARY_PROFILE}} \
  --apple-id <apple account email> --team-id {{TEAM_ID}}
```
