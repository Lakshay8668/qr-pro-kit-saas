import { useMemo, useState, useRef } from "react";
import Topbar from "./components/Topbar";
import QrTypeForm from "./components/QrTypeForm";
import QrPreview from "./components/QrPreview";
import { buildPayload, SUPPORTS_DYNAMIC, isServerType, getDynamicDestinations, REQUIRED_HINT, QR_TYPES, normalizeUrl, isValidHttpUrl, validatePublicUrl } from "./lib/qrPayloads";
import { hashPassword } from "./lib/password";
import { uploadUserFile } from "./lib/storage";
import { isStorageConfigured } from "./lib/firebase";
import { createLink, dynamicUrlFor, updateLink } from "./lib/links";
import { useAuth } from "./lib/useAuth";
import { useBilling } from "./lib/useBilling";
import { Link } from "react-router-dom";
import {
  DEFAULT_DESIGN,
  SHAPES,
  EYES,
  buildQrSvg,
  svgToPngBlob,
  downloadBlob,
  downloadSvgString,
  fileToSmallLogo,
  scanWarnings,
} from "./lib/qrRender";

const SIZES = [
  { value: 512, label: "512 px" },
  { value: 1024, label: "1024 px" },
  { value: 2048, label: "2048 px (print)" },
  { value: 4096, label: "4096 px (large banner)" },
];

const PRESETS = [
  { name: "Classic", fg: "#111827", fg2: "", bg: "#ffffff" },
  { name: "Indigo", fg: "#4f46e5", fg2: "#0891b2", bg: "#ffffff" },
  { name: "Sunset", fg: "#be123c", fg2: "#d97706", bg: "#ffffff" },
  { name: "Forest", fg: "#065f46", fg2: "#0f766e", bg: "#ffffff" },
  { name: "Royal", fg: "#1e3a8a", fg2: "#7c3aed", bg: "#ffffff" },
];

