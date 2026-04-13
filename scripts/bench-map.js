/**
 * bench-map.js
 * 지도 검색 API 성능 측정 스크립트
 * Redis 캐시 HIT/MISS 구분 + DB 쿼리 응답시간 통계
 *
 * 사용법:
 *   node scripts/bench-map.js              # 기본 (캐시 MISS 100회 → 캐시 HIT 100회)
 *   node scripts/bench-map.js --miss-only  # 캐시 MISS만 측정
 *   node scripts/bench-map.js --hit-only   # 캐시 HIT만 측정
 *   node scripts/bench-map.js --n 200      # 각 시나리오 200회
 *
 * 사전 조건:
 *   - 서버가 실행 중이어야 합니다 (npm run dev)
 *   - Redis가 실행 중이어야 합니다
 *   - seed-perf.js로 시드 데이터가 삽입되어 있어야 합니다
 */

'use strict';

require('dotenv').config();
const http = require('http');
const { createClient } = require('redis');

// ── 설정 ──────────────────────────────────────────────────────
const BASE_URL = `http://localhost:${process.env.PORT || 8080}`;
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');

// 서울 주요 지역 검색 박스 (실제 유저 시나리오 기반)
// 각 박스는 약 구(區) 단위 크기 — zoom 2~3 수준
const SEARCH_AREAS = [
  { name: '강남구 중심',   swLat: 37.490, swLng: 127.020, neLat: 37.530, neLng: 127.070 },
  { name: '마포구 중심',   swLat: 37.540, swLng: 126.895, neLat: 37.565, neLng: 126.950 },
  { name: '홍대·연남',    swLat: 37.548, swLng: 126.915, neLat: 37.568, neLng: 126.942 },
  { name: '종로·광화문',  swLat: 37.565, swLng: 126.970, neLat: 37.598, neLng: 127.018 },
  { name: '송파구 중심',   swLat: 37.493, swLng: 127.085, neLat: 37.522, neLng: 127.135 },
  { name: '노원구 중심',   swLat: 37.628, swLng: 127.058, neLat: 37.668, neLng: 127.098 },
  { name: '관악구 중심',   swLat: 37.458, swLng: 126.928, neLat: 37.488, neLng: 126.982 },
  { name: '성동구 중심',   swLat: 37.542, swLng: 127.028, neLat: 37.568, neLng: 127.062 },
];

// zoom 레벨별 시나리오 (서비스 코드 기준: 3 미만 → 500개, 3~5 → 300개, 5~6 → 200개)
const ZOOM_SCENARIOS = [
  { zoom: 2, label: 'detail(200개 제한)' },
  { zoom: 4, label: 'medium(300개 제한)' },
  { zoom: 1, label: 'default(500개 제한)' },
];

// ── HTTP 요청 ─────────────────────────────────────────────────
function request(url) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        const duration = Date.now() - startTime;
        try {
          const data = JSON.parse(body);
          resolve({
            status: res.statusCode,
            duration,
            cacheHeader: res.headers['x-cache'] || res.headers['x-cache-status'] || null,
            count: data?.data?.count ?? data?.count ?? null,
          });
        } catch {
          resolve({ status: res.statusCode, duration, error: 'parse error' });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── Redis 직접 접근 (캐시 키 플러시) ─────────────────────────
async function getRedisClient() {
  const client = createClient({ socket: { host: REDIS_HOST, port: REDIS_PORT } });
  await client.connect();
  return client;
}

async function flushMapCache(redis) {
  // 지도 검색 캐시 키 패턴: rooms:map:*
  const keys = await redis.keys('rooms:map:*');
  if (keys.length > 0) {
    await redis.del(keys);
  }
  return keys.length;
}

// ── 통계 계산 ─────────────────────────────────────────────────
function calcStats(durations) {
  if (durations.length === 0) return null;
  const sorted = [...durations].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.50)];
  const p90 = sorted[Math.floor(sorted.length * 0.90)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || sorted[sorted.length - 1];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  return { avg, p50, p90, p95, p99, min, max, count: sorted.length };
}

function printStats(label, stats, errorCount) {
  if (!stats) { console.log(`  ${label}: 데이터 없음`); return; }
  console.log(`\n  📊 ${label}`);
  console.log(`     요청 수  : ${stats.count}회 (오류: ${errorCount}회)`);
  console.log(`     평균     : ${stats.avg.toFixed(0)}ms`);
  console.log(`     p50      : ${stats.p50}ms`);
  console.log(`     p90      : ${stats.p90}ms`);
  console.log(`     p95      : ${stats.p95}ms`);
  console.log(`     p99      : ${stats.p99}ms`);
  console.log(`     min/max  : ${stats.min}ms / ${stats.max}ms`);
}

