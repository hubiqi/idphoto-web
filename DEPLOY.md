# AI 证件照 · 部署说明

后端跑在自己的服务器上（HivisionIDPhotos 推理核心），前端静态页托管在
GitHub Pages / Cloudflare Pages，后端 HTTPS 入口用 cloudflared 快速隧道。

## 访问入口

| 用途 | 地址 |
|---|---|
| 前端 · Cloudflare Pages | https://hubiqi-idphoto.pages.dev/ |
| 前端 · GitHub Pages | https://hubiqi.github.io/idphoto-web/ |
| 后端 · 直连（HTTP） | http://158.178.244.142:8099/ |
| 后端 · HTTPS 隧道 | 见仓库 `api.json`（每次重启会自动更新） |
| 后端 · 同源前端 | http://158.178.244.142:8099/ （前端+后端同一进程） |

> HTTPS 页面不能调用 HTTP 接口（混合内容会被浏览器拦掉），
> 所以 Pages 上的前端必须走隧道那个 HTTPS 地址。

## 服务器上的东西

| 位置 | 说明 |
|---|---|
| `/opt/idphoto/app/` | 后端代码（含 hivision 推理核心 + 前端静态文件） |
| `/opt/idphoto/models/` | 两个 ONNX 模型（约 135MB），已烘焙进镜像 |
| `/opt/idphoto/deploy/` | Dockerfile、部署脚本、隧道脚本、systemd 单元 |
| `/opt/idphoto/.github_token` | 用于自动更新前端仓库的 api.json（chmod 600） |
| `/opt/idphoto/current_url` | 当前隧道地址 |

容器：`idphoto`（`--restart always`，端口 8099，healthy）
隧道：`systemctl status idphoto-tunnel`（Restart=always）

## 重新部署

```sh
# 服务器上（代码已在 /opt/idphoto）
cd /opt/idphoto && sh deploy/remote_deploy.sh

# 从本机推代码
tar czf /tmp/app.tgz app && scp /tmp/app.tgz opc@<server>:/tmp/
ssh opc@<server> 'rm -rf /opt/idphoto/app && tar xzf /tmp/app.tgz -C /opt/idphoto && cd /opt/idphoto && sh deploy/remote_deploy.sh'
```

## 前端发布

```sh
cd web
export GH_TOKEN=...            # GitHub token
git add -A && git commit -m ... && git pull --rebase && git push

export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...
wrangler pages deploy . --project-name=hubiqi-idphoto --branch=main --commit-dirty=true
```

## 关键技术点（踩过的坑）

1. **musl/aarch64 没有 onnxruntime wheel** —— 手机端（PRoot）用
   `shim/onnxruntime.py` 把推理转发给 OpenCV DNN；服务器是 glibc，用官方 onnxruntime。
   同一个 `server.py` 两种环境都能跑（有 shim 目录就走 shim）。
2. **`mtcnn-runtime` 依赖完整版 opencv** —— 用 `pip install --no-deps`，
   cv2 由 `opencv-python-headless` 提供。
3. **Pages 上的 404 会回落成 index.html** —— 所以 `index.html` 必须用
   *相对路径* `app.js`；写 `/static/app.js` 时会静默拿到一个 HTML 当 JS 执行，
   页面看起来「加载了但什么都没发生」。
4. **下行链路是瓶颈** —— 手机直连服务器只有 ~19KB/s，走 Cloudflare 隧道 ~187KB/s（快 10 倍）。
   另外默认输出 JPEG（PNG 换成 JPEG 让首图从 1.3MB 降到 105KB），
   排版/透明底改成点击时再生成。
5. **上传也要省** —— 手机直出照片几 MB，上传要几十秒；
   前端先用 canvas 等比压到「目标尺寸 ×2.2」（上限 2400px）再传，顺带把 EXIF 旋转烧进像素。
6. **快速隧道地址会变** —— `tunnel.sh` 每次启动都会把新地址通过 GitHub API
   写进仓库的 `api.json`，前端启动时读它，所以换地址不用重新部署前端。
