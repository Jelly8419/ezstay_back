-- 대여 물품 카탈로그 테이블 생성
-- 전체 서비스에서 공용으로 관리하는 대여 물품 정보

CREATE TABLE IF NOT EXISTS rental_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    item_type ENUM('hair_dryer', 'bedding_set', 'amenity_kit', 'towel_set', 'other') NOT NULL COMMENT '물품 카테고리',
    name VARCHAR(100) NOT NULL COMMENT '물품명 (예: 프리미엄 어메니티 키트)',
    description TEXT COMMENT '물품 설명',
    price DECIMAL(10, 2) NOT NULL DEFAULT 0 COMMENT '대여 가격 (1회당)',
    total_stock INT NOT NULL DEFAULT 0 COMMENT '총 재고 수량',
    available_stock INT NOT NULL DEFAULT 0 COMMENT '현재 이용 가능한 수량',
    image_url VARCHAR(255) COMMENT '물품 이미지 URL',
    is_active BOOLEAN NOT NULL DEFAULT true COMMENT '활성화 여부 (비활성화시 선택 불가)',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- 재고는 음수가 될 수 없음
    CHECK (total_stock >= 0),
    CHECK (available_stock >= 0),
    CHECK (available_stock <= total_stock),
    CHECK (price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='대여 물품 카탈로그';

-- 인덱스 생성
CREATE INDEX idx_item_type ON rental_items(item_type);
CREATE INDEX idx_is_active ON rental_items(is_active);
CREATE INDEX idx_available_stock ON rental_items(available_stock);

-- 기본 데이터 삽입 (예시)
INSERT INTO rental_items (item_type, name, description, price, total_stock, available_stock) VALUES
('amenity_kit', '기본 어메니티 키트', '샴푸, 린스, 바디워시, 치약, 칫솔 포함', 3000, 100, 100),
('amenity_kit', '프리미엄 어메니티 키트', '고급 브랜드 샴푸, 린스, 바디워시, 로션, 치약, 칫솔, 면도기 포함', 8000, 50, 50),
('hair_dryer', '기본 헤어드라이어', '1600W 일반 헤어드라이어', 5000, 80, 80),
('hair_dryer', '다이슨 헤어드라이어', '프리미엄 고속 건조 헤어드라이어', 15000, 30, 30),
('bedding_set', '기본 침구 세트', '이불, 베개, 시트 포함', 10000, 150, 150),
('bedding_set', '프리미엄 침구 세트', '고급 호텔식 침구, 베개 2개, 이불, 매트리스 커버 포함', 20000, 70, 70),
('towel_set', '기본 수건 세트', '바스타월 2장, 페이스타월 2장', 3000, 200, 200),
('towel_set', '프리미엄 수건 세트', '호텔식 두꺼운 수건, 바스타월 3장, 페이스타월 3장', 6000, 100, 100);
