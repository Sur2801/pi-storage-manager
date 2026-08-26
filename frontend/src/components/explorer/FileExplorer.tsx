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
type SortColumn = "name" | "type" | "size" | "modified_at";
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
  sizeBytes: number;
  status: UploadStatus;
  progress: number; // 0-100
  error: string | null;
};

type BatchProgress = {
  total: number;
  completed: number;
  failed: number;
  uploadingCount: number;
  pendingCount: number;
  totalBytes: number;
  uploadedBytes: number;
  overallPercent: number;
  activeFileNames: string[];
  allFinished: boolean;
  allSuccessful: boolean;
};

type ActiveDialog =
  | { kind: "upload-picker"; pendingFolders: Array<{ name: string; files: File[] }> }
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

const MOBILE_SORT_ROWS: Array<{ title: string; icon: string; column: SortColumn }> = [
  { title: "Name", icon: "↕", column: "name" },
  { title: "Type", icon: "▤", column: "type" },
  { title: "Date Modified", icon: "◷", column: "modified_at" },
  { title: "Size", icon: "⇅", column: "size" },
];

type FileExplorerProps = {
  onNotify: (message: string, tone?: NotifyTone) => void;
  onFilesystemMutationComplete?: () => void;
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

function getSortColumn(sortOption: SortOption): SortColumn {
  if (sortOption.startsWith("type")) {
    return "type";
  }
  if (sortOption.startsWith("size")) {
    return "size";
  }
  if (sortOption.startsWith("date")) {
    return "modified_at";
  }
  return "name";
}

function getSortOrder(sortOption: SortOption): "asc" | "desc" {
  return sortOption.endsWith("-desc") ? "desc" : "asc";
}

function toggleSortOption(currentSort: SortOption, column: SortColumn): SortOption {
  const currentColumn = getSortColumn(currentSort);
  const currentOrder = getSortOrder(currentSort);
  const nextOrder = currentColumn === column && currentOrder === "asc" ? "desc" : "asc";

  if (column === "name") {
    return nextOrder === "asc" ? "name-asc" : "name-desc";
  }
  if (column === "type") {
    return nextOrder === "asc" ? "type-asc" : "type-desc";
  }
  if (column === "size") {
    return nextOrder === "asc" ? "size-asc" : "size-desc";
  }
  return nextOrder === "asc" ? "date-asc" : "date-desc";
}

function getSortColumnLabel(column: SortColumn): string {
  if (column === "modified_at") {
    return "Date";
  }
  if (column === "name") {
    return "Name";
  }
  if (column === "type") {
    return "Type";
  }
  return "Size";
}

function getSortColumnIcon(column: SortColumn): string {
  if (column === "name") {
    return "↕";
  }
  if (column === "type") {
    return "▤";
  }
  if (column === "modified_at") {
    return "◷";
  }
  return "⇅";
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

function isExternalFileDrag(event: React.DragEvent<HTMLElement>): boolean {
  return detectDragSource(event.dataTransfer) === "external-files";
}

function isInternalItemDrag(event: React.DragEvent<HTMLElement>): boolean {
  return detectDragSource(event.dataTransfer) === "internal-item";
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

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

export function FileExplorer({ onNotify, onFilesystemMutationComplete }: FileExplorerProps) {
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
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [showFailedDetails, setShowFailedDetails] = useState(false);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [dropState, setDropState] = useState<DropState | null>(null);
  const [conflictState, setConflictState] = useState<ConflictEntry | null>(null);
  const [isMobileSortOpen, setIsMobileSortOpen] = useState(false);
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
  const batchFlushTimerRef = useRef<number | null>(null);
  const tasksMapRef = useRef<Map<string, UploadTask>>(new Map());
  const externalDragDepthRef = useRef(0);
  const mobileSortButtonRef = useRef<HTMLButtonElement>(null);
  const mobileSortPopoverRef = useRef<HTMLDivElement>(null);

  const breadcrumbs = useMemo(() => normalizeRelativePath(currentPath).split("/").filter(Boolean), [currentPath]);
  const selectedItems = useMemo(() => items.filter((item) => selectedIds.includes(item.id)), [items, selectedIds]);
  const visibleFolders = useMemo(() => items.filter((item) => item.kind === "folder"), [items]);
  const allVisibleSelected = items.length > 0 && items.every((item) => selectedIds.includes(item.id));
  const parentPath = useMemo(() => breadcrumbs.slice(0, -1).join("/"), [breadcrumbs]);

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

    if (!batchProgress || batchProgress.total === 0) {
      return;
    }

    if (!batchProgress.allFinished) {
      return;
    }

    const delay = batchProgress.allSuccessful ? 2200 : 4000;
    uploadPanelTimerRef.current = window.setTimeout(() => {
      tasksMapRef.current.clear();
      setBatchProgress(null);
      setShowFailedDetails(false);
    }, delay);
  }, [batchProgress]);

  useEffect(
    () => () => {
      if (uploadPanelTimerRef.current !== null) {
        window.clearTimeout(uploadPanelTimerRef.current);
      }
      if (batchFlushTimerRef.current !== null) {
        window.clearTimeout(batchFlushTimerRef.current);
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

      if (isMobileSortOpen && event.key === "Escape") {
        event.preventDefault();
        setIsMobileSortOpen(false);
        mobileSortButtonRef.current?.focus();
        return;
      }

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
  }, [isMobileSortOpen, items, selectedIds]);

  useEffect(() => {
    if (!isMobileSortOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      const clickedTrigger = mobileSortButtonRef.current?.contains(target);
      const clickedPopover = mobileSortPopoverRef.current?.contains(target);
      if (!clickedTrigger && !clickedPopover) {
        setIsMobileSortOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      setIsMobileSortOpen(false);
      mobileSortButtonRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isMobileSortOpen]);

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
    setActiveDialog({ kind: "upload-picker", pendingFolders: [] });
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

  const setDropStateIfChanged = useCallback((nextState: DropState | null) => {
    setDropState((currentState) => {
      if (
        currentState?.kind === nextState?.kind &&
        currentState?.valid === nextState?.valid &&
        currentState?.targetPath === nextState?.targetPath &&
        currentState?.targetLabel === nextState?.targetLabel
      ) {
        return currentState;
      }
      return nextState;
    });
  }, []);

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

  // Recomputes aggregate from the tasks map and pushes to React state.
  // Called at most every 80 ms via scheduleBatchFlush() to prevent excessive re-renders.
  function flushBatchProgress() {
    batchFlushTimerRef.current = null;
    const tasks = Array.from(tasksMapRef.current.values());
    const total = tasks.length;
    if (total === 0) {
      setBatchProgress(null);
      return;
    }
    const completed = tasks.filter((t) => t.status === "completed").length;
    const failed = tasks.filter((t) => t.status === "failed").length;
    const uploadingTasks = tasks.filter((t) => t.status === "uploading");
    const uploadingCount = uploadingTasks.length;
    const pendingCount = tasks.filter((t) => t.status === "queued").length;

    const totalBytes = tasks.reduce((s, t) => s + t.sizeBytes, 0);
    const completedBytes = tasks
      .filter((t) => t.status === "completed")
      .reduce((s, t) => s + t.sizeBytes, 0);
    const activeBytes = uploadingTasks.reduce(
      (s, t) => s + Math.round((t.sizeBytes * t.progress) / 100),
      0,
    );
    const uploadedBytes = completedBytes + activeBytes;

    const overallPercent =
      totalBytes > 0
        ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100))
        : Math.round((completed / total) * 100);

    const activeFileNames = uploadingTasks.slice(0, 2).map((t) => t.name);
    const allFinished = total > 0 && uploadingCount === 0 && pendingCount === 0;
    const allSuccessful = allFinished && failed === 0;

    setBatchProgress({
      total,
      completed,
      failed,
      uploadingCount,
      pendingCount,
      totalBytes,
      uploadedBytes,
      overallPercent,
      activeFileNames,
      allFinished,
      allSuccessful,
    });
  }

  function scheduleBatchFlush() {
    if (batchFlushTimerRef.current !== null) return;
    batchFlushTimerRef.current = window.setTimeout(flushBatchProgress, 80);
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
      sizeBytes: file.size,
      status: "queued" as UploadStatus,
      progress: 0,
      error: null,
    }));

    // Cancel any pending auto-hide timer from a previous batch
    if (uploadPanelTimerRef.current !== null) {
      window.clearTimeout(uploadPanelTimerRef.current);
      uploadPanelTimerRef.current = null;
    }

    // Populate the task map and immediately render the panel
    tasksMapRef.current.clear();
    for (const task of initialTasks) {
      tasksMapRef.current.set(task.id, task);
    }
    flushBatchProgress();

    pauseSseForCurrentPath(destinationPath);

    let nextIndex = 0;
    let successCount = 0;
    let failureCount = 0;
    let replaceAll = false;
    let skipAll = false;

    // O(1) task update — no O(N) React state scan
    const updateTask = (taskId: string, update: Partial<UploadTask>) => {
      const existing = tasksMapRef.current.get(taskId);
      if (existing) {
        tasksMapRef.current.set(taskId, { ...existing, ...update });
      }
      scheduleBatchFlush();
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
    if (successCount > 0) {
      onFilesystemMutationComplete?.();
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
      onFilesystemMutationComplete?.();
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
      if (response.results.some((result) => result.success)) {
        onFilesystemMutationComplete?.();
      }
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
      if (response.results.some((result) => result.success)) {
        onFilesystemMutationComplete?.();
      }
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

  function handleFolderAddSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (selectedFiles.length === 0) {
      return;
    }

    // Derive the top-level folder name from the first file's webkitRelativePath
    const firstRelPath = getFileRelativePath(selectedFiles[0]) ?? selectedFiles[0].name;
    const folderName = firstRelPath.split("/")[0] ?? "Folder";

    setActiveDialog((current) => {
      if (!current || current.kind !== "upload-picker") return current;
      return {
        ...current,
        pendingFolders: [...current.pendingFolders, { name: folderName, files: selectedFiles }],
      };
    });
  }

  function submitPendingFolderUpload() {
    if (!activeDialog || activeDialog.kind !== "upload-picker") {
      return;
    }
    const allFiles = activeDialog.pendingFolders.flatMap((folder) => folder.files);
    if (allFiles.length === 0) {
      return;
    }
    setActiveDialog(null);
    if (uploadPanelTimerRef.current !== null) {
      window.clearTimeout(uploadPanelTimerRef.current);
      uploadPanelTimerRef.current = null;
    }
    void performUploadFiles(allFiles, currentPath);
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
    setDropStateIfChanged({ kind: operation, valid: false, targetPath: item.path, targetLabel: item.name });
  }

  function handleFolderDragOver(
    event: React.DragEvent<HTMLElement>,
    folderPath: string,
    folderName: string,
  ) {
    if (isExternalFileDrag(event)) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      setDropStateIfChanged({ kind: "upload", valid: true, targetPath: folderPath, targetLabel: folderName });
      return;
    }

    if (isInternalItemDrag(event)) {
      event.preventDefault();
      event.stopPropagation();
      const operation = isCopyDropMode(event) ? "copy" : "move";
      event.dataTransfer.dropEffect = operation;
      setDropStateIfChanged({ kind: operation, valid: true, targetPath: folderPath, targetLabel: folderName });
    }
  }

  function handleFileDragOver(event: React.DragEvent<HTMLElement>, fileName: string) {
    if (!isExternalFileDrag(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "none";
    setDropStateIfChanged({ kind: "upload", valid: false, targetPath: null, targetLabel: fileName });
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
    if (!isExternalFileDrag(event)) {
      return;
    }
    const droppedFiles = await collectDroppedFiles(event.dataTransfer);
    if (droppedFiles.length === 0) {
      return;
    }
    externalDragDepthRef.current = 0;
    setDropStateIfChanged(null);
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
      externalDragDepthRef.current = 0;
      setDropStateIfChanged(null);
      await fetchListing(currentPath, sortOption, debouncedSearch || undefined);
      if (response.results.some((result) => result.success)) {
        onFilesystemMutationComplete?.();
      }
    } catch (error) {
      const message = getErrorMessage(error, `Unable to ${operation} item.`);
      onNotify(message, "error");
    }
  }

  function clearBatch() {
    if (batchProgress && (batchProgress.uploadingCount > 0 || batchProgress.pendingCount > 0)) {
      return;
    }
    if (uploadPanelTimerRef.current !== null) {
      window.clearTimeout(uploadPanelTimerRef.current);
      uploadPanelTimerRef.current = null;
    }
    if (batchFlushTimerRef.current !== null) {
      window.clearTimeout(batchFlushTimerRef.current);
      batchFlushTimerRef.current = null;
    }
    tasksMapRef.current.clear();
    setBatchProgress(null);
    setShowFailedDetails(false);
  }

  const busyText =
    batchProgress && (batchProgress.uploadingCount > 0 || batchProgress.pendingCount > 0)
      ? `Uploading ${batchProgress.completed} / ${batchProgress.total}`
      : isDialogBusy
        ? "Completing operation..."
        : isLoading
          ? "Loading folder..."
          : "Ready";
  const hasUploadSummary = Boolean(batchProgress && batchProgress.total > 0);
  const statusStripIdle = busyText === "Ready" && !hasUploadSummary;

  const pageSummary = `Showing 1 to ${items.length} of ${items.length} items`;
  const activeSortColumn = getSortColumn(sortOption);
  const activeSortOrder = getSortOrder(sortOption);

  function handleSortColumnClick(column: SortColumn) {
    setSortOption((currentSort) => toggleSortOption(currentSort, column));
  }

  return (
    <section
      className={['file-explorer-panel', dropState ? 'file-explorer-panel-drop-active' : ''].filter(Boolean).join(' ')}
      onDragEnter={(event) => {
        if (!isExternalFileDrag(event)) {
          return;
        }
        externalDragDepthRef.current += 1;
      }}
      onDragOver={(event) => {
        if (!isExternalFileDrag(event)) {
          return;
        }
        event.preventDefault();
        setDropStateIfChanged({ kind: "upload", valid: true, targetPath: currentPath, targetLabel: null });
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        const shouldTrackExternal = isExternalFileDrag(event) || externalDragDepthRef.current > 0;
        if (!shouldTrackExternal) {
          return;
        }
        externalDragDepthRef.current = Math.max(0, externalDragDepthRef.current - 1);
        if (externalDragDepthRef.current === 0) {
          setDropStateIfChanged(null);
        }
      }}
      onDrop={(event) => {
        externalDragDepthRef.current = 0;
        void handleDropUpload(event, currentPath);
      }}
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
        hidden
        onChange={handleFolderAddSelection}
      />

      <div className="file-explorer-header">
        <div>
          <h2 className="file-explorer-title">File Explorer</h2>
          <div className="file-explorer-breadcrumbs" aria-label="Breadcrumb">
            <button
              type="button"
              className="breadcrumb-link breadcrumb-home-button"
              aria-label="Go to storage root"
              title="Go to Home"
              onClick={() => void fetchListing("", sortOption)}
            >
              🏠
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
          <button
            type="button"
            className="secondary-button explorer-action-home-mobile"
            aria-label="Go to storage root"
            title="Home"
            onClick={() => void fetchListing("", sortOption)}
          >
            <span aria-hidden="true">🏠</span>
          </button>
          <button
            type="button"
            className="secondary-button explorer-action-refresh"
            aria-label="Refresh folder listing"
            title="Refresh"
            disabled={isLoading}
            onClick={() => void refreshCurrentListing()}
          >
            <span aria-hidden="true">↻</span>
            <span className="explorer-action-label">Refresh</span>
          </button>
          <button
            type="button"
            className="secondary-button explorer-action-upload"
            aria-label="Upload files or folders"
            title="Upload"
            onClick={openUploadDialog}
          >
            <span aria-hidden="true">↥</span>
            <span className="explorer-action-label">Upload</span>
          </button>
          <button
            type="button"
            className="secondary-button explorer-action-new-folder"
            aria-label="Create folder"
            title="New Folder"
            onClick={openCreateFolderDialog}
          >
            <span aria-hidden="true">⊞</span>
            <span className="explorer-action-label">New Folder</span>
          </button>
          <div className="toolbar-icon-toggle explorer-view-toggle" role="tablist" aria-label="View mode">
            <button
              type="button"
              className={viewMode === "list" ? "toolbar-icon-toggle-active" : ""}
              aria-label="List view"
              title="List view"
              onClick={() => setViewMode("list")}
            >
              <span aria-hidden="true">☰</span>
              <span className="explorer-view-label">List</span>
            </button>
            <button
              type="button"
              className={viewMode === "grid" ? "toolbar-icon-toggle-active" : ""}
              aria-label="Grid view"
              title="Grid view"
              onClick={() => setViewMode("grid")}
            >
              <span aria-hidden="true">▦</span>
              <span className="explorer-view-label">Grid</span>
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
        <div className="command-right explorer-sort-control">
          <select className="explorer-sort-select explorer-sort-select-desktop" value={sortOption} onChange={(event) => setSortOption(event.target.value as SortOption)}>
            <option value="name-asc">Sort by: Name A-Z</option>
            <option value="name-desc">Sort by: Name Z-A</option>
            <option value="type-asc">Sort by: Type A-Z</option>
            <option value="type-desc">Sort by: Type Z-A</option>
            <option value="date-asc">Sort by: Oldest</option>
            <option value="date-desc">Sort by: Newest</option>
            <option value="size-asc">Sort by: Smallest</option>
            <option value="size-desc">Sort by: Largest</option>
          </select>
          <button
            ref={mobileSortButtonRef}
            type="button"
            className="explorer-mobile-sort-trigger"
            aria-label={`Sort by ${getSortColumnLabel(activeSortColumn)} ${activeSortOrder === "asc" ? "ascending" : "descending"}`}
            aria-haspopup="dialog"
            aria-expanded={isMobileSortOpen}
            aria-controls="explorer-mobile-sort-popover"
            title="Sort options"
            onClick={() => setIsMobileSortOpen((current) => !current)}
          >
            <span className="explorer-mobile-sort-trigger-icon" aria-hidden="true">{getSortColumnIcon(activeSortColumn)}</span>
            <span className="explorer-mobile-sort-trigger-label">{`${getSortColumnLabel(activeSortColumn)} ${activeSortOrder === "asc" ? "↑" : "↓"}`}</span>
          </button>
          {isMobileSortOpen ? (
            <div
              id="explorer-mobile-sort-popover"
              ref={mobileSortPopoverRef}
              className="explorer-mobile-sort-popover"
              role="dialog"
              aria-label="Sort files and folders"
            >
              <div className="explorer-mobile-sort-header">
                <strong>Sort by</strong>
                <button
                  type="button"
                  className="icon-only-button"
                  aria-label="Close sort options"
                  onClick={() => setIsMobileSortOpen(false)}
                >
                  ✕
                </button>
              </div>
              <div className="explorer-mobile-sort-groups">
                {MOBILE_SORT_ROWS.map((row) => {
                  const isActive = activeSortColumn === row.column;
                  return (
                    <button
                      key={row.column}
                      type="button"
                      className={`explorer-mobile-sort-row ${isActive ? "explorer-mobile-sort-row-active" : ""}`}
                      aria-pressed={isActive}
                      onClick={() => {
                        setSortOption((currentSort) => toggleSortOption(currentSort, row.column));
                        setIsMobileSortOpen(false);
                      }}
                    >
                      <span className="explorer-mobile-sort-row-left">
                        <span aria-hidden="true">{row.icon}</span>
                        <span>{row.title}</span>
                      </span>
                      {isActive ? <span aria-hidden="true">{activeSortOrder === "asc" ? "↑" : "↓"}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className={`explorer-status-strip ${statusStripIdle ? "explorer-status-strip-idle" : ""}`}>
        <span className="explorer-status-left">
          <span className={`sse-status-dot sse-status-dot-${sseStatus}`} aria-label={`Live updates: ${sseStatus}`} title={`Live updates: ${sseStatus}`} />
          {busyText}
        </span>
        {hasUploadSummary && batchProgress ? (
          <span>{`Completed: ${batchProgress.completed} | Failed: ${batchProgress.failed}`}</span>
        ) : null}
      </div>

      {dropState ? (
        <div className="explorer-drop-indicator" aria-live="polite">
          {getDropMessage(dropState)}
        </div>
      ) : null}

      {batchProgress !== null ? (
        <div className={`explorer-upload-panel ${batchProgress.allFinished ? "explorer-upload-panel-compact" : ""}`}>
          <div className="explorer-upload-panel-header">
            <div className="explorer-upload-heading">
              {batchProgress.allSuccessful ? (
                <strong>✓ Upload complete</strong>
              ) : batchProgress.allFinished ? (
                <strong>Upload finished</strong>
              ) : (
                <strong>Uploads</strong>
              )}
              {batchProgress.allSuccessful ? (
                <span>
                  {batchProgress.total.toLocaleString()} / {batchProgress.total.toLocaleString()} files
                  {batchProgress.totalBytes > 0 ? ` • ${formatFileSize(batchProgress.totalBytes)} uploaded` : ""}
                </span>
              ) : batchProgress.allFinished ? (
                <span>
                  {batchProgress.completed.toLocaleString()} completed
                  {batchProgress.failed > 0 ? ` • ${batchProgress.failed} failed` : ""}
                  {batchProgress.totalBytes > 0 ? ` • ${formatFileSize(batchProgress.totalBytes)} processed` : ""}
                </span>
              ) : (
                <span>
                  Uploading {batchProgress.completed.toLocaleString()} / {batchProgress.total.toLocaleString()} files
                </span>
              )}
            </div>
            <div className="explorer-upload-actions">
              {batchProgress.allFinished && batchProgress.failed > 0 ? (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setShowFailedDetails((v) => !v)}
                >
                  {showFailedDetails ? "Hide details" : "View failed files"}
                </button>
              ) : null}
              <button
                type="button"
                className="ghost-button"
                disabled={!batchProgress.allFinished}
                onClick={clearBatch}
              >
                Clear
              </button>
            </div>
          </div>

          {/* Single aggregate progress bar for the entire batch */}
          <div className="upload-aggregate-progress-wrap">
            <div className="explorer-upload-progress upload-aggregate-bar">
              <span style={{ width: `${batchProgress.overallPercent}%` }} />
            </div>
            <span className="upload-aggregate-pct">{batchProgress.overallPercent}%</span>
          </div>

          {/* Byte-level progress */}
          {batchProgress.totalBytes > 0 && !batchProgress.allFinished ? (
            <div className="upload-aggregate-bytes">
              {formatFileSize(batchProgress.uploadedBytes)} / {formatFileSize(batchProgress.totalBytes)}
            </div>
          ) : null}

          {/* Current file indicator */}
          {batchProgress.activeFileNames.length > 0 ? (
            <div className="upload-aggregate-current">
              Uploading:{" "}
              <span title={batchProgress.activeFileNames.join(", ")}>
                {batchProgress.activeFileNames[0]}
                {batchProgress.uploadingCount > 1
                  ? ` + ${batchProgress.uploadingCount - 1} other`
                  : ""}
              </span>
            </div>
          ) : null}

          {/* Failed file details — only rendered when user expands */}
          {showFailedDetails && batchProgress.failed > 0 ? (
            <div className="explorer-upload-list upload-failed-details">
              {Array.from(tasksMapRef.current.values())
                .filter((t) => t.status === "failed")
                .map((task) => (
                  <div key={task.id} className="explorer-upload-row">
                    <div className="explorer-upload-meta">
                      <strong>{task.name}</strong>
                      <span>failed</span>
                    </div>
                    {task.error ? (
                      <span className="explorer-upload-error">{task.error}</span>
                    ) : null}
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
                <th aria-sort={activeSortColumn === "name" ? (activeSortOrder === "asc" ? "ascending" : "descending") : "none"}>
                  <button
                    type="button"
                    className={`explorer-sort-button ${activeSortColumn === "name" ? "explorer-sort-button-active" : ""}`}
                    onClick={() => handleSortColumnClick("name")}
                    aria-label={`Sort by Name ${activeSortColumn === "name" && activeSortOrder === "asc" ? "descending" : "ascending"}`}
                  >
                    <span>Name</span>
                    {activeSortColumn === "name" ? <span>{activeSortOrder === "asc" ? "↑" : "↓"}</span> : null}
                  </button>
                </th>
                <th aria-sort={activeSortColumn === "type" ? (activeSortOrder === "asc" ? "ascending" : "descending") : "none"}>
                  <button
                    type="button"
                    className={`explorer-sort-button ${activeSortColumn === "type" ? "explorer-sort-button-active" : ""}`}
                    onClick={() => handleSortColumnClick("type")}
                    aria-label={`Sort by Type ${activeSortColumn === "type" && activeSortOrder === "asc" ? "descending" : "ascending"}`}
                  >
                    <span>Type</span>
                    {activeSortColumn === "type" ? <span>{activeSortOrder === "asc" ? "↑" : "↓"}</span> : null}
                  </button>
                </th>
                <th aria-sort={activeSortColumn === "size" ? (activeSortOrder === "asc" ? "ascending" : "descending") : "none"}>
                  <button
                    type="button"
                    className={`explorer-sort-button ${activeSortColumn === "size" ? "explorer-sort-button-active" : ""}`}
                    onClick={() => handleSortColumnClick("size")}
                    aria-label={`Sort by Size ${activeSortColumn === "size" && activeSortOrder === "asc" ? "descending" : "ascending"}`}
                  >
                    <span>Size</span>
                    {activeSortColumn === "size" ? <span>{activeSortOrder === "asc" ? "↑" : "↓"}</span> : null}
                  </button>
                </th>
                <th aria-sort={activeSortColumn === "modified_at" ? (activeSortOrder === "asc" ? "ascending" : "descending") : "none"}>
                  <button
                    type="button"
                    className={`explorer-sort-button ${activeSortColumn === "modified_at" ? "explorer-sort-button-active" : ""}`}
                    onClick={() => handleSortColumnClick("modified_at")}
                    aria-label={`Sort by Date Modified ${activeSortColumn === "modified_at" && activeSortOrder === "asc" ? "descending" : "ascending"}`}
                  >
                    <span>Date Modified</span>
                    {activeSortColumn === "modified_at" ? <span>{activeSortOrder === "asc" ? "↑" : "↓"}</span> : null}
                  </button>
                </th>
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
                    onDragEnd={() => setDropStateIfChanged(null)}
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
                        setDropStateIfChanged(null);
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
                onDragEnd={() => setDropStateIfChanged(null)}
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
                    setDropStateIfChanged(null);
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
            <p className="explorer-dialog-copy">
              {activeDialog.pendingFolders.length === 0
                ? "Choose files, or select one or more folders to upload with their full folder structure."
                : null}
            </p>
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
                onClick={() => folderInputRef.current?.click()}
              >
                {activeDialog.pendingFolders.length === 0 ? "Choose folder" : "Add another folder"}
              </button>
            </div>

            {activeDialog.pendingFolders.length > 0 ? (
              <>
                <div className="upload-picker-folder-list">
                  {activeDialog.pendingFolders.map((folder, index) => (
                    <div key={`${folder.name}-${index}`} className="upload-picker-folder-row">
                      <span className="upload-picker-folder-icon" aria-hidden="true">📁</span>
                      <span className="upload-picker-folder-name">{folder.name}</span>
                      <span className="upload-picker-folder-count">{folder.files.length.toLocaleString()} files</span>
                      <button
                        type="button"
                        className="icon-only-button"
                        aria-label={`Remove ${folder.name}`}
                        onClick={() =>
                          setActiveDialog((current) => {
                            if (!current || current.kind !== "upload-picker") return current;
                            return {
                              ...current,
                              pendingFolders: current.pendingFolders.filter((_, i) => i !== index),
                            };
                          })
                        }
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <div className="upload-picker-summary">
                  {activeDialog.pendingFolders.length} folder{activeDialog.pendingFolders.length !== 1 ? "s" : ""}
                  {" • "}
                  {activeDialog.pendingFolders
                    .reduce((total, folder) => total + folder.files.length, 0)
                    .toLocaleString()}{" "}
                  files total
                </div>
              </>
            ) : null}
          </div>
          <div className="explorer-dialog-actions">
            <button type="button" className="ghost-button" onClick={closeDialog}>
              Cancel
            </button>
            {activeDialog.pendingFolders.length > 0 ? (
              <button type="button" onClick={submitPendingFolderUpload}>
                Upload{" "}
                {activeDialog.pendingFolders
                  .reduce((total, folder) => total + folder.files.length, 0)
                  .toLocaleString()}{" "}
                files
              </button>
            ) : null}
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
