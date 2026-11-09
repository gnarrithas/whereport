#!/usr/bin/env python3
"""Compact a Flight Atlas flights.json into the airport/route data the app loads."""

import argparse
import json
import logging
import sys
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger("build_airports")

AIRPORT_FIELDS = ("code", "name", "city", "country", "lat", "lon")
ROUTE_FIELDS = ("a", "b", "ab", "ba")


@dataclass
class Summary:
    airports: int
    routes: int
    skipped: int


def build(source: dict[str, object]) -> tuple[dict[str, object], Summary]:
    airports = source["airports"]
    routes = source["routes"]
    if not isinstance(airports, dict) or not isinstance(routes, dict):
        raise ValueError("expected columnar 'airports' and 'routes' objects")
    missing = [f for f in AIRPORT_FIELDS if f not in airports] + [f for f in ROUTE_FIELDS if f not in routes]
    if missing:
        raise ValueError(f"missing columns: {', '.join(missing)}")

    count = len(airports["code"])
    rows: list[list[object]] = []
    seen: set[tuple[int, int]] = set()
    skipped = 0
    for a, b, ab, ba in zip(routes["a"], routes["b"], routes["ab"], routes["ba"]):
        if not (0 <= a < count and 0 <= b < count) or a == b:
            skipped += 1
            continue
        key = (min(a, b), max(a, b))
        if key in seen:
            skipped += 1
            continue
        seen.add(key)
        rows.append([a, b, int(ab or 0) + int(ba or 0)])

    out = {
        "built": source.get("built", ""),
        "routes_as_of": source.get("routes_as_of", ""),
        # [code, name, city, country, lon, lat]
        "airports": [
            [airports["code"][i], airports["name"][i], airports["city"][i], airports["country"][i],
             round(float(airports["lon"][i]), 4), round(float(airports["lat"][i]), 4)]
            for i in range(count)
        ],
        # [airport index, airport index, passengers per year (both directions)]
        "routes": rows,
    }
    return out, Summary(airports=count, routes=len(rows), skipped=skipped)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, nargs="?", default=Path("flights.json"))
    parser.add_argument("-o", "--output", type=Path, default=Path("src/data/airports.json"))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    try:
        source = json.loads(args.source.read_text(encoding="utf-8"))
        out, summary = build(source)
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        log.error("cannot build from %s: %s", args.source, exc)
        return 1

    if summary.skipped:
        log.warning("skipped %d invalid or duplicate routes", summary.skipped)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log.info("wrote %s: %d airports, %d routes", args.output, summary.airports, summary.routes)
    return 0


if __name__ == "__main__":
    sys.exit(main())
