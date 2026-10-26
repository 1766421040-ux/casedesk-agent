import { ChevronLeft, ChevronRight } from "lucide-react";

export function Pagination({
  total,
  offset,
  limit,
  loading,
  onChange,
  label,
}: {
  total: number;
  offset: number;
  limit: number;
  loading: boolean;
  onChange: (offset: number) => void;
  label: string;
}) {
  return (
    <div className="pagination" aria-label={`${label}分页`}>
      <span>
        {total ? `${offset + 1}–${Math.min(offset + limit, total)}` : "0"} /{" "}
        {total} 条
      </span>
      <div>
        <button
          className="icon-button"
          aria-label={`${label}上一页`}
          disabled={loading || offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          <ChevronLeft size={17} />
        </button>
        <button
          className="icon-button"
          aria-label={`${label}下一页`}
          disabled={loading || offset + limit >= total}
          onClick={() => onChange(offset + limit)}
        >
          <ChevronRight size={17} />
        </button>
      </div>
    </div>
  );
}
