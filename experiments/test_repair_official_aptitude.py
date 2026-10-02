import unittest,tempfile,gzip,csv
from pathlib import Path
from repair_official_aptitude import official_rows,timing,accumulate,verify_csv

HEADER='08KBGN\n 1R TEST H1800m 晴 風 西 2m 波 1cm\n'
class RepairTest(unittest.TestCase):
    def test_late_blank_and_numeric(self):
        rows,excluded,n=official_rows(HEADER+' L1 6 3315 NAME 36 71 6.79 6 L .        .  . \n L0 1 5038 NAME 34 39 6.96 1 L1.99      .  . \n')
        self.assertEqual(n,2);self.assertEqual(excluded,[])
        self.assertIsNone(rows[(8,1,6)]['st']);self.assertEqual(rows[(8,1,6)]['raw_st'],'L .')
        self.assertEqual(rows[(8,1,1)]['official_numeric_st'],1.99);self.assertIsNone(rows[(8,1,1)]['st'])
    def test_zero_rank_and_flying(self):
        rows,_,_=official_rows(HEADER+' 00 1 5038 NAME 34 39 6.96 1 0.12      .  . \n F 6 3315 NAME 36 71 6.79 6 F0.02      .  . \n')
        self.assertIsNone(rows[(8,1,1)]['finish']);self.assertEqual(rows[(8,1,6)]['st'],-.02)
    def test_withdrawal_and_unknown(self):
        rows,excluded,n=official_rows(HEADER+' K0 1 4703 NAME 72 26 K .         K .        .  . \n')
        self.assertEqual(len(rows),0);self.assertEqual(len(excluded),1);self.assertEqual(n,1)
        with self.assertRaises(ValueError):official_rows(HEADER+' S1 1 5038 UNKNOWN\n')
    def test_duplicate(self):
        row=' 01 1 5038 NAME 34 39 6.96 1 0.12      .  . \n'
        with self.assertRaises(ValueError):official_rows(HEADER+row+row)
    def test_aggregation_masks_late(self):
        data={'racers':{},'global_course':{}}
        row={'racer_id':5038,'venue':'常滑','course':1,'finish':None,**timing('L1.99','L0')}
        accumulate(data,row)
        self.assertEqual(data['racers']['5038']['o'],[1,0,0,0,0,0,0,0,0])
        row.update(finish=1,**timing('0.12','01'));accumulate(data,row)
        self.assertEqual(data['racers']['5038']['o'][0:7],[2,1,1,1,1,1,1])
    def test_serialized_duplicates(self):
        row={'date':'20250730','stadium':8,'race':1,'lane':1,'racer_id':5038,'course':1,'st':'','st_quality':'late_start_excluded'}
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'x.gz'
            with gzip.open(p,'wt',newline='') as f:
                w=csv.DictWriter(f,fieldnames=list(row));w.writeheader();w.writerow(row);w.writerow(row)
            with self.assertRaises(ValueError):verify_csv(p,2,2)

if __name__=='__main__':unittest.main()
