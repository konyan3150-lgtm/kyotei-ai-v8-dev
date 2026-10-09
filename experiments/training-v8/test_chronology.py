import unittest
import pandas as pd
from chronology import prepare_splits
class ChronologyTests(unittest.TestCase):
    def frame(self):return pd.DataFrame({'RACEDATE':['2024-01-01','2024-02-01','2024-02-02','2024-03-01'],'PLACE':['桐生']*4,'RACE':[1]*4,'split':['train','validate','validate','test']})
    def test_disjoint_dates(self):self.assertEqual(prepare_splits(self.frame()).split.tolist(),['train','calibration','selection','test'])
    def test_reversal(self):
        d=self.frame();d.loc[0,'RACEDATE']='2024-04-01'
        with self.assertRaises(ValueError):prepare_splits(d)
    def test_duplicate(self):
        with self.assertRaises(ValueError):prepare_splits(pd.concat([self.frame(),self.frame().iloc[[0]]]))
if __name__=='__main__':unittest.main()
