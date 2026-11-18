import argparse
import getpass
import os
import re
import secrets
import urllib.error
import urllib.request
from pathlib import Path

from build import package


def install(device, archive, password):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]*(?::[0-9]{1,5})?", device):
        raise ValueError("Use the Roku IP address or hostname, with an optional port.")
    address = f"http://{device}/plugin_install"
    manager = urllib.request.HTTPPasswordMgrWithDefaultRealm()
    manager.add_password(None, address, "rokudev", password)
    opener = urllib.request.build_opener(urllib.request.HTTPDigestAuthHandler(manager))
    boundary = "CartoonWatch" + secrets.token_hex(16)
    prefix = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"mysubmit\"\r\n\r\nInstall\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"archive\"; filename=\"Cartoon-Watch-Roku.zip\"\r\n"
        "Content-Type: application/zip\r\n\r\n"
    ).encode()
    body = prefix + Path(archive).read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request(address, body, {"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with opener.open(request, timeout=45) as response:
        result = response.read(1024 * 1024).decode("utf-8", errors="replace")
    if re.search(r"Install (?:Failure|Failed)|Compilation Failed|error compiling", result, re.I):
        raise RuntimeError("The Roku rejected the package. Open its developer portal for the compile result.")
    if not re.search(r"Install Success|Application Received|Identical to previous version", result, re.I):
        raise RuntimeError("The developer portal response did not confirm installation. Check the Roku developer portal.")
    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build or explicitly install the Roku developer channel.")
    parser.add_argument("--device", help="Roku IP address or hostname")
    parser.add_argument("--install", action="store_true", help="Replace the device's single sideloaded developer channel")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[2] / "outputs" / "Cartoon-Watch-Roku.zip")
    args = parser.parse_args()
    if args.install and not args.device:
        parser.error("--install requires --device")
    archive = package(args.output)
    print(f"Built {archive}")
    if args.install:
        password = os.environ.get("ROKU_DEV_PASSWORD") or getpass.getpass("Roku developer password: ")
        try:
            install(args.device, archive, password)
        except (urllib.error.URLError, RuntimeError, ValueError) as error:
            parser.exit(1, f"Installation failed: {error}\n")
        print("Roku developer portal confirmed installation.")
