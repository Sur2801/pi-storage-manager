import { apiRequest } from "./client";
import type {
  ApiResponse,
  CopyRequest,
  CreateFileRequest,
  CreateFolderRequest,
  DeleteRequest,
  MoveRequest,
  RenameRequest,
  UploadRequest,
} from "../types/api";

export const storageApi = {
  health: (): Promise<ApiResponse> => apiRequest("/health"),
  listFiles: (path = "/"): Promise<ApiResponse> => apiRequest(`/files?path=${encodeURIComponent(path)}`),
  listFilesWithFilters: (params: {
    path: string;
    search?: string;
    sort_by?: "name" | "type" | "size" | "modified_at";
    sort_order?: "asc" | "desc";
  }): Promise<ApiResponse> => {
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
  download: (sourcePath: string): Promise<ApiResponse> =>
    apiRequest(`/files/download?source_path=${encodeURIComponent(sourcePath)}`),
  createFolder: (payload: CreateFolderRequest): Promise<ApiResponse> =>
    apiRequest("/folders", { method: "POST", body: JSON.stringify(payload) }),
  rename: (payload: RenameRequest): Promise<ApiResponse> =>
    apiRequest("/files/rename", { method: "PATCH", body: JSON.stringify(payload) }),
  move: (payload: MoveRequest): Promise<ApiResponse> =>
    apiRequest("/files/move", { method: "PATCH", body: JSON.stringify(payload) }),
  copy: (payload: CopyRequest): Promise<ApiResponse> =>
    apiRequest("/files/copy", { method: "POST", body: JSON.stringify(payload) }),
  deleteItems: (payload: DeleteRequest): Promise<ApiResponse> =>
    apiRequest("/files", { method: "DELETE", body: JSON.stringify(payload) }),
  systemStats: (): Promise<ApiResponse> => apiRequest("/system/stats"),
};
