"""Read-only source -> backup -> restore rehearsal for the supplied 3D/360 collection."""
import hashlib
import json
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

source = Path(sys.argv[1]).resolve(strict=True)
report_path = Path(sys.argv[2]).resolve()
work = Path(tempfile.mkdtemp(prefix="ebgeo-release-assets-")).resolve()
assert work.is_relative_to(Path(tempfile.gettempdir()).resolve())
report = {"files": 0, "bytes": 0, "sqlite_restored": [], "differences": []}

try:
    for folder in ["_ebgeo_360", "_ebgeo_360_sqlite", "_ebgeo_3d"]:
        shutil.copytree(source / folder, work / "backup" / folder)
        shutil.copytree(work / "backup" / folder, work / "restore" / folder)
        for path in sorted((source / folder).rglob("*")):
            if not path.is_file():
                continue
            relative = path.relative_to(source)
            def digest(file):
                with file.open("rb") as stream:
                    return hashlib.file_digest(stream, "sha256").hexdigest()
            original = digest(path)
            for phase in ["backup", "restore"]:
                if digest(work / phase / relative) != original:
                    report["differences"].append(str(relative))
            report["files"] += 1
            report["bytes"] += path.stat().st_size
            if path.suffix == ".db":
                restored = work / "restore" / relative
                connection = sqlite3.connect(restored.as_uri() + "?mode=ro&immutable=1", uri=True)
                try:
                    checks = [row[0] for row in connection.execute("PRAGMA integrity_check")]
                    assert checks == ["ok"], (relative, checks)
                    report["sqlite_restored"].append(str(relative))
                finally:
                    connection.close()
    assert not report["differences"], report["differences"]
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
finally:
    # Only the freshly created, checked temporary directory. Never the supplied source.
    assert work.parent == Path(tempfile.gettempdir()).resolve()
    assert work.name.startswith("ebgeo-release-assets-") and work != source
    shutil.rmtree(work)
