# GitHub Actions IP 범위

GitHub Actions는 **Microsoft Azure 인프라**를 사용하며, IP 범위가 매우 광범위합니다.

## 📊 통계 (2025-01-13 기준)

- **총 IP 범위**: 약 **600개 이상**의 CIDR 블록
- **주요 클라우드**: Microsoft Azure (미국, 유럽, 아시아 전역)
- **업데이트 주기**: GitHub가 인프라 확장 시 수시 변경

## 🌐 주요 IP 범위 (일부)

### 가장 많이 사용되는 범위
```
4.148.0.0/16
4.149.0.0/18
4.150.0.0/18
4.151.0.0/16
4.152.0.0/15
13.64.0.0/16
13.65.0.0/16
13.66.0.0/17
20.1.128.0/17
20.3.0.0/16
20.4.0.0/16
... (600+ 범위)
```

## ⚠️ 문제점

### 1. IP 범위가 너무 많음
- EC2 보안 그룹당 규칙 제한: **최대 60개**
- GitHub Actions IP: **600개 이상** 필요
- **물리적으로 불가능** ❌

### 2. IP 범위가 자주 변경됨
- GitHub/Azure 인프라 확장 시 수시 변경
- 수동 관리 불가능

## ✅ 권장 해결 방법

### 방법 1: 0.0.0.0/0 + 추가 보안 조치 (가장 실용적)

**EC2 보안 그룹**:
| 유형 | 포트 | 소스 | 설명 |
|------|------|------|------|
| SSH | 22 | 0.0.0.0/0 | 모든 IP (GitHub Actions 포함) |

**추가 보안 조치** (필수):
1. **SSH 비밀번호 인증 완전 비활성화**
   ```bash
   sudo nano /etc/ssh/sshd_config
   PasswordAuthentication no
   PubkeyAuthentication yes
   PermitRootLogin no
   sudo systemctl restart sshd
   ```

2. **Fail2Ban 설치** (무차별 대입 공격 차단)
   ```bash
   sudo yum install -y fail2ban  # Amazon Linux 2
   sudo systemctl start fail2ban
   sudo systemctl enable fail2ban
   ```

3. **SSH 포트 변경** (선택사항)
   ```bash
   sudo nano /etc/ssh/sshd_config
   Port 2222  # 22 대신 다른 포트
   ```

---

### 방법 2: Bastion Host 또는 VPN (프로덕션 권장)

**아키텍처**:
```
GitHub Actions
    ↓ (SSH via Bastion)
Bastion Host (퍼블릭 IP, 0.0.0.0/0)
    ↓ (내부 네트워크)
App Server (프라이빗 IP, Bastion만 접근 가능)
```

**장점**:
- 애플리케이션 서버는 인터넷에 직접 노출 안 됨
- Bastion만 공격 표면 노출
- 프로덕션 환경에 적합

---

### 방법 3: GitHub Self-hosted Runner (최고 보안)

**아키텍처**:
```
GitHub → Self-hosted Runner (EC2 내부)
         ↓
      App Server (프라이빗 IP)
```

**설정 방법**:
1. EC2 인스턴스에 GitHub Actions Runner 설치
2. 내부 네트워크에서만 배포 실행
3. 외부 SSH 포트 불필요

**GitHub Runner 설치**:
```bash
# EC2에서 실행
cd ~
mkdir actions-runner && cd actions-runner
curl -o actions-runner-linux-x64-2.311.0.tar.gz -L https://github.com/actions/runner/releases/download/v2.311.0/actions-runner-linux-x64-2.311.0.tar.gz
tar xzf ./actions-runner-linux-x64-2.311.0.tar.gz

# GitHub 저장소 → Settings → Actions → Runners → New self-hosted runner
./config.sh --url https://github.com/Jelly8419/ezstay_back --token YOUR_TOKEN
./run.sh
```

---

## 📌 최종 권장 사항

### 테스트 환경 (현재)
```
✅ 방법 1: 0.0.0.0/0 + Fail2Ban + 비밀번호 인증 비활성화
- 빠르게 시작 가능
- 추가 보안 조치로 안전성 확보
```

### 프로덕션 환경 (나중에)
```
✅ 방법 3: Self-hosted Runner
- 가장 안전한 방법
- 외부 SSH 포트 불필요
- 약간의 설정 복잡도
```

---

## 🔗 참고 링크

- GitHub Actions IP 범위: https://api.github.com/meta
- GitHub Self-hosted Runners: https://docs.github.com/en/actions/hosting-your-own-runners
- AWS EC2 보안 그룹 제한: https://docs.aws.amazon.com/vpc/latest/userguide/amazon-vpc-limits.html
