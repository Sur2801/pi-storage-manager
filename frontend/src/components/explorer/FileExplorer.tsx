import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { storageApi } from "../../api/storageApi";
import { useDebounce } from "../../hooks/useDebounce";
import { useFileSSE } from "../../hooks/useFileSSE";
import type { BulkOperationResponse, FileListItem } from "../../types/api";

type NotifyTone = "info" | "success" | "warning" | "error";
type SortOption =
  | "name-asc"
  | "name-desc"
  | "type-asc"
  | "type-desc"
  | "date-asc"
  | "date-desc"
  | "size-asc"
  | "size-desc";
type ViewMode = "list" | "grid";
type TransferMode = "copy" | "move";
type UploadStatus = "queued" | "uploading" | "completed" | "failed";

type ExplorerItem = {
  id: string;
  name: string;
  type: string;
  size: string;
  sizeBytes: number | null;
  modified: string;
  kind: "folder" | "file";
  path: string;
  extension: string | null;
  icon: string;
};

type UploadTask = {
  id: string;
  name: string;
  relativePath: string | null;
  status: UploadStatus;
  progress: number;
  error: string | null;
};

type ActiveDialog =
  | { kind: "upload-picker" }
  | { kind: "create-folder"; name: string; error: string | null }
  | { kind: "rename"; item: ExplorerItem; name: string; error: string | null }
  | { kind: "delete"; items: ExplorerItem[]; error: string | null }
  | { kind: "transfer"; mode: TransferMode; items: ExplorerItem[]; destinationPath: string; error: string | null }
  | null;

type PreviewKind = "image" | "pdf" | "text" | "video" | "audio" | "unsupported";

type PreviewState = {
  item: ExplorerItem;
  kind: PreviewKind;
  status: "loading" | "ready" | "error";
  textContent: string | null;
  message: string | null;
};

type ConflictAction = "replace" | "skip" | "cancel" | "replace-all" | "skip-all";

type ConflictEntry = {
  id: string;
  operation: "upload" | "move" | "copy";
  itemName: string;
  sourcePath: string | null;
  destinationPath: string;
};

type DropState = {
  kind: "upload" | "move" | "copy";
  valid: boolean;
  targetPath: string | null;
  targetLabel: string | null;
};

type DragSourceKind = "external-files" | "internal-item" | "unknown";

type FileExplorerProps = {
  onNotify: (message: string, tone?: NotifyTone) => void;
};

