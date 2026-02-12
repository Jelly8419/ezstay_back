# 백엔드 모델 설계 명세서 - 방 편의시설 (RoomAmenity)

## 📋 개요

현재 **이중 직렬화** 문제를 해결하기 위한 백엔드 API 모델 재설계 명세서입니다.

### 현재 문제점
```json
// ❌ 현재: JSON 문자열 안에 JSON (이중 직렬화)
{
  "roomId": 1,
  "basicOptions": "{\"wifi\": true, \"tv\": false}",  // String 타입!
  "additionalOptions": "{\"doorLock\": true}",
  "convenienceOptions": "{\"heater\": true}",
  "petsAllowed": true
}
```

### 개선 목표
```json
// ✅ 개선: 단일 직렬화 (타입 안전)
{
  "roomId": 1,
  "basicOptions": {
    "wifi": true,
    "tv": false
  },
  "additionalOptions": {
    "doorLock": true
  },
  "convenienceOptions": {
    "heater": true
  },
  "petsAllowed": true
}
```

---

## 📊 데이터 모델 정의

### 1. RoomAmenity (최상위 모델)

| 필드명 | 타입 | 필수 | 기본값 | 설명 |
|--------|------|------|--------|------|
| `roomId` | `integer` | ✅ | - | 방 ID (FK) |
| `basicOptions` | `BasicOptions` | ✅ | `{}` | 기본 옵션 객체 |
| `additionalOptions` | `AdditionalOptions` | ✅ | `{}` | 추가 옵션 객체 |
| `convenienceOptions` | `ConvenienceOptions` | ✅ | `{}` | 편의 옵션 객체 |
| `petsAllowed` | `boolean` | ✅ | `false` | 반려동물 동반 가능 여부 |
| `createdAt` | `datetime` | ❌ | `NOW()` | 생성일시 |
| `updatedAt` | `datetime` | ❌ | `NOW()` | 수정일시 |

---

### 2. BasicOptions (기본 옵션) - 7개 필드

**설명**: 숙박에 필수적인 기본 생활 시설 및 가전제품

| 필드명 | 타입 | 필수 | 기본값 | 한글명 | 카테고리 |
|--------|------|------|--------|--------|----------|
| `refrigerator` | `boolean` | ✅ | `false` | 냉장고 | 주방 가전 |
| `washingMachine` | `boolean` | ✅ | `false` | 세탁기 | 세탁 시설 |
| `airConditioner` | `boolean` | ✅ | `false` | 에어컨 | 냉방 시설 |
| `sink` | `boolean` | ✅ | `false` | 싱크대 | 주방 시설 |
| `bed` | `boolean` | ✅ | `false` | 침대 | 침실 가구 |
| `tv` | `boolean` | ✅ | `false` | TV | 전자기기 |
| `internet` | `boolean` | ✅ | `false` | 인터넷 (Wi-Fi) | 통신 |

**JSON Schema**:
```json
{
  "type": "object",
  "properties": {
    "refrigerator": { "type": "boolean", "default": false },
    "washingMachine": { "type": "boolean", "default": false },
    "airConditioner": { "type": "boolean", "default": false },
    "sink": { "type": "boolean", "default": false },
    "bed": { "type": "boolean", "default": false },
    "tv": { "type": "boolean", "default": false },
    "internet": { "type": "boolean", "default": false }
  },
  "required": []
}
```

**예시 데이터**:
```json
{
  "refrigerator": true,
  "washingMachine": true,
  "airConditioner": true,
  "sink": true,
  "bed": true,
  "tv": false,
  "internet": true
}
```

---

### 3. AdditionalOptions (추가 옵션) - 16개 필드

**설명**: 안전, 보안, 추가 가전제품 및 가구

