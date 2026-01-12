# 📱 Flutter - 로컬/테스트 환경 결제 시스템 구현 가이드

## 📋 목차
1. [개요](#개요)
2. [토스페이먼츠 SDK 설정](#토스페이먼츠-sdk-설정)
3. [로컬 서버 연결 설정](#로컬-서버-연결-설정)
4. [결제 플로우 구현](#결제-플로우-구현)
5. [Mock 모드 구현](#mock-모드-구현)
6. [테스트 시나리오](#테스트-시나리오)
7. [디버깅 팁](#디버깅-팁)

---

## 개요

Flutter 앱에서 토스페이먼츠를 연동하여 로컬 및 테스트 환경에서 결제를 테스트하는 방법을 안내합니다.

### 테스트 환경 구성

```
┌─────────────────────────────────────────────────┐
│ 1️⃣ 토스 결제 위젯 (권장)                        │
│    - Toss Payments Flutter SDK 사용              │
│    - 토스 제공 결제 UI                           │
│    - 테스트 카드로 실제 플로우 테스트             │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ 2️⃣ Mock 모드 (선택)                             │
│    - 백엔드 Mock API 사용                        │
│    - 빠른 UI 테스트                              │
│    - 네트워크 의존성 없음                        │
└─────────────────────────────────────────────────┘
```

---

## 토스페이먼츠 SDK 설정

### 📦 1. 패키지 설치

```yaml
# pubspec.yaml
dependencies:
  tosspayments_flutter_sdk: ^1.0.0  # 최신 버전 확인
  http: ^1.1.0
  flutter_dotenv: ^5.1.0  # 환경변수 관리용
```

```bash
flutter pub get
```

### 🔑 2. 환경변수 설정

```env
# .env.development (로컬 개발)
TOSS_CLIENT_KEY=test_ck_OEP59LybZ8BN3Y1Y7kVrwYxAdXy1
API_BASE_URL=http://10.0.2.2:8080  # Android Emulator
PAYMENT_MOCK_MODE=false

# .env.test (테스트 서버)
TOSS_CLIENT_KEY=test_ck_OEP59LybZ8BN3Y1Y7kVrwYxAdXy1
API_BASE_URL=https://test.ezstay.com
PAYMENT_MOCK_MODE=false
```

### ⚙️ 3. SDK 초기화

```dart
// config/payment_config.dart
import 'package:tosspayments_flutter_sdk/tosspayments_flutter_sdk.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

class PaymentConfig {
  static final String clientKey = dotenv.env['TOSS_CLIENT_KEY']!;
  static final String baseUrl = dotenv.env['API_BASE_URL']!;
  static final bool useMockMode = dotenv.env['PAYMENT_MOCK_MODE'] == 'true';

  static late TossPayments tossPayments;

  static void initialize() {
    tossPayments = TossPayments(clientKey: clientKey);
  }
}
```

```dart
// main.dart
import 'package:flutter_dotenv/flutter_dotenv.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // 환경변수 로드
  await dotenv.load(fileName: ".env.development");

  // 토스페이먼츠 초기화
  PaymentConfig.initialize();

  runApp(MyApp());
}
```

---

## 로컬 서버 연결 설정

### 📱 플랫폼별 서버 URL

#### Android Emulator
```dart
// Android 에뮬레이터는 10.0.2.2로 localhost 접근
final baseUrl = 'http://10.0.2.2:8080';
```

**이유**: Android 에뮬레이터는 자체 가상 네트워크를 사용하므로 `localhost`는 에뮬레이터 자신을 가리킵니다. 호스트 머신의 `localhost`에 접근하려면 특수 IP `10.0.2.2`를 사용해야 합니다.

#### iOS Simulator
```dart
// iOS 시뮬레이터는 localhost 직접 사용
final baseUrl = 'http://localhost:8080';
```

**이유**: iOS 시뮬레이터는 호스트 머신의 네트워크를 공유하므로 `localhost`가 그대로 작동합니다.

#### 실제 디바이스
```dart
// ngrok URL 사용
final baseUrl = 'https://abc123.ngrok.io';
```

**이유**: 실제 디바이스는 개발 머신과 다른 네트워크에 있을 수 있으므로 ngrok 같은 터널 서비스로 외부에 노출된 URL을 사용합니다.

### 🔧 ApiConfig 구현

```dart
// config/api_config.dart
import 'dart:io';
import 'package:flutter_dotenv/flutter_dotenv.dart';

class ApiConfig {
  static String get baseUrl {
    final envUrl = dotenv.env['API_BASE_URL'];

    if (envUrl != null && envUrl.isNotEmpty) {
      return envUrl;
    }

    // 환경변수 없으면 플랫폼별 기본값
    if (Platform.isAndroid) {
      return 'http://10.0.2.2:8080';
    } else if (Platform.isIOS) {
      return 'http://localhost:8080';
    } else {
      return 'http://localhost:8080';
    }
  }

  static bool get useMockPayment =>
      dotenv.env['PAYMENT_MOCK_MODE'] == 'true';
}
```

--

## 결제 플로우 구현

### 💳 1. 결제 정보 조회

```dart
// services/payment_service.dart
import 'package:http/http.dart' as http;
import 'dart:convert';

class PaymentService {
  final String baseUrl = ApiConfig.baseUrl;
  final String? accessToken;

  PaymentService({required this.accessToken});

  // 결제 정보 조회
  Future<Map<String, dynamic>> getPaymentInfo(int contractId) async {
    final response = await http.get(
      Uri.parse('$baseUrl/api/contracts/$contractId/payment-info'),
      headers: {
        'Authorization': 'Bearer $accessToken',
      },
    );

    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      return data['data'];
    } else {
      throw Exception('결제 정보 조회 실패');
    }
  }
}
```

### 🎯 2. 토스 결제창 호출

```dart
// screens/payment_screen.dart
import 'package:tosspayments_flutter_sdk/tosspayments_flutter_sdk.dart';

class PaymentScreen extends StatefulWidget {
  final int contractId;

  const PaymentScreen({required this.contractId});

  @override
  State<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends State<PaymentScreen> {
  final PaymentService _paymentService = PaymentService(
    accessToken: AuthService.getAccessToken(),
  );

  Future<void> _requestPayment() async {
    try {
      // 1. 결제 정보 조회
      final paymentInfo = await _paymentService.getPaymentInfo(widget.contractId);

      // 2. 토스 결제창 호출
      final result = await PaymentConfig.tossPayments.requestPayment(
        method: PaymentMethod.card,
        amount: paymentInfo['amount'],
        orderId: paymentInfo['orderId'],
        orderName: paymentInfo['orderName'],
        successUrl: '${ApiConfig.baseUrl}/payment/success',
        failUrl: '${ApiConfig.baseUrl}/payment/fail',
        customerEmail: paymentInfo['customerEmail'],
        customerName: paymentInfo['customerName'],
      );

      // 3. 결제 성공 시 승인 요청
      if (result != null && result.success) {
        await _confirmPayment(
          contractId: widget.contractId,
          paymentKey: result.paymentKey!,
          orderId: paymentInfo['orderId'],
          amount: paymentInfo['amount'],
        );
      }
    } catch (e) {
      print('결제 오류: $e');
      _showErrorDialog('결제 중 오류가 발생했습니다.');
    }
  }

  Future<void> _confirmPayment({
    required int contractId,
    required String paymentKey,
    required String orderId,
    required int amount,
  }) async {
    final response = await http.post(
      Uri.parse('${ApiConfig.baseUrl}/api/contracts/$contractId/confirm-payment'),
      headers: {
        'Authorization': 'Bearer ${AuthService.getAccessToken()}',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'paymentKey': paymentKey,
        'orderId': orderId,
        'amount': amount,
      }),
    );

    if (response.statusCode == 200) {
      _showSuccessDialog('결제가 완료되었습니다!');
      Navigator.of(context).pop(true); // 결제 완료 후 이전 화면으로
    } else {
      final error = jsonDecode(response.body);
      _showErrorDialog(error['message'] ?? '결제 승인 실패');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('결제하기')),
      body: Center(
        child: ElevatedButton(
          onPressed: _requestPayment,
          child: Text('결제하기'),
        ),
      ),
    );
  }
}
```

### 🌐 3. WebView 리다이렉트 처리 (필요 시)

결제창이 WebView로 열리는 경우, successUrl/failUrl 리다이렉트를 감지해야 합니다.

```dart
// 토스 SDK가 자동으로 처리하므로 일반적으로 불필요
// 커스텀 WebView 사용 시에만 아래 코드 참고

import 'package:webview_flutter/webview_flutter.dart';

WebView(
  initialUrl: paymentUrl,
  javascriptMode: JavascriptMode.unrestricted,
  navigationDelegate: (NavigationRequest request) {
    if (request.url.startsWith('${ApiConfig.baseUrl}/payment/success')) {
      // 성공 URL로 리다이렉트됨
      final uri = Uri.parse(request.url);
      final paymentKey = uri.queryParameters['paymentKey'];
      final orderId = uri.queryParameters['orderId'];
      final amount = uri.queryParameters['amount'];

      // 결제 승인 API 호출
      _confirmPayment(
        contractId: contractId,
        paymentKey: paymentKey!,
        orderId: orderId!,
        amount: int.parse(amount!),
      );

      return NavigationDecision.prevent;
    } else if (request.url.startsWith('${ApiConfig.baseUrl}/payment/fail')) {
      // 실패 URL로 리다이렉트됨
      _showErrorDialog('결제가 취소되었습니다.');
      Navigator.of(context).pop(false);
      return NavigationDecision.prevent;
    }

    return NavigationDecision.navigate;
  },
);
```

---

## Mock 모드 구현

네트워크 없이 빠른 UI 테스트를 위한 Mock 모드 구현입니다.

### 🎭 1. Mock 모드 활성화

```env
# .env.development
PAYMENT_MOCK_MODE=true
```

### 🔧 2. Mock Payment Service

```dart
// services/payment_service.dart
class PaymentService {
  final String baseUrl = ApiConfig.baseUrl;
  final String? accessToken;

  PaymentService({required this.accessToken});

  // Mock 결제 승인
  Future<Map<String, dynamic>> confirmPaymentMock({
    required int contractId,
    required String orderId,
    required int amount,
    bool simulateFailure = false,
  }) async {
    final endpoint = '/api/contracts/$contractId/confirm-payment-mock';

    final response = await http.post(
      Uri.parse('$baseUrl$endpoint'),
      headers: {
        'Authorization': 'Bearer $accessToken',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'orderId': orderId,
        'amount': amount,
        'simulateFailure': simulateFailure,
      }),
    );

    if (response.statusCode == 200) {
      return jsonDecode(response.body)['data'];
    } else {
      throw Exception('Mock 결제 실패');
    }
  }

  // 실제 결제 또는 Mock 결제 선택
  Future<void> processPayment({
    required int contractId,
    required String orderId,
    required int amount,
    String? paymentKey,
  }) async {
    if (ApiConfig.useMockPayment) {
      // Mock 모드
      await confirmPaymentMock(
        contractId: contractId,
        orderId: orderId,
        amount: amount,
      );
    } else {
      // 실제 결제
      await confirmPayment(
        contractId: contractId,
        paymentKey: paymentKey!,
        orderId: orderId,
        amount: amount,
      );
    }
  }
}
```

### 📱 3. UI에서 Mock 모드 사용

```dart
// screens/payment_screen.dart
Future<void> _handlePayment() async {
  final paymentInfo = await _paymentService.getPaymentInfo(widget.contractId);

  if (ApiConfig.useMockPayment) {
    // Mock 모드: 토스 결제창 없이 바로 승인
    await _paymentService.processPayment(
      contractId: widget.contractId,
      orderId: paymentInfo['orderId'],
      amount: paymentInfo['amount'],
    );

    _showSuccessDialog('[MOCK] 결제 완료!');
  } else {
    // 실제 토스 결제창 호출
    final result = await PaymentConfig.tossPayments.requestPayment(
      method: PaymentMethod.card,
      amount: paymentInfo['amount'],
      orderId: paymentInfo['orderId'],
      orderName: paymentInfo['orderName'],
      successUrl: '${ApiConfig.baseUrl}/payment/success',
      failUrl: '${ApiConfig.baseUrl}/payment/fail',
      customerEmail: paymentInfo['customerEmail'],
      customerName: paymentInfo['customerName'],
    );

    if (result != null && result.success) {
      await _paymentService.processPayment(
        contractId: widget.contractId,
        orderId: paymentInfo['orderId'],
        amount: paymentInfo['amount'],
        paymentKey: result.paymentKey,
      );
    }
  }
}
```

---

## 테스트 시나리오

### 📋 1. 테스트 카드 번호

토스페이먼츠에서 제공하는 **실제 결제되지 않는** 테스트 카드:

| 카드사 | 카드번호 | 비밀번호 | CVC | 유효기간 |
|--------|---------|---------|-----|---------|
| 신한카드 | `5449-0300-0000-0009` | 아무거나 | 123 | 12/25 |
| 현대카드 | `5334-9900-0000-0008` | 아무거나 | 123 | 12/25 |
| 국민카드 | `4570-2800-0000-0007` | 아무거나 | 123 | 12/25 |
| 삼성카드 | `4530-4100-0000-0006` | 아무거나 | 123 | 12/25 |
| 롯데카드 | `5472-9500-0000-0004` | 아무거나 | 123 | 12/25 |

**특징**:
- ✅ 실제 카드사 연결 없이 승인 완료
- ✅ 실제 금액 차감 없음
- ✅ 모든 결제 플로우 테스트 가능

### ✅ 2. 정상 결제 플로우 테스트

```dart
// 테스트 순서
1. 계약 상태 확인 (APPROVED 상태여야 함)
2. 결제하기 버튼 클릭
3. 토스 결제창 열림
4. 테스트 카드 번호 입력: 5449-0300-0000-0009
5. 비밀번호: 1234 (아무거나)
6. CVC: 123
7. 유효기간: 12/25
8. 결제 완료 확인
9. 계약 상태 PAYMENT_COMPLETED로 변경 확인
```

### ❌ 3. 결제 실패 테스트

```dart
// 토스 결제창에서 취소 버튼 클릭
→ failUrl로 리다이렉트
→ "결제가 취소되었습니다" 메시지 표시
→ 계약 상태는 APPROVED로 유지
```

### 🎭 4. Mock 모드 테스트

```dart
// .env.development
PAYMENT_MOCK_MODE=true

// 테스트
1. 앱 재시작
2. 결제하기 버튼 클릭
3. 토스 결제창 없이 바로 완료
4. "[MOCK] 결제 완료!" 메시지 확인
5. 계약 상태 PAYMENT_COMPLETED 확인
```

### 🔁 5. 중복 결제 방지 테스트

```dart
// 같은 계약에 대해 두 번 결제 시도
1. 첫 번째 결제 완료
2. 뒤로가기로 결제 화면 재진입
3. 두 번째 결제 시도
→ "이미 결제된 계약입니다" 에러 메시지 확인
```

---

## 디버깅 팁

### 🔍 1. 네트워크 로그 확인

```dart
// services/payment_service.dart
import 'package:logger/logger.dart';

final logger = Logger();

Future<Map<String, dynamic>> getPaymentInfo(int contractId) async {
  logger.d('📡 결제 정보 요청: contractId=$contractId');

  final response = await http.get(
    Uri.parse('$baseUrl/api/contracts/$contractId/payment-info'),
    headers: {
      'Authorization': 'Bearer $accessToken',
    },
  );

  logger.d('📥 응답: ${response.statusCode} ${response.body}');

  // ...
}
```

### 🐛 2. 에러 핸들링

```dart
Future<void> _requestPayment() async {
  try {
    final paymentInfo = await _paymentService.getPaymentInfo(widget.contractId);

    // 결제창 호출
    final result = await PaymentConfig.tossPayments.requestPayment(
      // ...
    );

    if (result == null) {
      throw Exception('결제가 취소되었습니다');
    }

    if (!result.success) {
      throw Exception(result.errorMessage ?? '결제 실패');
    }

    // 승인 요청
    await _confirmPayment(
      contractId: widget.contractId,
      paymentKey: result.paymentKey!,
      orderId: paymentInfo['orderId'],
      amount: paymentInfo['amount'],
    );

  } on SocketException {
    _showErrorDialog('네트워크 연결을 확인해주세요');
  } on HttpException {
    _showErrorDialog('서버 오류가 발생했습니다');
  } on FormatException {
    _showErrorDialog('잘못된 응답 형식입니다');
  } catch (e) {
    logger.e('결제 오류: $e');
    _showErrorDialog('결제 중 오류가 발생했습니다: ${e.toString()}');
  }
}
```

### 📱 3. 플랫폼별 디버깅

#### Android Emulator
```bash
# ADB 로그 확인
adb logcat | grep flutter

# 네트워크 요청 확인
adb logcat | grep "http"
```

#### iOS Simulator
```bash
# Xcode Console에서 로그 확인
# 또는 Flutter DevTools 사용
flutter run --observatory-port=8888
```

### 🌐 4. API 응답 확인

```dart
// API 응답 구조 확인용 디버그 코드
Future<void> _debugPaymentInfo() async {
  final response = await http.get(
    Uri.parse('${ApiConfig.baseUrl}/api/contracts/${widget.contractId}/payment-info'),
    headers: {
      'Authorization': 'Bearer $accessToken',
    },
  );

  print('📋 Status Code: ${response.statusCode}');
  print('📋 Headers: ${response.headers}');
  print('📋 Body: ${response.body}');

  if (response.statusCode == 200) {
    final data = jsonDecode(response.body);
    print('✅ Success: ${data['success']}');
    print('💰 Amount: ${data['data']['amount']}');
    print('🆔 OrderId: ${data['data']['orderId']}');
  }
}
```

### 🔧 5. 환경 전환 테스트

```dart
// 개발 환경
flutter run --dart-define-from-file=.env.development

// 테스트 서버 환경
flutter run --dart-define-from-file=.env.test

// Mock 모드 활성화
flutter run --dart-define=PAYMENT_MOCK_MODE=true
```

---

## 🚨 주의사항

### ⚠️ 로컬 개발 시

1. **Android Emulator는 10.0.2.2 사용**
   - `localhost` 사용 시 연결 실패
   - iOS Simulator와 다른 네트워크 구조

2. **HTTPS 인증서 오류**
   - 로컬 개발 시 HTTP 사용
   - 테스트 서버는 HTTPS 필수

3. **ngrok 세션 타임아웃**
   - 무료 ngrok은 8시간 후 URL 변경됨
   - URL 변경 시 환경변수 업데이트 필요

### 🔐 보안 주의사항

1. **테스트 API 키도 노출 금지**
   - `.env` 파일은 `.gitignore`에 추가
   - GitHub 등 공개 저장소에 절대 커밋하지 않기

2. **실제 디바이스 테스트 시**
   - ngrok URL은 외부에 공유하지 않기
   - 테스트 완료 후 ngrok 종료

3. **프로덕션 전환 시**
   - `test_ck_xxx` → `live_ck_xxx` API 키만 변경
   - 테스트 카드 대신 실제 카드 사용
   - Webhook URL을 프로덕션 도메인으로 변경

---

## 🎯 체크리스트

### Flutter 앱 개발 시작 전
- [ ] 토스페이먼츠 개발자센터 가입
- [ ] 테스트 클라이언트 키 발급 (`test_ck_xxx`)
- [ ] `tosspayments_flutter_sdk` 패키지 설치
- [ ] `.env.development` 환경변수 설정
- [ ] 백엔드 로컬 서버 실행 확인 (http://localhost:8080)
- [ ] Android Emulator 또는 iOS Simulator 준비

### 첫 결제 테스트 전
- [ ] 계약이 APPROVED 상태인지 확인
- [ ] 결제 정보 조회 API 동작 확인
- [ ] 테스트 카드 번호 준비
- [ ] baseUrl 설정 확인 (10.0.2.2 for Android)
- [ ] accessToken 정상 전달 확인

### 실제 디바이스 테스트 전
- [ ] ngrok 설치 및 실행
- [ ] ngrok URL로 baseUrl 변경
- [ ] 백엔드 PAYMENT_SUCCESS_URL에 ngrok URL 설정
- [ ] WiFi 연결 확인 (개발 머신과 같은 네트워크)

---

**문서 버전**: 1.0
**최종 수정일**: 2025-01-11
**작성자**: Claude Code
**대상**: Flutter 개발자
