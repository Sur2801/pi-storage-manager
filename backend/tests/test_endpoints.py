from fastapi.testclient import TestClient


def test_health_endpoint(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["success"] is True


def test_file_listing_endpoint(client: TestClient) -> None:
    response = client.get("/api/files", params={"path": "/"})
    assert response.status_code == 200
    assert response.json()["success"] is True


def test_upload_endpoint(client: TestClient) -> None:
    response = client.post(
        "/api/files/upload",
        json={"destination_path": "/", "item_name": "placeholder.txt"},
    )
    assert response.status_code == 200
    assert response.json()["success"] is True


def test_download_endpoint(client: TestClient) -> None:
    response = client.get("/api/files/download", params={"source_path": "/placeholder.txt"})
    assert response.status_code == 200
    assert response.json()["success"] is True


def test_create_folder_endpoint(client: TestClient) -> None:
    response = client.post(
        "/api/folders",
        json={"parent_path": "/", "folder_name": "new-folder"},
    )
    assert response.status_code == 200
    assert response.json()["success"] is True


def test_rename_endpoint(client: TestClient) -> None:
    response = client.patch(
        "/api/files/rename",
        json={"source_path": "/old-name.txt", "new_name": "new-name.txt"},
    )
    assert response.status_code == 200
    assert response.json()["success"] is True


def test_move_endpoint(client: TestClient) -> None:
    response = client.patch(
        "/api/files/move",
        json={"source_path": "/source.txt", "destination_path": "/folder/source.txt"},
    )
    assert response.status_code == 200
    assert response.json()["success"] is True


def test_copy_endpoint(client: TestClient) -> None:
    response = client.post(
        "/api/files/copy",
        json={"source_path": "/source.txt", "destination_path": "/folder/source.txt"},
    )
    assert response.status_code == 200
    assert response.json()["success"] is True


def test_delete_endpoint(client: TestClient) -> None:
    response = client.request(
        "DELETE",
        "/api/files",
        json={"target_paths": ["/old-file.txt"]},
    )
    assert response.status_code == 200
    assert response.json()["success"] is True


def test_system_stats_endpoint(client: TestClient) -> None:
    response = client.get("/api/system/stats")
    assert response.status_code == 200
    assert response.json()["success"] is True