| 필드명 | 타입 | 필수 | 기본값 | 한글명 | 카테고리 |
|--------|------|------|--------|--------|----------|
| `doorLock` | `boolean` | ✅ | `false` | 도어락 | 보안 |
| `cctv` | `boolean` | ✅ | `false` | CCTV | 보안 |
| `managementOffice` | `boolean` | ✅ | `false` | 관리실 | 건물 관리 |
| `gasRange` | `boolean` | ✅ | `false` | 가스레인지 | 주방 가전 |
| `induction` | `boolean` | ✅ | `false` | 인덕션 | 주방 가전 |
| `microwave` | `boolean` | ✅ | `false` | 전자레인지 | 주방 가전 |
| `diningTable` | `boolean` | ✅ | `false` | 식탁 | 주방 가구 |
| `shoeRack` | `boolean` | ✅ | `false` | 신발장 | 현관 가구 |
| `wardrobe` | `boolean` | ✅ | `false` | 옷장 | 침실 가구 |
| `dressRoom` | `boolean` | ✅ | `false` | 드레스룸 | 침실 공간 |
| `vanity` | `boolean` | ✅ | `false` | 화장대 | 침실 가구 |
| `cableTv` | `boolean` | ✅ | `false` | 케이블 TV | 전자기기 |
| `sofa` | `boolean` | ✅ | `false` | 소파 | 거실 가구 |
| `desk` | `boolean` | ✅ | `false` | 책상 | 가구 |
| `curtain` | `boolean` | ✅ | `false` | 커튼 | 인테리어 |
| `balcony` | `boolean` | ✅ | `false` | 발코니/베란다 | 공간 |

**JSON Schema**:
```json
{
  "type": "object",
  "properties": {
    "doorLock": { "type": "boolean", "default": false },
    "cctv": { "type": "boolean", "default": false },
    "managementOffice": { "type": "boolean", "default": false },
    "gasRange": { "type": "boolean", "default": false },
    "induction": { "type": "boolean", "default": false },
    "microwave": { "type": "boolean", "default": false },
    "diningTable": { "type": "boolean", "default": false },
    "shoeRack": { "type": "boolean", "default": false },
    "wardrobe": { "type": "boolean", "default": false },
    "dressRoom": { "type": "boolean", "default": false },
    "vanity": { "type": "boolean", "default": false },
    "cableTv": { "type": "boolean", "default": false },
    "sofa": { "type": "boolean", "default": false },
    "desk": { "type": "boolean", "default": false },
    "curtain": { "type": "boolean", "default": false },
    "balcony": { "type": "boolean", "default": false }
  },
  "required": []
}
```

**예시 데이터**:
```json
{
  "doorLock": true,
  "cctv": true,
  "managementOffice": true,
  "gasRange": false,
  "induction": true,
  "microwave": true,
  "diningTable": true,
  "shoeRack": true,
  "wardrobe": true,
  "dressRoom": false,
  "vanity": false,
  "cableTv": true,
  "sofa": true,
  "desk": true,
  "curtain": true,
  "balcony": false
}
```

---

### 4. ConvenienceOptions (편의 옵션) - 13개 필드

**설명**: 고급 편의시설 및 생활 편의 용품

| 필드명 | 타입 | 필수 | 기본값 | 한글명 | 카테고리 |
|--------|------|------|--------|--------|----------|
| `heatingCooling` | `boolean` | ✅ | `false` | 냉난방기 | 냉난방 |
| `heater` | `boolean` | ✅ | `false` | 히터 | 난방 |
| `airPurifier` | `boolean` | ✅ | `false` | 공기청정기 | 공기질 |
| `dryer` | `boolean` | ✅ | `false` | 건조기 | 세탁 시설 |
| `iron` | `boolean` | ✅ | `false` | 다리미 | 세탁 용품 |
| `waterPurifier` | `boolean` | ✅ | `false` | 정수기 | 주방 가전 |
| `riceCooker` | `boolean` | ✅ | `false` | 전기밥솥 | 주방 가전 |
| `electricKettle` | `boolean` | ✅ | `false` | 전기포트 | 주방 가전 |
| `dishes` | `boolean` | ✅ | `false` | 식기(그릇,수저) | 주방 용품 |
| `cookware` | `boolean` | ✅ | `false` | 조리도구(팬, 냄비) | 주방 용품 |
| `bathtub` | `boolean` | ✅ | `false` | 욕조 | 욕실 시설 |
| `hairDryer` | `boolean` | ✅ | `false` | 드라이어 | 욕실 용품 |
| `bidet` | `boolean` | ✅ | `false` | 비데 | 욕실 시설 |

