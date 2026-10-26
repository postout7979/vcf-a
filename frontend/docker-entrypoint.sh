#!/bin/sh
set -e

CERT_DIR=/etc/nginx/certs
CERT_FILE="$CERT_DIR/server.crt"
KEY_FILE="$CERT_DIR/server.key"

# Self-signed cert, generated once into a persistent volume so it survives
# image rebuilds (and is never written into the image or the git repo).
# This is an internal portal with no public DNS name, so a self-signed
# cert - trusted once per browser - is the pragmatic choice here; swap in
# a real cert/key pair at this same path if one becomes available.
if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
  mkdir -p "$CERT_DIR"
  # TLS_SAN lets docker-compose.yml pin the portal's actual LAN IP/hostname
  # (certs are only valid for the names in here - browsers ignore CN).
  SAN="${TLS_SAN:-DNS:localhost,IP:127.0.0.1}"
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -keyout "$KEY_FILE" -out "$CERT_FILE" \
    -subj "/CN=vcf-portal" \
    -addext "subjectAltName=$SAN"
fi

exec nginx -g "daemon off;"
