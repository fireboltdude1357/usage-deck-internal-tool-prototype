#!/usr/bin/env bash
# Build success_stories.json for each client and upload it to the client's
# canonical (latest-run) month-prefix in S3. The snapshot now carries the full
# per-provider per-month series — pre/post is derived live in the page loader
# from the user-selected range — so there's no need to propagate the file to
# every month-prefix.
set -euo pipefail

cd "$(dirname "$0")/../.."

# canonical month per client (latest provider_quit_risk_v2 run_date — must
# match LATEST_SNAPSHOT_MONTH in src/lib/snapshot-months.ts).
declare -a CANONICAL=(
  "bsmh 2026-03"
  "ssm 2026-03"
  "duke 2025-12"
  "ucsf 2025-06"
)

for pair in "${CANONICAL[@]}"; do
  read -r client canonical <<< "$pair"
  echo
  echo "=== $client — building success_stories.json at canonical month $canonical ==="
  TMP="tmp/snapshot/$client/$canonical"
  mkdir -p "$TMP"

  # Run the six success-stories input queries. clinician-roster is shared with
  # the platform/market backfills but rerun here so the build is self-contained.
  # The PostHog cohort gate is applied **live** by the page loader, not at
  # snapshot time — see src/routes/success-stories/+page.ts.
  npx tsx scripts/snapshot/query.ts --client "$client" --month "$canonical" --source rds --query clinician-roster
  npx tsx scripts/snapshot/query.ts --client "$client" --month "$canonical" --source rds --query provider-metadata
  npx tsx scripts/snapshot/query.ts --client "$client" --month "$canonical" --source rds --query quit-prob-trajectories
  npx tsx scripts/snapshot/query.ts --client "$client" --month "$canonical" --source athena --query claims-monthly
  npx tsx scripts/snapshot/query.ts --client "$client" --month "$canonical" --source athena --query encounters-monthly
  npx tsx scripts/snapshot/query.ts --client "$client" --month "$canonical" --source athena --query ehr-monthly

  npx tsx scripts/snapshot/build.ts --client "$client" --month "$canonical" --file success_stories.json

  # Sanity: how many providers ended up in the snapshot?
  n_providers=$(python3 -c "import json,sys; d=json.load(open('$TMP/success_stories.json')); print(len(d['metrics']['providers']))")
  echo "  -> $n_providers providers in success_stories.json"
  if [ "$n_providers" -eq 0 ]; then
    echo "  (skipping upload — empty providers list)"
    continue
  fi

  echo "=== $client — uploading success_stories.json to $canonical ==="
  npx tsx scripts/snapshot/upload.ts --client "$client" --month "$canonical" --file success_stories.json
done

echo
echo "=== done ==="
