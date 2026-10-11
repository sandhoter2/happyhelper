"""LlamaIndex Cloud document service using the official llama-cloud SDK."""
import time
from django.conf import settings
from llama_cloud import LlamaCloud
from llama_cloud._exceptions import NotFoundError

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".doc", ".txt", ".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".go", ".rb", ".rs", ".cpp", ".c", ".h", ".cs", ".md"}


def _client() -> LlamaCloud:
    return LlamaCloud(api_key=settings.LLAMAPARSE_API_KEY)


def upload_file(file_obj, filename: str, webhook_id: str = "") -> dict:
    """Upload a file and start a parse job. Returns job dict with 'id', 'status', 'file_id'."""
    client = _client()

    file_response = client.files.create(
        file=(filename, file_obj, _guess_mime(filename)),
        purpose="parse",
    )
    file_id = file_response.id

    kwargs = {"file_id": file_id, "tier": "fast", "version": "latest"}
    if webhook_id:
        kwargs["webhook_configuration_ids"] = [webhook_id]

    job = client.parsing.create(**kwargs)
    return {"id": job.id, "status": job.status or "PENDING", "file_id": file_id}


def get_job_status(job_id: str) -> dict:
    """Poll job status. Returns {"status": ...}.
    Returns {"status": "NOT_FOUND"} if the job no longer exists (expired)."""
    client = _client()
    try:
        result = client.parsing.get(job_id)
        status = result.job.status if result.job else "PENDING"
        return {"status": status}
    except NotFoundError:
        return {"status": "NOT_FOUND"}


def get_parsed_markdown(job_id: str) -> str:
    """Fetch parsed markdown result once job is COMPLETED."""
    client = _client()
    result = client.parsing.get(job_id, expand=["markdown"])
    pages = result.markdown.pages if result.markdown else []
    return "\n\n".join(p.markdown for p in pages if p.markdown)


def delete_job(job_id: str) -> bool:
    """Delete a LlamaParse job and its data. Returns True on success."""
    try:
        _client().parsing.delete(job_id)
        return True
    except NotFoundError:
        return True
    except Exception:
        return False


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
    result = _client().beta.directories.create(name=name)
    return {"id": result.id, "name": name}


def add_file_to_directory(directory_id: str, file_id: str) -> dict:
    """Add an already-uploaded file to a cloud directory."""
    result = _client().beta.directories.files.add(directory_id, file_id=file_id)
    return {"directory_id": directory_id, "file_id": file_id, "id": getattr(result, "id", None)}


def get_file_status(file_id: str) -> dict:
    """Get status of an uploaded file in LlamaIndex Cloud."""
    result = _client().files.get(file_id)
    return {"id": result.id, "status": getattr(result, "status", "unknown")}


def list_directory_files(directory_id: str) -> list:
    """List files in a LlamaIndex Cloud directory."""
    result = _client().beta.directories.files.list(directory_id)
    if isinstance(result, list):
        return result
    return list(result) if result else []


def delete_directory(directory_id: str) -> bool:
    """Delete a cloud directory. Returns True on success."""
    try:
        _client().beta.directories.delete(directory_id)
        return True
    except NotFoundError:
        return True
    except Exception:
        return False


def delete_file(file_id: str) -> bool:
    """Delete an uploaded file from LlamaIndex Cloud. Returns True on success."""
    try:
        _client().files.delete(file_id)
        return True
    except NotFoundError:
        return True
    except Exception:
        return False


def remove_file_from_directory(directory_id: str, file_id: str) -> bool:
    """Remove a file from a cloud directory (without deleting the file itself)."""
    try:
        _client().beta.directories.files.delete(directory_file_id=file_id, directory_id=directory_id)
        return True
    except NotFoundError:
        return True
    except Exception:
        return False


# ── Index management ─────────────────────────────────────────────────────────

def create_index(directory_id: str, name: str) -> dict:
    """Create a searchable index over a directory. Returns dict with 'id'."""
    result = _client().indexes.create(source_directory_id=directory_id, name=name)
    return {"id": result.id, "name": name}


def query_index(index_id: str, query: str, top_k: int = 5) -> list:
    """Query an index. Returns list of result dicts with 'text' and 'score'."""
    results = _client().retrieval.retrieve(index_id=index_id, query=query, top_k=top_k)
    if isinstance(results, list):
        return results
    return getattr(results, "nodes", getattr(results, "results", []))


def delete_index(index_id: str) -> bool:
    """Delete a cloud index. Returns True on success."""
    try:
        _client().indexes.delete(index_id)
        return True
    except NotFoundError:
        return True
    except Exception:
        return False


def _guess_mime(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return {
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "doc": "application/msword",
        "txt": "text/plain",
    }.get(ext, "application/octet-stream")
