#!/bin/sh
# Lists the team's signing identities in the keychain with each certificate's expiry.
set -eu
team="{{TEAM_ID}}"
dev="{{DEVELOPMENT_IDENTITY}}"

security find-identity -v | sed -n 's/.*"\(.*\)"$/\1/p' | sort -u | while IFS= read -r name; do
  case "$name" in
    *"($team)"|"$dev") ;;
    *) continue ;;
  esac
  pem=$(security find-certificate -c "$name" -p 2>/dev/null) || continue
  end=$(printf '%s\n' "$pem" | openssl x509 -noout -enddate | cut -d= -f2)
  if printf '%s\n' "$pem" | openssl x509 -noout -checkend 2592000 >/dev/null; then state=ok; else state="EXPIRES WITHIN 30 DAYS"; fi
  printf '%-64s %s  %s\n' "$name" "$end" "$state"
done
