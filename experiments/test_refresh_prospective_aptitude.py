import unittest,copy
from refresh_prospective_aptitude import append_day,next_day
class Chronology(unittest.TestCase):
 def test_append_identity_and_special_start(self):
  d={'through':'2026-10-01','starts':0,'racers_count':0,'racers':{},'global_course':{}}
  b='24BBGN\n 1R 予選\n1 4142平野和明44愛知53B1 5.58 30.14\n'
  k='24KBGN\n 1R 予選 H1800m\n  L0  1 4142 平　野　　和　明 71   64  6.96   1    L1.99     .  .\n'
  e,rows,_=append_day(d,'20261002',b,k)
  self.assertEqual(e['starts'],1);self.assertEqual(d['starts'],1);self.assertEqual(d['racers']['4142']['o'][6],0);self.assertEqual(rows[(24,1,1)]['official_numeric_st'],1.99)
  with self.assertRaises(ValueError):append_day(d,'20261002',b,k)
 def test_wrong_id_does_not_mutate(self):
  d={'through':'2026-10-01','starts':0,'racers_count':0,'racers':{},'global_course':{}};before=copy.deepcopy(d)
  with self.assertRaises(ValueError):append_day(d,'20261002','24BBGN\n 1R 予選\n1 4143平野和明44愛知53B1 5.58 30.14\n','24KBGN\n 1R 予選 H1800m\n  01  1 4142 平　野　　和　明 71   64  6.96   1    0.15     1.51.1\n')
  self.assertEqual(d,before)
 def test_year_boundary(self):self.assertEqual(next_day('2026-12-31'),'20270101')
if __name__=='__main__':unittest.main()
