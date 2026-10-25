import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import App from "./App";
import Dashboard from "./pages/Dashboard";
import RedirectHandler from "./pages/RedirectHandler";
import Bulk from "./pages/Bulk";
import Admin from "./pages/Admin";
import Pricing from "./pages/Pricing";
import Billing from "./pages/Billing";
import DraftQrPage from "./pages/DraftQrPage";
import CheckInScanner from "./pages/CheckInScanner";
import "./styles.css";

function NotFound() {
  return (
    <div className="center-page">
      <h2>Page not found</h2>
      <Link to="/">Back to QR Pro</Link>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/create" element={<Dashboard defaultTab="create" />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/overview" element={<Dashboard defaultTab="overview" />} />
          <Route path="/links" element={<Dashboard defaultTab="links" />} />
          <Route path="/analytics" element={<Dashboard defaultTab="analytics" />} />
          <Route path="/folders" element={<Dashboard defaultTab="folders" />} />
          <Route path="/settings" element={<Dashboard defaultTab="settings" />} />
          <Route path="/help" element={<Dashboard defaultTab="help" />} />
          <Route path="/bulk" element={<Bulk />} />
          <Route path="/events" element={<Dashboard defaultTab="events" />} />
          <Route path="/events/:id/checkin" element={<CheckInScanner />} />
          <Route path="/checkin" element={<CheckInScanner />} />
          <Route path="/reviews" element={<Dashboard defaultTab="reviews" />} />
          <Route path="/google-review" element={<Dashboard defaultTab="reviews" />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/billing" element={<Billing />} />
          <Route path="/draft" element={<DraftQrPage />} />
          <Route path="/q/:id" element={<RedirectHandler />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
