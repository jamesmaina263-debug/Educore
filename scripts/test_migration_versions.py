"""Tests for check_migration_versions.py and new_migration.py.

Run: python3 -m unittest scripts/test_migration_versions.py -v   (stdlib only, no DB, no secrets)
"""
import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
import check_migration_versions as chk  # noqa: E402
import new_migration as gen  # noqa: E402


def make_dir(*names):
    d = tempfile.mkdtemp()
    for n in names:
        open(os.path.join(d, n), "w").close()
    return d


class CheckTests(unittest.TestCase):
    def test_clean_directory_passes(self):
        d = make_dir("20261019140000_a.sql", "20261019150000_b.sql")
        self.assertEqual(chk.check(d), [])

    def test_duplicate_version_fails_and_names_both_files(self):
        # The real 2026-10-20 failure: admin_trial_funnel + school_signup_review.
        d = make_dir(
            "20261019140000_admin_trial_funnel.sql",
            "20261019140000_school_signup_review.sql",
        )
        problems = chk.check(d)
        self.assertEqual(len(problems), 1)
        self.assertIn("20261019140000", problems[0][1])
        self.assertIn("admin_trial_funnel", problems[0][1])
        self.assertIn("school_signup_review", problems[0][1])

    def test_three_way_duplicate_is_one_problem(self):
        d = make_dir("20261019140000_a.sql", "20261019140000_b.sql", "20261019140000_c.sql")
        self.assertEqual(len(chk.check(d)), 1)

    def test_bad_names_fail(self):
        for bad in (
            "2026101914000_short.sql",      # 13 digits
            "202610191400000_long.sql",     # 15 digits
            "20261019140000_Has_Caps.sql",
            "20261019140000_has-dash.sql",
            "20261019140000_.sql",
            "no_version.sql",
        ):
            with self.subTest(bad=bad):
                self.assertEqual(len(chk.check(make_dir(bad))), 1)

    def test_legacy_sequence_style_versions_are_accepted(self):
        # 20260918114860..69 are real, already-applied migrations that use seconds 60-69 as a
        # counter. Rejecting them would fail main for no benefit.
        d = make_dir("20260918114860_a.sql", "20260918114861_b.sql")
        self.assertEqual(chk.check(d), [])

    def test_non_sql_files_are_ignored(self):
        self.assertEqual(chk.check(make_dir("README.md", "20261019140000_a.sql")), [])

    def test_main_exit_codes(self):
        self.assertEqual(chk.main(["x", make_dir("20261019140000_a.sql")]), 0)
        self.assertEqual(
            chk.main(["x", make_dir("20261019140000_a.sql", "20261019140000_b.sql")]), 1
        )
        self.assertEqual(chk.main(["x", "/definitely/not/a/dir"]), 2)

    def test_real_repo_migrations_are_clean(self):
        repo_dir = os.path.join(os.path.dirname(__file__), "..", chk.DEFAULT_DIR)
        if os.path.isdir(repo_dir):
            self.assertEqual(chk.check(repo_dir), [])


class GeneratorTests(unittest.TestCase):
    NOW = datetime(2026, 10, 20, 8, 30, 15, 999999, tzinfo=timezone.utc)

    def test_uses_utc_time_to_the_second(self):
        d = make_dir()
        path = gen.create("add_widgets", d, now=self.NOW)
        self.assertEqual(os.path.basename(path), "20261020083015_add_widgets.sql")

    def test_bumps_past_taken_versions(self):
        d = make_dir("20261020083015_x.sql", "20261020083016_y.sql")
        path = gen.create("add_widgets", d, now=self.NOW)
        self.assertEqual(os.path.basename(path), "20261020083017_add_widgets.sql")

    def test_generated_file_passes_the_checker_even_after_many_creates(self):
        d = make_dir()
        for i in range(5):
            gen.create(f"thing_{i}", d, now=self.NOW)
        self.assertEqual(chk.check(d), [])
        self.assertEqual(len(os.listdir(d)), 5)

    def test_normalises_description(self):
        d = make_dir()
        path = gen.create("Add Widget-Table", d, now=self.NOW)
        self.assertTrue(path.endswith("_add_widget_table.sql"))

    def test_rejects_bad_description(self):
        d = make_dir()
        for bad in ("", "has/slash", "naïve", "../escape"):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    gen.create(bad, d, now=self.NOW)
        self.assertEqual(os.listdir(d), [])

    def test_missing_directory_errors(self):
        with self.assertRaises(FileNotFoundError):
            gen.create("x", "/definitely/not/a/dir", now=self.NOW)


if __name__ == "__main__":
    unittest.main()
