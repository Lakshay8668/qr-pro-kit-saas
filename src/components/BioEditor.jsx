// src/components/BioEditor.jsx — edit a link-in-bio page (title, text, colour, avatar, buttons)

import { fileToSmallLogo } from "../lib/qrRender";

export const EMPTY_BIO = { title: "", description: "", accent: "#4f46e5", avatar: null, links: [{ label: "", url: "" }] };

export default function BioEditor({ value, onChange }) {
  const bio = { ...EMPTY_BIO, ...(value || {}) };
  const set = (p) => onChange({ ...bio, ...p });
  const setLink = (i, p) => set({ links: bio.links.map((l, idx) => (idx === i ? { ...l, ...p } : l)) });

  const pickAvatar = async (e) => {
    const f = e.target.files?.[0];
    if (!f || !f.type.startsWith("image/")) return;
    try {
      set({ avatar: await fileToSmallLogo(f, 128) });
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="bio-editor">
      <label>
        Page title
        <input type="text" maxLength={60} placeholder="Sharma Sweets" value={bio.title} onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label>
        Short description (optional)
        <input type="text" maxLength={200} placeholder="Since 1985 · Karol Bagh, Delhi" value={bio.description} onChange={(e) => set({ description: e.target.value })} />
      </label>
      <div className="row2">
        <label>
          Accent colour
          <input type="color" value={bio.accent} onChange={(e) => set({ accent: e.target.value })} />
        </label>
        <label>
          Logo / photo (optional)
          <input type="file" accept="image/*" onChange={pickAvatar} />
        </label>
      </div>
      {bio.avatar && (
        <div className="logo-row">
          <img src={bio.avatar} alt="avatar" width="36" height="36" style={{ borderRadius: "50%" }} />
          <button type="button" className="dash-btn" onClick={() => set({ avatar: null })}>
            Remove
          </button>
        </div>
      )}

      <b className="bio-h">Buttons</b>
      {bio.links.map((l, i) => (
        <div key={i} className="bio-row">
          <input type="text" placeholder="Label (e.g. Order on WhatsApp)" maxLength={60} value={l.label} onChange={(e) => setLink(i, { label: e.target.value })} />
          <input type="text" placeholder="https://… or tel:+91… or mailto:…" value={l.url} onChange={(e) => setLink(i, { url: e.target.value })} />
          <button type="button" className="dash-btn" disabled={bio.links.length <= 1} onClick={() => set({ links: bio.links.filter((_, idx) => idx !== i) })}>
            ✕
          </button>
        </div>
      ))}
      <div className="bio-actions">
        <button type="button" className="dash-btn" disabled={bio.links.length >= 12} onClick={() => set({ links: [...bio.links, { label: "", url: "" }] })}>
          + Add button
        </button>
        <button
          type="button"
          className="dash-btn"
          disabled={bio.links.length >= 12}
          onClick={() => {
            const n = window.prompt("WhatsApp number with country code, e.g. 919876543210");
            const d = (n || "").replace(/\D/g, "");
            if (d) set({ links: [...bio.links.filter((l) => l.url || l.label), { label: "Chat on WhatsApp", url: `https://wa.me/${d}` }] });
          }}
        >
          + WhatsApp
        </button>
      </div>
    </div>
  );
}
