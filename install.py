import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import build

ROOT = Path(__file__).resolve().parent
PACKAGE = "tv.cartoonwatch.app"
SETUP = "For Android/Fire OS, enable Developer Options and ADB debugging on the TV first, then accept its authorization popup. See README.md, step 1."


def adb_command(path):
    return [sys.executable, str(path)] if str(path).endswith(".py") else [str(path)]


def execute(command, *arguments, timeout=20, required=True):
    result = subprocess.run([*command, *map(str, arguments)], capture_output=True, text=True, timeout=timeout)
    if required and result.returncode:
        raise RuntimeError((result.stderr or result.stdout).strip() or "ADB command failed")
    return result.stdout.strip()


def devices(output):
    return [(match[1], match[2]) for line in output.splitlines() if (match := re.match(r"^(\S+)\s+(device|unauthorized|offline)\b", line))]


def address(value):
    if re.fullmatch(r"[^\s:]+:\d+", value) or value.startswith("["):
        return value
    try:
        ip = ipaddress.ip_address(value)
        return f"[{ip}]:5555" if ip.version == 6 else f"{ip}:5555"
    except ValueError:
        return value


def select_device(command, requested):
    current = devices(execute(command, "devices", "-l"))
    selected = address(requested) if requested else None
    if selected and not any(serial == selected for serial, state in current):
        if ":" in selected:
            print(execute(command, "connect", selected, required=False))
            current = devices(execute(command, "devices", "-l"))
    if selected:
        state = next((state for serial, state in current if serial == selected), None)
        if state == "unauthorized":
            raise RuntimeError(SETUP + " Choose Allow on the TV, then rerun this command.")
        if state != "device":
            raise RuntimeError(SETUP + " Check the TV address/port; newer wireless debugging can require adb pair and a different connect port.")
        return selected
    if len(current) == 1 and current[0][1] == "device":
        return current[0][0]
    if any(state == "unauthorized" for serial, state in current):
        raise RuntimeError(SETUP + " Choose Allow on the intended TV, then rerun with --device SERIAL.")
    if len(current) > 1:
        raise RuntimeError("Multiple ADB devices are present. Choose the intended TV with --device SERIAL.\n" + "\n".join(serial + " " + state for serial, state in current))
    discovery = execute(command, "mdns", "services", required=False)
    suffix = "\nDiscovered ADB services:\n" + discovery if discovery else ""
    raise RuntimeError(SETUP + " Connect USB or provide --device ADDRESS:CONNECT_PORT; no network scanning is performed." + suffix)


def inspect_device(command, serial):
    prefix = ["-s", serial, "shell"]
    def prop(name):
        return execute(command, *prefix, "getprop", name)
    result = {
        "manufacturer": prop("ro.product.manufacturer"),
        "model": prop("ro.product.model"),
        "androidVersion": prop("ro.build.version.release"),
        "sdk": prop("ro.build.version.sdk"),
        "abi": prop("ro.product.cpu.abi"),
        "display": execute(command, *prefix, "wm", "size", required=False),
        "density": execute(command, *prefix, "wm", "density", required=False),
        "webview": execute(command, *prefix, "dumpsys", "webviewupdate", required=False),
    }
    if not result["sdk"].isdigit():
        raise RuntimeError("This connection did not report an Android SDK level. This installer is for Android/Fire OS only. Use the separate Apple TV or Roku client instructions for those platforms; this APK does not support Vega OS, Tizen, or webOS.")
    result["sdk"] = int(result["sdk"])
    if result["sdk"] < 23:
        raise RuntimeError(f"This device reports Android API {result['sdk']}; Cartoon Watch needs API 23 or newer.")
    return result


def main():
    parser = argparse.ArgumentParser(description=SETUP)
    parser.add_argument("--device", help="Authorized ADB serial or the TV's actual IP:connect-port")
    parser.add_argument("--adb", help="Existing adb executable")
    parser.add_argument("--sdk-root")
    parser.add_argument("--inspect", action="store_true", help="Only inspect the device; do not build/install/launch")
    parser.add_argument("--no-build", action="store_true", help="Install an already built APK")
    parser.add_argument("--apk", default=str(ROOT / "outputs/Cartoon-Watch.apk"))
    arguments = parser.parse_args()
    print(SETUP, flush=True)
    existing = arguments.adb or shutil.which("adb")
    command = adb_command(Path(existing) if existing else build.ensure_adb(arguments.sdk_root))
    serial = select_device(command, arguments.device)
    details = inspect_device(command, serial)
    print(json.dumps(details, indent=2), flush=True)
    if arguments.inspect:
        return
    apk = Path(arguments.apk).resolve()
    if not arguments.no_build:
        build.build(arguments.sdk_root, apk)
    if not apk.is_file():
        raise RuntimeError("APK not found. Run python build.py first or omit --no-build.")
    result = subprocess.run([*command, "-s", serial, "install", "-r", str(apk)], capture_output=True, text=True, timeout=120)
    message = (result.stdout + result.stderr).strip()
    print(message, flush=True)
    if result.returncode or "Success" not in message:
        if "UPDATE_INCOMPATIBLE" in message:
            raise RuntimeError("The installed app uses a different signing key. Keep its original local keystore for updates; this script will not uninstall it or erase data.")
        raise RuntimeError("Installation failed. No uninstall or device-setting changes were attempted.")
    print(execute(command, "-s", serial, "shell", "am", "start", "-n", PACKAGE + "/.MainActivity"))
    print("Cartoon Watch is installed. Test browsing, one episode, remote controls, and fallback playback on this TV.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        print("Setup stopped:", error, file=sys.stderr)
        raise SystemExit(1)
