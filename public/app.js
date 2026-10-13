// NutriIndia Pro - minimal vanilla-JS frontend that talks to the REST API under /v1.
const $ = (s) => document.querySelector(s);
const state = { token: localStorage.getItem('token'), nextMeals: null };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const localDate = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

async function api(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const h = { Accept: 'application/json', ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (state.token) h.Authorization = `Bearer ${state.token}`;
  // cache:'no-cache' = always revalidate with the server (sends If-None-Match, gets 304 when unchanged)
  const res = await fetch(path, { method, headers: h, cache: 'no-cache', body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (raw) return { res, data, text };
  if (!res.ok) {
    const e = new Error((data && data.error && data.error.message) || res.statusText);
    e.status = res.status;
    e.details = data && data.error && data.error.details;
    throw e;
  }
  return data;
}
const say = (sel, text, isError) => { const el = $(sel); el.textContent = text || ''; el.classList.toggle('error', !!isError); };
const errText = (e) => e.message + (e.details ? ' - ' + e.details.map((d) => `${d.path} ${d.message}`).join('; ') : '');

// ---------- auth ----------
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
  $('#login-form').hidden = b.dataset.tab !== 'login';
  $('#register-form').hidden = b.dataset.tab !== 'register';
  say('#auth-msg', '');
}));

async function startSession(email, password) {
  const s = await api('/v1/sessions', { method: 'POST', body: { email, password } });
  state.token = s.accessToken;
  localStorage.setItem('token', s.accessToken);
  $('#who').textContent = `${s.user.name} (${s.user.role})`;
  await showApp();
}
$('#login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = Object.fromEntries(new FormData(ev.target));
  try { await startSession(f.email, f.password); } catch (e) { say('#auth-msg', errText(e), true); }
});
$('#register-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = Object.fromEntries(new FormData(ev.target));
  try {
    await api('/v1/users', { method: 'POST', body: f, headers: { 'Idempotency-Key': crypto.randomUUID() } });
    await startSession(f.email, f.password);
  } catch (e) { say('#auth-msg', errText(e), true); }
});
function logout() {
  state.token = null;
  localStorage.removeItem('token');
  $('#app').hidden = true; $('#auth').hidden = false; $('#logout').hidden = true; $('#who').textContent = '';
}
$('#logout').addEventListener('click', logout);

// ---------- app ----------
async function showApp() {
  $('#auth').hidden = true; $('#app').hidden = false; $('#logout').hidden = false;
  if (!$('#date').value) $('#date').value = localDate();
  const foods = await api('/v1/foods?limit=50');
  $('#food-select').innerHTML = foods.data.map((f) => `<option value="${f.id}">${esc(f.name)} - ${esc(f.servingDesc)} (${f.calories} kcal)</option>`).join('');
  await Promise.all([loadSummary(), loadMeals(), loadWeights(), loadGoals()]);
}

const bar = (pct) => `<div class="bar ${pct > 100 ? 'over' : ''}"><div style="width:${Math.min(100, pct)}%"></div></div>`;
async function loadSummary() {
  const s = await api(`/v1/summaries/daily?date=${$('#date').value}`);
  $('#summary').innerHTML = `
    <div class="stat"><span>Calories</span><span>${s.calories} / ${s.goalCalories} kcal (${s.remainingCalories} left)</span></div>${bar(s.caloriesPercent)}
    <div class="stat"><span>Protein</span><span>${s.proteinG} / ${s.goalProteinG} g</span></div>${bar(s.proteinPercent)}
    <div class="stat"><span>Carbs ${s.carbsG} g · Fat ${s.fatG} g</span><span>${s.mealCount} items${s.latestWeightKg ? ` · latest weight ${s.latestWeightKg} kg` : ''}</span></div>`;
}

function mealRow(m) {
  return `<li><span>${esc(m.mealType)} · ${esc(m.foodName)} × ${m.servings}<br><small>${m.calories} kcal · ${m.proteinG} g protein · ${esc(m.eatenOn)}</small></span><button data-del="${m.id}" title="Delete">✕</button></li>`;
}
async function loadMeals(append = false) {
  const url = append && state.nextMeals ? state.nextMeals : `/v1/meals?date=${$('#date').value}&limit=5`;
  const page = await api(url);
  $('#meals').innerHTML = (append ? $('#meals').innerHTML : '') + page.data.map(mealRow).join('');
  if (!$('#meals').innerHTML) $('#meals').innerHTML = '<li><small>No meals logged for this date.</small></li>';
  state.nextMeals = page.page.next;
  $('#more-meals').hidden = !state.nextMeals;
}
$('#more-meals').addEventListener('click', () => loadMeals(true).catch((e) => say('#meal-msg', errText(e), true)));
$('#date').addEventListener('change', () => { loadSummary(); loadMeals(); });
$('#meals').addEventListener('click', async (ev) => {
  const id = ev.target.dataset.del;
  if (!id) return;
  try { await api(`/v1/meals/${id}`, { method: 'DELETE' }); await Promise.all([loadMeals(), loadSummary()]); } catch (e) { say('#meal-msg', errText(e), true); }
});
$('#meal-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = Object.fromEntries(new FormData(ev.target));
  try {
    await api('/v1/meals', {
      method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: { foodId: Number(f.foodId), servings: Number(f.servings), mealType: f.mealType, eatenOn: $('#date').value },
    });
    say('#meal-msg', 'Meal added.');
    await Promise.all([loadMeals(), loadSummary()]);
  } catch (e) { say('#meal-msg', errText(e), true); }
});

