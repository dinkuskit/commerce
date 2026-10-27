#!/usr/bin/env python3
"""Reproduce source + built Registry identity; run after npm ci && npm run build."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--check', action='store_true', help='compare with artifact-identity.json')
args = parser.parse_args()
tracked = subprocess.check_output(['git', '-C', str(root), 'ls-files', '-z', '--', 'src']).decode().split('\0')
paths = sorted([p for p in tracked if p.endswith('.ts')] + [
    'package-lock.json', 'emdash-plugin.jsonc', 'scripts/build-sandbox.mjs', 'scripts/share-literals.mjs',
])
# Full POSIX path strings in UTF-8/ASCII lexicographic order, not Path-component order.
lines = [p + ':' + hashlib.sha256((root / p).read_bytes()).hexdigest() for p in paths]
backend = (root / 'dist/sandbox/plugin.mjs').read_bytes()
actual = {
    'source_fingerprint_sha256': hashlib.sha256('\n'.join(lines).encode()).hexdigest(),
    'backend_sha256': hashlib.sha256(backend).hexdigest(),
    'backend_bytes': len(backend),
}
if args.check:
    expected = json.loads((Path(__file__).parent / 'artifact-identity.json').read_text())
    for key, value in actual.items():
        if expected[key] != value:
            raise SystemExit(f'{key}: expected {expected[key]}, got {value}')
print(json.dumps(actual, indent=2))
