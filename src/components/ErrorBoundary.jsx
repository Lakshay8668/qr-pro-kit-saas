import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error("ErrorBoundary caught an unhandled error:", error, errorInfo);
  }

  resetError = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      const message = this.state.error?.message || "An unexpected error occurred.";
      return (
        <div className="center-page" style={{ padding: "40px 20px", maxWidth: 640, margin: "40px auto" }}>
          <div className="card" style={{ padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
            <h2 style={{ marginBottom: 8, fontSize: 22 }}>Something went wrong</h2>
            <p style={{ color: "var(--c-muted, #64748b)", marginBottom: 20 }}>
              The application encountered a runtime error while rendering this page.
            </p>
            <div className="alert error" style={{ textAlign: "left", marginBottom: 20, wordBreak: "break-word" }}>
              {message}
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  this.resetError();
                  window.location.reload();
                }}
              >
                Reload page
              </button>
              <a
                href="/"
                className="dash-btn"
                onClick={this.resetError}
                style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
              >
                Return to home
              </a>
            </div>
            {this.state.errorInfo && (
              <details style={{ marginTop: 24, textAlign: "left", fontSize: 12, color: "var(--c-muted, #64748b)" }}>
                <summary style={{ cursor: "pointer", userSelect: "none" }}>Technical details</summary>
                <pre style={{ marginTop: 8, padding: 12, background: "#f8fafc", borderRadius: 6, overflowX: "auto", whiteSpace: "pre-wrap" }}>
                  {this.state.error?.stack || message}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
