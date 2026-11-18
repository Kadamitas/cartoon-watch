# Voice control

## Fire TV and Google TV

The Android app exposes a standard media session for explicit play, pause, stop, restart, seeking, fast-forward, and rewind while an episode is open. Playback reports supply its real title, duration, position, and paused state. The embedded WebView/player owns audio focus and handles system audio interruptions. The native media session does not request competing audio focus or automatically resume a paused player. This integration needs no developer account, custom Alexa skill, cloud bridge, subscription, or new service.

On Fire TV, try “Alexa, pause,” “Alexa, resume,” “Alexa, rewind 10 seconds,” and “Alexa, restart” during playback. The TV's Alexa remote/account setup must already work. Cartoon Watch does not request microphone access or record speech. Amazon documents media-session transport support for both the voice remote and an Alexa device paired with Fire TV. [Amazon transport integration](https://developer.amazon.com/docs/fire-tv/mediasession-api-integration.html).

Google TV can route supported assistant/media commands to the same Android media session. Availability of spoken commands depends on the TV's assistant and account configuration. Standard Android search/play-from-search intents and `cartoonwatch://search?q=Naruto` are local entry points; declaring them does not register a catalog with a platform's global voice search. [Android media-session callbacks](https://developer.android.com/reference/android/media/session/MediaSession.Callback).

Search intents also accept local text commands such as `show cartoons`, `sort z to a`, `play Naruto season one episode three`, `pick episode three`, and `skip intro`. Ordinary title text opens a WCO catalog search. Episode selection uses the real episode list, rejects ambiguous titles or episodes, and never searches alternate catalogs. The app does not provide speech recognition or a microphone button; a TV must supply a compatible system search intent for spoken text to arrive here. Its normal on-screen search remains available.

“Alexa, open Cartoon Watch” and “Alexa, play Naruto on Cartoon Watch” are not promised by a sideloaded APK. Amazon's broader video-skill/catalog integration is separate. Its current documentation limits catalog integration to selected partners and says new VSK partners are not being onboarded. [Amazon VSK status](https://developer.amazon.com/docs/video-skills-fire-tv-apps/introduction.html).

## Lifecycle and verification

`VoiceControls` receives explicit playback callbacks and routes them into the actual nested player. Play and pause each preserve the requested state when repeated. `seekTo` uses milliseconds in Android and seconds inside the web player. Real source skip controls and supplied timing data remain the only intro-skip mechanisms.

The activity starts metadata for the requested episode, accepts progress only from the current playback session, and deactivates its media session when returning to the library. It pauses the player from `onStop`, allowing the transient Alexa voice surface to deliver its command during `onPause`. Returning to the app preserves deliberate pauses. Native focus ownership was removed after device diagnostics showed it competing with the WebView's own focus delegate and pausing a newly started video.

The manifest includes Amazon's media-session permission and metadata plus standard search/play-from-search and local search-link filters. Initial and replacement search intents wait for the local interface to finish initializing.

Device checks can use `adb shell dumpsys media_session` and `adb shell cmd media_session dispatch pause`, then `play`, `fast-forward`, and `rewind`. These verify the OS media-session path, not Alexa's speech recognition or account routing. Confirm actual spoken commands separately with the user's remote. Do not claim an utterance was tested when only an ADB command was sent.

PC validation compiled and signed the Android APK, exercised 12 text-parser cases, filtered the real 16,167-title snapshot, selected Naruto episode 3 from captured source metadata, rejected an unknown season and a synthetic ambiguous title, and kept all catalog requests at 60 records. A stateful cross-origin player fixture verified repeated explicit play/pause, absolute and relative seeks, a real skip-button click, and preservation of a deliberate pause. These fixtures do not prove actual media playback or speech routing on a TV. Local results are in `work/voice-check/transport-results.json`.

Physical Fire TV verification on the final build passed OS media-session pause twice, play twice, fast-forward and rewind by ten seconds, an active session during playback and deactivation on the library. Naruto episode 3 advanced normally after a controlled WCO failure resolved to AniWave. Its actual nested Skip Intro button sought to 90 seconds. A local SEARCH intent filtered Cartoons to 3,047 titles with a 60-record page. These were OS commands and text intents, not spoken Alexa tests.

## Roku, LG, and Samsung

Their clients use the platform player's standard transport/remote integration. They do not use Android permissions or ADB. Voice search, app launch, and spoken content selection require the corresponding platform's supported integration and account setup; desktop client checks are not proof of real-device assistant support.
