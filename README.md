# Cartoon Watch

![Cartoon Watch](branding/banner.svg)

A TV app for finding cartoons and anime, choosing episodes, and watching with your remote. Home shows weekly anime discovery; genre lists help you find all-time favorites. Search, My List, and automatic matching playback fallbacks are included.

## Quick start: Windows + Fire TV, Android TV, or Google TV

You need a Windows computer, your TV, and its remote. **No coding, Codex, Claude, Python, Java, or Android Studio is needed.** The Windows setup ZIP includes the app. The setup window gets the Android connection tools for you.

1. **Download [Cartoon Watch Windows Setup](https://github.com/Kadamitas/cartoon-watch/releases/latest/download/Cartoon-Watch-Windows-Setup.zip).** Right-click the downloaded ZIP → **Extract All**, then open the extracted folder. Do not run setup from inside the ZIP.
2. **Put the computer and TV on the same home network.** Wi-Fi or a cable is fine. Keep the TV awake while installing.
3. **Turn on developer access on the TV.** On **Fire TV**, open Settings → My Fire TV or Device & Software → About. Select the device name **seven times**. Go back → Developer Options → turn **ADB Debugging** on. On **Android TV/Google TV**, open Settings → System or Device Preferences → About, select **Build / Android TV OS build seven times**, then go back → Developer Options → enable **USB debugging** or **Wireless debugging**, whichever your TV offers.
4. **Find this TV's address.** Fire TV shows its IP address under About → Network; add **`:5555`** after that address. Android TV/Google TV usually shows its address under Network & Internet → your current network. For **Wireless debugging**, use its displayed **IP address and connection port**. Each TV has its own address.
5. **Double-click `Setup-Cartoon-Watch.cmd`.** Choose **Fire TV** or **Android / Google TV**, then enter the TV's numeric address followed by `:` and its connection port. For Google TV pairing, open **Pair device with pairing code** on the TV, enter that screen's separate **Pairing address** and six-digit **Pairing code** in the setup window, and click **Pair Google TV**. Keep the main connection address in the TV address box; the two ports can differ.
6. **Connect, then install.** Click **Check / Connect**. When the TV asks **Allow USB debugging?**, choose **Allow**; use “Always allow” only for your own trusted computer. Click **Check / Connect** again after approval. When your TV's model appears, click **Install Cartoon Watch**. A normal update keeps your saved app data; setup stops if a different signing key prevents an update.
7. **Open Cartoon Watch from your TV's apps.** On Fire TV, highlight its CW icon, **hold Select/OK**, then choose **Move to front** if offered, or use **Move** to place it where you want. You can turn ADB debugging off after setup; turn it back on when you want to install an update.

If you already used **Code → Download ZIP** on [the project page](https://github.com/Kadamitas/cartoon-watch), extract that ZIP and use the same setup file. That version downloads the published app from GitHub Releases because it does not include an APK.

Download only from this repository or its [GitHub Releases](https://github.com/Kadamitas/cartoon-watch/releases). If Windows SmartScreen shows an unknown-publisher warning, check the GitHub source before continuing. Do not turn off antivirus or ignore a reported threat. The setup window checks download hashes; a matching hash confirms the file matches the published download, not a trusted-publisher certificate or a guarantee that the app or streaming websites are risk-free.

## Other TVs and platform details

| Your TV | Setup guide | Computer needed while watching? |
| --- | --- | --- |
| Compatible Fire OS, Android TV, Google TV | Windows quick start above, or the developer instructions below | No |
| Roku | [Roku setup](clients/roku/README.md): Roku Developer Mode and development installer | Yes, run the companion |
| LG webOS | [LG setup](clients/lg/README.md): LG Developer Mode and webOS tools | Yes, run the companion |
| Samsung Tizen | [Samsung setup](clients/samsung/README.md): TV Developer Mode, Tizen tools, and your certificate | Yes, run the companion |

The Windows APK installer supports compatible Android-based TVs, including Fire OS, Android TV, and Google TV, on Android API 23 or newer. Roku, LG, and Samsung need their own clients and developer setup; the Android APK does not run on them. The Android app embeds provider players. Roku/LG/Samsung use native playback through a **computer companion on the same LAN**, which must stay running. Their streams must be compatible with the actual device's codecs and player. The Android/Fire TV path has physical-device verification; other clients have the desktop/interpreter/mock checks described in their READMEs. They have not been verified on physical Roku, LG, or Samsung hardware.

### Fire OS, Android TV, and Google TV: enable ADB first

Enable **Developer Options and ADB debugging**, then accept the computer's authorization popup on the TV.

- **Fire OS:** Settings → My Fire TV or Device & Software → About. If Developer Options is hidden, select the device name seven times. Return to Developer Options → ADB Debugging. Find the current address under About → Network. [Amazon instructions](https://developer.amazon.com/docs/fire-tv/connecting-adb-to-device.html)
- **Android TV/Google TV:** Settings → System or Device Preferences → About → Android TV OS build/Build. Select it seven times, then enable USB or Wireless debugging in Developer Options. Menu names vary by manufacturer. [Android TV instructions](https://developer.android.com/training/tv/get-started/create)
- Wireless debugging can require `adb pair ADDRESS:PAIRING_PORT`, followed by connection to a different displayed port. Use the values on your TV; do not assume every TV uses port 5555. [Wireless debugging](https://developer.android.com/tools/adb#connect-to-a-device-over-wi-fi)

No Google Play services are required. The APK does not run on Vega OS, Roku, webOS, or Tizen; use the corresponding separate client where available.

### Roku, LG, and Samsung: use their own developer access

These platforms do **not** use Android ADB. Follow the [Roku](clients/roku/README.md), [LG](clients/lg/README.md), or [Samsung](clients/samsung/README.md) setup instructions. LG requires its Developer Mode app/account and displayed development key. Samsung requires a device-authorized signing certificate. Keep passwords, keys, and certificates local.

## Anime categories and cartoon collections

Home starts with **Trending this week**, based on AniList community activity over seven complete UTC days. Cards open confidently matched WCO series. The feed refreshes as community activity changes, so a new season can bring a series into view. It is a discovery feed, not a universal count of video views, and a trending season does not guarantee that WCO has added every new episode.

**Anime categories** has 20 specific choices, starting with Isekai. They include Battle Shonen, Fighting, Slice of Life, Reincarnation, Mecha, Magical Girls, Iyashikei, Rom-Com, School Life, Seinen, Shoujo, Josei, Supernatural, Psychological, Samurai, Sports & Competition, Dungeon Adventures, Game Worlds, and Reverse Isekai. Fighting uses AniList's Martial Arts tag. These lists use all-time AniList list popularity, not review scores or video views. The app keeps up to 20 weekly matches and 50 category matches, so results beyond the first row remain available.

**Cartoon collections** has eight hand-picked groups: Cartoon essentials, Big adventures, Heroes & team-ups, Mystery cartoons, Adult animation, Weird & funny, Retro cartoons, and Fantasy worlds. Essentials includes the original Teen Titans, Avatar: The Last Airbender, and the original Scooby-Doo. Adult animation includes Family Guy and South Park. These are curated WCO series ordered by TVmaze ratings, with the snapshot date shown; they are not a worldwide popularity chart. The small bundled snapshot covers 112 series across 149 collection entries, with no added image files. TVmaze rating metadata is credited under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). [Metadata notice](app/src/main/assets/ARTWORK-NOTICE.txt)

AniList feeds refresh daily through a 24-hour cache. Home checks hourly while visible and when the app returns to the foreground, using saved data until a refresh is due. Weekly rankings update from the free API without needing another APK update. During an outage, a saved feed may remain available for up to seven days; it is marked as saved and keeps its original date period. Cartoon collections keep their dated bundled ratings snapshot. With no usable feed, Home offers a neutral browse prompt instead of featuring the first alphabetical title. **View all** expands a selected discovery collection; **Browse all** opens the full WCO catalog, with search and alphabetical sorting available. Movies and the Dubbed anime, Subbed anime, Cartoons, and OVA catalog types remain available. No local watch history is sent to AniList. [Activity definition](https://docs.anilist.co/reference/object/mediatrend), [popularity definition](https://docs.anilist.co/reference/object/media), [API terms](https://docs.anilist.co/guide/terms-of-use).

Developers can run `python tools/refresh_discovery.py --check` to validate the cartoon snapshot offline, or `--refresh` to update only its curated TVmaze show IDs with bounded requests. Running it without either flag rebuilds from cached or bundled metadata. TVs do not download the full TVmaze catalog to build these collections.

## Developer setup and manual installation

The rest of this setup section is for people who want to build or customize the app. You can use the Windows quick start without these tools.

The main catalog contains **16,167 unique public WCO links** from the November 17, 2026 snapshot. Android imports it into SQLite and renders 60 titles per page. Movies, cartoons, anime, and OVA are searchable together; episode lists and playback remain live.

### Build Android from source

Install Python 3.10+ and a full JDK 17+ (Java 22 is locally tested), then:

```sh
git clone https://github.com/Kadamitas/cartoon-watch.git
cd cartoon-watch
python build.py
```

Use `python3` if that is your system's Python command. The builder supports official SDK packages for Windows, macOS, and x86-64 Linux. Windows is the locally exercised host path; macOS needs a compatible SDK native runtime for its architecture.

Checksum-verified SDK 35 tools, jsoup, and AndroidX WebKit are cached in `work/`. The builder aligns, signs, and verifies `outputs/Cartoon-Watch.apk`. Select an existing SDK with `--sdk-root PATH`, `ANDROID_SDK_ROOT`, or `ANDROID_HOME`. `python build.py --tools-only` prepares dependencies without compiling.

Windows users can also run `powershell -ExecutionPolicy Bypass -File .\build.ps1`.

### Inspect and install Android manually

```sh
python install.py --inspect --device YOUR_TV_ADDRESS:CONNECT_PORT
python install.py --device YOUR_TV_ADDRESS:CONNECT_PORT --no-build
```

If exactly one intended authorized device is connected, `--device` can be omitted. The installer checks the actual model, API level, ABI, display, density, and WebView. It does not scan the LAN or select among multiple TVs. If authorization is missing, approve the TV's prompt and rerun. Omit `--no-build` to build before installation.

A fresh clone creates its own local development signing key. Keep `work/CartoonWatch-debug.keystore` for updates on that installation. A different developer's or fresh CI key cannot update an APK signed by another key; the installer never uninstalls it or erases data automatically.

### Run Roku, LG, or Samsung

Install Node 22+, Python 3.10+, and a JDK, then start the computer companion:

```sh
cd companion
npm install
npm run setup
npm start
```

Keep it running and enter its printed **TV service address** in the client. The default port is 8765. Use the computer's LAN address, not `localhost` on the TV. Allow access only on your intended private network; do not expose the companion or developer installers publicly.

From the repository root:

- **Roku:** `python clients/roku/build.py` creates `outputs/Cartoon-Watch-Roku.zip`. Install through the TV's development installer. [Full setup](clients/roku/README.md)
- **LG/Samsung:** `python clients/webtv/package.py` stages both clients. Packaging and deployment require the respective LG CLI or Tizen SDK/certificate. [Shared client](clients/webtv/README.md), [LG setup](clients/lg/README.md), [Samsung setup](clients/samsung/README.md)

## Optional coding agents and voice

Codex and Claude are optional helpers for editing the project; they are not needed to use the Windows setup window. If you want an agent to customize or build it, open the cloned folder in Codex and ask it to set up Cartoon Watch on your TV; [AGENTS.md](AGENTS.md) defines the workflow. [CLAUDE.md](CLAUDE.md) directs Claude Code to the same instructions. Each person must identify their own TV platform, enable its developer access, and approve their own pairing/authorization prompts.

Native media controls and supported voice-keyboard entry are preserved. Samsung's optional in-app VoiceInteraction support is runtime-detected. Voice playback transport depends on the platform's routing; global assistant catalog search is not automatically registered. No separate Amazon Developer account, custom Alexa skill, cloud bridge, tunnel, hosting plan, or subscription is required. The companion runs locally on your private LAN.

## Controls and maintenance

Arrows/Select browse; Back returns. During Android playback, **Select pauses or resumes** when the toolbar is closed and the manual cursor is off. A focused center Pause/Resume button appears when playback starts and when controls are shown. **Menu** opens the toolbar. The manual cursor starts off; enable it from Menu when you need a site-specific control. **Skip intro** uses the selected player's actual control or valid timing data, including nested players; no fixed duration is guessed. Native-client remote controls are documented per platform.

The catalog has no global header bar, count strip, provider/source switch, or search header. Use **Search** in the sidebar and the **Anime / Cartoons / Movies** content chips. Layout and safe insets follow the actual viewport and resize automatically; no TV picture-setting change is required.

Where the site exposes compatible player controls, Cartoon Watch selects its highest offered rendition. Quality depends on the source and supported codecs; UHD requires a real 2160p rendition. The decoded video size is reported from the actual player. PC quality checks passed against supported player interfaces; a live Naruto episode 3 source offered only an 800p, 1056×800 rendition, not UHD.

If WCO fails or stalls, matching fallback playback is attempted automatically. Matching includes the title, known release year, season, and episode; ambiguous matches are rejected. Known ad hosts, popups, redirects, and identified promotional interruptions are blocked where the platform supports it. Captions, fullscreen, skip data, resume, native codec compatibility, and source availability vary.

Use `python tools/refresh_catalog.py` to refresh the public WCO title lists. Keep imports streaming, pages bounded, and code comment-free. Preserve [dependency notices](app/src/main/assets/NOTICE.txt). Never commit generated SDKs, signing keys, ADB credentials, device-specific private data, or local configuration. The repository contains metadata and code, not video files.

## Covers and episode thumbnails

Series keep their own poster artwork. The bundled URL-only snapshot contains confidently matched covers for **6,874 series and 1,329 movies** from TVmaze and anime-offline-database. Anime feeds also supply larger posters and genuine promotional banners from AniList. Featured titles use a wide banner where available, with a contained poster when one is missing; portrait covers are never stretched across the featured area. Shelves show whole portrait posters, while watched episodes retain their private landscape frames. Matching keeps known release years distinct and does not guess among remakes. Unavailable or ambiguous matches retain the CW placeholder. [Artwork sources and licenses](app/src/main/assets/ARTWORK-NOTICE.txt)

No posters or banners are bundled. Their compressed URL/credit metadata adds about **140 KiB** to the catalog. Visible artwork loads on demand. Native Android stores posters within 320×480 pixels and backdrops within 960×540 pixels at JPEG quality 75, with one 16 MiB/256-file cache and a 1 MiB download limit per image. Common poster downloads are around 30–55 KB. Sharper artwork does not add image files to the APK.

On supported players, watched episode thumbnails show a small frame captured when pausing or leaving playback normally. Each episode keeps one private thumbnail; the series cover stays separate. Android frames preserve the video aspect ratio within 160×90 pixels at JPEG quality 55, with a 1 MiB/64-frame cache. Capture uses the app's visible SurfaceView/TextureView video layer when available, with a Window fallback. HTML5 LG/Samsung players use 192×108 frames within a private 1 MiB limit. Missing frames, unsupported capture, or abrupt termination fall back to the series cover. Samsung AVPlay and Roku use the cover fallback. No captured frame is uploaded, bundled, or committed.

**Clear history** also clears private episode thumbnails while preserving My List and static cover artwork. These limits keep image storage bounded. On the tested Fire TV, pause and a normal Home exit saved an actual 119x90 video frame (3.3 KB in the pause test). Resuming invalidated the old frame; a forced process stop then correctly fell back to the series cover after restart. Other TV hardware and native codecs still need device verification.

To rebuild artwork URLs on a development computer, run `python tools/enrich_artwork.py`. It caches source metadata under `work/`, uses small image URLs, rejects ambiguous matches, preserves WCO catalog identity, and enforces a 250 KiB compressed metadata budget. The first run downloads metadata, not cover files; it requires no account or API key. `--refresh` refreshes source metadata, while `--anime PATH` and `--tvmaze PATH` reuse existing JSON inputs. `python tools/enrich_artwork.py --check` checks the current artwork without network requests. Catalog refresh preserves existing cover URLs and all attribution fields; run enrichment again to add newly matchable titles.

Earlier physical Fire TV checks passed on Android API 30/Amazon WebView 142: the 16,167-title catalog, Naruto episode 3 playback after a controlled WCO failure, OS media-session pause/play and ten-second seeking, source-button intro skipping, and local search-intent filtering. Spoken assistant commands were not tested. Roku compiled and passed interpreter checks; LG/Samsung passed desktop and SDK-mock checks only.

To check the shared UI after installing the companion's dependencies/browser, run `node tests/ui.cjs` from the repository root. It validates paging, filters, episode payloads, focus, and stale-response handling with the real catalog snapshot and a captured detail fixture. It does not claim live playback. `python tools/refresh_catalog.py --check` validates the bundled snapshot without network requests. Client READMEs describe their platform checks.

Additional PC checks: `node tests/header-layout.cjs` covers responsive bounds, focus, scrolling and resizing from 640×360 through 3840×2160; `node tests/artwork-ui.cjs` covers private episode frames, static covers, clearing history and stale responses; `node tests/quality.cjs` covers actual offered-quality selection with player fixtures. These checks do not prove physical-TV capture or UHD availability.

Earlier Fire TV checks also passed Select-to-pause/resume with the highlighted center control and private-frame cleanup through Clear history. The tested Naruto server offered only 800p (1056x800), which was selected and decoded normally; this is not a physical UHD playback test.
