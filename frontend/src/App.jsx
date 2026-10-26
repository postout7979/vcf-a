import { useCallback, useEffect, useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import Topbar from "./components/Topbar.jsx";
import DashboardPage from "./components/DashboardPage.jsx";
import CatalogPage from "./components/CatalogPage.jsx";
import ProjectsPage from "./components/ProjectsPage.jsx";
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
  project: {
    title: "프로젝트",
    subtitle: "프로젝트 선택 및 vSphere Namespace 확인 - VM Service는 선택한 프로젝트에 배포됩니다",
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

  const [orgs, setOrgs] = useState([]);
  const [orgId, setOrgId] = useState("");
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState("");

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

  useEffect(() => {
    api.listOrgs().then((list) => {
      setOrgs(list);
      setOrgId((current) => current || list[0]?.orgId || "");
    });
  }, []);

  const handleOrgChange = (nextOrgId) => {
    setOrgId(nextOrgId);
    setProjectId(""); // org를 바꾸면 선택된 프로젝트는 무효화
  };

  useEffect(() => {
    if (!orgId) {
      setProjects([]);
      return;
    }
    api.listProjects(orgId).then(setProjects).catch(() => setProjects([]));
  }, [orgId]);

  const handleSelectProject = (nextProjectId) => {
    setProjectId(nextProjectId);
    setView("project");
  };

  const meta = PAGE_META[view];

  return (
    <div className="app-shell">
      <Sidebar
        view={view}
        onNavigate={setView}
        orgs={orgs}
        orgId={orgId}
        onOrgChange={handleOrgChange}
        projects={projects}
        projectId={projectId}
        onSelectProject={handleSelectProject}
      />
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
              orgId={orgId}
              projectId={projectId}
              onDeployed={(name) =>
                setToast({ type: "success", message: `"${name}" 배포 요청을 제출했습니다.` })
              }
            />
          )}
          {view === "project" && (
            <ProjectsPage orgId={orgId} projectId={projectId} projects={projects} />
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
