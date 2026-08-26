export interface ApiResponse {
  success: boolean;
  message: string;
}

export interface UploadRequest {
  destination_path: string;
  item_name: string;
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
  source_path: string;
  destination_path: string;
}

export interface CopyRequest {
  source_path: string;
  destination_path: string;
}

export interface DeleteRequest {
  target_paths: string[];
}

