import os
import webbrowser
from urllib.parse import urlencode, urlparse, parse_qs
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
import requests
from dotenv import load_dotenv

load_dotenv()

AUTH_URL = "https://www.strava.com/oauth/authorize"
TOKEN_URL = "https://www.strava.com/oauth/token"
REDIRECT_URI = "http://localhost:8888/callback"


class _CallbackHandler(BaseHTTPRequestHandler):
    code: str | None = None

    def do_GET(self) -> None:
        params = parse_qs(urlparse(self.path).query)
        _CallbackHandler.code = params.get("code", [None])[0]
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"<html><body>Authorization complete - you can close this tab.</body></html>")

    def log_message(self, fmt, *args) -> None:
        pass  # suppress request logging


def authorize() -> None:
    client_id = os.environ["STRAVA_CLIENT_ID"]
    client_secret = os.environ["STRAVA_CLIENT_SECRET"]

    params = {
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": "activity:read_all",
    }
    url = f"{AUTH_URL}?{urlencode(params)}"
    print(f"Opening browser for Strava authorization...\nURL: {url}")
    webbrowser.open(url)

    server = HTTPServer(("localhost", 8888), _CallbackHandler)
    server.handle_request()

    code = _CallbackHandler.code
    if not code:
        raise RuntimeError("No authorization code received from Strava")

    resp = requests.post(TOKEN_URL, data={
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "grant_type": "authorization_code",
    })
    resp.raise_for_status()
    data = resp.json()
    refresh_token = data["refresh_token"]

    env_path = Path(".env")
    if env_path.exists() and "STRAVA_REFRESH_TOKEN" in env_path.read_text():
        content = env_path.read_text()
        lines = [
            f"STRAVA_REFRESH_TOKEN={refresh_token}" if l.startswith("STRAVA_REFRESH_TOKEN=") else l
            for l in content.splitlines()
        ]
        env_path.write_text("\n".join(lines) + "\n")
    else:
        with open(env_path, "a") as f:
            f.write(f"\nSTRAVA_REFRESH_TOKEN={refresh_token}\n")

    print(f"\nRefresh token saved to .env. You're ready to run sync.py.")


if __name__ == "__main__":
    authorize()
