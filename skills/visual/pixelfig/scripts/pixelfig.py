#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""pixelfig —— 像素画布封装。

在很小的逻辑画布上 1:1 作画，最后用最近邻整数倍放大输出真实 PNG。
所有文字渲染后二值化，保证放大后没有抗锯齿灰边。
"""
import glob
import os

from PIL import Image, ImageDraw, ImageFont

# ---- 字体查找（可移植，不写死单机路径） ----
# 依次在这些目录里找字体；PIXELFIG_FONT_DIR 可覆盖。
_HERE = os.path.dirname(os.path.abspath(__file__))
FONT_DIRS = [
    os.environ.get("PIXELFIG_FONT_DIR", ""),
    os.path.join(_HERE, os.pardir, "fonts"),          # 技能自带 fonts/
    os.path.expanduser("~/.fonts/pixel"),
    "/usr/share/fonts/pixel",
    "/usr/local/share/fonts/pixel",
    "/Library/Fonts/pixel",
]
FONT_DIRS = [os.path.abspath(d) for d in FONT_DIRS if d]

# 每个字体给出候选文件名（精确名 + 宽松通配），第一个命中的即用
_FONT_CANDIDATES = {
    "fusion12": ["fusion-pixel-12px-proportional-zh_hans.ttf", "*12px*proportional*zh*"],
    "cubic11":  ["Cubic_11.ttf", "cubic*11*.ttf", "*Cubic*11*.ttf"],
    "fusion10": ["fusion-pixel-10px-proportional-zh_hans.ttf", "*10px*proportional*zh*"],
    "ark12":    ["ark-pixel-12px-proportional-zh_hans.ttf"],
    "ark10":    ["ark-pixel-10px-proportional-zh_hans.ttf"],
}


def _locate(names):
    for d in FONT_DIRS:
        for n in names:
            if os.path.isfile(os.path.join(d, n)):
                return os.path.join(d, n)
            for hit in sorted(glob.glob(os.path.join(d, n))):
                return hit
    return None


FONTS = {}
for _alias, _names in _FONT_CANDIDATES.items():
    _p = _locate(_names)
    if _p:
        FONTS[_alias] = _p

if "fusion12" not in FONTS and "cubic11" not in FONTS:
    raise SystemExit(
        "找不到像素中文字体。请先跑 scripts/install-fonts.sh，"
        "或设置环境变量 PIXELFIG_FONT_DIR 指向字体目录。\n"
        "（查找过：%s）" % "、".join(FONT_DIRS)
    )

FONT_PATH = FONTS.get("fusion12") or FONTS["cubic11"]
DEFAULT_FONT = "fusion12" if "fusion12" in FONTS else "cubic11"

# 底色 / 墨色
BG      = "#f7f3e8"
INK     = "#2b2b3a"
MUTED   = "#7b7b8c"
MUTED_2 = "#5f5f70"   # 小字专用的加深灰，对比度更够
SHADOW  = "#d9d3c4"
WHITE   = "#fffdf7"
# 四个主色 + 浅色填充
PURPLE, PURPLE_L = "#7b6cf6", "#e8e4ff"
CYAN,   CYAN_L   = "#3fc1c9", "#dff6f8"
GOLD,   GOLD_L   = "#f4a300", "#fff3d6"
GREEN,  GREEN_L  = "#5aa93f", "#e6f7e2"

ICONS = {
    "chip": [
        "...........",
        "..#######..",
        ".##.....##.",
        "###########",
        "#.#.....#.#",
        "#.#.....#.#",
        "###########",
        ".##.....##.",
        "..#######..",
        "...........",
        "...........",
    ],
    "disk": [
        "...........",
        ".#########.",
        ".#.......#.",
        ".#.#####.#.",
        ".#.#...#.#.",
        ".#.#...#.#.",
        ".#.#####.#.",
        ".#.......#.",
        ".#########.",
        "...........",
        "...........",
    ],
}

_cache = {}


def use_font(name):
    """切换当前字体（FONTS 里的键名或直接给路径）。"""
    global FONT_PATH
    FONT_PATH = FONTS.get(name, name)
    _cache.clear()
    return FONT_PATH

def font(size):
    key = (FONT_PATH, size)
    if key not in _cache:
        _cache[key] = ImageFont.truetype(FONT_PATH, size)
    return _cache[key]


class Canvas:
    def __init__(self, w, h, bg=BG):
        self.w, self.h = w, h
        self.img = Image.new("RGB", (w, h), bg)
        self.d = ImageDraw.Draw(self.img)

    # ---------- 基础图形 ----------

    def rect(self, x, y, w, h, color):
        if w <= 0 or h <= 0:
            return
        self.d.rectangle([x, y, x + w - 1, y + h - 1], fill=color)

    def _notched(self, x, y, w, h, n):
        """切角矩形顶点（四个角各切掉 n×n 的直角缺口）。"""
        return [
            (x + n, y), (x + w - 1 - n, y),
            (x + w - 1, y + n), (x + w - 1, y + h - 1 - n),
            (x + w - 1 - n, y + h - 1), (x + n, y + h - 1),
            (x, y + h - 1 - n), (x, y + n),
        ]

    def panel(self, x, y, w, h, accent=None, fill=WHITE, notch=4, shadow=True):
        """切角面板 + 右侧硬投影 + 可选左侧 5px 色条。"""
        if shadow:
            self.d.polygon(self._notched(x + 3, y + 3, w, h, notch), fill=SHADOW)
        pts = self._notched(x, y, w, h, notch)
        self.d.polygon(pts, fill=fill)
        self.d.line(pts + [pts[0]], fill=INK, width=1)
        if accent:
            self.rect(x + 1, y + notch + 1, 5, h - 2 * notch - 2, accent)

    def bar(self, x, y, w, h, fill, text_color="#ffffff", label=None, size=12):
        """实色标题条。"""
        self.rect(x, y, w, h, fill)
        if label:
            tw, th = self.text_size(label, size)
            self.text(x + (w - tw) // 2, y + (h - th) // 2, label, size, text_color)

    # ---------- 文字（二值化，无抗锯齿） ----------

    def text_size(self, s, size=12):
        f = font(size)
        tmp = Image.new("L", (size * len(s) + 24, size * 3), 0)
        ImageDraw.Draw(tmp).text((4, 4), s, font=f, fill=255)
        tmp = tmp.point(lambda v: 255 if v >= 110 else 0)
        bbox = tmp.getbbox()
        if not bbox:
            return (0, 0)
        return (bbox[2] - bbox[0], bbox[3] - bbox[1])

    def text(self, x, y, s, size=12, color=INK):
        """x,y 为文字视觉左上角。返回实际宽度。"""
        tmp = Image.new("L", (size * len(s) + 24, size * 3), 0)
        ImageDraw.Draw(tmp).text((4, 4), s, font=font(size), fill=255)
        tmp = tmp.point(lambda v: 255 if v >= 110 else 0)
        bbox = tmp.getbbox()
        if not bbox:
            return 0
        tmp = tmp.crop(bbox)
        self.img.paste(Image.new("RGB", tmp.size, color), (x, y), tmp)
        return tmp.size[0]

    def text_c(self, cx, y, s, size=12, color=INK):
        """以 cx 为水平中心。"""
        w, _ = self.text_size(s, size)
        return self.text(cx - w // 2, y, s, size, color)

    def small(self, x, y, s, color=MUTED_2):
        """次要文字。字号仍是 12px，只靠颜色区分层级。

        ⚠️ 中文像素字的下限就是 12px，不要再往下压：
        - 像素字只为整数格子设计，12px 字体压到 11/10px 会直接断笔画
          （实测 Fusion 压 10px，「到/西/东」缺笔）
        - 独立发行的 10px 档像素中文只覆盖 4192 字形，根本盖不住中文
        - 就算字形"完整"，11×11 格子也塞不下十几笔，字内会糊成一团
        要做层级就用：颜色深浅 / 缩进 / 分隔线，别动字号。
        """
        return self.text(x, y, s, 12, color)

    def small_c(self, cx, y, s, color=MUTED_2):
        """居中的次要文字（同 small，字号 12px）。"""
        w, _ = self.text_size(s, 12)
        return self.text(cx - w // 2, y, s, 12, color)

    # ---------- 图标与箭头 ----------

    def icon(self, x, y, rows, color, cell=1):
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch == "#":
                    self.rect(x + i * cell, y + j * cell, cell, cell, color)

    def icon_c(self, cx, y, rows, color, cell=1):
        w = len(rows[0]) * cell
        self.icon(cx - w // 2, y, rows, color, cell)

    def tri_down(self, cx, y, color, s=5):
        for i in range(s):
            self.rect(cx - (s - 1 - i), y + i, 1 + 2 * (s - 1 - i), 1, color)

    def arrow_v(self, x, y, length, color):
        self.rect(x, y, 1, length - 4, color)
        self.tri_down(x, y + length - 4, color, 3)

    def arrow_h(self, x, y, length, color):
        self.rect(x, y, length - 4, 1, color)
        for i in range(4):
            self.rect(x + length - 4 + i, y - i, 1, 1 + 2 * i, color)

    # ---------- 输出 ----------

    def save(self, path, scale=3):
        self.img.resize((self.w * scale, self.h * scale), Image.NEAREST).save(path)
        return path
