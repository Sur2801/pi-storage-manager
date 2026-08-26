import { useMemo, useState } from "react";

import { storageApi } from "../../api/storageApi";
import type { ApiResponse } from "../../types/api";

type NotifyTone = "info" | "success" | "error";
type SortOption = "name-asc" | "name-desc" | "date-desc" | "size-desc";
type ViewMode = "list" | "grid";
type ClipboardMode = "cut" | "copy";

type ClipboardState = {
  mode: ClipboardMode;
  itemIds: string[];
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
};

type FileExplorerProps = {
  onNotify: (message: string, tone?: NotifyTone) => void;
  statusMessage: string;
};

const initialItems: ExplorerItem[] = [
  {
    id: "folder-documents",
    name: "Documents",
    type: "Folder",
    size: "—",
    modified: "Aug 20, 2026 06:40 PM",
    kind: "folder",
    path: "/Storage Root/Documents",
    icon: "📁",
  },
  {
    id: "folder-photos",
    name: "Photos",
    type: "Folder",
    size: "—",
    modified: "Aug 21, 2026 07:12 AM",
    kind: "folder",
    path: "/Storage Root/Photos",
    icon: "📁",
  },
  {
    id: "folder-music",
    name: "Music",
    type: "Folder",
    size: "—",
    modified: "Aug 21, 2026 08:15 AM",
    kind: "folder",
    path: "/Storage Root/Music",
    icon: "📁",
  },
  {
    id: "file-backup",
    name: "backup.zip",
    type: "ZIP Archive",
    size: "780 MB",
    modified: "Aug 23, 2026 09:05 AM",
    kind: "file",
    path: "/Storage Root/backup.zip",
    icon: "🗜",
  },
  {
    id: "file-notes",
    name: "notes.txt",
    type: "Text File",
    size: "4 KB",
    modified: "Aug 25, 2026 10:11 PM",
    kind: "file",
    path: "/Storage Root/notes.txt",
    icon: "📄",
  },
  {
    id: "file-plan",
    name: "project-plan.pdf",
    type: "PDF File",
    size: "2.4 MB",
    modified: "Aug 25, 2026 11:30 PM",
    kind: "file",
    path: "/Storage Root/project-plan.pdf",
    icon: "📕",
  },
];

const actionLabels = {
  refresh: "Refresh",
  upload: "Upload",
  createFolder: "Create folder",
  rename: "Rename",
  move: "Move",
  copy: "Copy",
  delete: "Delete",
  download: "Download",
  properties: "Properties",
} as const;

function fileSizeToBytes(size: string): number {
  if (size === "—") {
    return -1;
  }

  const [rawValue, rawUnit] = size.split(" ");
  const value = Number(rawValue);
  const unit = rawUnit?.toUpperCase();

  if (Number.isNaN(value) || !unit) {
    return 0;
  }

  const multipliers: Record<string, number> = {
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
  };

  return value * (multipliers[unit] ?? 1);
}

function formatClipboardSummary(itemCount: number, mode: ClipboardMode): string {
  return `${itemCount} item${itemCount === 1 ? "" : "s"} ready to ${mode === "cut" ? "move" : "copy"}`;
}

