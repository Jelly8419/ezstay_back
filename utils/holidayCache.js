/**
 * 한국 공휴일 캐시
 *
 * 공공데이터포털 한국천문연구원 특일 정보 API를 호출하여
 * 공휴일 목록을 메모리에 캐싱합니다.
 *
 * - 서버 시작 시 당해연도 캐싱
 * - 12월에 다음해 미리 캐싱 (스케줄러)
 * - API 실패 시 주말만 적용 (폴백)
 *
 * 환경변수: PUBLIC_DATA_API_KEY (공공데이터포털 서비스키)
 */

const https = require('https');
const http = require('http');

// 연도별 공휴일 Set 캐시: { 2026: Set{'2026-01-01', '2026-03-01', ...} }
const holidayCache = {};

const API_BASE = 'http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';

/**
 * XML 문자열에서 공휴일 날짜 목록 추출
 * isHoliday=Y 인 항목의 locdate만 수집
 *
 * @param {string} xml
 * @returns {string[]} 'YYYY-MM-DD' 형식 날짜 배열
 */
function parseHolidayDates(xml) {
  const dates = [];

  // <item> 블록 추출
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let itemMatch;

  while ((itemMatch = itemRegex.exec(xml)) !== null) {
    const item = itemMatch[1];

    // isHoliday 값 추출
    const isHolidayMatch = item.match(/<isHoliday>([^<]*)<\/isHoliday>/);
    if (!isHolidayMatch || isHolidayMatch[1].trim() !== 'Y') continue;

    // locdate 값 추출 (YYYYMMDD)
    const locdateMatch = item.match(/<locdate>([^<]*)<\/locdate>/);
    if (!locdateMatch) continue;

    const raw = locdateMatch[1].trim(); // ex) '20260101'
    if (raw.length !== 8) continue;

    const formatted = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    dates.push(formatted);
  }

  return dates;
}

/**
 * 공공 API에서 특정 연도+월의 공휴일 조회
 *
 * @param {number} year
 * @param {number} month 1~12
 * @returns {Promise<string[]>} 'YYYY-MM-DD' 배열
 */
function fetchHolidayMonth(year, month) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.PUBLIC_DATA_API_KEY;
    if (!apiKey) {
      return reject(new Error('PUBLIC_DATA_API_KEY 환경변수가 설정되지 않았습니다.'));
    }

    const monthStr = String(month).padStart(2, '0');
    const url = `${API_BASE}?ServiceKey=${encodeURIComponent(apiKey)}&solYear=${year}&solMonth=${monthStr}&numOfRows=50&pageNo=1`;

    const client = url.startsWith('https') ? https : http;

    const req = client.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(parseHolidayDates(data));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('공휴일 API 타임아웃'));
    });
  });
}

/**
 * 특정 연도의 공휴일 전체를 API에서 조회하여 캐싱
 *
 * @param {number} year
 * @returns {Promise<Set<string>>} 캐싱된 공휴일 Set
 */
async function loadHolidaysForYear(year) {
  const allDates = [];

  console.log(`[holidayCache] ${year}년 공휴일 조회 시작 (12개월 순차 조회)...`);

  // 월별 순차 조회 (API가 연도만으로 전체 조회 시 누락되는 경우 방지)
  for (let month = 1; month <= 12; month++) {
    try {
      const dates = await fetchHolidayMonth(year, month);
      if (dates.length > 0) {
        console.log(`[holidayCache]   ${year}-${String(month).padStart(2, '0')}: ${dates.join(', ')}`);
      }
      allDates.push(...dates);
    } catch (err) {
      console.warn(`[holidayCache] ${year}년 ${month}월 조회 실패:`, err.message);
    }
  }

  const holidaySet = new Set(allDates);
  holidayCache[year] = holidaySet;

  console.log(`[holidayCache] ${year}년 공휴일 ${holidaySet.size}일 캐싱 완료:`, [...holidaySet].sort().join(', '));
  return holidaySet;
}

/**
 * 특정 연도의 공휴일 Set 반환
 * 캐싱되어 있으면 즉시 반환, 없으면 API 호출
 *
 * @param {number} year
 * @returns {Promise<Set<string>>}
 */
async function getHolidaysForYear(year) {
  if (holidayCache[year]) {
    return holidayCache[year];
  }
  return loadHolidaysForYear(year);
}

/**
 * 특정 날짜가 공휴일인지 확인
 *
 * @param {Date} date
 * @returns {Promise<boolean>}
 */
async function isHoliday(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;

  const holidays = await getHolidaysForYear(year);
  return holidays.has(dateStr);
}

/**
 * 서버 시작 시 초기화
 * - 당해연도 캐싱
 * - 12월이면 다음해도 미리 캐싱
 */
async function init() {
  console.log('[holidayCache] 초기화 시작...');

  if (!process.env.PUBLIC_DATA_API_KEY) {
    console.warn('[holidayCache] PUBLIC_DATA_API_KEY 미설정 — 영업일 계산 시 주말만 적용됩니다.');
    return;
  }

  console.log('[holidayCache] API 키 확인됨, 공휴일 데이터 로드 시작');

  const now = new Date();
  const currentYear = now.getFullYear();

  try {
    await loadHolidaysForYear(currentYear);
    console.log(`[holidayCache] ✅ ${currentYear}년 초기화 완료`);
  } catch (err) {
    console.error(`[holidayCache] ❌ ${currentYear}년 초기화 실패:`, err.message);
  }

  // 12월이면 다음해도 미리 캐싱
  if (now.getMonth() === 11) {
    console.log(`[holidayCache] 12월 감지 → ${currentYear + 1}년 선제 캐싱 시작`);
    try {
      await loadHolidaysForYear(currentYear + 1);
      console.log(`[holidayCache] ✅ ${currentYear + 1}년 초기화 완료`);
    } catch (err) {
      console.error(`[holidayCache] ❌ ${currentYear + 1}년 초기화 실패:`, err.message);
    }
  }

  console.log('[holidayCache] 초기화 완료. 캐시된 연도:', Object.keys(holidayCache).join(', '));
}

module.exports = {
  init,
  getHolidaysForYear,
  isHoliday,
  holidayCache // 테스트용 직접 접근
};
