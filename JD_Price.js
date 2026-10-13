/*
京东比价（Surge 精简版）
基于 https://raw.githubusercontent.com/githubdulong/Script/master/jd_price.js 与 kelee.one JD_Price.js
- 去掉 Env / CryptoJS 依赖，只保留 MD5
- 按商品缓存比价结果，重复打开同一商品不再请求
- 单个请求超时 4s，失败时尽快返回原页面
- 令牌变化时才通知
可选持久化键：mmb_v = V1 | V2（接口版本），mmb_cache_min = 缓存分钟数（默认 60，0 关闭）
*/
const NAME = '京东比价';
const CK_KEY = 'manmanbuy_val';
const CACHE_KEY = 'jd_price_cache';
const SECRET_KEY = '3E41D1331F5DDAFCD0A38FE2D52FF66F';
const REQ_TIMEOUT = 4000;
const KEEP = ['当前到手价', '历史最低价', '618价格', '双11价格', '30天最低价', '60天最低价', '180天最低价'];
const CK_FIELDS = ['jsoncallback', 'c_individ', 'c_appver', 'c_ostype', 'c_osver', 'c_devid', 'c_mmbDevId', 'c_systemDevId', 'c_fixDevId', 'c_devmodel', 'c_brand', 'c_operator', 'c_engine', 'c_session', 'c_ddToken', 'c_ctrl', 'c_win', 'c_dp', 'c_safearea', 'c_firstchannel', 'c_firstquerendate', 'c_fristversion', 'c_channel', 'c_uuid', 'c_ssid', 'c_did', 'c_theme', 'c_jpush', 'c_mmbncid', 'sm_deviceid'];

const STYLE = '<style>.jdp{max-width:800px;margin:10px auto;padding:10px;font:bold 13px "PingFang SC",-apple-system,sans-serif;background:#FFF9F9;color:#333;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.05)}.jdp table{width:100%;border-collapse:separate;border-spacing:0;border-radius:8px;overflow:hidden}.jdp th{background:#e61a23;color:#fff;padding:10px;text-align:left}.jdp td{padding:10px;border-bottom:1px solid #eee}.jdp-up{color:#C91623}.jdp-down{color:#00aa00}.jdp-note{margin-top:6px;font-size:11px;font-weight:normal;color:#999;text-align:right}.jdp-err{color:#d32f2f;border:2px solid #f44336;background:#fff}@media(prefers-color-scheme:dark){.jdp{background:#1e1e1e;color:#ddd}.jdp td{border-color:#333}.jdp-err{background:#1e1e1e}}</style>';

const url = $request.url;

if (url.includes('/baoliao/center/menu')) {
    saveToken($request.body);
    $done({});
} else {
    const body = $response.body;
    main(body)
        .then(html => $done({body: inject(body, html)}))
        .catch(err => {
            console.log(`${NAME} 失败：${err && err.message || err}`);
            $done({body: inject(body, errorHTML(err && err.message || String(err)))});
        });
}

function saveToken(body) {
    if (!body) return;
    const old = $persistentStore.read(CK_KEY);
    const devId = parseQuery(body).c_mmbDevId;
    if (!devId) return;
    if (old === body) return;
    $persistentStore.write(body, CK_KEY);
    // 只在设备 ID 变化时提醒，避免每次进入「我的」都弹通知
    if (!old || parseQuery(old).c_mmbDevId !== devId) $notification.post(NAME, '获取令牌成功 🎉', '现在可以在京东商品页查看比价');
}

async function main() {
    const id = (url.match(/product\/graphext\/(\d+)\.html/) || [])[1];
    if (!id) throw new Error('京东 URL 匹配失败');

    const ttl = Number($persistentStore.read('mmb_cache_min') ?? 60) * 60e3;
    const cache = readCache();
    const hit = cache[id];
    if (ttl > 0 && hit && Date.now() - hit.t < ttl) return priceHTML(hit.list, hit.t);

    const ck = getCk();
    const v2 = $persistentStore.read('mmb_v') === 'V2';
    let link = `https://item.jd.com/${id}.html`, stteId;
    if (v2) {
        const parse = check(await mmb(ck, 'https://apapia-common.manmanbuy.com/SiteCommand/parse', {methodName: 'commonMethod', searchKey: link}), '获取 stteId');
        link = parse.result?.link;
        stteId = parse.result?.stteId;
    }
    const basic = check(await mmb(ck, `https://apapia-history-weblogic.manmanbuy.com/basic/${v2 ? 'v2/' : ''}getItemBasicInfo`,
        {methodName: 'getHistoryInfoJava', searchKey: link, ...(v2 && {stteId})}), '获取商品信息');
    const trend = check(await mmb(ck, 'https://apapia-history-weblogic.manmanbuy.com/history/v2/getHistoryTrend',
        {methodName: 'getHistoryTrend2021', url: basic.result?.url, spbh: basic.result?.spbh}), '获取价格趋势');
    const remark = check(await mmb(ck, 'https://apapia-history-weblogic.manmanbuy.com/history/priceRemark',
        {methodName: 'priceRemarkJava', jiagequshiyh: trend.result?.trend}), '获取价格备注');

    const detail = remark.remark?.ListPriceDetail;
    if (!Array.isArray(detail)) throw new Error('慢慢买未返回价格明细');
    const list = detail.filter(i => KEEP.includes(i.Name))
        .map(({Name, Date, Price, Difference}) => ({Name, Date, Price, Difference}));

    if (ttl > 0) {
        const now = Date.now();
        for (const k in cache) if (now - cache[k].t >= ttl) delete cache[k];
        cache[id] = {t: now, list};
        $persistentStore.write(JSON.stringify(cache), CACHE_KEY);
    }
    return priceHTML(list);
}

