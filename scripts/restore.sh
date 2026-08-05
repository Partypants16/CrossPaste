#!/usr/bin/env bash
# Restores a backup archive created by backup.sh. This stops CrossPaste, replaces the
# contents of ./data, and restarts it. Your current ./data is moved aside (not deleted)
# first, as a safety net.
#
# Usage (run from the project root on the Ubuntu Server):
#   ./scripts/restore.sh ./backups/crosspaste-backup-20260101T120000Z.tar.gz
set -euo pipefail
cd "$(dirname "$0")/.."

ARCHIVE="${1:-}"
if [ -z "$ARCHIVE" ]; then
  echo "Usage: $0 <path-to-backup-archive.tar.gz>"
  exit 1
fi
if [ ! -f "$ARCHIVE" ]; then
  echo "Archive not found: $ARCHIVE"
  exit 1
fi

echo "This will STOP CrossPaste and REPLACE everything in ./data with the contents of:"
echo "  $ARCHIVE"
read -r -p "Type 'restore' to continue: " CONFIRMATION
if [ "$CONFIRMATION" != "restore" ]; then
  echo "Cancelled."
  exit 1
fi

echo "Stopping CrossPaste..."
docker compose down

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
if [ -d ./data ] && [ -n "$(ls -A ./data 2>/dev/null)" ]; then
  echo "Moving current ./data to ./data.before-restore-$TIMESTAMP as a safety net..."
  mv ./data "./data.before-restore-$TIMESTAMP"
fi
mkdir -p ./data

echo "Extracting $ARCHIVE into ./data ..."
tar xzf "$ARCHIVE" -C ./data

echo "Starting CrossPaste..."
docker compose up -d

echo ""
echo "Restore complete. Verify with: docker compose ps"
echo "Once you've confirmed everything looks right, you can remove the ./data.before-restore-$TIMESTAMP safety copy."
