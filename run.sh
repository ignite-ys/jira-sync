#!/bin/bash

# FE1 Jira 통합 관리 도구 실행 스크립트

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$PROJECT_DIR"

# .env.local 파일 확인
if [ ! -f ".env.local" ]; then
    echo "❌ .env.local 파일이 없습니다!"
    echo "   팀원에게 .env.local 파일을 받아서 프로젝트 루트에 저장해주세요."
    exit 1
fi

# Node.js 확인
if ! command -v node &> /dev/null; then
    echo "❌ Node.js가 설치되어 있지 않습니다."
    echo "   https://nodejs.org 에서 Node.js 20 이상을 설치해주세요."
    exit 1
fi

# node_modules 확인 및 자동 설치
if [ ! -d "node_modules" ]; then
    echo "📦 의존성 설치 중..."
    npm install
fi

# 서버 실행
echo "🚀 FE1 Jira 통합 관리 도구를 시작합니다..."
echo "   접속: http://localhost:7591"
echo ""
echo "   종료하려면 Ctrl+C를 누르세요."
echo ""

# 백그라운드에서 브라우저 자동 열기 (3초 후)
(sleep 3 && open http://localhost:7591) &

npm run dev

