#!/usr/bin/env bash
# Fetch the intermediate certificate SARAS's leaf names in its AIA field (what a browser does).
set -u
echo | openssl s_client -connect saras.cbse.gov.in:443 -servername saras.cbse.gov.in 2>/dev/null | openssl x509 > leaf.pem || exit 0
url=$(openssl x509 -in leaf.pem -noout -text | grep -m1 "CA Issuers - URI:" | sed 's/.*URI://')
echo "issuer at: $url"
openssl x509 -in leaf.pem -noout -issuer -subject
[ -n "$url" ] || exit 0
curl -s --max-time 20 "$url" -o inter.der || exit 0
openssl x509 -inform DER -in inter.der -out intermediate.pem 2>/dev/null || openssl x509 -in inter.der -out intermediate.pem
openssl x509 -in intermediate.pem -noout -issuer -subject
openssl verify -untrusted intermediate.pem leaf.pem || true
