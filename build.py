import argparse
import hashlib
import os
import platform
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent
WORK = ROOT / "work"
GOOGLE = "https://dl.google.com/android/repository/"
ARCHIVES = {
    "windows": ("build-tools_r35_windows.zip", "af059bb67cf7786f45ee0db85e2d24985df1b4b6", "platform-tools_r37.0.3-win.zip", "b3fde5239ad89229d5a9178375b81c9887a24172"),
    "linux": ("build-tools_r35_linux.zip", "2cfaa0bbb2336e9ec18ed3ecea84fa2e2af607bc", "platform-tools_r37.0.3-linux.zip", "e1579b288a7ae4e9bc28dedec6a154d78b3c04ed"),
    "macosx": ("build-tools_r35_macosx.zip", "93ab8ce91230e067b5add4bfa79919c52b27f072", "platform-tools_r37.0.3-darwin.zip", "eca4effbe35f4968139b051bbb16753302a3c33c"),
}
LIBRARIES = (
    ("jsoup-1.18.3.jar", "https://repo.maven.apache.org/maven2/org/jsoup/jsoup/1.18.3/jsoup-1.18.3.jar", "5be1ccd3228ae5fd6eed1bd6d827bac2bc65b91c20e9957d16ea65f739f15302"),
    ("webkit-1.12.1.aar", "https://dl.google.com/dl/android/maven2/androidx/webkit/webkit/1.12.1/webkit-1.12.1.aar", "18a0a51ad129e0c8563f031d46c8a7e61169f56ae84e562a0d75686941262111"),
)


def host():
    names = {"Windows": "windows", "Linux": "linux", "Darwin": "macosx"}
    result = names.get(platform.system())
    if result is None:
        raise RuntimeError("Build on Windows, macOS, or Linux with a supported Android SDK.")
    if result == "linux" and platform.machine().lower() not in ("x86_64", "amd64"):
        raise RuntimeError("Google SDK 35 Linux build tools require an x86-64 host.")
    return result


def digest(path, algorithm="sha256"):
    value = hashlib.new(algorithm)
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def download(url, destination, expected, algorithm="sha256"):
    destination = Path(destination)
    if destination.is_file() and digest(destination, algorithm) == expected:
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".part")
    print("Downloading", destination.name, flush=True)
    try:
        with urllib.request.urlopen(url, timeout=60) as response, temporary.open("wb") as output:
            shutil.copyfileobj(response, output)
        if digest(temporary, algorithm) != expected:
            raise RuntimeError("Checksum mismatch for " + destination.name)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination


def extract(archive, destination):
    destination = Path(destination).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as source:
        for entry in source.infolist():
            target = (destination / entry.filename).resolve()
            if target != destination and destination not in target.parents:
                raise RuntimeError("Archive entry leaves its destination")
            source.extract(entry, destination)
            mode = (entry.external_attr >> 16) & 0o777
            if mode and os.name != "nt":
                target.chmod(mode)


def sdk_root(explicit=None):
    if explicit:
        return Path(explicit).expanduser().resolve()
    for name in ("ANDROID_SDK_ROOT", "ANDROID_HOME"):
        if os.environ.get(name) and Path(os.environ[name]).is_dir():
            return Path(os.environ[name]).resolve()
    return WORK / "android-sdk"


def native(root, name):
    return Path(root) / (name + (".exe" if os.name == "nt" else ""))


def executable(path):
    path = Path(path)
    if os.name != "nt":
        path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return path


def ensure_adb(sdk=None):
    sdk = sdk_root(sdk)
    adb = native(sdk / "platform-tools", "adb")
    if not adb.is_file():
        values = ARCHIVES[host()]
        archive = download(GOOGLE + values[2], WORK / "downloads" / values[2], values[3], "sha1")
        extract(archive, sdk)
    return executable(adb)


def ensure_tools(sdk=None):
    sdk = sdk_root(sdk)
    values = ARCHIVES[host()]
    candidates = [sdk / "build-tools" / name for name in ("35.0.0", "android-15")]
    tools = next((path for path in candidates if native(path, "aapt2").is_file() and (path / "lib/d8.jar").is_file()), None)
    if tools is None:
        archive = download(GOOGLE + values[0], WORK / "downloads" / values[0], values[1], "sha1")
        extract(archive, sdk / "build-tools")
        tools = next((path for path in candidates if native(path, "aapt2").is_file()), None)
    if tools is None:
        raise RuntimeError("SDK archive did not contain Android build tools 35")
    android = sdk / "platforms/android-35/android.jar"
    if not android.is_file():
        archive = download(GOOGLE + "platform-35_r02.zip", WORK / "downloads/platform-35_r02.zip", "0bb560a90a7a2cbd0dd8348224d518b638fe7949", "sha1")
        extract(archive, sdk / "platforms")
    adb = ensure_adb(sdk)
    libraries = WORK / "libs"
    libraries.mkdir(parents=True, exist_ok=True)
    jsoup = download(LIBRARIES[0][1], libraries / LIBRARIES[0][0], LIBRARIES[0][2])
    webkit_archive = download(LIBRARIES[1][1], WORK / "downloads" / LIBRARIES[1][0], LIBRARIES[1][2])
    webkit = libraries / "webkit-1.12.1.jar"
    expected = "b03291b19348fdb4e7c5a97b316a19d71a583f45e68fd2b9ea2ea0a867e25cad"
    if not webkit.is_file() or digest(webkit) != expected:
        with zipfile.ZipFile(webkit_archive) as source:
            webkit.write_bytes(source.read("classes.jar"))
        if digest(webkit) != expected:
            raise RuntimeError("WebKit classes checksum mismatch")
    for name in ("aapt2", "zipalign"):
        executable(native(tools, name))
    return sdk, tools, android, [jsoup, webkit], adb


