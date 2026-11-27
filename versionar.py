from pathlib import Path
from datetime import datetime, timezone
import json,re,sys,hashlib,ast
v=datetime.now(timezone.utc).strftime('%Y.%m.%d-%H%M%S')
for file,pattern,replacement in [('sw.js',r"const CACHE_NAME='[^']+'",f"const CACHE_NAME='amt-eusebio-{v}'"),('updates.js',r"const AMT_VERSION='[^']+'",f"const AMT_VERSION='{v}'")]:
 p=Path(file);p.write_text(re.sub(pattern,replacement,p.read_text(),count=1))
shell=ast.literal_eval(re.search(r'const APP_SHELL=(\[.*?\]);',Path('sw.js').read_text()).group(1))
hashes={x:hashlib.sha256(Path(x).read_bytes()).hexdigest() for x in shell if x not in ('./','./version.json')}
Path('version.json').write_text(json.dumps({'version':v,'notes':' '.join(sys.argv[1:]) or 'Nova publicação','hashes':hashes},ensure_ascii=False))
