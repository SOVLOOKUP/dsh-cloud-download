# dsh-cloud-download

在 DSH 对话界面里直接下载文件：交付卡片、变更审查页、文档预览标题栏，都有下载按钮。不用 SFTP，不用回后台文件管理器。

面向 DSH 跑在远程主机、容器、NAS 或反向代理后面的场景——文件在 Host 上，浏览器在你手里。

## 覆盖范围

| 位置 | 增加的按钮 |
| --- | --- |
| 交付卡片（`present`） | 原生打开按钮旁边的下载图标 |
| 右侧栏变更审查 | 审查页标题栏的下载图标 |
| 文档预览标题栏 | 当前预览文件的下载图标 |
| 无法预览的空状态 | 带文字的「下载文件」按钮 |

![交付卡片上的下载按钮](assets/card.png)

按钮会显示自己的状态：**正在准备下载…**、**已开始下载**、**下载失败，点击重试**。失败时还会弹出服务端的 HTTP 状态码和原因，而不是浏览器那句笼统的「无法下载」。

## 为什么需要它

远程 DSH 的 Host 经常仍然暴露「显示文件位置 / 用文件管理器打开」这类原生动作。请求会成功，但文件管理器开在 Host 的桌面上，远程浏览器看不到；在 NAS 或云容器里，这个桌面可能只是没有观看者的 Xvfb。

插件做三件事：

- 增加一条真正走浏览器的下载链路；
- 默认隐藏这些点了没反应的原生打开按钮；
- 在真实桌面环境里，告诉你怎样恢复它们。

## 下载是怎么走的

1. 浏览器先向插件自己的鉴权路由发 `HEAD`，确认文件可读、Host 能流式返回。
2. 通过后交给浏览器下载管理器取附件，大文件直接落盘，不占页面内存。
3. 预检失败时再发一次 `GET`，把 Host 返回的错误文本显示在页内提示里。

交付卡片和审查页的下载请求只带官方卡片已有的坐标——Session、事件序号、文件下标。路径不出现在请求里，Host 从会话日志反查。

预览标题栏复用 DSH 内置的 `/api/file`，需要绝对路径，单文件上限约 20 MiB。更大的文件请从交付卡片或审查页下载。

## 无桌面 / 云环境清理

插件会隐藏文件级和目录级的原生打开控件（`[data-open-target]`）。如果你在真实桌面上使用，想恢复它们：

```js
localStorage.setItem('dsh-cloud-download:native-open', 'show')
location.reload()
```

再次隐藏：

```js
localStorage.removeItem('dsh-cloud-download:native-open')
location.reload()
```

## 安装

从这个仓库：

```sh
dsh plugin --profile web add github:SOVLOOKUP/dsh-cloud-download
```

npm 包计划使用同名发布；目前 GitHub 安装即可。

然后刷新浏览器页面。没有构建步骤，`index.js`、`client.js`、`cordis.patch.yml` 直接发布。

**需要提供上述四个按文件槽位的 DSH Web**（在 0.2.x 上开发）。宿主没有这些槽位时插件保持惰性，不会替换官方卡片。

## 边界

- 预览标题栏受 DSH `/api/file` 的约 20 MiB 限制。
- 只下载单个文件；不做上传、目录扫描或 ZIP 打包。
- 不绕过 DSH 的 Session / 文件系统鉴权。

## 相关插件

- [`dsh-save-button`](https://github.com/hanbernate/dsh-save-button)：交付卡片下载，带旧版 DSH 兼容层。
- [`dsh-file-transfer`](https://github.com/flyhigao/dsh-file-transfer)：预览工具栏和 Files 树的确认式下载/上传，含文件夹 ZIP。

本插件刻意更窄：一个下载动作覆盖卡片、变更审查、预览三处，外加无桌面原生控件清理。

## 开发检查

```sh
node --check index.js
node --check client.js
npm pack --dry-run
```

Host 半在 `/api/cloud.download` 注册一条鉴权路由；浏览器半注册四个增量槽位。不修改 DSH 核心包。

## License

MIT，见 [LICENSE](LICENSE)。
