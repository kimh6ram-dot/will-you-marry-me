/* ===================================================================
   Supabase 접속 설정
   -------------------------------------------------------------------
   Supabase 대시보드 > Settings > API 에서 두 값을 복사해 붙여넣으세요.

     SUPA_URL   = "Project URL"        (예: https://abcdxyz.supabase.co)
     SUPA_ANON  = "anon public" 키     (public 키. 브라우저에 노출되어도 되는 값)

   anon 키는 공개되는 것이 정상입니다. 다만 이 키로 할 수 있는 일이
   "청첩장 발급(INSERT) · 조회(SELECT) · 반응 +1(RPC)" 로만 제한되도록
   supabase.sql 의 RLS 정책과 RPC 함수를 반드시 먼저 실행해야 합니다.
   (service_role 키는 절대 여기에 넣지 마세요.)

   아래 자리표시자 값을 그대로 두면 발급·집계 기능이 꺼지고,
   화면에는 설정이 필요하다는 안내가 표시됩니다. 디자인 확인은 그대로 됩니다.
   =================================================================== */

window.SUPA_URL  = "https://YOUR-PROJECT.supabase.co";
window.SUPA_ANON = "YOUR-ANON-PUBLIC-KEY";
