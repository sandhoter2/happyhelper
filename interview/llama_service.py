"""LlamaParse REST API wrapper for document upload, status polling, and deletion."""
import time
import requests
from django.conf import settings

LLAMAPARSE_BASE = "https://api.cloud.llamaindex.ai/api/parsing"
SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".doc", ".txt", ".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".go", ".rb", ".rs", ".cpp", ".c", ".h", ".cs", ".md"}


def _headers():
    return {"Authorization": f"Bearer {settings.LLAMAPARSE_API_KEY}"}


def upload_file(file_obj, filename: str) -> dict:
    """Upload a file to LlamaParse. Returns the job dict with 'id' and 'status'."""
    url = f"{LLAMAPARSE_BASE}/upload"
    files = {"file": (filename, file_obj, _guess_mime(filename))}
    resp = requests.post(url, headers=_headers(), files=files, timeout=60)
    resp.raise_for_status()
    return resp.json()


def get_job_status(job_id: str) -> dict:
    """Poll job status. Returns dict with 'status' key."""
    url = f"{LLAMAPARSE_BASE}/job/{job_id}"
    resp = requests.get(url, headers=_headers(), timeout=30)
    resp.raise_for_status()
    return resp.json()


def get_parsed_markdown(job_id: str) -> str:
    """Fetch parsed markdown result once job is SUCCESS."""
    url = f"{LLAMAPARSE_BASE}/job/{job_id}/result/markdown"
    resp = requests.get(url, headers=_headers(), timeout=30)
    resp.raise_for_status()
    data = resp.json()
    return data.get("markdown", "")


def delete_job(job_id: str) -> bool:
    """Delete a LlamaParse job and its data. Returns True on success."""
    url = f"{LLAMAPARSE_BASE}/job/{job_id}"
    resp = requests.delete(url, headers=_headers(), timeout=30)
    return resp.status_code in (200, 204, 404)


def poll_until_done(job_id: str, max_wait: int = 120) -> str:
    """Poll until job status is SUCCESS or ERROR. Returns final status string."""
    deadline = time.time() + max_wait
    while time.time() < deadline:
        try:
            info = get_job_status(job_id)
        except Exception:
            time.sleep(5)
            continue
        status = info.get("status", "").upper()
        if status in ("SUCCESS", "ERROR", "CANCELED"):
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
