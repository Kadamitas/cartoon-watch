import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import gzip
import hashlib
import html
import json
from pathlib import Path
import re
import threading
import time
import unicodedata
import urllib.error
import urllib.request
from urllib.parse import urlsplit
import zlib

ROOT = Path(__file__).resolve().parents[1]
ASSET = ROOT / 'app/src/main/assets/catalog-index.json'
CACHE = ROOT / 'work/artwork'
ANIME_URL = 'https://github.com/cedya77/anime-offline-database/releases/download/latest/anime-offline-database-minified.json'
USER_AGENT = 'CartoonWatch/0.4 artwork metadata (https://github.com/Kadamitas/cartoon-watch)'
FIELDS = ('image', 'imageSource', 'imageSourceUrl', 'imageAttribution')
BRANDS = {
    'cdn.myanimelist.net': ('MyAnimeList', ('myanimelist.net',)),
    'cdn.anime-planet.com': ('Anime-Planet', ('anime-planet.com',)),
    'cdn.anisearch.com': ('aniSearch', ('anisearch.com',)),
    'media.kitsu.app': ('Kitsu', ('kitsu.app', 'kitsu.io')),
    's4.anilist.co': ('AniList', ('anilist.co',)),
    'cdn.animenewsnetwork.com': ('Anime News Network', ('animenewsnetwork.com',)),
    'cdn.anidb.net': ('AniDB', ('anidb.net',)),
    'simkl.in': ('Simkl', ('simkl.com',)),
    'u.livechart.me': ('LiveChart', ('livechart.me',)),
}
ANIME_CREDIT = 'Artwork metadata: anime-offline-database by cedya77 and manami-project (ODbL 1.0); images belong to their respective owners.'
TV_CREDIT = 'Artwork metadata: TVmaze, CC BY-SA 4.0. Images belong to their respective owners.'
LOCK = threading.Lock()
NEXT_REQUEST = 0.0


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_name(path.name + '.pending')
    pending.write_bytes(value)
    pending.replace(path)


def fetch(url, limit=80 * 1024 * 1024):
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip'})
            with urllib.request.urlopen(request, timeout=30) as response:
                data = response.read(limit + 1)
                if len(data) > limit:
                    raise RuntimeError('Metadata response exceeded its size limit')
                if response.headers.get('Content-Encoding') == 'gzip':
                    data = gzip.decompress(data)
            return json.loads(data)
        except (urllib.error.URLError, TimeoutError):
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def tvmaze(cache, refresh=False):
    global NEXT_REQUEST
    output = cache / 'tvmaze-animation.json'
    if output.is_file() and not refresh:
        return json.loads(output.read_text(encoding='utf-8'))
    updates = fetch('https://api.tvmaze.com/updates/shows', 8 * 1024 * 1024)
    pages = max(map(int, updates)) // 250 + 1
    if not 1 <= pages <= 2000:
        raise RuntimeError('Unexpected TVmaze index size')

    def page(number):
        global NEXT_REQUEST
        path = cache / 'tvmaze-pages' / (str(number) + '.json')
        if path.is_file() and not refresh:
            return json.loads(path.read_text(encoding='utf-8'))
        with LOCK:
            delay = max(0, NEXT_REQUEST - time.monotonic())
            NEXT_REQUEST = max(NEXT_REQUEST, time.monotonic()) + .65
        if delay:
            time.sleep(delay)
        rows = fetch('https://api.tvmaze.com/shows?page=' + str(number), 4 * 1024 * 1024)
        result = [{'id': row['id'], 'title': row['name'], 'year': (row.get('premiered') or '')[:4], 'image': row['image']['medium'], 'sourceUrl': row['url']} for row in rows if row.get('type') == 'Animation' and row.get('image')]
        atomic(path, encode(result))
        return result

    with ThreadPoolExecutor(max_workers=3) as pool:
        result = [row for rows in pool.map(page, range(pages)) for row in rows]
    if not result:
        raise RuntimeError('TVmaze returned no animation artwork')
    atomic(output, encode(result))
    return result


def key(value):
    value = html.unescape(value).casefold().replace('&', ' and ')
    return ''.join(char for char in unicodedata.normalize('NFKD', value) if char.isalnum())


def identity(item):
    title = html.unescape(item['title']).strip()
    title = re.sub(r'\s+(?:english\s+)?(?:dubbed|subbed|dub|sub)\s*$', '', title, flags=re.I)
    years = re.findall(r'\((19\d{2}|20\d{2})\)', title)
    title = re.sub(r'\((?:19\d{2}|20\d{2}|TV|OVA|ONA|\d+\+)\)', '', title, flags=re.I).strip()
    variants = {key(title)}
    tail = re.fullmatch(r'(.+?)\s+\(([^()]*)\)', title)
    if tail and not re.search(r'\b(?:season|part|uncensored|remaster)\b', tail[2], re.I):
        variants.update([key(tail[1]), key(tail[2])])
    return variants, int(years[-1]) if years else None


def anime_image(item):
    image = item.get('thumbnail') or item.get('picture') or ''
    host = urlsplit(image).hostname
    if host not in BRANDS or urlsplit(image).scheme != 'https':
        return None
    if host == 'cdn.myanimelist.net':
        image = item['picture'].replace('/images/', '/r/160x225/images/', 1)
    brand, domains = BRANDS[host]
    source = next((url for url in item['sources'] if any((urlsplit(url).hostname or '').removeprefix('www.') == domain for domain in domains)), 'https://github.com/cedya77/anime-offline-database')
    return dict(zip(FIELDS, (image, brand, source, ANIME_CREDIT)))


