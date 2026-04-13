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
      // 줌 레벨별 캐시 키 소수점 자리수 (카카오맵: 숫자 작을수록 확대)
      // zoom 1~2 (상세, 뷰포트 ~1km)  → 소수점 3자리 (111m 단위)
      // zoom 3~4 (중간, 뷰포트 ~5km)  → 소수점 2자리 (1.1km 단위)
      // zoom 5+  (광역, 뷰포트 ~30km) → 소수점 1자리 (11km 단위)
      PRECISION_DETAIL: 3,
      PRECISION_MEDIUM: 2,
      PRECISION_WIDE: 1,
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
