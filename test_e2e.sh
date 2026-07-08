#!/usr/bin/env bash
# =============================================================================
# E2E Test: 用真实用户密码测试完整流程
# =============================================================================
set -euo pipefail

BASE_URL="http://localhost:3000"
EMAIL="${TEST_EMAIL:-zhuzhujianwei@163.com}"
PASSWORD="${TEST_PASSWORD:-xinmima1010}"
PASS=true

echo "=============================================="
echo "E2E Test: Session + Asset Upload Flow"
echo "=============================================="

# ── Step 1: 登录 ──
echo ""
echo "Step 1: 登录 $EMAIL ..."
LOGIN_RESP=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" 2>&1)

TOKEN=$(echo "$LOGIN_RESP" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  process.stdout.write(d.token||'');
" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "  ❌ 登录失败: $(echo "$LOGIN_RESP" | head -c 200)"
  exit 1
fi
echo "  ✅ 登录成功"

# ── Step 2: 创建 session ──
echo ""
echo "Step 2: POST /api/agent/sessions ..."
CREATE_RESP=$(curl -s -X POST "$BASE_URL/api/agent/sessions" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"E2E测试会话"}' 2>&1)

SESSION_ID=$(echo "$CREATE_RESP" | node -e "
  try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(d.session?.session_id||'')}catch(e){process.stdout.write('')}
" 2>/dev/null)

if [ -z "$SESSION_ID" ]; then
  echo "  ❌ 创建失败: $(echo "$CREATE_RESP" | head -c 300)"
  PASS=false
else
  echo "  ✅ session_id=$SESSION_ID"
fi

# ── Step 3: 上传图片带 session_id ──
ASSET_ID=""
if [ "$PASS" = true ]; then
  echo ""
  echo "Step 3: POST /api/assets/upload (带 session_id)..."
  TINY_PNG="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  UPLOAD_RESP=$(curl -s -X POST "$BASE_URL/api/assets/upload" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"uid\":\"any\",\"name\":\"e2e_test.png\",\"data\":\"data:image/png;base64,$TINY_PNG\",\"session_id\":\"$SESSION_ID\"}" 2>&1)

  ASSET_ID=$(echo "$UPLOAD_RESP" | node -e "
    try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(d.asset?.id||'')}catch(e){process.stdout.write('')}
  " 2>/dev/null)

  if [ -z "$ASSET_ID" ]; then
    echo "  ❌ 上传失败: $(echo "$UPLOAD_RESP" | head -c 400)"
    PASS=false
  else
    echo "  ✅ asset_id=$ASSET_ID"
  fi
fi

# ── Step 4: 验证 session_id 写入 DB ──
if [ "$PASS" = true ]; then
  echo ""
  echo "Step 4: GET /api/assets/ 验证 session_id..."
  ASSETS_LIST=$(curl -s "$BASE_URL/api/assets/" \
    -H "Authorization: Bearer $TOKEN" 2>&1)

  DB_SESSION_ID=$(echo "$ASSETS_LIST" | node -e "
    try{
      const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      const a=(d.assets||[]).find(x=>x.id==='$ASSET_ID');
      if(!a){process.stdout.write('NOT_FOUND')}
      else{process.stdout.write(a.session_id||'NULL')}
    }catch(e){process.stdout.write('PARSE_ERROR:'+e.message)}
  " 2>/dev/null)

  echo "  DB session_id: $DB_SESSION_ID"
  echo "  Expected:      $SESSION_ID"

  if [ "$DB_SESSION_ID" = "$SESSION_ID" ]; then
    echo "  ✅ PASS: session_id 正确写入!"
  elif [ "$DB_SESSION_ID" = "NULL" ]; then
    echo "  ❌ FAIL: session_id 为 NULL!"
    echo "  这意味着后端 routes/assets.js 的 INSERT 语句没有包含 session_id"
    echo "  需要检查: 是否重启了后端? 代码是否正确?"
    PASS=false
  elif [ "$DB_SESSION_ID" = "NOT_FOUND" ]; then
    echo "  ❌ FAIL: Asset 不在列表中"
    PASS=false
  else
    echo "  ❌ FAIL: $DB_SESSION_ID"
    PASS=false
  fi
fi

# ── Step 5: 验证 sessions 列表中的 image_count ──
if [ "$PASS" = true ]; then
  echo ""
  echo "Step 5: GET /api/agent/sessions 验证 image_count..."
  SESSIONS_RESP=$(curl -s "$BASE_URL/api/agent/sessions" \
    -H "Authorization: Bearer $TOKEN" 2>&1)

  IMG_COUNT=$(echo "$SESSIONS_RESP" | node -e "
    try{
      const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      const s=(d.sessions||[]).find(x=>x.session_id==='$SESSION_ID');
      if(!s){process.stdout.write('NOT_FOUND')}
      else{process.stdout.write(String(s.image_count||0))}
    }catch(e){process.stdout.write('PARSE_ERROR:'+e.message)}
  " 2>/dev/null)

  echo "  Session image_count: $IMG_COUNT"
  if [ "$IMG_COUNT" -gt 0 ] 2>/dev/null; then
    echo "  ✅ PASS: session 关联了 $IMG_COUNT 张图片"
  else
    echo "  ❌ FAIL: image_count = 0 (asset 可能没关联上)"
    PASS=false
  fi
fi

# ── Cleanup ──
echo ""
echo "Cleanup..."
if [ -n "$ASSET_ID" ]; then
  curl -s -X DELETE "$BASE_URL/api/assets/$ASSET_ID" \
    -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1
  echo "  Deleted asset: $ASSET_ID"
fi
if [ -n "$SESSION_ID" ]; then
  curl -s -X DELETE "$BASE_URL/api/agent/sessions/$SESSION_ID" \
    -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1
  echo "  Deleted session: $SESSION_ID"
fi

echo ""
echo "=============================================="
if [ "$PASS" = true ]; then
  echo "  ✅ ALL TESTS PASSED"
else
  echo "  ❌ TESTS FAILED"
fi
echo "=============================================="
