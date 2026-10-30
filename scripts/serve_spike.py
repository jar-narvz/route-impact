"""Serve the repository with isolation headers: python scripts/serve_spike.py [port]."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class IsolatedHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "credentialless")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port", type=int, nargs="?", default=8000)
    args = parser.parse_args()
    handler = partial(IsolatedHandler, directory=str(Path(__file__).resolve().parents[1]))
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        print(f"Serving http://127.0.0.1:{args.port}/site/playground/spike/", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