export default function App() {
  const [type, setType] = useState("url");
  const [data, setData] = useState({});
  const [isDynamic, setIsDynamic] = useState(false);
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState("");
  const [maxScans, setMaxScans] = useState("");
  const [pw, setPw] = useState("");
  const [saveIt, setSaveIt] = useState(true);
  const [savedStatic, setSavedStatic] = useState(false);
  const [progress, setProgress] = useState(0);
  const [payload, setPayload] = useState("");
  const [createdId, setCreatedId] = useState("");
  const [design, setDesign] = useState({ ...DEFAULT_DESIGN });
  const [size, setSize] = useState(1024);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const logoInputRef = useRef(null);
  const { user } = useAuth();
  const { me, refresh: refreshBilling } = useBilling(user);
  const [upgrade, setUpgrade] = useState(false); // true when the last error was a plan limit

  const patch = (p) => setDesign((d) => ({ ...d, ...p }));
  const warnings = useMemo(() => scanWarnings(design, payload), [design, payload]);

  const changeType = (t) => {
    setType(t);
    setPayload("");
    setCreatedId("");
    setIsDynamic(false);
    setSavedStatic(false);
    setPw("");
    setNotice("");
    setError("");
  };

  const forced = isServerType(type); // file / bio pages always need a saved link

  const generate = async () => {
    setError("");
    setUpgrade(false);
    setNotice("");

    // ---- validate
    let staticPayload = "";
    if (type === "pdf") {
      const hasUrl = Boolean(data.url?.trim());
      if (hasUrl) {
        const v = validatePublicUrl(data.url);
        if (!v.ok) return setError(v.error);
        staticPayload = v.url;
      } else if (data.file) {
        return setError(
          `Local files like "${data.file.name}" cannot be opened by mobile devices scanning the QR code until hosted online. Please upload it to your preferred cloud host (such as Google Drive, Dropbox, OneDrive, or your website) and paste its public link above.`
        );
      } else {
        return setError("Please enter a publicly accessible file or menu URL (e.g. https://example.com/menu.pdf).");
      }
    } else if (type === "bio") {
      if (!(data.bio?.title || "").trim() || !(data.bio?.links || []).some((l) => (l.url || "").trim())) {
        return setError(REQUIRED_HINT.bio);
      }
    } else {
      staticPayload = buildPayload(type, data);
      if (!staticPayload) return setError(REQUIRED_HINT[type] || "Please fill in the required information.");
    }

    try {
      if (isDynamic || forced) {
        if (!user) return setError("Sign in or create a free account from the Dashboard to make an editable QR.");
        if (!forced && !SUPPORTS_DYNAMIC(type)) return setError("Editable mode isn't available for this QR type.");

        setLoading(true);
        let destination = "";
        let destinations = null;
        let kind = "redirect";
        let bio = null;
        let autoLabel = "";

        if (type === "pdf") {
          destination = staticPayload;
          autoLabel = label || "PDF Menu";
        } else if (type === "bio") {
          kind = "bio";
          bio = data.bio;
          autoLabel = data.bio.title;
        } else {
          ({ destination, destinations } = getDynamicDestinations(type, data));
          autoLabel = destination;
        }

        const password = pw ? await hashPassword(pw) : null;
        const id = await createLink({
          destination,
          destinations,
          kind,
          bio,
          password,
          label: label || autoLabel,
          ownerId: user.uid,
          type,
          design,
          expiresAt: expiry ? new Date(`${expiry}T23:59:59`) : null,
          maxScans: maxScans || null,
        });
        setCreatedId(id);
        refreshBilling();
        setSavedStatic(false);
        setPayload(dynamicUrlFor(id));
        setNotice(
          "Editable QR created. Change it, pause it, protect it or see analytics from the Dashboard. Scans work once the site is deployed on Vercel."
        );
      } else {
        setPayload(staticPayload);
        if (user && saveIt) {
          // every QR a signed-in customer makes is kept in their dashboard (static ones too)
          setLoading(true);
          try {
            const name = label || typeLabel;
            if (createdId && savedStatic) {
              await updateLink(createdId, { label: name, payload: staticPayload, design });
            } else {
              const id = await createLink({ kind: "static", payload: staticPayload, label: name, ownerId: user.uid, type, design });
              setCreatedId(id);
              setSavedStatic(true);
            }
            setNotice("QR generated and saved to your dashboard.");
          } catch (e) {
            setCreatedId("");
            setSavedStatic(false);
            setNotice(`QR generated. (Note: cloud dashboard sync requires Firestore: ${e?.message || "database unavailable"}).`);
          }
        } else {
          setCreatedId("");
          setSavedStatic(false);
          setNotice(user ? "QR generated." : "QR generated. Sign in (top-right) to keep your QR codes saved in a dashboard.");
        }
      }
    } catch (e) {
      setError(e?.message || "Could not generate QR. Check your Firebase configuration.");
      setUpgrade(!!e?.upgrade);
    } finally {
      setLoading(false);
      setProgress(0);
    }
  };

  const uploadLogo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const logoUrl = await fileToSmallLogo(file);
      patch({ logo: logoUrl });
      setError("");
    } catch (err) {
      setError(err?.message || "Failed to process logo image.");
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const removeLogo = () => {
    patch({ logo: null });
    if (logoInputRef.current) logoInputRef.current.value = "";
  };

  const syncDesign = () => {
    // keep the dashboard thumbnail/downloads in sync with the final styling
    if (createdId && user) updateLink(createdId, { design }).catch(() => {});
  };

  const download = async (format) => {
    if (!payload) return;
    try {
      const svg = buildQrSvg(payload, design, { size });
      if (format === "svg") downloadSvgString(svg, `qr-${type}.svg`);
      else downloadBlob(await svgToPngBlob(svg), `qr-${type}-${size}.png`);
      syncDesign();
    } catch (e) {
      setError(e?.message || "Download failed.");
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this:", payload);
    }
  };

  const canDynamic = SUPPORTS_DYNAMIC(type);
  const typeLabel = QR_TYPES.find((t) => t.id === type)?.label;

  return (
    <main className="app-shell">
      <Topbar />

      <section className="hero">
        <div>
          <p className="eyebrow">QR CODE GENERATOR</p>
          <h1>Create QR codes that actually work for your business.</h1>
          <p className="sub">
            17 QR types incl. UPI, PDF menus &amp; link-in-bio pages, password &amp; expiry controls, city-level scan analytics,
            custom shapes, logo &amp; frames — free.
          </p>
        </div>
      </section>

      <section className="workspace">
        <div className="card form-card">
          <div className="card-title">
            <div>
              <h2>1. Content</h2>
              <p>Choose a type and enter your details.</p>
            </div>
          </div>

          <QrTypeForm type={type} setType={changeType} data={data} setData={setData} />

          {(canDynamic || forced) && (
            <div className="panel">
              {forced ? (
                <p className="field-hint" style={{ marginTop: 0 }}>
                  <b>This type is always an editable QR</b> (it lives at a short link) — requires a free account.
                  {!user && " Sign in from the top-right first."}
                </p>
              ) : (
                <label className="check" style={{ margin: 0 }}>
                  <input type="checkbox" checked={isDynamic} onChange={(e) => setIsDynamic(e.target.checked)} />
                  <b>Make this QR editable</b>
                  {!user && isDynamic && <span className="check-hint"> — requires free account</span>}
                </label>
              )}
              {!forced && (
                <p className="field-hint">
                  Change the destination after printing, pause it, set expiry / scan limit / password, and get analytics (device,
                  city, unique visitors).
                </p>
              )}
              {(isDynamic || forced) && (
                <div className="dyn-grid">
                  <label>
                    Label (for your dashboard)
                    <input type="text" placeholder="Diwali offer poster" value={label} onChange={(e) => setLabel(e.target.value)} />
                  </label>
                  <label>
                    Expires on (optional)
                    <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
                  </label>
                  <label>
                    Max scans (optional)
                    <input type="number" min="1" placeholder="e.g. 500" value={maxScans} onChange={(e) => setMaxScans(e.target.value)} />
                  </label>
                  <label>
                    Password protect (optional){me && !me?.features?.password && <Link to="/pricing" className="lock-badge">Pro</Link>}
                    <input type="text" autoComplete="off" placeholder={me && !me?.features?.password ? "Upgrade to Pro to password-protect" : "min 4 characters"} value={pw} disabled={!!me && !me?.features?.password} onChange={(e) => setPw(e.target.value)} />
                  </label>
                </div>
              )}
            </div>
          )}

          {user && !(isDynamic || forced) && (
            <div className="panel">
              <label className="check" style={{ margin: 0 }}>
                <input type="checkbox" checked={saveIt} onChange={(e) => setSaveIt(e.target.checked)} />
                <b>Save this QR in my dashboard</b>
              </label>
              {saveIt && (
                <label className="save-label">
                  Name (optional)
                  <input type="text" placeholder={`${typeLabel} QR`} value={label} onChange={(e) => setLabel(e.target.value)} />
                </label>
              )}
            </div>
          )}

          <div className="card-title" style={{ marginTop: 26 }}>
            <div>
              <h2>2. Design</h2>
              <p>Colours, shapes, logo and frame.</p>
            </div>
          </div>

          <div className="presets">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className="preset"
                title={p.name}
                onClick={() => patch({ fg: p.fg, fg2: p.fg2, bg: p.bg })}
                style={{ background: `linear-gradient(135deg, ${p.fg}, ${p.fg2 || p.fg})` }}
              />
            ))}
          </div>

          <div className="options-grid three">
            <label>
              QR colour
              <input type="color" value={design.fg} onChange={(e) => patch({ fg: e.target.value })} />
            </label>
            <label>
              Gradient to
              <div className="inline-pick">
                <input type="color" value={design.fg2 || design.fg} onChange={(e) => patch({ fg2: e.target.value })} />
                {design.fg2 && (
                  <button type="button" className="dash-btn" onClick={() => patch({ fg2: "" })}>
                    ✕
                  </button>
                )}
              </div>
            </label>
            <label>
              Background
              <input type="color" value={design.bg} onChange={(e) => patch({ bg: e.target.value })} />
            </label>
          </div>

          <div className="options-grid three">
            <label>
              Dot style
              <select value={design.shape} onChange={(e) => patch({ shape: e.target.value })}>
                {SHAPES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Corner eyes
              <select value={design.eye} onChange={(e) => patch({ eye: e.target.value })}>
                {EYES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Eye colour
              <div className="inline-pick">
                <input type="color" value={design.eyeColor || design.fg} onChange={(e) => patch({ eyeColor: e.target.value })} />
                {design.eyeColor && (
                  <button type="button" className="dash-btn" onClick={() => patch({ eyeColor: "" })}>
                    ✕
                  </button>
                )}
              </div>
            </label>
          </div>

          <div className="options-grid">
            <label>
              Frame
              <select value={design.frameStyle} onChange={(e) => patch({ frameStyle: e.target.value })}>
                <option value="none">No frame</option>
                <option value="text">Text below</option>
                <option value="bar">Filled bar</option>
              </select>
            </label>
            <label>
              Frame text
              <input
                type="text"
                placeholder="Scan me"
                maxLength={24}
                disabled={design.frameStyle === "none"}
                value={design.frameText}
                onChange={(e) => patch({ frameText: e.target.value })}
              />
            </label>
          </div>

          <label>
            Logo (optional)
            <input ref={logoInputRef} type="file" accept="image/*" onChange={uploadLogo} />
          </label>
          {design.logo && (
            <div className="logo-row">
              <img src={design.logo} alt="logo" width="36" height="36" />
              <label className="grow">
                Logo size {Math.round(design.logoScale * 100)}%
                <input
                  type="range"
                  min="12"
                  max="30"
                  value={Math.round(design.logoScale * 100)}
                  onChange={(e) => patch({ logoScale: Number(e.target.value) / 100 })}
                />
              </label>
              <button type="button" className="dash-btn" onClick={removeLogo}>
                Remove
              </button>
            </div>
          )}

          {error && (
            <div className="alert error">
              {error}
              {upgrade && <> <Link to="/pricing" className="upgrade-link">See plans →</Link></>}
            </div>
          )}
          {notice && <div className="alert success">{notice}</div>}

          <button className="primary" onClick={generate} disabled={loading}>
            {loading ? (progress > 0 ? `Uploading ${progress}%…` : "Creating…") : "Generate QR Code"}
          </button>
        </div>

        <div className="card preview-card">
          <div className="card-title">
            <div>
              <h2>3. Preview &amp; download</h2>
              <p>{payload ? `${typeLabel} — ready to download` : "Your QR will appear here"}</p>
            </div>
          </div>

          <div className="qr-stage">
            {payload ? (
              <QrPreview value={payload} design={design} size={320} />
            ) : (
              <div className="empty-qr">
                <div>QR</div>
                <span>Generate a code</span>
              </div>
            )}
          </div>

          {payload && warnings.length > 0 && (
            <div className="alert warn">
              <b>Scan check</b>
              <ul>
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <label className="size-pick">
            Download size
            <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
              {SIZES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <div className="download-row">
            <button className="secondary" disabled={!payload} onClick={() => download("png")}>
              Download PNG
            </button>
            <button className="secondary outline" disabled={!payload} onClick={() => download("svg")}>
              Download SVG
            </button>
          </div>
          {payload && (
            <div className="payload-row">
              <p className="payload">{payload}</p>
              <div style={{ whiteSpace: "nowrap" }}>
                {createdId && !savedStatic && (
                  <a className="dash-btn" href={payload} target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit" }}>
                    Open
                  </a>
                )}
                <button type="button" className="dash-btn" onClick={copyLink}>
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          )}
          <p className="field-hint" style={{ marginTop: 10 }}>
            Tip: always test-scan with 2 different phones before printing.
          </p>
        </div>
      </section>
    </main>
  );
}
