# dsh-cloud-download

Download files that DeepSeek Harness delivers or previews **straight from the conversation** — no SFTP, no backend file manager, no detour to the NAS.

Built for DSH running on a remote host, in a container, on a NAS, or behind a reverse proxy, where the browser is on your machine but the files are on the Host.

## What you get

| Where | What it adds |
| --- | --- |
| Delivery card (`present`) | A download icon next to the native open control |
| Changed-files review (right sidebar) | A download icon in the review header |
| Document preview header | A download icon for the file being previewed |
| Unsupported-preview empty state | A labeled “Download file” button |

The download icons show their own state: **Preparing download…**, **Download started**, or **Download failed. Click to retry.** A failed request also shows the server's HTTP status and reason in a short toast, instead of the browser's generic “download failed” message.

## Why this plugin exists

A remote DSH Host often exposes the native “show file location” / “open in file manager” actions. They report success, but the file manager opens on the Host's desktop — which the remote browser cannot see. On a NAS or cloud container that desktop may be Xvfb, a display with no viewer at all.

This plugin:

- adds a real browser download path that works over the network;
- hides those dead native open controls by default;
- documents how to restore them on a real desktop.

## How the download works

1. The browser sends a `HEAD` request to the plugin's authenticated route. A successful probe means the file is readable and the Host can stream it.
2. The browser's own download manager then fetches the attachment URL, so even a large file streams to disk instead of being buffered in page memory.
3. A failed probe is followed by one `GET` so the Host's error text can be shown in the toast.

Delivery and review downloads carry only the coordinates the official card already has — Session, durable event sequence, and file index. No path or extra capability crosses the wire; the Host resolves the path from the Session log.

The preview header reuses DSH's built-in `/api/file` route, which needs an absolute Host path and caps a single file at roughly 20 MiB. For larger files, download from the delivery card or the review page.

## Headless / cloud cleanup

The plugin hides file- and directory-level native open controls (`[data-open-target]`). On a real desktop where those controls do work, restore them once:

```js
localStorage.setItem('dsh-cloud-download:native-open', 'show')
location.reload()
```

To hide them again:

```js
localStorage.removeItem('dsh-cloud-download:native-open')
location.reload()
```

## Install

From npm:

```sh
dsh plugin --profile web add dsh-cloud-download
```

From this repository:

```sh
dsh plugin --profile web add github:SOVLOOKUP/dsh-cloud-download
```

Then reload the browser page. No build step: `index.js`, `client.js`, and `cordis.patch.yml` ship as-is.

**Requires DSH Web 0.1.7 or newer** (the per-file action slots). On a Host without those slots the plugin stays inert rather than replacing the official card.

## Limits

- The preview route is limited by DSH's `/api/file` (~20 MiB).
- This plugin downloads single files. It does not upload, scan folders, or build ZIP archives.
- It does not bypass DSH's session/filesystem authorization.

## Related plugins

- [`dsh-save-button`](https://github.com/hanbernate/dsh-save-button) — download from delivery cards, with a compatibility layer for older DSH lines.
- [`dsh-file-transfer`](https://github.com/flyhigao/dsh-file-transfer) — confirmed download/upload in the preview toolbar and Files tree, including folder ZIP.

This plugin is intentionally narrower: one download action across the card, the changed-files review, and the preview, plus the headless native-control cleanup.

## Development

```sh
node --check index.js
node --check client.js
npm pack --dry-run
```

The Host half registers one authenticated route at `/api/cloud.download`; the browser half registers four additive slots. No DSH core package is patched.

## License

MIT. See [LICENSE](LICENSE).
