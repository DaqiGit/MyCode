// Surge 运行监控面板脚本（详情版·优化），type=generic，供 [Panel] 调用
//
// 显示：标题带当前内存与占比；进度条（━ 当前占用、┅ 当前到峰值、─ 未用）；
// 峰值/最低与较上次采样的变化；活动连接、DNS 缓存、虚拟 IP；
// 临时规则/封禁只在非 0 时出现；运行时长与启动时刻；更新时间。
//
// 注意：Surge 只报内存总占用，不报各部分的 MB 明细，所以面板只能显示
// 各部分的条数，各占多少 MB 拿不到，不要硬编。
//
// 峰值/最低/上次采样存 $persistentStore，只统计本面板自己的采样。
// 判断引擎是否重启：uptime 变小，或"启动时刻 = 现在 - uptime"往后跳了
// 10 分钟以上。只看 uptime 变小不够：重启后隔很久才刷新，新 uptime 可能
// 已经超过旧值，上一轮的峰值就会被带过来。
//
// 数据源：优先 /v1/mcp 的 dump_runtime_data(performance)，拿不到时回退
// /v1/metrics。$httpAPI 无需鉴权。
//
// 参数（模块参数表传入，形如 limit=50&width=16）：
//   limit  内存上限 MB，默认 50（iOS Network Extension 约 50 MB）
//   width  进度条格数，默认 16，范围 6–30

const TITLE = "Surge 运行监控";
const STORE_KEY = "surge-memory-detail-v3";
const TIMEOUT_MS = 8000;
const RESTART_DRIFT_SEC = 600;

// 三个字符都在 Unicode 制表符区块（U+2500–257F），回退到同一字体，
// 字宽和基线一致；原版的 ▬ 属于几何图形区块，可能和 ┅ ─ 宽度、高度不齐。
const BAR = { used: "━", peak: "┅", free: "─" };

const ARGS = parseArgs(typeof $argument === "string" ? $argument : "");
const LIMIT_MB = toNum(ARGS.limit, 50, 1, 4096);
const BAR_WIDTH = Math.round(toNum(ARGS.width, 16, 6, 30));

// ---------- 工具函数 ----------

function parseArgs(str) {
  const out = {};
  str.split("&").forEach((pair) => {
    const i = pair.indexOf("=");
    if (i <= 0) return;
    const k = pair.slice(0, i).trim();
    let v = pair.slice(i + 1).trim();
    try {
      v = decodeURIComponent(v);
    } catch (e) {}
    out[k] = v;
  });
  return out;
}

// 参数没替换（仍是 {{{...}}}）或不是数字时用默认值
function toNum(v, def, min, max) {
  const n = parseFloat(v);
  if (!isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

const pad = (n) => (n < 10 ? "0" : "") + n;

const hhmm = (d) => pad(d.getHours()) + ":" + pad(d.getMinutes());

// 11 小时 28 分 / 1 天 2 小时 / 28 分 / 45 秒
function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(sec));
  if (sec < 60) return sec + " 秒";
  if (sec < 3600) return Math.floor(sec / 60) + " 分";
  if (sec < 86400) {
    return Math.floor(sec / 3600) + " 小时 " + Math.floor((sec % 3600) / 60) + " 分";
  }
  return Math.floor(sec / 86400) + " 天 " + Math.floor((sec % 86400) / 3600) + " 小时";
}

// 今天 08:30 / 昨天 23:10 / 11-15 08:30
function fmtStart(ms) {
  const t = new Date(ms);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(t.getTime());
  day.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today - day) / 86400000);
  if (diffDays === 0) return "今天 " + hhmm(t);
  if (diffDays === 1) return "昨天 " + hhmm(t);
  return pad(t.getMonth() + 1) + "-" + pad(t.getDate()) + " " + hhmm(t);
}

// 45 秒前 / 5 分钟前 / 3 小时前 / 2 天前
function fmtAgo(sec) {
  sec = Math.max(1, Math.floor(sec));
  if (sec < 60) return sec + " 秒前";
  if (sec < 3600) return Math.floor(sec / 60) + " 分钟前";
  if (sec < 86400) return Math.floor(sec / 3600) + " 小时前";
  return Math.floor(sec / 86400) + " 天前";
}

