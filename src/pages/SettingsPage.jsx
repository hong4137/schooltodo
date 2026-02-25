import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { subscribePush, unsubscribePush, isPushSubscribed } from "../lib/push";

export default function SettingsPage() {
  const { user, profile, signOut, fetchProfile } = useAuth();
  const [telegrams, setTelegrams] = useState([]);
  const [linkCode, setLinkCode] = useState(null);
  const [morning, setMorning] = useState(profile?.notification_morning || "07:30");
  const [evening, setEvening] = useState(profile?.notification_evening || "21:00");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadTelegrams();
      checkPush();
    }
  }, [user]);

  async function checkPush() {
    const subscribed = await isPushSubscribed();
    setPushEnabled(subscribed);
    setPushLoading(false);
  }

  async function togglePush() {
    setPushLoading(true);
    try {
      if (pushEnabled) {
        await unsubscribePush();
        setPushEnabled(false);
        showToast("푸시 알림이 해제되었어요.");
      } else {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          showToast("알림 권한을 허용해주세요.");
          setPushLoading(false);
          return;
        }
        const sub = await subscribePush(user.id);
        if (sub) {
          setPushEnabled(true);
          showToast("푸시 알림이 활성화되었어요!");
        } else {
          showToast("푸시 설정 중 오류가 발생했어요.");
        }
      }
    } catch (err) {
      console.error("Push toggle error:", err);
      showToast("오류가 발생했어요.");
    }
    setPushLoading(false);
  }

  useEffect(() => {
    if (user) loadTelegrams();
  }, [user]);

  useEffect(() => {
    if (profile) {
      setMorning(profile.notification_morning?.slice(0, 5) || "07:30");
      setEvening(profile.notification_evening?.slice(0, 5) || "21:00");
    }
  }, [profile]);

  async function loadTelegrams() {
    const { data } = await supabase
      .from("user_telegrams")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at");
    setTelegrams(data || []);
  }

  async function generateLinkCode() {
    const { data, error } = await supabase.rpc("generate_link_code", {
      p_user_id: user.id,
    });
    if (!error && data) {
      setLinkCode(data);
      showToast("연동 코드가 생성되었어요! 5분 내에 입력해주세요.");
    }
  }

  async function saveNotifications() {
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        notification_morning: morning + ":00",
        notification_evening: evening + ":00",
      })
      .eq("id", user.id);
    setSaving(false);
    if (!error) {
      showToast("알림 시간이 저장되었어요!");
      fetchProfile(user.id);
    }
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  return (
    <div style={{ padding: "0 16px 100px" }}>
      <div style={{ padding: "20px 0 16px" }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--text-primary)", margin: 0, letterSpacing: -0.5 }}>설정</h1>
      </div>

      {/* Account */}
      <Card title="계정">
        <Row label="이메일" value={user?.email} />
        <Row label="이름" value={profile?.display_name} last />
      </Card>

      {/* Telegram */}
      <Card title="텔레그램 연동">
        {telegrams.map((tg, i) => (
          <div key={tg.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < telegrams.length - 1 ? "1px solid var(--border-light)" : "none" }}>
            <div>
              <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{tg.display_name || "텔레그램"}</span>
              <span style={{ fontSize: 12, color: tg.is_active ? "var(--green)" : "var(--text-disabled)", marginLeft: 8 }}>
                ● {tg.is_active ? "연동됨" : "비활성"}
              </span>
            </div>
          </div>
        ))}
        {telegrams.length === 0 && (
          <div style={{ padding: "12px 0", fontSize: 14, color: "var(--text-muted)" }}>연동된 텔레그램이 없어요</div>
        )}

        <button onClick={generateLinkCode} style={addBtnStyle}>+ 새 텔레그램 연동</button>

        {linkCode && (
          <div style={{ marginTop: 12, padding: 16, background: "#F0F4FF", borderRadius: 12, textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>텔레그램에서 아래 코드를 입력하세요</div>
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 4, color: "var(--text-primary)" }}>/link {linkCode}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>5분 내에 입력해주세요</div>
          </div>
        )}
      </Card>

      {/* Notifications */}
      <Card title="알림 설정">
        {"PushManager" in window && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border-light)" }}>
            <div>
              <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>📱 푸시 알림</span>
              <div style={{ fontSize: 11, color: "var(--text-disabled)", marginTop: 2 }}>앱에서 직접 알림 받기</div>
            </div>
            <button onClick={togglePush} disabled={pushLoading} style={{
              width: 50, height: 28, borderRadius: 14, border: "none", cursor: pushLoading ? "default" : "pointer",
              background: pushEnabled ? "#4ECDC4" : "#CED4DA", position: "relative", transition: "background 0.2s",
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: 11, background: "#fff",
                position: "absolute", top: 3,
                left: pushEnabled ? 25 : 3, transition: "left 0.2s",
                boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              }} />
            </button>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border-light)" }}>
          <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>아침 알림</span>
          <input type="time" value={morning} onChange={(e) => setMorning(e.target.value)} style={timeInputStyle} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0" }}>
          <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>저녁 알림</span>
          <input type="time" value={evening} onChange={(e) => setEvening(e.target.value)} style={timeInputStyle} />
        </div>
        <button onClick={saveNotifications} disabled={saving} style={{ ...saveBtnStyle, opacity: saving ? 0.6 : 1 }}>
          {saving ? "저장 중..." : "저장"}
        </button>
      </Card>

      {/* Sign out */}
      <button onClick={signOut} style={{ width: "100%", padding: 14, background: "none", border: "1px solid var(--border)", borderRadius: 12, fontSize: 14, color: "var(--red)", cursor: "pointer", marginTop: 8 }}>
        로그아웃
      </button>

      <div style={{ textAlign: "center", padding: "20px 0" }}>
        <span style={{ fontSize: 12, color: "var(--text-disabled)" }}>SchoolToDo v1.0</span>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)", background: "var(--text-primary)", color: "#fff", padding: "10px 20px", borderRadius: 10, fontSize: 13, fontWeight: 500, boxShadow: "0 4px 12px rgba(0,0,0,0.15)", zIndex: 200 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div style={{ background: "var(--surface)", borderRadius: 16, padding: 20, border: "1px solid var(--border)", marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, last }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: last ? "none" : "1px solid var(--border-light)" }}>
      <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 500 }}>{value || "-"}</span>
    </div>
  );
}

const addBtnStyle = {
  marginTop: 12,
  width: "100%",
  padding: 12,
  background: "var(--bg)",
  border: "1px dashed #CED4DA",
  borderRadius: 10,
  fontSize: 14,
  color: "var(--text-secondary)",
  cursor: "pointer",
};

const timeInputStyle = {
  fontSize: 14,
  fontWeight: 500,
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "6px 10px",
  color: "var(--text-primary)",
  background: "var(--bg)",
};

const saveBtnStyle = {
  marginTop: 12,
  width: "100%",
  padding: 12,
  background: "var(--text-primary)",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
