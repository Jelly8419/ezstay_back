# GitHub Actions SSH 연결 타임아웃 트러블슈팅 가이드

## 현재 상황 요약
- ✅ GitHub Actions Runner IP가 Security Group에 정상 추가됨 (AWS API 응답 확인)
- ✅ Network ACL: 모든 트래픽 0.0.0.0/0 허용 (인바운드/아웃바운드)
- ✅ 로컬 SSH 연결은 정상 작동 (로그에도 기록됨)
- ❌ GitHub Actions SSH 연결 타임아웃: `dial tcp ***:22: i/o timeout`
- ❌ 서버 로그에 GitHub Actions 연결 시도 기록 없음

**탄력적 IP**: 98.94.160.132
**리전**: us-east-1 (버지니아 북부)
**OS**: Amazon Linux 2023
**PM2 프로세스**: ezstay-api (포트 8080)

---

## 진단 1: VPC 라우팅 테이블 확인

### AWS Console에서 확인
1. **EC2 → 인스턴스** → 인스턴스 선택
2. **네트워킹 탭** 클릭
3. **서브넷 ID** 확인 (예: subnet-xxxxx)
4. **VPC → 라우팅 테이블** 이동
5. 해당 서브넷과 연결된 라우팅 테이블 확인

### 확인해야 할 라우팅 규칙
**올바른 퍼블릭 서브넷 설정**:
```
대상(Destination)    |  대상 유형(Target)
---------------------|-------------------
10.0.0.0/16         |  local
0.0.0.0/0           |  igw-xxxxx (인터넷 게이트웨이)
```

**문제 있는 프라이빗 서브넷 설정** (❌):
```
대상(Destination)    |  대상 유형(Target)
---------------------|-------------------
10.0.0.0/16         |  local
0.0.0.0/0           |  nat-xxxxx (NAT 게이트웨이)
```

### 해결 방법
만약 인터넷 게이트웨이(igw-xxxxx) 대신 NAT 게이트웨이가 있다면:
- EC2 인스턴스가 **프라이빗 서브넷**에 있는 것임
- GitHub Actions는 외부에서 접속하므로 **퍼블릭 서브넷**으로 옮겨야 함

---

## 진단 2: 서브넷 유형 확인

### AWS Console에서 확인
1. **VPC → 서브넷** 이동
2. EC2가 속한 서브넷(subnet-xxxxx) 선택
3. **라우팅 테이블** 탭에서 `0.0.0.0/0 → igw-xxxxx` 규칙 확인

### 서브넷 판별
- **퍼블릭 서브넷**: `0.0.0.0/0 → igw-xxxxx` (인터넷 게이트웨이)
- **프라이빗 서브넷**: `0.0.0.0/0 → nat-xxxxx` 또는 규칙 없음

### 해결 방법
프라이빗 서브넷인 경우:
1. 새로운 퍼블릭 서브넷 생성
2. EC2 인스턴스 AMI 생성
3. 퍼블릭 서브넷에 새 인스턴스 시작

---

## 진단 3: OS 방화벽(iptables) 확인

### SSH로 서버 접속 후 실행
```bash
# iptables 규칙 확인
sudo iptables -L -n -v

# 확인 사항
# - INPUT 체인에 DROP 규칙이 있는지 확인
# - 22번 포트(SSH)를 막는 규칙이 있는지 확인
```

### 올바른 설정 예시
```
Chain INPUT (policy ACCEPT)
target     prot opt source               destination

Chain FORWARD (policy ACCEPT)
target     prot opt source               destination

Chain OUTPUT (policy ACCEPT)
target     prot opt source               destination
```

### 문제 있는 설정 예시 (❌)
```
Chain INPUT (policy DROP)
target     prot opt source               destination
ACCEPT     tcp  --  0.0.0.0/0            0.0.0.0/0            tcp dpt:22 source IP range 특정 대역
```

### 해결 방법
iptables가 문제인 경우:
```bash
# 임시로 모든 iptables 규칙 제거 (테스트용)
sudo iptables -F

# 영구적으로 비활성화 (Amazon Linux 2023)
sudo systemctl stop iptables
sudo systemctl disable iptables
```

---

## 진단 4: Security Group ID 재확인

### GitHub Secrets 확인
**Actions → Secrets and variables → Actions**에서:
- `EC2_SECURITY_GROUP_ID`가 올바른 Security Group ID인지 확인
- 형식: `sg-xxxxxxxxxxxxx`

