"""Local viewer server with byte ranges for seeking in large videos."""

import argparse
import json
import re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from viewer_catalog import catalog, dataset


class VideoHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        url = urlsplit(self.path)
        if url.path in ("/api/viewer/catalog", "/api/viewer/data"):
            try:
                entries = catalog()
                if url.path.endswith("catalog"):
                    payload = {"entries": entries}
                else:
                    identifier = parse_qs(url.query).get("id", [None])[0]
                    entry = next((item for item in entries if item["id"] == identifier), None)
                    if entry is None:
                        self.send_error(404, "Unknown dataset")
                        return
                    payload = dataset(entry)
                body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
            except (ValueError, OSError) as error:
                self.send_error(422, str(error))
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def send_head(self):
        self.remaining = None
        path = Path(self.translate_path(self.path))
        range_header = self.headers.get("Range")
        if not range_header or not path.is_file():
            return super().send_head()
        stream = path.open("rb")
        size = path.stat().st_size
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip())
        if match and any(match.groups()) and size:
            first, last = match.groups()
            start = int(first) if first else max(0, size - int(last))
            end = min(int(last), size - 1) if first and last else size - 1
            valid = 0 <= start <= end < size
        else:
            valid = False
        if not valid:
            stream.close()
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(str(path)))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.remaining = end - start + 1
        self.send_header("Content-Length", str(self.remaining))
        self.end_headers()
        stream.seek(start)
        return stream

    def copyfile(self, source, outputfile):
        try:
            if self.remaining is None:
                return super().copyfile(source, outputfile)
            while self.remaining:
                chunk = source.read(min(1024 * 1024, self.remaining))
                if not chunk:
                    break
                outputfile.write(chunk)
                self.remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass  # Browser canceled a read after a seek or dataset change.


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    handler = partial(VideoHandler, directory=str(root))
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        print(f"全動画版（グラフ付き）: http://127.0.0.1:{args.port}/Score/video_graph_viewer.html", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