function buildUrl(area, zoom) {
  const params = new URLSearchParams({
    swLat: area.swLat,
    swLng: area.swLng,
    neLat: area.neLat,
    neLng: area.neLng,
    zoom,
  });
  return `${BASE_URL}/api/rooms/map?${params}`;
}

// ── 시나리오 실행 ─────────────────────────────────────────────
async function runScenario(label, n, getUrl) {
  const durations = [];
  let errors = 0;

  for (let i = 0; i < n; i++) {
    const url = getUrl(i);
    try {
      const result = await request(url);
      if (result.status === 200) {
        durations.push(result.duration);
        if (i === 0) {
          console.log(`     첫 응답: ${result.duration}ms | 방 수: ${result.count ?? '?'}개`);
        }
      } else {
        errors++;
        if (errors <= 3) console.log(`     ⚠️ HTTP ${result.status} — ${url}`);
      }
    } catch (e) {
      errors++;
      if (errors <= 3) console.log(`     ❌ 오류: ${e.message}`);
    }
    // 진행 표시 (10% 단위)
    if ((i + 1) % Math.max(1, Math.floor(n / 10)) === 0) {
      process.stdout.write(`\r     진행: ${i + 1}/${n} (${Math.round(((i + 1) / n) * 100)}%)`);
    }
  }
  process.stdout.write('\r' + ' '.repeat(40) + '\r');

  printStats(label, calcStats(durations), errors);
  return { durations, errors };
}

