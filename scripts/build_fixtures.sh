#!/usr/bin/env bash
# Rebuild checked-in PBF fixtures from XML and the local NorCal snapshot.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v osmium >/dev/null || { echo "osmium-tool is required" >&2; exit 1; }
for version in town_v1 town_v2 town_v2_split; do
    osmium cat "tests/fixtures/${version}.osm" -o "tests/fixtures/${version}.osm.pbf" --overwrite
done
osmium extract --bbox=-122.265,37.865,-122.255,37.875 \
    data/norcal-latest.osm.pbf \
    -o tests/fixtures/berkeley_sample.osm.pbf --overwrite
for fixture in tests/fixtures/*.osm.pbf; do
    bytes=$(wc -c < "$fixture")
    if (( bytes >= 2000000 )); then
        echo "$fixture must be smaller than 2 MB (got $bytes bytes)" >&2
        exit 1
    fi
done
