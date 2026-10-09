"""Build a small review site; all dataset requests stay read-only on GitHub."""
import argparse, json, re, shutil
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('source', type=Path)
p.add_argument('output', type=Path)
p.add_argument('--revision', required=True)
args = p.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
for source in args.source.iterdir():
    if source.is_file() and source.suffix in {'.html', '.css', '.js', '.mjs'}:
        shutil.copyfile(source, args.output / source.name)
bootstrap = """(function(){
  const originalFetch=window.fetch.bind(window);
  const live='https://raw.githubusercontent.com/konyan3150-lgtm/kyotei-ai-v8-live/main/';
  const pinned='https://raw.githubusercontent.com/konyan3150-lgtm/kyotei-ai-v8-live/6c7f1841cb8fc9611a6c6f2dabe2d0135b0a671b/';
  const dynamic=new Set(['tomorrow.json','racer-aptitude.json','racer-aptitude.json.gz','odds.json','course-stats.json','venue-stats.json','technique-stats.json']);
  window.fetch=function(input,options){
    if(typeof input==='string'){
      const url=new URL(input,location.href);
      if(url.origin===location.origin){
        const name=url.pathname.split('/').pop();
        if(name==='v8_model_aptitude.json')input=pinned+name+url.search;
        else if(dynamic.has(name))input=live+name+url.search;
        else if(url.pathname.endsWith('/dev/tide.json'))input=live+'dev/tide.json'+url.search;
      }
    }
    return originalFetch(input,options);
  };
})();
"""
(args.output / 'review-bootstrap.js').write_text(bootstrap)
for page in args.output.glob('*.html'):
    text = page.read_text()
    text = text.replace('<head>', '<head><script src="review-bootstrap.js"></script>', 1)
    banner = '<div style="padding:10px;background:#173451;color:white;text-align:center;font-size:13px">検証用開発版・本番未反映｜' + args.revision[:7] + '</div>'
    text = re.sub(r'(<body[^>]*>)', r'\1' + banner, text, count=1)
    page.write_text(text)
files = [{'path': f.name, 'content': f.read_text()} for f in sorted(args.output.iterdir()) if f.is_file()]
(args.output / 'review-manifest.json').write_text(json.dumps({'revision':args.revision,'files':[f['path'] for f in files],'data':'read-only GitHub feeds; model pinned'}, indent=2))
print(json.dumps(files, ensure_ascii=False))
