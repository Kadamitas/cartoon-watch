# LG webOS

Install LG's **Developer Mode** app from LG Apps, sign in with your LG Developer account, enable **Dev Mode Status**, and allow the requested reboot. Enable its **Key Server** when retrieving the development key. This is webOS development access, not ADB. Developer Mode has a renewable session; LG removes development apps if it expires. [Official setup](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app).

Install the official webOS CLI, then add the TV interactively and retrieve its displayed key:

```sh
ares-setup-device
ares-novacom --device myTV --getkey
python clients/webtv/package.py --platform lg --package
ares-install --device myTV outputs/lg/tv.cartoonwatch.webos_0.3.0_all.ipk
ares-launch --device myTV tv.cartoonwatch.webos
```

Use your own TV address, device alias, and displayed passphrase. Keep the companion computer on the same network. The app asks for its service address on first launch. [Official CLI guide](https://webostv.developer.lge.com/develop/tools/cli-dev-guide).

The staged app metadata and desktop behavior are validated; no LG hardware test is claimed. Modern webOS models are the target. HLS codec and OS media/voice behavior must be checked on the actual model.
