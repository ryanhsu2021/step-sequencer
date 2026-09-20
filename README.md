# 多声部音序器 · Sequencer

零依赖的单页 Web 音序器：6 声部旋钮步进音序 + 鼓机 + 和弦进行轨 + 风格驱动的自动编曲。

## 功能

- **多声部音序**：最多 6 个声部（旋律 + 鼓），12 种合成音色，8 音行 × 16 步旋钮
- **每声部独立小节数**：1 / 2 / 3 / 4 / 8 小节，各自循环，加长自动平铺
- **和弦进行轨**：全曲和声的唯一来源，每段可自由换级数 / 改拍长 / 拆分 / 删除
- **♻ 跟随和弦 / ◌ 独立和声**：每个声部可选是否跟随和弦轨
- **✨ 优化旋律**：以手动摆放的音为锚点，风格约束下动态规划求整句最优；连点每次不同
- **🎲 随机生成**：无视现有内容，按当前风格从零生成全新旋律
- **🎼 一键编配**：按和弦轨补齐贝斯 / 琶音 / 铺底 / 鼓组，每次点击都不同
- **9 种音乐风格**：氛围 / 流行 / 电子 / 摇滚 / 嘻哈 / Trap / 爵士 / 民谣 / 国风
- **MIDI**：Web MIDI 实时输出 + 多轨 .mid 导出
- **持久化**：localStorage 自动保存（polyseq.v7），旧版本自动迁移

## 运行

无构建、无依赖：

```bash
# 直接双击 step-sequencer.html 即可
# 或起个静态服务器（多文件需要 http）：
python -m http.server 8000
# 打开 http://localhost:8000/step-sequencer.html
```

## 结构

```
step-sequencer.html   主页（按依赖顺序加载下列模块）
css/style.css         全部样式
js/
  01-core.js          基础常量与工具
  02-modes.js         调式体系
  03-styles.js        音色库 · 音乐风格 · 配色
  04-drums.js         鼓机预设
  10-state.js         数据模型 · 持久化
  20-ui.js            渲染（声部卡 / 旋钮 / 和弦轨 UI）
  21-interact.js      旋钮交互 · 声部操作
  30-audio.js         音频引擎（合成音色）
  31-transport.js     播放调度
  32-midi.js          MIDI
  40-optimizer.js     ✨ 优化 / 🎲 随机生成（DP）
  41-chords.js        和弦进行轨模型
  42-arrange.js       🎼 一键编配
  50-main.js          控件接线 · 启动
test-sequencer.js     无头测试（Node vm，39 断言）：node test-sequencer.js
```
