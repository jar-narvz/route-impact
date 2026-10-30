#!/usr/bin/env bash
# Download a Geofabrik NorCal snapshot, resuming and verifying before publishing.
set -euo pipefail

date=${1:-}
if [[ $# -gt 1 || ( -n "$date" && ! "$date" =~ ^[0-9]{6}$ ) ]]; then
    echo "DATE must be 6 digits (YYMMDD)" >&2
    exit 1
fi

if command -v md5sum >/dev/null 2>&1; then
    checksum() {
        local result
        result=$(md5sum "$1")
        printf '%s\n' "${result%% *}"
    }
elif command -v md5 >/dev/null 2>&1; then
    checksum() {
        md5 -q "$1"
    }
else
    echo "Checksum verification requires md5sum or md5" >&2
    exit 1
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."
mkdir -p data
filename="norcal-${date:-latest}.osm.pbf"
pbf="data/$filename"
manifest="$pbf.md5"
base_url="https://download.geofabrik.de/north-america/us/california"
# curl itself retries brief outages (timeouts, 408/429/5xx) a few times.
curl_retry=(--retry 3 --retry-delay 30)

matches_checksum() {
    local expected remainder actual
    [[ -f "$1" && -f "$manifest" ]] || return 1
    read -r expected remainder < "$manifest" || return 1
    [[ "$expected" =~ ^[[:xdigit:]]{32}$ ]] || return 1
    expected=$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')
    actual=$(checksum "$1") || return 1
    [[ "$actual" == "$expected" ]]
}

# Dated snapshots are immutable; latest always needs a fresh manifest.
if [[ -n "$date" ]] && matches_checksum "$pbf"; then
    echo "$filename already present, checksum OK"
    exit 0
fi

manifest_tmp=$(mktemp "$manifest.XXXXXX")
trap 'rm -f "$manifest_tmp"' EXIT
http_status=""
if http_status=$(curl -fsS "${curl_retry[@]}" -w '%{http_code}' -o "$manifest_tmp" "$base_url/$filename.md5"); then
    if [[ ! -s "$manifest_tmp" ]]; then
        echo "Empty checksum manifest for $filename" >&2
        exit 1
    fi
    mv "$manifest_tmp" "$manifest"
else
    if [[ "$http_status" == 404 ]]; then
        echo "$filename not published on Geofabrik" >&2
    elif [[ "$http_status" =~ ^(000|5[0-9][0-9])$ ]]; then
        echo "Geofabrik temporarily unavailable (HTTP $http_status) for $filename" >&2
    else
        echo "Failed to fetch checksum manifest for $filename" >&2
    fi
    exit 1
fi

if matches_checksum "$pbf"; then
    echo "$filename already present, checksum OK"
    exit 0
fi

if ! curl -fL "${curl_retry[@]}" -C - -o "$pbf.part" "$base_url/$filename"; then
    echo "Download failed for $filename; partial file kept for resume (temporarily unavailable)" >&2
    exit 1
fi
if ! matches_checksum "$pbf.part"; then
    rm -f "$pbf.part"
    echo "Checksum mismatch for $filename; partial file deleted" >&2
    exit 1
fi
mv "$pbf.part" "$pbf"
echo "$filename downloaded, checksum OK"
