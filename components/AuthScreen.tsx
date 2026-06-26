"use client";

import { useEffect, useRef, useState } from "react";
import {
  Icon,
  GoogleIcon,
  GithubIcon,
  AppleIcon,
  WechatIcon,
} from "@/components/Icons";
import { api, ApiClientError } from "@/lib/client/api";

type SsoProvider = "google" | "github" | "wechat" | "apple";

function authErrorMessage(code: string, lang: "zh" | "en"): string {
  const M: Record<string, { zh: string; en: string }> = {
    AUTH_INVALID: { zh: "邮箱或密码不正确", en: "Incorrect email or password" },
    AUTH_EMAIL_TAKEN: { zh: "该邮箱已被注册", en: "That email is already registered" },
    VALIDATION_ERROR: { zh: "请检查输入内容", en: "Please check your input" },
    SSO_UNAVAILABLE: { zh: "第三方登录暂不可用", en: "SSO is unavailable" },
  };
  const m = M[code];
  return m ? m[lang] : lang === "zh" ? "出了点问题，请重试" : "Something went wrong, please try again";
}

type Tab = "login" | "signup";
type Theme = "dark" | "light";
type Lang = "zh" | "en";

function pick<T>(o: { zh: T; en: T }, lang: Lang): T {
  return o[lang] !== undefined ? o[lang] : o.en;
}

function i18n(lang: Lang) {
  return pick(
    {
      zh: {
        heroTitle: "十二个大模型，一个最优答案",
        heroSub:
          "复合多智能体平台 — 智能调度合适的模型，或并行多专家融合，给你最值得信赖的回答。",
        poweredBy: "由 12 个主流大模型驱动",
        feat1: "快速模式与多专家融合两种模式",
        feat2: "依据意图智能调度最合适的模型",
        feat3: "精确 Token 计费，用量全程透明",
        login: "登录",
        signup: "注册",
        loginTitle: "欢迎回来",
        loginSub: "登录以继续使用 OmniMind",
        signupTitle: "创建账户",
        signupSub: "几秒钟即可开启你的智能工作台",
        nameLabel: "姓名",
        namePh: "你的名字",
        emailLabel: "邮箱",
        pwLabel: "密码",
        pwPh: "输入密码",
        pwPhNew: "至少 8 位字符",
        emailErrMsg: "请输入有效的邮箱地址",
        pwErrMsg: "密码至少需要 8 位字符",
        forgot: "忘记密码？",
        remember: "记住我",
        agree: "我已阅读并同意服务条款",
        loginBtn: "登录",
        signupBtn: "创建账户",
        or: "或",
        forgotN: "忘记密码？",
        google: "Google",
        github: "GitHub",
        wechat: "微信",
        apple: "Apple",
        noAccount: "还没有账户？",
        haveAccount: "已有账户？",
        goSignup: "立即注册",
        goLogin: "去登录",
        terms: "继续即代表你同意 OmniMind 的服务条款与隐私政策。",
        successTitleL: "登录成功",
        successTitleS: "账户创建成功",
        successSub: "正在进入你的智能工作台…",
        backBtn: "返回",
      },
      en: {
        heroTitle: "Twelve models, one best answer",
        heroSub:
          "A compound multi-agent platform — it routes to the right model, or fuses multiple experts in parallel, for an answer you can trust.",
        poweredBy: "Powered by 12 leading models",
        feat1: "Fast mode and multi-expert fusion",
        feat2: "Smart routing to the best model for your intent",
        feat3: "Precise token billing, fully transparent",
        login: "Log in",
        signup: "Sign up",
        loginTitle: "Welcome back",
        loginSub: "Log in to continue to OmniMind",
        signupTitle: "Create account",
        signupSub: "Set up your AI workspace in seconds",
        nameLabel: "Name",
        namePh: "Your name",
        emailLabel: "Email",
        pwLabel: "Password",
        pwPh: "Enter password",
        pwPhNew: "At least 8 characters",
        emailErrMsg: "Please enter a valid email address",
        pwErrMsg: "Password must be at least 8 characters",
        forgot: "Forgot?",
        remember: "Remember me",
        agree: "I agree to the Terms of Service",
        loginBtn: "Log in",
        signupBtn: "Create account",
        or: "or",
        forgotN: "Forgot?",
        google: "Google",
        github: "GitHub",
        wechat: "WeChat",
        apple: "Apple",
        noAccount: "Don't have an account?",
        haveAccount: "Already have an account?",
        goSignup: "Sign up",
        goLogin: "Log in",
        terms:
          "By continuing you agree to OmniMind's Terms of Service and Privacy Policy.",
        successTitleL: "Logged in",
        successTitleS: "Account created",
        successSub: "Taking you to your workspace…",
        backBtn: "Back",
      },
    },
    lang
  );
}

