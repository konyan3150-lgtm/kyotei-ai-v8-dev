import unittest
from prepare_official_comparison import programs,payouts
class Parser(unittest.TestCase):
    def test_program_pre_race_fields(self):
        p=programs('24BBGN\n　１Ｒ  予選\n1 4142平野和明44愛知53B1 5.58 30.14 6.50 40.00 71 12.50 64 51.85 5            7\n')
        x=p[(24,1)]['racers']['1']
        self.assertEqual(x['number'],4142);self.assertEqual(x['age'],44);self.assertEqual(x['national_win_rate'],5.58);self.assertEqual(x['motor_top_2_percent'],12.5)
        self.assertNotIn('average_start_timing',x);self.assertNotIn('preview',p[(24,1)])
    def test_adjacent_hundred_percent(self):
        p=programs('24BBGN\n　１Ｒ  予選\n1 4142平野和明44愛知53B1 8.90100.00 6.50 40.00 71 12.50 64 51.85\n')
        self.assertEqual(p[(24,1)]['racers']['1']['national_top_2_percent'],100)
    def test_only_detailed_payout(self):
        text='24KBGN\n 1R 3-6-2 91110\n 1R  予選 H1800m\n        ３連単   3-6-2    91110  人気   100\n'
        self.assertEqual(payouts(text),{(24,1):[{'combination':'3-6-2','amount':91110}]})
    def test_duplicate_rejected(self):
        row='1 4142平野和明44愛知53B1 5.58 30.14 6.50 40.00 71 12.50 64 51.85\n'
        with self.assertRaises(ValueError):programs('24BBGN\n 1R 予選\n'+row+row)
if __name__=='__main__':unittest.main()
