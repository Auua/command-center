#!/usr/bin/env bash
# Creates the local env files (gitignored) with placeholder values.
# Run from the repo root: bash scripts/setup-env.sh
# Then fill in the two Supabase values from: Dashboard → Project Settings → API
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f apps/web/.env.local || -f apps/api/.env ]]; then
  echo "Refusing to overwrite existing env files (apps/web/.env.local or apps/api/.env)." >&2
  exit 1
fi

mkdir -p apps/web apps/api

cat > apps/web/.env.local <<'EOF'
# Supabase → Dashboard → Project Settings → API
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=REPLACE_WITH_ANON_PUBLIC_KEY

# NestJS API base URL (local dev)
NEXT_PUBLIC_API_URL=http://localhost:3001
EOF

cat > apps/api/.env <<'EOF'
PORT=3001
CORS_ORIGIN=http://localhost:3000

# Supabase → Dashboard → Project Settings → API (same values as the web app)
SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=REPLACE_WITH_ANON_PUBLIC_KEY

# Only for legacy projects still on HS256 JWTs (Dashboard → API → JWT Settings).
# Leave commented out on new projects — the API verifies tokens via JWKS.
# SUPABASE_JWT_SECRET=
EOF

echo "Created apps/web/.env.local and apps/api/.env — now fill in the Supabase URL + anon key."