// ── 메인 ──────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const missOnly = args.includes('--miss-only');
  const hitOnly  = args.includes('--hit-only');
  const nIdx = args.indexOf('--n');
  const N = nIdx >= 0 ? parseInt(args[nIdx + 1]) || 100 : 100;

  console.log('\n' + '═'.repeat(60));
  console.log(' 🗺️  지도 검색 API 성능 벤치마크');
  console.log('═'.repeat(60));
  console.log(` 서버    : ${BASE_URL}`);
  console.log(` Redis   : ${REDIS_HOST}:${REDIS_PORT}`);
  console.log(` 반복 수 : 시나리오당 ${N}회`);
  console.log('═'.repeat(60) + '\n');

  // 서버 연결 확인
  try {
    await request(`${BASE_URL}/api/rooms/map?swLat=37.49&swLng=127.02&neLat=37.53&neLng=127.07&zoom=2`);
  } catch (e) {
    console.error('❌ 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.');
    console.error(`   npm run dev 또는 node app.js 실행 후 다시 시도하세요.`);
    process.exit(1);
  }

  // Redis 연결
  let redis;
  try {
    redis = await getRedisClient();
    console.log('✅ Redis 연결 성공\n');
  } catch (e) {
    console.error('❌ Redis에 연결할 수 없습니다:', e.message);
    process.exit(1);
  }

  const allResults = {};

  // ── 1. 캐시 MISS 시나리오 (매번 다른 좌표 → 캐시 없음) ──────
  if (!hitOnly) {
    console.log('─'.repeat(60));
    console.log('📌 시나리오 1: 캐시 MISS (DB 직접 조회)');
    console.log('   캐시를 플러시하고 매번 미세하게 다른 좌표로 요청합니다.');
    console.log('─'.repeat(60));

    const flushed = await flushMapCache(redis);
    console.log(`   캐시 플러시: ${flushed}개 키 삭제\n`);

    // zoom 레벨별로 측정
    for (const scenario of ZOOM_SCENARIOS) {
      console.log(`\n  🔍 zoom=${scenario.zoom} (${scenario.label})`);
      const area = SEARCH_AREAS[0]; // 강남 고정

      // 좌표에 미세 오프셋을 더해 캐시 키가 매번 달라지게 함
      // (소수점 4자리 반올림이므로 0.00005 단위로 변경)
      const result = await runScenario(
        `캐시 MISS / zoom=${scenario.zoom}`,
        N,
        (i) => {
          const offset = (i * 0.00005).toFixed(5);
          return buildUrl({
            swLat: area.swLat + parseFloat(offset),
            swLng: area.swLng + parseFloat(offset),
            neLat: area.neLat + parseFloat(offset),
            neLng: area.neLng + parseFloat(offset),
          }, scenario.zoom);
        }
      );
      allResults[`miss_zoom${scenario.zoom}`] = result;
    }
  }

  // ── 2. 캐시 HIT 시나리오 (동일 좌표 반복 → Redis 응답) ───────
  if (!missOnly) {
    console.log('\n' + '─'.repeat(60));
    console.log('📌 시나리오 2: 캐시 HIT (Redis 응답)');
    console.log('   각 지역을 먼저 워밍업한 뒤 동일 좌표로 반복 요청합니다.');
    console.log('─'.repeat(60));

    for (const scenario of ZOOM_SCENARIOS) {
      console.log(`\n  🔍 zoom=${scenario.zoom} (${scenario.label})`);
      const area = SEARCH_AREAS[0];
      const url = buildUrl(area, scenario.zoom);

      // 워밍업: 첫 요청으로 캐시 생성
      console.log('     워밍업 요청 중...');
      await request(url);

      const result = await runScenario(
        `캐시 HIT / zoom=${scenario.zoom}`,
        N,
        () => url  // 항상 같은 URL → 캐시 HIT
      );
      allResults[`hit_zoom${scenario.zoom}`] = result;
    }
  }

  // ── 3. 지역별 MISS 시나리오 (여러 지역 순환) ─────────────────
  if (!hitOnly) {
    console.log('\n' + '─'.repeat(60));
    console.log('📌 시나리오 3: 지역별 캐시 MISS (8개 지역 순환)');
    console.log('   실제 유저처럼 여러 지역을 탐색하는 패턴입니다.');
    console.log('─'.repeat(60));

    const flushed = await flushMapCache(redis);
    console.log(`   캐시 플러시: ${flushed}개 키 삭제\n`);

    const result = await runScenario(
      '지역 순환 캐시 MISS / zoom=2',
      N,
      (i) => {
        const area = SEARCH_AREAS[i % SEARCH_AREAS.length];
        const offset = (Math.floor(i / SEARCH_AREAS.length) * 0.00005).toFixed(5);
        return buildUrl({
          swLat: area.swLat + parseFloat(offset),
          swLng: area.swLng + parseFloat(offset),
          neLat: area.neLat + parseFloat(offset),
          neLng: area.neLng + parseFloat(offset),
        }, 2);
      }
    );
    allResults['miss_multi_area'] = result;
  }

  // ── 4. 최종 요약 ──────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log(' 📋 최종 요약 (평균 응답시간)');
  console.log('═'.repeat(60));

  const labels = {
    miss_zoom2: '캐시 MISS  zoom=2  (상세, LIMIT 200)',
    miss_zoom4: '캐시 MISS  zoom=4  (중간, LIMIT 300)',
    miss_zoom1: '캐시 MISS  zoom=1  (기본, LIMIT 500)',
    hit_zoom2:  '캐시 HIT   zoom=2',
    hit_zoom4:  '캐시 HIT   zoom=4',
    hit_zoom1:  '캐시 HIT   zoom=1',
    miss_multi_area: '지역순환  MISS   zoom=2',
  };

  for (const [key, label] of Object.entries(labels)) {
    if (!allResults[key]) continue;
    const stats = calcStats(allResults[key].durations);
    if (stats) {
      const bar = '█'.repeat(Math.min(Math.round(stats.avg / 20), 30));
      console.log(`  ${label.padEnd(38)} avg=${String(stats.avg.toFixed(0) + 'ms').padStart(6)}  p95=${String(stats.p95 + 'ms').padStart(7)}  ${bar}`);
    }
  }

  // 캐시 효과 계산
  const missZoom2 = allResults['miss_zoom2'] && calcStats(allResults['miss_zoom2'].durations);
  const hitZoom2  = allResults['hit_zoom2']  && calcStats(allResults['hit_zoom2'].durations);
  if (missZoom2 && hitZoom2) {
    const speedup = (missZoom2.avg / hitZoom2.avg).toFixed(1);
    console.log(`\n  🚀 Redis 캐시 효과: ${speedup}x 빠름 (${missZoom2.avg.toFixed(0)}ms → ${hitZoom2.avg.toFixed(0)}ms)`);
  }

  console.log('\n' + '═'.repeat(60));
  console.log(' 💡 성능 기준 참고 (일반적인 목표)');
  console.log('   캐시 MISS : < 300ms (DB 인덱스 정상)');
  console.log('   캐시 HIT  : < 30ms  (Redis 정상)');
  console.log('   p95       : < 500ms (사용자 체감 기준)');
  console.log('═'.repeat(60) + '\n');

  await redis.quit();
}

main().catch(async (err) => {
  console.error('\n❌ 오류 발생:', err.message);
  console.error(err.stack);
  process.exit(1);
});