def run(arguments, **options):
    try:
        return subprocess.run([str(value) for value in arguments], check=True, **options)
    except OSError as error:
        raise RuntimeError("Could not run SDK/JDK tool. Check host architecture and native SDK compatibility: " + str(error)) from error


def jdk():
    java = shutil.which("java")
    if not java:
        raise RuntimeError("Install a full JDK 17 or newer and put java on PATH.")
    result = run([java, "-XshowSettings:properties", "-version"], capture_output=True, text=True)
    settings = result.stdout + result.stderr
    home = re.search(r"(?m)^\s*java\.home\s*=\s*(.+)$", settings)
    version = re.search(r"(?m)^\s*java\.specification\.version\s*=\s*(\d+)", settings)
    if not home or not version or int(version[1]) < 17:
        raise RuntimeError("A full JDK 17 or newer is required.")
    directory = Path(home[1].strip()) / "bin"
    commands = {name: native(directory, name) for name in ("java", "javac", "keytool")}
    if not all(path.is_file() for path in commands.values()):
        raise RuntimeError("The selected Java installation must include javac and keytool.")
    return commands


def build(sdk=None, output=None):
    commands = jdk()
    sdk, tools, android, libraries, adb = ensure_tools(sdk)
    directory = (WORK / "build-portable").resolve()
    if directory.parent != WORK.resolve():
        raise RuntimeError("Unexpected generated build directory")
    if directory.exists():
        shutil.rmtree(directory)
    classes, generated, dex = [directory / name for name in ("classes", "generated", "dex")]
    for path in (classes, generated, dex):
        path.mkdir(parents=True)
    output = Path(output).resolve() if output else ROOT / "outputs/Cartoon-Watch.apk"
    output.parent.mkdir(parents=True, exist_ok=True)
    key = WORK / "CartoonWatch-debug.keystore"
    if not key.is_file():
        run([commands["keytool"], "-genkeypair", "-keystore", key, "-storepass", "android", "-keypass", "android", "-alias", "cartoonwatch", "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000", "-dname", "CN=Cartoon Watch Local Development,O=Cartoon Watch,C=US"])
    resources, unsigned, aligned = [directory / name for name in ("resources.zip", "unsigned.apk", "aligned.apk")]
    aapt = native(tools, "aapt2")
    print("Compiling Android resources", flush=True)
    run([aapt, "compile", "--dir", ROOT / "app/src/main/res", "-o", resources])
    run([aapt, "link", "-o", unsigned, "-I", android, "--manifest", ROOT / "app/src/main/AndroidManifest.xml", "--java", generated, "-A", ROOT / "app/src/main/assets", resources])
    sources = list((ROOT / "app/src/main/java").rglob("*.java")) + list(generated.rglob("*.java"))
    source_list = directory / "sources.txt"
    source_list.write_text("\n".join('"' + path.as_posix().replace('"', '\\"') + '"' for path in sources), encoding="utf-8")
    boot = os.pathsep.join(str(path) for path in (android, tools / "core-lambda-stubs.jar"))
    print("Compiling Java sources", flush=True)
    run([commands["javac"], "-encoding", "UTF-8", "-source", "8", "-target", "8", "-bootclasspath", boot, "-classpath", os.pathsep.join(map(str, libraries)), "-d", classes, "@" + str(source_list)])
    class_jar = directory / "classes.jar"
    with zipfile.ZipFile(class_jar, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in classes.rglob("*.class"):
            archive.write(path, path.relative_to(classes).as_posix())
    print("Packaging and signing APK", flush=True)
    run([commands["java"], "-cp", tools / "lib/d8.jar", "com.android.tools.r8.D8", "--min-api", "23", "--lib", android, "--output", dex, class_jar, *libraries])
    dex_files = list(dex.glob("*.dex"))
    if not dex_files:
        raise RuntimeError("D8 produced no bytecode")
    with zipfile.ZipFile(unsigned, "a", zipfile.ZIP_DEFLATED) as archive:
        for path in dex_files:
            archive.write(path, path.name)
    run([native(tools, "zipalign"), "-p", "-f", "4", unsigned, aligned])
    signer = [commands["java"], "-jar", tools / "lib/apksigner.jar"]
    run([*signer, "sign", "--ks", key, "--ks-key-alias", "cartoonwatch", "--ks-pass", "pass:android", "--key-pass", "pass:android", "--v1-signing-enabled", "true", "--v2-signing-enabled", "true", "--out", output, aligned])
    run([*signer, "verify", "--verbose", output])
    run([native(tools, "zipalign"), "-c", "4", output])
    output.with_name(output.name + ".sha256").write_text(digest(output) + "  " + output.name + "\n", encoding="utf-8")
    print("Built", output, flush=True)
    return output


def main():
    parser = argparse.ArgumentParser(description="Build Cartoon Watch with verified Android SDK tools.")
    parser.add_argument("--sdk-root")
    parser.add_argument("--output")
    parser.add_argument("--tools-only", action="store_true")
    arguments = parser.parse_args()
    if arguments.tools_only:
        sdk, tools, android, libraries, adb = ensure_tools(arguments.sdk_root)
        print("Android SDK ready; ADB:", adb)
    else:
        build(arguments.sdk_root, arguments.output)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, OSError, zipfile.BadZipFile) as error:
        print("Build failed:", error, file=sys.stderr)
        raise SystemExit(1)
