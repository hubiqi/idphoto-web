# AI 证件照 · 部署说明

后端跑在自己的服务器上（HivisionIDPhotos 推理核心），前端静态页托管在
GitHub Pages / Cloudflare Pages，后端 HTTPS 入口用 cloudflared 快速隧道。

## 访问入口

| 用途 | 地址 |
|---|---|
| 前端 · Cloudflare Pages | https://hubiqi-idphoto.pages.dev/ |
| 前端 · GitHub Pages | https://hubiqi.github.io/idphoto-web/ |
| 后端 · 直连（HTTP，同时托管前端） | http://158.178.244.142:8099/ |
| 后端 · HTTPS 隧道 | 见仓库 `api.json`，每次重启会自动更新 |

## 前端怎么找到后端（界面上不显示地址）

`app.js` 的 `resolveApi()` 按顺序静默解析，全部并行探测、谁先通用谁：

1. URL 参数 `?api=https://...`
2. 同源 `/api/health` —— 前端由后端自己托管时走这条
3. localStorage 上次成功的地址
4. 远程配置（后端每次换隧道地址都会重写它）：
   1. **GitHub Contents API** —— 直读仓库，CDN 只缓存 60s，允许跨域（首选）
   2. raw.githubusercontent —— 同一份文件，但 CDN 最多滞后 **5 分钟**
   3. GitHub Pages —— 约 1 分钟生效
   4. Cloudflare Pages —— 部署时的快照，最旧，纯兜底
5. 服务器原地址（`http://158.178.244.142:8099`）—— 隧道全挂时兜底；
   标准浏览器在 HTTPS 页面上会按「混合内容」拦掉，所以彻底连不上时
   页面会给一个**整页跳转**的「打开备用入口」按钮（导航不受混合内容限制）

隧道优先、原地址兜底：两者并行探测，所以兜底不额外增加等待时间，
但只要能走 HTTPS 就不会走明文。

## 服务器上的东西

| 位置 | 说明 |
|---|---|
| `/opt/idphoto/app/` | 后端代码（含 hivision 推理核心 + 前端静态文件） |
| `/opt/idphoto/models/` | 三个 ONNX 权重（约 160MB） |
| `/opt/idphoto/deploy/` | Dockerfile、部署脚本、隧道脚本、systemd 单元 |
| `/opt/idphoto/.github_token` | 自动更新前端仓库 api.json 用（chmod 600） |
| `/opt/idphoto/current_url` | 当前隧道地址 |

容器 `idphoto`（`--restart always`，:8099，healthy）
隧道 `idphoto-tunnel.service`（Restart=always；启动时发布地址，之后每 5 分钟自愈重发一次）

## 重新部署

```sh
# 1) 本机打包（务必用 pack.sh：它会排除本机 app/ 里的权重软链接）
sh /root/idphoto/pack.sh

# 2) 传到服务器
scp -o ControlMaster=no -o ControlPath=none /tmp/idphoto-app.tgz opc@<server>:/tmp/
ssh -o ControlMaster=no -o ControlPath=none opc@<server> \
  'rm -rf /opt/idphoto/app && tar xzf /tmp/idphoto-app.tgz -C /opt/idphoto && cd /opt/idphoto && sh deploy/remote_deploy.sh'
```

新增模型时：改 `deploy/fetch_models.sh` → 在服务器上跑一次 → 改 `deploy/Dockerfile` 的 COPY → `remote_deploy.sh`。

## 前端发布

```sh
cd /root/idphoto/web
export GH_TOKEN=...        # GitHub token
git add -A && git commit -m ... && git pull --rebase && git push
# 手机上 github.com 经常连不上，推不上去就改用 GitHub Contents API 直接写文件

export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...
wrangler pages deploy . --project-name=hubiqi-idphoto --branch=main --commit-dirty=true
```

## 踩过的坑（按重要性）

1. **本机 `app/` 里的权重是软链接**（指向 `/root/idphoto/models`，给手机端本地跑用）。
   直接打包上服务器会变成**悬空链接**；上一版镜像里 Docker 恰好「写穿」了软链接
   才没崩，属于碰运气。现在 `pack.sh` 排除两个权重目录，镜像里由 Dockerfile 放真文件。
2. **只下载了模型的一部分**：界面能选 `modnet_photographic_portrait_matting`，
   但服务器上没这个权重 → 推理时 `NoneType.copy()` 崩掉，还把 traceback 甩给了用户。
   现在 `/api/sizes` 会返回 `matting_models`（按权重文件是否存在过滤），
   前端下拉据此生成；后端也在推理前拦一道，给的是「没有权重文件，请改用 X、Y」。
3. **raw.githubusercontent 的 CDN 最多滞后 5 分钟**，`?t=` 参数绕不过去。
   换隧道地址后前端要等 5 分钟才跟上 → 改用 GitHub Contents API（缓存 60s，允许跨域）作首选源。
4. **musl/aarch64 装不了 onnxruntime**：手机端用 `shim/onnxruntime.py` 把推理转发给
   OpenCV DNN；服务器是 glibc，用官方 onnxruntime。同一个 `server.py` 两边都能跑。
5. **`mtcnn-runtime` 依赖完整版 opencv**：`pip install --no-deps`，cv2 由 headless 版提供。
6. **Pages 的 404 会回落成 index.html**：`index.html` 必须用相对路径 `app.js`；
   写绝对路径时脚本被当 HTML 解析，页面看着正常但点什么都没反应。
   后端则把静态站 `mount("/")` 挂在**所有 API 路由之后**。
7. **链路速度**：手机直连服务器下行 ~19KB/s（1.3MB 要 70s），走隧道 ~187KB/s。
   配合默认输出 JPEG、排版/透明底点击时再生成、上传前在浏览器里压缩，
   597KB 手机照片全程 6～13 秒。
8. **快速隧道地址会变**：`tunnel.sh` 启动时把新地址写进仓库 `api.json`（幂等，值没变不提交），
   并每 5 分钟自愈重发一次。
