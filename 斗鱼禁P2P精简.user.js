// ==UserScript==
// @name         斗鱼禁P2P + 精简
// @namespace    https://github.com/
// @version      1.0.0
// @description  禁止斗鱼网页播放器使用 P2P/PCDN（不再占用上传带宽），并隐藏广告、活动挂件、礼物特效等干扰元素
// @match        *://*.douyu.com/*
// @run-at       document-start
// @grant        none
// @inject-into  page
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        // 改写拉流接口返回，让播放器直接走 CDN，不加载 P2P SDK
        DISABLE_P2P: true,
        // 屏蔽 WebRTC：P2P 的兜底手段，同时阻止页面借 WebRTC 探测本机内网 IP
        // 若以后遇到需要 WebRTC 的功能（连麦、语音房等）异常，把它改成 false
        BLOCK_WEBRTC: true,
        // 隐藏广告、活动挂件、礼物特效等
        SIMPLIFY_UI: true,
        // 隐藏直播间下方的鱼吧/推荐区
        HIDE_BOTTOM: true,
        // 隐藏聊天区上方的排行榜
        HIDE_RANK: true,
        // 隐藏品牌/活动房间顶部的装修大横幅，让播放器回到页面顶部
        HIDE_ROOM_DECOR: true,
        // 隐藏播放器下方的礼物栏（播放器高度是固定算好的，隐藏后那里会留一条空白）
        HIDE_GIFT_BAR: false,
    };

    // ---------- 禁 P2P：改写 getH5Play 接口 ----------

    const PLAY_API = /\/lapi\/live\/getH5Play/;

    function stripP2P(text) {
        try {
            const json = JSON.parse(text);
            const data = json && json.data;
            if (data && typeof data === 'object') {
                data.p2p = 0;
                data.h265_p2p = 0;
                data.p2pCid = 0;
                data.p2pCids = '';
                data.h265_p2p_cid = 0;
                data.h265_p2p_cids = '';
                delete data.p2pMeta;
            }
            return JSON.stringify(json);
        } catch (e) {
            return text;
        }
    }

    if (CONFIG.DISABLE_P2P) {
        const XHR = XMLHttpRequest.prototype;
        const rawOpen = XHR.open;
        XHR.open = function (method, url) {
            this.__dyPlayApi = PLAY_API.test(String(url));
            return rawOpen.apply(this, arguments);
        };

        const textDesc = Object.getOwnPropertyDescriptor(XHR, 'responseText');
        const respDesc = Object.getOwnPropertyDescriptor(XHR, 'response');
        Object.defineProperty(XHR, 'responseText', {
            configurable: true,
            get() {
                const text = textDesc.get.call(this);
                return this.__dyPlayApi && this.readyState === 4 ? stripP2P(text) : text;
            },
        });
        Object.defineProperty(XHR, 'response', {
            configurable: true,
            get() {
                const resp = respDesc.get.call(this);
                if (!this.__dyPlayApi || this.readyState !== 4) return resp;
                if (typeof resp === 'string') return stripP2P(resp);
                if (resp && typeof resp === 'object' && this.responseType === 'json') {
                    return JSON.parse(stripP2P(JSON.stringify(resp)));
                }
                return resp;
            },
        });

        const rawFetch = window.fetch;
        window.fetch = function (input, init) {
            const url = typeof input === 'string' ? input : input && input.url;
            const p = rawFetch.apply(this, arguments);
            if (!PLAY_API.test(String(url))) return p;
            return p.then(res => res.clone().text().then(text => new Response(stripP2P(text), {
                status: res.status,
                statusText: res.statusText,
                headers: res.headers,
            })));
        };
    }

    // ---------- 屏蔽 WebRTC ----------

    if (CONFIG.BLOCK_WEBRTC) {
        [
            'RTCPeerConnection',
            'webkitRTCPeerConnection',
            'mozRTCPeerConnection',
            'RTCDataChannel',
            'RTCSessionDescription',
            'RTCIceCandidate',
        ].forEach(name => {
            try {
                Object.defineProperty(window, name, { value: undefined, writable: false, configurable: false });
            } catch (e) { /* 已被锁定则忽略 */ }
        });
    }

    // ---------- 精简界面 ----------

    const hide = [];
    if (CONFIG.SIMPLIFY_UI) {
        hide.push(
            // 顶栏：下载客户端、开播、创作中心、任务、活动入口
            '.Header-download-wrap',
            '.Header-broadcast-wrap',
            '.Header-createcenter-wrap',
            '.Header-taskentry-wrap',
            '.HeaderNav',
            // 播放器上方横幅、标题栏右侧活动挂件
            '#js-room-top-banner',
            '[class*="activeContainer__"]',
            // 播放器内：PK 条、礼物特效层、画面上的活动弹窗
            '#js-player-above-controller',
            '#douyu_room_normal_player_danmuEffect',
            '#js-player-video-above',
            // 播放器下方的广告行
            '.InteractABAd',
            // 右侧聊天区顶部广告位、礼物横幅和各类特效
            '#js-player-asideTopSuspension',
            '#js-aside-gift-barrage-banner',
            '.GiftEffect-box',
            '#js-spine-player',
            '.mp4EffctPlayer',
            '#js-svgaV1-player',
            '.DiamondsFansSvgaPlayerDom',
            '.AsideEffectPlayerDom',
            '.layout-Player-effect',
            // 页面最右侧的活动挂件栏
            '#js-room-snapbar',
            '[class^="snapbar__"]',
        );
    }
    if (CONFIG.HIDE_BOTTOM) hide.push('#js-bottom-left');
    if (CONFIG.HIDE_RANK) hide.push('.layout-Player-rank');
    if (CONFIG.HIDE_GIFT_BAR) hide.push('#js-player-toolbar');

    let extraCss = '';
    if (CONFIG.HIDE_ROOM_DECOR) {
        // 装修房间里 #root 下除播放器外的都是横幅/装修块，且 #root 会被上移到顶栏下面
        hide.push('#root:has(> [class*="playerWrap__"]) > :not([class*="playerWrap__"])');
        extraCss = '#root:has(> [class*="playerWrap__"]) { margin-top: 0 !important; top: 0 !important; transform: none !important; }';
    }

    if (hide.length) {
        const style = document.createElement('style');
        style.id = 'dy-simplify';
        style.textContent = `${hide.join(',\n')} { display: none !important; }\n${extraCss}`;
        (document.head || document.documentElement).appendChild(style);
    }
})();
