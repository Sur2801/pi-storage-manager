from __future__ import annotations

import io
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import settings
from app.services.storage_service import StorageService


def test_create_folder_duplicate_folder(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "Photos").mkdir()

    response = client.post("/api/folders", json={"parent_path": "/", "folder_name": "Photos"})

    assert response.status_code == 409
    assert response.json()["message"] == "File already exists."


def test_create_folder_invalid_name(client: TestClient) -> None:
    response = client.post("/api/folders", json={"parent_path": "/", "folder_name": "bad/name"})

    assert response.status_code == 400
    assert response.json()["message"] == "Folder name must not contain path separators."


def test_create_folder_traversal_attempt(client: TestClient) -> None:
    response = client.post("/api/folders", json={"parent_path": "../secret", "folder_name": "Photos"})

    assert response.status_code == 403
    assert response.json()["message"] == "Path traversal is not allowed."


def test_rename_folder(client: TestClient, tmp_path: Path) -> None:
    folder = tmp_path / "Old Folder"
    folder.mkdir()
    (folder / "nested.txt").write_text("data")

    response = client.patch("/api/files/rename", json={"source_path": "Old Folder", "new_name": "New Folder"})

    assert response.status_code == 200
    assert not folder.exists()
    assert (tmp_path / "New Folder" / "nested.txt").read_text() == "data"


def test_rename_duplicate_destination(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "a.txt").write_text("a")
    (tmp_path / "b.txt").write_text("b")

    response = client.patch("/api/files/rename", json={"source_path": "a.txt", "new_name": "b.txt"})

    assert response.status_code == 409
    assert response.json()["message"] == "File already exists."


def test_rename_traversal_attempt(client: TestClient) -> None:
    response = client.patch("/api/files/rename", json={"source_path": "../a.txt", "new_name": "b.txt"})

    assert response.status_code == 403
    assert response.json()["message"] == "Path traversal is not allowed."


def test_delete_folder_recursively(client: TestClient, tmp_path: Path) -> None:
    folder = tmp_path / "Vacation"
    folder.mkdir()
    (folder / "beach.jpg").write_text("data")
    (folder / "nested").mkdir()
    (folder / "nested" / "sunset.jpg").write_text("data")

    response = client.request("DELETE", "/api/files", json={"target_paths": ["Vacation"]})
    data = response.json()

    assert response.status_code == 200
    assert data["results"] == [{"path": "Vacation", "success": True, "error": None}]
    assert not folder.exists()


def test_delete_missing_item_reports_per_item_failure(client: TestClient) -> None:
    response = client.request("DELETE", "/api/files", json={"target_paths": ["missing.txt"]})
    data = response.json()

    assert response.status_code == 200
    assert data["success"] is False
    assert data["results"][0]["success"] is False
    assert data["results"][0]["error"] == "Requested item was not found."


def test_delete_traversal_attempt(client: TestClient) -> None:
    response = client.request("DELETE", "/api/files", json={"target_paths": ["../secret.txt"]})

    assert response.status_code == 403
    assert response.json()["message"] == "Path traversal is not allowed."


def test_copy_folder_recursively(client: TestClient, tmp_path: Path) -> None:
    source = tmp_path / "Photos"
    source.mkdir()
    (source / "trip.jpg").write_text("image")
    (source / "nested").mkdir()
    (source / "nested" / "deep.txt").write_text("nested")
    (tmp_path / "Backup").mkdir()

    response = client.post("/api/files/copy", json={"source_path": "Photos", "destination_path": "Backup"})
    data = response.json()

    assert response.status_code == 200
    assert data["results"][0]["success"] is True
    assert (tmp_path / "Backup" / "Photos" / "trip.jpg").read_text() == "image"
    assert (tmp_path / "Backup" / "Photos" / "nested" / "deep.txt").read_text() == "nested"


def test_copy_bulk_partial_failure(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "A").write_text("a")
    (tmp_path / "B").write_text("b")
    destination = tmp_path / "Dest"
    destination.mkdir()
    (destination / "B").write_text("existing")

    response = client.post(
        "/api/files/copy",
        json={"source_paths": ["A", "B"], "destination_path": "Dest"},
    )
    data = response.json()

    assert response.status_code == 200
    assert data["success"] is False
    assert data["results"][0]["success"] is True
    assert data["results"][1]["success"] is False
    assert data["results"][1]["error"] == "File already exists."


