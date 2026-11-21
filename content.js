(() => {
  if (window.__jafLoaded) return;
  window.__jafLoaded = true;

  // Built-in profile fields. First match wins, so specific rules come first.
  const RULES = [
    { key: "firstName",       re: /first\s*name|given\s*name/i },
    { key: "middleName",      re: /middle\s*name/i },
    { key: "lastName",        re: /last\s*name|surname|family\s*name/i },
    { key: "fullName",        re: /full\s*name|^\s*(your |candidate )?name\W*$/i },
    { key: "currentFixedCtc", re: /current\s*fixed\s*ctc/i },
    { key: "currentCompany",  re: /current\s*(company|employer|organi[sz]ation)/i },
    { key: "currentTitle",    re: /current\s*(title|designation|role)|job\s*title/i },
    { key: "currentSalary",   re: /current\s*(salary|ctc|compensation)/i },
    { key: "expectedSalary",  re: /expected\s*(salary|ctc|compensation)/i },
    { key: "noticeDays",      re: /available\s*to\s*join|notice\s*period|days\s*to\s*join/i },
    { key: "reason",          re: /reason\s*for\s*(job\s*)?(change|leaving)|why.*(leav|chang)/i },
    { key: "additionalInfo",  re: /additional\s*information|cover\s*letter/i },
    { key: "linkedin",        re: /linked\s*in/i },
    { key: "github",          re: /git\s*hub/i },
    { key: "portfolio",       re: /portfolio|website|personal\s*site/i },
    { key: "email",           re: /e-?mail/i },
    { key: "phone",           re: /mobile|phone|contact\s*number/i },
    { key: "city",            re: /^\s*(current\s*)?(city|location)\W*$/i },
    { key: "experience",      re: /experience/i },
  ];
  // Never fill or learn these.
  const SKIP = /password|passcode|\botp\b|captcha|cvv|card\s*number|aadhaar|aadhar|\bpan\b|passport|\bssn\b|terms|consent|i\s*agree|privacy/i;
  const STOP = new Set("the a an your you is are of in on for to and or please enter select choose what do does did have has any if this that with at as be by".split(" "));

  const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const clean = s => (s || "").replace(/[*:]/g, " ").replace(/\s+/g, " ").trim();

  const tok = s => [...new Set(s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")
    .filter(w => w && !STOP.has(w)).map(w => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w)))];

  function sim(a, b) {
    if (!a.length || !b.length) return 0;
    const B = new Set(b), inter = a.filter(x => B.has(x)).length;
    const jac = inter / (a.length + b.length - inter);
    const cont = Math.min(a.length, b.length) >= 2 ? (inter / Math.min(a.length, b.length)) * 0.9 : 0;
    return Math.max(jac, cont);
  }

  function bestOption(texts, val) {
    const v = String(val).trim().toLowerCase();
    if (!v) return -1;
    let i = texts.findIndex(t => t.trim().toLowerCase() === v);
    if (i >= 0) return i;
    i = texts.findIndex(t => t.trim().length > 1 && (t.toLowerCase().includes(v) || v.includes(t.trim().toLowerCase())));
    if (i >= 0) return i;
    const vt = tok(v);
    let best = -1, bs = 0;
    texts.forEach((t, k) => { const s = sim(vt, tok(t)); if (s > bs) { bs = s; best = k; } });
    return bs >= 0.6 ? best : -1;
  }

  // ---- label discovery ----
  function labelOf(el) {
    const parts = [el.getAttribute("aria-label"), el.placeholder];
    const by = el.getAttribute("aria-labelledby");
    if (by) by.split(/\s+/).forEach(id => parts.push(document.getElementById(id)?.textContent));
    if (el.labels) for (const l of el.labels) parts.push(l.textContent);
    let text = clean(parts.filter(Boolean).join(" "));
    if (!text) {
      let p = el.parentElement;
      for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
        if (p.querySelectorAll("input:not([type=hidden]),select,textarea").length > 1) break;
        const l = p.querySelector("label,legend");
        if (l) { text = clean(l.textContent); break; }
      }
    }
    if (!text) text = clean(((el.name || "") + " " + (el.id || "")).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " "));
    return text;
  }

  function optionText(r) {
    return clean(r.labels?.[0]?.textContent || r.getAttribute("aria-label") || r.nextSibling?.textContent || r.value);
  }

  function groupLabel(radios, opts) {
    let p = radios[0].parentElement;
    for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
      if (!radios.every(r => p.contains(r))) continue;
      let t = p.textContent;
      opts.forEach(o => { if (o) t = t.replace(o, " "); });
      t = clean(t);
      if (t.length >= 3 && t.length <= 150) return t;
    }
    return labelOf(radios[0]);
  }

  // ---- field model ----
  function setNative(el, val) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
    ["input", "change", "blur"].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
  }

  function collect() {
    const out = [], seenRadio = new Set();
    const els = [...document.querySelectorAll("input,textarea,select")].filter(el =>
      !el.disabled && !el.readOnly && !["hidden", "checkbox", "submit", "button", "file", "password", "image", "reset"].includes(el.type));
    for (const el of els) {
      if (el.type === "radio") {
        const key = (el.form ? "f" : "") + el.name;
        if (!el.name || seenRadio.has(key)) continue;
        seenRadio.add(key);
        const radios = [...document.querySelectorAll(`input[type=radio]`)].filter(r => r.name === el.name && !r.disabled);
        const options = radios.map(optionText);
        out.push({
          kind: "choice", label: groupLabel(radios, options), options,
          current: () => { const i = radios.findIndex(r => r.checked); return i >= 0 ? options[i] : ""; },
          set(val) { const i = bestOption(options, val); if (i < 0) return false; radios[i].click(); return true; },
        });
      } else if (el instanceof HTMLSelectElement) {
        if (!visible(el)) continue;
        const opts = [...el.options];
        const options = opts.map(o => clean(o.text)).filter(t => t && !/^(select|choose|--)/i.test(t));
        out.push({
          kind: "choice", label: labelOf(el), options,
          current: () => { const o = el.options[el.selectedIndex]; const t = o ? clean(o.text) : ""; return el.value && !/^(select|choose|--)/i.test(t) ? t : ""; },
          set(val) { const i = bestOption(opts.map(o => o.text), val); if (i < 0) return false; setNative(el, opts[i].value); return true; },
        });
      } else {
        if (!visible(el)) continue;
        out.push({
          kind: "text", label: labelOf(el), options: [],
          current: () => el.value.trim(),
          set(val) { setNative(el, val); return true; },
        });
      }
    }
    return out.filter(f => f.label);
  }

  function dataUrlToFile(r) {
    const [meta, b64] = r.dataUrl.split(",");
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], r.name, { type: r.type || meta.match(/:(.*?);/)[1] });
  }

  function fillPage(profile, custom, resume) {
    profile = { ...profile };
    if (!profile.fullName) profile.fullName = [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ");
    const customs = (custom || []).map(c => ({ ...c, t: tok(c.label) }));
    const used = new Set(), unmatched = [], seen = new Set();
    let filled = 0, resumeDone = false;

    for (const f of collect()) {
      if (SKIP.test(f.label)) continue;
      const rule = RULES.find(r => r.re.test(f.label));
      let val = "", fromProfile = false;
      if (rule) {
        if (used.has(rule.key)) continue;
        val = profile[rule.key] || "";
        if (val) { used.add(rule.key); fromProfile = true; }
      } else {
        const lt = tok(f.label);
        let best = 0;
        for (const c of customs) { const s = sim(lt, c.t); if (s > best && s >= 0.65) { best = s; val = c.value; } }
      }
      const has = f.current();
      if (val && (fromProfile || !has)) {
        if (f.set(val)) { filled++; continue; }
      }
      if (!has && !val) {
        const k = tok(f.label).join(" ");
        if (k && !seen.has(k)) { seen.add(k); unmatched.push({ label: f.label, kind: f.kind, options: f.options }); }
      }
    }

    if (resume) {
      const fi = document.querySelector("input[type=file]");
      if (fi) {
        const dt = new DataTransfer();
        dt.items.add(dataUrlToFile(resume));
        fi.files = dt.files;
        fi.dispatchEvent(new Event("change", { bubbles: true }));
        resumeDone = true;
      }
    }
    return { filled, resume: resumeDone, unmatched };
  }

  // Fields the user already filled that aren't built-in profile fields.
  function learn() {
    const fields = [];
    for (const f of collect()) {
      if (SKIP.test(f.label) || RULES.some(r => r.re.test(f.label))) continue;
      const v = f.current();
      if (v) fields.push({ label: f.label, value: v });
    }
    return { fields };
  }

  chrome.runtime.onMessage.addListener((msg, _s, send) => {
    if (msg.type === "FILL") send(fillPage(msg.profile || {}, msg.custom, msg.resume));
    else if (msg.type === "LEARN") send(learn());
  });
})();
