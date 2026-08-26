import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { storageApi } from "../../api/storageApi";
import { useDebounce } from "../../hooks/useDebounce";
import { useFileSSE } from "../../hooks/useFileSSE";
import type { FileListItem } from "../../types/api";

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
type ClipboardMode = "cut" | "copy";

type ClipboardState = {
  mode: ClipboardMode;
  itemPaths: string[];
} | null;

type ExplorerItem = {
  id: string;
  name: string;
  type: string;
  size: string;
  modified: string;
  kind: "folder" | "file";
  path: string;
  icon: string;
  extension: string | null;
  sizeBytes: number | null;
};

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
  if ([".jpg", ".jpeg", ".png", ".gif", ".svg", ".bmp"].includes(extension)) {
    return "🖼";
  }
  if ([".mp4", ".mkv", ".avi"].includes(extension)) {
    return "🎞";
  }
  if ([".mp3", ".wav", ".flac", ".aac", ".ogg"].includes(extension)) {
    return "🎵";
  }
  if (extension === ".zip") {
    return "🗜";
  }
  if ([".tar", ".gz", ".7z", ".rar", ".bz2"].includes(extension)) {
    return "🗜";
  }
  if (extension === ".pdf") {
    return "📕";
  }
  if ([".txt", ".md", ".log"].includes(extension)) {
    return "📄";
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
  if ([".ts", ".tsx", ".js", ".jsx", ".json"].includes(extension)) {
    return "📜";
  }
  if ([".html", ".htm", ".css", ".scss"].includes(extension)) {
    return "🌐";
  }
  return "📄";
}

function toExplorerItem(item: FileListItem): ExplorerItem {
  return {
    id: item.path || item.name,
    name: item.name,
    type: item.type,
    size: formatBytes(item.size),
    modified: formatModifiedDate(item.modified_at),
    kind: item.is_directory ? "folder" : "file",
    path: normalizeRelativePath(item.path),
    icon: iconForItem(item),
    extension: item.extension,
    sizeBytes: item.size,
  };
}

function toApiPath(relativePath: string): string {
  return relativePath === "" ? "/" : relativePath;
}

function formatClipboardSummary(itemCount: number, mode: ClipboardMode): string {
  return `${itemCount} item${itemCount === 1 ? "" : "s"} ready to ${mode === "cut" ? "move" : "copy"}`;
}

