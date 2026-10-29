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
dates=$(python3 -c '
import datetime as dt
import re
import sys

value = sys.argv[1]
try:
    if value:
        if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            raise ValueError
        date = dt.date.fromisoformat(value)
    else:
        date = dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=1)
    old = date - dt.timedelta(days=1)
except ValueError:
    sys.exit(f"Invalid DATE: {value!r}; expected a real date in YYYY-MM-DD format")
print(date.isoformat(), date.strftime("%y%m%d"), old.strftime("%y%m%d"))
' "${DATE:-}")
read -r date new old <<< "$dates"

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

if [[ -d "results/$date" ]]; then
    echo "results/$date already done; skipping"
    exit 0
fi

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
        if [[ "$scheduled" != 1 ]] || ! grep -q 'not published' "$work_dir/download.stderr"; then
            return "$download_code"
        fi
        if (( attempt >= retries )); then
            echo "Snapshot $snapshot not published after $attempt attempts" >&2
            return "$download_code"
        fi
        echo "Snapshot $snapshot not published; retrying in $retry_seconds seconds"
        sleep "$retry_seconds"
        attempt=$((attempt + 1))
    done
}

download "$old"
download "$new"
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
run_command git commit -m "Add impact results for $date"
run_command git pull --rebase
run_command git push
if [[ "${DAILY_DRY_RUN:-}" != 1 ]]; then
    publish=true
fi

if [[ "$impact_code" == 1 ]]; then
    open_issue "results/$date/report.md" "HIGH risk: $date" "$date"
fi