**JSON Schema**:
```json
{
  "type": "object",
  "properties": {
    "heatingCooling": { "type": "boolean", "default": false },
    "heater": { "type": "boolean", "default": false },
    "airPurifier": { "type": "boolean", "default": false },
    "dryer": { "type": "boolean", "default": false },
    "iron": { "type": "boolean", "default": false },
    "waterPurifier": { "type": "boolean", "default": false },
    "riceCooker": { "type": "boolean", "default": false },
    "electricKettle": { "type": "boolean", "default": false },
    "dishes": { "type": "boolean", "default": false },
    "cookware": { "type": "boolean", "default": false },
    "bathtub": { "type": "boolean", "default": false },
    "hairDryer": { "type": "boolean", "default": false },
    "bidet": { "type": "boolean", "default": false }
  },
  "required": []
}
```

**예시 데이터**:
```json
{
  "heatingCooling": true,
  "heater": false,
  "airPurifier": true,
  "dryer": true,
  "iron": true,
  "waterPurifier": true,
  "riceCooker": true,
  "electricKettle": true,
  "dishes": true,
  "cookware": true,
  "bathtub": false,
  "hairDryer": true,
  "bidet": true
}
```

---

## 🔧 백엔드 구현 예시

### Java (Spring Boot)

```java
// RoomAmenity.java (Entity)
@Entity
@Table(name = "room_amenities")
public class RoomAmenity {
    @Id
    @Column(name = "room_id")
    private Integer roomId;

    @Type(type = "json")
    @Column(name = "basic_options", columnDefinition = "json")
    private BasicOptions basicOptions;

    @Type(type = "json")
    @Column(name = "additional_options", columnDefinition = "json")
    private AdditionalOptions additionalOptions;

    @Type(type = "json")
    @Column(name = "convenience_options", columnDefinition = "json")
    private ConvenienceOptions convenienceOptions;

    @Column(name = "pets_allowed")
    private Boolean petsAllowed;

    @CreatedDate
    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @LastModifiedDate
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}

// BasicOptions.java (Embeddable DTO)
@Data
@NoArgsConstructor
@AllArgsConstructor
public class BasicOptions {
    private Boolean refrigerator = false;
    private Boolean washingMachine = false;
    private Boolean airConditioner = false;
    private Boolean sink = false;
    private Boolean bed = false;
    private Boolean tv = false;
    private Boolean internet = false;
}

// AdditionalOptions.java
@Data
@NoArgsConstructor
@AllArgsConstructor
public class AdditionalOptions {
    private Boolean doorLock = false;
    private Boolean cctv = false;
    private Boolean managementOffice = false;
    private Boolean gasRange = false;
    private Boolean induction = false;
    private Boolean microwave = false;
    private Boolean diningTable = false;
    private Boolean shoeRack = false;
    private Boolean wardrobe = false;
    private Boolean dressRoom = false;
    private Boolean vanity = false;
    private Boolean cableTv = false;
    private Boolean sofa = false;
    private Boolean desk = false;
    private Boolean curtain = false;
    private Boolean balcony = false;
}

// ConvenienceOptions.java
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ConvenienceOptions {
    private Boolean heatingCooling = false;
    private Boolean heater = false;
    private Boolean airPurifier = false;
    private Boolean dryer = false;
    private Boolean iron = false;
    private Boolean waterPurifier = false;
    private Boolean riceCooker = false;
    private Boolean electricKettle = false;
    private Boolean dishes = false;
    private Boolean cookware = false;
    private Boolean bathtub = false;
    private Boolean hairDryer = false;
    private Boolean bidet = false;
}
```

---

### TypeScript (Node.js)

