import hashlib
import io
import struct
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from xml.etree import ElementTree
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build import package
from deploy import install


class ToolingTests(unittest.TestCase):
    def test_archive_structure(self):
        with tempfile.TemporaryDirectory() as folder:
            output = package(Path(folder) / "channel.zip")
            with ZipFile(output) as archive:
                names = archive.namelist()
                self.assertIn("manifest", names)
                self.assertIn("source/main.brs", names)
                self.assertTrue(all(name == "manifest" or name.startswith(("source/", "components/", "images/")) for name in names))
                self.assertIn("title=Cartoon Watch", archive.read("manifest").decode())
                for name in names:
                    if name.endswith(".xml"):
                        component = ElementTree.fromstring(archive.read(name))
                        for script in component.findall("script"):
                            self.assertIn(script.attrib["uri"].removeprefix("pkg:/"), names)
                for name, size in {"channel": (540, 405), "card": (336, 164), "splash": (1920, 1080)}.items():
                    image = archive.read(f"images/{name}.png")
                    self.assertEqual(image[:8], b"\x89PNG\r\n\x1a\n")
                    self.assertEqual(struct.unpack(">II", image[16:24]), size)

    def test_digest_upload(self):
        received = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                auth = self.headers.get("Authorization", "")
                if not auth:
                    self.send_response(401)
                    self.send_header("WWW-Authenticate", 'Digest realm="Roku Dev", nonce="cartoon-test-nonce", algorithm=MD5, qop="auth"')
                    self.end_headers()
                    return
                values = urllib.request.parse_keqv_list(urllib.request.parse_http_list(auth.removeprefix("Digest ")))
                digest = lambda value: hashlib.md5(value.encode()).hexdigest()
                first = digest("rokudev:Roku Dev:test-secret")
                second = digest("POST:/plugin_install")
                expected = digest(f"{first}:cartoon-test-nonce:{values['nc']}:{values['cnonce']}:auth:{second}")
                if values.get("username") != "rokudev" or values.get("response") != expected:
                    self.send_response(403)
                    self.end_headers()
                    return
                received.append(body)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"<html>Install Success</html>")

        server = HTTPServer(("127.0.0.1", 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with tempfile.TemporaryDirectory() as folder:
                output = package(Path(folder) / "channel.zip")
                self.assertTrue(install(f"127.0.0.1:{server.server_port}", output, "test-secret"))
                self.assertEqual(len(received), 1)
                body = received[0]
                self.assertIn(b'name="mysubmit"\r\n\r\nInstall', body)
                self.assertIn(b'name="archive"; filename="Cartoon-Watch-Roku.zip"', body)
                with ZipFile(io.BytesIO(body[body.index(b"PK\x03\x04"):body.rindex(b"\r\n--")])) as archive:
                    self.assertIn("manifest", archive.namelist())
        finally:
            server.shutdown()
            server.server_close()
            worker.join(2)

    def test_build_does_not_deploy(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "channel.zip"
            result = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / "deploy.py"), "--device", "192.0.2.1", "--output", str(output)], capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(output.exists())
            self.assertNotIn("confirmed installation", result.stdout)


if __name__ == "__main__":
    unittest.main()
