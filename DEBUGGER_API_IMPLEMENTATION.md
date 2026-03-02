# chrome.debugger API 구현 완료

## 변경사항

### 1. manifest.json
```json
"permissions": ["storage", "debugger"]
```
- `debugger` 권한 추가

### 2. src/utils/DebuggerCapture.js (신규)
- chrome.debugger API를 사용하여 raw HTTP request body 캡처
- Network.requestWillBeSent 이벤트 리스닝
- gRPC 요청 자동 감지 (content-type, URL 패턴)
- postData 캡처 및 base64 인코딩

**주요 메서드:**
- `enable()`: 디버거 attach 및 Network domain 활성화
- `disable()`: 디버거 detach
- `_handleRequestWillBeSent()`: raw request 캡처
- `getRawRequest(requestId)`: 캡처된 raw request 조회

### 3. src/index.js
- DebuggerCapture import 추가
- debuggerCapture 인스턴스 생성
- 초기화 시 자동으로 enable
- raw request callback으로 rawRequestsCache에 저장

## 작동 방식

```
DevTools Panel 열림
    ↓
index.js 로드
    ↓
DebuggerCapture 인스턴스 생성
    ↓
chrome.debugger.attach(tabId, '1.3')
    ↓
chrome.debugger.sendCommand('Network.enable')
    ↓
chrome.debugger.onEvent.addListener()
    ↓
페이지에서 gRPC 요청 발생
    ↓
Network.requestWillBeSent 이벤트 발생
    ↓
params.request.postData 캡처
    ↓
base64 인코딩 후 rawRequestsCache에 저장
    ↓
Repeat 버튼 클릭 시 캡처된 body 사용
```

## 테스트 방법

### 1. 빌드
```bash
npm run build
```

### 2. Chrome에서 확장 프로그램 로드
1. `chrome://extensions` 열기
2. "개발자 모드" 활성화
3. "압축해제된 확장 프로그램을 로드합니다" 클릭
4. `build` 디렉토리 선택

### 3. 테스트 페이지 열기
```
https://qa-privacy.shucle.com:15449/drt/management/stoppoint
```

### 4. DevTools 열기 및 확인
1. F12를 눌러 DevTools 열기
2. gRPC-Web DevTools 탭 열기
3. **브라우저 상단에 노란색 배너 확인**:
   ```
   Chrome is being controlled by automated test software.
   ```
   ※ 이는 chrome.debugger API가 활성화되었다는 의미 (정상)

4. DevTools Console에서 로그 확인:
   ```
   [Index] Initializing DebuggerCapture for tab: XXX
   [DebuggerCapture] Created for tab: XXX
   [DebuggerCapture] Attaching debugger to tab: XXX
   [DebuggerCapture] ✓ Debugger attached
   [DebuggerCapture] ✓ Network domain enabled
   [DebuggerCapture] ✓ Ready to capture requests
   [Index] ✓ DebuggerCapture enabled
   ```

5. gRPC 요청 발생 시 로그:
   ```
   [DebuggerCapture] Captured gRPC request: {requestId: "...", url: "...", method: "POST", hasPostData: true}
   [DebuggerCapture] ✓ Captured raw request body: {requestId: "...", url: "...", bodyLength: XXX}
   [DebuggerCapture] Raw request callback: ...
   [Index] ✓ Cached raw request for ID: ... Cache size: X
   ```

6. Network 탭에서 gRPC 요청 확인
7. 요청 선택 후 "Repeat" 버튼 클릭
8. 새로운 요청이 생성되는지 확인

## 예상 효과

✅ **100% 안정적 캡처**: chrome.debugger API는 모든 네트워크 요청을 캡처
✅ **타이밍 이슈 없음**: 인터셉터 로딩 시간과 무관
✅ **CSP 우회**: CSP 제한 없음
✅ **Raw POST data 접근**: Network.requestWillBeSent에서 postData 직접 제공

## 주의사항

⚠️ **노란색 배너**: chrome.debugger 사용 시 브라우저 상단에 경고 배너 표시
- 이는 정상적인 동작입니다
- 보안상의 이유로 사용자에게 알림

⚠️ **다른 DevTools 기능과 충돌 가능**:
- 동일한 탭에서 다른 디버거 연결 불가
- Network 탭 등 일부 기능이 제한될 수 있음

⚠️ **성능 영향**:
- 모든 네트워크 이벤트를 처리하므로 약간의 오버헤드
- 일반적인 사용에는 문제 없음

## Fallback 체인 (향후)

현재는 chrome.debugger API만 사용하지만, 향후 fallback 추가 가능:

```
1차: chrome.debugger API (현재 구현) ✅
     ↓ (실패 시)
2차: Inline script 인터셉터
     ↓ (실패 시)
3차: chrome.devtools.network (제한적)
```

## 트러블슈팅

### "Cannot access a chrome:// URL" 오류
- chrome:// 페이지에서는 debugger attach 불가
- 일반 웹 페이지에서만 사용 가능

### "Another debugger is already attached" 오류
- 다른 디버거가 이미 연결됨
- DevTools를 닫고 다시 열기

### Raw cache size가 0인 경우
1. DevTools Console에서 DebuggerCapture 로그 확인
2. 노란색 배너가 표시되는지 확인
3. gRPC 요청이 실제로 발생했는지 확인
4. Content-Type 헤더가 올바른지 확인

## 다음 단계

- [ ] Settings UI에서 DebuggerCapture on/off 기능 추가
- [ ] Fallback 체인 구현
- [ ] 에러 처리 강화
- [ ] 사용자 가이드 추가
