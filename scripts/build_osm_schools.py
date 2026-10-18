#!/usr/bin/env python3
"""Build src/data/osm-schools-ke.json from a Kenya OpenStreetMap extract.

Why this exists: the Outreach "Discover" button used to depend on the free public Overpass servers,
which are often at capacity or refuse cloud IPs. This script produces our OWN snapshot of named
schools and kindergartens per county, so Discover never has to wait on a third party.

Needs: osmium-tool on PATH, and `pip install shapely`. Run by .github/workflows/refresh-osm-schools.yml
(GitHub runners can reach download.geofabrik.de; the dev sandbox cannot).

    python3 scripts/build_osm_schools.py kenya-latest.osm.pbf src/data/osm-schools-ke.json

Data: (c) OpenStreetMap contributors, ODbL. Every staged prospect carries that attribution.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parent.parent
DISCOVERY_TS = ROOT / "src/lib/outbound/discovery.ts"

# Only the tags the app's parser (parseOverpassResponse / classifyLevel / classifyType) reads.
KEEP_TAGS = [
    "name",
    "amenity",
    "isced:level",
    "operator",
    "operator:type",
    "addr:suburb",
    "addr:city",
    "addr:town",
    "phone",
    "contact:phone",
    "contact:mobile",
    "website",
    "contact:website",
    "email",
    "contact:email",
]


def norm(s: str) -> str:
    s = re.sub(r"\b(county|city)\b", "", s, flags=re.I)
    return re.sub(r"[^a-z0-9]", "", s.lower())


def county_names() -> list[str]:
    """Single source of truth: the KENYA_COUNTIES list in discovery.ts."""
    text = DISCOVERY_TS.read_text(encoding="utf-8")
    block = re.search(r"KENYA_COUNTIES\s*=\s*\[(.*?)\]\s*as const", text, re.S)
    if not block:
        sys.exit("could not find KENYA_COUNTIES in discovery.ts")
    names = re.findall(r'"([^"]+)"', block.group(1))
    if len(names) != 47:
        sys.exit(f"expected 47 counties in discovery.ts, found {len(names)}")
    return names


def osmium_geojson(pbf: str, expr: list[str], geometry_types: str, out: Path) -> list[dict]:
    with tempfile.TemporaryDirectory() as tmp:
        filtered = Path(tmp) / "f.osm.pbf"
        subprocess.run(["osmium", "tags-filter", pbf, *expr, "-o", str(filtered), "--overwrite"], check=True)
        subprocess.run(
            ["osmium", "export", str(filtered), "-f", "geojsonseq", f"--geometry-types={geometry_types}",
             "--add-unique-id=type_id", "-o", str(out), "--overwrite"],
            check=True,
        )
    feats = []
    for line in out.read_text(encoding="utf-8").splitlines():
        line = line.strip("\x1e \n")
        if line:
            feats.append(json.loads(line))
    return feats


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    pbf, out_path = sys.argv[1], Path(sys.argv[2])
    names = county_names()
    by_norm = {norm(n): n for n in names}

    work = Path(tempfile.mkdtemp())

    # 1. County polygons (admin_level=4 boundaries) from the same extract.
    boundaries = osmium_geojson(pbf, ["r/boundary=administrative", "r/admin_level=4"], "polygon", work / "b.seq")
    polys, poly_county = [], []
    for f in boundaries:
        p = f.get("properties", {})
        if p.get("boundary") != "administrative" or p.get("admin_level") != "4":
            continue
        county = by_norm.get(norm(p.get("name", "")))
        if not county or not f.get("geometry"):
            continue
        geom = shape(f["geometry"])
        if not geom.is_valid:
            geom = geom.buffer(0)
        polys.append(geom)
        poly_county.append(county)
    found = sorted(set(poly_county))
    missing = [n for n in names if n not in found]
    print(f"county polygons: {len(found)}/47", file=sys.stderr)
    if missing:
        print(f"WARNING: no boundary found for: {', '.join(missing)}", file=sys.stderr)
    if len(found) < 40:
        sys.exit("too few county boundaries matched; refusing to write a partial dataset")
    tree = STRtree(polys)

    # 2. Named schools and kindergartens (nodes, closed ways, multipolygon relations).
    schools = osmium_geojson(pbf, ["nwr/amenity=school,kindergarten"], "point,polygon", work / "s.seq")

    counties: dict[str, list[dict]] = {n: [] for n in names}
    unassigned = 0
    unnamed = 0
    for f in schools:
        props = f.get("properties") or {}
        name = (props.get("name") or "").strip()
        if not name:
            unnamed += 1
            continue
        if not f.get("geometry"):
            continue
        g = shape(f["geometry"])
        pt = g if isinstance(g, Point) else g.representative_point()
        hits = [i for i in tree.query(pt, predicate="within")]
        if not hits:
            unassigned += 1
            continue
        tags = {k: props[k].strip() for k in KEEP_TAGS if props.get(k) and props[k].strip()}
        counties[poly_county[min(hits)]].append({"id": f.get("id", ""), "tags": tags})

    for n in counties:
        counties[n].sort(key=lambda e: e["tags"]["name"].lower())
    counties = {n: v for n, v in counties.items() if v}

    total = sum(len(v) for v in counties.values())
    print(f"schools kept: {total}; unnamed skipped: {unnamed}; outside all counties: {unassigned}", file=sys.stderr)
    for n in sorted(counties, key=lambda k: -len(counties[k]))[:10]:
        print(f"  {n}: {len(counties[n])}", file=sys.stderr)
    if total < 500:
        sys.exit("suspiciously few schools; refusing to write a partial dataset")

    out = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "source": "OpenStreetMap contributors (ODbL), Geofabrik Kenya extract",
        "counties": counties,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {out_path} ({out_path.stat().st_size // 1024} KB)", file=sys.stderr)


if __name__ == "__main__":
    main()