export function FileExplorer({ onNotify }: FileExplorerProps) {
  const [items, setItems] = useState<ExplorerItem[]>([]);
  const [currentPath, setCurrentPath] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortOption, setSortOption] = useState<SortOption>("name-asc");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dragIntent, setDragIntent] = useState<ClipboardMode>("cut");
  const [externalDragActive, setExternalDragActive] = useState(false);
  const [clipboard, setClipboard] = useState<ClipboardState>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const debouncedSearch = useDebounce(searchTerm, 350);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const previousSseStatusRef = useRef<string | null>(null);

  const breadcrumbs = useMemo(() => normalizeRelativePath(currentPath).split("/").filter(Boolean), [currentPath]);
  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.includes(item.id)),
    [items, selectedIds],
  );

  const allVisibleSelected = items.length > 0 && items.every((item) => selectedIds.includes(item.id));

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
      } catch {
        setErrorMessage("Unable to load this folder.");
        onNotify("Unable to list files for the selected folder.", "error");
      } finally {
        setIsLoading(false);
      }
    },
    [onNotify],
  );

  useEffect(() => {
    void fetchListing(currentPath, sortOption, debouncedSearch || undefined);
  }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const { status: sseStatus } = useFileSSE(currentPath, (_event) => {
    void fetchListing(currentPath, sortOption, debouncedSearch || undefined);
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

      if ((event.ctrlKey || event.metaKey) && event.key === "a" && !isInInput) {
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
        const fallbackIndex = direction > 0 ? 0 : items.length - 1;
        const baseIndex = currentIndex >= 0 ? currentIndex : fallbackIndex;
        const nextIndex = Math.max(0, Math.min(items.length - 1, baseIndex + (currentIndex >= 0 ? direction : 0)));
        const nextItem = items[nextIndex];
        if (nextItem) {
          setSelectedIds([nextItem.id]);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [items, selectedIds]);

  function notifyUnavailableAction(actionLabel: string, tone: NotifyTone = "info") {
    onNotify(`${actionLabel} will be available in a later phase.`, tone);
    setOpenMenuId(null);
  }

  function toggleSelectItem(itemId: string) {
    setSelectedIds((currentIds) =>
      currentIds.includes(itemId)
        ? currentIds.filter((currentId) => currentId !== itemId)
        : [...currentIds, itemId],
    );
  }

  function toggleSelectAllVisible() {
    if (allVisibleSelected) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(items.map((item) => item.id));
  }

  async function handleOpen(item: ExplorerItem) {
    if (item.kind !== "folder") {
      onNotify(`${item.name} preview is planned for a later phase.`, "info");
      return;
    }
    setOpenMenuId(null);
    setSearchTerm("");
    await fetchListing(item.path, sortOption);
  }

  function setClipboardFromSelection(mode: ClipboardMode, fallbackItem?: ExplorerItem) {
    const selectedPaths = selectedItems.map((item) => item.path);
    const basePaths = selectedPaths.length > 0 ? selectedPaths : fallbackItem ? [fallbackItem.path] : [];

    if (basePaths.length === 0) {
      onNotify("Select at least one item first.", "info");
      return;
    }

    setClipboard({ mode, itemPaths: basePaths });
    onNotify(formatClipboardSummary(basePaths.length, mode), "info");
    setOpenMenuId(null);
  }

  function handlePlaceholderUpload() {
    notifyUnavailableAction("Upload");
  }

  function handlePlaceholderCreateFolder() {
    notifyUnavailableAction("Create folder");
  }

  function handlePlaceholderDownload() {
    notifyUnavailableAction("Download");
    setOpenMenuId(null);
  }

  function handlePlaceholderMove() {
    notifyUnavailableAction("Move");
    setOpenMenuId(null);
  }

  function handlePlaceholderCopy() {
    notifyUnavailableAction("Copy");
    setOpenMenuId(null);
  }

  function handlePlaceholderDelete() {
    notifyUnavailableAction("Delete");
    setOpenMenuId(null);
  }

  function handlePlaceholderPaste() {
    if (!clipboard || clipboard.itemPaths.length === 0) {
      onNotify("Clipboard is empty.", "info");
      return;
    }
    notifyUnavailableAction(clipboard.mode === "cut" ? "Move" : "Copy");
  }

  function handleProperties(item: ExplorerItem) {
    onNotify(`${item.name}: ${item.type}, ${item.size}, ${item.modified}`, "info");
    setOpenMenuId(null);
  }

  function onInternalDragStart(event: React.DragEvent<HTMLElement>, item: ExplorerItem) {
    setDraggedItemId(item.id);
    setDragIntent(event.ctrlKey || event.metaKey ? "copy" : "cut");
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData("text/plain", item.path);
  }

  function onInternalDragEnd() {
    setDraggedItemId(null);
    setDropTargetId(null);
    setDragIntent("cut");
  }

  function onExternalDragEnter(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    setExternalDragActive(true);
  }

  function onExternalDragOver(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    setExternalDragActive(true);
    if (event.dataTransfer.types.includes("Files")) {
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function onExternalDragLeave(event: React.DragEvent<HTMLElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setExternalDragActive(false);
  }

  function onExplorerDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    setExternalDragActive(false);
    if (event.dataTransfer.files.length > 0) {
      notifyUnavailableAction("Upload");
    }
  }

  function onFolderDrop(event: React.DragEvent<HTMLElement>, item: ExplorerItem) {
    event.preventDefault();
    event.stopPropagation();
    setDropTargetId(null);

    const draggedItem = items.find((entry) => entry.id === draggedItemId);
    if (!draggedItem || draggedItem.id === item.id || item.kind !== "folder") {
      return;
    }

    if (event.ctrlKey || event.metaKey || dragIntent === "copy") {
      handlePlaceholderCopy();
      return;
    }
    handlePlaceholderMove();
  }

  async function handleSortChange(nextSort: SortOption) {
    setSortOption(nextSort);
    await fetchListing(currentPath, nextSort, debouncedSearch || undefined);
  }

  const busyText = isLoading ? "Loading folder..." : "Ready";
  const pageSummary = `Showing 1 to ${items.length} of ${items.length} items`;

  return (
    <section
      className={`file-explorer-panel ${externalDragActive ? "file-explorer-panel-drop-active" : ""}`}
      onDragEnter={onExternalDragEnter}
      onDragOver={onExternalDragOver}
      onDragLeave={onExternalDragLeave}
      onDrop={onExplorerDrop}
    >
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
          <button
            type="button"
            className="secondary-button"
            aria-label="Refresh directory listing"
            disabled={isLoading}
            onClick={() => void fetchListing(currentPath, sortOption, debouncedSearch || undefined)}
          >
            ↻ Refresh
          </button>
          <button type="button" className="secondary-button" onClick={handlePlaceholderUpload}>
            ↥ Upload
          </button>
          <button type="button" className="secondary-button" onClick={handlePlaceholderCreateFolder}>
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
          <button
            type="button"
            className="icon-only-button"
            aria-label="More explorer actions"
            onClick={() => onNotify("More actions coming later.", "info")}
          >
            ...
          </button>
        </div>
      </div>

      <div className="file-explorer-search-row">
        <label className="explorer-search-field">
          <input
            ref={searchInputRef}
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search files and folders…"
          />
          <span aria-hidden="true">🔎</span>
        </label>
      </div>

      <div className="file-explorer-command-row">
        <div className="command-left">
          <button
            type="button"
            className="icon-only-button"
            aria-label="Select all"
            onClick={toggleSelectAllVisible}
          >
            ☐
          </button>
          <button type="button" className="ghost-button" onClick={() => setClipboardFromSelection("cut")}>
            Cut
          </button>
          <button type="button" className="ghost-button" onClick={() => setClipboardFromSelection("copy")}>
            Copy
          </button>
          <button type="button" className="ghost-button" onClick={handlePlaceholderPaste}>
            Paste
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={selectedItems.length === 0}
            onClick={handlePlaceholderDelete}
          >
            Delete
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={selectedItems.length === 0}
            onClick={handlePlaceholderDownload}
          >
            Download
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => onNotify("Bulk actions menu is placeholder-only.", "info")}
          >
            More ▾
          </button>
        </div>

        <div className="command-right">
          <select
            value={sortOption}
            onChange={(event) => {
              void handleSortChange(event.target.value as SortOption);
            }}
          >
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
            type="button"
            className="icon-only-button"
            aria-label="Filter items"
            onClick={() => onNotify("Filter UI is placeholder-only.", "info")}
          >
            ⌕
          </button>
        </div>
      </div>

      <div className="explorer-status-strip">
        <span className="explorer-status-left">
          <span className={`sse-status-dot sse-status-dot-${sseStatus}`} aria-label={`Live updates: ${sseStatus}`} title={`Live updates: ${sseStatus}`} />
          {busyText}
        </span>
        <span>
          {clipboard
            ? formatClipboardSummary(clipboard.itemPaths.length, clipboard.mode)
            : "Browse live filesystem changes or refresh manually at any time."}
        </span>
      </div>

      {selectedItems.length > 0 ? (
        <div className="explorer-bulk-toolbar" role="toolbar" aria-label="Bulk actions">
          <span className="bulk-count">{selectedItems.length} item{selectedItems.length !== 1 ? "s" : ""} selected</span>
          <button
            type="button"
            className="ghost-button"
            onClick={() => onNotify("Copy will be available in a later phase.", "info")}
          >
            Copy
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => onNotify("Move will be available in a later phase.", "info")}
          >
            Move
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => onNotify("Download will be available in a later phase.", "info")}
          >
            ⤓ Download
          </button>
          <button
            type="button"
            className="ghost-button danger-soft-button"
            onClick={() => onNotify("Delete will be available in a later phase.", "info")}
          >
            🗑 Delete
          </button>
          <button
            type="button"
            className="ghost-button"
            aria-label="Clear selection"
            onClick={() => setSelectedIds([])}
          >
            ✕ Clear
          </button>
        </div>
      ) : null}

      {errorMessage ? (
        <div className="explorer-error-state">
          <span className="explorer-error-icon">⚠</span>
          <p>{errorMessage}</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void fetchListing(currentPath, sortOption, debouncedSearch || undefined)}
          >
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
            {debouncedSearch
              ? `No results matching "${debouncedSearch}"`
              : "No files or folders to display."}
          </p>
        </div>
      ) : null}

      <div className={`explorer-results explorer-results-${viewMode} ${isLoading ? "explorer-results-hidden" : ""}`}>
        <div className="explorer-table-shell">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAllVisible}
                    aria-label="Select all visible items"
                  />
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
                const isDropTarget = dropTargetId === item.id;
                const menuIsOpen = openMenuId === item.id;

                return (
                  <tr
                    key={item.id}
                    className={[
                      isSelected ? "explorer-row-selected" : "",
                      item.kind === "folder" ? "explorer-row-folder" : "",
                      isDropTarget ? "explorer-row-drop-target" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    draggable
                    onDragStart={(event) => onInternalDragStart(event, item)}
                    onDragEnd={onInternalDragEnd}
                    onDragOver={(event) => {
                      if (item.kind === "folder") {
                        event.preventDefault();
                        setDropTargetId(item.id);
                        setDragIntent(event.ctrlKey || event.metaKey ? "copy" : "cut");
                      }
                    }}
                    onDragLeave={() => setDropTargetId((currentId) => (currentId === item.id ? null : currentId))}
                    onDrop={(event) => void onFolderDrop(event, item)}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectItem(item.id)}
                        aria-label={`Select ${item.name}`}
                      />
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
                            <button type="button" onClick={() => void handleOpen(item)}>
                              {item.kind === "folder" ? "📂 Open" : "👁 Preview"}
                            </button>
                            <button type="button" className="explorer-action-disabled" onClick={handlePlaceholderDownload}>
                              ⤓ Download
                            </button>
                            <button
                              type="button"
                              className="explorer-action-disabled"
                              onClick={() => notifyUnavailableAction("Rename")}
                            >
                              ✏ Rename
                            </button>
                            <button
                              type="button"
                              className="explorer-action-disabled"
                              onClick={handlePlaceholderMove}
                            >
                              ↗ Move
                            </button>
                            <button
                              type="button"
                              className="explorer-action-disabled"
                              onClick={handlePlaceholderCopy}
                            >
                              ⧉ Copy
                            </button>
                            <button
                              type="button"
                              className="explorer-action-danger explorer-action-disabled"
                              onClick={handlePlaceholderDelete}
                            >
                              🗑 Delete
                            </button>
                            <button type="button" onClick={() => handleProperties(item)}>
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
              >
                <div className="explorer-mobile-card-header">
                  <label className="explorer-mobile-checkbox">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectItem(item.id)}
                      aria-label={`Select ${item.name}`}
                    />
                    <span className={`explorer-file-icon explorer-file-icon-${item.kind}`} aria-hidden="true">
                      {item.icon}
                    </span>
                  </label>

                  <button
                    type="button"
                    className="explorer-item-button explorer-mobile-open"
                    onClick={() => void handleOpen(item)}
                  >
                    <strong>{item.name}</strong>
                    <span>{item.type}</span>
                  </button>

                  <button
                    type="button"
                    className="icon-only-button"
                    aria-expanded={menuIsOpen}
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
                    <button type="button" onClick={() => void handleOpen(item)}>
                      {item.kind === "folder" ? "📂 Open" : "👁 Preview"}
                    </button>
                    <button
                      type="button"
                      className="explorer-action-disabled"
                      onClick={handlePlaceholderDownload}
                    >
                      ⤓ Download
                    </button>
                    <button
                      type="button"
                      className="explorer-action-disabled"
                      onClick={() => notifyUnavailableAction("Rename")}
                    >
                      ✏ Rename
                    </button>
                    <button type="button" className="ghost-button" onClick={() => handleProperties(item)}>
                      ℹ Properties
                    </button>
                    <button
                      type="button"
                      className="danger-soft-button explorer-action-disabled"
                      onClick={handlePlaceholderDelete}
                    >
                      🗑 Delete
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
        <div className="explorer-footer-controls">
          <select defaultValue="25">
            <option value="25">25 per page</option>
            <option value="50">50 per page</option>
            <option value="100">100 per page</option>
          </select>
          <div className="pagination-shell">
            <button type="button" className="icon-only-button">
              |‹
            </button>
            <button type="button" className="icon-only-button">
              ‹
            </button>
            <button type="button" className="pagination-current">
              1
            </button>
            <button type="button" className="icon-only-button">
              ›
            </button>
            <button type="button" className="icon-only-button">
              ›|
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
