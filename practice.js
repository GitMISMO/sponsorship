/* PRACTICE COPY (November 7, 2026)
   Add ?practice to the address of the Sponsorship Portal or any prospectus and the page runs
   on made-up test data in this browser instead of the real records:
     resources.mismo.org/sponsorship/?practice
     resources.mismo.org/Sponsorship-Prospectus/spring-2027/?practice
   Nothing is saved to the real records, nothing goes to Power Automate, nobody is emailed.
   An application submitted on a prospectus in practice shows up in the practice portal's
   inbox, so the whole round trip can be tried. "Reset Test Data" puts it all back.

   How: this file loads before everything else on the page. Without ?practice it does
   nothing at all. With it, it
     - answers the save relay itself, from practice-data.json kept in this browser
       (same answers as the relay, including 409 when two saves cross),
     - stands in for the sign-in (session.js keeps the first ResourcesSession it finds),
     - stands in for the Power Automate flows: the Availability flow answers from the practice
       Sponsorship Requests list, the Intake flow drops the application into the practice
       inbox, and the Team Emails flow marks each outbox email sent and copies status
       changes onto the practice list,
     - refuses every other outside address, so nothing can leak out.
   The automated checks in tests/ open the pages this same way. */
(function(){
  "use strict";
  if(!/[?&]practice(\b|=|&|$)/.test(location.search)) return;

  var KEY = "mismo.practice.sponsorship.v1";
  var me = document.currentScript && document.currentScript.src;
  var BASE = me ? me.replace(/[^\/]*$/, "") : "/sponsorship/";
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.MISMO_PRACTICE = true;

  /* ---------- the practice data ---------- */
  function today(){ var d = new Date(); d.setHours(12, 0, 0, 0); return d; }
  function iso(d){ return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  /* "{{today-5}}" in the test data becomes the date five days ago, so the data never goes stale */
  function dates(v){
    if(typeof v === "string") return v.replace(/\{\{today([+-]\d+)?\}\}/g, function(_, n){
      var d = today(); d.setDate(d.getDate() + Number(n || 0)); return iso(d);
    });
    if(Array.isArray(v)) return v.map(dates);
    if(v && typeof v === "object"){ var o = {}; for(var k in v) o[k] = dates(v[k]); return o; }
    return v;
  }
  function fresh(){
    var x = new XMLHttpRequest();
    x.open("GET", BASE + "practice-data.json", false);   // practice only: keeps the page's own start-up order
    x.send();
    var d = dates(JSON.parse(x.responseText));
    var files = {};
    Object.keys(d.files || {}).forEach(function(n){ files[n] = {data: d.files[n], sha: 1}; });
    return {files: files, list: d.list || [], sent: [], made: new Date().toISOString()};
  }
  var mem = null;
  function store(){
    if(mem) return mem;
    try{ var s = localStorage.getItem(KEY); if(s) mem = JSON.parse(s); }catch(e){}
    if(!mem) mem = fresh();
    return mem;
  }
  function keep(){ try{ localStorage.setItem(KEY, JSON.stringify(mem)); }catch(e){} paintBar(); }
  function reset(){ try{ localStorage.removeItem(KEY); }catch(e){} mem = null; }

  /* ---------- answers ---------- */
  function reply(status, body){
    return Promise.resolve(new Response(JSON.stringify(body), {status: status, headers: {"Content-Type": "application/json"}}));
  }
  function note(kind, text, extra){
    var s = store();
    s.sent.unshift(Object.assign({at: new Date().toISOString(), kind: kind, text: text}, extra || {}));
    s.sent = s.sent.slice(0, 200);
  }

  /* the save relay: GET returns {data, sha}; PUT {content, sha} saves or answers 409 */
  function relay(method, name, body){
    var s = store(), f = s.files[name];
    if(method === "GET"){
      if(!f) return reply(404, {error: "NOT_FOUND"});
      return reply(200, {data: f.data, sha: "p" + f.sha});
    }
    if(method === "PUT"){
      var b = {}; try{ b = JSON.parse(body || "{}"); }catch(e){}
      var cur = f ? "p" + f.sha : null;
      if(f && b.sha !== cur) return reply(409, {error: "CONFLICT"});
      if(!f && b.sha) return reply(409, {error: "CONFLICT"});
      s.files[name] = {data: b.content, sha: (f ? f.sha : 0) + 1};
      if(name === "outbox") teamEmails();
      keep();
      return reply(200, {sha: "p" + s.files[name].sha});
    }
    return reply(405, {error: "METHOD"});
  }

  /* stand-in for the Team Emails flow: each queued email is "sent" (only recorded here), and a
     status change is copied onto the practice Sponsorship Requests list */
  function teamEmails(){
    var s = store(), ob = s.files.outbox && s.files.outbox.data, docs = (ob && ob.docs) || {};
    if(!s.files["outbox-sent"]) s.files["outbox-sent"] = {data: {list: []}, sha: 1};
    var sentFile = s.files["outbox-sent"], done = {};
    (sentFile.data.list || []).forEach(function(x){ done[x.id] = 1; });
    var added = 0;
    Object.keys(docs).forEach(function(id){
      var o = docs[id];
      if(done[id] || !o || o.status !== "queued") return;
      sentFile.data.list.push({id: id, sentAt: new Date().toISOString()});
      added++;
      if(o.kind === "status"){
        var row = null;
        s.list.forEach(function(r){ if(r.reference === o.listReference) row = r; });
        if(!row){ row = {reference: o.listReference}; s.list.push(row); }
        row.program = o.listProgram; row.tier = o.listTier; row.opportunity = o.listOpportunity;
        row.status = o.listStatus;
        if(o.listDay === "none") row.day = null; else if(o.listDay) row.day = o.listDay;
        row.lines = o.listSummitLines || null;
        note("list", o.company + " — " + o.listStatus + " on the Sponsorship Requests list", {appNo: o.appNo});
      } else {
        note("email", (o.kind || "email") + " email to " + (o.toNames || "the team") + " — " + (o.company || ""), {appNo: o.appNo, emailKind: o.kind});
      }
    });
    if(added) sentFile.sha++;
  }

  /* stand-in for the Availability flow: Approved, Pending Payment and Paid rows, as the flow sends them */
  function availability(){
    var rows = store().list.filter(function(r){ return /^(Approved|Pending Payment|Paid)$/.test(r.status || ""); })
      .map(function(r){ return {program: r.program, tier: r.tier, opportunity: r.opportunity, day: r.day || null, lines: r.lines || null}; });
    return reply(200, rows);
  }

  /* stand-in for the Intake flow: the application lands in the practice inbox and on the list */
  function intake(body){
    var p = {}; try{ p = JSON.parse(body || "{}"); }catch(e){}
    var s = store();
    if(!s.files.inbox) s.files.inbox = {data: {list: []}, sha: 1};
    var item = {};
    Object.keys(p).forEach(function(k){ if(k !== "logoBase64" && k !== "secret") item[k] = p[k]; });
    item.submittedAt = item.submittedAt || new Date().toISOString();
    item.logoFile = p.logoBase64 ? "practice-logo.png" : "";
    s.files.inbox.data.list.push(item);
    s.files.inbox.sha++;
    s.list.push({reference: item.reference, program: item.program, tier: item.tier, opportunity: item.opportunity,
                 day: item.day || null, status: "New", lines: null});
    note("intake", (item.company || "An application") + " applied (" + (item.reference || "") + ")", {payload: item});
    keep();
    return reply(200, {ok: true});
  }

  window.fetch = function(input, init){
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    var body = init && init.body;
    var u; try{ u = new URL(url, location.href); }catch(e){ return Promise.reject(new TypeError("bad address")); }
    var m = /^\/([a-z0-9-]+)\/data\/([a-z0-9-]+)$/.exec(u.pathname);
    if(/\.on\.aws$/.test(u.hostname) && m) return relay(method, m[2], body);
    if(/powerplatform\.com$|logic\.azure\.com$/.test(u.hostname)){
      if(/269b42e0741b/.test(u.pathname)) return availability();
      if(method === "POST" && /b11fe7bcb027/.test(u.pathname)) return intake(body);
      note("blocked", method + " " + u.hostname + " (practice: not sent)");
      keep();
      return reply(200, {ok: true});
    }
    if(u.origin === location.origin || /(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)){
      return realFetch(input, init);
    }
    note("blocked", method + " " + u.hostname + " (practice: not sent)");
    keep();
    return Promise.reject(new TypeError("practice copy: outside address not reached"));
  };
  /* no-cors beacons and form posts would bypass fetch */
  if(navigator.sendBeacon) navigator.sendBeacon = function(){ note("blocked", "beacon (practice: not sent)"); return true; };

  /* ---------- the sign-in ---------- */
  var who = {name: "Practice User", email: "practice@example.org", token: "practice", role: "admin"};
  window.ResourcesSession = {
    current: function(){ return who; },
    token: function(){ return "practice"; },
    requireAccess: function(){ return Promise.resolve("admin"); },
    requireSignIn: function(){ return Promise.resolve(who); },
    signIn: function(){ return Promise.resolve(who); },
    signOut: function(){},
    onChange: function(){},
    mount: function(el){ if(el) el.innerHTML = '<span style="font:600 12px/1 system-ui;opacity:.8">Practice User</span>'; }
  };

  /* ---------- the bar that says so ---------- */
  var bar = null;
  function paintBar(){
    if(!bar) return;
    var s = store(), emails = s.sent.filter(function(x){ return x.kind === "email"; }).length;
    bar.querySelector("[data-n]").textContent = s.sent.length
      ? s.sent.length + " thing" + (s.sent.length === 1 ? "" : "s") + " would have gone out" + (emails ? " (" + emails + " email" + (emails === 1 ? "" : "s") + ")" : "")
      : "Nothing would have gone out yet";
  }
  function mountBar(){
    bar = document.createElement("div");
    bar.id = "practice-bar";
    bar.setAttribute("role", "status");
    /* a card in the bottom-left corner: clear of every page's masthead and of the portal's
       record panel (which opens on the right), and it folds down to a small tag */
    bar.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:2147483000;max-width:min(420px,calc(100vw - 24px));" +
      "box-shadow:0 6px 24px rgba(0,0,0,.3);border-radius:10px;padding:10px 12px;background:#b45309;color:#fff;" +
      "font:500 12.5px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;";
    var btn = "font:inherit;border-radius:6px;padding:3px 9px;cursor:pointer;";
    bar.innerHTML = '<b style="font-weight:700">Practice copy</b>' +
      '<button type="button" data-fold title="Fold" style="' + btn + 'margin-left:auto;background:transparent;color:#fff;border:0;padding:0 4px;font-size:15px;line-height:1">&#8211;</button>' +
      '<div data-more style="flex-basis:100%;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;">' +
      '<span style="flex-basis:100%">Test data only. Nothing is saved to the real records and nobody is emailed.</span>' +
      '<span data-n style="flex-basis:100%;opacity:.9"></span>' +
      '<button type="button" data-log style="' + btn + 'background:transparent;color:#fff;border:1px solid rgba(255,255,255,.6)">What Would Have Gone Out</button>' +
      '<button type="button" data-reset style="' + btn + 'background:#fff;color:#7c2d12;border:0;font-weight:600">Reset Test Data</button>' +
      '<a data-leave style="color:#fff;text-decoration:underline">Leave Practice</a></div>';
    document.body.appendChild(bar);
    var more = bar.querySelector("[data-more]"), fold = bar.querySelector("[data-fold]");
    fold.onclick = function(){
      var open = more.style.display !== "none";
      more.style.display = open ? "none" : "flex";
      fold.innerHTML = open ? "+" : "&#8211;";
      fold.title = open ? "Open" : "Fold";
    };
    var leave = new URL(location.href); leave.searchParams.delete("practice");
    bar.querySelector("[data-leave]").href = leave.pathname + (leave.search || "") + leave.hash;
    bar.querySelector("[data-reset]").onclick = function(){
      if(confirm("Put the practice data back the way it started? Anything tried here is cleared.")){ reset(); location.reload(); }
    };
    bar.querySelector("[data-log]").onclick = function(){
      var s = store();
      alert(s.sent.length ? s.sent.slice(0, 40).map(function(x){ return x.at.slice(11, 16) + "  " + x.text; }).join("\n")
                          : "Nothing yet. Approving, marking paid or submitting an application shows up here.");
    };
    paintBar();
  }
  function start(){ mountBar(); if(document.title.indexOf("Practice") !== 0) document.title = "Practice · " + document.title; }
  if(document.body) start(); else document.addEventListener("DOMContentLoaded", start);

  /* for the automated checks */
  window.__practice = {
    store: store, reset: reset,
    file: function(n){ var f = store().files[n]; return f ? JSON.parse(JSON.stringify(f.data)) : null; },
    /* someone else saving in between, the way a second person or a flow would */
    write: function(n, fn){ var s = store(), f = s.files[n]; fn(f.data); f.sha++; keep(); },
    list: function(){ return JSON.parse(JSON.stringify(store().list)); },
    sent: function(){ return JSON.parse(JSON.stringify(store().sent)); }
  };
})();
