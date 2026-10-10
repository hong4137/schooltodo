import { createClient } from "@supabase/supabase-js";

// anon key 는 공개돼도 되는 키(RLS 로 보호). 환경변수(VITE_SUPABASE_*)가 있으면 그걸 쓰고, 없으면 기본값.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://sprrelvxxgvrdkmplidu.supabase.co";
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwcnJlbHZ4eGd2cmRrbXBsaWR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3NDc3NzksImV4cCI6MjA4NzMyMzc3OX0.sb0-E9BeV_F5bnFKWORbWmr2n0gbm5lRlEwKPSJIvp4";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