### AWS Console에서 확인
1. **EC2 → 보안 그룹** 이동
2. EC2 인스턴스에 실제로 연결된 보안 그룹 ID 확인
3. GitHub Secret의 ID와 일치하는지 비교

### 해결 방법
ID가 다르면:
- GitHub Secrets에서 올바른 Security Group ID로 업데이트

---

## 진단 5: 임시 전체 개방 테스트

### 목적
동적 IP 화이트리스팅 메커니즘 문제인지, 네트워크 라우팅 문제인지 구분

### 테스트 방법
1. **Security Group 인바운드 규칙 수정**:
   ```
   유형: SSH
   프로토콜: TCP
   포트: 22
   소스: 0.0.0.0/0
   설명: GitHub Actions 테스트용 (임시)
   ```

2. **GitHub Actions 워크플로우 수정** (IP 화이트리스팅 단계 비활성화):
   ```yaml
   # - name: Add GitHub Actions IP to EC2 Security Group
   #   ... (주석 처리)
   ```

3. **다시 배포 실행**:
   ```bash
   git add .
   git commit -m "test: SSH 연결 테스트 (Security Group 전체 개방)"
   git push origin develop
   ```

### 결과 판단
- **성공**: 동적 IP 화이트리스팅 메커니즘에 문제 (타이밍 또는 IP 감지 오류)
- **실패**: 네트워크 라우팅 또는 서브넷 문제

---

## 진단 6: GitHub Actions Runner IP 수동 확인

### 방법 1: GitHub Actions 로그에서 IP 확인
워크플로우 실행 로그에서:
```
🌐 GitHub Actions Runner IP: X.X.X.X
```

### 방법 2: EC2 Security Group에서 규칙 확인
1. **EC2 → 보안 그룹** 이동
2. **인바운드 규칙** 탭에서 GitHub Actions가 추가한 규칙 확인
3. IP 주소가 올바르게 추가되었는지 확인

### 문제 시나리오
- IP가 추가되지 않았다면: AWS IAM 권한 부족
- IP가 추가되었는데 연결 안 되면: 네트워크 라우팅 문제

---

## 진단 7: VPC 엔드포인트 및 피어링 확인

### 확인 사항
1. **VPC → 엔드포인트**: EC2 VPC에 불필요한 엔드포인트가 없는지 확인
2. **VPC → 피어링 연결**: 다른 VPC와 피어링이 라우팅을 방해하는지 확인

### 해결 방법
불필요한 엔드포인트나 피어링이 있다면 삭제

---

## 최우선 진단 순서

### 1단계: 라우팅 테이블 확인 (가장 가능성 높음)
```bash
AWS Console → EC2 → 인스턴스 선택 → 네트워킹 탭 → 서브넷 ID 확인
VPC → 라우팅 테이블 → 해당 서브넷 라우팅 규칙 확인
```

**확인 포인트**: `0.0.0.0/0 → igw-xxxxx` 규칙이 있는가?

### 2단계: 임시 전체 개방 테스트
Security Group에 `0.0.0.0/0` SSH 규칙 추가 후 배포 테스트

### 3단계: OS 방화벽 확인
```bash
sudo iptables -L -n -v
```

### 4단계: Security Group ID 재확인
GitHub Secret의 `EC2_SECURITY_GROUP_ID`와 실제 EC2 보안 그룹 ID 일치 확인

---

## 해결 후 조치

### 보안 강화
임시 전체 개방 테스트 후 반드시:
1. Security Group에서 `0.0.0.0/0` SSH 규칙 삭제
2. 동적 IP 화이트리스팅 워크플로우 단계 복원

### 문서화
해결된 원인과 조치 사항을 `docs/DEPLOYMENT_IMPROVEMENTS.md`에 기록

---

## 추가 도움이 필요한 경우

### AWS Support 문의 시 제공할 정보
- EC2 인스턴스 ID
- 탄력적 IP: 98.94.160.132
- Security Group ID
- 서브넷 ID
- VPC ID
- GitHub Actions Runner IP (워크플로우 로그에서)
- 연결 시도 시간 (UTC)

### GitHub Actions 로그 수집
워크플로우 실행 로그 전체를 텍스트 파일로 저장하여 분석
