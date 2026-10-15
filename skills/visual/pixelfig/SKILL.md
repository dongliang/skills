---
name: pixelfig
description: 画图。凡是要给用户出图——"画个图""画一张""图示""流程图""对比图""把这段画出来""做个图说明"——一律用本技能。产出固定是像素风 PNG 文件（低分辨率逻辑画布作画 + 最近邻整数倍放大），永远不写内联 SVG。本技能含画布/配色/字号/字体的全部实测结论，动手前先读。
license: MIT
compatibility: Requires Python 3 with Pillow, and CJK pixel fonts. Run scripts/install-fonts.sh once (downloads ~12 MB) if the font check fails.
metadata:
  version: "1.2.0"
  author: dongliang
---

# pixelfig：像素风出图

**禁止在回复里写 SVG 标签**（界面不渲染内联 SVG，源码会原样显示，等于没画）。产出必须是真实 PNG。

## 准备

首次使用先确认字体在位：

```sh
python3 -c "import sys;sys.path.insert(0,'scripts');import pixelfig;print(pixelfig.FONTS)"
```

报错说找不到字体就装一次（约 12MB，装到 `~/.fonts/pixel`）：

```sh
sh scripts/install-fonts.sh
```

字体装在非默认目录时，用环境变量指过去：`export PIXELFIG_FONT_DIR=/path/to/fonts`。

## 流程

1. 用 `scripts/pixelfig.py` 画。在小逻辑画布上 1:1 作画，API：

   ```python
   import sys; sys.path.insert(0, "scripts")
   from pixelfig import *

   c = Canvas(290, 200)                                  # 逻辑画布
   c.panel(10, 8, 270, 60, accent=PURPLE, fill=PURPLE_L) # 切角面板＋硬投影＋左色条
   c.bar(10, 8, 270, 18, PURPLE, label="标题")            # 实色标题条（白字）
   c.text(22, 30, "正文", 12, INK)                        # 文字
   c.text_c(145, 48, "居中")                              # 水平居中
   c.small(22, 64, "次要文字")                            # 12px + 深灰
   c.icon(20, 80, ICONS["disk"], CYAN)                   # 位图图标
   c.arrow_v(145, 90, 10, MUTED); c.arrow_h(20, 100, 20, MUTED)
   c.text_size("测试", 12)                                # 量宽度，用来排版
   c.save("out.png", scale=3)                            # 输出
   ```

2. 脚本存到工作目录的 `fig/fig_<名字>.py`（**别放临时目录，会被清掉**）。
3. `python3 该脚本` 出图。
4. 用读图能力复查：中文没乱码、文字没超框、箭头走向对、没重叠。再嵌进回复。

**并存多个版本对比时换文件名，绝不覆盖已有的图**（用户常要求"保留原来那张"）。

## 硬规则（已实测，别再试）

1. **放大一律 `scale=3`**。2 倍时手机显示端会按屏宽缩 1.49 倍（非整数），像素又糊回去。倍率只用整数。
2. **中文像素字最小 12px**，或整数倍 24/36。实测排序：`原生12 > Cubic原生11 > 12压11 > 原生10 > 12压10`。压到 11 勉强能看但不如原生；压到 10 必坏且坏得不均匀；原生 10 虽不断笔但太密、整行像条形码。**层级靠颜色＋缩进＋面板分组，不靠字号。**
3. **字号必须落在 12 的整数倍上**，18px 这种用不了（非整数倍每格交替 2/3 像素，笔画粗细不匀）。
4. 字体不用跟着乘倍率：Fusion 直接渲染 24px 与 12px 放大 2 倍**逐像素 0 差异**，它按 12 格设计。

## 美术规范

- **画布逻辑宽固定 290**（高自上而下累加，不预设）。290 减边距边框后正好放 20 个汉字，是 12px 中文最好读的行宽。
- 底 `#f7f3e8`。主色／浅填充：紫 `#7b6cf6`/`#e8e4ff`、青 `#3fc1c9`/`#dff6f8`、金 `#f4a300`/`#fff3d6`、绿 `#5aa93f`/`#e6f7e2`。
- 正文与描边 `#2b2b3a`；**次要文字 `#5f5f70`**（`#7b7b8c` 太浅，别用）；投影 `#d9d3c4`；标题条白字。
- 面板切角＋右侧硬投影 3px＋左侧 5px 色条。
- 字体 `FONTS`：`fusion12`（默认）、`cubic11`、`fusion10`、`ark12`、`ark10`。

## 不画图的情况

正文本身就好几段、不点开看不完时 → 写自包含 HTML（内联 CSS、手机宽、深色模式）给链接。
**不确定画不画时，给文字。**
