import { API_BASE_URL, apiRequest } from "./client";
import type {
  ApiResponse,
  BulkOperationResponse,
  CopyRequest,
  CreateFileRequest,
  CreateFolderRequest,
  DeleteRequest,
  FileListResponse,
  MoveRequest,
  RenameRequest,
  SystemStatsResponse,
  UploadRequest,
  UploadResponse,
} from "../types/api";

export const storageApi = {
  health: (): Promise<ApiResponse> => apiRequest("/health"),
  listFiles: (path = "/"): Promise<FileListResponse> => apiRequest(`/files?path=${encodeURIComponent(path)}`),
  listFilesWithFilters: (params: {
    path: string;
    search?: string;
    sort_by?: "name" | "type" | "size" | "modified_at";
    sort_order?: "asc" | "desc";
  }): Promise<FileListResponse> => {
    const query = new URLSearchParams({
      path: params.path,
      ...(params.search ? { search: params.search } : {}),
      ...(params.sort_by ? { sort_by: params.sort_by } : {}),
      ...(params.sort_order ? { sort_order: params.sort_order } : {}),
    });
    return apiRequest(`/files?${query.toString()}`);
  },
  createFile: (payload: CreateFileRequest): Promise<ApiResponse> =>
    apiRequest("/files", { method: "POST", body: JSON.stringify(payload) }),
  upload: (payload: UploadRequest): Promise<ApiResponse> =>
    apiRequest("/files/upload", { method: "POST", body: JSON.stringify(payload) }),
  uploadMultipart: (
    file: File,
    destinationPath: string,
    relativeFilePath?: string,
    onProgress?: (progress: number) => void,
  ): Promise<UploadResponse> =>
    new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append("destination_path", destinationPath);
      if (relativeFilePath) {
        formData.append("relative_file_path", relativeFilePath);
      }
      formData.append("uploaded_file", file);

      const request = new XMLHttpRequest();
      request.open("POST", `${API_BASE_URL}/files/upload`);
      request.responseType = "json";
      request.timeout = 120000;

      let settled = false;
      const settle = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeoutHandle);
        callback();
      };

      const timeoutHandle = window.setTimeout(() => {
        if (!settled) {
          request.abort();
          settle(() => reject(new Error("Upload timed out.")));
        }
      }, request.timeout);

      request.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          onProgress(Math.min(100, Math.max(0, Math.round((event.loaded / event.total) * 100))));
        }
      };

      request.onload = () => {
        const payload = request.response as UploadResponse | { message?: string } | null;
        if (request.status >= 200 && request.status < 300 && payload) {
          settle(() => resolve(payload as UploadResponse));
          return;
        }
        if (payload && "message" in payload && payload.message) {
          settle(() => reject(new Error(payload.message)));
          return;
        }
        settle(() => reject(new Error(request.responseText || "Upload failed.")));
      };

      request.onerror = () => {
        settle(() => reject(new Error("Upload failed.")));
      };

      request.onabort = () => {
        settle(() => reject(new Error("Upload cancelled.")));
      };

      request.ontimeout = () => {
        settle(() => reject(new Error("Upload timed out.")));
      };

      request.onloadend = () => {
        window.clearTimeout(timeoutHandle);
      };

      request.send(formData);
    }),
  getDownloadUrl: (sourcePath: string | string[], asArchive = false): string => {
    const query = new URLSearchParams();
    if (Array.isArray(sourcePath)) {
      sourcePath.forEach((path) => query.append("source_paths", path));
    } else {
      query.set("source_path", sourcePath);
    }
    if (asArchive) {
      query.set("as_archive", "true");
    }
    return `${API_BASE_URL}/files/download?${query.toString()}`;
  },
  getPreviewUrl: (sourcePath: string): string => {
    const query = new URLSearchParams({ source_path: sourcePath });
    return `${API_BASE_URL}/files/preview?${query.toString()}`;
  },
  createFolder: (payload: CreateFolderRequest): Promise<ApiResponse> =>
    apiRequest("/folders", { method: "POST", body: JSON.stringify(payload) }),
  rename: (payload: RenameRequest): Promise<ApiResponse> =>
    apiRequest("/files/rename", { method: "PATCH", body: JSON.stringify(payload) }),
  move: (payload: MoveRequest): Promise<BulkOperationResponse> =>
    apiRequest("/files/move", { method: "PATCH", body: JSON.stringify(payload) }),
  copy: (payload: CopyRequest): Promise<BulkOperationResponse> =>
    apiRequest("/files/copy", { method: "POST", body: JSON.stringify(payload) }),
  deleteItems: (payload: DeleteRequest): Promise<BulkOperationResponse> =>
    apiRequest("/files", { method: "DELETE", body: JSON.stringify(payload) }),
  systemStats: (): Promise<SystemStatsResponse> => apiRequest("/system/stats"),
};
