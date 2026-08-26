import { apiRequest } from "./client";
import type {
  ApiResponse,
  CopyRequest,
  CreateFolderRequest,
  DeleteRequest,
  MoveRequest,
  RenameRequest,
  UploadRequest,
} from "../types/api";

export const storageApi = {
  health: (): Promise<ApiResponse> => apiRequest("/health"),
  listFiles: (path = "/"): Promise<ApiResponse> => apiRequest(`/files?path=${encodeURIComponent(path)}`),
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

