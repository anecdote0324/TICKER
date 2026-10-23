; 설치 프로그램 추가 설정(01 설치 파일과 서명).
; 코드 서명을 하지 않아서 예전 버전의 제거 프로그램이 Windows 보안에 막힐 수 있어요. 그때도 새 버전을 덮어 설치할 수 있게,
; 예전 버전 제거가 실패해도 설치를 멈추지 않아요(기본은 "Failed to uninstall old application files"로 멈춰요).

!macro customUnInstallCheck
  DetailPrint "예전 버전 제거 결과: $R0 (실패해도 덮어 설치해요)"
  ClearErrors
!macroend

!macro customUnInstallCheckCurrentUser
  DetailPrint "예전 버전 제거 결과: $R0 (실패해도 덮어 설치해요)"
  ClearErrors
!macroend
