# Cartoon Watch

## Product and code

Use WCO/WCO Stream as the only main catalog. The bundled snapshot has 16,167 unique public links across dubbed anime, cartoons, subbed anime, movies, and OVA. AniWave, KissAnime, and HDToday are automatic playback fallbacks for the same title, known release year, season, and episode. Reject ambiguous matches; do not turn fallbacks into competing catalogs.

Keep source/media links internal. Use the source's real skip control or valid timing data for intro skipping; never invent a fixed intro duration. Preserve captions, fullscreen, deliberate pauses, and normal provider initialization.

Write concise, performant code without comments. Keep licenses in separate notice files. Use SQLite queries, streaming catalog imports, 60-title pages, bounded caches/network work, cancellation, and stale-session rejection. Do not render the entire catalog or fetch every episode/video during indexing.

Series covers and episode thumbnails are different. Keep a static cover for each matched series/movie. The URL-only artwork snapshot has 6,874 series and 1,329 movie matches with source URLs and credits; never guess ambiguous remakes. Use `tools/enrich_artwork.py` for developer-side metadata refresh, preserve all four image/provenance fields during catalog refresh, and retain `ARTWORK-NOTICE.txt`. No individual episode artwork belongs in the catalog asset.

Watched episodes may keep one device-private frame from pause or normal exit. Use the series cover when capture is unavailable or playback ends abruptly. Native Android frames preserve aspect ratio within 160×90/JPEG55, bounded to 64 files/1 MiB; native covers are at most 240×360/JPEG65, bounded to 256 files/8 MiB. HTML5 LG/Samsung frames are 192×108 with a private 1 MiB limit; Roku/Samsung AVPlay use the series-cover fallback. Clear history must delete private episode frames and history, preserve favorites/static covers, and prevent a resumed-then-abruptly-killed session from reusing a stale thumbnail. Never upload screenshots, commit them, or put them in the public catalog. Use public capture APIs on the app's own visible video layer; SurfaceView/TextureView capture can be needed when Window copying returns a blank frame.

Android playback starts with the manual cursor off. Preserve the prominent, orange-focused center Pause/Resume control and single-Select playback behavior; Menu enables the toolbar and optional manual cursor. Explicit media play/pause must remain idempotent.

Keep the header and focus rings within the actual viewport during scrolling and resizing. Maintain responsive safe insets and verify 640×360, 960×540, 1280×720, 1920×1080 and 3840×2160, including provider refocus after deep catalog scrolling. Do not change TV picture calibration or hardcode one model's scale.

Select the highest quality actually offered through supported site-player APIs or visible quality controls. Keep real decoded dimensions separate from the TV's panel resolution. Never fabricate a 4K rendition or bypass provider access controls; a source offering only 800p remains 800p.

## First action for a new TV

Identify the actual TV platform first. Ask for its model/OS when unknown while preparing independent host work. Never reuse the original TV's private address, port, model, density, or WebView assumptions.

- **Fire OS:** Tell the user to enable Developer Options and ADB Debugging, then accept the TV's computer-authorization popup. If hidden, Settings → My Fire TV or Device & Software → About → select the device name seven times. Find its address under About → Network.
- **Android TV/Google TV:** Tell the user to enable Developer Options by selecting Android TV OS build/Build seven times under About, then enable USB or Wireless debugging and accept authorization. Wireless debugging may require pairing and a different connect port; use the displayed values rather than assuming 5555.
- **Roku:** Use Roku Developer Mode and the development installer, not ADB. Follow `clients/roku/README.md`, obtain the actual Roku address, and keep its developer password private. Installing a development channel can replace an existing sideloaded channel; establish whether one is present before replacing it.
- **LG webOS:** Use LG's Developer Mode app, developer-account login, Dev Mode Status/reboot, Key Server, and the webOS `ares` tools. Follow `clients/lg/README.md`. Account login, displayed key/passphrase, and renewable developer session require the user's participation. No ADB.
- **Samsung Tizen:** Use TV Developer Mode, its requested development-computer address/reboot, Tizen Studio/SDB, and the user's Samsung certificate/device authorization. Follow `clients/samsung/README.md`. Keep certificate files and passwords private. No ADB.

When Android ADB is unauthorized or missing, explicitly explain the enable/Allow steps and wait for the user. Do not repeatedly retry, scan the LAN, guess among devices, or disable unrelated security settings.

