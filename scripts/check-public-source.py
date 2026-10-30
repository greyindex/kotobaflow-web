"""Verify public source exclusions and the original-source byte manifest."""
import hashlib
import json
import pathlib
import re

root = pathlib.Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'SOURCE_MANIFEST.json').read_text(encoding='utf-8'))
prohibited = re.compile(r'(^|/)(data|image|node_modules|artifacts|www|local|\.idea|\.claude|\.wrangler)(/|$)|(^|/)(\.env(?:\..*)?|keystore\.properties|local\.properties|secrets?\.json)$|\.(?:apk|aab|jks|keystore|pem|key|mp3|ogg|wav|webp|jpe?g)$', re.I)
checked = 0
import subprocess
for name in subprocess.check_output(['git', '-C', str(root), 'ls-files', '-z']).decode('utf-8').split('\0'):
    if name:
        assert not prohibited.search(name), 'Excluded resource or private file tracked: ' + name
for item in manifest['files']:
    path = root / item['path']
    assert path.is_file(), 'Missing source: ' + item['path']
    assert hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256'], 'Source changed: ' + item['path']
    checked += 1
print('Public source boundary and source hashes passed:', checked, 'files')
