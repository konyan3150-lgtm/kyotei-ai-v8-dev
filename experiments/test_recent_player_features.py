import datetime as dt
import unittest
from recent_player_features import RecentHistory


def row(date, race=1, finish=1, st=.12, status='01', quality='observed'):
    return {'date': date, 'racer_id': 3871, 'stadium': 24, 'course': 1, 'race': race, 'lane': 1,
            'finish': finish, 'st': st, 'finish_status': status, 'st_quality': quality}


class RecentTests(unittest.TestCase):
    def features(self, rows, dates):
        return RecentHistory(rows, dates).features(query_date='20261008', racer_id=3871, stadium=24, planned_course=1)

    def test_same_day_and_future_results_do_not_affect_features(self):
        a = self.features([row('20261007')], ['20261007'])
        b = self.features([row('20261007'), row('20261008', finish=6), row('20261009', finish=5)], ['20261007', '20261008', '20261009'])
        self.assertEqual(a, b)

    def test_exact_30_and_90_day_boundaries(self):
        q = dt.date(2026, 10, 8)
        ds = [(q - dt.timedelta(days=i)).strftime('%Y%m%d') for i in (1, 30, 31, 90, 91)]
        f = self.features([row(d) for d in ds], ds)
        self.assertEqual(f['windows']['30']['groups']['overall']['starts'], 2)
        self.assertEqual(f['windows']['90']['groups']['overall']['starts'], 4)
        self.assertFalse(f['windows']['90']['source_complete'])

    def test_DQ_F_and_late_are_not_silently_normal_ST(self):
        ds = ['20261005', '20261006', '20261007']
        f = self.features([row(ds[0]), row(ds[1], finish=None, st=-.02, status='F0'), row(ds[2], finish=None, st=None, status='L0', quality='late_start_excluded')], ds)
        g = f['windows']['30']['groups']['overall']
        self.assertEqual(g['win_rate'], 1 / 3)
        self.assertEqual(g['ordinary_st_count'], 1)
        self.assertEqual(g['main_race_F_count'], 1)
        self.assertEqual(g['late_start_count'], 1)

    def test_duplicate_start_rejected_and_missing_player_has_null_rates(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            RecentHistory([row('20261007'), row('20261007')], ['20261007'])
        f = RecentHistory([], []).features(query_date='20261008', racer_id=9999, stadium=24, planned_course=1)
        self.assertIsNone(f['windows']['30']['groups']['overall']['win_rate'])
        self.assertTrue(f['windows']['30']['groups']['overall']['small_sample'])


if __name__ == '__main__':
    unittest.main()
