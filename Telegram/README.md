# Telegram 分流规则

按 DC 和机房拆分的 Telegram IP 规则，配合 Surge `[MTProto]` 使用。GitHub Action 每天自动更新一次，有变化才提交。

## 文件

| 文件 | 内容 |
|---|---|
| `DC1.list` ~ `DC5.list` | 单个 DC 的 MTProto 地址 |
| `Singapore.list` | 新加坡机房：DC5 |
| `Amsterdam.list` | 阿姆斯特丹机房：DC2、DC4 |
| `Miami.list` | 迈阿密机房：DC1、DC3 |
| `All.list` | Telegram 官方公布的全部 IP 段 |

## 数据来源

- DC 地址：[Surge mtproto-dc-config.json](https://raw.githubusercontent.com/surge-networks/MTProtoDCConfigGenerator/refs/heads/main/mtproto-dc-config.json)，内容来自 Telegram `help.getConfig`，也是 Surge MTProto 默认用的映射表。Surge 只连这张表里的地址，所以按 /32、/128 精确匹配就能覆盖全部 MTProto 流量，也能把同在 `149.154.167.0/24` 的 DC2 和 DC4 分开。
- 官方 IP 段：[core.telegram.org/resources/cidr.txt](https://core.telegram.org/resources/cidr.txt)

## 用法

放在 `PROTOCOL,MTProto` 和通用 Telegram 规则之前：

```ini
[Rule]
RULE-SET,https://raw.githubusercontent.com/DaqiGit/MyCode/main/Telegram/Singapore.list,Telegram-SG
RULE-SET,https://raw.githubusercontent.com/DaqiGit/MyCode/main/Telegram/Amsterdam.list,Telegram-EU
RULE-SET,https://raw.githubusercontent.com/DaqiGit/MyCode/main/Telegram/Miami.list,Telegram-US
PROTOCOL,MTProto,Telegram
```

规则文件里每行已带 `no-resolve`。

## 手动更新

```bash
python3 Telegram/generate.py
```
