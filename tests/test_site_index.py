import json
from pathlib import Path

from route_impact.site_index import build_index, main


def _impact(new: str, old: str, level: str = "LOW", slowed: int = 0) -> dict:
    return {
        "new": new,
        "old": old,
        "exit_code": 0,
        "risk": {"level": level, "rule": "rule"},
        "metrics": {"broken": 0, "slowed": slowed, "rerouted": 7, "trips_total": 10},
    }


def _day(results: Path, name: str, new: str, old: str, **kwargs: object) -> Path:
    directory = results / name
    directory.mkdir(parents=True)
    (directory / "impact.json").write_text(json.dumps(_impact(new, old, **kwargs)))
    (directory / "report.md").write_text("report")
    (directory / "impact.geojson").write_text("{}")
    return directory


def _sample(results: Path, name: str) -> Path:
    directory = results / "samples" / name
    directory.mkdir(parents=True)
    (directory / "impact.json").write_text(
        json.dumps(_impact("261027+what-if", "261027", "HIGH", 3))
    )
    (directory / "impact.geojson").write_text("{}")
    (directory / "sample.json").write_text(json.dumps({"title": "Closed", "note": "Simulated"}))
    return directory


def test_days_are_newest_first_and_carry_counts(tmp_path: Path) -> None:
    _day(tmp_path, "2026-10-24", "261024", "261023")
    _day(tmp_path, "2026-11-01", "261101", "261031", level="MEDIUM", slowed=2)
    index = build_index(tmp_path)
    assert [day["date"] for day in index["days"]] == ["2026-11-01", "2026-10-24"]
    assert index["days"][0] == {
        "date": "2026-11-01",
        "risk": "MEDIUM",
        "broken": 0,
        "slowed": 2,
        "rerouted": 7,
        "trips_total": 10,
    }


def test_incomplete_days_and_other_folders_are_left_out(tmp_path: Path) -> None:
    _day(tmp_path, "2026-10-24", "261024", "261023")
    (_day(tmp_path, "2026-10-25", "261025", "261024") / "report.md").unlink()
    (tmp_path / "faults").mkdir()
    (tmp_path / "playground").mkdir()
    assert [day["date"] for day in build_index(tmp_path)["days"]] == ["2026-10-24"]


def test_samples_are_listed_apart_from_days(tmp_path: Path) -> None:
    _day(tmp_path, "2026-10-24", "261024", "261023")
    _sample(tmp_path, "bay-bridge")
    index = build_index(tmp_path)
    assert len(index["days"]) == 1
    assert index["samples"] == [
        {
            "id": "bay-bridge",
            "title": "Closed",
            "note": "Simulated",
            "risk": "HIGH",
            "broken": 0,
            "slowed": 3,
            "rerouted": 7,
            "trips_total": 10,
        }
    ]


def test_no_samples_folder_is_fine(tmp_path: Path) -> None:
    assert build_index(tmp_path) == {"days": [], "samples": []}


def test_main_writes_the_index(tmp_path: Path) -> None:
    results = tmp_path / "results"
    _day(results, "2026-10-24", "261024", "261023")
    output = tmp_path / "index.json"
    assert main([str(results), str(output)]) == 0
    assert json.loads(output.read_text())["days"][0]["date"] == "2026-10-24"
