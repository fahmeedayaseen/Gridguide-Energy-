#!/bin/bash
# GridGuide — First-time setup script
set -e

echo "🚀 GridGuide Setup"
echo "=================="

# Check node
node --version || { echo "Node.js 20+ required"; exit 1; }

# Install deps
echo "📦 Installing dependencies..."
npm install

# Check .env.local
if [ ! -f .env.local ]; then
  cp .env.example .env.local
  echo "⚠️  Created .env.local — fill in your values before continuing"
  echo "   Required: DATABASE_URL, JWT_SECRET, STRIPE_SECRET_KEY"
  exit 0
fi

# Run migrations
echo "🗄️  Running database migrations..."
npx prisma migrate dev --name init

# Generate client
npx prisma generate

# Seed
echo "🌱 Seeding database..."
npm run db:seed

echo ""
echo "✅ Setup complete!"
echo ""
echo "Start dev server:  npm run dev"
echo "Open studio:       npm run db:studio"
echo ""
echo "Demo credentials:"
echo "  Consumer:  alex@example.com / demo123"
echo "  Installer: hello@suntechsolutions.com / install2026"
echo "  Seller:    seller@suntechproducts.com / seller2026"
echo "  Admin:     admin@gridguide.ai / admin2026"
