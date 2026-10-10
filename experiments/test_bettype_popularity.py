import unittest
from bettype_popularity import parse_k, race_rows, summarize

K = '\n'.join([
    '24KBGN',
    ' 1R 3-6-2 91110',
    ' 1R  予選 H1800m',
    '        単勝     3          1020',
    '        ３連単   3-6-2    91110  人気   100',
    '        ３連複   2-3-6    12340  人気    18',
    '        ２連単   3-6       4560  人気    22',
    '        ２連複   3-6       2340  人気    11',
    '        拡連複   3-6        890  人気    10',
    '　２Ｒ  一般 H1800m',
    '        ３連単   1-2-3      780  人気     1',
    '        ３連複   1-2-3      240  人気     1',
    '        ２連単   1-2        330  人気     1',
    '        ２連複   1-2        220  人気     1',
    ' 3R  予選 H1800m',                        # dead heat in exacta only
    '        ３連単   1-3-2     1200  人気     4',
    '        ３連複   1-2-3      240  人気     1',
    '        ２連単   1-3        500  人気     2',
    '        ２連単   1-2        400  人気     1',
    '        ２連複   1-3        300  人気     2',
    ' 4R  予選 H1800m',                        # malformed 2連複 combination
    '        ３連単   2-1-3      900  人気     3',
    '        ３連複   1-2-3      240  人気     1',
    '        ２連単   2-1        420  人気     2',
    '        ２連複   1-1        300  人気     1',
])


class BetTypes(unittest.TestCase):
    def test_parse_all_types_and_ignore_others(self):
        p, seen = parse_k(K)
        self.assertEqual(seen, {(24, 1), (24, 2), (24, 3), (24, 4)})
        self.assertEqual(p[(24, 1)]['trio'], [('2-3-6', 12340, 18)])
        self.assertEqual(p[(24, 1)]['quinella'], [('3-6', 2340, 11)])
        self.assertEqual(set(p[(24, 1)]), {'trifecta', 'trio', 'exacta', 'quinella'})
        self.assertEqual(p[(24, 2)]['exacta'], [('1-2', 330, 1)])

    def test_exclusions_are_per_type(self):
        rows, excluded = race_rows('20250101', K)
        self.assertEqual(len(rows['trifecta']), 4); self.assertEqual(len(rows['trio']), 4)
        self.assertEqual(len(rows['exacta']), 3); self.assertEqual(excluded['exacta'], 1)
        self.assertEqual(len(rows['quinella']), 3); self.assertEqual(excluded['quinella'], 1)

    def test_summary(self):
        rows, _ = race_rows('20250101', K)
        s = summarize(rows['quinella'], 15)['overall']
        self.assertEqual(s['races'], 3)
        self.assertAlmostEqual(s['top_ranks'][0]['roi'], 220 / 300)
        self.assertEqual(s['bands'][-1]['ranks'], '11-15')
        self.assertAlmostEqual(s['bands'][-1]['roi'], 2340 / (3 * 5 * 100))
        self.assertIn('24', summarize(rows['trio'], 20)['by_venue'])


if __name__ == '__main__':
    unittest.main()
