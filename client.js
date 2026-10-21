window.__ModuleLoader__.load({
    id: 'dsh-cloud-download',
    factory(require) {
        const React = require('react');
        const h = React.createElement;
        const NS = 'cloud-download';
        const NATIVE_KEY = 'dsh-cloud-download:native-open';
        const zh = {
            'download.label': '下载文件',
            'download.checking': '正在准备下载…',
            'download.started': '已开始下载',
            'download.retry': '下载失败，点击重试',
            'download.failed': '下载失败（HTTP {status}）：{detail}',
            'download.error': '下载失败：{detail}',
        };
        const en = {
            'download.label': 'Download file',
            'download.checking': 'Preparing download…',
            'download.started': 'Download started',
            'download.retry': 'Download failed. Click to retry.',
            'download.failed': 'Download failed (HTTP {status}): {detail}',
            'download.error': 'Download failed: {detail}',
        };
        const CSS = `
.fd-download-button {
  box-sizing: border-box;
  display: inline-flex;
  width: 24px;
  height: 24px;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.fd-download-button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.fd-download-button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
.fd-download-button:active {
  opacity: 0.7;
}
.fd-download-button[data-phase="checking"] {
  cursor: progress;
  opacity: 0.6;
}
.fd-download-button[data-phase="failed"] {
  color: var(--dsw-alias-state-error-primary, #c62828);
}
.fd-download-button[data-phase="started"] {
  color: var(--dsw-alias-state-success-primary, #2e7d32);
}
.fd-download-empty {
  box-sizing: border-box;
  display: inline-flex;
  height: 30px;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border: .5px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
.fd-download-empty:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.fd-download-empty:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
.fd-download-empty[data-phase="checking"] {
  cursor: progress;
  opacity: 0.6;
}
.fd-download-empty[data-phase="failed"] {
  color: var(--dsw-alias-state-error-primary, #c62828);
}
.fd-download-empty[data-phase="started"] {
  color: var(--dsw-alias-state-success-primary, #2e7d32);
}
.fd-spinner {
  box-sizing: border-box;
  display: block;
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: fd-spin .8s linear infinite;
}
@keyframes fd-spin {
  to { transform: rotate(360deg); }
}
.fd-download-toast {
  position: fixed;
  z-index: 9999;
  left: 50%;
  bottom: 24px;
  box-sizing: border-box;
  max-width: min(560px, calc(100vw - 32px));
  transform: translateX(-50%);
  padding: 10px 14px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-elevated, #202124);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
  color: #fff;
  font-size: 13px;
  line-height: 20px;
  overflow-wrap: anywhere;
}
/*
 * Some Hosts (containers, NAS boxes, CI workers) set DISPLAY through Xvfb,
 * so the Host reports a desktop even though no file manager is visible to
 * the remote browser. Hide the native open/reveal controls; set localStorage
 * "dsh-cloud-download:native-open" to "show" on a real desktop to bring them
 * back.
 */
html:not(.fd-native-open) [data-open-target] {
  display: none !important;
}
`;
        function downloadIcon() {
            return h('svg', {
                viewBox: '0 0 16 16',
                width: 14,
                height: 14,
                fill: 'none',
                'aria-hidden': 'true',
                focusable: 'false',
            }, h('path', {
                d: 'M8 2.2v6.6M5.2 6.2 8 9l2.8-2.8M2.7 10.7v2.1h10.6v-2.1',
                stroke: 'currentColor',
                strokeWidth: 1.3,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
            }));
        }
        function checkIcon() {
            return h('svg', {
                viewBox: '0 0 16 16',
                width: 14,
                height: 14,
                fill: 'none',
                'aria-hidden': 'true',
                focusable: 'false',
            }, h('path', {
                d: 'm3.2 8.3 2.9 2.9 6.7-6.7',
                stroke: 'currentColor',
                strokeWidth: 1.5,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
            }));
        }
        /** Extract the server's suggested name without trusting the whole header. */
        function filenameOf(disposition) {
            if (typeof disposition !== 'string')
                return undefined;
            const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
            if (encoded !== null) {
                try {
                    return decodeURIComponent(encoded[1] ?? '');
                }
                catch {
                    // Fall through to the plain parameter.
                }
            }
            const plain = /filename="([^"]*)"/i.exec(disposition) ?? /filename=([^;]+)/i.exec(disposition);
            return plain?.[1]?.trim() || undefined;
        }
        let toastEl;
        /** A short-lived, non-blocking error surface for a failed download. */
        function toast(message) {
            if (toastEl !== undefined)
                toastEl.remove();
            const tag = document.createElement('div');
            tag.className = 'fd-download-toast';
            tag.setAttribute('role', 'alert');
            tag.textContent = message;
            document.body.appendChild(tag);
            toastEl = tag;
            setTimeout(() => {
                tag.remove();
                if (toastEl === tag)
                    toastEl = undefined;
            }, 7000);
        }
        /** Read just enough of an error response to explain it, then stop. */
        async function readSnippet(response, limit = 300) {
            if (!response.body)
                return '';
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let text = '';
            try {
                while (text.length < limit) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    if (value !== undefined)
                        text += decoder.decode(value, { stream: true });
                }
            }
            finally {
                await reader.cancel().catch(() => { });
            }
            return text.trim().slice(0, limit);
        }
        /**
         * Probe with HEAD first. A successful probe lets the browser's download
         * manager stream the file straight to disk, so the page never buffers a
         * large file in memory. A failed probe is followed by one GET so the
         * server's own reason can be shown instead of the browser's opaque
         * "download failed" message.
         */
        async function probe(href) {
            let response;
            try {
                response = await fetch(href, {
                    method: 'HEAD',
                    credentials: 'same-origin',
                    headers: { Accept: '*/*' },
                });
            }
            catch (error) {
                return {
                    ok: false,
                    detail: error instanceof Error ? error.message : String(error),
                };
            }
            if (response.ok) {
                const filename = filenameOf(response.headers.get('Content-Disposition'));
                return filename === undefined ? { ok: true } : { ok: true, filename };
            }
            if (response.status === 405 || response.status === 501) {
                // The route does not implement HEAD; let the browser do a plain GET.
                return { ok: true };
            }
            let detail = '';
            try {
                const get = await fetch(href, {
                    credentials: 'same-origin',
                    headers: { Accept: '*/*' },
                });
                if (get.ok) {
                    await get.body?.cancel().catch(() => { });
                    const filename = filenameOf(get.headers.get('Content-Disposition'));
                    return filename === undefined ? { ok: true } : { ok: true, filename };
                }
                detail = await readSnippet(get);
            }
            catch {
                // The HEAD status is still useful without the body.
            }
            return { ok: false, status: response.status, detail };
        }
        /** Hand one same-origin URL to the browser's own download manager. */
        function saveUrl(href, filename) {
            const anchor = document.createElement('a');
            anchor.href = href;
            if (filename)
                anchor.download = filename;
            anchor.rel = 'noopener';
            anchor.style.display = 'none';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
        }
        async function download(href, filename, t, onPhase) {
            if (typeof href !== 'string' || href.length === 0)
                return;
            onPhase('checking');
            const result = await probe(href);
            if (!result.ok) {
                toast(result.status !== undefined
                    ? t('download.failed', {
                        status: result.status,
                        detail: result.detail ? ` ${result.detail}` : '',
                    })
                    : t('download.error', { detail: result.detail || 'Network error' }));
                onPhase('failed');
                return;
            }
            try {
                /*
                 * Prefer the name the server computed (the card/review route sends an
                 * RFC 5987 Content-Disposition); the preview route has no header, so
                 * the caller passes the basename it already knows.
                 */
                saveUrl(href, filename ?? result.filename);
                onPhase('started');
            }
            catch (error) {
                toast(t('download.error', {
                    detail: error instanceof Error ? error.message : String(error),
                }));
                onPhase('failed');
            }
        }
        function usePhase() {
            const [phase, setPhase] = React.useState(undefined);
            const timer = React.useRef(undefined);
            React.useEffect(() => () => clearTimeout(timer.current), []);
            const update = React.useCallback((next) => {
                clearTimeout(timer.current);
                setPhase(next);
                if (next === 'started') {
                    timer.current = setTimeout(() => setPhase(undefined), 2400);
                }
            }, []);
            return [phase, update];
        }
        const PHASE_KEYS = {
            checking: 'download.checking',
            started: 'download.started',
            failed: 'download.retry',
        };
        function phaseText(phase, t) {
            return phase !== undefined && PHASE_KEYS[phase] !== undefined
                ? t(PHASE_KEYS[phase])
                : t('download.label');
        }
        function DownloadGlyph({ phase }) {
            if (phase === 'checking')
                return h('span', { className: 'fd-spinner', 'aria-hidden': 'true' });
            if (phase === 'started')
                return checkIcon();
            return downloadIcon();
        }
        function basename(path) {
            const parts = path.split(/[\\/]/);
            return parts[parts.length - 1] || 'download';
        }
        /**
         * Turn the card's existing native-open coordinates into the Host download
         * route. The card already carries Session, event sequence, and file index,
         * so no path or extra capability crosses the wire.
         */
        function downloadRoute(actionUrl) {
            let source;
            try {
                source = new URL(actionUrl, window.location.href);
            }
            catch {
                return undefined;
            }
            const sessionId = source.searchParams.get('sessionId');
            const seq = source.searchParams.get('seq');
            const index = source.searchParams.get('index');
            if (!sessionId || !seq || !index)
                return undefined;
            const kind = source.pathname.endsWith('changes.open') ? 'changes' : 'present';
            const query = new URLSearchParams({ sessionId, seq, index, kind });
            return `api/cloud.download?${query.toString()}`;
        }
        function fallbackTranslate(key) {
            return key;
        }
        /**
         * The labeled variant used by the unsupported-preview empty state, where an
         * icon alone has no surrounding toolbar to sit in.
         */
        function DownloadEmptyAction(props) {
            const t = typeof props.t === 'function' ? props.t : fallbackTranslate;
            const path = props.absolutePath;
            const [phase, setPhase] = usePhase();
            if (typeof path !== 'string' || path.length === 0)
                return null;
            const label = phaseText(phase, t);
            return h('button', {
                type: 'button',
                className: 'fd-download-empty',
                title: label,
                'aria-label': label,
                'aria-busy': phase === 'checking' ? 'true' : undefined,
                'data-file-download': '',
                'data-phase': phase,
                disabled: phase === 'checking',
                onClick: (event) => {
                    event.stopPropagation();
                    void download(`api/file?path=${encodeURIComponent(path)}`, basename(path), t, setPhase);
                },
            }, h(DownloadGlyph, { phase }), h('span', null, label));
        }
        /** The compact icon action shown beside the native open control on a card. */
        function DownloadAction(props) {
            const t = typeof props.t === 'function' ? props.t : fallbackTranslate;
            const actionUrl = props.actionUrl;
            const [phase, setPhase] = usePhase();
            if (typeof actionUrl !== 'string')
                return null;
            const route = downloadRoute(actionUrl);
            if (route === undefined)
                return null;
            const label = phaseText(phase, t);
            return h('button', {
                type: 'button',
                className: 'fd-download-button',
                title: label,
                'aria-label': label,
                'aria-busy': phase === 'checking' ? 'true' : undefined,
                'data-file-download': '',
                'data-phase': phase,
                disabled: phase === 'checking',
                onClick: (event) => {
                    event.stopPropagation();
                    void download(route, undefined, t, setPhase);
                },
            }, h(DownloadGlyph, { phase }));
        }
        /**
         * Download any file whose Host path the right Sidebar already knows. This
         * covers files outside the delivery/review cards, including binary formats
         * the preview cannot render.
         */
        function AbsoluteDownloadAction(props) {
            const t = typeof props.t === 'function' ? props.t : fallbackTranslate;
            const path = props.absolutePath;
            const [phase, setPhase] = usePhase();
            if (typeof path !== 'string' || path.length === 0)
                return null;
            const label = phaseText(phase, t);
            return h('button', {
                type: 'button',
                className: 'fd-download-button',
                title: label,
                'aria-label': label,
                'aria-busy': phase === 'checking' ? 'true' : undefined,
                'data-file-download': '',
                'data-phase': phase,
                disabled: phase === 'checking',
                onClick: (event) => {
                    event.stopPropagation();
                    void download(`api/file?path=${encodeURIComponent(path)}`, basename(path), t, setPhase);
                },
            }, h(DownloadGlyph, { phase }));
        }
        function applyNativePreference() {
            let show = false;
            try {
                show = window.localStorage.getItem(NATIVE_KEY) === 'show';
            }
            catch {
                // Private mode or a blocked storage API keeps the default (hidden).
            }
            document.documentElement.classList.toggle('fd-native-open', show);
        }
        return {
            inject: ['slots', 'locale'],
            apply(ctx) {
                ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'cloud-download: dictionaries');
                ctx.effect(() => {
                    const tag = document.createElement('style');
                    tag.dataset.plugin = 'dsh-cloud-download';
                    tag.textContent = CSS;
                    document.head.appendChild(tag);
                    return () => tag.remove();
                }, 'cloud-download: styles');
                ctx.effect(() => {
                    applyNativePreference();
                    const onStorage = (event) => {
                        if (event.key === NATIVE_KEY || event.key === null)
                            applyNativePreference();
                    };
                    window.addEventListener('storage', onStorage);
                    return () => window.removeEventListener('storage', onStorage);
                }, 'cloud-download: native preference');
                const register = (name, component) => {
                    ctx.slots.inject(name, () => ctx.slots.register({
                        name,
                        id: 'cloud-download',
                        order: 20,
                        locale: NS,
                    }, component));
                };
                register('deliverables.file.actions', DownloadAction);
                register('deliverables.review.file.actions', DownloadAction);
                register('sidebar.right.tab.document.actions', AbsoluteDownloadAction);
                register('sidebar.right.tab.document.unpreviewable', DownloadEmptyAction);
            },
        };
    },
});
export {};
