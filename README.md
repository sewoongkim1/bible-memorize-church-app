# 성경 암송 — 회원 버전 (bible-memorize-church-app)

교구/교회학교로 본인을 식별하고, 개인별 암송 진행을 저장·관리하는 버전.
익명 버전(`bible-memorize-app`)과 분리된 별도 사이트.

## 화면 흐름
진입(식별) → 본인 기록 요약 → 구절 목록 → 단계별 테스트(빈칸/음성)

- 식별: 구분(교구/교회학교) → 교구 분기(교구·목장·성명) / 교회학교 분기(부서·학년·성명)
- 진행 저장: 로컬(`localStorage`) 우선 + 서버(Google Sheets) 백업
- 동명이인 구분: 교구+목장+이름 / 부서+학년+이름

## 서버(진행기록) 설정
1. https://script.google.com → 새 프로젝트, `Code.gs` 붙여넣기
2. `setup` 함수 1회 실행 → `성경암송진행기록` 시트 자동 생성 (로그에 URL/ID)
3. 배포 → 웹 앱 (실행: 나 / 액세스: 모든 사용자)
4. 생성된 `/exec` URL을 `app.js`의 `POST_URL` 에 입력 후 커밋

> `POST_URL`이 비어 있으면 서버 저장은 건너뛰고 로컬에만 저장됩니다(앱은 정상 동작).

## 파일
- `index.html` · `app.js` · `style.css` — 프런트엔드
- `verses.json` — 말씀 데이터(익명 버전과 동일)
- `Code.gs` — Apps Script 진행기록 서버
