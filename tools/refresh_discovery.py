import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re
import threading
import time
import unicodedata
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'app/src/main/assets/cartoon-discovery.json'
CACHE = ROOT / 'work/discovery/tvmaze'
BASE = 'https://www.wcostream.tv/anime/'
SHOWS = {'a-pup-named-scooby-doo': 4796,
 'adventure-time': 290,
 'american-dad-season-1': 215,
 'american-dragon-jake-long-season-1': 10007,
 'amphibia': 35072,
 'animaniacs': 6806,
 'aqua-teen-hunger-force': 382,
 'archer': 315,
 'archie-s-weird-mysteries': 15919,
 'avatar-the-last-airbender-book-1-water': 555,
 'batman-beyond': 504,
 'batman-the-animated-series': 757,
 'be-cool-scooby-doo': 5682,
 'ben-10': 951,
 'bob-s-burgers': 107,
 'bojack-horseman': 184,
 'boondocks': 912,
 'carmen-sandiego': 27346,
 'chip-n-dale-rescue-rangers': 5308,
 'chowder': 978,
 'clarence': 5617,
 'courage-the-cowardly-dog': 1956,
 'danny-phantom': 6301,
 'darkwing-duck': 5309,
 'detentionaire': 16255,
 'dexters-laboratory': 1953,
 'disenchantment': 30715,
 'ducktales': 4295,
 'ducktales-2017': 19621,
 'ed-edd-n-eddy': 6428,
 'f-is-for-family': 6209,
 'family-guy': 84,
 'fosters-home-for-imaginary-friends': 7335,
 'freakazoid': 6838,
 'futurama-season-1': 538,
 'gargoyles': 1898,
 'generator-rex': 8317,
 'genndy-tartakovskys-primal': 42184,
 'gravity-falls': 396,
 'harley-quinn': 33452,
 'he-man-and-the-masters-of-the-universe': 4230,
 'hey-arnold': 6482,
 'hilda': 25910,
 'infinity-train': 39945,
 'inside-job': 41933,
 'inspector-gadget': 4579,
 'invader-zim': 409,
 'invincible': 37196,
 'jackie-chan-adventures': 5709,
 'jonny-quest': 4044,
 'justice-league': 22040,
 'justice-league-unlimited': 505,
 'kim-possible': 2557,
 'king-of-the-hill': 115,
 'kipo-and-the-age-of-wonderbeasts': 42593,
 'martin-mystery': 16444,
 'metalocalypse': 928,
 'my-life-as-a-teenage-robot': 12450,
 'over-the-garden-wall': 1744,
 'phineas-and-ferb': 672,
 'regular-show': 868,
 'rick-and-morty': 216,
 'rockos-modern-life': 6322,
 'samurai-jack': 1603,
 'scooby-doo-mystery-incorporated': 2711,
 'scooby-doo-where-are-you-1969': 3358,
 'she-ra-and-the-princesses-of-power': 37089,
 'smiling-friends': 47182,
 'south-park': 112,
 'space-ghost': 21960,
 'spider-man-animated-series-1994': 1611,
 'spongebob-squarepants': 713,
 'star-vs-the-forces-of-evil': 1551,
 'steven-universe': 1615,
 'super-friends': 20279,
 'superman-the-animated-series': 1957,
 'talespin': 8520,
 'teen-titans': 765,
 'teenage-mutant-ninja-turtles-1987': 4159,
 'the-amazing-world-of-gumball-season-1': 3134,
 'the-angry-beavers': 5041,
 'the-avengers-earths-mightiest-heroes': 671,
 'the-dragon-prince': 37675,
 'the-flintstones': 2143,
 'the-grim-adventures-of-billy-and-mandy': 7345,
 'the-jetsons': 2145,
 'the-legend-of-korra': 178,
 'the-life-and-times-of-juniper-lee': 16204,
 'the-marvelous-misadventures-of-flapjack': 5472,
 'the-owl-house': 35073,
 'the-pirates-of-dark-water': 19136,
 'the-powerpuff-girls': 1955,
 'the-real-ghostbusters': 4299,
 'the-secret-saturdays': 26989,
 'the-smurfs': 4583,
 'the-spectacular-spider-man': 4490,
 'the-venture-bros': 304,
 'the-yogi-bear-show': 5755,
 'thundercats-1985': 4476,
 'tiny-toon-adventures': 4484,
 'tmnt-2003': 736,
 'top-cat': 5764,
 'transformers-prime': 5823,
 'trollhunters': 21892,
 'wacky-races': 5751,
 'wakfu': 10123,
 'wander-over-yonder': 1616,
 'we-bare-bears': 2612,
 'whats-new-scooby-doo': 7593,
 'x-men': 472,
 'x-men-97': 58951,
 'young-justice': 689}
