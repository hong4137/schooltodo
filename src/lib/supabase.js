import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://sprrelvxxgvrdkmplidu.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwcnJlbHZ4eGd2cmRrbXBsaWR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3NDc3NzksImV4cCI6MjA4NzMyMzc3OX0.sb0-E9BeV_F5bnFKWORbWmr2n0gbm5lRlEwKPSJIvp4";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
