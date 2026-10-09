/* AI 证件照 前端逻辑
 *
 * 前端可能被托管在与后端不同的域名上（GitHub Pages / Cloudflare Pages），
 * 所以 API 基址按以下顺序解析：
 *   1. URL 上的 ?api=https://xxx   （并记住到 localStorage）
 *   2. 同源 /api/health 探测（前端由后端自己托管时走这条）
 *   3. 远程配置（后端每次重启会把 cloudflared 隧道地址写进这个文件）
 *   4. localStorage 里上一次用过的地址
 */
const $ = (s) => document.querySelector(s);
const CONFIG_URL = 'https://raw.githubusercontent.com/hubiqi/idphoto-web/main/api.json';
let API = '';

const state = { file: null, size: { name: '一寸', h: 413, w: 295 }, bg: 'ffffff',
                bgName: '白色', results: [], idx: 0 };

const toast = (msg, isErr) => {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = 'toast'; }, isErr ? 5000 : 2200);
};

const api = (p) => API.replace(/\/$/, '') + p;
const norm = (u) => (u || '').trim().replace(/\/+$/, '');

/* ---------- API 基址解析 ---------- */
async function probe(base) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(base + '/api/health', { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) return false;
    const d = await r.json();
    return d && d.ok ? d : false;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function setApi(base, silent) {
  API = norm(base);
  try { localStorage.setItem('idphoto_api', API); } catch (e) {}
  $('#apiBase').value = API;
  $('.note-api').textContent = API || '（同源）';
  if (!silent) toast('已连接服务器：' + (API || location.origin));
}

async function resolveApi() {
  const q = new URLSearchParams(location.search).get('api');
  if (q) {
    API = norm(q);
    const h = await probe(API);
    if (h) { setApi(API); applyHealth(h); return; }
    toast('指定的 API 地址不可用，继续自动查找…', true);
  }
  // 1) 同源
  let h = await probe('');
  if (h) { setApi(''); applyHealth(h); return; }
  // 2) 远程配置
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(CONFIG_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) {
        const cfg = await r.json();
        if (cfg && cfg.api) {
          const base = norm(cfg.api);
          const hh = await probe(base);
          if (hh) { setApi(base); applyHealth(hh); return; }
        }
      }
    } catch (e) { /* 忽略，走兜底 */ }
    if (i === 0) await new Promise(s => setTimeout(s, 1200));
  }
  // 3) 上次用过的
  let last = '';
  try { last = localStorage.getItem('idphoto_api') || ''; } catch (e) {}
  if (last) {
    const hh = await probe(last);
    if (hh) { setApi(last); applyHealth(hh); return; }
  }
  toast('暂时连不上证件照服务，稍后可点右上角「服务器」重试', true);
  $('.note-api').textContent = '未连接';
}

function applyHealth(h) {
  if (h && h.models_ready === false && h.models_error) {
    toast('模型加载异常：' + h.models_error, true);
  }
}

/* ---------- 尺寸 / 底色 ---------- */
async function loadMeta() {
  try {
    const r = await fetch(api('/api/sizes'), { cache: 'no-store' });
    const d = await r.json();
    const box = $('#sizes');
    box.innerHTML = '';
    d.sizes.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = s.name;
      b.title = `${s.w}×${s.h}px`;
      b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
      b.onclick = () => {
        state.size = s;
        [...box.children].forEach(c => c.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true');
        $('#cw').value = ''; $('#ch').value = '';
      };
      box.appendChild(b);
    });
    const cbox = $('#colors');
    cbox.innerHTML = '';
    d.colors.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'chip col';
      b.setAttribute('aria-pressed', i === 1 ? 'true' : 'false');
      b.innerHTML = `<span class="swatch" style="background:#${c.hex}"></span> ${c.name}`;
      b.onclick = () => {
        state.bg = c.hex; state.bgName = c.name;
        [...cbox.children].forEach(c2 => c2.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true');
      };
      cbox.appendChild(b);
    });
    state.bg = d.colors[1].hex; state.bgName = d.colors[1].name;
  } catch (e) {
    toast('尺寸表加载失败：' + e.message, true);
  }
}

/* ---------- 上传 ---------- */
function readFile(f) {
  if (!f) return;
  if (!f.type.startsWith('image/')) return toast('请选择图片文件', true);
  state.file = f;
  const img = $('#preview');
  img.src = URL.createObjectURL(f);
  img.style.display = 'block';
  $('#hint').style.display = 'none';
  $('#uploader').style.background = '#fff';
  $('#go').disabled = false;
  $('#result').hidden = true;
}
$('#uploader').onclick = () => $('#file').click();
$('#file').onchange = (e) => readFile(e.target.files[0]);
['dragover', 'drop'].forEach(ev => $('#uploader').addEventListener(ev, (e) => {
  e.preventDefault();
  if (ev === 'drop') readFile(e.dataTransfer.files[0]);
}));

