import { useState } from "react";
import { useAuth } from "../lib/auth";

export default function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [signUpDone, setSignUpDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (isSignUp) {
        const { error } = await signUp(email, password, displayName);
        if (error) throw error;
        setSignUpDone(true);
      } else {
        const { error } = await signIn(email, password);
        if (error) throw error;
      }
    } catch (err) {
      setError(err.message || "오류가 발생했습니다");
    } finally {
      setLoading(false);
    }
  }

  if (signUpDone) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📬</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>이메일을 확인해주세요</h2>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            {email}로 확인 메일을 보냈어요.<br />
            링크를 클릭하면 가입이 완료됩니다.
          </p>
          <button onClick={() => { setSignUpDone(false); setIsSignUp(false); }} style={styles.linkBtn}>
            로그인으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Logo */}
        <div style={{ marginBottom: 32, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>📋</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text-primary)", letterSpacing: -0.5 }}>SchoolToDo</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>학교 알림장을 AI로 똑똑하게</p>
        </div>

        <form onSubmit={handleSubmit}>
          {isSignUp && (
            <div style={styles.field}>
              <label style={styles.label}>이름</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="예: 홍길동"
                required
                style={styles.input}
              />
            </div>
          )}
          <div style={styles.field}>
            <label style={styles.label}>이메일</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
              required
              style={styles.input}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="6자 이상"
              required
              minLength={6}
              style={styles.input}
            />
          </div>

          {error && (
            <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 12, padding: "8px 12px", background: "var(--red-bg)", borderRadius: 8 }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} style={{ ...styles.submitBtn, opacity: loading ? 0.6 : 1 }}>
            {loading ? "처리 중..." : isSignUp ? "가입하기" : "로그인"}
          </button>
        </form>

        <button onClick={() => { setIsSignUp(!isSignUp); setError(""); }} style={styles.linkBtn}>
          {isSignUp ? "이미 계정이 있어요 → 로그인" : "계정이 없어요 → 가입하기"}
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    background: "var(--bg)",
  },
  card: {
    width: "100%",
    maxWidth: 380,
    background: "var(--surface)",
    borderRadius: 20,
    padding: "40px 28px",
    boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
    textAlign: "center",
  },
  field: {
    marginBottom: 16,
    textAlign: "left",
  },
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: 6,
  },
  input: {
    width: "100%",
    padding: "12px 14px",
    fontSize: 15,
    border: "1px solid var(--border)",
    borderRadius: 10,
    outline: "none",
    background: "var(--bg)",
    transition: "border-color 0.2s",
  },
  submitBtn: {
    width: "100%",
    padding: 14,
    fontSize: 15,
    fontWeight: 700,
    background: "var(--text-primary)",
    color: "#fff",
    border: "none",
    borderRadius: 12,
    cursor: "pointer",
    marginTop: 4,
  },
  linkBtn: {
    background: "none",
    border: "none",
    fontSize: 13,
    color: "var(--text-muted)",
    cursor: "pointer",
    marginTop: 16,
    textDecoration: "underline",
  },
};