def anime_match(item, records, lookup):
    variants, year = identity(item)
    candidates = set().union(*(lookup.get(variant, set()) for variant in variants))
    ranked = []
    language = bool(re.search(r'\b(?:dubbed|subbed)\s*$', item['title'], re.I))
    for index in candidates:
        record = records[index]
        if year and record.get('animeSeason', {}).get('year') != year:
            continue
        kind = record['type']
        if item['kind'] == 'movie':
            rank = 3 if kind == 'MOVIE' and (year or language or key(record['title']) in variants) else 0
        else:
            rank = 3 if kind in ('TV', 'ONA') else 1 if kind in ('OVA', 'SPECIAL') else 0
        if rank:
            ranked.append((rank, index))
    if not ranked:
        return None
    best = max(rank for rank, index in ranked)
    winners = [records[index] for rank, index in ranked if rank == best]
    return anime_image(winners[0]) if len(winners) == 1 else False


def television_match(item, lookup):
    if item['kind'] != 'series':
        return None
    variants, year = identity(item)
    candidates = {row['id']: row for variant in variants for row in lookup.get(variant, [])}
    rows = [row for row in candidates.values() if not year or str(year) == row['year']]
    if not rows:
        return None
    if len(rows) > 1:
        return False
    row = rows[0]
    return dict(zip(FIELDS, (row['image'], 'TVmaze', row['sourceUrl'], TV_CREDIT)))


def validate(catalog):
    counts = Counter()
    hosts = set(BRANDS) | {'static.tvmaze.com'}
    for item in catalog['items']:
        if item.get('imageAttribution') not in (ANIME_CREDIT, TV_CREDIT):
            continue
        if item['kind'] == 'episode':
            raise RuntimeError('Individual episode artwork is not part of this snapshot')
        if not all(item.get(field) for field in FIELDS) or urlsplit(item['image']).scheme != 'https' or urlsplit(item['image']).hostname not in hosts:
            raise RuntimeError('Invalid artwork metadata')
        counts[item['kind']] += 1
    return dict(counts)


def enrich(catalog, anime, television):
    anime_lookup = defaultdict(set)
    for index, record in enumerate(anime['data']):
        if anime_image(record):
            for title in [record['title']] + record.get('synonyms', []):
                if title:
                    anime_lookup[key(title)].add(index)
    television_lookup = defaultdict(list)
    for record in television:
        television_lookup[key(record['title'])].append(record)
    for item in catalog['items']:
        if item.get('imageAttribution') in (ANIME_CREDIT, TV_CREDIT):
            for field in FIELDS:
                item.pop(field, None)
            item['image'] = ''
    baseline = encode(catalog)
    for item in catalog['items']:
        if item['kind'] == 'episode' or item.get('image'):
            continue
        cartoon = 'Cartoons' in item.get('categories', [])
        result = television_match(item, television_lookup) if cartoon else None
        if result is None:
            result = anime_match(item, anime['data'], anime_lookup)
        if result is None:
            result = television_match(item, television_lookup)
        if result:
            item.update(result)
    counts = validate(catalog)
    digest = hashlib.sha256(encode([{field: item.get(field, '') for field in ('url',) + FIELDS} for item in catalog['items'] if item.get('imageAttribution') in (ANIME_CREDIT, TV_CREDIT)])).hexdigest()[:12]
    catalog['version'] = catalog['version'].split('+art-')[0] + '+art-' + digest
    catalog['artwork'] = {'version': 1, 'generatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'), 'animeSnapshot': anime.get('lastUpdate'), 'series': counts.get('series', 0), 'movies': counts.get('movie', 0), 'embeddedImages': False, 'sources': [{'name': 'anime-offline-database by cedya77 and manami-project', 'url': 'https://github.com/cedya77/anime-offline-database', 'license': 'https://opendatacommons.org/licenses/odbl/1.0/'}, {'name': 'TVmaze', 'url': 'https://www.tvmaze.com/api', 'license': 'https://creativecommons.org/licenses/by-sa/4.0/'}]}
    encoded = encode(catalog)
    overhead = len(zlib.compress(encoded, 6)) - len(zlib.compress(baseline, 6))
    if overhead > 250 * 1024:
        raise RuntimeError('Artwork URL metadata exceeded its compressed size budget')
    return encoded, {**counts, 'uniqueImages': len({item['image'] for item in catalog['items'] if item.get('image')}), 'embeddedImages': 0, 'deflate6OverheadBytes': overhead, 'version': catalog['version']}


def main():
    parser = argparse.ArgumentParser(description='Add small, attributable artwork URLs without bundling image bytes.')
    parser.add_argument('--catalog', type=Path, default=ASSET)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--anime', type=Path)
    parser.add_argument('--tvmaze', type=Path)
    parser.add_argument('--cache', type=Path, default=CACHE)
    parser.add_argument('--refresh', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    catalog = json.loads(args.catalog.read_text(encoding='utf-8'))
    if args.check:
        print(json.dumps({'artwork': validate(catalog), 'networkRequests': 0}))
        return
    anime_path = args.anime or args.cache / 'anime.json'
    if not anime_path.is_file() or (args.refresh and not args.anime):
        atomic(anime_path, encode(fetch(ANIME_URL)))
    anime = json.loads(anime_path.read_text(encoding='utf-8'))
    television = json.loads(args.tvmaze.read_text(encoding='utf-8')) if args.tvmaze else tvmaze(args.cache, args.refresh)
    encoded, result = enrich(catalog, anime, television)
    atomic(args.output or args.catalog, encoded)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
