#!/usr/bin/env python3
"""Compact a Flight Atlas flights.json into the airport, destination and puzzle data the app loads."""

import argparse
import json
import logging
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger("build_airports")

AIRPORT_FIELDS = ("code", "name", "city", "country", "lat", "lon")
ROUTE_FIELDS = ("a", "b", "ab", "ba")


@dataclass
class Summary:
    airports: int
    flights: int
    playable: int
    ambiguous: int
    skipped: int


Destinations = list[dict[int, int]]


def directed_destinations(airports: dict[str, list], routes: dict[str, list]) -> tuple[Destinations, Destinations, int]:
    """Per airport, its foreign and its domestic direct-flight destinations mapped to passengers per year.

    A route a-b is a flight a->b only when its "ab" traffic is positive (b->a: "ba"). Also returns how many
    routes were skipped as invalid or duplicate.
    """
    count = len(airports["code"])
    countries = airports["country"]
    foreign: Destinations = [{} for _ in range(count)]
    domestic: Destinations = [{} for _ in range(count)]
    skipped = 0
    for a, b, ab, ba in zip(routes["a"], routes["b"], routes["ab"], routes["ba"]):
        if not (0 <= a < count and 0 <= b < count) or a == b:
            skipped += 1
            continue
        destinations = domestic if countries[a] == countries[b] else foreign
        for origin, dest, passengers in ((a, b, ab), (b, a, ba)):
            passengers = int(passengers or 0)
            if passengers > 0:
                if dest in destinations[origin]:
                    skipped += 1
                destinations[origin][dest] = max(passengers, destinations[origin].get(dest, 0))
    return foreign, domestic, skipped


def by_traffic(dests: dict[int, int]) -> list[list[int]]:
    """[[destination index, passengers per year], ...], busiest first."""
    return [[d, p] for d, p in sorted(dests.items(), key=lambda item: -item[1])]


def playable_airports(destinations: list[dict[int, int]]) -> tuple[list[int], int]:
    """Airports with destinations whose destination set no other airport shares.

    Also returns how many airports with destinations were left out as ambiguous.
    """
    owners = Counter(frozenset(d) for d in destinations)
    playable: list[int] = []
    ambiguous = 0
    for i, dests in enumerate(destinations):
        if not dests:
            continue
        if owners[frozenset(dests)] > 1:
            ambiguous += 1
        else:
            playable.append(i)
    return playable, ambiguous


def build(source: dict[str, object]) -> tuple[dict[str, object], Summary]:
    airports = source["airports"]
    routes = source["routes"]
    if not isinstance(airports, dict) or not isinstance(routes, dict):
        raise ValueError("expected columnar 'airports' and 'routes' objects")
    missing = [f for f in AIRPORT_FIELDS if f not in airports] + [f for f in ROUTE_FIELDS if f not in routes]
    if missing:
        raise ValueError(f"missing columns: {', '.join(missing)}")

    count = len(airports["code"])
    destinations, domestic, skipped = directed_destinations(airports, routes)
    playable, ambiguous = playable_airports(destinations)
    answers = set(playable)

    out = {
        "built": source.get("built", ""),
        "routes_as_of": source.get("routes_as_of", ""),
        # [code, name, city, country, lon, lat]
        "airports": [
            [airports["code"][i], airports["name"][i], airports["city"][i], airports["country"][i],
             round(float(airports["lon"][i]), 4), round(float(airports["lat"][i]), 4)]
            for i in range(count)
        ],
        # per airport: [[destination index, passengers per year flown there], ...], busiest first
        "destinations": [by_traffic(dests) for dests in destinations],
        # per airport, the same for domestic flights, kept only between possible answers: the hint shows an
        # answer's domestic flights to airports that could themselves be the answer
        "domestic": [
            by_traffic({d: p for d, p in dests.items() if d in answers}) if i in answers else []
            for i, dests in enumerate(domestic)
        ],
        # indices of airports whose destinations identify them unambiguously
        "unique": playable,
    }
    summary = Summary(
        airports=count,
        flights=sum(len(d) for d in destinations),
        playable=len(playable),
        ambiguous=ambiguous,
        skipped=skipped,
    )
    return out, summary


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
    if not summary.playable:
        log.error("no playable airports")
        return 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log.info(
        "wrote %s: %d airports, %d flights, %d playable (%d left out as ambiguous)",
        args.output, summary.airports, summary.flights, summary.playable, summary.ambiguous,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
