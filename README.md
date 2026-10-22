# VCF Cloud Management Portal

VCF 9 Automation의 **VM Apps 모드 카탈로그**를 REST API로 조회 → 로컬 DB에 캐싱 →
카탈로그와 **동일한 입력 스키마**로 배포 요청을 대행하는 셀프서비스 포탈입니다.

VCF 9 Automation의 **Provider / Organization 분리**를 반영해서, provider 레벨로
로그인한 뒤 Organization 목록을 조회하고, **각 org로 스코프된 호출**로 카탈로그를
동기화합니다. 1시간 주기 자동 sync(추가/삭제/변경 자동 반영) + 관리자 메뉴의
수동 sync 버튼을 지원합니다.

```
vcf-a/
├── backend/     # FastAPI - VCF Automation API 연동(provider→org), sync 스케줄러, 배포 프록시
├── frontend/    # React (Vite) - 카탈로그 UI, 동적 배포 폼, 관리자 sync 대시보드
└── docker-compose.yml
```

## 아키텍처

```
VCF 9 Automation (provider 로그인 → org 목록 조회 → org별 Catalog API)
        │
        ▼
FastAPI 백엔드
  ├─ vcf_client.py    provider 인증 + org 목록 조회 + org-scoped 카탈로그/배포 호출
  ├─ sync_service.py  org별 카탈로그 diff 계산 (added/changed/removed) → SQLite 반영
  ├─ scheduler.py     APScheduler, 60분 주기 자동 sync
  └─ routers/         /api/orgs, /api/catalog, /api/deploy, /api/admin/sync, /api/dashboard/summary
        │  REST (JSON)
        ▼
React 프론트엔드
  ├─ DashboardPage     배포된 리소스 현황 요약 (org/타입 구성, 배포 추이, 항목별 배포 건수)
  ├─ CatalogPage        Org 선택 드롭다운 + 카탈로그 카드 목록
  ├─ DynamicForm         카탈로그 항목의 schema를 그대로 렌더링하는 배포 폼
  ├─ AdminPage           "지금 동기화" 버튼 + Sync Pulse 타임라인 + org별 변경 이력
  └─ DeploymentsPage     제출한 배포 요청 이력 (org 포함)
```

카탈로그 항목의 고유 키는 `(org_id, vcf_item_id)` 조합입니다 — 서로 다른 org가
같은 id의 항목을 가질 수 있기 때문입니다.

## Docker로 실행하기 (권장)

```bash
cd vcf-a
cp backend/.env.example backend/.env
# backend/.env 를 실제 VCF Automation 접속 정보로 수정

docker compose up -d --build
```

- 프론트엔드: `http://<서버>:8080`
- 백엔드 API: `http://<서버>:8000` (프론트엔드 컨테이너가 nginx로 `/api`를 백엔드
  컨테이너에 내부적으로 프록시하므로, 브라우저에서 직접 호출할 일은 많지 않습니다)
- 카탈로그/배포 이력 DB는 `vcf_portal_data` named volume에 영구 저장되어
  컨테이너를 재생성해도 유지됩니다.

재기동/업데이트:
```bash
docker compose up -d --build   # 코드 변경 후 재빌드
docker compose logs -f backend # sync 로그 확인
docker compose down            # 중지 (볼륨은 유지됨)
```

## 로컬(venv)로 실행하기 — 개발용

### 백엔드
```bash
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # 실제 VCF Automation 접속 정보로 수정
uvicorn app.main:app --reload --port 8000
```

### 프론트엔드
```bash
cd frontend
npm install
npm run dev   # http://localhost:5173, /api 요청은 8000번 백엔드로 프록시됨
```

## `.env` 핵심 값

| 변수 | 설명 |
|---|---|
| `VCF_AUTOMATION_BASE_URL` | VCF Automation FQDN |
| `VCF_AUTOMATION_USERNAME` / `PASSWORD` | provider 계정 (org 목록 조회용) |
| `VCF_ORG_TOKENS` | org별 API 토큰 JSON 맵 (한 줄), 동기화 대상 org 허용 목록 겸용 |
| `SYNC_INTERVAL_MINUTES` | 자동 sync 주기(분), 기본 60 |
| `DATABASE_URL` | Docker는 `sqlite:////app/data/vcf_portal.db`, 로컬은 `sqlite:///./vcf_portal.db` |

## VCF 9 인증 구조와 연결 점검

VCF 9 Automation은 provider 플레인과 org 플레인의 인증이 분리되어 있습니다.

| 용도 | 호출 |
|---|---|
| provider 로그인 | `POST /cloudapi/1.0.0/sessions/provider` (Basic `user@system:password`, 토큰은 응답 헤더 `x-vmware-vcloud-access-token`) |
| org 목록 | `GET /cloudapi/1.0.0/orgs` (Bearer) |
| org 토큰 | `POST /tm/oauth/tenant/<org명>/token` (`grant_type=refresh_token`, org의 API 토큰) |
| 카탈로그/배포 | `/catalog/api/...`, `/iaas/api/...` (Bearer = org 토큰) |

org 토큰은 org별 API 토큰으로 발급받으므로 `VCF_ORG_TOKENS`에 org 이름별로 등록합니다.
`/catalog/api/items`의 정확한 하위 경로는 공개 문서에서 확인하지 못해, 아래로 직접 점검하는 것을 권장합니다.

```bash
H=https://<vcfa-fqdn>
TOKEN=$(curl -sk -X POST $H/tm/oauth/tenant/<org명>/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=refresh_token&refresh_token=<org API 토큰>' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
curl -sk -H "Authorization: Bearer $TOKEN" "$H/catalog/api/items?page=0&size=5"
```

## 관리자 sync 흐름

- **자동:** 앱 기동 시 1회 + 이후 `SYNC_INTERVAL_MINUTES` 마다 백그라운드로 실행
- **수동:** `관리자` 메뉴 → **"지금 동기화"** 버튼
- 매 sync는 provider 세션으로 Organization 목록을 먼저 조회하고, **각 org마다**
  카탈로그를 따로 동기화합니다. 더 이상 보이지 않는 org/항목은 soft-delete 처리됩니다.

## 다음 확장 포인트

- `$dynamicEnum` 필드를 백엔드에서 vRO 액션 프록시로 실제 해석해 select로 렌더링
- 배포 상태(진행률/성공/실패) 폴링 후 `DeploymentRecord`에 반영
- OSS SaltStack Master 노드 배포용 카탈로그 블루프린트 추가
