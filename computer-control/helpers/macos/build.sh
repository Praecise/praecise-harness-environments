#!/bin/sh
# Build the macOS helper. One file, one compiler job, at the lowest priority, so it can
# be built on a machine someone is working at.
#
#   ./build.sh [output]        default: ./praecise-computer-helper
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=${1:-"$here/praecise-computer-helper"}
nice -n 20 xcrun swiftc -swift-version 6 -O -j 1 -target "$(uname -m)-apple-macos14.0" "$here/main.swift" -o "$out"
echo "$out"
