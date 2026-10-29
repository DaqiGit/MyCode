/**
 * Stash: t.me → 第三方 Telegram 客户端重定向
 * 改写自 IBL3ND 的 Egern 版 TgRedirect.js，客户端名通过 $argument 传入
 */

const SCHEME = {
  Telegram: "tg",
  Nagram: "na",
  Swiftgram: "sg",
  Turrit: "turrit",
  iMe: "ime",
  Nicegram: "ng",
  Lingogram: "lingo",
  Regram: "regram",
};

function qval(qs, key) {
  if (!qs) return "";
  const re = new RegExp(
    "(?:^|&)" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^&]*)",
  );
  const m = qs.match(re);
  return m ? decodeURIComponent(m[1]) : "";
}

function deeplink(s, path, qs) {
  const p = path.split("/").filter(Boolean);
  if (!p[0]) return "";

  if (p[0][0] === "+") {
    return `${s}://join?invite=${encodeURIComponent(p[0].slice(1))}`;
  }
  if (p[0] === "joinchat" && p[1]) {
    return `${s}://join?invite=${encodeURIComponent(p[1])}`;
  }
  if (p[0] === "addstickers" && p[1]) {
    return `${s}://addstickers?set=${encodeURIComponent(p[1])}`;
  }
  if (p[0] === "share" && p[1] === "url") {
    return `${s}://msg_url?url=${encodeURIComponent(qval(qs, "url"))}&text=${encodeURIComponent(qval(qs, "text"))}`;
  }
  if (p[1] && /^\d+$/.test(p[1])) {
    return `${s}://resolve?domain=${encodeURIComponent(p[0])}&post=${encodeURIComponent(p[1])}`;
  }
  return `${s}://resolve?domain=${encodeURIComponent(p[0])}`;
}

function main() {
  const m = $request.url.match(/^https?:\/\/(?:t\.me|telegram\.me)\/(.+)$/i);
  if (!m) return {};

  const client = (typeof $argument === "string" && $argument.trim()) || "Telegram";
  if (client === "Telegram") return {};

  const scheme = SCHEME[client] || "tg";

  let tail = m[1];
  if (tail.startsWith("s/")) tail = tail.slice(2);

  const qi = tail.indexOf("?");
  const path = qi < 0 ? tail : tail.slice(0, qi);
  const qs = qi < 0 ? "" : tail.slice(qi + 1);

  const loc = deeplink(scheme, path, qs);
  if (!loc) return {};

  return {
    response: {
      status: 302,
      headers: { Location: loc, "Cache-Control": "no-store, no-cache" },
      body: "",
    },
  };
}

$done(main());
