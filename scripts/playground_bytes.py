"""Measure the playground transfer without network access; tiles are excluded."""

import argparse
import gzip
import json
import re
from pathlib import Path


def imports(path: Path) -> list[Path]:
    """Find local static and dynamic module imports."""
    pattern = r"(?:from\s*|import\s*\(?\s*)['\"](\.[^'\"]+\.(?:js|mjs))['\"]"
    return [(path.parent / name).resolve() for name in re.findall(pattern, path.read_text())]


def own_files(page: Path) -> set[Path]:
    pending = [page / "app.js", page / "worker.js"]
    found = {page / "index.html", page / "style.css"}
    while pending:
        path = pending.pop().resolve()
        if path in found:
            continue
        found.add(path)
        pending.extend(imports(path))
    return found


def ledger(root: Path) -> dict[str, object]:
    page = root / "site/playground"
    files = {
        str(path.relative_to(root)): len(gzip.compress(path.read_bytes(), 9, mtime=0))
        for path in sorted(own_files(page))
    }
    files.update(
        {
            str(path.relative_to(root)): path.stat().st_size
            for path in sorted((page / "data").rglob("*"))
            if path.is_file()
        }
    )
    external = json.loads((root / "results/playground/p5_external_bytes.json").read_text())
    files.update(external["files"])
    total = sum(files.values())
    return {"files": files, "total_bytes": total, "limit": 10_000_000, "pass": total <= 10_000_000}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("results/playground/p5a_bytes.json"))
    args = parser.parse_args()
    result = ledger(Path(__file__).resolve().parents[1])
    text = json.dumps(result, indent=2) + "\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(text)
    print(text, end="")
    return 0 if result["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
