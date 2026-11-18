# Cartoon Watch for Roku

A native SceneGraph channel for current Roku players and Roku TVs running Roku OS 11 or newer. The channel browses the WCO catalog through the computer companion, opens series and episode lists, searches, filters categories, sorts A–Z or Z–A, and remembers playback positions. Only 60 catalog records are requested at a time. Network requests run in a Task so they do not block the remote interface.

Roku cannot run the Android APK or a general website browser. Keep the [companion service](../../companion/) running on a computer on the same home network. It resolves compatible media and streams it to Roku. If the native player rejects a stream, the client asks the companion to try another provider. Provider selection and media links stay internal.

The companion requires Node 22+, Python 3, and a JDK with `java` and `javac` available. From `companion`, run `npm ci`, `npm run setup`, and `npm start`. Keep its terminal open and use the printed **TV service address**.

## Install

1. Enable **Roku Developer Mode**. On the remote press **Home three times, Up twice, Right, Left, Right, Left, Right**. Record the displayed device address, enable the development installer, read the developer agreement, set your own developer password, and let Roku restart. Roku uses Developer Mode rather than ADB debugging. Follow [Roku's setup instructions](https://developer.roku.com/dev/docs/developer-setup).
2. From the repository root run `python clients/roku/build.py`. This creates `outputs/Cartoon-Watch-Roku.zip` with the manifest at the archive root.
3. Open the Roku's displayed HTTP address in your browser. Sign in as **rokudev** with the password you chose, upload the ZIP, and install it. Roku allows one sideloaded developer channel; this replaces an existing sideloaded channel.
4. Launch Cartoon Watch and enter the **companion computer's address** shown by the service, such as `http://YOUR-COMPUTER:8765`. This is different from the Roku's address. The value is saved on that Roku and can be changed under **Service address**. Allow the companion through the computer firewall for your private home network.

Alternatively, after enabling Developer Mode, explicitly install with `python clients/roku/deploy.py --device YOUR-ROKU-IP --install`. The script builds the ZIP and prompts for the password without echoing it. It uses HTTP Digest authentication. `ROKU_DEV_PASSWORD` may supply the password for your local process; never commit it. Omitting `--install` only builds the package.

## Remote and voice

Use arrows and OK to browse. Left from the first card column opens the menu; Right returns to the grid. Back returns from episodes or stops playback. The native video player supplies play/pause, seeking and its caption controls. Press Up when **Skip intro** appears, then OK. Intro skipping is offered only inside an actual interval supplied by a source.

Search uses Roku's voice-capable standard keyboard. With a supported Roku voice remote or mobile app, playback transport events handle pause/resume, replay, relative seek, start over, next episode, and available intro skipping. Next uses episode numbers and season information, so descending catalog order does not play the wrong episode. Roku's [voice transport interface](https://developer.roku.com/dev/docs/transport-controls) supplies these events; this repository does not register a global Roku Search catalog or voice launch feed.

Native playback depends on Roku-supported HLS/MP4 media and codecs. Embedded captions are handled by Roku; supported SRT/TTML/DFXP sidecars are passed through. Browser-only players and incompatible media may remain unavailable.

Catalog cards use small series/movie cover URLs supplied by the companion. **Artwork credits** in the menu lists TVmaze and anime-offline-database source/license links. Roku does not capture private episode frames; it uses the series-cover fallback where available. [Artwork notice](../../app/src/main/assets/ARTWORK-NOTICE.txt)

## Validate on a computer

Run `npm ci` and `npm run check` from `clients/roku`, then run `python clients/roku/tests/test_tooling.py` from the repository root. Validation compiles BrightScript/SceneGraph, executes transport and episode-selection logic in the BrightScript interpreter, checks the archive, and exercises upload against a local Digest-authenticated fixture. No Roku is contacted by these checks.

PC validation does not emulate Roku rendering, codecs, spoken voice recognition, or the device installer. Those require a real Roku. This client has not yet been tested on Roku hardware.