```typescript
// types/amenity.types.ts

export interface RoomAmenity {
  roomId: number;
  basicOptions: BasicOptions;
  additionalOptions: AdditionalOptions;
  convenienceOptions: ConvenienceOptions;
  petsAllowed: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface BasicOptions {
  refrigerator: boolean;
  washingMachine: boolean;
  airConditioner: boolean;
  sink: boolean;
  bed: boolean;
  tv: boolean;
  internet: boolean;
}

export interface AdditionalOptions {
  doorLock: boolean;
  cctv: boolean;
  managementOffice: boolean;
  gasRange: boolean;
  induction: boolean;
  microwave: boolean;
  diningTable: boolean;
  shoeRack: boolean;
  wardrobe: boolean;
  dressRoom: boolean;
  vanity: boolean;
  cableTv: boolean;
  sofa: boolean;
  desk: boolean;
  curtain: boolean;
  balcony: boolean;
}

export interface ConvenienceOptions {
  heatingCooling: boolean;
  heater: boolean;
  airPurifier: boolean;
  dryer: boolean;
  iron: boolean;
  waterPurifier: boolean;
  riceCooker: boolean;
  electricKettle: boolean;
  dishes: boolean;
  cookware: boolean;
  bathtub: boolean;
  hairDryer: boolean;
  bidet: boolean;
}

// 기본값 제공 함수
export const defaultBasicOptions = (): BasicOptions => ({
  refrigerator: false,
  washingMachine: false,
  airConditioner: false,
  sink: false,
  bed: false,
  tv: false,
  internet: false,
});

export const defaultAdditionalOptions = (): AdditionalOptions => ({
  doorLock: false,
  cctv: false,
  managementOffice: false,
  gasRange: false,
  induction: false,
  microwave: false,
  diningTable: false,
  shoeRack: false,
  wardrobe: false,
  dressRoom: false,
  vanity: false,
  cableTv: false,
  sofa: false,
  desk: false,
  curtain: false,
  balcony: false,
});

export const defaultConvenienceOptions = (): ConvenienceOptions => ({
  heatingCooling: false,
  heater: false,
  airPurifier: false,
  dryer: false,
  iron: false,
  waterPurifier: false,
  riceCooker: false,
  electricKettle: false,
  dishes: false,
  cookware: false,
  bathtub: false,
  hairDryer: false,
  bidet: false,
});
```

---

### Kotlin (Spring Boot)

```kotlin
// RoomAmenity.kt (Entity)
@Entity
@Table(name = "room_amenities")
data class RoomAmenity(
    @Id
    @Column(name = "room_id")
    val roomId: Int,

    @Convert(converter = BasicOptionsConverter::class)
    @Column(name = "basic_options", columnDefinition = "json")
    val basicOptions: BasicOptions = BasicOptions(),

    @Convert(converter = AdditionalOptionsConverter::class)
    @Column(name = "additional_options", columnDefinition = "json")
    val additionalOptions: AdditionalOptions = AdditionalOptions(),

    @Convert(converter = ConvenienceOptionsConverter::class)
    @Column(name = "convenience_options", columnDefinition = "json")
    val convenienceOptions: ConvenienceOptions = ConvenienceOptions(),

    @Column(name = "pets_allowed")
    val petsAllowed: Boolean = false,

    @CreatedDate
    @Column(name = "created_at")
    val createdAt: LocalDateTime? = null,

    @LastModifiedDate
    @Column(name = "updated_at")
    val updatedAt: LocalDateTime? = null
)

// BasicOptions.kt
data class BasicOptions(
    val refrigerator: Boolean = false,
    val washingMachine: Boolean = false,
    val airConditioner: Boolean = false,
    val sink: Boolean = false,
    val bed: Boolean = false,
    val tv: Boolean = false,
    val internet: Boolean = false
)

// AdditionalOptions.kt
data class AdditionalOptions(
    val doorLock: Boolean = false,
    val cctv: Boolean = false,
    val managementOffice: Boolean = false,
    val gasRange: Boolean = false,
    val induction: Boolean = false,
    val microwave: Boolean = false,
    val diningTable: Boolean = false,
    val shoeRack: Boolean = false,
    val wardrobe: Boolean = false,
    val dressRoom: Boolean = false,
    val vanity: Boolean = false,
    val cableTv: Boolean = false,
    val sofa: Boolean = false,
    val desk: Boolean = false,
    val curtain: Boolean = false,
    val balcony: Boolean = false
)

// ConvenienceOptions.kt
data class ConvenienceOptions(
    val heatingCooling: Boolean = false,
    val heater: Boolean = false,
    val airPurifier: Boolean = false,
    val dryer: Boolean = false,
    val iron: Boolean = false,
    val waterPurifier: Boolean = false,
    val riceCooker: Boolean = false,
    val electricKettle: Boolean = false,
    val dishes: Boolean = false,
    val cookware: Boolean = false,
    val bathtub: Boolean = false,
    val hairDryer: Boolean = false,
    val bidet: Boolean = false
)
```