/* ---------- 滑块显示 ---------- */
['whitening', 'brightness', 'contrast', 'saturation', 'sharpen'].forEach(id => {
  const el = $('#' + id);
  el.oninput = () => { $('#v-' + id).textContent = el.value; };
});

/* ---------- 生成 ---------- */
$('#useCustom').onclick = () => {
  const w = parseInt($('#cw').value, 10), h = parseInt($('#ch').value, 10);
  if (!w || !h || w < 60 || h < 60 || w > 3000 || h > 3000) return toast('请输入合理的宽高（60~3000px）', true);
  state.size = { name: `自定义${w}×${h}`, w, h };
  [...$('#sizes').children].forEach(c => c.setAttribute('aria-pressed', 'false'));
  toast(`已选自定义尺寸 ${w}×${h}`);
};

$('#go').onclick = async () => {
  if (!state.file) return toast('请先上传照片', true);
  const btn = $('#go');
  const t0 = Date.now();
  let tick = setInterval(() => {
    btn.innerHTML = `<span class="spin"></span>正在生成 ${((Date.now() - t0) / 1000).toFixed(0)}s`;
  }, 1000);
  btn.disabled = true; btn.classList.add('busy');
  btn.innerHTML = '<span class="spin"></span>正在生成…';

  const fd = new FormData();
  fd.append('image', state.file);
  fd.append('h', state.size.h);
  fd.append('w', state.size.w);
  fd.append('bg', state.bg);
  fd.append('face_align', $('#align').checked ? 1 : 0);
  fd.append('whitening', $('#whitening').value);
  fd.append('brightness', $('#brightness').value);
  fd.append('contrast', $('#contrast').value);
  fd.append('saturation', $('#saturation').value);
  fd.append('sharpen', $('#sharpen').value);
  fd.append('matting_model', $('#matting').value);

  try {
    const r = await fetch(api('/api/generate'), { method: 'POST', body: fd });
    const d = await r.json();
    if (!d.status) throw new Error(d.message || '生成失败');
    render(d);
    toast(`完成，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    toast(e.message, true);
  } finally {
    clearInterval(tick);
    btn.disabled = false; btn.classList.remove('busy');
    btn.textContent = '重新生成';
  }
};

/* ---------- 结果 ---------- */
function render(d) {
  const base = `${state.size.name}_${state.bgName}`;
  const items = [{ k: 'standard', n: '标准照' }];
  if (d.hd) items.push({ k: 'hd', n: '高清照' });
  if (d.layout) items.push({ k: 'layout', n: '六寸排版' });
  if (d.transparent) items.push({ k: 'transparent', n: '透明底 PNG' });
  state.results = items.filter(i => d[i.k]).map(i => ({ ...i, data: d[i.k], base }));
  state.idx = 0;

  const tabs = $('#tabs');
  tabs.innerHTML = '';
  state.results.forEach((it, i) => {
    const b = document.createElement('button');
    b.className = 'tab';
    b.textContent = it.n;
    b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
    b.onclick = () => { state.idx = i; show(); };
    tabs.appendChild(b);
  });
  $('#result').hidden = false;
  show();
  const ms = d.ms || {};
  $('#meta').textContent =
    `尺寸 ${state.size.w}×${state.size.h}px（300dpi）· 底色 ${state.bgName} · 推理 ${(ms.infer || 0) / 1000}s`;
  $('#result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function show() {
  const it = state.results[state.idx];
  if (!it) return;
  $('#out').src = it.data;
  [...$('#tabs').children].forEach((c, i) => c.setAttribute('aria-pressed', i === state.idx ? 'true' : 'false'));
  $('#dl').href = it.data;
  $('#dl').download = `${it.base}_${it.n}.png`;
}

function saveDataUrl(url, filename) {
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

$('#dlall').onclick = () => {
  if (!state.results.length) return toast('还没有结果', true);
  state.results.forEach((it, i) => setTimeout(() => saveDataUrl(it.data, `${it.base}_${it.n}.png`), i * 400));
  toast('正在保存全部图片');
};

/* ---------- 启动 ---------- */
(async () => {
  await resolveApi();
  loadMeta();
})();

/* 服务器地址手动设置 */
$('#apiSet').onclick = async () => {
  const v = norm($('#apiBase').value);
  if ($('#apiBase').value.trim() && !v.startsWith('http')) return toast('请输入 http(s):// 开头的地址', true);
  const h = await probe(v);
  if (!h) return toast('这个地址连不上', true);
  setApi(v);
  applyHealth(h);
  loadMeta();
};
$('.note-api') && ($('.note-api').onclick = (e) => { e.preventDefault(); $('#apiRow').hidden = !$('#apiRow').hidden; });
