#!/bin/sh
# Makes the packages the browser stores take, in store/out/.
#
#   chrome.zip    Chrome Web Store and Microsoft Edge Add-ons. The manifest's `key` is left
#                 out: a store gives the item its own id and refuses a package that names one.
#   firefox.zip   addons.mozilla.org, listed or signed for our own download.
#   source.zip    What Mozilla's reviewers are given: the same files, which are not built
#                 or minified from anything else.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out="$here/out"
rm -rf "$out" && mkdir -p "$out/chrome"
cp -R "$here/../extension/." "$out/chrome/"
node -e '
  const fs = require("node:fs");
  const path = process.argv[1];
  const { key, ...manifest } = JSON.parse(fs.readFileSync(path, "utf8"));
  fs.writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
' "$out/chrome/manifest.json"
(cd "$out/chrome" && zip -q -r -X ../chrome.zip . -x '.*')
rm -rf "$out/chrome"
(cd "$here/../extension-page" && zip -q -r -X "$out/firefox.zip" . -x '.*')
cp "$out/firefox.zip" "$out/source.zip"
ls -l "$out" | awk 'NR>1 {print $5, $9}'
