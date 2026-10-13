// src/components/AppShell.jsx — Professional Bitly-inspired SaaS Shell
import React, { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/useAuth";
import { useBilling } from "../lib/useBilling";
import { PLANS } from "../../shared/plans";
import {
  IconDashboard,
  IconQrCode,
  IconPlus,
  IconBulk,
  IconChart,
  IconFolder,
  IconBilling,
  IconSettings,
  IconHelp,
  IconSearch,
  IconMenu,
  IconClose,
} from "./Icons";

export default function AppShell({
  children,
  currentTab = "links",
  onTabChange,
  searchQuery = "",
  onSearchChange,
  title = "My QR Codes",
}) {
  const { user, logout } = useAuth();
  const { me } = useBilling(user);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const displayName = user?.displayName || user?.email?.split("@")[0] || "User";
  const userInitials = (displayName.slice(0, 2) || "QP").toUpperCase();
  const currentPlan = me && me.plan && PLANS[me.plan] ? PLANS[me.plan] : PLANS.free;

  const handleNavClick = (tabKey, route) => {
    setMobileMenuOpen(false);
    const target = route || (tabKey === "links" ? "/dashboard?tab=links" : `/dashboard?tab=${tabKey}`);
    navigate(target);
    if (onTabChange) {
      onTabChange(tabKey);
    }
  };

  const navItems = [
    { key: "overview", label: "Overview", icon: IconDashboard, route: "/dashboard?tab=overview", altRoute: "/overview" },
    { key: "links", label: "My QR Codes", icon: IconQrCode, route: "/dashboard?tab=links", altRoute: "/links" },
    { key: "create", label: "Create QR Code", icon: IconPlus, route: "/dashboard?tab=create", altRoute: "/" },
    { key: "bulk", label: "Bulk Create", icon: IconBulk, route: "/dashboard?tab=bulk", altRoute: "/bulk" },
    { key: "analytics", label: "Analytics", icon: IconChart, route: "/dashboard?tab=analytics", altRoute: "/analytics" },
    { key: "folders", label: "Folders", icon: IconFolder, route: "/dashboard?tab=folders", altRoute: "/folders" },
    { key: "billing", label: "Plan & Billing", icon: IconBilling, route: "/dashboard?tab=billing", altRoute: "/billing" },
    { key: "settings", label: "Settings", icon: IconSettings, route: "/dashboard?tab=settings", altRoute: "/settings" },
    { key: "help", label: "Help & FAQ", icon: IconHelp, route: "/dashboard?tab=help", altRoute: "/help" },
  ];

  const isItemActive = (item) => {
    if (currentTab && currentTab === item.key) return true;
    if (item.route && (location.pathname + location.search) === item.route) return true;
    if (item.altRoute && location.pathname === item.altRoute) return true;
    if (item.key === "links" && location.pathname === "/dashboard" && (!location.search || location.search.includes("tab=links"))) return true;
    return false;
  };

  return (
    <div className="bitly-layout">
      {/* Mobile Backdrop */}
      {mobileMenuOpen && (
        <div
          className="bitly-backdrop"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Left Sidebar */}
      <aside className={`bitly-sidebar ${mobileMenuOpen ? "open" : ""}`}>
        <div className="sidebar-brand-box">
          <Link to="/dashboard" className="sidebar-brand">
            <div className="brand-icon-box">
              <span className="brand-qr-sym">QR</span>
            </div>
            <div className="brand-text">
              QR<span>Pro</span> <span className="brand-subtag">Kit</span>
            </div>
          </Link>
          <button
            type="button"
            className="sidebar-close-btn"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close menu"
          >
            <IconClose size={20} />
          </button>
        </div>

        {/* Primary Create Button */}
        <div className="sidebar-cta-wrap">
          <button
            type="button"
            className="sidebar-create-btn"
            onClick={() => handleNavClick("create", "/dashboard?tab=create")}
          >
            <IconPlus size={18} />
            <span>Create QR Code</span>
          </button>
        </div>

        {/* Navigation list */}
        <nav className="sidebar-nav">
          <div className="nav-group-title">MANAGE</div>
          {navItems.slice(0, 6).map((item) => {
            const Icon = item.icon;
            const isActive = isItemActive(item);
            return (
              <button
                key={item.key}
                type="button"
                className={`sidebar-nav-item ${isActive ? "active" : ""}`}
                onClick={() => handleNavClick(item.key, item.route)}
              >
                <Icon size={18} className="nav-item-icon" />
                <span className="nav-item-label">{item.label}</span>
                {item.key === "bulk" && me && !me?.features?.bulk && (
                  <span className="nav-badge-pro">Pro</span>
                )}
              </button>
            );
          })}

          <div className="nav-group-title" style={{ marginTop: "18px" }}>ACCOUNT &amp; SUPPORT</div>
          {navItems.slice(6).map((item) => {
            const Icon = item.icon;
            const isActive = isItemActive(item);
            return (
              <button
                key={item.key}
                type="button"
                className={`sidebar-nav-item ${isActive ? "active" : ""}`}
                onClick={() => handleNavClick(item.key, item.route)}
              >
                <Icon size={18} className="nav-item-icon" />
                <span className="nav-item-label">{item.label}</span>
              </button>
            );
          })}

          {me?.isAdmin && (
            <Link to="/admin" className="sidebar-nav-item admin-item" style={{ marginTop: "12px" }}>
              <span className="nav-item-icon">👑</span>
              <span className="nav-item-label">Admin Panel</span>
            </Link>
          )}
        </nav>

        {/* Sidebar Footer User Profile */}
        <div className="sidebar-user-footer">
          <div className="user-profile-card">
            <div className="user-avatar" title={user?.email || "User"}>
              {userInitials}
            </div>
            <div className="user-info">
              <div className="user-name" title={displayName}>
                {displayName}
              </div>
              <div className="user-plan-row">
                <span className={`user-plan-pill plan-${me?.isAdmin ? "admin" : me?.plan || "free"}`}>
                  {me?.isAdmin ? "Admin Unlimited" : currentPlan.name}
                </span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="bitly-main-wrapper">
        {/* Top Header */}
        <header className="bitly-top-header">
          <div className="top-header-left">
            <button
              type="button"
              className="hamburger-btn"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open sidebar"
            >
              <IconMenu size={22} />
            </button>
            <div className="page-breadcrumb">
              <span className="bc-app">QR Pro Kit</span>
              <span className="bc-sep">/</span>
              <span className="bc-current">{title}</span>
            </div>
          </div>

          <div className="top-header-center">
            {onSearchChange && (
              <div className="global-search-box">
                <IconSearch size={16} className="search-icon" />
                <input
                  type="search"
                  className="global-search-input"
                  placeholder="Search QR codes by label, destination, or ID…"
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  aria-label="Search QR codes"
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="search-clear-btn"
                    onClick={() => onSearchChange("")}
                    aria-label="Clear search"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="top-header-right">
            <button
              type="button"
              className="top-new-btn"
              onClick={() => handleNavClick("create", "/dashboard?tab=create")}
            >
              <IconPlus size={16} />
              <span>New QR</span>
            </button>

            <button
              type="button"
              className={`top-plan-badge badge-${me?.isAdmin ? "admin" : me?.plan || "free"}`}
              onClick={() => handleNavClick("billing", "/dashboard?tab=billing")}
              title="Click to view plan and usage"
            >
              {me?.isAdmin ? "👑 Admin" : `${currentPlan.name} Plan`}
            </button>

            {/* Profile Dropdown */}
            <div className="top-user-wrap">
              <button
                type="button"
                className="top-user-avatar-btn"
                onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                aria-label="User profile menu"
                aria-expanded={userDropdownOpen}
              >
                {userInitials}
              </button>

              {userDropdownOpen && (
                <>
                  <div
                    className="dropdown-scrim"
                    onClick={() => setUserDropdownOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="user-dropdown-menu">
                    <div className="dropdown-header">
                      <div className="dropdown-name">{displayName}</div>
                      <div className="dropdown-email">{user?.email}</div>
                      <div className="dropdown-uid">UID: <code>{user?.uid?.slice(0, 10)}…</code></div>
                    </div>
                    <div className="dropdown-divider" />
                    <button
                      type="button"
                      className="dropdown-item"
                      onClick={() => {
                        setUserDropdownOpen(false);
                        handleNavClick("overview", "/dashboard?tab=overview");
                      }}
                    >
                      <IconDashboard size={15} /> Overview
                    </button>
                    <button
                      type="button"
                      className="dropdown-item"
                      onClick={() => {
                        setUserDropdownOpen(false);
                        handleNavClick("links", "/dashboard?tab=links");
                      }}
                    >
                      <IconQrCode size={15} /> My QR Codes
                    </button>
                    <button
                      type="button"
                      className="dropdown-item"
                      onClick={() => {
                        setUserDropdownOpen(false);
                        handleNavClick("billing", "/dashboard?tab=billing");
                      }}
                    >
                      <IconBilling size={15} /> Plan &amp; Billing
                    </button>
                    {me?.isAdmin && (
                      <Link
                        to="/admin"
                        className="dropdown-item admin-link"
                        onClick={() => setUserDropdownOpen(false)}
                      >
                        👑 Admin Panel
                      </Link>
                    )}
                    <div className="dropdown-divider" />
                    <button
                      type="button"
                      className="dropdown-item text-danger"
                      onClick={() => {
                        setUserDropdownOpen(false);
                        logout();
                      }}
                    >
                      Sign Out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Page Content Body */}
        <main className="bitly-content-body">
          {children}
        </main>
      </div>
    </div>
  );
}
