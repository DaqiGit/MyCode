/*
车来了：精简底部标签栏
与 ddgksf2013/Scripts chelaile.js（加密版）行为一致：goocity/city 接口的 cityList 只保留下列标签
响应格式为 **YGKJ{json}YGKJ##，处理时保留原有前后缀
*/
const KEEP = ['首页', '我的', '路线规划'];

let body = $response.body;
try {
    const m = body && body.match(/^([\s\S]*?YGKJ)([\s\S]*?)(YGKJ[\s\S]*)$/);
    const json = m ? m[2] : body;
    const obj = JSON.parse(json);
    const list = obj?.jsonr?.data?.cityList;
    if (Array.isArray(list)) {
        obj.jsonr.data.cityList = list.filter(i => KEEP.includes(i?.title));
        body = m ? m[1] + JSON.stringify(obj) + m[3] : JSON.stringify(obj);
    }
} catch (e) {
    console.log(`车来了：${e.message}`);
}
$done({body});
