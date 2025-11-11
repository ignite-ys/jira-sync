#!/bin/bash

# FE1 Jira 통합 관리 도구 설치 스크립트

echo "🚀 FE1 Jira 통합 관리 도구 설치를 시작합니다..."

# Node.js 버전 확인
if ! command -v node &> /dev/null; then
    echo "❌ Node.js가 설치되어 있지 않습니다."
    echo "   https://nodejs.org 에서 Node.js 20 이상을 설치해주세요."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "⚠️  Node.js 버전이 낮습니다. (현재: v$NODE_VERSION, 필요: v20+)"
    echo "   https://nodejs.org 에서 최신 버전을 설치해주세요."
    exit 1
fi

echo "✓ Node.js $(node -v) 확인됨"

# 의존성 설치
echo "📦 의존성 설치 중..."
npm install

# .env.local 확인
if [ ! -f ".env.local" ]; then
    echo "⚠️  .env.local 파일이 없습니다."
    echo "   팀원에게 .env.local 파일을 받아서 프로젝트 루트에 저장해주세요."
    echo ""
    echo "   필요한 환경 변수:"
    echo "   - IGNITE_JIRA_EMAIL"
    echo "   - IGNITE_JIRA_API_TOKEN"
    echo "   - HMG_JIRA_EMAIL"
    echo "   - HMG_JIRA_API_TOKEN"
    exit 1
fi

echo "✓ .env.local 확인됨"

# 완료
echo ""
echo "✅ 설치 완료!"
echo ""
echo "📝 실행 방법:"
echo "   ./run.sh"
echo "   또는"
echo "   npm run dev"
echo ""
echo "🌐 접속 주소:"
echo "   http://localhost:7591"
echo ""
echo "💡 팁: alias 등록하면 더 편합니다 (QUICK_START.md 참고)"
echo ""
echo "⚠️  HMG Jira를 사용하려면 VPN에 연결되어 있어야 합니다."