---

## 📦 데이터베이스 스키마 (MySQL/PostgreSQL)

### MySQL
```sql
CREATE TABLE room_amenities (
    room_id INT PRIMARY KEY,
    basic_options JSON NOT NULL,
    additional_options JSON NOT NULL,
    convenience_options JSON NOT NULL,
    pets_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

-- 예시 데이터 삽입
INSERT INTO room_amenities (room_id, basic_options, additional_options, convenience_options, pets_allowed)
VALUES (
    1,
    '{"refrigerator": true, "washingMachine": true, "airConditioner": true, "sink": true, "bed": true, "tv": false, "internet": true}',
    '{"doorLock": true, "cctv": true, "managementOffice": false, "gasRange": false, "induction": true, "microwave": true, "diningTable": true, "shoeRack": true, "wardrobe": true, "dressRoom": false, "vanity": false, "cableTv": true, "sofa": true, "desk": true, "curtain": true, "balcony": false}',
    '{"heatingCooling": true, "heater": false, "airPurifier": true, "dryer": true, "iron": true, "waterPurifier": true, "riceCooker": true, "electricKettle": true, "dishes": true, "cookware": true, "bathtub": false, "hairDryer": true, "bidet": true}',
    false
);
```

### PostgreSQL
```sql
CREATE TABLE room_amenities (
    room_id INTEGER PRIMARY KEY,
    basic_options JSONB NOT NULL,
    additional_options JSONB NOT NULL,
    convenience_options JSONB NOT NULL,
    pets_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

-- JSONB 인덱싱 (검색 성능 향상)
CREATE INDEX idx_basic_options_gin ON room_amenities USING GIN (basic_options);
CREATE INDEX idx_additional_options_gin ON room_amenities USING GIN (additional_options);
CREATE INDEX idx_convenience_options_gin ON room_amenities USING GIN (convenience_options);
```

---

## 🌐 API 엔드포인트 명세

### PATCH `/api/host/rooms/{roomId}/amenities`

**Request Body**:
```json
{
  "basicOptions": {
    "refrigerator": true,
    "washingMachine": true,
    "airConditioner": true,
    "sink": true,
    "bed": true,
    "tv": false,
    "internet": true
  },
  "additionalOptions": {
    "doorLock": true,
    "cctv": true,
    "managementOffice": true,
    "gasRange": false,
    "induction": true,
    "microwave": true,
    "diningTable": true,
    "shoeRack": true,
    "wardrobe": true,
    "dressRoom": false,
    "vanity": false,
    "cableTv": true,
    "sofa": true,
    "desk": true,
    "curtain": true,
    "balcony": false
  },
  "convenienceOptions": {
    "heatingCooling": true,
    "heater": false,
    "airPurifier": true,
    "dryer": true,
    "iron": true,
    "waterPurifier": true,
    "riceCooker": true,
    "electricKettle": true,
    "dishes": true,
    "cookware": true,
    "bathtub": false,
    "hairDryer": true,
    "bidet": true
  },
  "petsAllowed": false
}
```

