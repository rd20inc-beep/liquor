#!/usr/bin/env bash
# Liquor OS deploy — rsync this repo to /opt/liquor-os on the target host,
# then build + boot the compose stack. Idempotent; safe to re-run.
#
# Usage:
#   TARGET=root@69.197.139.11 ./infra/deploy.sh
#
# First run also scaffolds .env with generated secrets. Subsequent runs reuse it.

set -euo pipefail

TARGET="${TARGET:?set TARGET=user@host}"
REMOTE_DIR="${REMOTE_DIR:-/opt/liquor-os}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "→ syncing $REPO_DIR → $TARGET:$REMOTE_DIR"
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '**/node_modules' \
  --exclude 'dist' \
  --exclude '**/dist' \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude '.claude' \
  --exclude 'admin-web/dist' \
  --include '.env.prod.example' \
  "$REPO_DIR/" "$TARGET:$REMOTE_DIR/"

echo "→ ensuring .env exists on remote"
ssh "$TARGET" bash -s -- "$REMOTE_DIR" <<'REMOTE'
  set -euo pipefail
  DIR="$1"
  cd "$DIR"
  if [ ! -f .env ]; then
    echo "  bootstrapping .env with generated secrets"
    JWT=$(openssl rand -hex 32)
    PGP=$(openssl rand -hex 16)
    S3A=$(openssl rand -hex 8)
    S3S=$(openssl rand -hex 24)
    cat > .env <<EOF
POSTGRES_USER=liquor
POSTGRES_PASSWORD=$PGP
POSTGRES_DB=liquor
S3_ACCESS_KEY=$S3A
S3_SECRET_KEY=$S3S
S3_BUCKET=liquor-uploads
JWT_SECRET=$JWT
DEV_OTP=123456
EOF
    chmod 600 .env
    echo "  wrote $DIR/.env (mode 600)"
  fi
REMOTE

echo "→ building admin-web locally"
( cd "$REPO_DIR/admin-web" && pnpm exec vite build > /tmp/liquor-web-build.log 2>&1 ) \
  || { echo "  admin-web build FAILED — see /tmp/liquor-web-build.log"; exit 1; }

echo "→ syncing admin-web/dist → $TARGET:$REMOTE_DIR/admin-web/dist"
rsync -az --delete "$REPO_DIR/admin-web/dist/" "$TARGET:$REMOTE_DIR/admin-web/dist/"

echo "→ building + starting compose stack (this builds api on first run)"
ssh "$TARGET" "cd $REMOTE_DIR && docker compose -f compose.prod.yml --env-file .env up -d --build"

echo "→ waiting for pg health"
ssh "$TARGET" "cd $REMOTE_DIR && for i in \$(seq 1 30); do docker compose -f compose.prod.yml ps pg | grep -q healthy && break; sleep 2; done"

echo "→ applying schema.sql (idempotent; skipped if already deployed)"
ssh "$TARGET" bash -s -- "$REMOTE_DIR" <<'REMOTE'
  set -uo pipefail
  cd "$1"
  # Use --env-file so compose can resolve ${…} references; capture just stdout.
  already=$(docker compose -f compose.prod.yml --env-file .env exec -T pg \
    psql -U liquor -d liquor -At -c "SELECT to_regclass('public.orgs') IS NOT NULL" 2>/dev/null)
  already_trim=$(echo "$already" | tr -d '[:space:]')
  if [ "$already_trim" = "t" ]; then
    echo "  orgs table already exists — skipping"
  else
    echo "  applying (orgs check returned: '${already_trim:-empty}')"
    cat schema.sql | docker compose -f compose.prod.yml --env-file .env exec -T pg \
      psql -U liquor -d liquor -v ON_ERROR_STOP=1 > /tmp/schema-apply.log 2>&1
    rc=$?
    if [ $rc -ne 0 ]; then
      echo "  schema apply FAILED (rc=$rc)"
      tail -20 /tmp/schema-apply.log
      exit $rc
    fi
    echo "  schema applied"
  fi
REMOTE

echo "→ seeding org + users (idempotent)"
ssh "$TARGET" "cd $REMOTE_DIR && docker compose -f compose.prod.yml --env-file .env exec -T api pnpm --filter @liquor/api exec tsx src/seed.ts"

echo
echo "✔ deploy complete."
echo "  API:           http://127.0.0.1:4000   (loopback on $TARGET)"
echo "  MinIO console: http://127.0.0.1:9101   (loopback on $TARGET)"
echo "  Postgres:      127.0.0.1:55432          (loopback on $TARGET)"
echo
echo "  Tunnel from your laptop:"
echo "    ssh -L 4000:127.0.0.1:4000 -L 9101:127.0.0.1:9101 $TARGET"