// 千分位：12345 → 12,345；缺字段显示 —
function fmtCount(v) {
  if (v == null || !isFinite(v)) return "—";
  return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const mb1 = (x) => x.toFixed(1);

// ---------- 进度条与配色 ----------

// 直接用原始比例算格数，不要先把百分比取整再算——两次取整会把
// 当前和峰值的差距吃掉。峰值高于当前时至少留一格虚线。
function dualBar(curMB, peakMB) {
  const clamp = (n) => Math.min(BAR_WIDTH, Math.max(0, n));
  const cur = clamp(Math.round((curMB / LIMIT_MB) * BAR_WIDTH));
  let peak = Math.max(cur, clamp(Math.round((peakMB / LIMIT_MB) * BAR_WIDTH)));
  if (peakMB > curMB && peak === cur && peak < BAR_WIDTH) peak = cur + 1;
  return (
    BAR.used.repeat(cur) + BAR.peak.repeat(peak - cur) + BAR.free.repeat(BAR_WIDTH - peak)
  );
}

// 按占比分档，换上限后阈值跟着变（50 MB 时即 30 / 40 MB）
function colorFor(ratio) {
  if (ratio >= 0.8) return "#FF3B30"; // 红：接近上限
  if (ratio >= 0.6) return "#FF9500"; // 橙：偏高
  return "#34C759"; // 绿：正常
}

// 仪表指针随占用转动（SF Symbols 5 / iOS 17+）
function iconFor(ratio) {
  const steps = [
    [0.2, "0"],
    [0.42, "33"],
    [0.58, "50"],
    [0.8, "67"],
  ];
  for (let i = 0; i < steps.length; i++) {
    if (ratio < steps[i][0]) return "gauge.with.dots.needle." + steps[i][1] + "percent";
  }
  return "gauge.with.dots.needle.100percent";
}

// ---------- 峰值/最低/上次采样 ----------

function loadStats() {
  try {
    const raw = $persistentStore.read(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function updateStats(mb, uptime, nowSec) {
  const start = uptime != null ? nowSec - uptime : null;
  const old = loadStats();
  let sameRun = !!old;
  if (old && uptime != null) {
    if (old.uptime != null && uptime < old.uptime) sameRun = false;
    if (old.start != null && start - old.start > RESTART_DRIFT_SEC) sameRun = false;
  }
  const base = sameRun ? old : {};
  const stats = {
    start: start != null ? start : base.start,
    uptime: uptime != null ? uptime : base.uptime,
    peak: Math.max(mb, base.peak || 0),
    min: base.min != null ? Math.min(mb, base.min) : mb,
    last: { mb: mb, t: nowSec },
  };
  try {
    $persistentStore.write(JSON.stringify(stats), STORE_KEY);
  } catch (e) {}
  return { peak: stats.peak, min: stats.min, prev: sameRun ? base.last : null };
}

function trendText(prev, mb, nowSec) {
  if (!prev || prev.mb == null || prev.t == null) return null;
  const d = mb - prev.mb;
  const when = "较 " + fmtAgo(nowSec - prev.t);
  if (Math.abs(d) < 0.05) return when + "持平";
  return when + " " + (d > 0 ? "↑" : "↓") + mb1(Math.abs(d));
}

// ---------- 渲染 ----------

let finished = false;
function finish(obj) {
  if (finished) return;
  finished = true;
  $done(obj);
}

function render(d) {
  const now = Date.now();
  const nowSec = now / 1000;
  const mb = d.mem / 1048576;
  const ratio = mb / LIMIT_MB;
  const st = updateStats(mb, d.uptime, nowSec);

  const memLine = ["峰值 " + mb1(st.peak), "最低 " + mb1(st.min)];
  const trend = trendText(st.prev, mb, nowSec);
  if (trend) memLine.push(trend);

  const lines = [
    dualBar(mb, st.peak),
    memLine.join(" · "),
    [
      "连接 " + fmtCount(d.activeReq),
      "DNS 缓存 " + fmtCount(d.dns),
      d.vip != null ? "虚拟 IP " + fmtCount(d.vip) : null,
    ]
      .filter(Boolean)
      .join(" · "),
  ];

  // 临时规则、封禁平时为 0，有值才显示
  const extra = [];
  if (d.tempRules > 0) extra.push("临时规则 " + fmtCount(d.tempRules));
  if (d.bans > 0) extra.push("封禁 " + fmtCount(d.bans));
  if (extra.length) lines.push(extra.join(" · "));

  if (d.uptime != null) {
    lines.push("已运行 " + fmtDuration(d.uptime) + " · " + fmtStart(now - d.uptime * 1000) + " 启动");
  }

  const t = new Date(now);
  lines.push("更新于 " + hhmm(t) + ":" + pad(t.getSeconds()));

  finish({
    title: "Surge 内存 " + mb1(mb) + " MB · " + Math.round(ratio * 100) + "%",
    content: lines.join("\n"),
    icon: iconFor(ratio),
    "icon-color": colorFor(ratio),
  });
}

function fail(msg) {
  finish({ title: TITLE, content: "读取失败：" + msg, style: "error" });
}

// ---------- 数据源 ----------

// 路径 2（回退）：/v1/metrics（Prometheus 纯文本）
function viaMetrics() {
  try {
    $httpAPI("GET", "/v1/metrics", null, (result) => {
      let text = null;
      if (typeof result === "string") text = result;
      else if (result && typeof result.body === "string") text = result.body;
      else if (result && typeof result.data === "string") text = result.data;
      const grab = (name) => {
        const m = text && new RegExp(name + "\\s+([\\d.]+)").exec(text);
        return m ? parseFloat(m[1]) : null;
      };
      const mem = grab("surge_memory_bytes");
      if (!mem) return fail("无内存数据");
      render({
        mem: mem,
        uptime: grab("surge_uptime_seconds"),
        activeReq: grab("surge_active_requests"),
        dns: grab("surge_dns_cache_entries"),
        vip: grab("surge_virtual_ip_entries"),
        tempRules: grab("surge_temporary_rules"),
        bans: grab("surge_active_bans"),
      });
    });
  } catch (e) {
    fail("接口不可用");
  }
}

// 路径 1（优先）：/v1/mcp dump_runtime_data（JSON，一次拿到全部计数字段）
function viaMcp() {
  try {
    $httpAPI(
      "POST",
      "/v1/mcp",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "dump_runtime_data", arguments: { type: "performance" } },
      },
      (result) => {
        try {
          const c = result && result.result && result.result.content && result.result.content[0];
          const data = c && c.text ? JSON.parse(c.text) : null;
          const mem = data && (data["memory-bytes"] || data.memoryBytes);
          if (!mem) return viaMetrics();
          render({
            mem: mem,
            uptime: data.uptime != null ? data.uptime : null,
            activeReq: data["active-requests"],
            dns: data["dns-cache-entries"],
            vip: data["virtual-ip-entries"],
            tempRules: data["temporary-rules"],
            bans: data["active-bans"],
          });
        } catch (e) {
          viaMetrics();
        }
      }
    );
  } catch (e) {
    viaMetrics();
  }
}

// $httpAPI 不回调时兜底，避免面板卡在超时警告
setTimeout(() => fail("请求超时"), TIMEOUT_MS);
viaMcp();
