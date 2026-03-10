/**
 * 알림톡 템플릿 캐시 (in-memory)
 *
 * Aligo API에서 가져온 templtContent를 tplCode별로 캐시하고,
 * 발송 시 #{변수명}을 실제 값으로 치환하여 message_1을 생성한다.
 *
 * 흐름:
 *   1. syncTemplates() → Aligo 템플릿 조회 API → 캐시 저장
 *   2. buildMessage(eventName, data) → 캐시에서 templtContent 가져와 #{변수} 치환
 *   3. 캐시 미스 시 fallbackContent 사용
 */

const { fetchTemplates } = require('./aligoClient');
const { templates } = require('../config/alimtalkTemplates');

// tplCode → { templtContent, buttons, status, inspStatus, lastFetched }
const cache = new Map();
let lastSyncTime = null;
let syncError = null;

/**
 * Aligo API에서 템플릿 목록을 가져와 캐시에 저장
 * 승인(APR) 상태인 템플릿만 캐시
 */
async function syncTemplates() {
  try {
    const result = await fetchTemplates();

    if (!result.success) {
      syncError = result.error;
      console.error(`[TemplateCache] 템플릿 동기화 실패: ${result.error}`);
      return { success: false, error: result.error, count: 0 };
    }

    // 기존 캐시 초기화 (삭제/승인취소된 템플릿이 남지 않도록)
    cache.clear();

    let count = 0;
    for (const tpl of result.data) {
      // 승인된 템플릿만 캐시
      if (tpl.inspStatus !== 'APR') continue;

      cache.set(tpl.templtCode, {
        templtContent: tpl.templtContent,
        templtName: tpl.templtName,
        buttons: tpl.buttons || [],
        status: tpl.status,
        inspStatus: tpl.inspStatus,
        lastFetched: new Date()
      });
      count++;
    }

    lastSyncTime = new Date();
    syncError = null;
    console.log(`[TemplateCache] 동기화 완료: ${count}개 템플릿 캐시됨`);
    return { success: true, error: null, count };
  } catch (err) {
    syncError = err.message;
    console.error(`[TemplateCache] 동기화 에러: ${err.message}`);
    return { success: false, error: err.message, count: 0 };
  }
}

/**
 * 템플릿 내용에서 #{변수명}을 실제 값으로 치환
 * @param {string} content - templtContent (e.g., "#{방이름}님 안녕하세요")
 * @param {Object} varMap - JS key → Korean name mapping (e.g., { roomName: '방이름' })
 * @param {Object} data - 실제 데이터 (e.g., { roomName: '강남원룸' })
 * @returns {string} 치환 완료된 메시지
 */
function substituteVars(content, varMap, data) {
  let result = content;
  for (const [jsKey, koreanName] of Object.entries(varMap)) {
    const placeholder = `#{${koreanName}}`;
    const value = data[jsKey] != null ? String(data[jsKey]) : '';
    result = result.split(placeholder).join(value);
  }
  return result;
}

/**
 * eventName 기반으로 최종 메시지를 빌드
 * 1. 캐시에 templtContent 있으면 사용 (Aligo 원본 → 100% 일치 보장)
 * 2. 없으면 fallbackContent 사용 (하드코딩 백업)
 * 3. 둘 다 없으면 null 반환
 *
 * @param {string} eventName - 이벤트명 (e.g., 'payment_completed_guest')
 * @param {Object} data - 치환할 데이터 (e.g., { roomName: '강남원룸', amount: '1,500,000' })
 * @returns {string|null} 치환된 메시지 또는 null
 */
function buildMessage(eventName, data) {
  const templateDef = templates[eventName];
  if (!templateDef) return null;

  const { tplCode, varMap, fallbackContent } = templateDef;

  // 캐시에서 Aligo 원본 templtContent 가져오기
  const cached = tplCode ? cache.get(tplCode) : null;
  const content = cached?.templtContent || fallbackContent;

  if (!content) return null;

  return substituteVars(content, varMap || {}, data || {});
}

/**
 * 캐시된 버튼 정보 조회 (발송 시 button_1 파라미터용)
 * @param {string} tplCode
 * @returns {Array|null}
 */
function getCachedButtons(tplCode) {
  const cached = cache.get(tplCode);
  return cached?.buttons?.length > 0 ? cached.buttons : null;
}

/**
 * 캐시 상태 조회 (관리자 API용)
 */
function getCacheStatus() {
  return {
    templateCount: cache.size,
    lastSyncTime,
    syncError,
    templates: Array.from(cache.entries()).map(([code, data]) => ({
      tplCode: code,
      templtName: data.templtName,
      templtContent: data.templtContent,
      buttons: data.buttons,
      status: data.status,
      inspStatus: data.inspStatus,
      lastFetched: data.lastFetched
    }))
  };
}

module.exports = {
  syncTemplates,
  buildMessage,
  substituteVars,
  getCachedButtons,
  getCacheStatus
};
