# AI 证件照（前端）

上传一张照片 → 自动抠图、换底色、按标准尺寸裁切 → 输出标准照 / 高清照 / 六寸排版 / 透明底。

后端是 [HivisionIDPhotos](https://github.com/Zeyi-Lin/HivisionIDPhotos) 的推理核心，
跑在自己的服务器上；本仓库只放前端静态页。

## 部署位置

| 入口 | 地址 |
|---|---|
| GitHub Pages | https://hubiqi.github.io/idphoto-web/ |
| Cloudflare Pages | https://hubiqi-idphoto.pages.dev/ |

## API 地址是怎么找到的

前端不写死后端地址，按顺序解析（见 `app.js` 的 `resolveApi()`）：

1. URL 参数 `?api=https://...`
2. 同源 `/api/health`（前端由后端自己托管时走这条）
3. 本仓库的 `api.json` —— **服务器每次重启会把自己的隧道地址写进这个文件**
4. 浏览器 localStorage 里上次用过的地址

`api.json` 由服务器上的 `publish_api.sh` 通过 GitHub API 自动更新，
所以换地址不需要重新部署前端。

手动切换：页面底部「服务器：…」可以展开输入框，直接填一个后端地址。

## 本地预览

```sh
python3 -m http.server 8080
# 然后打开 http://localhost:8080/?api=http://<后端地址>:8099
```
