#!/usr/bin/env python3
"""生成 Telegram 按 DC / 按机房分流的 Surge 规则集。

数据来源：
1. DC 地址表：Surge 官方维护的 mtproto-dc-config.json，内容是 Telegram help.getConfig 的生产结果，
   也是 Surge [MTProto] 默认使用的映射表。Surge 只会连这张表里的地址，所以按表里的 IP 精确匹配就能覆盖全部 MTProto 流量。
2. Telegram 官方 IP 段：https://core.telegram.org/resources/cidr.txt

只用 Python 标准库。用法：python3 Telegram/generate.py
"""
import ipaddress
import json
import pathlib
import sys
import urllib.request

DC_CONFIG_URL = "https://raw.githubusercontent.com/surge-networks/MTProtoDCConfigGenerator/refs/heads/main/mtproto-dc-config.json"
CIDR_URL = "https://core.telegram.org/resources/cidr.txt"

# Telegram 生产 DC 所在机房。
DC_LOCATION = {1: "迈阿密", 2: "阿姆斯特丹", 3: "迈阿密", 4: "阿姆斯特丹", 5: "新加坡"}
REGION_FILES = {"Miami": [1, 3], "Amsterdam": [2, 4], "Singapore": [5]}

# dcOption flags
FLAG_IPV6, FLAG_MEDIA, FLAG_TCPO_ONLY, FLAG_SECRET = 1, 2, 4, 1024

OUT = pathlib.Path(__file__).resolve().parent
RAW = "https://raw.githubusercontent.com/DaqiGit/MyCode/main/Telegram"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "MyCode-telegram-rules"})
    with urllib.request.urlopen(req, timeout=30) as r:
        if r.status != 200:
            raise RuntimeError(f"{url} 返回 {r.status}")
        return r.read().decode()


def rule(net):
    kind = "IP-CIDR6" if net.version == 6 else "IP-CIDR"
    return f"{kind},{net.with_prefixlen},no-resolve"


def write(name, header, nets):
    lines = [f"# {h}" for h in header]
    lines += [rule(n) for n in sorted(nets, key=lambda n: (n.version, n))]
    (OUT / name).write_text("\n".join(lines) + "\n")
    print(f"{name}: {len(nets)} 条")


def main():
    cfg = json.loads(fetch(DC_CONFIG_URL))
    if cfg.get("version") != 1 or not cfg.get("options"):
        sys.exit("DC 配置格式不对，放弃更新")

    per_dc = {dc: set() for dc in DC_LOCATION}
    for opt in cfg["options"]:
        dc, flags = opt["id"], opt.get("flags", 0)
        # Surge 不会选需要 tcpo_only 或单独 secret 的地址，跳过。
        if dc not in per_dc or flags & (FLAG_TCPO_ONLY | FLAG_SECRET):
            continue
        ip = ipaddress.ip_address(opt["ip"])
        per_dc[dc].add(ipaddress.ip_network(ip))

    for dc, nets in per_dc.items():
        if not nets:
            sys.exit(f"DC{dc} 没有可用地址，放弃更新")

    official = set()
    for line in fetch(CIDR_URL).split():
        official.add(ipaddress.ip_network(line.strip()))
    if len(official) < 5:
        sys.exit("官方 CIDR 列表异常，放弃更新")

    # 校验：DC 地址都应该落在官方 IP 段里，不在就提示（不阻断）。
    for dc, nets in per_dc.items():
        for n in nets:
            if not any(n.subnet_of(o) for o in official if o.version == n.version):
                print(f"警告：DC{dc} 地址 {n} 不在官方 cidr.txt 里", file=sys.stderr)

    note = "自动生成，不要手改。生成脚本：Telegram/generate.py"
    src = f"来源：{DC_CONFIG_URL}"
    for dc, nets in per_dc.items():
        write(f"DC{dc}.list", [f"Telegram DC{dc}（{DC_LOCATION[dc]}）MTProto 地址", src, note,
                               f"引用：RULE-SET,{RAW}/DC{dc}.list,<策略组>"], nets)
    for region, dcs in REGION_FILES.items():
        nets = set().union(*(per_dc[d] for d in dcs))
        names = "、".join(f"DC{d}" for d in dcs)
        write(f"{region}.list", [f"Telegram {DC_LOCATION[dcs[0]]}机房（{names}）MTProto 地址", src, note,
                                 f"引用：RULE-SET,{RAW}/{region}.list,<策略组>"], nets)
    write("All.list", ["Telegram 官方公布的全部 IP 段", f"来源：{CIDR_URL}", note,
                       f"引用：RULE-SET,{RAW}/All.list,<策略组>"], official)


if __name__ == "__main__":
    main()
