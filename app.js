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
                bgName: '白色', data: {}, idx: 0, base: '' };

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
        state.upCache = null;
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
  state.upCache = null;
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

  const fd = await buildForm('standard,hd');

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
const TABS = [
  { k: 'standard', n: '标准照', ext: 'jpg' },
  { k: 'hd', n: '高清照', ext: 'jpg' },
  { k: 'layout', n: '六寸排版', ext: 'jpg' },
  { k: 'transparent', n: '透明底 PNG', ext: 'png' },
];

/* 手机直出照片动辄 3-8MB，直接上传要几十秒。先在浏览器里等比压到够用的尺寸：
 * 输出最大也就 2 倍目标尺寸，压过头不影响成品，能省掉 90% 的上传时间。
 * 顺带一个好处：canvas 会把 EXIF 旋转「烧」进像素，后端不会再遇到侧躺照片。 */
async function prepareUpload() {
  const target = Math.min(2400, Math.max(1000, Math.round(Math.max(state.size.h, state.size.w) * 2.2)));
  const key = `${state.file.name}|${state.file.size}|${target}`;
  if (state.upCache && state.upCache.key === key) return state.upCache.blob;

  const url = URL.createObjectURL(state.file);
  let img;
  try {
    img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('图片解码失败'));
      i.src = url;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const scale = Math.min(1, target / Math.max(w, h));
    let out = state.file;
    if (scale < 1 || state.file.size > 1.2e6) {
      const cw = Math.max(1, Math.round(w * scale));
      const chh = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = chh;
      canvas.getContext('2d').drawImage(img, 0, 0, cw, chh);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.88));
      if (blob) {
        out = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
        const before = (state.file.size / 1024).toFixed(0);
        const after = (out.size / 1024).toFixed(0);
        if (state.file.size - out.size > 200 * 1024) {
          toast(`已压缩上传：${before}KB → ${after}KB（${cw}×${chh}）`);
        }
      }
    }
    state.upCache = { key, blob: out };
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function buildForm(parts) {
  const fd = new FormData();
  fd.append('image', await prepareUpload());
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
  fd.append('parts', parts);
  return fd;
}

function render(d) {
  state.data = {};
  state.base = `${state.size.name}_${state.bgName}`;
  TABS.forEach(t => { if (d[t.k]) state.data[t.k] = d[t.k]; });
  state.idx = 0;
  paintTabs();
  $('#result').hidden = false;
  show();
  const ms = d.ms || {};
  $('#meta').textContent =
    `尺寸 ${state.size.w}×${state.size.h}px（300dpi）· 底色 ${state.bgName}` +
    (ms.infer ? ` · 推理 ${(ms.infer / 1000).toFixed(1)}s` : '');
  $('#result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function paintTabs() {
  const tabs = $('#tabs');
  tabs.innerHTML = '';
  TABS.forEach((t) => {
    const has = !!state.data[t.k];
    const b = document.createElement('button');
    b.className = 'tab';
    b.textContent = has ? t.n : t.n + ' +';
    b.title = has ? '' : '需要时再生成（省流量）';
    b.setAttribute('aria-pressed', state.idx === TABS.indexOf(t) ? 'true' : 'false');
    b.onclick = () => pick(TABS.indexOf(t));
    tabs.appendChild(b);
  });
}

async function pick(i) {
  const t = TABS[i];
  state.idx = i;
  if (!state.data[t.k]) {
    toast('正在生成' + t.n + '…');
    paintTabs();
    try {
      const r = await fetch(api('/api/generate'), { method: 'POST', body: await buildForm(t.k) });
      const d = await r.json();
      if (!d.status) throw new Error(d.message || '生成失败');
      if (d[t.k]) state.data[t.k] = d[t.k];
      else throw new Error('服务端没有返回' + t.n);
    } catch (e) {
      toast(e.message, true);
      state.idx = 0;
    }
  }
  paintTabs();
  show();
}

function show() {
  const t = TABS[state.idx];
  const data = state.data[t.k];
  if (!data) return;
  $('#out').src = data;
  $('#dl').href = data;
  $('#dl').download = `${state.base}_${t.n}.${t.ext}`;
}

function saveDataUrl(url, filename) {
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

$('#dlall').onclick = async () => {
  const keys = Object.keys(state.data);
  if (!keys.length) return toast('还没有结果', true);
  for (const t of TABS) {
    if (state.data[t.k]) continue;
    await pick(TABS.indexOf(t));
  }
  TABS.forEach((t, i) => {
    if (state.data[t.k]) setTimeout(() => saveDataUrl(state.data[t.k], `${state.base}_${t.n}.${t.ext}`), i * 400);
  });
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
