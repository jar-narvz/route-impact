#!/usr/bin/env bash
# Compare dated NorCal snapshots, commit results, and open HIGH-risk issues.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

publish=false
work_dir=""
cleanup() {
    if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
        printf 'publish=%s\n' "$publish" >> "$GITHUB_OUTPUT"
    fi
    if [[ -n "$work_dir" ]]; then
        rm -rf "$work_dir"
    fi
}
trap cleanup EXIT

scheduled=0
if [[ -z "${DATE:-}" ]]; then
    scheduled=1
fi

test_high=${TEST_HIGH:-false}
if [[ "$test_high" != true && "$test_high" != false ]]; then
    echo "TEST_HIGH must be true or false" >&2
    exit 1
fi

run_command() {
    if [[ "${DAILY_DRY_RUN:-}" == 1 ]]; then
        printf 'DRY RUN:'
        printf ' %q' "$@"
        printf '\n'
    else
        "$@"
    fi
}

open_issue() {
    local report=$1 title=$2 map_date=$3
    local repository=${GITHUB_REPOSITORY:-jar-narvz/route-impact}
    local owner=${repository%%/*} repo=${repository#*/}
    local map_url="https://${owner}.github.io/${repo}/site/?date=${map_date}"
    python3 -c '
from pathlib import Path
import sys

report, body, url = sys.argv[1:]
with open(report, "rb") as source:
    excerpt = source.read(60000)
Path(body).write_bytes(excerpt + f"\nMap: {url}\nClose this issue to sign off.\n".encode())
' "$report" "$work_dir/issue.md" "$map_url"
    run_command gh issue create --title "$title" --body-file "$work_dir/issue.md"
}

if [[ "$test_high" == true ]]; then
    work_dir=$(mktemp -d)
    mkdir -p "$work_dir/data"
    cp tests/fixtures/town_v1.osm.pbf "$work_dir/data/norcal-261001.osm.pbf"
    cp tests/fixtures/town_v2.osm.pbf "$work_dir/data/norcal-261002.osm.pbf"
    set +e
    route-impact impact --old 261001 --new 261002 \
        --data-dir "$work_dir/data" --results-dir "$work_dir/results" \
        --trips tests/fixtures/town_trips.csv
    impact_code=$?
    set -e
    if [[ "$impact_code" != 1 ]]; then
        echo "expected HIGH (exit 1), got $impact_code" >&2
        exit 1
    fi
    open_issue "$work_dir/results/2026-10-02/report.md" \
        "[test] HIGH risk: fixture town_v1 → town_v2" "2026-10-02"
    exit 0
fi

max_gap=${DAILY_MAX_GAP_DAYS:-3}
if [[ ! "$max_gap" =~ ^[1-9][0-9]*$ ]]; then
    echo "DAILY_MAX_GAP_DAYS must be a positive integer" >&2
    exit 1
fi
plan_args=(plan --max-gap "$max_gap")
if [[ -n "${DATE:-}" ]]; then
    plan_args+=(--date "$DATE")
fi
plan=$(python3 -m route_impact.daily "${plan_args[@]}")
while IFS='=' read -r key value; do
    case "$key" in
        date) date=$value ;;
        new) new=$value ;;
        old) old=$value ;;
        skip) skip=$value ;;
        note) note=$value ;;
    esac
done <<< "$plan"
log_note() {
    if [[ -n "$note" ]]; then
        echo "$note"
        if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
            printf '%s\n' "$note" >> "$GITHUB_STEP_SUMMARY"
        fi
    fi
}
log_note
if [[ "$skip" == true ]]; then
    echo "results/$date already done; skipping"
    exit 0
