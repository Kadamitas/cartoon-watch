# LG and Samsung shared client

These packaged TV clients reuse the Android catalog interface and connect to the companion service on the same LAN. The companion resolves WCO playback and its fallbacks; the TV receives a proxied HLS or MP4 stream, not an embedded website.

Start the companion as described in the repository README, then stage both clients:

```sh
python clients/webtv/package.py
```

The generated projects are `work/webtv/lg` and `work/webtv/samsung`. Set the companion address using the TV app's **Connection** button. Use the computer's LAN address shown by the service, not `localhost` on the TV. The computer and service must remain running during playback.

Use the platform instructions in [LG](../lg/README.md) or [Samsung](../samsung/README.md). These platforms do not use Android ADB.

Arrows and Select browse the catalog. During playback, Up shows controls, Down returns to the video, Left/Right seek when the video is focused, and Back returns to the catalog. Captions use supplied subtitle tracks. Skip intro appears only during a valid source-provided intro range. Settings, favorites, and recent viewing are local to the TV.

Standard MediaSession actions and platform media keys handle play, pause, stop, and seeking where the TV exposes them. Voice keyboard entry can fill the focused search field. Samsung's public VoiceInteraction API adds in-app media commands, visible-item selection, and Home/Search/Settings navigation on supported models. Global assistant catalog search and app launching are not registered. No microphone permission or in-app speech service is used.

LG and MP4 playback use the HTML5 video player. Samsung HLS uses AVPlay with asynchronous preparation, native seeking, stream subtitle selection, and plain-text WebVTT captions supplied by the companion. [Samsung AVPlay](https://developer.samsung.com/smarttv/develop/guides/multimedia/media-playback/using-avplay.html), [Samsung voice controls](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/voiceinteraction-api.html).

The shared client and package configurations are tested in a desktop browser with the real WCO catalog and a CC0 MP4 fixture. Samsung AVPlay and voice callbacks have stateful SDK mock coverage. Actual LG and Samsung hardware, native HLS decoding, certificate signing, and assistant integration still require device validation. Older engines and unsupported stream codecs may need a newer TV or an Android streaming device.
