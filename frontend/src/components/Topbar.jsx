import SyncPulse from "./SyncPulse.jsx";

export default function Topbar({ title, subtitle, syncEvents, nextRunAt }) {
  return (
    <div className="topbar">
      <div>
        <div className="topbar-title">{title}</div>
        {subtitle && <div className="topbar-subtitle">{subtitle}</div>}
      </div>
      <SyncPulse events={syncEvents} nextRunAt={nextRunAt} />
    </div>
  );
}
