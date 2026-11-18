# Samsung Tizen TV

On the TV, open **Apps**, enter **12345** in its settings view to open Developer Mode, enable it, enter your computer's LAN address, and reboot when requested. Install Tizen Studio with the TV and Samsung certificate extensions. This uses Samsung development access, not ADB. [Official TV setup](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html).

Create a Samsung certificate profile and authorize the TV in Tizen Studio's Device Manager. Keep certificate files and passwords outside the repository. Then stage and sign:

```sh
python clients/webtv/package.py --platform samsung --package --certificate YOUR_PROFILE
sdb devices
tizen install -s YOUR_DEVICE_SERIAL --name CartoonWatch.wgt -- outputs/samsung
tizen run -s YOUR_DEVICE_SERIAL -p CtWatchTV1.CartoonWatch
```

Use the actual `.wgt` filename printed by the package command and the device serial shown by `sdb devices`. The app asks for the companion service address on first launch. [Official build, package, install, and run commands](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html).

The client declares Internet, TV media-key, and public voice-control privileges. HLS uses Samsung AVPlay; MP4 uses HTML5 video. On Tizen 6.0 or newer, supported assistants can control playback, seeking, selection, and app navigation while Cartoon Watch is open. Visible-title selection uses the optional 6.5+ content-context methods. Global assistant catalog search is not registered. [Official voice API](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/voiceinteraction-api.html).

The configuration targets Tizen 5.0 or newer, with optional APIs detected at runtime. Desktop behavior, XML, and SDK mock callbacks are validated; signing, native decoding, and actual Samsung hardware remain unverified.