function formatBytes(size: number | null): string {
  if (size === null) {
    return "—";
  }
  if (size < 1024) {
    return `${size} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatModifiedDate(rawDate: string | null): string {
  if (!rawDate) {
    return "—";
  }

  const parsedDate = new Date(rawDate);
  if (Number.isNaN(parsedDate.getTime())) {
    return rawDate;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsedDate);
}

function normalizeRelativePath(path: string | null | undefined): string {
  if (!path || path === "/") {
    return "";
  }

  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function toApiPath(relativePath: string): string {
  return relativePath === "" ? "/" : relativePath;
}

function mapSortOption(sortOption: SortOption): {
  sort_by: "name" | "type" | "size" | "modified_at";
  sort_order: "asc" | "desc";
} {
  switch (sortOption) {
    case "name-desc":
      return { sort_by: "name", sort_order: "desc" };
    case "type-asc":
      return { sort_by: "type", sort_order: "asc" };
    case "type-desc":
      return { sort_by: "type", sort_order: "desc" };
    case "date-asc":
      return { sort_by: "modified_at", sort_order: "asc" };
    case "date-desc":
      return { sort_by: "modified_at", sort_order: "desc" };
    case "size-asc":
      return { sort_by: "size", sort_order: "asc" };
    case "size-desc":
      return { sort_by: "size", sort_order: "desc" };
    case "name-asc":
    default:
      return { sort_by: "name", sort_order: "asc" };
  }
}

function iconForItem(item: FileListItem): string {
  if (item.is_directory) {
    return "📁";
  }

  const extension = (item.extension ?? "").toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".gif", ".svg", ".bmp", ".webp"].includes(extension)) {
    return "🖼";
  }
  if ([".mp4", ".mkv", ".avi", ".mov"].includes(extension)) {
    return "🎞";
  }
  if ([".mp3", ".wav", ".flac", ".aac", ".ogg"].includes(extension)) {
    return "🎵";
  }
  if ([".zip", ".tar", ".gz", ".7z", ".rar", ".bz2"].includes(extension)) {
    return "🗜";
  }
  if (extension === ".pdf") {
    return "📕";
  }
  if ([".doc", ".docx", ".odt", ".rtf"].includes(extension)) {
    return "📝";
  }
  if ([".xls", ".xlsx", ".csv", ".ods"].includes(extension)) {
    return "📊";
  }
  if ([".py"].includes(extension)) {
    return "🐍";
  }
  if ([".ts", ".tsx", ".js", ".jsx", ".json", ".html", ".htm", ".css", ".scss"].includes(extension)) {
    return "📜";
  }
  return "📄";
}

function toExplorerItem(item: FileListItem): ExplorerItem {
  return {
    id: item.path || item.name,
    name: item.name,
    type: item.type,
    size: formatBytes(item.size),
    sizeBytes: item.size,
    modified: formatModifiedDate(item.modified_at),
    kind: item.is_directory ? "folder" : "file",
    path: normalizeRelativePath(item.path),
    extension: item.extension,
    icon: iconForItem(item),
  };
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function summarizeBulkResult(action: string, response: BulkOperationResponse): { message: string; tone: NotifyTone } {
  const successCount = response.results.filter((result) => result.success).length;
  const failedResults = response.results.filter((result) => !result.success);

  if (failedResults.length === 0) {
    return {
      message: `${action} completed for ${successCount} item${successCount === 1 ? "" : "s"}.`,
      tone: "success",
    };
  }

  if (successCount === 0) {
    return {
      message: failedResults[0]?.error ?? `${action} failed.`,
      tone: "error",
    };
  }

  return {
    message: `${action} completed for ${successCount} item${successCount === 1 ? "" : "s"}; ${failedResults.length} failed.`,
    tone: "warning",
  };
}

function openDownload(url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

const TEXT_PREVIEW_LIMIT_BYTES = 1024 * 1024;
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"]);
const PDF_EXTENSIONS = new Set([".pdf"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".ogg", ".mov", ".m4v"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".aac", ".flac", ".m4a"]);
const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".log",
  ".csv",
  ".json",
  ".xml",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".env",
  ".py",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".css",
  ".scss",
  ".html",
  ".htm",
  ".sql",
  ".sh",
  ".ps1",
  ".bat",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".go",
  ".rs",
]);

function getPreviewKind(item: ExplorerItem): PreviewKind {
  const extension = (item.extension ?? "").toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (PDF_EXTENSIONS.has(extension)) {
    return "pdf";
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }
  if (AUDIO_EXTENSIONS.has(extension)) {
    return "audio";
  }
  if (TEXT_EXTENSIONS.has(extension)) {
    return "text";
  }
  return "unsupported";
}

function getFileRelativePath(file: File): string | null {
  const relativePath = normalizeRelativePath((file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "");
  return relativePath || null;
}

function isConflictError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes("already exists") || message.includes("item already exists") || message.includes("file already exists");
  }
  return false;
}

function getDestinationForRelativePath(destinationPath: string, relativePath: string | null): string {
  const normalizedDestination = normalizeRelativePath(destinationPath);
  const normalizedRelative = normalizeRelativePath(relativePath ?? "");
  if (!normalizedRelative) {
    return normalizedDestination;
  }
  return normalizedDestination ? `${normalizedDestination}/${normalizedRelative}` : normalizedRelative;
}

const INTERNAL_DRAG_MIME = "application/pi-storage-manager-item";

function hasDataTransferType(dataTransfer: DataTransfer | null, mimeType: string): boolean {
  if (!dataTransfer || !dataTransfer.types) {
    return false;
  }
  return Array.from(dataTransfer.types).includes(mimeType);
}

function detectDragSource(dataTransfer: DataTransfer | null): DragSourceKind {
  if (hasDataTransferType(dataTransfer, INTERNAL_DRAG_MIME)) {
    return "internal-item";
  }
  if (hasDataTransferType(dataTransfer, "Files")) {
    return "external-files";
  }
  return "unknown";
}

function ExplorerDialog({
  title,
  onClose,
  children,
  className,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="explorer-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className={["explorer-dialog", className].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="explorer-dialog-header">
          <h3>{title}</h3>
          <button type="button" className="icon-only-button" aria-label="Close dialog" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function FileExplorer({ onNotify }: FileExplorerProps) {
  const [items, setItems] = useState<ExplorerItem[]>([]);
  const [currentPath, setCurrentPath] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortOption, setSortOption] = useState<SortOption>("name-asc");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const [isDialogBusy, setIsDialogBusy] = useState(false);
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [showUploadHistoryDetails, setShowUploadHistoryDetails] = useState(false);
  const [dropState, setDropState] = useState<DropState | null>(null);
  const [conflictState, setConflictState] = useState<ConflictEntry | null>(null);
  const conflictResolverRef = useRef<((action: ConflictAction) => void) | null>(null);

  const debouncedSearch = useDebounce(searchTerm, 350);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const firstLoadRef = useRef(true);
  const currentPathRef = useRef(currentPath);
  const previousSseStatusRef = useRef<string | null>(null);
  const pausedSsePathRef = useRef<string | null>(null);
  const suppressedSsePathRef = useRef<string | null>(null);
  const suppressedSseUntilRef = useRef(0);
  const uploadPanelTimerRef = useRef<number | null>(null);

  const breadcrumbs = useMemo(() => normalizeRelativePath(currentPath).split("/").filter(Boolean), [currentPath]);
  const selectedItems = useMemo(() => items.filter((item) => selectedIds.includes(item.id)), [items, selectedIds]);
  const visibleFolders = useMemo(() => items.filter((item) => item.kind === "folder"), [items]);
  const allVisibleSelected = items.length > 0 && items.every((item) => selectedIds.includes(item.id));
  const parentPath = useMemo(() => breadcrumbs.slice(0, -1).join("/"), [breadcrumbs]);
  const uploadSummary = useMemo(() => {
    const completed = uploadTasks.filter((task) => task.status === "completed").length;
    const failed = uploadTasks.filter((task) => task.status === "failed").length;
    const active = uploadTasks.filter((task) => task.status === "queued" || task.status === "uploading").length;
    const total = uploadTasks.length;

    return {
      completed,
      failed,
      active,
      total,
      allFinished: total > 0 && active === 0,
      allSuccessful: total > 0 && active === 0 && failed === 0,
    };
  }, [uploadTasks]);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  useEffect(() => {
    const folderInput = folderInputRef.current;
    if (!folderInput) {
      return;
    }

    folderInput.setAttribute("webkitdirectory", "");
    folderInput.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    if (uploadPanelTimerRef.current !== null) {
      window.clearTimeout(uploadPanelTimerRef.current);
      uploadPanelTimerRef.current = null;
    }

    if (uploadSummary.total === 0) {
      return;
    }

    if (!uploadSummary.allFinished) {
      setShowUploadHistoryDetails(true);
      return;
    }

    if (uploadSummary.allSuccessful) {
      setShowUploadHistoryDetails(false);
      uploadPanelTimerRef.current = window.setTimeout(() => {
        setUploadTasks([]);
      }, 2200);
      return;
    }

    setShowUploadHistoryDetails(true);
    uploadPanelTimerRef.current = window.setTimeout(() => {
      setUploadTasks([]);
    }, 4000);
  }, [uploadSummary]);

  useEffect(
    () => () => {
      if (uploadPanelTimerRef.current !== null) {
        window.clearTimeout(uploadPanelTimerRef.current);
      }
    },
    [],
  );

  const fetchListing = useCallback(
    async (relativePath: string, selectedSort: SortOption, search?: string) => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const sortQuery = mapSortOption(selectedSort);
        const response = await storageApi.listFilesWithFilters({
          path: toApiPath(relativePath),
          sort_by: sortQuery.sort_by,
          sort_order: sortQuery.sort_order,
          ...(search ? { search } : {}),
        });
        setItems(response.items.map(toExplorerItem));
        setCurrentPath(normalizeRelativePath(response.path));
        setSelectedIds([]);
      } catch (error) {
        const message = getErrorMessage(error, "Unable to load this folder.");
        setErrorMessage(message);
        onNotify(message, "error");
      } finally {
        setIsLoading(false);
      }
    },
    [onNotify],
  );

  const refreshCurrentListing = useCallback(async () => {
    await fetchListing(currentPath, sortOption, debouncedSearch || undefined);
  }, [currentPath, debouncedSearch, fetchListing, sortOption]);

  useEffect(() => {
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      void fetchListing("", sortOption);
      return;
    }

    void fetchListing(currentPath, sortOption, debouncedSearch || undefined);
  }, [debouncedSearch, sortOption]); // eslint-disable-line react-hooks/exhaustive-deps

  const { status: sseStatus } = useFileSSE(currentPath, (event) => {
    const normalizedCurrentPath = normalizeRelativePath(currentPath);
    if (pausedSsePathRef.current === normalizedCurrentPath) {
      return;
    }
    if (
      suppressedSsePathRef.current === normalizedCurrentPath &&
      Date.now() < suppressedSseUntilRef.current
    ) {
      return;
    }
    if (event.src_path === ".uploading" || event.src_path.endsWith(".part")) {
      return;
    }
    void fetchListing(normalizedCurrentPath, sortOption, debouncedSearch || undefined);
  });

  useEffect(() => {
    const previousStatus = previousSseStatusRef.current;
    if (previousStatus && previousStatus !== sseStatus) {
      if (sseStatus === "disconnected") {
        onNotify("Live updates disconnected. Manual refresh is still available.", "warning");
      } else if (previousStatus === "disconnected" && sseStatus === "connected") {
        onNotify("Live updates reconnected.", "success");
      }
    }
    previousSseStatusRef.current = sseStatus;
  }, [onNotify, sseStatus]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      const isInInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && !isInInput) {
        event.preventDefault();
        setSelectedIds((currentIds) =>
          items.length > 0 && items.every((item) => currentIds.includes(item.id)) ? [] : items.map((item) => item.id),
        );
      }

      if (event.key === "Escape") {
        setSelectedIds([]);
        setOpenMenuId(null);
      }

      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !isInInput && items.length > 0) {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const currentIndex = selectedIds.length === 1 ? items.findIndex((item) => item.id === selectedIds[0]) : -1;
        const nextIndex =
          currentIndex === -1
            ? direction === 1
              ? 0
              : items.length - 1
            : Math.max(0, Math.min(items.length - 1, currentIndex + direction));
        const nextItem = items[nextIndex];
        if (nextItem) {
          setSelectedIds([nextItem.id]);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [items, selectedIds]);

  function pauseSseForCurrentPath(path: string) {
    pausedSsePathRef.current = normalizeRelativePath(path);
  }

  function suppressNextSseRefresh(path: string, durationMs = 1500) {
    pausedSsePathRef.current = null;
    suppressedSsePathRef.current = normalizeRelativePath(path);
    suppressedSseUntilRef.current = Date.now() + durationMs;
  }

  function toggleSelectItem(itemId: string) {
    setSelectedIds((currentIds) =>
      currentIds.includes(itemId) ? currentIds.filter((currentId) => currentId !== itemId) : [...currentIds, itemId],
    );
  }

  function openCreateFolderDialog() {
    setActiveDialog({ kind: "create-folder", name: "", error: null });
  }

  function openUploadDialog() {
    setActiveDialog({ kind: "upload-picker" });
  }

  function openRenameDialog(item: ExplorerItem) {
    setOpenMenuId(null);
    setActiveDialog({ kind: "rename", item, name: item.name, error: null });
  }

  function openDeleteDialog(targetItems: ExplorerItem[]) {
    setOpenMenuId(null);
    setActiveDialog({ kind: "delete", items: targetItems, error: null });
  }

  function openTransferDialog(mode: TransferMode, targetItems: ExplorerItem[]) {
    setOpenMenuId(null);
    setActiveDialog({
      kind: "transfer",
      mode,
      items: targetItems,
      destinationPath: currentPath,
      error: null,
    });
  }

  function closeDialog() {
    if (!isDialogBusy) {
      setActiveDialog(null);
    }
  }

  function closePreview() {
    setPreviewState(null);
  }

  function getDropMessage(target: DropState | null): string {
    if (!target) {
      return "Drop here";
    }
    if (target.kind === "upload" && !target.valid) {
      return "Drop on a folder or empty explorer area to upload";
    }
    if (!target.valid) {
      return "Drop here";
    }
    if (target.kind === "upload") {
      return target.targetLabel ? `Drop to upload into ${target.targetLabel}` : "Drop to upload";
    }
    return target.kind === "copy" ? "Drop to copy here" : "Drop to move here";
  }

  function askForConflict(entry: ConflictEntry): Promise<ConflictAction> {
    return new Promise((resolve) => {
      conflictResolverRef.current = resolve;
      setConflictState(entry);
    });
  }

  async function deleteConflictingEntry(destinationPath: string): Promise<void> {
    await storageApi.deleteItems({ target_paths: [destinationPath] });
  }

  async function performUploadFiles(files: File[], destinationPath: string) {
    if (files.length === 0) {
      return;
    }

    const normalizedDestinationPath = toApiPath(destinationPath);
    const initialTasks = files.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}-${index}`,
      name: getFileRelativePath(file) ?? file.name,
      relativePath: getFileRelativePath(file),
      status: "queued" as UploadStatus,
      progress: 0,
      error: null,
    }));

    setUploadTasks(initialTasks);
    setShowUploadHistoryDetails(true);
    pauseSseForCurrentPath(destinationPath);

    let nextIndex = 0;
    let successCount = 0;
    let failureCount = 0;
    let replaceAll = false;
    let skipAll = false;

    const updateTask = (taskId: string, update: Partial<UploadTask>) => {
      setUploadTasks((currentTasks) =>
        currentTasks.map((task) => (task.id === taskId ? { ...task, ...update } : task)),
      );
    };

    const worker = async () => {
      while (nextIndex < files.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;

        const file = files[currentIndex];
        const task = initialTasks[currentIndex];
        if (!file || !task) {
          return;
        }

        const relativePath = getFileRelativePath(file) ?? file.name;
        const absoluteTargetPath = getDestinationForRelativePath(normalizedDestinationPath, relativePath);

        updateTask(task.id, { status: "uploading", progress: 0, error: null });
        try {
          await storageApi.uploadMultipart(file, normalizedDestinationPath, relativePath || undefined, (progress) => {
            updateTask(task.id, { progress });
          });
          updateTask(task.id, { status: "completed", progress: 100 });
          successCount += 1;
        } catch (error) {
          if (isConflictError(error)) {
            if (skipAll) {
              updateTask(task.id, { status: "failed", error: "Skipped because a file with the same name already exists." });
              failureCount += 1;
              continue;
            }
            if (replaceAll) {
              try {
                await deleteConflictingEntry(absoluteTargetPath);
                await storageApi.uploadMultipart(file, normalizedDestinationPath, relativePath || undefined, (progress) => {
                  updateTask(task.id, { progress });
                });
                updateTask(task.id, { status: "completed", progress: 100 });
                successCount += 1;
                continue;
              } catch (replacementError) {
                updateTask(task.id, {
                  status: "failed",
                  error: getErrorMessage(replacementError, "Upload failed."),
                });
                failureCount += 1;
                continue;
              }
            }

            const decision = await askForConflict({
              id: `${task.id}-conflict`,
              operation: "upload",
              itemName: file.name,
              sourcePath: relativePath || null,
              destinationPath: absoluteTargetPath,
            });

            if (decision === "skip" || decision === "skip-all") {
              if (decision === "skip-all") {
                skipAll = true;
              }
              updateTask(task.id, { status: "failed", error: "Skipped due to an existing file." });
              failureCount += 1;
              continue;
            }
            if (decision === "cancel") {
              throw new Error("Upload cancelled.");
            }
            if (decision === "replace" || decision === "replace-all") {
              if (decision === "replace-all") {
                replaceAll = true;
              }
              try {
                await deleteConflictingEntry(absoluteTargetPath);
                await storageApi.uploadMultipart(file, normalizedDestinationPath, relativePath || undefined, (progress) => {
                  updateTask(task.id, { progress });
                });
                updateTask(task.id, { status: "completed", progress: 100 });
                successCount += 1;
                continue;
              } catch (replacementError) {
                updateTask(task.id, {
                  status: "failed",
                  error: getErrorMessage(replacementError, "Upload failed."),
                });
                failureCount += 1;
                continue;
              }
            }
          }

          updateTask(task.id, {
            status: "failed",
            error: getErrorMessage(error, "Upload failed."),
          });
          failureCount += 1;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(2, files.length) }, worker));

    suppressNextSseRefresh(destinationPath, 2000);
    if (currentPathRef.current === destinationPath) {
      await fetchListing(destinationPath, sortOption, debouncedSearch || undefined);
    }
    if (failureCount === 0) {
      onNotify(`Uploaded ${successCount} file${successCount === 1 ? "" : "s"}.`, "success");
    } else {
      onNotify(`Uploaded ${successCount} file${successCount === 1 ? "" : "s"}; ${failureCount} failed.`, "warning");
    }
  }

  async function openPreview(item: ExplorerItem) {
    if (item.kind !== "file") {
      return;
    }

    setOpenMenuId(null);
    const previewKind = getPreviewKind(item);

    if (previewKind === "unsupported") {
      setPreviewState({
        item,
        kind: previewKind,
        status: "ready",
        textContent: null,
        message: "Preview not available for this file type.",
      });
      return;
    }

    if (previewKind === "text" && item.sizeBytes !== null && item.sizeBytes > TEXT_PREVIEW_LIMIT_BYTES) {
      setPreviewState({
        item,
        kind: previewKind,
        status: "ready",
        textContent: null,
        message: `Text preview is limited to ${formatBytes(TEXT_PREVIEW_LIMIT_BYTES)}.`,
      });
      return;
    }

    setPreviewState({
      item,
      kind: previewKind,
      status: "loading",
      textContent: null,
      message: null,
    });

    if (previewKind !== "text") {
      setPreviewState({
        item,
        kind: previewKind,
        status: "ready",
        textContent: null,
        message: null,
      });
      return;
    }

    try {
      const response = await fetch(storageApi.getPreviewUrl(item.path));
      if (!response.ok) {
        let message = `Unable to preview ${item.name}.`;
        try {
          const payload = (await response.json()) as { message?: string };
          if (payload.message) {
            message = payload.message;
          }
        } catch {
          const fallbackText = await response.text().catch(() => "");
          if (fallbackText) {
            message = fallbackText;
          }
        }
        throw new Error(message);
      }
      const textContent = await response.text();
      setPreviewState({
        item,
        kind: previewKind,
        status: "ready",
        textContent,
        message: null,
      });
    } catch (error) {
      setPreviewState({
        item,
        kind: previewKind,
        status: "error",
        textContent: null,
        message: getErrorMessage(error, `Unable to preview ${item.name}.`),
      });
    }
  }

  async function handleOpen(item: ExplorerItem) {
    if (item.kind !== "folder") {
      await openPreview(item);
      return;
    }

    setOpenMenuId(null);
    setSearchTerm("");
    await fetchListing(item.path, sortOption);
  }

  async function runMutation(
    action: string,
    work: () => Promise<void>,
    successMessage: string,
    tone: NotifyTone = "success",
  ) {
    setIsDialogBusy(true);
    pauseSseForCurrentPath(currentPath);

    try {
      await work();
      setActiveDialog(null);
      suppressNextSseRefresh(currentPath);
      await fetchListing(currentPath, sortOption, debouncedSearch || undefined);
      onNotify(successMessage, tone);
    } catch (error) {
      const message = getErrorMessage(error, `Unable to ${action.toLowerCase()}.`);
      setActiveDialog((currentDialog) => (currentDialog ? { ...currentDialog, error: message } : currentDialog));
      onNotify(message, "error");
      pausedSsePathRef.current = null;
    } finally {
      setIsDialogBusy(false);
    }
  }

  async function submitCreateFolder() {
    if (!activeDialog || activeDialog.kind !== "create-folder") {
      return;
    }

    const folderName = activeDialog.name.trim();
    if (!folderName) {
      setActiveDialog({ ...activeDialog, error: "Folder name cannot be empty." });
      return;
    }

    await runMutation(
      "Create folder",
      () => storageApi.createFolder({ parent_path: toApiPath(currentPath), folder_name: folderName }).then(() => undefined),
      "Folder created.",
    );
  }

  async function submitRename() {
    if (!activeDialog || activeDialog.kind !== "rename") {
      return;
    }

    const nextName = activeDialog.name.trim();
    if (!nextName) {
      setActiveDialog({ ...activeDialog, error: "Name cannot be empty." });
      return;
    }

    await runMutation(
      "Rename",
      () => storageApi.rename({ source_path: activeDialog.item.path, new_name: nextName }).then(() => undefined),
      "Item renamed.",
    );
  }

  async function submitDelete() {
    if (!activeDialog || activeDialog.kind !== "delete") {
      return;
    }

    setIsDialogBusy(true);
    pauseSseForCurrentPath(currentPath);
    try {
      const response = await storageApi.deleteItems({ target_paths: activeDialog.items.map((item) => item.path) });
      setSelectedIds([]);
      setActiveDialog(null);
      suppressNextSseRefresh(currentPath);
      await fetchListing(currentPath, sortOption, debouncedSearch || undefined);
      const summary = summarizeBulkResult("Delete", response);
      onNotify(summary.message, summary.tone);
    } catch (error) {
      const message = getErrorMessage(error, "Unable to delete items.");
      setActiveDialog({ ...activeDialog, error: message });
      onNotify(message, "error");
      pausedSsePathRef.current = null;
    } finally {
      setIsDialogBusy(false);
    }
  }

  async function submitTransfer() {
    if (!activeDialog || activeDialog.kind !== "transfer") {
      return;
    }

    const destinationPath = activeDialog.destinationPath.trim();
    setIsDialogBusy(true);
    pauseSseForCurrentPath(currentPath);

    try {
      const payload = {
        source_paths: activeDialog.items.map((item) => item.path),
        destination_path: toApiPath(normalizeRelativePath(destinationPath)),
      };
      const response =
        activeDialog.mode === "copy" ? await storageApi.copy(payload) : await storageApi.move(payload);

      if (activeDialog.mode === "move") {
        setSelectedIds([]);
      }
      setActiveDialog(null);
      suppressNextSseRefresh(currentPath);
      await fetchListing(currentPath, sortOption, debouncedSearch || undefined);
      const summary = summarizeBulkResult(activeDialog.mode === "copy" ? "Copy" : "Move", response);
      onNotify(summary.message, summary.tone);
    } catch (error) {
      const message = getErrorMessage(error, `Unable to ${activeDialog.mode} items.`);
      setActiveDialog({ ...activeDialog, error: message });
      onNotify(message, "error");
      pausedSsePathRef.current = null;
    } finally {
      setIsDialogBusy(false);
    }
  }

  function handleToolbarDownload() {
    if (selectedItems.length === 0) {
      return;
    }
    const paths = selectedItems.map((item) => item.path);
    const asArchive = selectedItems.length > 1 || selectedItems.some((item) => item.kind === "folder");
    openDownload(storageApi.getDownloadUrl(paths.length === 1 ? paths[0] : paths, asArchive));
    onNotify("Preparing download...", "info");
  }

  function handleRowDownload(item: ExplorerItem) {
    openDownload(storageApi.getDownloadUrl(item.path, item.kind === "folder"));
    onNotify("Preparing download...", "info");
    setOpenMenuId(null);
  }

  async function handleUploadSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    setActiveDialog(null);

    if (selectedFiles.length === 0) {
      return;
    }

    if (uploadPanelTimerRef.current !== null) {
      window.clearTimeout(uploadPanelTimerRef.current);
      uploadPanelTimerRef.current = null;
    }

    await performUploadFiles(selectedFiles, currentPath);
  }

  function isCopyDropMode(event: React.DragEvent<HTMLElement>): boolean {
    return event.ctrlKey || event.metaKey;
  }

  function beginInternalDrag(event: React.DragEvent<HTMLElement>, item: ExplorerItem) {
    const operation = isCopyDropMode(event) ? "copy" : "move";
    event.dataTransfer.effectAllowed = operation;
    event.dataTransfer.setData(
      INTERNAL_DRAG_MIME,
      JSON.stringify({ path: item.path, name: item.name, operation }),
    );
    setDropState({ kind: operation, valid: false, targetPath: item.path, targetLabel: item.name });
  }

  function handleFolderDragOver(
    event: React.DragEvent<HTMLElement>,
    folderPath: string,
    folderName: string,
  ) {
    const source = detectDragSource(event.dataTransfer);
    if (source === "external-files") {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      setDropState({ kind: "upload", valid: true, targetPath: folderPath, targetLabel: folderName });
      return;
    }

    if (source === "internal-item") {
      event.preventDefault();
      event.stopPropagation();
      const operation = isCopyDropMode(event) ? "copy" : "move";
      event.dataTransfer.dropEffect = operation;
      setDropState({ kind: operation, valid: true, targetPath: folderPath, targetLabel: folderName });
    }
  }

  function handleFileDragOver(event: React.DragEvent<HTMLElement>, fileName: string) {
    if (detectDragSource(event.dataTransfer) !== "external-files") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "none";
    setDropState({ kind: "upload", valid: false, targetPath: null, targetLabel: fileName });
  }

  async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
    const files: File[] = [];
    const items = Array.from(dataTransfer.items ?? []);

    async function readEntry(entry: FileSystemEntry, parentPath = "") {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => {
          (entry as FileSystemFileEntry).file((resolvedFile) => {
            const fallbackPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
            const relativePath = normalizeRelativePath(
              (resolvedFile as File & { webkitRelativePath?: string }).webkitRelativePath ?? fallbackPath,
            );
            Object.defineProperty(resolvedFile, "webkitRelativePath", {
              value: relativePath || entry.name,
              configurable: true,
            });
            resolve(resolvedFile);
          }, reject);
        });
        files.push(file);
        return;
      }

      if (entry.isDirectory) {
        const directoryReader = (entry as FileSystemDirectoryEntry).createReader();

        let batch: FileSystemEntry[] = [];
        do {
          batch = await new Promise((resolve, reject) => {
            directoryReader.readEntries(resolve, reject);
          });
          for (const child of batch) {
            const childPath = `${parentPath}/${child.name}`.replace(/\/+/g, "/");
            await readEntry(child, childPath);
          }
        } while (batch.length > 0);
      }
    }

    for (const item of items) {
      if (item.kind !== "file") {
        continue;
      }

      const webkitEntry = item.webkitGetAsEntry?.();
      if (webkitEntry) {
        if (webkitEntry.isDirectory) {
          await readEntry(webkitEntry, webkitEntry.name);
        } else {
          await readEntry(webkitEntry, "");
        }
        continue;
      }

      const file = item.getAsFile();
      if (file) {
        files.push(file);
      }
    }

    return files;
  }

  async function handleDropUpload(event: React.DragEvent<HTMLElement>, destinationPath: string) {
    event.preventDefault();
    event.stopPropagation();
    if (detectDragSource(event.dataTransfer) !== "external-files") {
      return;
    }
    const droppedFiles = await collectDroppedFiles(event.dataTransfer);
    if (droppedFiles.length === 0) {
      return;
    }
    setDropState(null);
    await performUploadFiles(droppedFiles, destinationPath);
  }

  async function handleDropMoveOrCopy(event: React.DragEvent<HTMLElement>, targetPath: string, operation: "move" | "copy") {
    event.preventDefault();
    event.stopPropagation();
    const rawPayload = event.dataTransfer.getData(INTERNAL_DRAG_MIME);
    if (!rawPayload) {
      return;
    }

    try {
      const payload = JSON.parse(rawPayload) as { path?: string; name?: string };
      if (!payload.path) {
        return;
      }
      const response = operation === "copy" ? await storageApi.copy({ source_paths: [payload.path], destination_path: targetPath }) : await storageApi.move({ source_paths: [payload.path], destination_path: targetPath });
      const summary = summarizeBulkResult(operation === "copy" ? "Copy" : "Move", response);
      onNotify(summary.message, summary.tone);
      setDropState(null);
      await fetchListing(currentPath, sortOption, debouncedSearch || undefined);
    } catch (error) {
      const message = getErrorMessage(error, `Unable to ${operation} item.`);
      onNotify(message, "error");
    }
  }

  function clearUploadTasks() {
    if (uploadSummary.active > 0) {
      return;
    }
    setUploadTasks([]);
    setShowUploadHistoryDetails(false);
  }

  const busyText =
    uploadSummary.active > 0
      ? `Uploading ${uploadSummary.completed} / ${uploadSummary.total}`
      : isDialogBusy
        ? "Completing operation..."
        : isLoading
          ? "Loading folder..."
          : "Ready";

  const pageSummary = `Showing 1 to ${items.length} of ${items.length} items`;

  return (
    <section
      className={['file-explorer-panel', dropState ? 'file-explorer-panel-drop-active' : ''].filter(Boolean).join(' ')}
      onDragOver={(event) => {
        if (detectDragSource(event.dataTransfer) !== "external-files") {
          return;
        }
        event.preventDefault();
        setDropState({ kind: "upload", valid: true, targetPath: currentPath, targetLabel: null });
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => setDropState(null)}
      onDrop={(event) => void handleDropUpload(event, currentPath)}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => void handleUploadSelection(event)}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => void handleUploadSelection(event)}
      />

      <div className="file-explorer-header">
        <div>
          <h2 className="file-explorer-title">File Explorer</h2>
          <div className="file-explorer-breadcrumbs" aria-label="Breadcrumb">
            <button type="button" className="breadcrumb-link" onClick={() => void fetchListing("", sortOption)}>
              ⌂
            </button>
            {breadcrumbs.map((segment, index) => {
              const crumbPath = breadcrumbs.slice(0, index + 1).join("/");
              return (
                <span key={`${segment}-${index}`} className="breadcrumb-node">
                  <span className="breadcrumb-divider">›</span>
                  <button type="button" className="breadcrumb-link" onClick={() => void fetchListing(crumbPath, sortOption)}>
                    {segment}
                  </button>
                </span>
              );
            })}
          </div>
        </div>

        <div className="file-explorer-header-actions">
          <button type="button" className="secondary-button" disabled={isLoading} onClick={() => void refreshCurrentListing()}>
            ↻ Refresh
          </button>
          <button type="button" className="secondary-button" onClick={openUploadDialog}>
            ↥ Upload
          </button>
          <button type="button" className="secondary-button" onClick={openCreateFolderDialog}>
            ⊞ New Folder
          </button>
          <div className="toolbar-icon-toggle" role="tablist" aria-label="View mode">
            <button
              type="button"
              className={viewMode === "list" ? "toolbar-icon-toggle-active" : ""}
              aria-label="List view"
              onClick={() => setViewMode("list")}
            >
              ☰
            </button>
            <button
              type="button"
              className={viewMode === "grid" ? "toolbar-icon-toggle-active" : ""}
              aria-label="Grid view"
              onClick={() => setViewMode("grid")}
            >
              ⊞
            </button>
          </div>
        </div>
      </div>

      <div className="file-explorer-search-row">
        <label className="explorer-search-field">
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search files and folders…"
          />
          <span aria-hidden="true">🔎</span>
        </label>
        <div className="command-right">
          <select value={sortOption} onChange={(event) => setSortOption(event.target.value as SortOption)}>
            <option value="name-asc">Sort by: Name A-Z</option>
            <option value="name-desc">Sort by: Name Z-A</option>
            <option value="type-asc">Sort by: Type A-Z</option>
            <option value="type-desc">Sort by: Type Z-A</option>
            <option value="date-asc">Sort by: Oldest</option>
            <option value="date-desc">Sort by: Newest</option>
            <option value="size-asc">Sort by: Smallest</option>
            <option value="size-desc">Sort by: Largest</option>
          </select>
        </div>
      </div>

      <div className="explorer-status-strip">
        <span className="explorer-status-left">
          <span className={`sse-status-dot sse-status-dot-${sseStatus}`} aria-label={`Live updates: ${sseStatus}`} title={`Live updates: ${sseStatus}`} />
          {busyText}
        </span>
        <span>
          {uploadSummary.total > 0
            ? `Completed: ${uploadSummary.completed} | Failed: ${uploadSummary.failed}`
            : "Browse live filesystem changes or refresh manually at any time."}
        </span>
      </div>

      {dropState ? (
        <div className="explorer-drop-indicator" aria-live="polite">
          {getDropMessage(dropState)}
        </div>
      ) : null}

      {uploadTasks.length > 0 ? (
      <div className={`explorer-upload-panel ${uploadSummary.allFinished ? "explorer-upload-panel-compact" : ""}`}>
        <div className="explorer-upload-panel-header">
          <div className="explorer-upload-heading">
            <strong>Uploads</strong>
            <span>
              {uploadSummary.active > 0
                ? `Uploading ${uploadSummary.completed} / ${uploadSummary.total}`
                : `Completed: ${uploadSummary.completed} | Failed: ${uploadSummary.failed}`}
            </span>
          </div>
          <div className="explorer-upload-actions">
            {uploadSummary.allFinished ? (
              <button
                type="button"
                className="ghost-button"
                onClick={() => setShowUploadHistoryDetails((current) => !current)}
              >
                {showUploadHistoryDetails ? "Hide details" : "Show details"}
              </button>
            ) : null}
            <button type="button" className="ghost-button" disabled={uploadSummary.active > 0} onClick={clearUploadTasks}>
              Clear
            </button>
          </div>
        </div>
        {!uploadSummary.allFinished || showUploadHistoryDetails ? (
          <div className="explorer-upload-list">
          {uploadTasks.map((task) => (
            <div key={task.id} className="explorer-upload-row">
              <div className="explorer-upload-meta">
                <strong>{task.name}</strong>
                <span>{task.status === "uploading" ? `${task.progress}%` : task.status}</span>
                </div>
                <div className="explorer-upload-progress">
                  <span style={{ width: `${task.progress}%` }} />
                </div>
                {task.error ? <span className="explorer-upload-error">{task.error}</span> : null}
              </div>
            ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {selectedItems.length > 0 ? (
        <div className="explorer-bulk-toolbar" role="toolbar" aria-label="Selection actions">
          <span className="bulk-count">
            {selectedItems.length} item{selectedItems.length !== 1 ? "s" : ""} selected
          </span>
          <button type="button" className="ghost-button" onClick={() => openTransferDialog("copy", selectedItems)}>
            Copy
          </button>
          <button type="button" className="ghost-button" onClick={() => openTransferDialog("move", selectedItems)}>
            Move
          </button>
          <button type="button" className="ghost-button" onClick={handleToolbarDownload}>
            Download
          </button>
          <button type="button" className="ghost-button danger-soft-button" onClick={() => openDeleteDialog(selectedItems)}>
            Delete
          </button>
          <button type="button" className="ghost-button" onClick={() => setSelectedIds([])}>
            Clear
          </button>
        </div>
      ) : null}

      {errorMessage ? (
        <div className="explorer-error-state">
          <span className="explorer-error-icon">⚠</span>
          <p>{errorMessage}</p>
          <button type="button" className="secondary-button" onClick={() => void refreshCurrentListing()}>
            ↺ Retry
          </button>
        </div>
      ) : null}

      {isLoading ? (
        <div className="explorer-loading-state" aria-busy="true" aria-label="Loading folder contents">
          <div className="explorer-skeleton-rows">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="explorer-skeleton-row">
                <div className="skeleton-cell skeleton-icon" />
                <div className="skeleton-cell skeleton-name" />
                <div className="skeleton-cell skeleton-meta" />
                <div className="skeleton-cell skeleton-meta" />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!isLoading && !errorMessage && items.length === 0 ? (
        <div className="explorer-empty-state">
          <span className="explorer-empty-icon">📂</span>
          <p className="explorer-empty-title">This folder is empty</p>
          <p className="explorer-empty-sub">
            {debouncedSearch ? `No results matching "${debouncedSearch}"` : "No files or folders to display."}
          </p>
        </div>
      ) : null}

      <div className={`explorer-results explorer-results-${viewMode} ${isLoading ? "explorer-results-hidden" : ""}`}>
        <div className="explorer-table-shell">
          <table>
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={allVisibleSelected} onChange={() => setSelectedIds(allVisibleSelected ? [] : items.map((item) => item.id))} aria-label="Select all visible items" />
                </th>
                <th>Name</th>
                <th>Type</th>
                <th>Size</th>
                <th>Date Modified</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isSelected = selectedIds.includes(item.id);
                const menuIsOpen = openMenuId === item.id;

                return (
                  <tr
                    key={item.id}
                    className={[isSelected ? "explorer-row-selected" : "", item.kind === "folder" ? "explorer-row-folder" : ""].filter(Boolean).join(" ")}
                    draggable={item.kind === "folder" || item.kind === "file"}
                    onDragStart={(event) => beginInternalDrag(event, item)}
                    onDragEnd={() => setDropState(null)}
                    onDragOver={(event) => {
                      if (item.kind === "folder") {
                        handleFolderDragOver(event, item.path, item.name);
                        return;
                      }
                      handleFileDragOver(event, item.name);
                    }}
                    onDrop={(event) => {
                      const source = detectDragSource(event.dataTransfer);
                      if (item.kind === "folder") {
                        if (source === "external-files") {
                          void handleDropUpload(event, item.path);
                          return;
                        }
                        if (source === "internal-item") {
                          void handleDropMoveOrCopy(event, item.path, isCopyDropMode(event) ? "copy" : "move");
                        }
                        return;
                      }

                      if (source === "external-files") {
                        event.preventDefault();
                        event.stopPropagation();
                        setDropState(null);
                        onNotify("Drop files on a folder or empty explorer area to upload.", "warning");
                        return;
                      }
                    }}
                  >
                    <td>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelectItem(item.id)} aria-label={`Select ${item.name}`} />
                    </td>
                    <td>
                      <button type="button" className="explorer-item-button" onClick={() => void handleOpen(item)}>
                        <span className="explorer-item-cell">
                          <span className={`explorer-file-icon explorer-file-icon-${item.kind}`} aria-hidden="true">
                            {item.icon}
                          </span>
                          <span>
                            <strong>{item.name}</strong>
                          </span>
                        </span>
                      </button>
                    </td>
                    <td>{item.type}</td>
                    <td>{item.size}</td>
                    <td>{item.modified}</td>
                    <td>
                      <div className="explorer-menu-shell">
                        <button
                          type="button"
                          className="icon-only-button"
                          aria-expanded={menuIsOpen}
                          aria-label={`Open actions for ${item.name}`}
                          onClick={() => setOpenMenuId((currentId) => (currentId === item.id ? null : item.id))}
                        >
                          ⋮
                        </button>
                        {menuIsOpen ? (
                          <div className="explorer-action-menu">
                            {item.kind === "folder" ? (
                              <button type="button" onClick={() => void handleOpen(item)}>
                                📂 Open
                              </button>
                            ) : (
                              <button type="button" onClick={() => void openPreview(item)}>
                                👁 Open / Preview
                              </button>
                            )}
                            <button type="button" onClick={() => handleRowDownload(item)}>
                              ⤓ Download
                            </button>
                            <button type="button" onClick={() => openRenameDialog(item)}>
                              ✏ Rename
                            </button>
                            <button type="button" onClick={() => openTransferDialog("copy", [item])}>
                              ⧉ Copy
                            </button>
                            <button type="button" onClick={() => openTransferDialog("move", [item])}>
                              ↗ Move
                            </button>
                            <button type="button" className="explorer-action-danger" onClick={() => openDeleteDialog([item])}>
                              🗑 Delete
                            </button>
                            <button type="button" onClick={() => { onNotify(`${item.name}: ${item.type}, ${item.size}, ${item.modified}`, "info"); setOpenMenuId(null); }}>
                              ℹ Properties
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="explorer-mobile-list">
          {items.map((item) => {
            const isSelected = selectedIds.includes(item.id);
            const menuIsOpen = openMenuId === item.id;

            return (
              <article
                key={`${item.id}-mobile`}
                className={`explorer-mobile-card ${isSelected ? "explorer-mobile-card-selected" : ""}`}
                draggable={item.kind === "folder" || item.kind === "file"}
                onDragStart={(event) => beginInternalDrag(event, item)}
                onDragEnd={() => setDropState(null)}
                onDragOver={(event) => {
                  if (item.kind === "folder") {
                    handleFolderDragOver(event, item.path, item.name);
                    return;
                  }
                  handleFileDragOver(event, item.name);
                }}
                onDrop={(event) => {
                  const source = detectDragSource(event.dataTransfer);
                  if (item.kind === "folder") {
                    if (source === "external-files") {
                      void handleDropUpload(event, item.path);
                      return;
                    }
                    if (source === "internal-item") {
                      void handleDropMoveOrCopy(event, item.path, isCopyDropMode(event) ? "copy" : "move");
                    }
                    return;
                  }

                  if (source === "external-files") {
                    event.preventDefault();
                    event.stopPropagation();
                    setDropState(null);
                    onNotify("Drop files on a folder or empty explorer area to upload.", "warning");
                    return;
                  }
                }}
              >
                <div className="explorer-mobile-card-header">
                  <label className="explorer-mobile-checkbox">
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelectItem(item.id)} aria-label={`Select ${item.name}`} />
                    <span className={`explorer-file-icon explorer-file-icon-${item.kind}`} aria-hidden="true">
                      {item.icon}
                    </span>
                  </label>

                  <button type="button" className="explorer-item-button explorer-mobile-open" onClick={() => void handleOpen(item)}>
                    <strong>{item.name}</strong>
                    <span>{item.type}</span>
                  </button>

                  <button
                    type="button"
                    className="icon-only-button"
                    aria-expanded={menuIsOpen}
                    aria-label={`Open actions for ${item.name}`}
                    onClick={() => setOpenMenuId((currentId) => (currentId === item.id ? null : item.id))}
                  >
                    ⋮
                  </button>
                </div>

                <div className="explorer-mobile-meta">
                  <span>Size: {item.size}</span>
                  <span>Modified: {item.modified}</span>
                </div>

                {menuIsOpen ? (
                  <div className="explorer-mobile-actions">
                    {item.kind === "folder" ? (
                      <button type="button" onClick={() => void handleOpen(item)}>
                        📂 Open
                      </button>
                    ) : (
                      <button type="button" onClick={() => void openPreview(item)}>
                        👁 Open / Preview
                      </button>
                    )}
                    <button type="button" onClick={() => handleRowDownload(item)}>
                      ⤓ Download
                    </button>
                    <button type="button" onClick={() => openRenameDialog(item)}>
                      ✏ Rename
                    </button>
                    <button type="button" onClick={() => openTransferDialog("copy", [item])}>
                      Copy
                    </button>
                    <button type="button" onClick={() => openTransferDialog("move", [item])}>
                      Move
                    </button>
                    <button type="button" className="danger-soft-button" onClick={() => openDeleteDialog([item])}>
                      Delete
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>

      <div className="explorer-footer">
        <span>{pageSummary}</span>
      </div>

      {activeDialog?.kind === "create-folder" ? (
        <ExplorerDialog title="Create folder" onClose={closeDialog}>
          <div className="explorer-dialog-body">
            <label className="explorer-dialog-field">
              <span>Folder name</span>
              <input
                type="text"
                value={activeDialog.name}
                onChange={(event) => setActiveDialog({ ...activeDialog, name: event.target.value, error: null })}
                placeholder="Vacation"
              />
            </label>
            {activeDialog.error ? <p className="explorer-dialog-error">{activeDialog.error}</p> : null}
          </div>
          <div className="explorer-dialog-actions">
            <button type="button" className="ghost-button" disabled={isDialogBusy} onClick={closeDialog}>
              Cancel
            </button>
            <button type="button" disabled={isDialogBusy} onClick={() => void submitCreateFolder()}>
              {isDialogBusy ? "Creating..." : "Create"}
            </button>
          </div>
        </ExplorerDialog>
      ) : null}

      {activeDialog?.kind === "upload-picker" ? (
        <ExplorerDialog title="Upload" onClose={closeDialog}>
          <div className="explorer-dialog-body">
            <p className="explorer-dialog-copy">Choose files or select a folder to keep its full relative structure.</p>
            <div className="explorer-upload-choice-grid">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setActiveDialog(null);
                  fileInputRef.current?.click();
                }}
              >
                Choose files
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setActiveDialog(null);
                  folderInputRef.current?.click();
                }}
              >
                Choose folder
              </button>
            </div>
          </div>
          <div className="explorer-dialog-actions">
            <button type="button" className="ghost-button" onClick={closeDialog}>
              Cancel
            </button>
          </div>
        </ExplorerDialog>
      ) : null}

      {activeDialog?.kind === "rename" ? (
        <ExplorerDialog title={`Rename ${activeDialog.item.kind}`} onClose={closeDialog}>
          <div className="explorer-dialog-body">
            <label className="explorer-dialog-field">
              <span>New name</span>
              <input
                type="text"
                value={activeDialog.name}
                onChange={(event) => setActiveDialog({ ...activeDialog, name: event.target.value, error: null })}
              />
            </label>
            {activeDialog.error ? <p className="explorer-dialog-error">{activeDialog.error}</p> : null}
          </div>
          <div className="explorer-dialog-actions">
            <button type="button" className="ghost-button" disabled={isDialogBusy} onClick={closeDialog}>
              Cancel
            </button>
            <button type="button" disabled={isDialogBusy} onClick={() => void submitRename()}>
              {isDialogBusy ? "Renaming..." : "Rename"}
            </button>
          </div>
        </ExplorerDialog>
      ) : null}

      {activeDialog?.kind === "delete" ? (
        <ExplorerDialog title="Delete items" onClose={closeDialog}>
          <div className="explorer-dialog-body">
            <p className="explorer-dialog-copy">
              {activeDialog.items.length === 1
                ? `Delete "${activeDialog.items[0]?.name}" permanently?`
                : `Delete ${activeDialog.items.length} selected items permanently?`}
            </p>
            {activeDialog.error ? <p className="explorer-dialog-error">{activeDialog.error}</p> : null}
          </div>
          <div className="explorer-dialog-actions">
            <button type="button" className="ghost-button" disabled={isDialogBusy} onClick={closeDialog}>
              Cancel
            </button>
            <button type="button" className="danger-soft-button" disabled={isDialogBusy} onClick={() => void submitDelete()}>
              {isDialogBusy ? "Deleting..." : "Delete"}
            </button>
          </div>
        </ExplorerDialog>
      ) : null}

      {activeDialog?.kind === "transfer" ? (
        <ExplorerDialog title={activeDialog.mode === "copy" ? "Copy items" : "Move items"} onClose={closeDialog}>
          <div className="explorer-dialog-body">
            <p className="explorer-dialog-copy">
              {activeDialog.items.length} item{activeDialog.items.length === 1 ? "" : "s"} selected
            </p>
            <label className="explorer-dialog-field">
              <span>Destination folder</span>
              <input
                type="text"
                value={activeDialog.destinationPath}
                onChange={(event) => setActiveDialog({ ...activeDialog, destinationPath: event.target.value, error: null })}
                placeholder="Relative path, e.g. Photos/Backup"
              />
            </label>
            <div className="explorer-destination-suggestions">
              <button type="button" className="ghost-button" onClick={() => setActiveDialog({ ...activeDialog, destinationPath: "" })}>
                Root
              </button>
              <button type="button" className="ghost-button" onClick={() => setActiveDialog({ ...activeDialog, destinationPath: currentPath })}>
                Current folder
              </button>
              {currentPath ? (
                <button type="button" className="ghost-button" onClick={() => setActiveDialog({ ...activeDialog, destinationPath: parentPath })}>
                  Parent folder
                </button>
              ) : null}
              {visibleFolders.map((folder) => (
                <button
                  key={`destination-${folder.id}`}
                  type="button"
                  className="ghost-button"
                  onClick={() => setActiveDialog({ ...activeDialog, destinationPath: folder.path })}
                >
                  {folder.name}
                </button>
              ))}
            </div>
            {activeDialog.error ? <p className="explorer-dialog-error">{activeDialog.error}</p> : null}
          </div>
          <div className="explorer-dialog-actions">
            <button type="button" className="ghost-button" disabled={isDialogBusy} onClick={closeDialog}>
              Cancel
            </button>
            <button type="button" disabled={isDialogBusy} onClick={() => void submitTransfer()}>
              {isDialogBusy ? (activeDialog.mode === "copy" ? "Copying..." : "Moving...") : activeDialog.mode === "copy" ? "Copy" : "Move"}
            </button>
          </div>
        </ExplorerDialog>
      ) : null}

      {conflictState ? (
        <ExplorerDialog title="File already exists" onClose={() => {
          conflictResolverRef.current?.("cancel");
          conflictResolverRef.current = null;
          setConflictState(null);
        }}>
          <div className="explorer-dialog-body">
            <p className="explorer-dialog-copy">
              <strong>{conflictState.itemName}</strong> already exists in <strong>{conflictState.destinationPath}</strong>.
            </p>
            <div className="explorer-upload-choice-grid">
              <button type="button" className="secondary-button" onClick={() => {
                conflictResolverRef.current?.("skip");
                conflictResolverRef.current = null;
                setConflictState(null);
              }}>
                Skip
              </button>
              <button type="button" className="secondary-button" onClick={() => {
                conflictResolverRef.current?.("replace");
                conflictResolverRef.current = null;
                setConflictState(null);
              }}>
                Replace
              </button>
              <button type="button" className="secondary-button" onClick={() => {
                conflictResolverRef.current?.("skip-all");
                conflictResolverRef.current = null;
                setConflictState(null);
              }}>
                Skip All
              </button>
              <button type="button" className="secondary-button" onClick={() => {
                conflictResolverRef.current?.("replace-all");
                conflictResolverRef.current = null;
                setConflictState(null);
              }}>
                Replace All
              </button>
            </div>
          </div>
          <div className="explorer-dialog-actions">
            <button type="button" className="ghost-button" onClick={() => {
              conflictResolverRef.current?.("cancel");
              conflictResolverRef.current = null;
              setConflictState(null);
            }}>
              Cancel
            </button>
          </div>
        </ExplorerDialog>
      ) : null}

      {previewState ? (
        <ExplorerDialog title={`Preview: ${previewState.item.name}`} onClose={closePreview} className="explorer-dialog-preview">
          <div className="explorer-preview-body">
            <div className="explorer-preview-meta">
              <div>
                <strong>{previewState.item.name}</strong>
                <span>
                  {previewState.item.type} • {previewState.item.size} • {previewState.item.modified}
                </span>
              </div>
              <button type="button" className="ghost-button" onClick={() => handleRowDownload(previewState.item)}>
                Download
              </button>
            </div>

            {previewState.status === "loading" ? <div className="explorer-preview-placeholder">Loading preview…</div> : null}

            {previewState.status === "error" ? (
              <div className="explorer-preview-unsupported">
                <p>{previewState.message ?? "Unable to preview this file."}</p>
              </div>
            ) : null}

            {previewState.status === "ready" && previewState.kind === "image" ? (
              <div className="explorer-preview-surface explorer-preview-image-shell">
                <img src={storageApi.getPreviewUrl(previewState.item.path)} alt={previewState.item.name} className="explorer-preview-image" />
              </div>
            ) : null}

            {previewState.status === "ready" && previewState.kind === "pdf" ? (
              <iframe
                title={previewState.item.name}
                src={storageApi.getPreviewUrl(previewState.item.path)}
                className="explorer-preview-frame"
              />
            ) : null}

            {previewState.status === "ready" && previewState.kind === "video" ? (
              <div className="explorer-preview-surface">
                <video controls className="explorer-preview-media" src={storageApi.getPreviewUrl(previewState.item.path)} />
              </div>
            ) : null}

            {previewState.status === "ready" && previewState.kind === "audio" ? (
              <div className="explorer-preview-surface explorer-preview-audio-shell">
                <audio controls className="explorer-preview-audio" src={storageApi.getPreviewUrl(previewState.item.path)} />
              </div>
            ) : null}

            {previewState.status === "ready" && previewState.kind === "text" && previewState.textContent !== null ? (
              <pre className="explorer-preview-text">{previewState.textContent}</pre>
            ) : null}

            {previewState.status === "ready" &&
            (previewState.kind === "unsupported" || (previewState.kind === "text" && previewState.textContent === null)) ? (
              <div className="explorer-preview-unsupported">
                <p>{previewState.message ?? "Preview not available for this file type."}</p>
              </div>
            ) : null}
          </div>
          <div className="explorer-dialog-actions">
            <button type="button" className="ghost-button" onClick={closePreview}>
              Close
            </button>
          </div>
        </ExplorerDialog>
      ) : null}
    </section>
  );
}
