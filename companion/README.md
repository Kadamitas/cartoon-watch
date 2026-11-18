# Local playback companion

The companion supplies the WCO catalog and native playback streams to the Roku, LG webOS, and Samsung Tizen clients. Keep its computer awake on the same network as the TV. Cartoon Watch requires no companion subscription or online account.

Install Node.js 22 or newer, Python 3, and a JDK with `java` and `javac` available on PATH. JDK 17 or newer works. From the repository root:

```sh
cd companion
npm ci
npm run setup
npm start
```

Enter one of the printed **TV service address** values in the TV app. The default port is 8765. `localhost` on a TV refers to the TV itself. Allow the computer's firewall to accept this port on your private network. The computer and service must remain running while you watch.

`npm run setup` installs the matching Playwright Chromium build. On Windows, the service first uses an installed Microsoft Edge when found. `BROWSER_EXECUTABLE` can select an existing Chromium-based browser; `PYTHON` can select Python, and `PORT` changes the listening port. Linux may require `npx playwright install --with-deps chromium`. [Browser installation](https://playwright.dev/docs/browsers), [supported Node.js releases](https://nodejs.org/en/about/previous-releases).

On its first metadata request, the service downloads two checksum-verified Java libraries into `work/companion` and compiles the existing catalog/resolver classes. WCO is the catalog. Playback tries WCO, AniWave, KissAnime, then HDToday when a matching episode is available. A source must visibly play advancing video before its stream is selected. Short episodes are supported; duration is not used as a ten-minute cutoff.

The TV receives opaque companion media addresses. The service forwards the source's required headers and matching cookies, rewrites nested HLS playlists, and preserves byte ranges for seeking. Cookies stay in memory. Subtitle tracks and intro ranges are returned only when the playing site supplies them. If metadata omits the intro, the service can briefly test one visible source Skip intro/Opening control, observe its actual seek target, and restore the video position and pause state. Missing or ambiguous controls are ignored. WebVTT tracks also receive an `srtUrl` for Roku. No intro timing is guessed, and protected streams are unsupported.

Three playback requests can be pending, with browser resolution running one at a time. Additional requests return 429 and can be retried. At most eight playback sessions are retained; each expires after two hours without media requests. Active playback refreshes this timer. Metadata requests coalesce and use a bounded cache. Restarting the service clears current playback sessions; use Retry in the TV app.

The LAN API is:

| Request | Result |
| --- | --- |
| `GET /health` | App name, version, ready status |
| `GET /api/catalog?q=&category=all&sort=az&offset=0&limit=60` | Indexed WCO items, total, categories, pagination |
| `GET /api/details?url=SOURCE_TITLE_URL` | Title details and episode list |
| `POST /api/artwork` | At most 12 visible titles, small covers, source credits, and pending lookups |
| `POST /api/play` | Opaque stream address, format, duration, source, supplied subtitles/intro |
| `GET` or `HEAD /stream/SESSION/RESOURCE` | Proxied media, HLS playlist, key, segment, or subtitle |

The play JSON contains `title`, `url`, `seriesTitle`, `seriesUrl`, `kind`, and optional `number`, `season`, and `resumeSeconds`. Error responses contain `error`. Keep this service on your local network.

Artwork requests send `{ "items": [...] }` and return `items`, `pending`, and `retryAfter`. Results retain each requested `url` and include `image`, `imageSource`, `imageSourceUrl`, and `imageAttribution`. Series and movies use the matched catalog's small metadata thumbnails. Unknown series can resolve their real WCO poster with two concurrent lookups and a bounded queue. Other image sources must pass a 512KB, 240×360-pixel check. Episode lookups reuse an explicit parent series; individual episode pages are not fetched for cover art. Artwork metadata is cached without bundling pictures in the app. Attribution is included in `ARTWORK-NOTICE.txt` inside the app assets.

Run the local API and proxy fixtures with:

```sh
npm run check
npm test
```

Set `TEST_MEDIA_FILE` to a local playable MP4 under 60 seconds to also run the real browser capture/decoder test. That test rejects a hidden decoy video, captures the visible short video, then decodes it again through the media proxy. No test video is shipped in the repository.

Desktop validation covered the real 16,167-title catalog, local API/proxy fixtures, a 20.16-second CC0 MP4, and live Naruto Episode 3 through the AniWave fallback: HLS decoded, playback advanced, and seeking to 60 seconds resumed. WCO's attempt did not start in that companion test. No intro range or caption track was supplied in that live session. Actual Roku/LG/Samsung hardware, codec support, and assistant behavior remain unverified.
