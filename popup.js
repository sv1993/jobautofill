const PROFILE_FIELDS = [
  ["firstName","First name"],["middleName","Middle name"],["lastName","Last name"],
  ["phone","Mobile"],["email","Email"],["experience","Experience (years)"],
  ["noticeDays","Notice / days to join"],["currentSalary","Current salary"],["expectedSalary","Expected salary"],
  ["currentFixedCtc","Current fixed CTC"],["currentCompany","Current company"],["currentTitle","Current title"],
  ["city","City / location"],["linkedin","LinkedIn URL"],["github","GitHub URL"],["portfolio","Website / portfolio"],
  ["reason","Reason for job change"],["additionalInfo","Additional information"]
];
const $ = id => document.getElementById(id);
const status = m => ($("status").textContent = m);
const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
let custom = [];

// build profile inputs
for (const [key, label] of PROFILE_FIELDS) {
  const long = key === "reason" || key === "additionalInfo";
  const wrap = document.createElement("div");
  if (long) wrap.style.gridColumn = "1 / -1";
  wrap.innerHTML = `<label>${label}</label>` + (long ? `<textarea id="${key}"></textarea>` : `<input id="${key}">`);
  $("profileFields").appendChild(wrap);
}

function readFile(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res({ name: file.name, type: file.type, dataUrl: r.result });
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function save() {
  const profile = {};
  PROFILE_FIELDS.forEach(([k]) => (profile[k] = $(k).value.trim()));
  const data = { profile, custom };
  const file = $("resume").files[0];
  if (file) { data.resume = await readFile(file); $("resumeName").textContent = "(" + file.name + ")"; }
  await chrome.storage.local.set(data);
}

function upsert(label, value) {
  const n = norm(label);
  if (!n || !value) return false;
  const i = custom.findIndex(c => norm(c.label) === n);
  if (i >= 0) custom[i].value = value; else custom.push({ label, value });
  return true;
}

function renderCustom() {
  $("count").textContent = custom.length;
  const box = $("customList");
  box.innerHTML = "";
  custom.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "crow";
    row.innerHTML = `<span></span><input><button title="Delete">✕</button>`;
    row.querySelector("span").textContent = c.label;
    const inp = row.querySelector("input");
    inp.value = c.value;
    inp.onchange = async () => { custom[i].value = inp.value; await save(); };
    row.querySelector("button").onclick = async () => { custom.splice(i, 1); await save(); renderCustom(); };
    box.appendChild(row);
  });
}

async function send(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  return chrome.tabs.sendMessage(tab.id, msg);
}

function showUnmatched(list) {
  const box = $("newFields");
  box.innerHTML = "";
  $("newBox").style.display = list.length ? "block" : "none";
  for (const f of list) {
    const row = document.createElement("div");
    row.innerHTML = `<label></label>`;
    row.querySelector("label").textContent = f.label;
    let input;
    if (f.options && f.options.length) {
      input = document.createElement("select");
      input.innerHTML = `<option value="">— skip —</option>`;
      f.options.forEach(o => { const op = document.createElement("option"); op.value = o; op.textContent = o; input.appendChild(op); });
    } else {
      input = document.createElement("input");
    }
    input.dataset.label = f.label;
    row.appendChild(input);
    box.appendChild(row);
  }
}

async function fill() {
  await save();
  const { profile, resume } = await chrome.storage.local.get(["profile", "resume"]);
  try {
    const res = await send({ type: "FILL", profile, custom, resume });
    status(`Filled ${res.filled} field(s)` + (res.resume ? ", resume attached." : ".") +
      (res.unmatched.length ? ` ${res.unmatched.length} new field(s) need an answer.` : ""));
    showUnmatched(res.unmatched);
  } catch (e) { status("Can't run on this page: " + e.message); }
}

async function learn() {
  try {
    const res = await send({ type: "LEARN" });
    let n = 0;
    res.fields.forEach(f => { if (upsert(f.label, f.value)) n++; });
    await save(); renderCustom();
    status(n ? `Learned ${n} field(s) from this page.` : "Nothing new to learn here (fill the form first).");
  } catch (e) { status("Can't run on this page: " + e.message); }
}

(async () => {
  const d = await chrome.storage.local.get(["profile", "custom", "resume"]);
  const profile = d.profile || {};
  custom = d.custom || [];
  PROFILE_FIELDS.forEach(([k]) => ($(k).value = profile[k] || ""));
  if (d.resume) $("resumeName").textContent = "(" + d.resume.name + ")";
  renderCustom();
  $("save").onclick = async () => { await save(); status("Saved."); };
  $("fill").onclick = fill;
  $("learn").onclick = learn;
  $("saveNew").onclick = async () => {
    document.querySelectorAll("#newFields [data-label]").forEach(el => upsert(el.dataset.label, el.value.trim()));
    renderCustom(); await fill();
  };
})();
