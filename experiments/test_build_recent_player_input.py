import unittest
from build_recent_player_input import build_store
from recent_player_features import RecentHistory


class BuildTests(unittest.TestCase):
    def test_store_matches_direct_queries_and_rejects_future(self):
        rows = [{'date': '20261007', 'racer_id': 4001, 'stadium': 24, 'course': 2,
                 'race': 1, 'lane': 1, 'finish': 1, 'st': .12, 'st_quality': 'observed'}]
        history = RecentHistory(rows, ['20261007'])
        store = build_store(history, '20261008', {'aptitude_sha256': 'a'})
        direct = history.features(query_date='20261008', racer_id=4001, stadium=24, planned_course=2)
        for d in ('30', '90'):
            self.assertEqual(store['players']['4001'][d]['c_2'], direct['windows'][d]['groups']['course'])
            self.assertEqual(store['players']['4001'][d]['x_24_2'], direct['windows'][d]['groups']['venue_course'])
            self.assertFalse(store['coverage'][d]['source_complete'])
        with self.assertRaisesRegex(ValueError, 'future'):
            build_store(history, '20261007', {})


if __name__ == '__main__':
    unittest.main()
