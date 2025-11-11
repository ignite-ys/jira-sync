# FE1 Jira 통합 관리

이그나이트 FE1 팀의 Jira 자동화 및 통합 관리 도구입니다.

## ⚡ 빠른 시작 (명령어 하나로!)

```bash
# 최초 설정 (1회만)
git clone https://github.com/ignite-corp/fe1-web.git ~/fe1-web
# .env.local 파일을 ~/fe1-web/ 폴더에 저장
echo 'alias fe1="~/fe1-web/run.sh"' >> ~/.zshrc && source ~/.zshrc

# 이후 매일 사용
fe1  # ← 이것만 입력하면 브라우저 자동 실행!
```

접속: `http://localhost:7591`

> 💡 **더 자세한 가이드**: [QUICK_START.md](./QUICK_START.md)

---

## 🚀 일반 설치 방법

### 1. 프로젝트 클론

```bash
git clone https://github.com/ignite-corp/fe1-web.git
cd fe1-web
```

### 2. 자동 설치

```bash
./setup.sh
```

또는 수동 설치:
```bash
npm install
```

### 3. 환경 변수 설정
- `.env.local` 파일을 생성하고 Jira API 토큰을 설정하세요.
- 자세한 내용은 [SETUP.md](./SETUP.md)를 참조하세요.

### 4. 실행

```bash
./run.sh
# 또는
npm run dev
```

접속: `http://localhost:7591`

## 📝 개발 스크립트

- `npm run dev` - 개발 서버 실행
- `npm run build` - 프로덕션 빌드
- `npm run lint` - ESLint 검사
- `npm run lint:fix` - ESLint 자동 수정
- `npm run format` - Prettier 포맷팅
- `npm run format:check` - Prettier 검사

## 🛠️ 기술 스택

- **Framework**: Next.js 16
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS v3
- **UI Components**: shadcn/ui
- **HTTP Client**: Axios
- **Code Quality**: ESLint + Prettier

## 📁 프로젝트 구조

```
fe1-web/
├── app/                    # Next.js App Router
│   ├── api/               # API Routes (Jira 프록시)
│   └── test/              # 테스트 페이지
├── components/            # React 컴포넌트
│   └── ui/               # shadcn/ui 컴포넌트
├── lib/
│   ├── services/jira/    # Jira API 서비스 레이어
│   ├── types/            # TypeScript 타입 정의
│   └── constants/        # 상수 및 설정
└── .env.local           # 환경 변수 (생성 필요)
```

## ⚠️ 주의사항

- **HMG Jira**는 VPN 연결이 필요합니다.
- **로컬 실행 필수**: 이 도구는 로컬 개발 서버에서만 작동합니다.
- Vercel 등 외부 서버 배포 시 HMG Jira API는 동작하지 않습니다.

## 📚 문서

- [설정 가이드](./SETUP.md) - 상세한 설정 방법
- API 문서는 추후 추가 예정
