"""Read-only structural checks of the auxiliary 3D/360 test data.

Usage: python audit-migration-assets.py DATA_DIRECTORY REPORT_JSON
Requires Pillow. Does not mount resources into the running application.
"""
import json
import sqlite3
import struct
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import unquote, urlsplit

from PIL import Image

root = Path(sys.argv[1]).resolve(strict=True)
report = {"folders": {}, "errors": [], "sqlite": []}


def content_urls(value):
    if isinstance(value, dict):
        content = value.get("content")
        if isinstance(content, dict) and (content.get("uri") or content.get("url")):
            yield content.get("uri") or content["url"]
        for child in value.values():
            yield from content_urls(child)
    elif isinstance(value, list):
        for child in value:
            yield from content_urls(child)


for name in ["_ebgeo_360", "_ebgeo_360_sqlite", "_ebgeo_3d"]:
    if not (root / name).is_dir():
        report["errors"].append({"file": name, "error": "Missing asset directory"})
        continue
    count = Counter()
    size = 0
    for file in (root / name).rglob("*"):
        if not file.is_file():
            continue
        size += file.stat().st_size
        try:
            suffix = file.suffix.lower()
            if suffix in [".jpg", ".png", ".webp"]:
                with Image.open(file) as image:
                    image.verify()
                count["images_verified"] += 1
            elif suffix == ".json":
                document = json.loads(file.read_text(encoding="utf-8-sig"))
                count["json_valid"] += 1
                if name == "_ebgeo_3d":
                    for url in content_urls(document):
                        parsed = urlsplit(url)
                        if parsed.scheme or parsed.netloc:
                            count["external_references_not_fetched"] += 1
                            continue
                        if not (file.parent / unquote(parsed.path)).is_file():
                            raise ValueError(f"Missing tileset content: {url}")
                        count["tileset_references_found"] += 1
            elif suffix in [".b3dm", ".glb"]:
                offset = 0
                length = file.stat().st_size
                with file.open("rb") as stream:
                    if suffix == ".b3dm":
                        magic, version, declared, *tables = struct.unpack("<4s6I", stream.read(28))
                        if magic != b"b3dm" or version != 1 or declared != length:
                            raise ValueError("Invalid b3dm header/length")
                        offset = 28 + sum(tables)
                        stream.seek(offset)
                    magic, version, glb_length = struct.unpack("<4sII", stream.read(12))
                if magic != b"glTF" or version not in (1, 2) or offset + glb_length > length:
                    raise ValueError("Invalid GLB header/length")
                count[suffix[1:] + "_headers_valid"] += 1
            elif suffix == ".db":
                wal = Path(str(file) + "-wal")
                if wal.exists() and wal.stat().st_size:
                    raise ValueError("Nonempty WAL: a consistent copy is required")
                # Immutable + read-only prevents creating/updating SQLite sidecar files.
                connection = sqlite3.connect(file.as_uri() + "?mode=ro&immutable=1", uri=True)
                try:
                    checks = [row[0] for row in connection.execute("PRAGMA quick_check")]
                    tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")]
                finally:
                    connection.close()
                report["sqlite"].append({"file": str(file.relative_to(root)), "quick_check": checks, "tables": tables})
                if checks != ["ok"]:
                    raise ValueError("SQLite quick_check failed")
                count["sqlite_verified"] += 1
        except Exception as error:
            report["errors"].append({"file": str(file.relative_to(root)), "error": str(error)})
    report["folders"][name] = {"bytes": size, **count}

Path(sys.argv[2]).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False))
sys.exit(1 if report["errors"] else 0)
