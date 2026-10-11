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
    return {"id": job["id"], "status": job.get("status", "PENDING"), "file_id": file_id}


def get_job_status(job_id: str) -> dict:
    """Poll job status. Returns dict with 'status' key.
    Returns {"status": "NOT_FOUND"} if the job no longer exists (expired)."""
    url = f"{LLAMAPARSE_BASE}/api/v2/parse/{job_id}"
    resp = requests.get(url, headers=_headers(), timeout=30)
    if resp.status_code == 404:
        return {"status": "NOT_FOUND"}
    resp.raise_for_status()
    data = resp.json()
    # v2 status values: PENDING, IN_PROGRESS, COMPLETED, FAILED, CANCELLED
    return {"status": data.get("status", "PENDING"), **data}


def get_parsed_markdown(job_id: str) -> str:
    """Fetch parsed markdown result once job is COMPLETED."""
    # v2 result endpoint: GET /api/v2/parse/{id}/result/markdown
    url = f"{LLAMAPARSE_BASE}/api/v2/parse/{job_id}/result/markdown"
    resp = requests.get(url, headers=_headers(), timeout=30)
    resp.raise_for_status()
    data = resp.json()
    # Returns {"pages": [{"page": 1, "markdown": "..."}]} or a list directly
    pages = data if isinstance(data, list) else data.get("pages", [])
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


# ── Directory (folder) management ───────────────────────────────────────────

def create_directory(name: str) -> dict:
    """Create a LlamaIndex Cloud directory. Returns dict with 'id'."""
    url = f"{LLAMAPARSE_BASE}/api/v1/beta/directories"
    resp = requests.post(url, headers={**_headers(), "Content-Type": "application/json"},
                         json={"name": name}, timeout=30)
    resp.raise_for_status()
    return resp.json()


def add_file_to_directory(directory_id: str, file_id: str) -> dict:
    """Add an already-uploaded file to a cloud directory."""
    url = f"{LLAMAPARSE_BASE}/api/v1/beta/directories/{directory_id}/files"
    resp = requests.post(url, headers={**_headers(), "Content-Type": "application/json"},
                         json={"file_id": file_id}, timeout=30)
    resp.raise_for_status()
    return resp.json()


def get_file_status(file_id: str) -> dict:
    """Get status of an uploaded file in LlamaIndex Cloud. Returns dict with 'status' key."""
    url = f"{LLAMAPARSE_BASE}/api/v1/beta/files/{file_id}"
    resp = requests.get(url, headers=_headers(), timeout=30)
    resp.raise_for_status()
    return resp.json()


def list_directory_files(directory_id: str) -> list:
    """List files in a LlamaIndex Cloud directory. Returns list of file dicts."""
    url = f"{LLAMAPARSE_BASE}/api/v1/beta/directories/{directory_id}/files"
    resp = requests.get(url, headers=_headers(), timeout=30)
    resp.raise_for_status()
    data = resp.json()
    return data if isinstance(data, list) else data.get("files", data.get("items", []))


def delete_directory(directory_id: str) -> bool:
    """Delete a cloud directory. Returns True on success."""
    url = f"{LLAMAPARSE_BASE}/api/v1/beta/directories/{directory_id}"
    resp = requests.delete(url, headers=_headers(), timeout=30)
    return resp.status_code in (200, 204, 404)


# ── Index management ─────────────────────────────────────────────────────────

def create_index(directory_id: str, name: str) -> dict:
    """Create a searchable index over a directory. Returns dict with 'id'."""
    url = f"{LLAMAPARSE_BASE}/api/v1/indexes"
    resp = requests.post(url, headers={**_headers(), "Content-Type": "application/json"},
                         json={"source_directory_id": directory_id, "name": name}, timeout=60)
    resp.raise_for_status()
    return resp.json()


def query_index(index_id: str, query: str, top_k: int = 5) -> list:
    """Query an index. Returns list of result dicts with 'text' and 'score'."""
    url = f"{LLAMAPARSE_BASE}/api/v1/indexes/{index_id}/query"
    resp = requests.post(url, headers={**_headers(), "Content-Type": "application/json"},
                         json={"query": query, "top_k": top_k}, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    return data.get("results", data.get("nodes", []))


def delete_index(index_id: str) -> bool:
    """Delete a cloud index. Returns True on success."""
    url = f"{LLAMAPARSE_BASE}/api/v1/indexes/{index_id}"
    resp = requests.delete(url, headers=_headers(), timeout=30)
    return resp.status_code in (200, 204, 404)


def _guess_mime(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return {
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "doc": "application/msword",
        "txt": "text/plain",
    }.get(ext, "application/octet-stream")
