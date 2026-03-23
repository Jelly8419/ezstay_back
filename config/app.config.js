/**
 * Application Configuration
 * 애플리케이션 전역 설정 상수 관리
 */

module.exports = {
  // 지도 관련 설정
  map: {
    // 줌 레벨 임계값
    zoom: {
      MAX: 6,           // 최대 줌 레벨 (이상이면 매물 미표시)
      MEDIUM: 5,        // 중간 영역 (동 레벨)
      DETAIL: 3         // 상세 영역 (거리/건물 레벨)
    },

    // 조회 개수 제한
    limits: {
      DEFAULT: 500,     // 기본 조회 개수
      MEDIUM: 300,      // 중간 영역 조회 개수
      DETAIL: 200,      // 상세 영역 조회 개수
      MAX: 500          // 최대 조회 개수
    },

    // 좌표 설정
    coordinate: {
      PRECISION: 4,     // 소수점 자리수 (약 11m 정밀도)
      LATITUDE_MIN: -90,
      LATITUDE_MAX: 90,
      LONGITUDE_MIN: -180,
      LONGITUDE_MAX: 180
    }
  },

  // 서비스 지역 제한
  region: {
    ALLOWED: ['서울']  // 허용 지역 목록 (주소 앞부분 매칭)
  },

  // 보증금 설정
  deposit: {
    DEFAULT: Number(process.env.DEFAULT_DEPOSIT) || 300000
  },

  // 캐시 관련 설정
  cache: {
    ttl: {
      REDIS: 300,       // Redis 캐시 TTL (5분, 초 단위)
      BROWSER: 60       // 브라우저 캐시 max-age (1분, 초 단위)
    }
  }
};
