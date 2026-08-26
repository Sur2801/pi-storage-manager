from pathlib import Path

from fastapi.testclient import TestClient


def test_health_endpoint(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["success"] is True


def test_file_listing_endpoint_supports_filters(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "vacation-photo.jpg").write_text("x")

    response = client.get(
        "/api/files",
        params={
            "path": "/",
            "search": "vacation",
            "sort_by": "name",
            "sort_order": "asc",
        },
    )
    data = response.json()
    assert response.status_code == 200
    assert data["success"] is True
    assert data["path"] == "/"
    assert data["search"] == "vacation"
    assert data["sort_by"] == "name"
    assert data["sort_order"] == "asc"
    assert [item["name"] for item in data["items"]] == ["vacation-photo.jpg"]


def test_create_empty_file_endpoint(client: TestClient) -> None:
    response = client.post(
        "/api/files",
        json={"parent_path": "/", "file_name": "new-file.txt"},
    )
    assert response.status_code == 200
    assert response.json()["success"] is True


def test_upload_endpoint_legacy_json(client: TestClient) -> None:
    response = client.post(
        "/api/files/upload",
        json={"destination_path": "/", "item_name": "placeholder.txt"},
    )
    data = response.json()
    assert response.status_code == 200
    assert data["success"] is True
    assert data["upload_mode"] == "placeholder-json"


def test_upload_endpoint_multipart_form(client: TestClient, tmp_path: Path) -> None:
    response = client.post(
        "/api/files/upload",
        data={"destination_path": "/"},
        files={"uploaded_file": ("sample.txt", b"sample-data", "text/plain")},
    )
    data = response.json()
    assert response.status_code == 200
    assert data["success"] is True
    assert data["upload_mode"] == "multipart-form"
    assert data["file_name"] == "sample.txt"
    assert (tmp_path / "sample.txt").read_bytes() == b"sample-data"


def test_download_endpoint_returns_file_response(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "placeholder.txt").write_text("download-me")

    response = client.get(
        "/api/files/download",
        params={"source_path": "placeholder.txt"},
    )

    assert response.status_code == 200
    assert response.content == b"download-me"
    assert "attachment; filename=\"placeholder.txt\"" in response.headers["content-disposition"]


def test_create_folder_endpoint(client: TestClient, tmp_path: Path) -> None:
    response = client.post(
        "/api/folders",
        json={"parent_path": "/", "folder_name": "new-folder"},
    )
    assert response.status_code == 200
    assert response.json()["success"] is True
    assert (tmp_path / "new-folder").is_dir()


def test_rename_endpoint(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "old-name.txt").write_text("rename-me")

    response = client.patch(
        "/api/files/rename",
        json={"source_path": "old-name.txt", "new_name": "new-name.txt"},
    )

    assert response.status_code == 200
    assert response.json()["success"] is True
    assert not (tmp_path / "old-name.txt").exists()
    assert (tmp_path / "new-name.txt").read_text() == "rename-me"


def test_move_endpoint_supports_bulk(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "source-a.txt").write_text("a")
    (tmp_path / "source-b.txt").write_text("b")
    (tmp_path / "folder").mkdir()

    response = client.patch(
        "/api/files/move",
        json={
            "source_paths": ["source-a.txt", "source-b.txt"],
            "destination_path": "folder",
        },
    )
    data = response.json()

    assert response.status_code == 200
    assert data["success"] is True
    assert data["message"] == "Move operation completed"
    assert len(data["results"]) == 2
    assert all(item["success"] for item in data["results"])
    assert (tmp_path / "folder" / "source-a.txt").exists()
    assert (tmp_path / "folder" / "source-b.txt").exists()


def test_copy_endpoint_supports_single_or_bulk(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "source.txt").write_text("copy-me")
    (tmp_path / "folder").mkdir()

    response = client.post(
        "/api/files/copy",
        json={"source_path": "source.txt", "destination_path": "folder"},
    )
    data = response.json()

    assert response.status_code == 200
    assert data["success"] is True
    assert data["message"] == "Copy operation completed"
    assert len(data["results"]) == 1
    assert data["results"][0]["path"] == "source.txt"
    assert (tmp_path / "source.txt").read_text() == "copy-me"
    assert (tmp_path / "folder" / "source.txt").read_text() == "copy-me"


def test_delete_endpoint_returns_itemized_results(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "old-file-a.txt").write_text("a")
    (tmp_path / "old-file-b.txt").write_text("b")

    response = client.request(
        "DELETE",
        "/api/files",
        json={"target_paths": ["old-file-a.txt", "old-file-b.txt"]},
    )
    data = response.json()

    assert response.status_code == 200
    assert data["success"] is True
    assert data["message"] == "Delete operation completed"
    assert len(data["results"]) == 2
    assert not (tmp_path / "old-file-a.txt").exists()
    assert not (tmp_path / "old-file-b.txt").exists()


def test_system_stats_endpoint_shape(client: TestClient) -> None:
    response = client.get("/api/system/stats")
    data = response.json()
    assert response.status_code == 200
    assert data["success"] is True
    assert data["total_storage"] == "4.0 TB"
    assert data["used_storage"] == "1.2 TB"
    assert data["available_storage"] == "2.8 TB"
    assert data["storage_usage_percentage"] == 30.0
    assert data["cpu_usage_percentage"] == 18.0
    assert data["ram_usage_percentage"] == 42.0
    assert data["uptime"] == "3d 12h"
