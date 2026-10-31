#!/bin/sh
set -e

# Check if database exists, seed if missing
if [ ! -f /app/server/data/brightloop.db ]; then
  echo "=> No existing database found. Initializing and seeding Brightloop demo data..."
  node /app/server/src/seed.js
else
  echo "=> Existing database found at /app/server/data/brightloop.db."
fi

exec "$@"