export function FileExplorer({ onNotify, statusMessage }: FileExplorerProps) {
  const [items] = useState<ExplorerItem[]>(initialItems);
  const [currentPath, setCurrentPath] = useState("/Storage Root/Documents");
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
  const [busyLabel, setBusyLabel] = useState<string | null>(null);

  const breadcrumbs = useMemo(() => currentPath.split("/").filter(Boolean), [currentPath]);

  const visibleItems = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const filteredItems = items.filter((item) => {
      if (!normalizedSearch) {
        return true;
      }

      return (
        item.name.toLowerCase().includes(normalizedSearch) ||
        item.type.toLowerCase().includes(normalizedSearch)
      );
    });

    return [...filteredItems].sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "folder" ? -1 : 1;
      }

      switch (sortOption) {
        case "name-desc":
          return right.name.localeCompare(left.name);
        case "date-desc":
          return new Date(right.modified).getTime() - new Date(left.modified).getTime();
        case "size-desc":
          return fileSizeToBytes(right.size) - fileSizeToBytes(left.size);
        case "name-asc":
        default:
          return left.name.localeCompare(right.name);
      }
    });
  }, [items, searchTerm, sortOption]);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.includes(item.id)),
    [items, selectedIds],
  );

  const allVisibleSelected =
    visibleItems.length > 0 && visibleItems.every((item) => selectedIds.includes(item.id));

  async function runPlaceholderAction(
    label: string,
    action: () => Promise<ApiResponse>,
    successTone: NotifyTone = "success",
  ) {
    setBusyLabel(label);

    try {
      const response = await action();
      onNotify(response.message, successTone);
    } catch {
      onNotify(`${label} placeholder request failed.`, "error");
    } finally {
      setBusyLabel(null);
    }
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
      setSelectedIds((currentIds) =>
        currentIds.filter((itemId) => !visibleItems.some((item) => item.id === itemId)),
      );
      return;
    }

    setSelectedIds((currentIds) => {
      const nextIds = new Set(currentIds);
      visibleItems.forEach((item) => nextIds.add(item.id));
      return [...nextIds];
    });
  }

  function setClipboardFromSelection(mode: ClipboardMode, fallbackItem?: ExplorerItem) {
    const baseIds = selectedIds.length > 0 ? selectedIds : fallbackItem ? [fallbackItem.id] : [];

    if (baseIds.length === 0) {
      onNotify("Select at least one item first.", "info");
      return;
    }

    setClipboard({ mode, itemIds: baseIds });
    onNotify(formatClipboardSummary(baseIds.length, mode), "info");
    setOpenMenuId(null);
  }

  async function handleOpen(item: ExplorerItem) {
    if (item.kind !== "folder") {
      onNotify(`${item.name} preview is planned for a later phase.`, "info");
      return;
    }

    setCurrentPath(item.path);
    setOpenMenuId(null);
    await runPlaceholderAction(actionLabels.refresh, () => storageApi.listFiles(item.path), "info");
  }

  async function handleUpload() {
    await runPlaceholderAction(actionLabels.upload, () =>
      storageApi.upload({
        destination_path: currentPath,
        item_name: "placeholder-upload.txt",
      }),
    );
  }

  async function handleCreateFolder() {
    await runPlaceholderAction(actionLabels.createFolder, () =>
      storageApi.createFolder({
        parent_path: currentPath,
        folder_name: "New Folder",
      }),
    );
  }

  async function handleDownload(item: ExplorerItem) {
    await runPlaceholderAction(actionLabels.download, () => storageApi.download(item.path));
    setOpenMenuId(null);
  }

  async function handleRename(item: ExplorerItem) {
    await runPlaceholderAction(actionLabels.rename, () =>
      storageApi.rename({
        source_path: item.path,
        new_name: `renamed-${item.name}`,
      }),
    );
    setOpenMenuId(null);
  }

  async function handleMove(item: ExplorerItem, destinationPath = currentPath) {
    await runPlaceholderAction(actionLabels.move, () =>
      storageApi.move({
        source_path: item.path,
        destination_path: destinationPath,
      }),
    );
    setOpenMenuId(null);
  }

  async function handleCopy(item: ExplorerItem, destinationPath = currentPath) {
    await runPlaceholderAction(actionLabels.copy, () =>
      storageApi.copy({
        source_path: item.path,
        destination_path: destinationPath,
      }),
    );
    setOpenMenuId(null);
  }

  async function handleDelete(itemsToDelete: ExplorerItem[]) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete ${itemsToDelete.length} selected item(s)? This is still placeholder-only.`)
    ) {
      return;
    }

    await runPlaceholderAction(actionLabels.delete, () =>
      storageApi.deleteItems({
        target_paths: itemsToDelete.map((item) => item.path),
      }),
    );
    setOpenMenuId(null);
  }

  async function handlePaste() {
    if (!clipboard) {
      onNotify("Clipboard is empty.", "info");
      return;
    }

    const clipboardItems = items.filter((item) => clipboard.itemIds.includes(item.id));
    const action = clipboard.mode === "cut" ? storageApi.move : storageApi.copy;
    const label = clipboard.mode === "cut" ? actionLabels.move : actionLabels.copy;

    await runPlaceholderAction(label, async () => {
      const [firstItem] = clipboardItems;
      if (!firstItem) {
        return { success: true, message: "Nothing to paste." };
      }

      return action({
        source_path: firstItem.path,
        destination_path: currentPath,
      });
    });
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

  async function onExplorerDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    setExternalDragActive(false);

    if (event.dataTransfer.files.length > 0) {
      const firstFile = event.dataTransfer.files[0];
      await runPlaceholderAction(actionLabels.upload, () =>
        storageApi.upload({
          destination_path: currentPath,
          item_name: firstFile.name,
        }),
      );
    }
  }

  async function onFolderDrop(event: React.DragEvent<HTMLElement>, item: ExplorerItem) {
    event.preventDefault();
    event.stopPropagation();
    setDropTargetId(null);

    const draggedItem = items.find((entry) => entry.id === draggedItemId);
    if (!draggedItem || draggedItem.id === item.id || item.kind !== "folder") {
      return;
    }

    if (event.ctrlKey || event.metaKey || dragIntent === "copy") {
      await handleCopy(draggedItem, item.path);
      return;
    }

    await handleMove(draggedItem, item.path);
  }

  const busyText = busyLabel ? `${busyLabel} placeholder request in progress...` : statusMessage;
  const pageSummary = `Showing 1 to ${visibleItems.length} of ${visibleItems.length} items`;

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
            <button type="button" className="breadcrumb-link" onClick={() => setCurrentPath("/Storage Root")}>
              ⌂
            </button>
            {breadcrumbs.map((segment, index) => (
              <span key={`${segment}-${index}`} className="breadcrumb-node">
                <span className="breadcrumb-divider">›</span>
                <button type="button" className="breadcrumb-link">
                  {segment}
                </button>
              </span>
            ))}
          </div>
        </div>

        <div className="file-explorer-header-actions">
          <button type="button" onClick={() => void handleUpload()}>
            ↥ Upload
          </button>
          <button type="button" className="secondary-button" onClick={() => void handleCreateFolder()}>
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
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search in current folder..."
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
          <button type="button" className="ghost-button" onClick={() => void handlePaste()}>
            Paste
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={selectedItems.length === 0}
            onClick={() => void handleDelete(selectedItems)}
          >
            Delete
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={selectedItems.length === 0}
            onClick={() => void handleDownload(selectedItems[0])}
          >
            Download
          </button>
          <button type="button" className="ghost-button" onClick={() => onNotify("Bulk actions menu is placeholder-only.", "info")}>
            More ▾
          </button>
        </div>

        <div className="command-right">
          <select value={sortOption} onChange={(event) => setSortOption(event.target.value as SortOption)}>
            <option value="name-asc">Sort by: Name A-Z</option>
            <option value="name-desc">Sort by: Name Z-A</option>
            <option value="date-desc">Sort by: Newest</option>
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
        <span>{busyText}</span>
        <span>{clipboard ? formatClipboardSummary(clipboard.itemIds.length, clipboard.mode) : "Drag files here to upload or drag onto folders to move/copy."}</span>
      </div>

      <div className={`explorer-results explorer-results-${viewMode}`}>
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
              {visibleItems.map((item) => {
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
                              Open
                            </button>
                            <button type="button" onClick={() => void handleDownload(item)}>
                              Download
                            </button>
                            <button type="button" onClick={() => void handleRename(item)}>
                              Rename
                            </button>
                            <button type="button" onClick={() => void handleMove(item)}>
                              Move
                            </button>
                            <button type="button" onClick={() => void handleCopy(item)}>
                              Copy
                            </button>
                            <button type="button" onClick={() => void handleDelete([item])} className="explorer-action-danger">
                              Delete
                            </button>
                            <button type="button" onClick={() => handleProperties(item)}>
                              Properties
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
          {visibleItems.map((item) => {
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

                  <button type="button" className="explorer-item-button explorer-mobile-open" onClick={() => void handleOpen(item)}>
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
                    <button type="button" onClick={() => void handleDownload(item)}>
                      Download
                    </button>
                    <button type="button" onClick={() => void handleRename(item)}>
                      Rename
                    </button>
                    <button type="button" className="ghost-button" onClick={() => handleProperties(item)}>
                      Properties
                    </button>
                    <button type="button" className="danger-soft-button" onClick={() => void handleDelete([item])}>
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
