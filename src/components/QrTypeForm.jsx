// src/components/QrTypeForm.jsx

import { QR_TYPES } from "../lib/qrPayloads";
import BioEditor from "./BioEditor";
import GoogleReviewGenerator from "./GoogleReviewGenerator";
import { MAX_UPLOAD_MB } from "../lib/storage";
import { isStorageConfigured } from "../lib/firebase";

export default function QrTypeForm({ type, setType, data, setData }) {
  const set = (key) => (e) => {
    const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setData({ ...data, [key]: value });
  };

  const handleTypeChange = (id) => {
    setType(id);
    setData({});
  };

  const current = QR_TYPES.find((t) => t.id === type);

  return (
    <div className="qr-type-form">
      <div className="type-grid" role="tablist" aria-label="QR type">
        {QR_TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={type === t.id}
            className={`chip ${type === t.id ? "chip-on" : ""}`}
            onClick={() => handleTypeChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {current?.hint && <p className="field-hint">{current.hint}</p>}

      {type === "url" && (
        <>
          <label>
            URL
            <input type="text" placeholder="https://example.com" value={data.url || ""} onChange={set("url")} />
          </label>
          <details className="utm-details">
            <summary>UTM tracking (optional)</summary>
            <div className="utm-grid">
              <label>
                utm_source
                <input type="text" placeholder="instagram" value={data.utm_source || ""} onChange={set("utm_source")} />
              </label>
              <label>
                utm_medium
                <input type="text" placeholder="qr" value={data.utm_medium || ""} onChange={set("utm_medium")} />
              </label>
              <label>
                utm_campaign
                <input type="text" placeholder="summer_sale" value={data.utm_campaign || ""} onChange={set("utm_campaign")} />
              </label>
              <label>
                utm_content
                <input type="text" placeholder="poster_a" value={data.utm_content || ""} onChange={set("utm_content")} />
              </label>
            </div>
          </details>
        </>
      )}

      {type === "whatsapp" && (
        <>
          <label>
            Phone (with country code)
            <input type="tel" placeholder="919876543210" value={data.phone || ""} onChange={set("phone")} />
          </label>
          <label>
            Pre-filled message (optional)
            <textarea rows={2} value={data.message || ""} onChange={set("message")} />
          </label>
        </>
      )}

      {type === "pdf" && (
        <>
          <label>
            File or Menu URL
            <input
              type="url"
              placeholder="https://example.com/menu.pdf"
              value={data.url || ""}
              onChange={set("url")}
            />
          </label>
          <p className="field-hint" style={{ marginTop: "4px" }}>
            Paste a public link to your PDF menu, brochure, or price list (e.g. from Google Drive, Dropbox, OneDrive, or your website).
          </p>

          <label style={{ marginTop: 12 }}>
            {isStorageConfigured() ? `Or upload PDF / image file (max ${MAX_UPLOAD_MB} MB)` : "Or select a local file to inspect"}
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => setData({ ...data, file: e.target.files?.[0] || null })}
            />
          </label>
          {data.file && (
            <div className="alert info" style={{ marginTop: "8px", background: "rgba(59, 130, 246, 0.08)", borderColor: "rgba(59, 130, 246, 0.25)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                <div>
                  <strong style={{ fontSize: "14px" }}>Selected local file: {data.file.name}</strong>
                  <span style={{ fontSize: "12px", color: "var(--text-muted)", marginLeft: "6px" }}>({(data.file.size / 1048576).toFixed(2)} MB)</span>
                </div>
                <button
                  type="button"
                  className="dash-btn"
                  onClick={() => setData({ ...data, file: null })}
                  style={{ fontSize: "12px", padding: "2px 8px" }}
                >
                  ✕ Clear
                </button>
              </div>
              <p style={{ margin: "6px 0 0 0", fontSize: "13px", lineHeight: "1.4" }}>
                Note: A QR code cannot directly embed a file stored on your computer. For other people to open your menu or document when scanning, host the file online (e.g. Google Drive, Dropbox, OneDrive, or your website) and paste its public link into the <strong>File or Menu URL</strong> field above.
              </p>
            </div>
          )}
        </>
      )}

      {type === "bio" && <BioEditor value={data.bio} onChange={(bio) => setData({ ...data, bio })} />}

      {type === "upi" && (
        <>
          <label>
            UPI ID
            <input type="text" placeholder="yourname@okhdfcbank" value={data.pa || ""} onChange={set("pa")} />
          </label>
          <div className="row2">
            <label>
              Payee name (optional)
              <input type="text" placeholder="Sharma Sweets" value={data.pn || ""} onChange={set("pn")} />
            </label>
            <label>
              Amount ₹ (optional)
              <input type="text" inputMode="decimal" placeholder="499" value={data.am || ""} onChange={set("am")} />
            </label>
          </div>
          <label>
            Note (optional)
            <input type="text" placeholder="Order #123" value={data.tn || ""} onChange={set("tn")} />
          </label>
          <p className="field-hint">Leave the amount empty to let the customer type it. UPI QR is static — it can't be made editable.</p>
        </>
      )}

      {type === "review" && (
        <GoogleReviewGenerator data={data} setData={setData} />
      )}

      {type === "map" && (
        <label>
          Address, place name or "lat,lng"
          <input
            type="text"
            placeholder="Connaught Place, New Delhi"
            value={data.query || ""}
            onChange={set("query")}
          />
        </label>
      )}

      {type === "instagram" && (
        <label>
          Username
          <input type="text" placeholder="yourbrand" value={data.username || ""} onChange={set("username")} />
        </label>
      )}

      {type === "youtube" && (
        <label>
          YouTube URL
          <input type="text" placeholder="https://youtube.com/watch?v=..." value={data.url || ""} onChange={set("url")} />
        </label>
      )}

      {type === "app" && (
        <>
          <label>
            Landing / fallback URL
            <input type="text" placeholder="https://yourapp.com/download" value={data.url || ""} onChange={set("url")} />
          </label>
          <label>
            App Store URL (optional)
            <input type="text" placeholder="https://apps.apple.com/..." value={data.ios || ""} onChange={set("ios")} />
          </label>
          <label>
            Play Store URL (optional)
            <input
              type="text"
              placeholder="https://play.google.com/store/apps/..."
              value={data.android || ""}
              onChange={set("android")}
            />
          </label>
          <p className="field-hint">
            Turn on "Make this QR editable" and iPhones go to the App Store, Android phones to Play Store — one QR for both.
          </p>
        </>
      )}

      {type === "text" && (
        <label>
          Text
          <textarea rows={3} value={data.text || ""} onChange={set("text")} />
        </label>
      )}

      {type === "email" && (
        <>
          <label>
            To
            <input type="email" value={data.to || ""} onChange={set("to")} />
          </label>
          <label>
            Subject (optional)
            <input type="text" value={data.subject || ""} onChange={set("subject")} />
          </label>
          <label>
            Body (optional)
            <textarea rows={2} value={data.body || ""} onChange={set("body")} />
          </label>
        </>
      )}

      {type === "phone" && (
        <label>
          Phone number
          <input type="tel" placeholder="+91..." value={data.phone || ""} onChange={set("phone")} />
        </label>
      )}

      {type === "sms" && (
        <>
          <label>
            Phone number
            <input type="tel" value={data.phone || ""} onChange={set("phone")} />
          </label>
          <label>
            Message (optional)
            <textarea rows={2} value={data.message || ""} onChange={set("message")} />
          </label>
        </>
      )}

      {type === "wifi" && (
        <>
          <label>
            Network name (SSID)
            <input type="text" value={data.ssid || ""} onChange={set("ssid")} />
          </label>
          <label>
            Password
            <input type="text" value={data.password || ""} onChange={set("password")} />
          </label>
          <label>
            Security
            <select value={data.security || "WPA"} onChange={set("security")}>
              <option value="WPA">WPA/WPA2</option>
              <option value="WEP">WEP</option>
              <option value="nopass">None</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={!!data.hidden} onChange={set("hidden")} />
            Hidden network
          </label>
        </>
      )}

      {type === "event" && (
        <>
          <label>
            Event title
            <input type="text" value={data.title || ""} onChange={set("title")} />
          </label>
          <div className="row2">
            <label>
              Starts
              <input type="datetime-local" value={data.start || ""} onChange={set("start")} />
            </label>
            <label>
              Ends
              <input type="datetime-local" value={data.end || ""} onChange={set("end")} />
            </label>
          </div>
          <label>
            Location (optional)
            <input type="text" value={data.location || ""} onChange={set("location")} />
          </label>
          <label>
            Description (optional)
            <textarea rows={2} value={data.description || ""} onChange={set("description")} />
          </label>
        </>
      )}

      {type === "vcard" && (
        <>
          <div className="row2">
            <label>
              First name
              <input type="text" value={data.firstName || ""} onChange={set("firstName")} />
            </label>
            <label>
              Last name
              <input type="text" value={data.lastName || ""} onChange={set("lastName")} />
            </label>
          </div>
          <label>
            Organization
            <input type="text" value={data.org || ""} onChange={set("org")} />
          </label>
          <label>
            Title
            <input type="text" value={data.title || ""} onChange={set("title")} />
          </label>
          <label>
            Phone
            <input type="tel" value={data.phone || ""} onChange={set("phone")} />
          </label>
          <label>
            Email
            <input type="email" value={data.email || ""} onChange={set("email")} />
          </label>
          <label>
            Website
            <input type="text" value={data.website || ""} onChange={set("website")} />
          </label>
        </>
      )}
    </div>
  );
}
