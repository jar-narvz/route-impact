"""Copy or check exactly the shipped files in a playground export."""

import argparse
import hashlib
import json
import shutil
from pathlib import Path


def manifest(directory: Path) -> dict[str, str | None]:
    meta = json.loads((directory / "meta.json").read_text())
    files: dict[str, str | None] = {"meta.json": None}
    for entry in meta["files"]:
        if entry.get("shipped", True) is False:
            continue
        name = entry["file"]
        if Path(name).name != name or name in (".", ".."):
            raise ValueError(f"Invalid shipped filename: {name}")
        files[name] = entry.get("sha256")
    return files


def check(directory: Path, files: dict[str, str | None]) -> None:
    actual = {path.name for path in directory.iterdir()}
    extra, missing = actual - files.keys(), files.keys() - actual
    if extra or missing:
        raise ValueError(f"File listing mismatch: extra={sorted(extra)}, missing={sorted(missing)}")
    for name, expected in files.items():
        path = directory / name
        if not path.is_file() or path.is_symlink():
            raise ValueError(f"Not a regular file: {name}")
        if expected and hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f"SHA256 mismatch: {name}")


def ship(source: Path, destination: Path) -> None:
    files = manifest(source)
    destination.mkdir(parents=True, exist_ok=True)
    extra = {path.name for path in destination.iterdir()} - files.keys()
    if extra:
        raise ValueError(f"Extra destination files: {sorted(extra)}")
    for name in files:
        target = destination / name
        if target.is_symlink():
            raise ValueError(f"Destination is a symlink: {name}")
        shutil.copyfile(source / name, target)
    check(destination, files)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", type=Path, metavar="DEST_DIR")
    parser.add_argument("export_dir", type=Path, nargs="?")
    parser.add_argument("dest_dir", type=Path, nargs="?")
    args = parser.parse_args()
    try:
        if args.check is not None:
            if args.export_dir is not None or args.dest_dir is not None:
                parser.error("--check takes only a destination directory")
            check(args.check, manifest(args.check))
        else:
            if args.export_dir is None or args.dest_dir is None:
                parser.error("provide export_dir and dest_dir, or --check dest_dir")
            ship(args.export_dir, args.dest_dir)
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, f"Playground shipping failed: {error}\n")


if __name__ == "__main__":
    main()
