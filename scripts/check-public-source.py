"""Verify public source exclusions and the original-source byte manifest."""
import hashlib
import json
import pathlib
import re

root = pathlib.Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'SOURCE_MANIFEST.json').read_text(encoding='utf-8'))
prohibited = re.compile(r'(^|/)(data|image|node_modules|artifacts|www|local|\.idea|\.claude|\.wrangler)(/|$)|(^|/)(\.env(?:\..*)?|keystore\.properties|local\.properties|secrets?\.json)$|\.(?:apk|aab|jks|keystore|pem|key|mp3|ogg|wav|webp|jpe?g)$', re.I)
checked = 0
for path in root.rglob('*'):
    if not path.is_file():
        continue
    rel = path.relative_to(root).as_posix()
    if any(part in {'.git', 'node_modules', '__pycache__'} for part in path.relative_to(root).parts):
        continue
    assert not prohibited.search(rel), 'Excluded resource or private file: ' + rel
for item in manifest['files']:
    path = root / item['path']
    assert path.is_file(), 'Missing source: ' + item['path']
    assert hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256'], 'Source changed: ' + item['path']
    checked += 1
print('Public source boundary and source hashes passed:', checked, 'files')
