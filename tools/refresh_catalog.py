import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import parse_qs, urljoin, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]
ASSET = ROOT / "app/src/main/assets/catalog-index.json"
BASE = "https://www.wcostream.tv/"
LISTS = {"dubbed-anime-list": "Dubbed anime", "cartoon-list": "Cartoons", "subbed-anime-list": "Subbed anime", "movie-list": "Movies", "ova-list": "OVA"}
HOSTS = {"wco.tv", "www.wco.tv", "m.wco.tv", "wcostream.tv", "www.wcostream.tv", "m.wcostream.tv"}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
LOCK = threading.Lock()
LAST_START = 0.0


class TitleList(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.depth = None
        self.found = False
        self.anchor = None
        self.links = []
        self.paginated = False

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        if tag not in VOID:
            self.stack.append(tag)
        if attributes.get("id") == "sidebar_right":
            self.depth = len(self.stack)
            self.found = True
        if self.depth is not None and tag == "a" and attributes.get("href"):
            href = attributes["href"]
            self.anchor = [href, []]
            parsed = urlsplit(href)
            if "page" in parse_qs(parsed.query) or re.search(r"/page/\d+", parsed.path) or "next" in attributes.get("rel", "").split():
                self.paginated = True

    def handle_data(self, value):
        if self.anchor is not None:
            self.anchor[1].append(value)

    def handle_endtag(self, tag):
        if tag == "a" and self.anchor is not None:
            self.links.append((" ".join("".join(self.anchor[1]).split()), self.anchor[0]))
            self.anchor = None
        if tag in self.stack:
            index = len(self.stack) - 1 - self.stack[::-1].index(tag)
            del self.stack[index:]
        if self.depth is not None and len(self.stack) < self.depth:
            self.depth = None


def canonical(href, path):
    url = urlsplit(urljoin(BASE + path, href))
    if url.scheme not in ("http", "https") or url.hostname not in HOSTS:
        return None
    value = url.path.rstrip("/")
    if value in ("", "/contact", "/search", "/" + path):
        return None
    if path in ("dubbed-anime-list", "cartoon-list", "subbed-anime-list") and not value.startswith("/anime/"):
        return None
    return urlunsplit(("https", "www.wcostream.tv", value, "", ""))


def fetch(path, fixture):
    global LAST_START
    url = BASE + path
    if fixture:
        file = Path(fixture) / (hashlib.sha256(url.encode()).hexdigest() + ".html")
        return file.read_text(encoding="utf-8")
    for attempt in range(3):
        with LOCK:
            time.sleep(max(0, 0.5 - (time.monotonic() - LAST_START)))
            LAST_START = time.monotonic()
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Linux; Android 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36", "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9"})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                final = urlsplit(response.url)
                if final.hostname not in HOSTS or final.scheme != "https":
                    raise RuntimeError("Catalog redirected outside its source family")
                raw = response.read(8 * 1024 * 1024 + 1)
                if len(raw) > 8 * 1024 * 1024:
                    raise RuntimeError("Catalog page exceeded its size limit")
                return raw.decode(response.headers.get_content_charset() or "utf-8", errors="replace")
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise
            time.sleep(min(10, 2 ** (attempt + 1)))


def collect(path, fixture):
    parser = TitleList()
    parser.feed(fetch(path, fixture))
    if not parser.found or parser.paginated:
        raise RuntimeError(path + ": missing list container or new pagination; snapshot left unchanged")
    records = {}
    for title, href in parser.links:
        url = canonical(href, path)
        if title and url:
            records[url] = {"title": title, "url": url, "provider": "wcostream", "kind": "movie" if path == "movie-list" else "episode" if path == "ova-list" else "series", "image": "", "category": LISTS[path], "categories": [LISTS[path]]}
    if not records:
        raise RuntimeError(path + ": empty list; snapshot left unchanged")
    return path, list(records.values())


def validate(data):
    items = data.get("items", [])
    if not items or len({item["url"] for item in items}) != len(items):
        raise RuntimeError("Snapshot is empty or contains duplicate links")
    if len(data.get("coverage", [])) != len(LISTS) or {row.get("category") for row in data["coverage"]} != set(LISTS.values()) or not all(row.get("complete") and row.get("records", 0) > 0 for row in data["coverage"]):
        raise RuntimeError("Snapshot does not cover all five complete public lists")
    for item in items:
        if not item.get("title", "").strip() or any(ord(char) < 32 for char in item["title"]) or urlsplit(item["url"]).hostname != "www.wcostream.tv":
            raise RuntimeError("Snapshot contains an invalid title/link")
    return len(items)


def refresh(output, fixture=None, allow_shrink=False):
    previous = json.loads(ASSET.read_text(encoding="utf-8")) if ASSET.is_file() else {}
    old_counts = {row["category"]: row["records"] for row in previous.get("coverage", [])}
    artwork_fields = ("image", "imageSource", "imageSourceUrl", "imageAttribution")
    old_artwork = {item["url"]: item for item in previous.get("items", []) if item.get("image")}
    with ThreadPoolExecutor(max_workers=3) as pool:
        lists = list(pool.map(lambda path: collect(path, fixture), LISTS))
    records = {}
    coverage = []
    priorities = {"episode": 0, "series": 1, "movie": 2}
    for path, items in lists:
        category = LISTS[path]
        if not allow_shrink and len(items) < old_counts.get(category, 0) * 0.9:
            raise RuntimeError(category + " shrank by more than 10%; inspect the source before using --allow-shrink")
        coverage.append({"category": category, "url": BASE + path, "records": len(items), "complete": True})
        for item in items:
            existing = records.get(item["url"])
            if existing:
                if category not in existing["categories"]:
                    existing["categories"].append(category)
                if priorities[item["kind"]] > priorities[existing["kind"]]:
                    existing["kind"] = item["kind"]
            else:
                records[item["url"]] = item
    for item in records.values():
        old = old_artwork.get(item["url"])
        if old and " ".join(old["title"].split()).casefold() == " ".join(item["title"].split()).casefold() and old["kind"] == item["kind"]:
            item.update({field: old[field] for field in artwork_fields if field in old})
    now = datetime.now(timezone.utc)
    data = {"version": "wco-" + now.date().isoformat(), "generatedAt": now.isoformat(timespec="seconds").replace("+00:00", "Z"), "provider": "wcostream", "sourceFamily": ["wco.tv", "wcostream.tv"], "coverage": coverage, "items": sorted(records.values(), key=lambda item: item["title"].casefold())}
    if isinstance(previous.get("artwork"), dict):
        data["artwork"] = dict(previous["artwork"])
        data["artwork"].update(series=sum(item["kind"] == "series" and bool(item.get("image")) for item in data["items"]), movies=sum(item["kind"] == "movie" and bool(item.get("image")) for item in data["items"]))
    count = validate(data)
    if not allow_shrink and count < len(previous.get("items", [])) * 0.9:
        raise RuntimeError("Total catalog shrank by more than 10%; snapshot left unchanged")
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + ".tmp")
    try:
        temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)
    print(json.dumps({"records": count, "coverage": coverage, "output": str(output)}, indent=2))


def main():
    parser = argparse.ArgumentParser(description="Refresh only the five public WCO title lists; no episode or video fetches.")
    parser.add_argument("--output", default=str(ASSET))
    parser.add_argument("--fixture-dir")
    parser.add_argument("--allow-shrink", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        print(json.dumps({"records": validate(json.loads(Path(args.output).read_text(encoding="utf-8"))), "networkRequests": 0}))
    else:
        refresh(args.output, args.fixture_dir, args.allow_shrink)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError) as error:
        raise SystemExit("Catalog refresh stopped: " + str(error))
