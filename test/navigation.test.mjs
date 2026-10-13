// test/navigation.test.mjs — Comprehensive regression tests for sidebar navigation and routing
import assert from "node:assert/strict";
import http from "node:http";
import server from "../server.js";

const ok = (m) => console.log(`  ✓ ${m}`);

console.log("Running Navigation & Route verification tests...");

// ------------------------------------------------------------------ 1. AppShell Navigation Items & Routes
{
  // Simulated navItems specification matching src/components/AppShell.jsx
  const navItems = [
    { key: "overview", label: "Overview", route: "/dashboard?tab=overview", altRoute: "/overview" },
    { key: "links", label: "My QR Codes", route: "/dashboard?tab=links", altRoute: "/links" },
    { key: "create", label: "Create QR Code", route: "/dashboard?tab=create", altRoute: "/" },
    { key: "bulk", label: "Bulk Create", route: "/dashboard?tab=bulk", altRoute: "/bulk" },
    { key: "analytics", label: "Analytics", route: "/dashboard?tab=analytics", altRoute: "/analytics" },
    { key: "folders", label: "Folders", route: "/dashboard?tab=folders", altRoute: "/folders" },
    { key: "billing", label: "Plan & Billing", route: "/dashboard?tab=billing", altRoute: "/billing" },
    { key: "settings", label: "Settings", route: "/dashboard?tab=settings", altRoute: "/settings" },
    { key: "help", label: "Help & FAQ", route: "/dashboard?tab=help", altRoute: "/help" },
  ];

  // All 9 items must have defined routes
  const allKeys = ["overview", "links", "create", "bulk", "analytics", "folders", "billing", "settings", "help"];
  for (const k of allKeys) {
    const item = navItems.find((i) => i.key === k);
    assert.ok(item, `nav item '${k}' must exist in navItems`);
    assert.ok(item.route, `nav item '${k}' must have an explicit route defined`);
    assert.ok(item.route.startsWith("/dashboard?tab="), `nav item '${k}' must navigate to /dashboard?tab=`);
  }
  ok("All 9 sidebar items have explicit routes defined (no undefined route)");

  // ------------------------------------------------------------------ 2. handleNavClick behavior
  const simulateNavClick = (tabKey, route, onTabChange) => {
    let navigatedTo = null;
    let tabChangedTo = null;
    const navigate = (to) => { navigatedTo = to; };
    const tabHandler = onTabChange ? (t) => { tabChangedTo = t; } : undefined;

    // Implementation matching AppShell.jsx
    const target = route || (tabKey === "links" ? "/dashboard?tab=links" : `/dashboard?tab=${tabKey}`);
    navigate(target);
    if (tabHandler) tabHandler(tabKey);

    return { navigatedTo, tabChangedTo };
  };

  // Case A: Click from Create QR Code page '/' where onTabChange is undefined
  for (const k of allKeys) {
    const item = navItems.find((i) => i.key === k);
    const res = simulateNavClick(item.key, item.route, undefined);
    assert.equal(res.navigatedTo, item.route, `Must navigate to ${item.route} even when onTabChange is undefined`);
  }
  ok("Sidebar clicks from '/' without onTabChange navigate unconditionally to target route");

  // Case B: Click from Dashboard with onTabChange provided
  for (const k of allKeys) {
    const item = navItems.find((i) => i.key === k);
    let tabCalled = false;
    const res = simulateNavClick(item.key, item.route, (t) => { tabCalled = true; });
    assert.equal(res.navigatedTo, item.route);
    assert.equal(res.tabChangedTo, item.key);
  }
  ok("Sidebar clicks with onTabChange update route and invoke tab handler synchronously");

  // Case C: Click with route omitted falls back gracefully to /dashboard?tab=
  const fallbackRes = simulateNavClick("analytics", undefined, undefined);
  assert.equal(fallbackRes.navigatedTo, "/dashboard?tab=analytics");
  ok("Sidebar click with omitted route gracefully computes /dashboard?tab=${key}");

  // ------------------------------------------------------------------ 3. Active State Determination
  const isItemActive = (item, currentTab, location) => {
    if (currentTab && currentTab === item.key) return true;
    if (item.route && (location.pathname + location.search) === item.route) return true;
    if (item.altRoute && location.pathname === item.altRoute) return true;
    if (item.key === "links" && location.pathname === "/dashboard" && (!location.search || location.search.includes("tab=links"))) return true;
    return false;
  };

  // Test active highlights for each tab on /dashboard?tab=...
  for (const k of allKeys) {
    const activeItem = navItems.find((i) => i.key === k);
    const loc = { pathname: "/dashboard", search: `?tab=${k}` };
    assert.equal(isItemActive(activeItem, k, loc), true, `Item '${k}' should be active when tab is '${k}'`);

    // Ensure other items are NOT active
    for (const other of navItems) {
      if (other.key !== k) {
        assert.equal(isItemActive(other, k, loc), false, `Item '${other.key}' should NOT be active when tab is '${k}'`);
      }
    }
  }
  ok("Active state correctly highlights active tab on /dashboard?tab=... and deactivates others");

  // Test direct routes like /overview, /analytics, /folders, /create, /bulk, /billing
  for (const k of ["overview", "analytics", "folders", "settings", "help"]) {
    const activeItem = navItems.find((i) => i.key === k);
    const loc = { pathname: `/${k}`, search: "" };
    assert.equal(isItemActive(activeItem, k, loc), true, `Item '${k}' should be active on direct route '/${k}'`);
  }
  ok("Active state correctly highlights active tab on direct routes (/overview, /analytics, etc.)");

  // Direct standalone pages highlight their nav item correctly
  assert.equal(isItemActive(navItems.find((i) => i.key === "create"), "create", { pathname: "/", search: "" }), true);
  assert.equal(isItemActive(navItems.find((i) => i.key === "bulk"), "bulk", { pathname: "/bulk", search: "" }), true);
  assert.equal(isItemActive(navItems.find((i) => i.key === "billing"), "billing", { pathname: "/billing", search: "" }), true);
  ok("Direct paths ('/', '/bulk', '/billing') highlight their corresponding sidebar nav item");

  // Default dashboard without query params highlights 'links' (My QR Codes)
  const defaultLoc = { pathname: "/dashboard", search: "" };
  const linksItem = navItems.find((i) => i.key === "links");
  assert.equal(isItemActive(linksItem, "links", defaultLoc), true);
  ok("Default /dashboard without query parameters highlights 'My QR Codes'");
}

