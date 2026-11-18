import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'app/src/main/assets'


def generate(check=False):
    data = json.loads((ASSETS / 'discovery-categories.json').read_text(encoding='utf-8'))
    rows = data['categories']
    keys = [row['key'] for row in rows]
    if data['version'] != 2 or len(keys) != len(set(keys)) or not 2 <= len(rows) <= 40:
        raise ValueError('Discovery categories are invalid')
    for row in rows:
        if row['type'] not in ('anime', 'cartoons') or not row['label'] or len(row['label']) > 40 or not all(c.islower() or c == '-' for c in row['key']):
            raise ValueError('Discovery category is invalid')
        if row['type'] == 'anime' and not any(row.get(key) for key in ('genre', 'tag', 'genres')):
            raise ValueError('Anime categories require an actual feed filter')
    encoded = json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n'
    public = [{key: row[key] for key in ('key', 'label', 'type')} for row in rows]
    targets = {ASSETS / 'discovery.js': 'window.CWDiscoveryCategories=' + json.dumps(public, ensure_ascii=False, separators=(',', ':')) + ';\n', ROOT / 'clients/roku/source/discovery-categories.json': encoded}
    for path, text in targets.items():
        if check:
            if not path.is_file() or path.read_text(encoding='utf-8') != text:
                raise ValueError('Regenerate discovery categories: ' + str(path.relative_to(ROOT)))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding='utf-8')
    print(json.dumps({'anime': sum(row['type'] == 'anime' for row in rows), 'cartoons': sum(row['type'] == 'cartoons' for row in rows), 'check': check}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Generate shared discovery category controls for HTML and Roku clients.')
    parser.add_argument('--check', action='store_true')
    generate(parser.parse_args().check)