COLLECTIONS = {'cartoon-essentials': ['teen-titans',
                        'avatar-the-last-airbender-book-1-water',
                        'scooby-doo-where-are-you-1969',
                        'batman-the-animated-series',
                        'gravity-falls',
                        'adventure-time',
                        'over-the-garden-wall',
                        'steven-universe',
                        'regular-show',
                        'spongebob-squarepants',
                        'phineas-and-ferb',
                        'dexters-laboratory',
                        'the-powerpuff-girls',
                        'samurai-jack',
                        'courage-the-cowardly-dog',
                        'ducktales',
                        'animaniacs',
                        'ben-10',
                        'the-amazing-world-of-gumball-season-1',
                        'hey-arnold'],
 'cartoon-adventures': ['avatar-the-last-airbender-book-1-water',
                        'the-legend-of-korra',
                        'adventure-time',
                        'steven-universe',
                        'ducktales-2017',
                        'amphibia',
                        'the-owl-house',
                        'hilda',
                        'kipo-and-the-age-of-wonderbeasts',
                        'she-ra-and-the-princesses-of-power',
                        'the-dragon-prince',
                        'infinity-train',
                        'star-vs-the-forces-of-evil',
                        'trollhunters',
                        'carmen-sandiego',
                        'wakfu',
                        'the-pirates-of-dark-water',
                        'jackie-chan-adventures'],
 'cartoon-heroes': ['teen-titans',
                    'batman-the-animated-series',
                    'superman-the-animated-series',
                    'justice-league',
                    'justice-league-unlimited',
                    'batman-beyond',
                    'young-justice',
                    'the-spectacular-spider-man',
                    'spider-man-animated-series-1994',
                    'the-avengers-earths-mightiest-heroes',
                    'x-men',
                    'x-men-97',
                    'ben-10',
                    'kim-possible',
                    'danny-phantom',
                    'my-life-as-a-teenage-robot',
                    'generator-rex',
                    'tmnt-2003',
                    'transformers-prime',
                    'gargoyles'],
 'cartoon-mysteries': ['scooby-doo-where-are-you-1969',
                       'scooby-doo-mystery-incorporated',
                       'whats-new-scooby-doo',
                       'a-pup-named-scooby-doo',
                       'be-cool-scooby-doo',
                       'gravity-falls',
                       'over-the-garden-wall',
                       'courage-the-cowardly-dog',
                       'martin-mystery',
                       'detentionaire',
                       'the-secret-saturdays',
                       'archie-s-weird-mysteries',
                       'the-real-ghostbusters',
                       'inspector-gadget',
                       'hilda'],
 'cartoon-adult': ['family-guy',
                   'south-park',
                   'futurama-season-1',
                   'rick-and-morty',
                   'archer',
                   'bojack-horseman',
                   'american-dad-season-1',
                   'harley-quinn',
                   'invincible',
                   'bob-s-burgers',
                   'boondocks',
                   'king-of-the-hill',
                   'disenchantment',
                   'inside-job',
                   'smiling-friends',
                   'the-venture-bros',
                   'metalocalypse',
                   'aqua-teen-hunger-force',
                   'f-is-for-family',
                   'genndy-tartakovskys-primal'],
 'cartoon-offbeat': ['regular-show',
                     'the-amazing-world-of-gumball-season-1',
                     'adventure-time',
                     'chowder',
                     'the-marvelous-misadventures-of-flapjack',
                     'clarence',
                     'ed-edd-n-eddy',
                     'rockos-modern-life',
                     'the-angry-beavers',
                     'the-grim-adventures-of-billy-and-mandy',
                     'invader-zim',
                     'courage-the-cowardly-dog',
                     'we-bare-bears',
                     'spongebob-squarepants',
                     'fosters-home-for-imaginary-friends',
                     'wander-over-yonder',
                     'animaniacs',
                     'freakazoid'],
 'cartoon-classics': ['scooby-doo-where-are-you-1969',
                      'the-flintstones',
                      'the-jetsons',
                      'top-cat',
                      'tiny-toon-adventures',
                      'the-yogi-bear-show',
                      'wacky-races',
                      'super-friends',
                      'jonny-quest',
                      'space-ghost',
                      'he-man-and-the-masters-of-the-universe',
                      'thundercats-1985',
                      'inspector-gadget',
                      'teenage-mutant-ninja-turtles-1987',
                      'ducktales',
                      'chip-n-dale-rescue-rangers',
                      'talespin',
                      'darkwing-duck',
                      'animaniacs',
                      'the-smurfs'],
 'cartoon-fantasy': ['avatar-the-last-airbender-book-1-water',
                     'the-legend-of-korra',
                     'the-owl-house',
                     'amphibia',
                     'the-dragon-prince',
                     'she-ra-and-the-princesses-of-power',
                     'hilda',
                     'kipo-and-the-age-of-wonderbeasts',
                     'over-the-garden-wall',
                     'steven-universe',
                     'star-vs-the-forces-of-evil',
                     'adventure-time',
                     'trollhunters',
                     'wakfu',
                     'the-pirates-of-dark-water',
                     'gargoyles',
                     'american-dragon-jake-long-season-1',
                     'the-life-and-times-of-juniper-lee']}


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def date(value):
    if not isinstance(value, str):
        raise ValueError('Snapshot dates must be ISO timestamps')
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None or result.timestamp() > time.time() + 300:
        raise ValueError('Snapshot dates must be timezone-aware and not in the future')
    return result


