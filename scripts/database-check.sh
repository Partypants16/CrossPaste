#!/usr/bin/env bash
# Runs a read-only SQLite integrity check against the running app container's database.
# Usage: ./scripts/database-check.sh
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose exec -T app node scripts/database-check.js
