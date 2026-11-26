"""Exercise the real downloader with offline curl responses."""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest


@pytest.fixture
def download_repo(tmp_path: Path) -> tuple[Path, dict[str, str]]:
    root = Path(__file__).resolve().parents[1]
    (tmp_path / "scripts").mkdir()
    (tmp_path / "bin").mkdir()
    shutil.copyfile(root / "scripts/download.sh", tmp_path / "scripts/download.sh")
    curl = tmp_path / "bin/curl"
    curl.write_text(
        f"#!{sys.executable}\n"
        + """import json
import os
import sys
from pathlib import Path

args = sys.argv[1:]
with Path("curl-args").open("a") as log:
    log.write(json.dumps(args) + "\\n")
output = Path(args[args.index("-o") + 1])
manifest = args[-1].endswith(".md5")
mode = os.environ["CURL_MODE"]
if manifest:
    if mode in {"manifest_connect", "not_published", "unavailable", "http_zero"}:
        print({"manifest_connect": "000", "not_published": "404",
               "unavailable": "503", "http_zero": "000"}[mode], end="")
        sys.exit(7 if mode == "manifest_connect" else 28 if mode == "http_zero" else 22)
    output.write_text("d41d8cd98f00b204e9800998ecf8427e  norcal-261001.osm.pbf\\n")
    print("200", end="")
else:
    output.write_text("partial" if mode == "pbf_connect" else "wrong checksum")
    if mode == "pbf_connect":
        sys.exit(7)
"""
    )
    curl.chmod(0o755)
    env = {**os.environ, "PATH": str(tmp_path / "bin") + os.pathsep + os.environ["PATH"]}
    return tmp_path, env


@pytest.mark.parametrize(
    ("mode", "message", "fetches", "partial"),
    [
        ("manifest_connect", "Could not connect to Geofabrik", 1, True),
        ("pbf_connect", "Could not connect to Geofabrik", 2, True),
        ("not_published", "not published", 1, True),
        ("unavailable", "temporarily unavailable", 1, True),
        ("http_zero", "temporarily unavailable", 1, True),
        ("checksum", "Checksum mismatch", 2, False),
    ],
)
def test_download_failures(
    download_repo,
    mode: str,
    message: str,
    fetches: int,
    partial: bool,
) -> None:
    directory, env = download_repo
    env["CURL_MODE"] = mode
    data = directory / "data"
    data.mkdir()
    part = data / "norcal-261001.osm.pbf.part"
    part.write_text("existing partial")
    result = subprocess.run(
        ["bash", "scripts/download.sh", "261001"],
        cwd=directory,
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=20,
    )
    assert result.returncode == 1
    assert message in result.stderr
    if mode.endswith("connect"):
        assert result.stderr == (
            "Could not connect to Geofabrik for norcal-261001.osm.pbf (curl 7)\n"
        )
    calls = [json.loads(line) for line in (directory / "curl-args").read_text().splitlines()]
    assert len(calls) == fetches
    for args in calls:
        assert "--retry-connrefused" in args
    assert calls[0][-1].endswith("/norcal-261001.osm.pbf.md5")
    if fetches == 2:
        assert calls[1][-1].endswith("/norcal-261001.osm.pbf")
    assert part.exists() is partial
    if partial:
        assert part.read_text() == ("partial" if mode == "pbf_connect" else "existing partial")
    assert not (data / "norcal-261001.osm.pbf").exists()
