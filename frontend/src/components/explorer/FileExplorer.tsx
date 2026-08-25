type ExplorerRow = {
  name: string;
  type: string;
  size: string;
  modified: string;
};

const rows: ExplorerRow[] = [
  { name: "Documents", type: "Folder", size: "-", modified: "2026-08-20 18:40" },
  { name: "Photos", type: "Folder", size: "-", modified: "2026-08-21 07:12" },
  { name: "backup.zip", type: "ZIP Archive", size: "780 MB", modified: "2026-08-23 09:05" },
  { name: "notes.txt", type: "Text File", size: "4 KB", modified: "2026-08-25 22:11" },
];

export function FileExplorer() {
  return (
    <section className="card explorer-card">
      <div className="section-header explorer-toolbar">
        <h2>File Explorer</h2>
        <div className="toolbar-actions">
          <button type="button">Upload</button>
          <button type="button">Create Folder</button>
        </div>
      </div>

      <div className="explorer-meta">
        <div className="breadcrumbs">Home / Storage Root / Current Folder</div>
        <div className="explorer-controls">
          <input type="text" placeholder="Search (placeholder)" />
          <select defaultValue="name-asc">
            <option value="name-asc">Sort: Name A-Z</option>
            <option value="name-desc">Sort: Name Z-A</option>
            <option value="date-desc">Sort: Date Newest</option>
            <option value="size-desc">Sort: Size Largest</option>
          </select>
        </div>
      </div>

      <div className="multi-select-bar">
        <span>Multi-select UI placeholder</span>
        <button type="button">Bulk Actions</button>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>
                <input type="checkbox" aria-label="Select all" />
              </th>
              <th>Name</th>
              <th>Type</th>
              <th>Size</th>
              <th>Date Modified</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <td>
                  <input type="checkbox" aria-label={`Select ${row.name}`} />
                </td>
                <td>
                  <span className="item-cell">
                    <span className="item-icon" aria-hidden="true">
                      {row.type === "Folder" ? "📁" : "📄"}
                    </span>
                    {row.name}
                  </span>
                </td>
                <td>{row.type}</td>
                <td>{row.size}</td>
                <td>{row.modified}</td>
                <td>
                  <button type="button" className="ghost-button">
                    Actions
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

