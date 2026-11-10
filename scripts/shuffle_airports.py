#!/usr/bin/env python3
"""Write the daily airport list: the shuffled playable airports, up to today only.

Deploys run this daily after the build. Line N of the output is day N's
airport code, day 0 being FIRST_DAY. The list stops at today (UTC), so
tomorrow's airport is never published; the game never asks for a day past the
UTC date (see dayIndex in src/data/daily.ts).

The playable airports are those src/data/airports.ts would pick from: the
dataset's "unique" airports with at least MIN_DESTINATIONS foreign
destinations. The shuffle depends only on the seed and that set of codes, so
rebuilding the dataset with a different set reorders every day. It uses
HMAC-SHA256 in counter mode as its random stream and an exact rejection
sampler, never Python's `random` module, so it gives the same order on any
Python version.
"""

import argparse
import datetime as dt
import hashlib
import hmac
import json
import logging
import os
import sys
from pathlib import Path

SEED_ENV = "SOLUTIONS_SHUFFLE_SEED"
# Must match FIRST_DAY_UTC in src/data/daily.ts.
FIRST_DAY = dt.date(2026, 11, 10)
# Must match MIN_DESTINATIONS in src/data/airports.ts.
MIN_DESTINATIONS = 4

log = logging.getLogger("shuffle_airports")


class ByteStream:
    """Deterministic 64-bit integers: HMAC-SHA256(seed, counter) blocks."""

    def __init__(self, seed: bytes):
        self._seed = seed
        self._counter = 0
        self._buffer = b""

    def next_u64(self) -> int:
        if len(self._buffer) < 8:
            block = hmac.new(
                self._seed, self._counter.to_bytes(8, "big"), hashlib.sha256
            ).digest()
            self._counter += 1
            self._buffer += block
        value, self._buffer = self._buffer[:8], self._buffer[8:]
        return int.from_bytes(value, "big")

    def below(self, n: int) -> int:
        """Uniform integer in [0, n), without modulo bias."""
        if n <= 0:
            raise ValueError(f"n must be positive, got {n}")
        limit = (1 << 64) - ((1 << 64) % n)
        while True:
            value = self.next_u64()
            if value < limit:
                return value % n


def playable_codes(data: dict):
    """Codes of the airports the game can ask for, as in src/data/airports.ts."""
    airports = data["airports"]
    destinations = data["destinations"]
    return [
        airports[i][0]
        for i in data["unique"]
        if len(destinations[i]) >= MIN_DESTINATIONS
    ]


def normalize(codes):
    """Uppercased, trimmed, deduplicated and sorted codes."""
    return sorted({code.strip().upper() for code in codes if code.strip()})


def shuffle(codes, seed: str):
    """Fisher-Yates shuffle of the normalized codes, driven by the seed."""
    if not seed:
        raise ValueError("the seed is empty")
    order = normalize(codes)
    stream = ByteStream(seed.encode("utf-8"))
    for i in range(len(order) - 1, 0, -1):
        j = stream.below(i + 1)
        order[i], order[j] = order[j], order[i]
    return order


def daily_codes(codes, seed: str, today: dt.date):
    """Codes for day 0 through today; the shuffle wraps if it runs out."""
    order = shuffle(codes, seed)
    if not order:
        return []
    last_day = max(0, (today - FIRST_DAY).days)
    return [order[day % len(order)] for day in range(last_day + 1)]


def parse_date(text: str) -> dt.date:
    try:
        return dt.date.fromisoformat(text)
    except ValueError as err:
        raise argparse.ArgumentTypeError(f"not a YYYY-MM-DD date: {text!r}") from err


def parse_args(argv):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("input", type=Path, help="airports.json dataset")
    parser.add_argument("output", type=Path, help="daily list to write")
    parser.add_argument(
        "--today",
        type=parse_date,
        help="last UTC date to publish (default: today)",
    )
    return parser.parse_args(argv)


def main(argv=None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    args = parse_args(argv)
    # Read from the environment so the secret never shows in argv or logs.
    seed = os.environ.get(SEED_ENV, "")
    if not seed:
        log.error("%s is not set or empty", SEED_ENV)
        return 1
    try:
        codes = playable_codes(json.loads(args.input.read_text(encoding="utf-8")))
    except OSError as err:
        log.error("cannot read %s: %s", args.input, err)
        return 1
    except (ValueError, KeyError, IndexError, TypeError) as err:
        log.error("%s is not a valid airport dataset: %s", args.input, err)
        return 1
    today = args.today or dt.datetime.now(dt.timezone.utc).date()
    daily = daily_codes(codes, seed, today)
    if not daily:
        log.error("%s has no playable airports", args.input)
        return 1
    try:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text("\n".join(daily) + "\n", encoding="utf-8")
    except OSError as err:
        log.error("cannot write %s: %s", args.output, err)
        return 1
    # Only counts: the airports themselves are the secret.
    log.info(
        "wrote days 0-%d of %d airports (as of %s UTC) to %s",
        len(daily) - 1, len(set(codes)), today, args.output,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
