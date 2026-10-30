# KotobaFlow Web 源码

KotobaFlow（词基流动）是本地优先的日语学习工具，提供词汇、语法、教材阅读、间隔复习、完整存档导入导出和 PWA。网页采用普通 HTML、CSS 和 JavaScript，公开站为静态部署，学习记录保存在本机。

[网站](https://kotobaflow.lol) · [Android 0.4.2 正式版下载（约 827 MB）](https://download.kotobaflow.lol/android/kotobaflow-0.4.2-public-8d85707591da.apk)

Android 最低要求为 Android 7.0。下载的是完整 APK，包含 KotobaFlow 四册、77 课与古典拓展阅读，应用保持离线使用。已安装开发签名测试版时，请先导出学习存档，再卸载旧版、安装正式版。

APK：`0.4.2-public` / versionCode `3`，826,752,298 bytes。

SHA-256：`8d85707591da836322374984626307856c6aed47922d68890a337a885e6338e9`。

[Android 源码](https://github.com/greyindex/kotobaflow-android)

## 版本与公开范围

本次程序源码来自网页版 `cef1c7ff99f4ab7989c70b58eca261a6bc866d9d`（2026-10-31），包含已上线的 Android 下载入口及 FIX-44～47。原开发仓库继续私有，这里从新的提交历史开始维护公开源码。

课程与词库 JSON、生成音频、教材插图、古典资料、截图和视觉基线均不随仓库分发，原因与第三方声明见 [公开范围检查](PUBLICATION.md)。源码中的资源路径与加载契约保留，克隆后不会自动取得这些内容，也不能直接生成完整站点。可使用上方网站或 APK 体验成品。

## 源码导航

| 路径 | 职责 |
| --- | --- |
| `index.html`、`style.css`、`js/` | 界面、学习会话、内容读取、书页、存档、音频与显示偏好 |
| `js/core/book-pager.js` | 词卡、语法与课文共用翻页排版 |
| `js/storage.js`、`js/progress-store.js` | 本机状态、恢复日志与本地进度协议 |
| `serve.py` | 本地静态服务与进度 API |
| `tools/`、`tests/` | 构建、数据契约和浏览器回归代码；未附课程数据与截图基线 |
| `resources/licenses/` | 第三方声明与原公开资源策略 |

`index.html` 的脚本顺序即依赖顺序，项目没有打包器。不要为修资源路径改写其加载顺序。

## 安装与验证

开发环境为 Node.js 24、Python 3 和 Windows。可以安装代码依赖并验证公开源码清单：

```powershell
npm ci
python scripts/check-public-source.py
```

完整运行、`npm run check`、视觉回归和 `release:build` 需要另行取得有权使用的内容资源，并放回原路径；这些检查未在缺少数据的公开仓库中宣称通过。原完整环境的最近一次验收为静态门禁和 600 项浏览器覆盖，不能替代修改后的验收。

网页与 Android 已独立发展，两个仓库的网页源码不要求逐字相同。

## 许可

项目保留原有 `UNLICENSED` 状态，没有在本次公开时新增开源许可。第三方部分的许可和署名继续有效，详见 [公开范围检查](PUBLICATION.md)。
