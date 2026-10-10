import unittest
from trifecta_popularity import parse_k, race_rows, summarize

K = '\n'.join([
    '24KBGN',
    ' 1R 3-6-2 91110',                       # top summary block must be ignored
    ' 1R  予選 H1800m',
    '        ３連単   3-6-2    91110  人気   100',
    ' 2R  予選 H1800m',
    '        ３連単   1-2-3      780  人気     1',
    '　３Ｒ  一般 H1800m',                    # full-width race number
    '        ３連単   1-3-2     1200  人気     4',
    ' 4R  予選 H1800m',                       # refund / special payout: no valid trifecta line
    '        ３連単   特払い      70',
    ' 5R  予選 H1800m',                       # dead heat: two combinations
    '        ３連単   1-2-3      500  人気     1',
    '        ３連単   1-2-4      900  人気     3',
    '25KBGN',
    ' 1R  予選 H1800m',
    '        ３連単   2-2-3      780  人気     1',  # malformed combination
])


class Popularity(unittest.TestCase):
    def test_parse(self):
        p, seen = parse_k(K)
        self.assertEqual(p[(24, 1)], [('3-6-2', 91110, 100)])
        self.assertEqual(p[(24, 3)], [('1-3-2', 1200, 4)])
        self.assertEqual(seen, {(24, 1), (24, 2), (24, 3), (24, 4), (24, 5), (25, 1)})

    def test_rows_exclude_refund_deadheat_and_malformed(self):
        rows, excluded = race_rows('20250101', K)
        self.assertEqual([(r['stadium'], r['race'], r['popularity']) for r in rows], [(24, 1, 100), (24, 2, 1), (24, 3, 4)])
        self.assertEqual(excluded, 3)

    def test_summary_roi(self):
        rows, _ = race_rows('20250101', K)
        s = summarize(rows)['overall']
        self.assertEqual(s['races'], 3)
        rank1 = s['top_ranks'][0]; self.assertEqual(rank1['hits'], 1); self.assertAlmostEqual(rank1['roi'], 780 / 300)
        band = next(b for b in s['bands'] if b['ranks'] == '4-6')
        self.assertAlmostEqual(band['roi'], 1200 / (3 * 3 * 100)); self.assertAlmostEqual(band['hit_rate_per_race'], 1 / 3)
        self.assertAlmostEqual(s['lane1_head_share'], 2 / 3)


if __name__ == '__main__':
    unittest.main()
