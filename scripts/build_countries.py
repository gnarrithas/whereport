#!/usr/bin/env python3
"""Compact Natural Earth admin-0 country polygons into a GeoJSON the map loads to mark guessed countries.

Source: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
Each feature keeps only its ISO 3166-1 alpha-2 code (the airport data's country codes) as "code", and
coordinates are rounded to keep the file small.
"""

import argparse
import json
import logging
import sys
from pathlib import Path

log = logging.getLogger("build_countries")

# Natural Earth's code field that fills in ISO_A2 gaps (France, Norway, Kosovo); "-99" means no code.
CODE_FIELD = "ISO_A2_EH"
NO_CODE = "-99"


def round_coords(coords, digits: int):
    """Round a GeoJSON coordinate array of any nesting depth."""
    if coords and isinstance(coords[0], (int, float)):
        return [round(c, digits) for c in coords]
    return [round_coords(c, digits) for c in coords]


def compact(source: dict, digits: int) -> tuple[dict, list[str]]:
    """Strip each country to its code and rounded geometry; return the collection and the names skipped."""
    features, skipped = [], []
    for feature in source.get("features", []):
        props = feature.get("properties") or {}
        code = props.get(CODE_FIELD)
        geometry = feature.get("geometry")
        if not code or code == NO_CODE or not geometry:
            skipped.append(props.get("NAME") or "?")
            continue
        features.append({
            "type": "Feature",
            "properties": {"code": code},
            "geometry": {"type": geometry["type"], "coordinates": round_coords(geometry["coordinates"], digits)},
        })
    return {"type": "FeatureCollection", "features": features}, skipped


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=Path, help="Natural Earth admin-0 countries GeoJSON")
    parser.add_argument("output", type=Path, help="where to write the compact GeoJSON, e.g. public/countries.geojson")
    parser.add_argument("--digits", type=int, default=2, help="decimal places kept per coordinate (default: 2)")
    parser.add_argument("-v", "--verbose", action="store_true", help="log debug details")
    args = parser.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(levelname)s %(message)s")

    if args.digits < 0:
        log.error("--digits must be non-negative")
        return 2
    try:
        source = json.loads(args.source.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        log.error("cannot read %s: %s", args.source, e)
        return 1

    result, skipped = compact(source, args.digits)
    if not result["features"]:
        log.error("no country features with a %s code in %s", CODE_FIELD, args.source)
        return 1
    if skipped:
        log.info("skipped %d features without a code: %s", len(skipped), ", ".join(skipped))

    try:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    except OSError as e:
        log.error("cannot write %s: %s", args.output, e)
        return 1
    log.info("wrote %d countries to %s (%d KB)", len(result["features"]), args.output,
             args.output.stat().st_size // 1024)
    return 0


if __name__ == "__main__":
    sys.exit(main())
