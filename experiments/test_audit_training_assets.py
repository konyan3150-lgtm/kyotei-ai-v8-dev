import unittest
from audit_training_assets import audit_rows, features_from_source


def row(date, split, result='1>2>3'):
    return {'RACEDATE': date, 'PLACE': '三国', 'RACE': '1', 'split': split,
            'RENTAN3': result, 'RENTAN3K': '680'}


class AuditTests(unittest.TestCase):
    def test_unsorted_rows_are_not_temporal_leakage(self):
        rs = [row('2025-03-01', 'test'), row('2024-12-01', 'train'), row('2025-01-01', 'validate'), row('2025-02-01', 'validate')]
        a = audit_rows(rs, list(rs[0]))
        self.assertTrue(a['chronological_separation'])
        self.assertEqual(a['errors'], {})
        self.assertEqual(a['proposed_validation_partition']['calibration']['last_date'], '2025-01-01')
        self.assertEqual(a['proposed_validation_partition']['rule_selection']['first_date'], '2025-02-01')

    def test_duplicate_cross_split_and_repeated_lane_rejected(self):
        rs = [row('2025-01-01', 'train'), row('2025-01-01', 'validate', '1>1>2'), row('2025-02-01', 'test')]
        a = audit_rows(rs, list(rs[0]))
        self.assertEqual(a['errors']['duplicate_race_key'], 1)
        self.assertEqual(a['errors']['invalid_trifecta'], 1)
        self.assertFalse(a['chronological_separation'])

    def test_bad_date_unknown_split_and_nonfinite_payout(self):
        rs = [row('2025-02-30', 'other')]
        rs[0]['RENTAN3K'] = 'nan'
        a = audit_rows(rs, list(rs[0]))
        self.assertEqual(a['errors']['invalid_date'], 1)
        self.assertEqual(a['errors']['invalid_payout'], 1)
        self.assertEqual(a['errors']['unknown_split'], 1)

    def test_source_is_parsed_without_execution(self):
        source = "raise RuntimeError('must not execute')\nFEATURE_BASES=['AGE']\nMETA_FEATURES=['LANE']"
        self.assertEqual(features_from_source(source), ['LANE', 'AGE'])


if __name__ == '__main__':
    unittest.main()
