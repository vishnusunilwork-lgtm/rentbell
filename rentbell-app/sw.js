const CACHE = "rentbell-v1", DATA = "rentbell-data";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== DATA).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const own = url.origin === location.origin, font = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!own && !font) return;
  // Newest copy when online, saved copy when offline.
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});

/* ---- Daily notification: who is late or due, worked out from the copy the app saved on this phone ---- */
const pad = n => String(n).padStart(2, "0");
const money = n => "₹" + Math.round(n).toLocaleString("en-IN");
function analyse(st) {
  const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const S = st.settings || {}, soonDays = +S.daysBefore || 3, late = [], due = [], soon = [];
  for (const t of st.tenants || []) {
    const sp = String(t.start || "").split("-").map(Number);
    if (!sp[0] || !sp[1]) continue;
    let oldest = 0, pending = 0, dueToday = 0, soonIn = -1, soonAmt = 0;
    for (let d = new Date(sp[0], sp[1] - 1, 1), i = 0; i < 240; d = new Date(d.getFullYear(), d.getMonth() + 1, 1), i++) {
      const key = d.getFullYear() + "-" + pad(d.getMonth() + 1);
      if (d > new Date(today.getFullYear(), today.getMonth() + 1, 1)) break;
      if (t.left && key > String(t.left).slice(0, 7)) break;
      let rent = +t.rent || 0;
      for (const c of (t.rents || []).slice().sort((a, b) => a.from.localeCompare(b.from))) if (c.from <= key) rent = +c.amount || 0;
      const extra = (st.charges || []).filter(c => c.tid === t.id && c.month === key).reduce((a, c) => a + (+c.amount || 0), 0);
      const paid = (st.payments || []).filter(p => p.tid === t.id && p.month === key).reduce((a, p) => a + (+p.amount || 0), 0);
      const bal = Math.max(0, rent + extra - paid);
      if (!bal) continue;
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const dd = new Date(d.getFullYear(), d.getMonth(), Math.min(+t.dueDay || 1, last));
      const days = Math.round((today - dd) / 864e5);
      if (days > 0) { oldest = Math.max(oldest, days); pending += bal; }
      else if (days === 0) { dueToday += bal; pending += bal; }
      else if (-days <= soonDays && soonIn < 0) { soonIn = -days; soonAmt = bal; }
    }
    if (oldest) late.push({ n: t.name, days: oldest, amt: pending, note: t.note || "" });
    else if (dueToday) due.push({ n: t.name, amt: dueToday });
    else if (soonIn >= 0) soon.push({ n: t.name, amt: soonAmt, days: soonIn });
  }
  late.sort((a, b) => b.days - a.days);
  const amt = x => S.hide === false ? " " + money(x) : "";
  const lines = [];
  if (late.length) lines.push("Late: " + late.map(x => x.n + amt(x.amt) + " (" + x.days + (x.days === 1 ? " day" : " days") + ")").join(", "));
  if (due.length) lines.push("Due today: " + due.map(x => x.n + amt(x.amt)).join(", "));
  if (soon.length) lines.push("Due soon: " + soon.map(x => x.n + " in " + x.days + (x.days === 1 ? " day" : " days")).join(", "));
  return { lines, urgent: late.length + due.length, any: lines.length };
}
async function check(force) {
  const data = await caches.open(DATA);
  const res = await data.match("state.json");
  if (!res) { if (force) await self.registration.showNotification("RentBell", { body: "Open RentBell once so it can prepare your notification.", icon: "icon-192.png", badge: "icon-192.png", tag: "rent-daily" }); return; }
  const st = await res.json();
  if (!force && !(st.settings && st.settings.notify)) return;
  const now = new Date(), day = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
  if (!force) { const l = await data.match("last.json"); if (l && (await l.json()).day === day) return; }
  const a = analyse(st);
  if (!a.any && !force) return;
  await self.registration.showNotification(a.urgent ? "RentBell: rent pending" : "RentBell", {
    body: a.any ? a.lines.join("\n") : "All rent is clear today.", icon: "icon-192.png", badge: "icon-192.png", tag: "rent-daily", renotify: true });
  await data.put("last.json", new Response(JSON.stringify({ day })));
}
self.addEventListener("periodicsync", e => { if (e.tag === "rent-check") e.waitUntil(check(false)); });
self.addEventListener("message", e => { if (e.data === "check-now") e.waitUntil(check(true)); });
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => { for (const c of cs) if ("focus" in c) return c.focus(); return self.clients.openWindow("./"); }));
});
