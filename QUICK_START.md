# ⚡ FE1 Jira 통합 관리 - 빠른 시작 가이드

## 🎯 명령어 하나로 실행하기

### 1. 프로젝트 클론 (최초 1회만)

```bash
git clone https://github.com/ignite-corp/fe1-web.git ~/fe1-web
```

### 2. 환경 변수 설정 (최초 1회만)

팀원에게 받은 `.env.local` 파일을 `~/fe1-web/` 폴더에 저장

### 3. alias 등록 (최초 1회만)

**zsh 사용자 (Mac 기본):**
```bash
echo 'alias fe1="~/fe1-web/run.sh"' >> ~/.zshrc
source ~/.zshrc
```

**bash 사용자:**
```bash
echo 'alias fe1="~/fe1-web/run.sh"' >> ~/.bashrc
source ~/.bashrc
```

### 4. 실행 (매일 사용)

**이제 어디서든 명령어 하나로!**
```bash
fe1
```

브라우저에서 자동으로 열리거나 수동으로 접속:
```
http://localhost:7591
```

**종료:**
```
Ctrl + C
```

---

## 📋 전체 과정 요약

```bash
# 최초 설정 (1회만, 5분 소요)
git clone https://github.com/ignite-corp/fe1-web.git ~/fe1-web
# .env.local 파일을 ~/fe1-web/ 폴더에 저장
echo 'alias fe1="~/fe1-web/run.sh"' >> ~/.zshrc && source ~/.zshrc

# 이후 매일 사용
fe1  # ← 이것만!
```

---

## 🔧 커스터마이징

### 프로젝트 경로 변경

다른 위치에 클론했다면:

```bash
# 본인의 실제 경로로 수정
alias fe1="/Users/your-name/Projects/fe1-web/run.sh"
```

### 포트 변경

`package.json`에서 포트 수정:
```json
"dev": "next dev --webpack -p 원하는포트번호"
```

---

## 🆘 문제 해결

### "fe1 command not found"

```bash
# alias가 등록되었는지 확인
alias | grep fe1

# 없으면 다시 등록
echo 'alias fe1="~/fe1-web/run.sh"' >> ~/.zshrc
source ~/.zshrc
```

### "포트가 이미 사용 중입니다"

```bash
# 7591 포트 사용 중인 프로세스 종료
lsof -ti :7591 | xargs kill -9

# 다시 실행
fe1
```

### ".env.local 파일이 없습니다"

```bash
# 파일 위치 확인
ls ~/fe1-web/.env.local

# 없으면 팀원에게 받아서 저장
```

### "Node.js가 설치되어 있지 않습니다"

```bash
# Node.js 설치 (Mac)
brew install node@20

# 또는 nvm 사용
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20
```

---

## 📝 체크리스트

실행 전 확인:

- [ ] Git clone 완료
- [ ] `.env.local` 파일 저장 완료
- [ ] alias 등록 완료
- [ ] Node.js 20+ 설치됨
- [ ] VPN 연결됨 (HMG Jira 사용 시)

---

## 🌟 일상 사용법

```bash
# 아침에 출근하면
fe1

# 브라우저에서
http://localhost:7591

# 퇴근할 때
Ctrl + C
```

끝! 이렇게 간단합니다! 🎊