def title_key(value):
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode().lower()
    return re.sub('[^a-z0-9]+', ' ', value).strip()


def order(item):
    rating = item['rating']
    return (-(rating if rating is not None else -1), title_key(item['title']), item['url'])


def source_id(value):
    parsed = urlsplit(value)
    match = re.fullmatch(r'/shows/([1-9][0-9]*)(?:/[a-z0-9-]+)?/?', parsed.path)
    if parsed.scheme != 'https' or parsed.netloc != 'www.tvmaze.com' or parsed.query or parsed.fragment or not match:
        raise ValueError('Each rating must retain its canonical HTTPS TVmaze show page')
    return int(match[1])


def rating(value):
    if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 10):
        raise ValueError('TVmaze ratings must be null or a real number from 0 to 10')
    return value


def catalog():
    data = json.loads((ROOT / 'app/src/main/assets/catalog-index.json').read_text(encoding='utf-8'))
    return {item['url']: item for item in data['items'] if item['kind'] == 'series' and 'Cartoons' in item['categories']}


def check(data, records):
    if data.get('version') != 1 or data.get('source') != 'TVmaze' or set(data.get('collections', {})) != set(COLLECTIONS):
        raise ValueError('Unexpected cartoon discovery snapshot version, source, or collections')
    date(data['updatedAt'])
    count = 0
    for key, slugs in COLLECTIONS.items():
        items = data['collections'][key]
        expected = {BASE + slug for slug in slugs}
        if not 15 <= len(items) <= 35 or len(items) != len(expected) or {item['url'] for item in items} != expected:
            raise ValueError('Collection must contain its curated, unique WCO series: ' + key)
        for item in items:
            record = records.get(item['url'])
            if set(item) != {'url', 'title', 'rating', 'sourceUrl'} or not record or item['title'] != record['title']:
                raise ValueError('A collection entry is not an exact WCO cartoon-series match')
            if source_id(item['sourceUrl']) != SHOWS[item['url'][len(BASE):]]:
                raise ValueError('A collection entry has an unexpected TVmaze identity')
            rating(item['rating'])
        if items != sorted(items, key=order):
            raise ValueError('Collection ratings are not ordered consistently: ' + key)
        count += len(items)
    essentials = {item['url'] for item in data['collections']['cartoon-essentials']}
    adult = {item['url'] for item in data['collections']['cartoon-adult']}
    if not {BASE + 'teen-titans', BASE + 'avatar-the-last-airbender-book-1-water', BASE + 'scooby-doo-where-are-you-1969'} <= essentials:
        raise ValueError('Essentials must retain original Teen Titans, Avatar, and Scooby-Doo')
    if not {BASE + 'family-guy', BASE + 'south-park'} <= adult:
        raise ValueError('Adult animation must retain Family Guy and South Park')
    if len(json.dumps(data, ensure_ascii=False).encode('utf-8')) > 131072:
        raise ValueError('Cartoon discovery metadata exceeds 128 KiB')
    return count


