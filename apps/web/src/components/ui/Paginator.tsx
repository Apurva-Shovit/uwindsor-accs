import React from 'react';

interface PaginatorProps {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPageChange: (newPage: number) => void;
  onLimitChange?: (newLimit: number) => void;
  limitOptions?: number[];
}

export const Paginator: React.FC<PaginatorProps> = ({
  page,
  totalPages,
  total,
  limit,
  onPageChange,
  onLimitChange,
  limitOptions = [20, 50, 100],
}) => {
  if (total <= 0) return null;

  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-xl">
      <div className="flex items-center gap-3 text-xs font-medium text-slate-500">
        <div>
          Showing <span className="font-semibold text-slate-700">{start}</span> to{' '}
          <span className="font-semibold text-slate-700">{end}</span> of{' '}
          <span className="font-semibold text-slate-700">{total}</span> items
        </div>

        {onLimitChange && (
          <div className="flex items-center gap-1.5 ml-2 border-l border-slate-200 pl-3">
            <span>Per page:</span>
            <select
              value={limit}
              onChange={(e) => onLimitChange(Number(e.target.value))}
              className="border border-slate-200 rounded-md px-2 py-1 text-xs font-semibold bg-white text-slate-700 focus:ring-1 focus:ring-[#005596] focus:outline-none"
            >
              {limitOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>


      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          ← Prev
        </button>

        <span className="px-3 py-1 text-xs font-bold text-slate-700">
          Page {page} of {Math.max(1, totalPages)}
        </span>

        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          Next →
        </button>
      </div>
    </div>
  );
};