fi
previous_day=$(python3 -c '
from datetime import date, timedelta
import sys
print((date.fromisoformat(sys.argv[1]) - timedelta(days=1)).strftime("%y%m%d"))
' "$date")
mkdir -p data
for suffix in "" .md5; do
    cached="data/pbf-cache/norcal-$old.osm.pbf$suffix"
    if [[ -f "$cached" ]]; then
        ln -f "$cached" "data/norcal-$old.osm.pbf$suffix"
    fi
done

retries=${DAILY_RETRIES:-3}
retry_seconds=${DAILY_RETRY_SECONDS:-1200}
if [[ ! "$retries" =~ ^[1-9][0-9]*$ || ! "$retry_seconds" =~ ^[0-9]+$ ]]; then
    echo "DAILY_RETRIES must be a positive integer; DAILY_RETRY_SECONDS must be non-negative" >&2
    exit 1
fi
work_dir=$(mktemp -d)

download() {
    local snapshot=$1 attempt=1 download_code
    while true; do
        if bash scripts/download.sh "$snapshot" 2> "$work_dir/download.stderr"; then
            cat "$work_dir/download.stderr" >&2
            return 0
        else
            download_code=$?
        fi
        cat "$work_dir/download.stderr" >&2
        if [[ "$scheduled" == 1 && "$snapshot" == "$old" && "$old" != "$previous_day" ]] &&
            grep -qE 'not published|404' "$work_dir/download.stderr"; then
            return "$download_code"
        fi
        # Retry a snapshot that isn't out yet, and Geofabrik outages that outlast curl's own retries.
        if [[ "$scheduled" != 1 ]] || ! grep -qE 'not published|temporarily unavailable' "$work_dir/download.stderr"; then
            return "$download_code"
        fi
        if (( attempt >= retries )); then
            echo "Snapshot $snapshot unavailable after $attempt attempts" >&2
            return "$download_code"
        fi
        echo "Snapshot $snapshot unavailable; retrying in $retry_seconds seconds"
        sleep "$retry_seconds"
        attempt=$((attempt + 1))
    done
}

if download "$old"; then
    :
else
    download_code=$?
    if [[ "$scheduled" != 1 || "$old" == "$previous_day" ]] ||
        ! grep -qE 'not published|404' "$work_dir/download.stderr"; then
        exit "$download_code"
    fi
    fallback_note=$(python3 -c '
from datetime import datetime, timedelta
import sys
start = datetime.strptime("20" + sys.argv[1], "%Y%m%d").date() + timedelta(days=1)
end = datetime.strptime("20" + sys.argv[2], "%Y%m%d").date()
print(f"Fresh start: chained OLD {sys.argv[1]} not published; uncovered dates {start} through {end}.")
' "$old" "$previous_day")
    note="${note:+$note }$fallback_note"
    log_note
    old=$previous_day
    download "$old"
fi
download "$new"
df -h .
set +e
route-impact impact --old "$old" --new "$new"
impact_code=$?
set -e
if [[ "$impact_code" != 0 && "$impact_code" != 1 ]]; then
    echo "route-impact impact failed with exit code $impact_code" >&2
    exit "$impact_code"
fi

run_command git config user.name 'github-actions[bot]'
run_command git config user.email '41898699+github-actions[bot]@users.noreply.github.com'
run_command git add "results/$date/"
commit_args=(-m "Add impact results for $date")
if [[ -n "$note" ]]; then
    commit_args+=(-m "$note")
fi
run_command git commit "${commit_args[@]}"
run_command git pull --rebase
run_command git push
if [[ "${DAILY_DRY_RUN:-}" != 1 ]]; then
    publish=true
    mkdir -p data/pbf-cache
    find data/pbf-cache -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    ln "data/norcal-$new.osm.pbf" "data/pbf-cache/norcal-$new.osm.pbf"
    ln "data/norcal-$new.osm.pbf.md5" "data/pbf-cache/norcal-$new.osm.pbf.md5"
    df -h .
fi

if [[ "$impact_code" == 1 ]]; then
    open_issue "results/$date/report.md" "HIGH risk: $date" "$date"
fi