Official Android setup: [Amazon](https://developer.amazon.com/docs/fire-tv/connecting-adb-to-device.html), [Android TV](https://developer.android.com/training/tv/get-started/create), [wireless debugging](https://developer.android.com/tools/adb#connect-to-a-device-over-wi-fi). Platform client READMEs link their official Roku/LG/Samsung instructions.

## Build and install

1. Inspect host tools and the intended platform. Android requires Python 3.10+ and a full JDK 17+; Java 22 is the locally exercised build path. The companion requires Node 22+, Python, and Java. Native Roku/LG/Samsung packaging has its own tool requirements.
2. For Android, use `python install.py --inspect --device ADDRESS:CONNECT_PORT` and verify model, API, ABI, display, density, and WebView. Omit `--device` only when exactly one intended authorized device exists. API 23+ is required. Non-Android TVs cannot use this APK; use their separate client rather than flashing/rooting/replacing the TV OS. Vega OS is not an Android APK target.
3. Build and verify on the PC before deployment. Android: `python build.py`, or the existing Windows `build.ps1`. The Python builder supports official Windows/macOS/x86-64 Linux SDK archives; only Windows has local build verification. Use the appropriate client README for Roku, LG, or Samsung.
4. Run checks appropriate to the change: bounded catalog/search, correct episode payloads, actual playback when accessible, pause/seek/captions, source-provided intro skip, cancellation/background handling, and controlled primary-source failure. Distinguish live playback, fixtures, mocks, and physical-device testing.
5. Install Android with `python install.py --device ADDRESS:CONNECT_PORT --no-build`. It uses `adb install -r`. Do not uninstall signature-incompatible apps, erase data, or change unrelated settings automatically. The user's build/install request authorizes ordinary reversible setup; do not add repeated permission gates.
6. For Roku/LG/Samsung, start the LAN companion, obtain the TV's real developer connection, build the client package, and follow its installation/signing instructions. Use the companion's printed LAN service URL, not `localhost` on the TV. Keep the companion running during playback.
7. Validate on the intended device when available. Remove temporary debugging forwards and leave the app at its catalog. Missing pairing, authorization, credentials, or device selection requires the minimum necessary user input while independent preparation continues.

For the shared catalog UI, install the companion's dependencies/browser, then run `node tests/ui.cjs` from the root. It checks real-index-backed UI fixtures at 960×540 and 1920×1080; it does not verify provider streaming. `PLAYWRIGHT_EXECUTABLE_PATH` can select an existing browser. Run `node tests/header-layout.cjs`, `node tests/artwork-ui.cjs` and `node tests/quality.cjs` for responsive layout, thumbnail state and offered-quality fixtures. Use the platform client READMEs for their additional checks.

## Project map and voice

`app/` contains Android Java and the bundled UI. `build.py`/`build.ps1` fetch verified build dependencies; `install.py` inspects/installs Android. `tools/refresh_catalog.py` refreshes the public WCO metadata snapshot; `tools/enrich_artwork.py` maintains small, attributable cover URLs without image assets. `companion/` provides LAN catalog and compatible-stream resolution for `clients/roku/`, `clients/lg/`, and `clients/samsung/`; `clients/webtv/` shares LG/Samsung UI and packaging.

Start the companion with `npm install`, `npm run setup`, and `npm start` from `companion/`. Its default port is 8765; use the actual LAN address it prints. Roku, LG, and Samsung cannot embed the Android website player, so verify the resolved stream's native codec/player compatibility.

Preserve native media/voice transport and voice-keyboard input. Samsung public VoiceInteraction callbacks are optional, runtime-detected APIs. Global assistant catalog search is not automatically registered. Custom Alexa/Amazon skill, account, cloud-bridge, and tunnel integration was cancelled; do not add or claim it. Standard platform playback transport needs no separate Amazon Developer account and depends on platform routing. Keep signing material outside Git. The companion stays on the private LAN and needs no hosted service or subscription.

## Repository and evidence

Generated files belong under `work/` and `outputs/`. Never commit SDKs, node_modules, caches, ADB keys, keystores, certificates, watch history, private device addresses, or credentials. Ignore caches rather than deleting unrelated user files.

A fresh Android clone creates `work/CartoonWatch-debug.keystore`. Keep it locally for subsequent updates. Fresh CI keys cannot replace an installation signed by another key without a deliberate migration. Preserve dependency notices.

The Fire TV/Android path has physical-device verification. Roku/LG/Samsung source, desktop, interpreter, or SDK-mock checks do not prove hardware, native codecs, certificate installation, assistant audio, or store approval. State actual validation and limitations accurately. Do not publish/push unless requested. Source markup, mirrors, ads, and availability change; never promise every title or future revision works.
