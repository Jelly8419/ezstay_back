#!/bin/bash

echo "🔍 PM2 및 Node.js 프로세스 진단"
echo "================================"
echo ""

echo "1️⃣ PM2 프로세스 목록"
pm2 list
echo ""

echo "2️⃣ PM2 프로세스 상세 정보"
pm2 show ezstay-api 2>/dev/null || echo "ezstay-api 프로세스를 찾을 수 없습니다"
echo ""

echo "3️⃣ 실행 중인 모든 Node.js 프로세스"
ps aux | grep node | grep -v grep
echo ""

echo "4️⃣ 현재 디렉토리의 models/index.js logging 설정 확인"
grep -A 2 "logging:" models/index.js
echo ""

echo "5️⃣ PM2가 실행 중인 실제 파일 경로"
pm2 info ezstay-api 2>/dev/null | grep "script path" || echo "경로 확인 실패"
echo ""

echo "6️⃣ .env 파일의 DB_LOGGING 설정"
grep DB_LOGGING .env || echo "DB_LOGGING 설정 없음"
echo ""

echo "7️⃣ Git 상태 확인"
git log -1 --oneline
git status
echo ""

echo "✅ 진단 완료!"
echo ""
echo "📝 다음 명령어로 PM2 완전 재시작:"
echo "   pm2 stop all && pm2 delete all && pm2 start server.js --name ezstay-api"
