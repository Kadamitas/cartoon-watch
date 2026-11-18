import argparse
import json
import shutil
import struct
import subprocess
import zlib
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]


def icon(size):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            color = (17, 22, 35, 255)
            if size * .16 <= x <= size * .84 and size * .23 <= y <= size * .77:
                color = (255, 121, 91, 255)
            if size * .43 <= x <= size * .66 and abs(y - size * .5) <= (size * .66 - x) * .78:
                color = (17, 22, 35, 255)
            rows.extend(color)
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(rows), 9)) + chunk(b'IEND', b'')


def stage(platform):
    destination = ROOT / 'work' / 'webtv' / platform
    destination.mkdir(parents=True, exist_ok=True)
    assets = ROOT / 'app' / 'src' / 'main' / 'assets'
    for name in ('index.html', 'app.js', 'app.css', 'NOTICE.txt'):
        shutil.copyfile(assets / name, destination / name)
    for name in ('bridge.js', 'tv.css'):
        shutil.copyfile(ROOT / 'clients' / 'webtv' / name, destination / name)
    script = (destination / 'app.js').read_text(encoding='utf-8')
    script = script.replace('Built for Fire TV.', 'Built for ' + ('LG webOS.' if platform == 'lg' else 'Samsung TV.'))
    script = script.replace('(state.settings.adBlock ? "Ad protection on" : "Ad protection off") + " · WCO"', '"Companion playback · WCO"')
    script = script.replace('settingRow("Ad protection", "Reduce known ad and tracking requests. If a video will not play, try turning this off and reopening the player.", toggle)', 'settingRow("Ad protection", "Ads and popups are filtered by the companion before playback.", el("span", "setting-value", "Automatic"))')
    (destination / 'app.js').write_text(script, encoding='utf-8')
    html = (destination / 'index.html').read_text(encoding='utf-8')
    objects = "'self'" if platform == 'samsung' else "'none'"
    policy = "default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; connect-src http: https:; media-src http: https: blob:; object-src " + objects + "; frame-src 'none'; base-uri 'self'"
    html = html.replace('<head>', '<head>\n  <meta http-equiv="Content-Security-Policy" content="' + policy + '">', 1)
    html = html.replace('<link rel="stylesheet" href="app.css">', '<link rel="stylesheet" href="app.css">\n  <link rel="stylesheet" href="tv.css">', 1)
    platform_script = '<script src="$WEBAPIS/webapis/webapis.js"></script>\n  ' if platform == 'samsung' else ''
    html = html.replace('<script src="app.js"></script>', platform_script + '<script src="bridge.js"></script>\n  <script src="app.js"></script>', 1)
    (destination / 'index.html').write_text(html, encoding='utf-8')
    if platform == 'lg':
        metadata = json.loads((ROOT / 'clients' / 'lg' / 'appinfo.json').read_text(encoding='utf-8'))
        (destination / 'appinfo.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
        (destination / 'icon.png').write_bytes(icon(80))
        (destination / 'large-icon.png').write_bytes(icon(130))
    else:
        config = ROOT / 'clients' / 'samsung' / 'config.xml'
        ET.parse(config)
        shutil.copyfile(config, destination / 'config.xml')
        (destination / 'icon.png').write_bytes(icon(128))
    return destination


def main():
    parser = argparse.ArgumentParser(description='Stage LG webOS and Samsung Tizen clients from the shared TV interface.')
    parser.add_argument('--platform', choices=['lg', 'samsung', 'all'], default='all')
    parser.add_argument('--package', action='store_true')
    parser.add_argument('--certificate', help='Existing Samsung Tizen certificate profile for signing.')
    args = parser.parse_args()
    for platform in ('lg', 'samsung') if args.platform == 'all' else (args.platform,):
        directory = stage(platform)
        print(f'{platform}: {directory}')
        if not args.package:
            continue
        output = ROOT / 'outputs' / platform
        output.mkdir(parents=True, exist_ok=True)
        if platform == 'lg':
            executable = shutil.which('ares-package') or shutil.which('ares-package.cmd')
            if not executable:
                raise SystemExit('Install the official webOS CLI, then run again with --package.')
            subprocess.run([executable, str(directory), '--outdir', str(output)], check=True)
        else:
            executable = shutil.which('tizen') or shutil.which('tizen.bat')
            if not executable or not args.certificate:
                raise SystemExit('Install Tizen Studio TV tools and create a Samsung certificate profile, then pass --certificate PROFILE.')
            subprocess.run([executable, 'build-web', '--', str(directory)], check=True)
            subprocess.run([executable, 'package', '-t', 'wgt', '-s', args.certificate, '--', str(directory / '.buildResult')], check=True)
            packages = list((directory / '.buildResult').glob('*.wgt'))
            if not packages:
                raise SystemExit('Tizen did not produce a signed WGT package.')
            for package in packages:
                shutil.copyfile(package, output / package.name)
                print(output / package.name)


if __name__ == '__main__':
    main()
