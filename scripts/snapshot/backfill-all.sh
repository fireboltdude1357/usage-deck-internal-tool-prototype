#!/usr/bin/env bash
# Backfill every snapshot month for every client.
# The (client, month) list is derived from AVAILABLE_MONTHS in
# src/lib/snapshot-months.ts — that file is the single source of truth for
# which months the UI's TimeRangePicker knows about, and this script must
# produce exactly those S3 objects. The probe behind those lists is the
# 2026-05-11 scan of public.provider_quit_risk_v2 (only months with a model
# run).
#
# Per-iteration pipeline:
#   1. RDS clinician-roster  → drives the four roster-derived snapshots
#      (metrics, market_metrics, provisioned_users, adoption_engagement).
#   2. Four Athena turnover queries → produce the CSVs that build.ts joins
#      into turnover.json (Phase 5 of PLAN-turnover-dashboard.md).
#   3. build.ts → emits every snapshot whose inputs are present; missing
#      inputs cause that file to be skipped quietly. upload.ts only PUTs
#      files that exist locally, so a skipped turnover.json is a no-op.
#
# Skipped from the per-month loop: provider-metadata + quit-prob-trajectories
# (RDS) and claims/encounters/ehr-monthly (Athena) — those feed
# success_stories.json which is iter-12-specific (fixed pre/post windows baked
# into the queries) and only runs at each client's canonical month. Instead,
# this script chains into backfill-success.sh at the end so the S3 wipe
# doesn't orphan success_stories.json. Drop the chain when success-stories
# stops being iter-12-shaped and folds back into the per-month loop.
set -euo pipefail

cd "$(dirname "$0")/../.."

PAIRS_RAW=$(npx tsx -e "
  import { AVAILABLE_MONTHS } from './src/lib/snapshot-months.ts'
  for (const [client, months] of Object.entries(AVAILABLE_MONTHS))
    for (const month of months) console.log(client, month)
")
# Bash 3.2 (macOS default) has no mapfile, so read line-by-line.
PAIRS=()
while IFS= read -r line; do
  [ -n "$line" ] && PAIRS+=("$line")
done <<< "$PAIRS_RAW"
CLIENTS=$(printf "%s\n" "${PAIRS[@]}" | awk '{print $1}' | sort -u)

echo "=== wiping S3 client prefixes ==="
for client in $CLIENTS; do
  echo "rm s3://internal-tool-snapshots/${client}/"
  aws s3 rm "s3://internal-tool-snapshots/${client}/" --recursive 2>&1 | tail -3 || true
done

echo
echo "=== running ${#PAIRS[@]} (client, month) iterations ==="
i=0
for pair in "${PAIRS[@]}"; do
  i=$((i+1))
  read -r client month <<< "$pair"
  echo
  echo "[$i/${#PAIRS[@]}] $client/$month"
  rm -rf "tmp/snapshot/${client}/${month}"
  npx tsx scripts/snapshot/query.ts  --client "$client" --month "$month" --query clinician-roster --source rds
  # Turnover Athena inputs. Each query is invoked individually (rather than
  # `--source athena`) to leave the success-stories Athena queries untouched
  # — see header comment for why.
  for q in employment-monthly employee-timelines quit-prob-history provider-detail; do
    if ! npx tsx scripts/snapshot/query.ts --client "$client" --month "$month" --query "$q" --source athena; then
      echo "  WARN: turnover query $q failed for $client/$month — turnover.json will be skipped" >&2
    fi
  done
  npx tsx scripts/snapshot/build.ts  --client "$client" --month "$month"
  npx tsx scripts/snapshot/upload.ts --client "$client" --month "$month"
done

echo
echo "=== restoring success-stories snapshots ==="
# The wipe at the top of this script deletes every `*/success_stories.json`
# along with everything else, but the per-iteration loop above intentionally
# skips the success-stories queries (iter-12-shaped). Chain into the dedicated
# success backfill so a run of this script leaves S3 fully populated.
bash "$(dirname "$0")/backfill-success.sh"

echo
echo "=== done ==="
