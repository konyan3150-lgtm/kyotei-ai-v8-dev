import unittest
import json,os,sys,tempfile
from pathlib import Path
from unittest.mock import patch
from audit_official_aptitude import compare_day, parse_official, main

B='08BBGN\n 1R TEST\n1 5038 NAME23愛知52A1 \n'
K='08KBGN\n 1R TEST H1800m 晴 風 西 2m 波 1cm\n 01 1 5038 NAME 34 39 6.96 1 0.12 1.51.7\n'
def payload():
    return {'results':[{'date':'2025-07-30','stadium_number':8,'number':1,'boats':[{'racer_boat_number':1,'racer_number':5038,'racer_course_number':1,'racer_place_number':1,'racer_start_timing':.12}]}]}

class AuditTest(unittest.TestCase):
    def test_match(self):
        r=compare_day('20250730',payload(),B,K)
        self.assertEqual(r['errors'],[]);self.assertEqual(r['counts']['compared_starts'],1)
    def test_mismatches(self):
        p=payload();b=p['results'][0]['boats'][0];b.update(racer_number=4540,racer_place_number=2,racer_start_timing=.15)
        r=compare_day('20250730',p,B,K)
        self.assertEqual({e['kind'] for e in r['errors']},{'program_id_mismatch','id_mismatch','finish_mismatch','st_mismatch'})
    def test_missing_api(self):
        p=payload();p['results'][0]['boats']=[]
        self.assertEqual(compare_day('20250730',p,B,K)['counts']['missing_api_start'],1)
    def test_nonstandard(self):
        p=payload();p['results'][0]['boats'][0].update(racer_place_number=14,racer_start_timing=-.02)
        k=K.replace('01 1',' F 1').replace('0.12','F0.02')
        r=compare_day('20250730',p,B,k);self.assertEqual(r['errors'],[]);self.assertEqual(r['nonstandard_code_pairs'],{'F|14':1})
    def test_duplicate_and_wrong_day(self):
        p=payload();p['results'][0]['boats']*=2
        with self.assertRaises(ValueError):compare_day('20250730',p,B,K)
        with self.assertRaises(ValueError):compare_day('20250731',payload(),B,K)
        with self.assertRaises(ValueError):parse_official(K+K.splitlines()[-1]+'\n','K')
    def test_null_st(self):
        p=payload();p['results'][0]['boats'][0]['racer_start_timing']=None
        r=compare_day('20250730',p,B,K.replace('0.12','..'));self.assertEqual(r['errors'],[])
    def test_zero_start_day(self):
        r=compare_day('20250730',{'results':[]},'','')
        self.assertEqual(r['counts']['api_starts'],0);self.assertEqual(r['counts']['compared_starts'],0);self.assertEqual(r['errors'],[])
    def test_zero_start_day_full_summary(self):
        r=compare_day('20250730',{'results':[]},'','')
        old=os.getcwd()
        with tempfile.TemporaryDirectory() as tmp:
            try:
                os.chdir(tmp);Path('dev').mkdir()
                Path('dev/racer-aptitude-clean.json').write_text(json.dumps({'recovery':{'days':[{'date':'20250730','starts':0}]}}))
                with patch('audit_official_aptitude.audit_day',return_value=r),patch.object(sys,'argv',['audit','--start','20250730','--end','20250730']):main()
                out=json.loads(Path('dev/aptitude-official-audit.json').read_text())
                self.assertEqual(out['status'],'passed');self.assertEqual(out['ledger_start_count_mismatch_days'],[])
                self.assertEqual(json.loads(Path('dev/aptitude-official-audit-progress.json').read_text())['status'],'completed')
            finally:os.chdir(old)

if __name__=='__main__':unittest.main()