def test_copy_traversal_attempt(client: TestClient) -> None:
    response = client.post("/api/files/copy", json={"source_path": "../a.txt", "destination_path": "Dest"})

    assert response.status_code == 403
    assert response.json()["message"] == "Path traversal is not allowed."


def test_move_folder_into_descendant_is_blocked(client: TestClient, tmp_path: Path) -> None:
    source = tmp_path / "Photos"
    source.mkdir()
    nested = source / "nested"
    nested.mkdir()

    response = client.patch("/api/files/move", json={"source_path": "Photos", "destination_path": "Photos/nested"})
    data = response.json()

    assert response.status_code == 200
    assert data["success"] is False
    assert data["results"][0]["success"] is False
    assert "descendants" in data["results"][0]["error"]


def test_move_folder_success(client: TestClient, tmp_path: Path) -> None:
    source = tmp_path / "Photos"
    source.mkdir()
    (source / "trip.jpg").write_text("image")
    destination = tmp_path / "Archive"
    destination.mkdir()

    response = client.patch("/api/files/move", json={"source_path": "Photos", "destination_path": "Archive"})
    data = response.json()

    assert response.status_code == 200
    assert data["results"][0]["success"] is True
    assert not source.exists()
    assert (destination / "Photos" / "trip.jpg").read_text() == "image"


def test_move_destination_conflict(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "alpha.txt").write_text("a")
    destination = tmp_path / "Dest"
    destination.mkdir()
    (destination / "alpha.txt").write_text("existing")

    response = client.patch("/api/files/move", json={"source_path": "alpha.txt", "destination_path": "Dest"})
    data = response.json()

    assert response.status_code == 200
    assert data["success"] is False
    assert data["results"][0]["error"] == "File already exists."


def test_move_traversal_attempt(client: TestClient) -> None:
    response = client.patch("/api/files/move", json={"source_path": "../a.txt", "destination_path": "Dest"})

    assert response.status_code == 403
    assert response.json()["message"] == "Path traversal is not allowed."


def test_download_directory_as_archive(client: TestClient, tmp_path: Path) -> None:
    folder = tmp_path / "Photos"
    folder.mkdir()
    (folder / "one.txt").write_text("1")
    (folder / "two.txt").write_text("2")

    response = client.get("/api/files/download", params={"source_path": "Photos"})

    assert response.status_code == 200
    assert "Photos.zip" in response.headers["content-disposition"]

    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert sorted(archive.namelist()) == ["Photos/one.txt", "Photos/two.txt"]
        assert archive.read("Photos/one.txt") == b"1"


def test_download_invalid_path(client: TestClient) -> None:
    response = client.get("/api/files/download", params={"source_path": "../secret.txt"})

    assert response.status_code == 403
    assert response.json()["message"] == "Path traversal is not allowed."


def test_download_missing_file(client: TestClient) -> None:
    response = client.get("/api/files/download", params={"source_path": "missing.txt"})

    assert response.status_code == 404
    assert response.json()["message"] == "Requested item was not found."


def test_upload_duplicate_filename(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "sample.txt").write_text("existing")

    response = client.post(
        "/api/files/upload",
        data={"destination_path": "/"},
        files={"uploaded_file": ("sample.txt", b"new-data", "text/plain")},
    )

    assert response.status_code == 409
    assert response.json()["message"] == "File already exists."


def test_upload_invalid_destination(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "plain.txt").write_text("file")

    response = client.post(
        "/api/files/upload",
        data={"destination_path": "plain.txt"},
        files={"uploaded_file": ("sample.txt", b"new-data", "text/plain")},
    )

    assert response.status_code == 400
    assert response.json()["message"] == "Requested path is not a directory."


def test_upload_large_file(client: TestClient, tmp_path: Path) -> None:
    payload = b"x" * (2 * 1024 * 1024)

    response = client.post(
        "/api/files/upload",
        data={"destination_path": "/"},
        files={"uploaded_file": ("large.bin", payload, "application/octet-stream")},
    )

    assert response.status_code == 200
    assert (tmp_path / "large.bin").stat().st_size == len(payload)