function validEmail(e: string) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
}

export default function AuthScreen() {
  const [tab, setTab] = useState<Tab>("login");
  const [theme, setTheme] = useState<Theme>("dark");
  const [lang, setLang] = useState<Lang>("zh");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function goToApp() {
    setLoading(false);
    setDone(true);
    timer.current = setTimeout(() => {
      window.location.href = "/";
    }, 700);
  }

  async function onSubmit() {
    if (loading) return;
    setTouched(true);
    setErr(null);
    // Signup enforces a valid email + 8-char password; login accepts any identifier
    // (e.g. the `demo` username) and defers to the server.
    if (tab === "signup") {
      if (!validEmail(email) || pw.length < 8) return;
    } else if (!email || !pw) {
      return;
    }
    setLoading(true);
    try {
      if (tab === "login") {
        await api.auth.login({ email, password: pw, remember });
      } else {
        await api.auth.signup({ name: name.trim() || email.split("@")[0], email, password: pw, lang });
      }
      goToApp();
    } catch (e) {
      setLoading(false);
      setErr(authErrorMessage(e instanceof ApiClientError ? e.code : "INTERNAL", lang));
    }
  }

  function reset() {
    setDone(false);
    setTouched(false);
    setPw("");
    setLoading(false);
    setErr(null);
  }

  async function onSso(provider: SsoProvider) {
    if (loading) return;
    setErr(null);
    setLoading(true);
    try {
      await api.auth.sso(provider);
      goToApp();
    } catch (e) {
      setLoading(false);
      setErr(authErrorMessage(e instanceof ApiClientError ? e.code : "INTERNAL", lang));
    }
  }

  // ---- renderVals ----
  const t0 = i18n(lang);
  const isDark = theme === "dark";
  const isLogin = tab === "login";
  const isSignup = tab === "signup";
  // Field-level validation hints apply to signup only; login defers to the server.
  const emailBad = isSignup && touched && !validEmail(email);
  const pwBad = isSignup && touched && pw.length < 8;

  const t = {
    ...t0,
    title: isLogin ? t0.loginTitle : t0.signupTitle,
    subtitle: isLogin ? t0.loginSub : t0.signupSub,
    pwPh: isLogin ? t0.pwPh : t0.pwPhNew,
  };

  const features = [
    { icon: <Icon name="layers" />, color: "#8f7fff", text: t0.feat1 },
    { icon: <Icon name="route" />, color: "#42d6ff", text: t0.feat2 },
    { icon: <Icon name="coins" />, color: "#3ad19b", text: t0.feat3 },
  ];

  const modelChips = [
    { name: "DeepSeek", color: "#4d6bfe", initials: "DS" },
    { name: "GPT-5.5", color: "#0e8f6e", initials: "55" },
    { name: "Claude", color: "#d97757", initials: "CL" },
    { name: "Gemini", color: "#9168ff", initials: "GP" },
    { name: "GLM", color: "#2f7cff", initials: "GL" },
    { name: "Qwen", color: "#615ced", initials: "QW" },
    { name: "Kimi", color: "#8a7bff", initials: "KM" },
    { name: "Doubao", color: "#00bcd4", initials: "DB" },
    { name: "MiniMax", color: "#ff4d6d", initials: "MM" },
  ];

  const ssoButtons = [
    { key: "google", icon: <GoogleIcon />, name: t0.google, color: "inherit" },
    { key: "github", icon: <GithubIcon />, name: t0.github, color: "var(--text)" },
    { key: "wechat", icon: <WechatIcon />, name: t0.wechat, color: "#3ad19b" },
    { key: "apple", icon: <AppleIcon />, name: t0.apple, color: "var(--text)" },
  ];

  const langLabel = lang === "zh" ? "中文" : "EN";
  const showForm = !done;
  const successTitle = isLogin ? t0.successTitleL : t0.successTitleS;
  const submitLabel = isLogin ? t0.loginBtn : t0.signupBtn;
  const switchPrompt = isLogin ? t0.noAccount : t0.haveAccount;
  const switchAction = isLogin ? t0.goSignup : t0.goLogin;

  const loginBg = isLogin ? "var(--bg-elev)" : "transparent";
  const loginFg = isLogin ? "var(--text)" : "var(--muted)";
  const loginSh = isLogin ? "0 1px 4px rgba(0,0,0,.25)" : "none";
  const signupBg = isSignup ? "var(--bg-elev)" : "transparent";
  const signupFg = isSignup ? "var(--text)" : "var(--muted)";
  const signupSh = isSignup ? "0 1px 4px rgba(0,0,0,.25)" : "none";

  const emailBorder = emailBad ? "var(--danger)" : "var(--border-2)";
  const pwBorder = pwBad ? "var(--danger)" : "var(--border-2)";
  const pwType = showPw ? "text" : "password";
  const rememberBg = remember ? "var(--accent)" : "transparent";
  const rememberBorder = remember ? "var(--accent)" : "var(--border-2)";

  return (
    <div
      data-auth="true"
      data-theme={theme}
      style={{
        display: "flex",
        minHeight: "100vh",
        width: "100%",
        background: "var(--bg)",
        color: "var(--text)",
        fontFamily: "'Manrope','Noto Sans SC',sans-serif",
        overflow: "hidden",
      }}
    >
      {/* Left hero panel */}
      <div
        style={{
          flex: 1,
          position: "relative",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "52px 54px",
          overflow: "hidden",
          background:
            "linear-gradient(150deg,#120f2e 0%,#0b0a18 55%,#0a1226 100%)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -120,
            left: -80,
            width: 420,
            height: 420,
            borderRadius: "50%",
            background:
              "radial-gradient(circle,rgba(124,108,255,.55),transparent 70%)",
            filter: "blur(20px)",
            animation: "orb 14s ease-in-out infinite",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -140,
            right: -60,
            width: 380,
            height: 380,
            borderRadius: "50%",
            background:
              "radial-gradient(circle,rgba(66,214,255,.4),transparent 70%)",
            filter: "blur(20px)",
            animation: "orb 18s ease-in-out infinite reverse",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "radial-gradient(rgba(255,255,255,.05) 1px,transparent 1px)",
            backgroundSize: "26px 26px",
            opacity: 0.5,
          }}
        />

        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: "linear-gradient(135deg,#7c6cff,#42d6ff)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              boxShadow: "0 8px 24px rgba(124,108,255,.5)",
            }}
          >
            <Icon name="spark" />
          </div>
          <div
            style={{
              fontFamily: "'Space Grotesk',sans-serif",
              fontWeight: 700,
              fontSize: 22,
              letterSpacing: "-.02em",
              color: "#fff",
            }}
          >
            OmniMind
          </div>
        </div>

        <div style={{ position: "relative", maxWidth: 440 }}>
          <div
            style={{
              fontFamily: "'Space Grotesk',sans-serif",
              fontWeight: 700,
              fontSize: 40,
              lineHeight: 1.12,
              letterSpacing: "-.02em",
              color: "#fff",
              textWrap: "balance",
            }}
          >
            {t.heroTitle}
          </div>
          <div
            style={{
              fontSize: 15,
              lineHeight: 1.65,
              color: "rgba(255,255,255,.66)",
              marginTop: 18,
            }}
          >
            {t.heroSub}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
              marginTop: 34,
            }}
          >
            {features.map((f, i) => (
              <div
                key={i}
                style={{ display: "flex", alignItems: "center", gap: 13 }}
              >
                <div
                  style={{
                    width: 38,
                    height: 38,
                    flex: "none",
                    borderRadius: 11,
                    background: "rgba(255,255,255,.07)",
                    border: "1px solid rgba(255,255,255,.12)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: f.color,
                  }}
                >
                  {f.icon}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "rgba(255,255,255,.9)",
                  }}
                >
                  {f.text}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ position: "relative" }}>
          <div
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: ".05em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,.4)",
              marginBottom: 13,
            }}
          >
            {t.poweredBy}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {modelChips.map((m, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "6px 11px 6px 7px",
                  borderRadius: 9,
                  background: "rgba(255,255,255,.05)",
                  border: "1px solid rgba(255,255,255,.1)",
                }}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 6,
                    background: m.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontSize: 8.5,
                    fontWeight: 700,
                    fontFamily: "'Space Grotesk'",
                  }}
                >
                  {m.initials}
                </span>
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "rgba(255,255,255,.8)",
                  }}
                >
                  {m.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div
        style={{
          width: "min(50%,560px)",
          flex: "none",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-elev)",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            justifyContent: "flex-end",
            padding: "20px 26px",
          }}
        >
          <button
            onClick={() => setLang(lang === "zh" ? "en" : "zh")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--muted)",
              font: "inherit",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <Icon name="globe" />
            {langLabel}
          </button>
          <button
            onClick={() => setTheme(isDark ? "light" : "dark")}
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Icon name={isDark ? "sun" : "moon"} />
          </button>
        </div>

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "8px 56px 56px",
          }}
        >
          <div style={{ width: "100%", maxWidth: 380, margin: "0 auto" }}>
            {done && (
              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    width: 66,
                    height: 66,
                    margin: "0 auto",
                    borderRadius: "50%",
                    background: "var(--accent-soft)",
                    border: "1px solid var(--accent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--success)",
                  }}
                >
                  <Icon name="checkBig" />
                </div>
                <div
                  style={{
                    fontFamily: "'Space Grotesk',sans-serif",
                    fontWeight: 700,
                    fontSize: 23,
                    marginTop: 20,
                    letterSpacing: "-.01em",
                  }}
                >
                  {successTitle}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    color: "var(--muted)",
                    marginTop: 10,
                    lineHeight: 1.6,
                  }}
                >
                  {t.successSub}
                </div>
                <button
                  onClick={reset}
                  style={{
                    marginTop: 24,
                    padding: "12px 22px",
                    borderRadius: 12,
                    border: "1px solid var(--border-2)",
                    background: "var(--surface)",
                    color: "var(--text)",
                    font: "inherit",
                    fontSize: 13.5,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {t.backBtn}
                </button>
              </div>
            )}

            {showForm && (
              <div>
                <div
                  style={{
                    fontFamily: "'Space Grotesk',sans-serif",
                    fontWeight: 700,
                    fontSize: 26,
                    letterSpacing: "-.02em",
                  }}
                >
                  {t.title}
                </div>
                <div
                  style={{
                    fontSize: 13.5,
                    color: "var(--muted)",
                    marginTop: 7,
                  }}
                >
                  {t.subtitle}
                </div>

                <div
                  style={{
                    display: "flex",
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: 4,
                    gap: 3,
                    marginTop: 24,
                  }}
                >
                  <button
                    onClick={() => {
                      setTab("login");
                      setTouched(false);
                    }}
                    style={{
                      flex: 1,
                      padding: 9,
                      borderRadius: 9,
                      border: "none",
                      background: loginBg,
                      color: loginFg,
                      boxShadow: loginSh,
                      font: "inherit",
                      fontSize: 13.5,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {t.login}
                  </button>
                  <button
                    onClick={() => {
                      setTab("signup");
                      setTouched(false);
                    }}
                    style={{
                      flex: 1,
                      padding: 9,
                      borderRadius: 9,
                      border: "none",
                      background: signupBg,
                      color: signupFg,
                      boxShadow: signupSh,
                      font: "inherit",
                      fontSize: 13.5,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {t.signup}
                  </button>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                    marginTop: 22,
                  }}
                >
                  {isSignup && (
                    <div>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--muted)",
                          marginBottom: 7,
                        }}
                      >
                        {t.nameLabel}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "0 13px",
                          borderRadius: 12,
                          border: "1px solid var(--border-2)",
                          background: "var(--surface)",
                          height: 46,
                        }}
                      >
                        <span style={{ color: "var(--faint)", display: "flex" }}>
                          <Icon name="user" />
                        </span>
                        <input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder={t.namePh}
                          style={{
                            flex: 1,
                            border: "none",
                            background: "transparent",
                            color: "var(--text)",
                            fontSize: 14,
                            outline: "none",
                            height: "100%",
                          }}
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--muted)",
                        marginBottom: 7,
                      }}
                    >
                      {t.emailLabel}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "0 13px",
                        borderRadius: 12,
                        border: `1px solid ${emailBorder}`,
                        background: "var(--surface)",
                        height: 46,
                      }}
                    >
                      <span style={{ color: "var(--faint)", display: "flex" }}>
                        <Icon name="mail" />
                      </span>
                      <input
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        type="email"
                        placeholder="you@example.com"
                        style={{
                          flex: 1,
                          border: "none",
                          background: "transparent",
                          color: "var(--text)",
                          fontSize: 14,
                          outline: "none",
                          height: "100%",
                        }}
                      />
                    </div>
                    {emailBad && (
                      <div
                        style={{
                          fontSize: 11.5,
                          color: "var(--danger)",
                          marginTop: 6,
                        }}
                      >
                        {t.emailErrMsg}
                      </div>
                    )}
                  </div>

                  <div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        marginBottom: 7,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--muted)",
                        }}
                      >
                        {t.pwLabel}
                      </div>
                      <div style={{ flex: 1 }} />
                      {isLogin && (
                        <a
                          style={{
                            fontSize: 11.5,
                            color: "var(--accent)",
                            fontWeight: 600,
                            cursor: "pointer",
                            textDecoration: "none",
                          }}
                        >
                          {t.forgot}
                        </a>
                      )}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "0 13px",
                        borderRadius: 12,
                        border: `1px solid ${pwBorder}`,
                        background: "var(--surface)",
                        height: 46,
                      }}
                    >
                      <span style={{ color: "var(--faint)", display: "flex" }}>
                        <Icon name="lock" />
                      </span>
                      <input
                        value={pw}
                        onChange={(e) => setPw(e.target.value)}
                        type={pwType}
                        placeholder={t.pwPh}
                        style={{
                          flex: 1,
                          border: "none",
                          background: "transparent",
                          color: "var(--text)",
                          fontSize: 14,
                          outline: "none",
                          height: "100%",
                        }}
                      />
                      <button
                        onClick={() => setShowPw(!showPw)}
                        style={{
                          border: "none",
                          background: "transparent",
                          color: "var(--faint)",
                          cursor: "pointer",
                          display: "flex",
                          padding: 2,
                        }}
                      >
                        <Icon name={showPw ? "eyeOff" : "eye"} />
                      </button>
                    </div>
                    {pwBad && (
                      <div
                        style={{
                          fontSize: 11.5,
                          color: "var(--danger)",
                          marginTop: 6,
                        }}
                      >
                        {t.pwErrMsg}
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      marginTop: 2,
                    }}
                  >
                    <button
                      onClick={() => setRemember(!remember)}
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 6,
                        border: `1px solid ${rememberBorder}`,
                        background: rememberBg,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      {remember ? <Icon name="check" /> : ""}
                    </button>
                    <span
                      onClick={() => setRemember(!remember)}
                      style={{
                        fontSize: 12.5,
                        color: "var(--muted)",
                        cursor: "pointer",
                      }}
                    >
                      {t.remember}
                    </span>
                  </div>
                </div>

                <button
                  onClick={onSubmit}
                  disabled={loading}
                  style={{
                    width: "100%",
                    marginTop: 22,
                    height: 48,
                    borderRadius: 13,
                    border: "none",
                    background:
                      "linear-gradient(135deg,var(--accent),#8f7fff)",
                    color: "#fff",
                    font: "inherit",
                    fontSize: 14.5,
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 9,
                    boxShadow: "0 8px 22px var(--accent-soft)",
                  }}
                >
                  {loading && (
                    <span
                      style={{
                        width: 16,
                        height: 16,
                        border: "2px solid rgba(255,255,255,.4)",
                        borderTopColor: "#fff",
                        borderRadius: "50%",
                        animation: "spin .7s linear infinite",
                      }}
                    />
                  )}
                  {submitLabel}
                </button>

                {err && (
                  <div
                    style={{
                      marginTop: 12,
                      fontSize: 12.5,
                      color: "var(--danger)",
                      textAlign: "center",
                      fontWeight: 600,
                    }}
                  >
                    {err}
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    margin: "22px 0",
                  }}
                >
                  <div
                    style={{ flex: 1, height: 1, background: "var(--border)" }}
                  />
                  <span style={{ fontSize: 11.5, color: "var(--faint)" }}>
                    {t.or}
                  </span>
                  <div
                    style={{ flex: 1, height: 1, background: "var(--border)" }}
                  />
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                  }}
                >
                  {ssoButtons.map((b) => (
                    <button
                      key={b.key}
                      onClick={() => onSso(b.key as SsoProvider)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 9,
                        padding: 11,
                        borderRadius: 11,
                        border: "1px solid var(--border-2)",
                        background: "var(--surface)",
                        color: "var(--text)",
                        font: "inherit",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ display: "flex", color: b.color }}>
                        {b.icon}
                      </span>
                      {b.name}
                    </button>
                  ))}
                </div>

                <div
                  style={{
                    textAlign: "center",
                    fontSize: 12.5,
                    color: "var(--muted)",
                    marginTop: 24,
                  }}
                >
                  {switchPrompt}{" "}
                  <a
                    onClick={() => {
                      setTab(isLogin ? "signup" : "login");
                      setTouched(false);
                    }}
                    style={{
                      color: "var(--accent)",
                      fontWeight: 700,
                      cursor: "pointer",
                      textDecoration: "none",
                    }}
                  >
                    {switchAction}
                  </a>
                </div>

                <div
                  style={{
                    textAlign: "center",
                    fontSize: 11,
                    color: "var(--faint)",
                    marginTop: 18,
                    lineHeight: 1.6,
                  }}
                >
                  {t.terms}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
