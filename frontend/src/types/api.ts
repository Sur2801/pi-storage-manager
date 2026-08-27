export interface ApiResponse {
  success: boolean;
  message: string;
}

export interface BulkOperationItemResult {
  path: string;
  success: boolean;
  error: string | null;
}

export interface BulkOperationResponse extends ApiResponse {
  results: BulkOperationItemResult[];
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

export interface StorageRootStats {
  used_bytes?: number | null;
  used_gb?: number | null;
  file_count?: number | null;
  folder_count?: number | null;
}

export interface VolumeStats {
  total_bytes?: number | null;
  used_bytes?: number | null;
  available_bytes?: number | null;
  usage_percentage?: number | null;
  total_gb?: number | null;
  used_gb?: number | null;
  available_gb?: number | null;
}

export interface SystemStatsResponse {
  success?: boolean;
  message?: string | null;
  storage_root?: StorageRootStats | null;
  volume?: VolumeStats | null;
  storage_root_used_bytes?: number | null;
  storage_root_used_gb?: number | null;
  storage_root_file_count?: number | null;
  storage_root_folder_count?: number | null;
  volume_total_bytes?: number | null;
  volume_used_bytes?: number | null;
  volume_available_bytes?: number | null;
  volume_usage_percentage?: number | null;
  volume_total_gb?: number | null;
  volume_used_gb?: number | null;
  volume_available_gb?: number | null;
  total_storage_gb?: number | null;
  used_storage_gb?: number | null;
  available_storage_gb?: number | null;
  total_storage?: string | null;
  used_storage?: string | null;
  available_storage?: string | null;
  storage_usage_percentage?: number | null;
  cpu_usage_percentage?: number | null;
  ram_usage_percentage?: number | null;
  uptime?: string | null;
}

export interface UploadResponse extends ApiResponse {
  destination_path: string;
  file_name: string;
  upload_mode: "placeholder-json" | "multipart-form";
  content_type?: string | null;
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
