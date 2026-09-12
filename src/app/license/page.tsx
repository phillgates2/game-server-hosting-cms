import type { Metadata } from "next";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "License Check",
  robots: { index: false, follow: false },
};

/**
 * Self-service customer portal: check a license key's health without an
 * account. The form posts to /api/license/public/check, which is anonymous,
 * rate-limited, and answers in the same shape for every failure class.
 */
export default function LicenseCheckPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0b0f17",
        color: "#e2e8f0",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          background: "#111827",
          border: "1px solid #1f2937",
          borderRadius: 16,
          padding: 32,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>🎟️ License Check</h1>
        <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 24, lineHeight: 1.5 }}>
          Check the health of your installation license — no account needed. Your key is only ever
          sent to this server, and answers are identical in shape regardless of why a key fails.
        </p>
        <form id="license-form">
          <label htmlFor="license-key" style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>
            License key
          </label>
          <input
            id="license-key"
            name="key"
            required
            placeholder="GSM-LIC-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
            autoComplete="off"
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "#0b0f17",
              border: "1px solid #1f2937",
              borderRadius: 10,
              padding: "12px 14px",
              color: "#e2e8f0",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 13,
              outline: "none",
            }}
          />
          <button
            type="submit"
            style={{
              marginTop: 16,
              width: "100%",
              background: "#6366f1",
              color: "white",
              border: "none",
              borderRadius: 10,
              padding: "12px 14px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Check my key
          </button>
        </form>
        <div id="license-result" style={{ marginTop: 20 }} />
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function () {
  var form = document.getElementById('license-form');
  var out = document.getElementById('license-result');
  var COLORS = {
    valid: ['#22c55e', 'rgba(34,197,94,0.12)', '✅'],
    'fully-activated': ['#eab308', 'rgba(234,179,8,0.12)', '🟡'],
    revoked: ['#ef4444', 'rgba(239,68,68,0.12)', '⛔'],
    expired: ['#f97316', 'rgba(249,115,22,0.12)', '⏰'],
    invalid: ['#ef4444', 'rgba(239,68,68,0.12)', '❌'],
    'rate-limited': ['#94a3b8', 'rgba(148,163,184,0.12)', '⏳']
  };
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var key = document.getElementById('license-key').value;
    out.innerHTML = '<p style="color:#94a3b8;font-size:13px">Checking…</p>';
    fetch('/api/license/public/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: key })
    })
      .then(function (r) { return r.json().catch(function () { return { status: 'invalid', message: 'Unexpected response.' }; }); })
      .then(function (data) {
        var status = data.status || 'invalid';
        var c = COLORS[status] || COLORS.invalid;
        var extra = '';
        if (typeof data.activationsUsed === 'number' && typeof data.maxActivations === 'number') {
          extra = '<p style="margin:6px 0 0;font-size:12px;color:#94a3b8">Activations used: <b>' + data.activationsUsed + '/' + data.maxActivations + '</b>' +
            (data.expiresAt ? ' · expires ' + new Date(data.expiresAt).toLocaleDateString() : ' · never expires') + '</p>';
        }
        out.innerHTML =
          '<div style="border:1px solid ' + c[0] + '33;background:' + c[1] + ';border-radius:10px;padding:12px 14px">' +
          '<p style="margin:0;font-size:13px;font-weight:600;color:' + c[0] + '">' + c[2] + ' ' + (data.message || 'Unknown status') + '</p>' +
          extra + '</div>';
      })
      .catch(function () {
        out.innerHTML = '<p style="color:#ef4444;font-size:13px">Network error — please try again.</p>';
      });
  });
})();
`,
          }}
        />
      </div>
    </main>
  );
}