class Fetcher:
    def __init__(self):
        self.lock = threading.Lock()
        self.next = 0

    def fetch(self, identity):
        for attempt in range(3):
            with self.lock:
                time.sleep(max(0, self.next - time.monotonic()))
                self.next = time.monotonic() + .7
            request = Request(f'https://api.tvmaze.com/shows/{identity}', headers={'Accept': 'application/json', 'User-Agent': 'CartoonWatch/0.5 (curated cartoon metadata refresh)', 'Connection': 'close'})
            try:
                with urlopen(request, timeout=12) as response:
                    raw = response.read(262145)
                    if len(raw) > 262144:
                        raise ValueError('TVmaze show response exceeds 256 KiB')
                    show = json.loads(raw)
                if show.get('id') != identity or show.get('type') != 'Animation' or source_id(show['url']) != identity:
                    raise ValueError('TVmaze show identity or animation type changed')
                value = {'fetchedAt': stamp(), 'id': identity, 'title': show['name'], 'year': (show.get('premiered') or '')[:4], 'rating': rating((show.get('rating') or {}).get('average')), 'sourceUrl': show['url']}
                (CACHE / f'{identity}.json').write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
                return value
            except HTTPError as error:
                if error.code != 429 or attempt == 2:
                    raise
                delay = error.headers.get('Retry-After', '3')
                delay = min(60, max(3, float(delay) if delay.isdigit() else 3))
                with self.lock:
                    self.next = max(self.next, time.monotonic() + delay)
        raise ValueError('TVmaze metadata refresh failed')


def cached(identity):
    path = CACHE / f'{identity}.json'
    try:
        if path.is_file() and path.stat().st_size <= 16384:
            value = json.loads(path.read_text(encoding='utf-8'))
            if isinstance(value, dict) and value.get('id') == identity and source_id(value['sourceUrl']) == identity:
                date(value['fetchedAt'])
                rating(value['rating'])
                return value
    except (OSError, ValueError, TypeError, KeyError):
        pass
    return None


def build(records, refresh):
    identities = sorted(set(SHOWS.values()))
    if len(identities) > 140 or any(BASE + slug not in records for slug in SHOWS):
        raise ValueError('Curated mappings must stay bounded and refer to the WCO cartoon catalog')
    values = {identity: cached(identity) for identity in identities}
    if refresh:
        CACHE.mkdir(parents=True, exist_ok=True)
        fetcher = Fetcher()
        with ThreadPoolExecutor(max_workers=3) as pool:
            tasks = {pool.submit(fetcher.fetch, identity): identity for identity in identities}
            for index, task in enumerate(as_completed(tasks), 1):
                values[tasks[task]] = task.result()
                if index % 20 == 0 or index == len(tasks):
                    print(f'TVmaze metadata: {index}/{len(tasks)}', flush=True)
    if any(value is None for value in values.values()) and OUTPUT.is_file():
        saved = json.loads(OUTPUT.read_text(encoding='utf-8'))
        check(saved, records)
        for items in saved['collections'].values():
            for item in items:
                identity = source_id(item['sourceUrl'])
                if values.get(identity) is None:
                    values[identity] = {'id': identity, 'rating': item['rating'], 'sourceUrl': item['sourceUrl'], 'fetchedAt': saved['updatedAt']}
    if any(value is None for value in values.values()):
        raise ValueError('No cached ratings are available. Run with --refresh once to fetch the curated TVmaze show metadata.')
    collections = {}
    for key, slugs in COLLECTIONS.items():
        entries = []
        for slug in slugs:
            record, value = records[BASE + slug], values[SHOWS[slug]]
            entries.append({'url': record['url'], 'title': record['title'], 'rating': value['rating'], 'sourceUrl': value['sourceUrl']})
        collections[key] = sorted(entries, key=order)
    return {'version': 1, 'updatedAt': min(value['fetchedAt'] for value in values.values()), 'source': 'TVmaze', 'collections': collections}


def main():
    parser = argparse.ArgumentParser(description='Build the small curated WCO cartoon discovery snapshot from cached TVmaze ratings.')
    choice = parser.add_mutually_exclusive_group()
    choice.add_argument('--refresh', action='store_true', help='Fetch only curated show IDs, with at most three workers and shared rate limiting.')
    choice.add_argument('--check', action='store_true', help='Validate the bundled snapshot offline, without fetching metadata or changing files.')
    args = parser.parse_args()
    records = catalog()
    data = json.loads(OUTPUT.read_text(encoding='utf-8')) if args.check else build(records, args.refresh)
    count = check(data, records)
    if not args.check:
        OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Cartoon discovery: {len(data["collections"])} collections, {count} entries, {len(SHOWS)} unique WCO series; snapshot {data["updatedAt"]}')


if __name__ == '__main__':
    main()
