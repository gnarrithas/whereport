#!/usr/bin/env python3
"""Pins the shuffle: a change here would reorder every deployed daily airport."""

import datetime as dt
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import shuffle_airports as s

CODES = ["DDD", "AAA", "ccc", "BBB", "EEE", "FFF", "GGG", "HHH"]


def dataset():
    """CODES all playable, plus one unique airport with too few destinations
    and one with enough destinations that is not unique."""
    airports = [[c, c, c, "XX", 0, 0] for c in CODES + ["FEW", "AMB"]]
    many = [[0, 1]] * s.MIN_DESTINATIONS
    destinations = [many] * len(CODES) + [many[:-1], many]
    return {
        "airports": airports,
        "destinations": destinations,
        "unique": list(range(len(CODES) + 1)),
    }


class ShuffleTest(unittest.TestCase):
    def test_stream_is_hmac_sha256_counter_mode(self):
        stream = s.ByteStream(b"test-seed")
        self.assertEqual(
            [stream.next_u64() for _ in range(3)],
            [11957243613851627194, 3755087740879313799, 18115887728204555026],
        )

    def test_golden_order(self):
        self.assertEqual(
            s.shuffle(CODES, "test-seed"),
            ["AAA", "FFF", "DDD", "BBB", "GGG", "EEE", "HHH", "CCC"],
        )

    def test_input_order_case_and_duplicates_do_not_matter(self):
        messy = list(reversed(CODES)) + ["  aaa ", "", "EEE"]
        self.assertEqual(s.shuffle(messy, "test-seed"), s.shuffle(CODES, "test-seed"))

    def test_seed_changes_the_order(self):
        self.assertNotEqual(s.shuffle(CODES, "test-seed"), s.shuffle(CODES, "other"))

    def test_below_rejects_non_positive_and_stays_in_range(self):
        stream = s.ByteStream(b"x")
        with self.assertRaises(ValueError):
            stream.below(0)
        self.assertTrue(all(0 <= stream.below(7) < 7 for _ in range(1000)))

    def test_empty_seed_is_refused(self):
        with self.assertRaises(ValueError):
            s.shuffle(CODES, "")

    def test_playable_codes_match_the_game_filter(self):
        self.assertEqual(s.playable_codes(dataset()), CODES)

    def test_daily_codes_stop_at_today(self):
        order = s.shuffle(CODES, "test-seed")
        first = s.FIRST_DAY
        self.assertEqual(s.daily_codes(CODES, "test-seed", first), order[:1])
        later = first + dt.timedelta(days=3)
        self.assertEqual(s.daily_codes(CODES, "test-seed", later), order[:4])
        early = first - dt.timedelta(days=30)
        self.assertEqual(s.daily_codes(CODES, "test-seed", early), order[:1])

    def test_daily_codes_wrap_past_the_end(self):
        order = s.shuffle(CODES, "test-seed")
        day_9 = s.FIRST_DAY + dt.timedelta(days=9)
        self.assertEqual(s.daily_codes(CODES, "test-seed", day_9), order + order[:2])

    def test_main_writes_the_daily_list_and_requires_the_seed(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "airports.json"
            output = Path(tmp) / "out" / "daily.txt"
            source.write_text(json.dumps(dataset()))
            today = (s.FIRST_DAY + dt.timedelta(days=1)).isoformat()
            args = [str(source), str(output), "--today", today]
            with mock.patch.dict(os.environ, {s.SEED_ENV: ""}):
                self.assertEqual(s.main(args), 1)
            self.assertFalse(output.exists())
            with mock.patch.dict(os.environ, {s.SEED_ENV: "test-seed"}):
                self.assertEqual(s.main(args), 0)
            expected = s.shuffle(CODES, "test-seed")[:2]
            self.assertEqual(output.read_text(), "\n".join(expected) + "\n")

    def test_main_rejects_a_bad_dataset(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "airports.json"
            source.write_text("{}")
            with mock.patch.dict(os.environ, {s.SEED_ENV: "test-seed"}):
                self.assertEqual(s.main([str(source), str(Path(tmp) / "o.txt")]), 1)


if __name__ == "__main__":
    unittest.main()
