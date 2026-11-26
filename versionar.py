from pathlib import Path
from datetime import datetime, timezone
import json,re,sys
v=datetime.now(timezone.utc).strftime('%Y.%m.%d-%H%M%S')
for file,pattern,replacement in [('sw.js',r"const CACHE_NAME='[^']+'",f"const CACHE_NAME='amt-eusebio-{v}'"),('updates.js',r"const AMT_VERSION='[^']+'",f"const AMT_VERSION='{v}'")]:
 p=Path(file);p.write_text(re.sub(pattern,replacement,p.read_text(),count=1))
Path('version.json').write_text(json.dumps({'version':v,'notes':' '.join(sys.argv[1:]) or 'Nova publicação'},ensure_ascii=False))
