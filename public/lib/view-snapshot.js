// Snapshots belong to the authenticated user and exact view/filter combination.
export function createViewSnapshots(storage, now = Date.now) {
  const key = 'max-crm-view-snapshots-v1';
  const read = () => {
    try {
      return JSON.parse(storage.getItem(key) || '[]');
    } catch {
      return [];
    }
  };
  return {
    get(scope) {
      const rows = read();
      if (!Array.isArray(rows)) return null;
      return (
        rows.find(
          (row) =>
            row?.scope === scope &&
            row.data &&
            Number.isFinite(row.at) &&
            now() >= row.at &&
            now() - row.at < 86400000
        ) || null
      );
    },
    set(scope, data) {
      try {
        const rows = read();
        const next = [
          { scope, at: now(), data },
          ...(Array.isArray(rows) ? rows : []).filter((row) => row?.scope !== scope)
        ].slice(0, 3);
        while (next.length && JSON.stringify(next).length > 1500000) next.pop();
        storage.setItem(key, JSON.stringify(next));
      } catch {
        /* Storage is optional; live loading remains available. */
      }
    },
    clear() {
      try {
        storage.removeItem(key);
      } catch {
        /* Storage may be disabled. */
      }
    }
  };
}
