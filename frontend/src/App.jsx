import { useCallback, useEffect, useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import Topbar from "./components/Topbar.jsx";
import DashboardPage from "./components/DashboardPage.jsx";
import CatalogPage from "./components/CatalogPage.jsx";
import DeploymentsPage from "./components/DeploymentsPage.jsx";
import AdminPage from "./components/AdminPage.jsx";
import Toast from "./components/Toast.jsx";
import { api } from "./api/client.js";

const PAGE_META = {
  dashboard: {
    title: "대시보드",
    subtitle: "배포된 리소스 현황 요약",
  },
  catalog: {
    title: "카탈로그",
    subtitle: "VCF 9 Automation VM Apps 카탈로그 (자동 동기화됨)",
  },
  deployments: {
    title: "배포 이력",
    subtitle: "포탈을 통해 제출된 배포 요청",
  },
  admin: {
    title: "관리자",
    subtitle: "동기화 상태 확인 및 수동 실행",
  },
};

export default function App() {
  const [view, setView] = useState("dashboard");
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [toast, setToast] = useState(null);

  const refreshSyncInfo = useCallback(async () => {
    const [s, h] = await Promise.all([api.syncStatus(), api.syncHistory(24)]);
    setStatus(s);
    setHistory(h);
  }, []);

  useEffect(() => {
    refreshSyncInfo();
    const id = setInterval(refreshSyncInfo, 30000);
    return () => clearInterval(id);
  }, [refreshSyncInfo]);

  const meta = PAGE_META[view];

  return (
    <div className="app-shell">
      <Sidebar view={view} onNavigate={setView} />
      <div className="main">
        <Topbar
          title={meta.title}
          subtitle={meta.subtitle}
          syncEvents={history}
          nextRunAt={status?.nextRunAt}
        />
        <div className="content">
          {view === "dashboard" && <DashboardPage />}
          {view === "catalog" && (
            <CatalogPage
              onDeployed={(name) =>
                setToast({ type: "success", message: `"${name}" 배포 요청을 제출했습니다.` })
              }
            />
          )}
          {view === "deployments" && <DeploymentsPage />}
          {view === "admin" && (
            <AdminPage status={status} history={history} onRefresh={refreshSyncInfo} />
          )}
        </div>
      </div>
      <Toast
        message={toast?.message}
        type={toast?.type}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}
