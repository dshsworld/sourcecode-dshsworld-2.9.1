# DSHS WORLD 공동 운영

현재 사이트 소스: v2.9.1. 기존 ZIP을 풀어 저장소 최상위에 배치했습니다.
이 저장소를 연결하는 것만으로 운영 중인 사진·주석·화살표·확인 표시가 이전되지는 않습니다.
기존 projectsolgae.online의 DNS는 이전 검증이 끝날 때까지 유지합니다.

## Cloudflare 준비

1. 동현님 계정에서 D1 데이터베이스 `dshs-world-db`와 R2 버킷 `dshs-world-media`를 생성합니다. R2는 활성화 과정에서 결제 정보와 사용량 요금 확인이 필요할 수 있습니다.
2. Workers Builds의 빌드 변수 `DSHS_D1_DATABASE_ID`에 새 D1의 Database ID를 입력합니다. 선택 변수 `DSHS_WORKER_NAME`의 기본값은 `sourcecode-dshsworld-2-9-1`, `DSHS_R2_BUCKET`은 `dshs-world-media`입니다. Worker 이름은 Cloudflare 화면의 이름과 같아야 합니다.
3. 빌드 명령: `npm run build:cloudflare`. 배포 명령: `npm run deploy:cloudflare`. 루트 경로: `/`.
4. 최초 실행 전 `npm run configure:cloudflare` 후 `npx wrangler d1 migrations apply dshs-world-db --remote --config .cloudflare-wrangler.json`으로 새 DB에 스키마를 적용합니다. 운영 데이터 복원 전 빈 투어를 열면 기본 노드가 초기화되므로, 데이터 복원 작업은 별도로 조율합니다.
5. 새 Worker의 런타임 Secret으로 `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`를 설정해야 Creator 로그인이 가능합니다. 값을 GitHub에 올리지 않습니다. 기존 비밀값·세션·로그인 시도 기록은 공개 저장소로 복사하지 않습니다.
6. 기존 DB의 scenes/links/settings와 R2 파일을 별도로 백업하고 복원합니다. 사진 키, 노드 ID, 화살표 좌표, 방향 보정, 주석, 위치 확인 상태와 초기화 마커를 유지해야 합니다. 아직 이 단계는 완료되지 않았습니다.
7. workers.dev 주소에서 이동·사진·업로드·로그인을 검증한 뒤 도메인을 전환합니다.

## 협업 권한

GitHub 저장소 Settings → Collaborators에서 팀원을 초대합니다. 코드 수정 권한과 Cloudflare 계정 관리 권한은 별개입니다. 처음에는 Pull Request로 검토하고 main에 반영한 코드를 배포합니다. Cloudflare 팀원 초대는 필요한 사람과 권한을 정한 뒤 별도로 진행합니다. 개인 계정 비밀번호는 공유하지 않습니다.

## 로컬 확인

Node 24 / Linux 또는 WSL을 사용합니다. `npm ci` 후 `DSHS_D1_DATABASE_ID` 환경변수를 설정하고 `npm run build:cloudflare`로 빌드합니다. 이 명령 자체는 배포하거나 DB를 수정하지 않습니다. `npm test`는 기존 Sites 빌드 기반 회귀 테스트입니다.

대용량 360° 사진과 INSP 원본은 GitHub 대신 R2에서 관리합니다. INSP 변환 지원 상태는 실제 파일로 별도 검증해야 하며 호스팅 이전만으로 새 변환 기능이 생기지는 않습니다.
