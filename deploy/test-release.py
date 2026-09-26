"""Linux-only deploy rehearsal in a fresh /tmp directory; never runs the real deploy path."""
import json
import fcntl
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

source = Path(__file__).resolve().with_name("deploy.sh")
work = Path(tempfile.mkdtemp(prefix="ebgeo-deploy-check-")).resolve()
assert work.parent == Path(tempfile.gettempdir()).resolve()
reads = 0
errors = []
stop = threading.Event()

try:
    deploy = work / "deploy"
    deploy.mkdir()
    script = deploy / "deploy.sh"
    script.write_text(source.read_text(), encoding="utf-8")
    dist = work / "frontend" / "dist"
    dist.mkdir(parents=True)
    releases = []

    def publish(label):
        if (dist / "assets").exists():
            shutil.rmtree(dist / "assets")
        (dist / "assets").mkdir()
        (dist / "index.html").write_text(label)
        (dist / "assets" / (label + ".js")).write_text(label)
        # The build writes a hidden source map next to each chunk, and release.json at the root.
        (dist / "assets" / (label + ".js.map")).write_text('{"version":3,"file":"%s.js"}' % label)
        (dist / "release.json").write_text(json.dumps({"release": label}))
        subprocess.run(["bash", str(script), "--skip-build"], check=True, capture_output=True)
        release = (deploy / "current").resolve()
        releases.append(release)
        assert (release / "index.html").read_text() == label
        return release

    a, b, c, d = [publish(label) for label in ["a", "b", "c", "d"]]
    assert not a.exists()
    assert sorted(path.name for path in (d / "assets").iterdir()) == ["b.js", "c.js", "d.js"]
    assert (d / ".release-assets").read_text().splitlines() == ["assets/d.js"]

    # The source maps leave the served tree and are kept per release, beside it, for "diag pilha"
    # (owner's decision of 2026-09-26): nginx serves current/, and a .map in there is public.
    assert not list((deploy / "releases").rglob("*.map")), "a .map is still in the served releases"
    maps = deploy / "sourcemaps"
    assert sorted(path.name for path in maps.iterdir()) == sorted(r.name for r in releases)
    for release, label in zip(releases, "abcd"):
        # The map of "a" outlives its release, pruned above: a defect first seen there still resolves.
        assert (maps / release.name / "assets" / (label + ".js.map")).exists()
        assert json.loads((maps / release.name / "release.json").read_text())["release"] == label

    # Exercise the production swap function while a parallel reader opens index.html.
    functions = source.read_text().split("# ---- Main")[0]
    runner = deploy / "swap-test.sh"
    runner.write_text(functions + f'\nfor i in {{1..100}}; do activate_release "{c.name}"; activate_release "{d.name}"; done\n')

    def reader():
        global reads
        while not stop.is_set():
            try:
                value = (deploy / "current" / "index.html").read_text()
                if value not in ["c", "d"]:
                    errors.append(value)
                reads += 1
            except Exception as error:
                errors.append(str(error))

    thread = threading.Thread(target=reader)
    thread.start()
    try:
        subprocess.run(["bash", str(runner)], check=True, capture_output=True)
    finally:
        stop.set()
        thread.join()
    assert reads > 0 and not errors, errors[:5]
    subprocess.run(["bash", str(script), "--rollback"], check=True, capture_output=True)
    assert (deploy / "current").resolve() == c
    assert (c / 'assets' / 'd.js').read_text() == 'd'
    subprocess.run(["bash", str(script), "--rollback"], check=True, capture_output=True)
    assert (deploy / "current").resolve() == b
    assert (b / 'assets' / 'd.js').read_text() == 'd'
    with (deploy / '.deploy.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        concurrent = subprocess.run(["bash", str(script), "--skip-build"], capture_output=True)
        assert concurrent.returncode != 0
        assert (deploy / "current").resolve() == b
    refused = subprocess.run(["bash", str(script), "--rollback"], capture_output=True)
    assert refused.returncode != 0
    assert (deploy / "current").resolve() == b
    # The maps have a retention of their own, longer than the releases': it prunes the oldest.
    script.write_text(source.read_text().replace("KEEP_SOURCEMAPS=20", "KEEP_SOURCEMAPS=2"), encoding="utf-8")
    e = publish("e")
    assert sorted(path.name for path in maps.iterdir()) == sorted([d.name, e.name])
    print(json.dumps({"publications": 5, "swaps": 200, "concurrent_reads": reads,
                      "read_errors": errors, "previous_chunks_retained": True,
                      "rollback_twice": True, "concurrent_publish_refused": True,
                      "rollback_beyond_retention_refused": True, "maps_out_of_served_tree": True,
                      "maps_kept_per_release": True}))
finally:
    assert work.parent == Path(tempfile.gettempdir()).resolve() and work.name.startswith("ebgeo-deploy-check-")
    shutil.rmtree(work)
