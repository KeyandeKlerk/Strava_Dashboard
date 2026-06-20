import os
import threading
from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.responses import JSONResponse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from sync import run_sync

app = FastAPI()


@app.get("/webhook")
def verify_webhook(
    hub_verify_token: str = Query(None, alias="hub.verify_token"),
    hub_challenge: str = Query(None, alias="hub.challenge"),
):
    verify_token = os.environ.get("STRAVA_WEBHOOK_VERIFY_TOKEN", "")
    if hub_verify_token != verify_token:
        raise HTTPException(status_code=403, detail="Invalid verify token")
    return JSONResponse({"hub.challenge": hub_challenge})


@app.post("/webhook")
async def receive_event(request: Request):
    body = await request.json()
    if body.get("object_type") == "activity" and body.get("aspect_type") == "create":
        threading.Thread(target=run_sync, daemon=True).start()
    return {"status": "ok"}
