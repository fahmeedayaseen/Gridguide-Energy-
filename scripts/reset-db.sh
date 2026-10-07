#!/bin/bash
# Hard reset database and reseed
set -e
echo "⚠️  Resetting database..."
npx prisma migrate reset --force
npm run db:seed
echo "✅ Database reset and reseeded"