def test_upload_preserves_nested_relative_path(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "Uploads").mkdir()

    response = client.post(
        "/api/files/upload",
        data={"destination_path": "Uploads", "relative_file_path": "Vacation/2026/Jan/photo.jpg"},
        files={"uploaded_file": ("photo.jpg", b"nested-photo", "image/jpeg")},
    )

    assert response.status_code == 200
    assert (tmp_path / "Uploads" / "Vacation" / "2026" / "Jan" / "photo.jpg").read_bytes() == b"nested-photo"


def test_upload_rejects_relative_path_traversal(client: TestClient, tmp_path: Path) -> None:
    response = client.post(
        "/api/files/upload",
        data={"destination_path": "/", "relative_file_path": "../secret.txt"},
        files={"uploaded_file": ("secret.txt", b"blocked", "text/plain")},
    )

    assert response.status_code == 403
    assert response.json()["message"] == "Path traversal is not allowed."
    assert not (tmp_path / "secret.txt").exists()


def test_upload_rejects_encoded_relative_path_traversal(client: TestClient, tmp_path: Path) -> None:
    response = client.post(
        "/api/files/upload",
        data={"destination_path": "/", "relative_file_path": "%2e%2e/secret.txt"},
        files={"uploaded_file": ("secret.txt", b"blocked", "text/plain")},
    )

    assert response.status_code == 403
    assert response.json()["message"] == "Path traversal is not allowed."
    assert not (tmp_path / "secret.txt").exists()


def test_upload_failure_cleans_up_partial_temp_file(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "storage_root", str(tmp_path))
    storage_service = StorageService()

    class BrokenStream(io.BytesIO):
        def read(self, size: int = -1) -> bytes:
            if self.tell() > 0:
                raise OSError("interrupted")
            return super().read(size)

    try:
        storage_service.upload_file_stream("/", "broken.bin", BrokenStream(b"x" * 1024))
    except Exception:
        pass

    assert not list(tmp_path.glob(".upload-*.part"))


def test_preview_text_file_inline(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "notes.txt").write_text("preview me", encoding="utf-8")

    response = client.get("/api/files/preview", params={"source_path": "notes.txt"})

    assert response.status_code == 200
    assert response.text == "preview me"
    assert response.headers["content-type"].startswith("text/plain")
    assert response.headers["content-disposition"].startswith("inline;")


def test_preview_pdf_inline(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "manual.pdf").write_bytes(b"%PDF-1.4\n")

    response = client.get("/api/files/preview", params={"source_path": "manual.pdf"})

    assert response.status_code == 200
    assert response.content == b"%PDF-1.4\n"
    assert response.headers["content-type"].startswith("application/pdf")
    assert response.headers["content-disposition"].startswith("inline;")


def test_preview_video_uses_stream_friendly_media_type(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "clip.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42")

    response = client.get("/api/files/preview", params={"source_path": "clip.mp4"})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("video/mp4")


def test_preview_audio_uses_stream_friendly_media_type(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "track.mp3").write_bytes(b"ID3")

    response = client.get("/api/files/preview", params={"source_path": "track.mp3"})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("audio/mpeg")


def test_preview_unsupported_file_defaults_to_octet_stream(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "archive.bin").write_bytes(b"\x01\x02")

    response = client.get("/api/files/preview", params={"source_path": "archive.bin"})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/octet-stream")


def test_preview_missing_file(client: TestClient) -> None:
    response = client.get("/api/files/preview", params={"source_path": "missing.txt"})

    assert response.status_code == 404
    assert response.json()["message"] == "Requested item was not found."


def test_preview_invalid_path(client: TestClient) -> None:
    response = client.get("/api/files/preview", params={"source_path": "../secret.txt"})

    assert response.status_code == 403
    assert response.json()["message"] == "Path traversal is not allowed."


def test_preview_directory_is_rejected(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "Photos").mkdir()

    response = client.get("/api/files/preview", params={"source_path": "Photos"})

    assert response.status_code == 400
    assert response.json()["message"] == "Requested path is not a file."