**Response (200 OK)**:
```json
{
  "roomId": 1,
  "basicOptions": {
    "refrigerator": true,
    "washingMachine": true,
    "airConditioner": true,
    "sink": true,
    "bed": true,
    "tv": false,
    "internet": true
  },
  "additionalOptions": {
    "doorLock": true,
    "cctv": true,
    "managementOffice": true,
    "gasRange": false,
    "induction": true,
    "microwave": true,
    "diningTable": true,
    "shoeRack": true,
    "wardrobe": true,
    "dressRoom": false,
    "vanity": false,
    "cableTv": true,
    "sofa": true,
    "desk": true,
    "curtain": true,
    "balcony": false
  },
  "convenienceOptions": {
    "heatingCooling": true,
    "heater": false,
    "airPurifier": true,
    "dryer": true,
    "iron": true,
    "waterPurifier": true,
    "riceCooker": true,
    "electricKettle": true,
    "dishes": true,
    "cookware": true,
    "bathtub": false,
    "hairDryer": true,
    "bidet": true
  },
  "petsAllowed": false,
  "createdAt": "2025-11-19T10:30:00Z",
  "updatedAt": "2025-11-19T10:30:00Z"
}
```

---

## 📊 요약 통계

| 분류 | 필드 개수 | 설명 |
|------|-----------|------|
| **BasicOptions** | 7개 | 기본 생활 시설 |
| **AdditionalOptions** | 16개 | 안전/보안/추가 가구 |
| **ConvenienceOptions** | 13개 | 고급 편의시설 |
| **petsAllowed** | 1개 | 반려동물 동반 여부 |
| **총합** | **37개** | 전체 편의시설 항목 |

---

## ✅ 체크리스트

### 백엔드 개발자
- [ ] DB 스키마 변경 (TEXT → JSON/JSONB)
- [ ] Entity/Model 클래스 생성 (BasicOptions, AdditionalOptions, ConvenienceOptions)
- [ ] JSON Converter 구현 (JPA AttributeConverter)
- [ ] API 응답 형식 변경 (이중 직렬화 제거)
- [ ] 기존 데이터 마이그레이션 스크립트 작성
- [ ] 단위 테스트 작성
- [ ] API 문서 업데이트 (Swagger/OpenAPI)

### 프론트엔드 개발자 (Flutter)
- [ ] Freezed + json_serializable 패키지 추가
- [ ] RoomAmenity 모델 재작성
- [ ] BasicOptions, AdditionalOptions, ConvenienceOptions 모델 생성
- [ ] room_amenities_page.dart 리팩토링 (37개 변수 → 모델 객체)
- [ ] API 통신 코드 수정
- [ ] 단위 테스트 작성

---

## 🔄 마이그레이션 전략

### 1단계: 백엔드 변경 (하위 호환성 유지)
```java
// 기존 API도 동시 지원 (Deprecated)
@Deprecated
@PatchMapping("/rooms/{roomId}/amenities-legacy")
public ResponseEntity<?> updateAmenitiesLegacy(@PathVariable Integer roomId, @RequestBody Map<String, String> data) {
    // 이중 직렬화된 기존 형식 처리
}

// 새 API (권장)
@PatchMapping("/rooms/{roomId}/amenities")
public ResponseEntity<RoomAmenity> updateAmenities(@PathVariable Integer roomId, @RequestBody RoomAmenity amenity) {
    // 단일 직렬화 형식 처리
}
```

### 2단계: 프론트엔드 변경
- 새 모델 클래스 적용
- 새 API 엔드포인트 사용

### 3단계: 기존 API 제거
- Deprecated API 제거
- 레거시 코드 정리

---

## 🎯 기대 효과

1. **타입 안전성 향상**: 컴파일 타임에 오류 발견
2. **코드 간결화**: 37개 변수 → 3개 객체
3. **유지보수성 개선**: 새 옵션 추가 시 한 곳만 수정
4. **성능 개선**: 파싱 단계 2단계 → 1단계
5. **API 명확성**: JSON 구조가 직관적

---

**작성일**: 2025-11-19
**버전**: 1.0
**담당**: Claude (AI Assistant)
