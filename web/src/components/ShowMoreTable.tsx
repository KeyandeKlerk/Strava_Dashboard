"use client";
import { useState, type ReactNode } from "react";

export interface ShowMoreColumn<T> {
  header: string;
  cell: (row: T) => ReactNode;
}

export function ShowMoreTable<T>({
  rows,
  columns,
  keyFn,
  initialCount = 5,
}: {
  rows: T[];
  columns: Array<ShowMoreColumn<T>>;
  keyFn: (row: T) => string;
  initialCount?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, initialCount);

  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-neutral-500">
            {columns.map((c) => (
              <th key={c.header} className="py-1 pr-2">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={keyFn(row)} className="border-t border-neutral-100 dark:border-neutral-900">
              {columns.map((c) => (
                <td key={c.header} className="py-1 pr-2">
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
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