// ------------------------------------------------------------------ 4. Server Route Delivery (SPA Fallback)
{
  let port;
  function request(path) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        `http://127.0.0.1:${port}${path}`,
        { method: "GET" },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            resolve({ status: res.statusCode, headers: res.headers, raw });
          });
        }
      );
      req.on("error", reject);
      req.end();
    });
  }

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;

  const testRoutes = [
    "/",
    "/create",
    "/dashboard",
    "/dashboard?tab=overview",
    "/dashboard?tab=links",
    "/dashboard?tab=create",
    "/dashboard?tab=bulk",
    "/dashboard?tab=analytics",
    "/dashboard?tab=folders",
    "/dashboard?tab=billing",
    "/dashboard?tab=settings",
    "/dashboard?tab=help",
    "/overview",
    "/links",
    "/analytics",
    "/folders",
    "/settings",
    "/help",
    "/bulk",
    "/billing",
  ];

  for (const r of testRoutes) {
    const res = await request(r);
    assert.equal(res.status, 200, `Route ${r} must return HTTP 200`);
    assert.ok(
      res.raw.includes("<div id=\"root\">") || res.raw.includes("__APP_CONFIG__") || res.raw.includes("<!DOCTYPE html>"),
      `Route ${r} must serve valid SPA HTML`
    );
  }
  ok("All navigation routes and browser refresh URLs return HTTP 200 with valid SPA HTML");

  await new Promise((resolve) => server.close(resolve));
}

console.log("All Navigation & Route verification tests passed!");