function readCache() {
    try { return JSON.parse($persistentStore.read(CACHE_KEY) || '{}') || {}; } catch { return {}; }
}

function getCk() {
    const raw = $persistentStore.read(CK_KEY);
    if (!raw) throw new Error('请先打开【慢慢买】App，进入「我的」页面获取令牌');
    const p = parseQuery(raw);
    if (!p.c_mmbDevId) throw new Error('令牌格式异常，请重新获取');
    const ck = {};
    for (const k of CK_FIELDS) ck[k] = p[k] ?? '';
    return ck;
}

function check(res, desc) {
    if (!res || res.ok !== 1) {
        console.log(`${NAME} ${desc}：${JSON.stringify(res)}`);
        throw new Error(`慢慢买提示您：${res?.msg || `${desc}失败`}`);
    }
    return res;
}

function mmb(ck, reqUrl, params) {
    const data = {...ck, ...params, t: Date.now().toString()};
    const sign = Object.keys(data)
        .filter(k => data[k] !== '' && data[k] != null && k.toLowerCase() !== 'token')
        .sort()
        .map(k => `${k.toUpperCase()}${String(data[k]).toUpperCase()}`)
        .join('');
    data.token = md5(encodeURIComponent(SECRET_KEY + sign + SECRET_KEY)).toUpperCase();
    const body = Object.keys(data).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(data[k] ?? '')}`).join('&');
    return new Promise((resolve, reject) => {
        $httpClient.post({
            url: reqUrl,
            timeout: REQ_TIMEOUT / 1000,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 - mmbWebBrowse - ios'
            },
            body
        }, (err, resp, text) => {
            if (err) return reject(new Error(`网络错误：${err}`));
            try { resolve(JSON.parse(text)); } catch { reject(new Error('慢慢买返回内容无法解析')); }
        });
    });
}

function inject(body, html) {
    if (!body) return body;
    const out = body.replace(/<body[^>]*>/i, m => m + html);
    return out === body ? html + body : out;
}

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}

function today() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function priceHTML(list, cachedAt) {
    const rows = list.map(({Name: name, Date: date, Price: price = '', Difference: diff = ''}) => {
        if (name === '当前到手价') { date = today(); diff = '仅供参考'; }
        diff = String(diff ?? '');
        const cls = diff.startsWith('↑') ? 'up' : diff.startsWith('↓') ? 'down' : '';
        return `<tr><td>${esc(name)}</td><td>${esc(date || '-')}</td><td>${esc(price)}</td><td class="jdp-${cls}">${esc(diff)}</td></tr>`;
    }).join('');
    const note = cachedAt ? `<div class="jdp-note">缓存于 ${Math.max(1, Math.round((Date.now() - cachedAt) / 60e3))} 分钟前</div>` : '';
    return `<div class="jdp"><table><thead><tr><th>类型</th><th>日期</th><th>价格</th><th>差价</th></tr></thead><tbody>${rows}</tbody></table>${note}</div>${STYLE}`;
}

function errorHTML(msg) {
    return `<div class="jdp jdp-err">${esc(msg)}</div>${STYLE}`;
}


function parseQuery(s) {
    const o = {};
    for (const pair of String(s).split('&')) {
        if (!pair) continue;
        const i = pair.indexOf('=');
        const k = i < 0 ? pair : pair.slice(0, i), v = i < 0 ? '' : pair.slice(i + 1);
        try { o[decodeURIComponent(k)] = decodeURIComponent(v); } catch { o[k] = v; }
    }
    return o;
}

// MD5（UTF-8 输入，返回小写 hex）
function md5(str) {
    const bytes = unescape(encodeURIComponent(str));
    const n = bytes.length, words = new Array(((n + 8) >> 6) + 1 << 4).fill(0);
    for (let i = 0; i < n; i++) words[i >> 2] |= bytes.charCodeAt(i) << (i % 4) * 8;
    words[n >> 2] |= 0x80 << (n % 4) * 8;
    words[words.length - 2] = n * 8;
    const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    const K = Array.from({length: 64}, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0);
    let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    for (let j = 0; j < words.length; j += 16) {
        let a = a0, b = b0, c = c0, d = d0;
        for (let i = 0; i < 64; i++) {
            const r = i >> 4;
            let f, g;
            if (r === 0) { f = (b & c) | (~b & d); g = i; }
            else if (r === 1) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; }
            else if (r === 2) { f = b ^ c ^ d; g = (3 * i + 5) & 15; }
            else { f = c ^ (b | ~d); g = (7 * i) & 15; }
            const s = S[r * 4 + (i & 3)];
            const t = (a + f + K[i] + words[j + g]) | 0;
            a = d; d = c; c = b;
            b = (b + ((t << s) | (t >>> (32 - s)))) | 0;
        }
        a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
    }
    return [a0, b0, c0, d0].map(x => {
        let h = '';
        for (let i = 0; i < 4; i++) h += ((x >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
        return h;
    }).join('');
}
