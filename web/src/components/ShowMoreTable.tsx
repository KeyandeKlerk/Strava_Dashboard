"use client";
import { useState, type ReactNode } from "react";

// Rows must be pre-rendered <tr> elements (built by the server-component
// caller), not raw data + a cell-render function — functions can't cross the
// server/client boundary as props, only serializable data and React elements.
export function ShowMoreTable({
  headers,
  rows,
  initialCount = 5,
}: {
  headers: string[];
  rows: ReactNode[];
  initialCount?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, initialCount);

  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-neutral-500">
            {headers.map((h) => (
              <th key={h} className="py-1 pr-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{visible}</tbody>
      </table>
      {rows.length > initialCount && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-2 w-full rounded-md border border-dashed border-neutral-300 px-3 py-1.5 text-xs text-neutral-500 dark:border-neutral-700"
        >
          {expanded ? "Show less" : `Show ${rows.length - initialCount} more`}
        </button>
      )}
    </div>
  );
}
