"""LlamaParse REST API v2 wrapper for document upload, status polling, and deletion.

v1 (/api/parsing/upload) was deprecated and returns 410 Gone.
v2 workflow: POST /api/v1/beta/files → POST /api/v2/parse → GET /api/v2/parse/{id}
"""
import time
import requests
from django.conf import settings

LLAMAPARSE_BASE = "https://api.cloud.llamaindex.ai"
SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".doc", ".txt", ".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".go", ".rb", ".rs", ".cpp", ".c", ".h", ".cs", ".md"}


def _headers():
    return {"Authorization": f"Bearer {settings.LLAMAPARSE_API_KEY}"}


def upload_file(file_obj, filename: str) -> dict:
    """Upload a file and start a parse job. Returns job dict with 'id' and 'status'."""
    # Step 1: upload file to get a file_id
    files_url = f"{LLAMAPARSE_BASE}/api/v1/beta/files"
    resp = requests.post(
        files_url,
        headers=_headers(),
        files={"file": (filename, file_obj, _guess_mime(filename))},
        data={"purpose": "parse"},
        timeout=60,
    )
    resp.raise_for_status()
    file_id = resp.json()["id"]

    # Step 2: start a parse job
    parse_url = f"{LLAMAPARSE_BASE}/api/v2/parse"
    resp = requests.post(
        parse_url,
        headers={**_headers(), "Content-Type": "application/json"},
        json={"file_id": file_id, "tier": "fast", "version": "latest"},
        timeout=60,
    )
    resp.raise_for_status()
    job = resp.json()
    return {"id": job["id"], "status": job.get("status", "PENDING")}


def get_job_status(job_id: str) -> dict:
    """Poll job status. Returns dict with 'status' key."""
    url = f"{LLAMAPARSE_BASE}/api/v2/parse/{job_id}"
    resp = requests.get(url, headers=_headers(), timeout=30)
    resp.raise_for_status()
    data = resp.json()
    # v2 status values: PENDING, IN_PROGRESS, COMPLETED, FAILED, CANCELLED
    return {"status": data.get("status", "PENDING"), **data}


def get_parsed_markdown(job_id: str) -> str:
    """Fetch parsed markdown result once job is COMPLETED."""
    url = f"{LLAMAPARSE_BASE}/api/v2/parse/{job_id}"
    resp = requests.get(url, headers=_headers(), params={"expand": "markdown"}, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    # v2 returns markdown under data.markdown.pages[].markdown
    markdown_obj = data.get("markdown")
    if not markdown_obj:
        return ""
    pages = markdown_obj.get("pages", [])
    return "\n\n".join(p.get("markdown", "") for p in pages)


def delete_job(job_id: str) -> bool:
    """Delete a LlamaParse job and its data. Returns True on success."""
    url = f"{LLAMAPARSE_BASE}/api/v2/parse/{job_id}"
    resp = requests.delete(url, headers=_headers(), timeout=30)
    return resp.status_code in (200, 204, 404)


def poll_until_done(job_id: str, max_wait: int = 120) -> str:
    """Poll until job status is terminal. Returns normalized status string."""
    deadline = time.time() + max_wait
    while time.time() < deadline:
        try:
            info = get_job_status(job_id)
        except Exception:
            time.sleep(5)
            continue
        status = info.get("status", "").upper()
        # v2 terminal states
        if status in ("COMPLETED", "FAILED", "CANCELLED", "SUCCESS", "ERROR", "CANCELED"):
            return status
        time.sleep(4)
    return "TIMEOUT"


def estimate_page_count(markdown_text: str) -> int:
    """Rough page estimate: ~3000 chars per page."""
    if not markdown_text:
        return 0
    return max(1, len(markdown_text) // 3000)


def _guess_mime(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return {
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "doc": "application/msword",
        "txt": "text/plain",
    }.get(ext, "application/octet-stream")
