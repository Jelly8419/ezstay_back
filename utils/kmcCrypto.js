/**
 * KMC 본인인증 암호화 모듈
 * KmcCrypto 바이너리 프로세스와 stdin/stdout으로 통신하는 래퍼
 *
 * 지원 모드:
 * - enc: 암호화
 * - dec: 복호화
 * - msg: 위변조 검증값 생성
 */
const { spawn } = require('child_process');
const iconv = require('iconv-lite');

const MODULE_PATH = process.env.KMC_CRYPTO_PATH;
const MAX_SEQ = Number.MAX_SAFE_INTEGER;

let worker;
let buffer = Buffer.alloc(0);
let seq = 0;
let isRestarting = false;
const pending = new Map();

function startWorker() {
  if (isRestarting) return;
  isRestarting = true;

  if (worker) {
    worker.kill('SIGKILL');
    worker = null;
  }

  if (!MODULE_PATH) {
    console.warn('[KMC] KMC_CRYPTO_PATH 환경변수가 설정되지 않았습니다. KMC 본인인증을 사용할 수 없습니다.');
    isRestarting = false;
    return;
  }

  console.log('[KMC] KmcCrypto 프로세스 시작 중...');

  try {
    worker = spawn(MODULE_PATH);
  } catch (e) {
    console.error('[KMC] 프로세스 생성 실패:', e.message);
    setTimeout(startWorker, 5000);
    isRestarting = false;
    return;
  }

  worker.stdin.setDefaultEncoding('utf-8');
  isRestarting = false;

  // 응답 처리
  worker.stdout.on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);

    let newlineIndex;
    while ((newlineIndex = buffer.indexOf(0x0a)) >= 0) {
      let lineBuffer = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);

      // 캐리지 리턴 제거 (\r\n)
      if (lineBuffer.length > 0 && lineBuffer[lineBuffer.length - 1] === 0x0d) {
        lineBuffer = lineBuffer.slice(0, -1);
      }

      // 응답 파싱: id:result
      const separatorIndex = lineBuffer.indexOf(0x3a);
      if (separatorIndex < 0) continue;

      const id = parseInt(lineBuffer.slice(0, separatorIndex).toString('utf-8'), 10);
      const resultBuffer = lineBuffer.slice(separatorIndex + 1);
      const result = iconv.decode(resultBuffer, 'euc-kr');

      const handlers = pending.get(id);
      if (handlers) {
        clearTimeout(handlers.timeout);
        handlers.resolve(result);
        pending.delete(id);
      }
    }
  });

  worker.stderr.on('data', (data) => {
    console.error('[KMC] stderr:', data.toString());
  });

  worker.on('error', (err) => {
    console.error('[KMC] 프로세스 에러:', err.message);
  });

  worker.on('close', (code) => {
    if (isRestarting) return;

    console.warn(`[KMC] 프로세스 종료 (code: ${code}). 재시작 중...`);

    pending.forEach(({ reject, timeout }, id) => {
      clearTimeout(timeout);
      reject(new Error(`KMC 워커 프로세스 종료 (code: ${code}). Request ID: ${id}`));
    });
    pending.clear();

    setTimeout(startWorker, 1000);
  });

  console.log('[KMC] KmcCrypto 프로세스 시작 완료.');
}

// 서버 시작 시 워커 초기화 (경로가 설정된 경우에만)
if (MODULE_PATH) {
  startWorker();
}

/**
 * KMC 암호화/복호화 실행
 * @param {'enc'|'dec'|'msg'} mode - 실행 모드
 * @param {string} input - 입력 데이터
 * @returns {Promise<string>} 결과 문자열
 */
function kmcExec(mode, input) {
  return new Promise((resolve, reject) => {
    if (!worker || isRestarting) {
      reject(new Error('KMC 워커 프로세스가 준비되지 않았습니다.'));
      return;
    }

    if (seq > MAX_SEQ - 1000) seq = 0;
    const id = seq++;

    const timeout = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`KMC 응답 타임아웃 (id: ${id})`));
      }
    }, 10000);

    pending.set(id, { resolve, reject, timeout });

    try {
      worker.stdin.write(`${mode}:${id}^*${input}\n`);
    } catch (e) {
      console.error('[KMC] stdin 쓰기 실패:', e.message);
      clearTimeout(timeout);
      pending.delete(id);
      reject(new Error(`KMC stdin 쓰기 실패: ${e.message}`));

      if (!isRestarting) {
        worker.kill('SIGTERM');
      }
    }
  });
}

module.exports = kmcExec;
