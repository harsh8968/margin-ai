"""Imported page images (doc: brownie feature "import your existing notes")."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlmodel import Session

from ..ai.llm_adapter import decode_data_url
from ..config import settings
from ..db import get_session
from ..http import ok
from ..models import Asset
from ..repo import get_project
from ..schemas import AssetUpload

router = APIRouter(prefix="/api", tags=["assets"])


@router.post("/projects/{project_id}/assets", status_code=201)
def upload_asset(project_id: str, body: AssetUpload, session: Session = Depends(get_session)):
    get_project(session, project_id)
    try:
        image = decode_data_url(body.data_url, settings.max_image_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    asset = Asset(project_id=project_id, mime=image.mime_type, size=len(image.data), data=image.data)
    session.add(asset)
    session.commit()
    return ok({"id": asset.id, "url": f"/api/assets/{asset.id}", "size": asset.size})


@router.get("/assets/{asset_id}")
def read_asset(asset_id: str, session: Session = Depends(get_session)):
    asset = session.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Image not found")
    # Content never changes for an id, so browsers may cache it forever.
    return Response(
        content=asset.data,
        media_type=asset.mime,
        headers={"Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"},
    )
