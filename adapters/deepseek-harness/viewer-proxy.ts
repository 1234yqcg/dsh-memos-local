/**
 * Mount the memos-local Memory Viewer onto the host DSH web server at the
 * `/memos` prefix, so the same external (HTTPS) entrance used for DSH also
 * reaches the loopback-only viewer — no extra port mapping, no Mixed-Content.
 *
 * Routing:  browser /memos/xxx  -> viewer /xxx ; /memos/api/v1/xxx -> /api/v1/xxx
 */
import { request, type IncomingMessage, type ServerResponse, type ClientRequest } from "node:http";

const PREFIX = "/memos";

const INJECT = `
<base href="${PREFIX}/">
<script>
(function () {
  var P = ${JSON.stringify(PREFIX)};
  var KEY = 'memos.session.token';
  function fix(u) {
    if (typeof u !== "string") return u;
    return u.indexOf("/api/") === 0 ? P + u : u;
  }
  // Never attach the session credential to a cross-origin request: the
  // wrapper sits on window.fetch / XMLHttpRequest.prototype, so without this
  // guard it would also decorate the viewer's probe of a sibling agent port
  // (which asks for credentials:"omit") or any future third-party URL. A
  // leaked Bearer token is a portable 7-day credential, and an extra header
  // on a cross-origin call also turns a simple request into a preflighted one.
  function sameOrigin(u) {
    if (typeof u !== "string") return false;
    try {
      var a = new URL(u, location.href);
      return a.protocol === location.protocol && a.host === location.host;
    } catch (e) { return false; }
  }
  // DSH Desktop serves this page through its own dsh-app:// protocol and
  // strips "set-cookie" from every forwarded response (it owns the shell's
  // cookie jar). A cookie-only login therefore succeeds and is instantly
  // forgotten. We keep the token that /auth/login returns and replay it as
  // an Authorization: Bearer header, which needs no cookie jar at all.
  function token() {
    try { return window.localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function save(t) {
    try { window.localStorage.setItem(KEY, t); } catch (e) {}
  }
  function clear() {
    try { window.localStorage.removeItem(KEY); } catch (e) {}
  }
  var _fetch = window.fetch;
  if (_fetch) {
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url);
      var fixed = fix(url);
      var opts = init ? Object.assign({}, init) : {};
      var t = token();
      if (t && sameOrigin(fixed)) {
        var h = new Headers(opts.headers || (input instanceof Request ? input.headers : undefined));
        if (!h.has("authorization")) h.set("authorization", "Bearer " + t);
        opts.headers = h;
      }
      var target = typeof input === "string"
        ? fixed
        : (input instanceof Request ? new Request(fixed, input) : input);
      var p = _fetch.call(this, target, opts);
      if (typeof url === "string" && sameOrigin(url) && /\\/auth\\/(login|setup)$/.test(url)) {
        // Persist the token BEFORE the caller resumes, so the status probe
        // that the viewer fires immediately after a successful login
        // already carries the Bearer header.
        return p.then(function (res) {
          if (res && res.status === 200) {
            return res.clone().json().then(function (d) {
              if (d && typeof d.token === "string") save(d.token);
              return res;
            }).catch(function () { return res; });
          }
          return res;
        });
      }
      if (typeof url === "string" && sameOrigin(url) && /\\/auth\\/logout$/.test(url)) clear();
      return p;
    };
  }
  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) {
    var args = Array.prototype.slice.call(arguments);
    args[1] = fix(u);
    _open.apply(this, args);
    try {
      var t = token();
      if (t && sameOrigin(args[1])) this.setRequestHeader("authorization", "Bearer " + t);
    } catch (e) {}
  };  var _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    try {
      this.addEventListener("load", function () {
        try {
          if (this.status !== 200) return;
          var u = String(this.responseURL || "");
          if (!sameOrigin(u)) return;
          if (/\\/auth\\/(login|setup)$/.test(u)) {
            var d = JSON.parse(this.responseText);
            if (d && typeof d.token === "string") save(d.token);
          } else if (/\\/auth\\/logout$/.test(u)) {
            clear();
          }
        } catch (e) {}
      });
    } catch (e) {}
    return _send.call(this, body);
  };
  if (window.EventSource) {
    var _ES = window.EventSource;
    var ES = function (u, o) { return new _ES(fix(u), o); };
    ES.prototype = _ES.prototype;
    window.EventSource = ES;
  }
})();
</script>
`;

interface WebServerRegistration {
  kind: "prefix";
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void;
}

interface VueWebServerLike {
  register(opts: WebServerRegistration): () => void;
}

function proxy(
  req: IncomingMessage,
  res: ServerResponse,
  upstreamPort: number,
): void {
  const url = req.url || "/";
  const qi = url.indexOf("?");
  const query = qi >= 0 ? url.slice(qi) : "";
  let rest = qi >= 0 ? url.slice(0, qi) : url;
  if (rest.startsWith(PREFIX)) rest = rest.slice(PREFIX.length);
  if (!rest.startsWith("/")) rest = "/" + rest;

  const headers: Record<string, string | string[] | undefined> = { ...req.headers };
  headers.host = `127.0.0.1:${upstreamPort}`;
  headers["accept-encoding"] = "identity";

  const up: ClientRequest = request(
    {
      host: "127.0.0.1",
      port: upstreamPort,
      method: req.method,
      path: rest + query,
      headers,
    },
    (upRes: IncomingMessage) => {
      const ct = String(upRes.headers["content-type"] ?? "");
      const isHtml = /html/i.test(ct);
      const outHeaders: Record<string, string | string[] | undefined> = {
        ...(upRes.headers as Record<string, string | string[] | undefined>),
      };
      delete outHeaders["content-length"];
      delete outHeaders["content-encoding"];

      if (isHtml) {
        const chunks: Buffer[] = [];
        upRes.on("data", (data: Buffer) => chunks.push(Buffer.from(data)));
        upRes.on("end", () => {
          let html = Buffer.concat(chunks).toString("utf8");
          if (html.includes("<head>")) html = html.replace("<head>", "<head>" + INJECT);
          else html = INJECT + html;
          const buf = Buffer.from(html, "utf8");
          outHeaders["content-length"] = String(buf.length);
          res.writeHead(upRes.statusCode ?? 200, outHeaders);
          res.end(buf);
        });
        upRes.on("error", () => res.destroy());
        return;
      }

      res.writeHead(upRes.statusCode ?? 200, outHeaders);
      upRes.pipe(res);
    },
  );

  up.on("error", (err: Error) => {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(`memos-viewer: upstream 127.0.0.1:${upstreamPort} unreachable: ${err.message}`);
  });

  req.pipe(up);
}

/** Register the `/memos` prefix onto a DSH webServer-compatible object. */
export function mountViewerProxy(
  webServer: VueWebServerLike,
  upstreamPort: number,
  log: (msg: string) => void,
): () => void {
  const dispose = webServer.register({
    kind: "prefix",
    path: PREFIX,
    handler: (req, res) => proxy(req, res, upstreamPort),
  });
  log(`memos-local-memory: mounted ${PREFIX}/ -> 127.0.0.1:${upstreamPort}`);
  return () => dispose();
}
