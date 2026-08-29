from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import settings


def _set_storage_root(monkeypatch, root: Path) -> None:
    monkeypatch.setattr(settings, "storage_root", str(root))


def test_root_listing_returns_files_and_folders(client: TestClient, tmp_path: Path, monkeypatch) -> None:
    documents_dir = tmp_path / "Documents"
    documents_dir.mkdir()
    photo_file = tmp_path / "photo.jpg"
    photo_file.write_bytes(b"abc")

    _set_storage_root(monkeypatch, tmp_path)
    response = client.get("/api/files")
    data = response.json()

    assert response.status_code == 200
    assert data["success"] is True
    assert isinstance(data["items"], list)

    items_by_name = {item["name"]: item for item in data["items"]}
    folder_item = items_by_name["Documents"]
    file_item = items_by_name["photo.jpg"]

    assert folder_item["is_directory"] is True
    assert folder_item["type"] == "Folder"
    assert folder_item["size"] is None
    assert folder_item["extension"] is None

    assert file_item["is_directory"] is False
    assert file_item["size"] == 3
    assert file_item["extension"] == ".jpg"
    assert file_item["type"] == "Image"
    assert file_item["path"] == "photo.jpg"
    assert file_item["modified_at"] is not None


def test_nested_listing(client: TestClient, tmp_path: Path, monkeypatch) -> None:
    photos_dir = tmp_path / "Photos"
    photos_dir.mkdir()
    nested_dir = photos_dir / "Vacation"
    nested_dir.mkdir()
    nested_file = photos_dir / "beach.png"
    nested_file.write_text("hello")

    _set_storage_root(monkeypatch, tmp_path)
    response = client.get("/api/files", params={"path": "Photos"})
    data = response.json()

    assert response.status_code == 200
    assert data["path"] == "Photos"
    item_paths = {item["path"] for item in data["items"]}
    assert "Photos/Vacation" in item_paths
    assert "Photos/beach.png" in item_paths


def test_sorting_name_desc(client: TestClient, tmp_path: Path, monkeypatch) -> None:
    (tmp_path / "b-file.txt").write_text("b")
    (tmp_path / "a-file.txt").write_text("a")

    _set_storage_root(monkeypatch, tmp_path)
    response = client.get("/api/files", params={"sort_by": "name", "sort_order": "desc"})
    data = response.json()

    assert response.status_code == 200
    names = [item["name"] for item in data["items"]]
    assert names == ["b-file.txt", "a-file.txt"]


def test_invalid_absolute_path(client: TestClient, tmp_path: Path, monkeypatch) -> None:
    _set_storage_root(monkeypatch, tmp_path)
    response = client.get("/api/files", params={"path": "/Windows/System32"})
    data = response.json()

    assert response.status_code == 400
    assert data["success"] is False


def test_path_traversal_attempt_blocked(client: TestClient, tmp_path: Path, monkeypatch) -> None:
    _set_storage_root(monkeypatch, tmp_path)
    response = client.get("/api/files", params={"path": "../secret"})
    data = response.json()

    assert response.status_code == 403
    assert data["success"] is False


def test_missing_directory(client: TestClient, tmp_path: Path, monkeypatch) -> None:
    _set_storage_root(monkeypatch, tmp_path)
    response = client.get("/api/files", params={"path": "MissingFolder"})
    data = response.json()

    assert response.status_code == 404
    assert data["success"] is False


def test_search_filters_by_name(client: TestClient, tmp_path: Path, monkeypatch) -> None:
    (tmp_path / "report.pdf").write_text("x")
    (tmp_path / "photo.jpg").write_text("y")
    (tmp_path / "report-backup.pdf").write_text("z")

    _set_storage_root(monkeypatch, tmp_path)
    response = client.get("/api/files", params={"search": "report"})
    data = response.json()

    assert response.status_code == 200
    names = [item["name"] for item in data["items"]]
    assert "report.pdf" in names
    assert "report-backup.pdf" in names
    assert "photo.jpg" not in names


def test_search_case_insensitive(client: TestClient, tmp_path: Path, monkeypatch) -> None:
    (tmp_path / "MyDocument.docx").write_text("x")
    (tmp_path / "other.txt").write_text("y")

    _set_storage_root(monkeypatch, tmp_path)
    response = client.get("/api/files", params={"search": "mydoc"})
    data = response.json()

    assert response.status_code == 200
    names = [item["name"] for item in data["items"]]
    assert "MyDocument.docx" in names
    assert "other.txt" not in names


def test_search_empty_returns_all(client: TestClient, tmp_path: Path, monkeypatch) -> None:
    (tmp_path / "a.txt").write_text("a")
    (tmp_path / "b.txt").write_text("b")

    _set_storage_root(monkeypatch, tmp_path)
    response = client.get("/api/files")
    data = response.json()

    assert response.status_code == 200
    assert len(data["items"]) == 2


def test_system_metadata_entries_hidden_by_default(client: TestClient, tmp_path: Path, monkeypatch) -> None:
    (tmp_path / ".DS_Store").write_text("x")
    (tmp_path / "desktop.ini").write_text("x")
    (tmp_path / "visible.txt").write_text("x")

    _set_storage_root(monkeypatch, tmp_path)
    response = client.get("/api/files")
    data = response.json()

    assert response.status_code == 200
    assert [item["name"] for item in data["items"]] == ["visible.txt"]
    assert data["total_items"] == 1
    assert data["include_hidden"] is False


def test_hidden_toggle_includes_system_metadata_entries(client: TestClient, tmp_path: Path, monkeypatch) -> None:
    (tmp_path / ".DS_Store").write_text("x")
    (tmp_path / "visible.txt").write_text("x")

    _set_storage_root(monkeypatch, tmp_path)
    response = client.get("/api/files", params={"include_hidden": "true"})
    data = response.json()

    assert response.status_code == 200
    assert {item["name"] for item in data["items"]} == {".DS_Store", "visible.txt"}
    assert data["total_items"] == 2
    assert data["include_hidden"] is True


def test_legitimate_user_dotfiles_remain_visible_by_default(client: TestClient, tmp_path: Path, monkeypatch) -> None:
    (tmp_path / ".env").write_text("SECRET=1")
    (tmp_path / ".gitignore").write_text("node_modules\n")
    (tmp_path / ".DS_Store").write_text("x")
    (tmp_path / "visible.txt").write_text("x")

    _set_storage_root(monkeypatch, tmp_path)
    response = client.get("/api/files")
    data = response.json()

    assert response.status_code == 200
    names = {item["name"] for item in data["items"]}
    assert names == {".env", ".gitignore", "visible.txt"}
    assert data["total_items"] == 3


def test_listing_supports_pagination_metadata(client: TestClient, tmp_path: Path, monkeypatch) -> None:
    for index in range(5):
        (tmp_path / f"file-{index}.txt").write_text(str(index))

    _set_storage_root(monkeypatch, tmp_path)
    response = client.get("/api/files", params={"limit": 2, "offset": 2, "sort_by": "name", "sort_order": "asc"})
    data = response.json()

    assert response.status_code == 200
    assert [item["name"] for item in data["items"]] == ["file-2.txt", "file-3.txt"]
    assert data["limit"] == 2
    assert data["offset"] == 2
    assert data["total_items"] == 5
    assert data["has_more"] is True
