#!/bin/sh
set -e

echo "Syncing database schema…"
./node_modules/.bin/prisma db push --skip-generate --schema ./prisma/schema.prisma

echo "Seeding admin user (if ADMIN_EMAIL/ADMIN_PASSWORD set)…"
node prisma/seed.js || echo "Seed skipped/failed — continuing."

echo "Seeding GCW service price list…"
node prisma/seed-services.js || echo "Service seed failed — continuing."

echo "Starting GCW Projects…"
exec node server.js