async function loadWeights() {
  const page = await api('/v1/weights?limit=5');
  $('#weights').innerHTML = page.data.map((w) => `<li><span>${w.weightKg} kg <small>${esc(w.loggedOn)}</small></span><button data-delw="${w.id}">✕</button></li>`).join('') || '<li><small>No entries yet.</small></li>';
}
$('#weights').addEventListener('click', async (ev) => {
  if (!ev.target.dataset.delw) return;
  await api(`/v1/weights/${ev.target.dataset.delw}`, { method: 'DELETE' }); loadWeights(); loadSummary();
});
$('#weight-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = Object.fromEntries(new FormData(ev.target));
  try {
    await api('/v1/weights', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { weightKg: Number(f.weightKg), loggedOn: $('#date').value } });
    ev.target.reset(); await Promise.all([loadWeights(), loadSummary()]);
  } catch (e) { alert(errText(e)); }
});

async function loadGoals() {
  const g = await api('/v1/goals');
  const form = $('#goal-form');
  form.dailyCalories.value = g.dailyCalories; form.dailyProteinG.value = g.dailyProteinG; form.targetWeightKg.value = g.targetWeightKg ?? '';
}
$('#goal-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = Object.fromEntries(new FormData(ev.target));
  const body = { dailyCalories: Number(f.dailyCalories), dailyProteinG: Number(f.dailyProteinG), targetWeightKg: f.targetWeightKg === '' ? null : Number(f.targetWeightKg) };
  try { await api('/v1/goals', { method: 'PUT', body }); say('#goal-msg', 'Goals saved.'); loadSummary(); } catch (e) { say('#goal-msg', errText(e), true); }
});

// ---------- web-services demos ----------
const show = (title, obj) => { $('#demo-out').textContent = `${title}\n\n${typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)}`; };
const hdrs = (res, names) => Object.fromEntries(names.map((n) => [n, res.headers.get(n)]).filter(([, v]) => v !== null));

const demos = {
  async xml() {
    const { res, text } = await api('/v1/foods?limit=2', { headers: { Accept: 'application/xml' }, raw: true });
    show(`HTTP ${res.status} ${res.headers.get('content-type')}`, text);
  },
  async etag() {
    const first = await fetch('/v1/foods?limit=3', { cache: 'no-store' });
    const etag = first.headers.get('ETag');
    const second = await fetch('/v1/foods?limit=3', { cache: 'no-store', headers: { 'If-None-Match': etag } });
    show('Conditional GET', { firstRequest: { status: first.status, ETag: etag, 'Cache-Control': first.headers.get('Cache-Control') }, secondRequest_with_If_None_Match: { status: second.status } });
  },
  async idem() {
    const key = crypto.randomUUID();
    const send = async () => {
      const { res, data } = await api('/v1/meals', { method: 'POST', headers: { 'Idempotency-Key': key }, body: { foodId: 1, servings: 1, mealType: 'snack', eatenOn: $('#date').value }, raw: true });
      return { status: res.status, replayed: res.headers.get('Idempotent-Replayed'), mealId: data.id };
    };
    const a = await send(); const b = await send();
    show(`Same Idempotency-Key sent twice: ${key}`, { first: a, second: b, note: 'Same meal id, second response is a replay - no duplicate row.' });
    loadMeals(); loadSummary();
  },
  async graphql() {
    const query = '{ foods(search: "dal", limit: 2) { id name calories proteinG } me { email role } dailySummary(date: "' + $('#date').value + '") { calories remainingCalories } }';
    const { res, data } = await api('/graphql', { method: 'POST', body: { query }, raw: true });
    show(`POST /graphql -> HTTP ${res.status}\n${query}`, data);
  },
  async soap() {
    const { res, data } = await api('/v1/external/soap/food-nutrition?name=Idli', { raw: true });
    show(`SOAP via WSDL -> HTTP ${res.status}`, data);
  },
  async retry() {
    const { res, data } = await api(`/v1/external/food-facts?mode=flaky&scenario=${crypto.randomUUID()}`, { raw: true });
    show(`Upstream fails twice, then succeeds -> HTTP ${res.status}`, { attemptsUsed: data.meta && data.meta.attempts, data });
  },
  async timeout() {
    const { res, data } = await api('/v1/external/food-facts?mode=slow', { raw: true });
    show(`Slow upstream -> HTTP ${res.status}`, data);
  },
  async breaker() {
    const lines = [];
    for (let i = 1; i <= 4; i++) {
      const { res, data } = await api('/v1/external/food-facts?mode=fail', { raw: true });
      lines.push(`call ${i}: HTTP ${res.status} ${data.error ? data.error.code : ''}`);
    }
    const state2 = await api('/v1/external/breaker');
    show('Repeated failures open the circuit (then 503 CIRCUIT_OPEN without calling upstream)', { calls: lines, breaker: state2.upstream });
  },
  async activity() {
    const a = await api('/v1/activity?limit=8');
    show('Activity events stored as NoSQL documents', a);
  },
};
$('#demo-buttons').addEventListener('click', async (ev) => {
  const name = ev.target.dataset.demo;
  if (!name) return;
  show('Running…', '');
  try { await demos[name](); } catch (e) { show('Error', errText(e)); }
});

// ---------- boot ----------
if (state.token) showApp().catch(logout);
