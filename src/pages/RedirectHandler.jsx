// src/pages/RedirectHandler.jsx
// In production /q/:id is rewritten to the Vercel function (api/q/[id].js), so the
// browser app never sees this route. It only appears under plain `vite dev`.

import { Link } from "react-router-dom";

export default function RedirectHandler() {
  return (
    <div className="center-page">
      <h2>Scan redirects run on the server</h2>
      <p>
        Run <code>npx vercel dev</code> locally (or deploy to Vercel) to test scans — plain <code>npm run dev</code> doesn&apos;t
        include the <code>/api</code> function.
      </p>
      <p>
        <Link to="/">Back to QR Pro</Link>
      </p>
    </div>
  );
}
