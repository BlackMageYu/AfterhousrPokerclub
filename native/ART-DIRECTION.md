# 场景与 Logo 生成记录

使用内置 ImageGen（非外部 CLI），最终美术源文件：`assets/table-final-source.png`。原生 WPF 将美术源作为材质，并按参考图片中的固定锚点绘制为 `assets/scenes/table-low.png` 等五份场景，尺寸为 3000 × 1542；全部资产随游戏分发。

## 核心生成提示词

Production background bitmap for a native Windows Texas Holdem desktop game. Premium photorealistic 3D rendered poker table room viewed strictly from directly overhead at 90 degrees, orthographic camera, no perspective tilt. Horizontal stadium-shaped oval poker table, emerald green felt with subtle textile grain, thin inner betting line, black padded leather rail and restrained brass trim. Richly detailed walnut herringbone parquet, fine bevel seams, varied wood grain, subtle wear and warm overhead lighting. No people, cards, chips, avatars, controls or game UI.

## Logo 提示词

Original flat vector-style logo printed on felt. Minimal overlapping slanted playing cards: electric blue back card and crimson foreground card framing a white card with a tiny black spade. To the right, bold custom italic white sans-serif lettering on two lines: AFTERHOURS and POKER CLUB. A small superscript ™ immediately to the right of the second line. Keep flat ink, no embossing, no glow, no 3D. No WPT, GLOBAL or GOLD lettering.

## 构图与最后一轮提示词

Keep entire environment, camera, logo design and exact wording including the ™ to the right of POKER CLUB unchanged. Correct the table proportions to match the reference: outer rail top 15% of image height, bottom 73%, left 17%, right 82%. Keep floor below for controls. Logo centered at x=50%, y=44%, total width 15% of canvas. Same strict top-down view, detailed warm herringbone floor and top green wall. No UI, cards, chips or people.

## 原生布局校准

参考图尺寸 3832 × 1970。逻辑画布 1500 × 771。桌面外沿 x=255–1230、y=116–563，Logo 中心 x=750、y=340。美术生成不能保证逐像素坐标，因此原生场景布局通过连续切片采样对齐这些锚点，窗口缩放时统一等比缩放。公共牌、座位和按钮均为独立原生控件。

图标+文字的设计来自 AI 生成；场景的尺寸对齐与五档环境色差由原生绘制完成。
