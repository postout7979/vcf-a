import { useEffect, useState } from "react";

function tickClass(ev) {
  if (ev.status === "error") return "error";
  if (ev.removed_count > 0) return "removed";
  if (ev.changed_count > 0) return "changed";
  if (ev.added_count > 0) return "added";
  return "clean";
}

function tickHeight(ev) {
  const magnitude = (ev.added_count || 0) + (ev.changed_count || 0) + (ev.removed_count || 0);
  return Math.min(6 + magnitude * 3, 22);
}

function formatCountdown(ms) {
  if (ms <= 0) return "곧 실행";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}분 ${s.toString().padStart(2, "0")}초`;
}

export default function SyncPulse({ events = [], nextRunAt, compact = false }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remainingMs = nextRunAt ? new Date(nextRunAt).getTime() - now : null;
  const ordered = [...events].reverse().slice(-24);

  return (
    <div className="sync-pulse">
      <div className="sync-pulse-track" title="최근 sync 이력 (파랑=추가 / 주황=변경 / 빨강=삭제)">
        {ordered.length === 0 && (
          <span style={{ color: "var(--text-muted)", fontSize: 11 }}>sync 이력 없음</span>
        )}
        {ordered.map((ev, i) => (
          <div
            key={ev.id ?? i}
            className={`sync-pulse-tick ${tickClass(ev)}`}
            style={{ height: tickHeight(ev) }}
          />
        ))}
        <span className="sync-beacon" aria-hidden="true" />
      </div>
      {!compact && (
        <span className="sync-meta">
          다음 자동 sync까지 <strong>{remainingMs != null ? formatCountdown(remainingMs) : "-"}</strong>
        </span>
      )}
    </div>
  );
}
