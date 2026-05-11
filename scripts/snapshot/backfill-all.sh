#!/usr/bin/env bash
# Backfill every snapshot month for every client.
# The (client, month) list is derived from AVAILABLE_MONTHS in
# src/lib/snapshot-months.ts — that file is the single source of truth for
# which months the UI's TimeRangePicker knows about, and this script must
# produce exactly those S3 objects. The probe behind those lists is the
# 2026-05-11 scan of public.provider_quit_risk_v2 (only months with a model
# run).
#
# clinician-roster.sql + provider-metadata.sql are now month-filtered;
# trajectory + Athena prepost queries are skipped (iter-12-specific windows),
# so success_stories.json is not produced in this run.
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
  npx tsx scripts/snapshot/build.ts  --client "$client" --month "$month"
  npx tsx scripts/snapshot/upload.ts --client "$client" --month "$month"
done

echo
echo "=== done ==="
