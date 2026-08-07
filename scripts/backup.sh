#!/usr/bin/env bash
# Creates a timestamped backup archive of the SQLite database (via a safe online
# backup snapshot, not a raw file copy), uploaded images, thumbnails, and shared files.
#
# Usage (run from the project root on the Ubuntu Server, app container running):
#   ./scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="./backups"
ARCHIVE="$BACKUP_DIR/crosspaste-backup-$TIMESTAMP.tar.gz"
SNAPSHOT_NAME="_backup_snapshot.db"

mkdir -p "$BACKUP_DIR"

echo "Creating a consistent SQLite snapshot inside the running app container..."
docker compose exec -T app node scripts/backup.js "/app/data/$SNAPSHOT_NAME"

echo "Archiving snapshot, uploads, thumbnails, and files to $ARCHIVE ..."
mkdir -p ./data/files
tar czf "$ARCHIVE" \
  -C ./data \
  --transform "flags=r;s|^$SNAPSHOT_NAME\$|crosspaste.db|" \
  "$SNAPSHOT_NAME" uploads thumbnails files

echo "Removing temporary snapshot from the data directory..."
docker compose exec -T app rm -f "/app/data/$SNAPSHOT_NAME"

echo ""
echo "Backup complete: $ARCHIVE"
echo "Verify the archive is readable with: tar tzf $ARCHIVE"
