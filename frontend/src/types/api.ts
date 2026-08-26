export interface ApiResponse {
  success: boolean;
  message: string;
}

export interface FileListItem {
  name: string;
  path: string;
  is_directory: boolean;
  type: string;
  extension: string | null;
  size: number | null;
  modified_at: string | null;
}

export interface FileListResponse extends ApiResponse {
  path: string;
  search: string | null;
  sort_by: "name" | "type" | "size" | "modified_at";
  sort_order: "asc" | "desc";
  items: FileListItem[];
}

export interface UploadRequest {
  destination_path: string;
  item_name: string;
}

export interface CreateFileRequest {
  parent_path: string;
  file_name: string;
}

export interface CreateFolderRequest {
  parent_path: string;
  folder_name: string;
}

export interface RenameRequest {
  source_path: string;
  new_name: string;
}

export interface MoveRequest {
  source_path?: string;
  source_paths?: string[];
  destination_path: string;
}

export interface CopyRequest {
  source_path?: string;
  source_paths?: string[];
  destination_path: string;
}

export interface DeleteRequest {
  target_paths: string[];
}
