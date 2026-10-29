#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
    echo "Usage: scripts/bench.sh SNAPSHOT [OLD]" >&2
    exit 2
fi
python="${PYTHON:-python}"
snapshot="$1"
date_label=$("$python" -c 'import sys; from route_impact.metrics import snapshot_date; print(snapshot_date(sys.argv[1]).strftime("%Y-%m-%d"))' "$snapshot")
out="results/$date_label/metrics.json"
case "$(uname -s)" in
    Darwin) time_flag=-l ;;
    Linux) time_flag=-v ;;
    *) echo "Unsupported time platform" >&2; exit 2 ;;
esac
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
args=(--snapshot "$snapshot" --out "$out")
if [[ -n "${2:-}" ]]; then args+=(--old "$2"); fi
if /usr/bin/time "$time_flag" "$python" -m route_impact.metrics run "${args[@]}" 2>"$scratch/time.log"; then
    "$python" -m route_impact.metrics add-rss --log "$scratch/time.log" --out "$out"
else
    cat "$scratch/time.log" >&2
    exit 2
fi
printf '%s\n' "$out"
