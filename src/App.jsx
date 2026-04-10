import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import * as XLSX from 'xlsx'
import StatsDashboard from './components/StatsDashboard'
import WordBank from './components/WordBank'
import Login from './components/Login'
import { useFirebase } from './hooks/useFirebase'
import { useFirestoreBank } from './hooks/useFirestore'

// ─── Combo Hash Utility (FNV-1a variant, pure JS) ───────────────────────────
const COMBO_SALT = 'INLIC_2026_SECURE'

function computeComboHash(wordId, comboCount) {
  const input = `${wordId}|${comboCount}|${COMBO_SALT}`
  // FNV-1a 32-bit
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = (Math.imul(hash, 0x01000193) >>> 0)
  }
  return hash.toString(16).toUpperCase().padStart(8, '0')
}

// ─── CSS (injected once at module level) ──────────────────────────────────────
const css = `
  * { box-sizing: border-box; }
  body, html { margin: 0; padding: 0; }

  :root {
    --pixel-font: 'DotGothic16', sans-serif;
    --green:   #00ff9f;
    --dkgreen: #008c57;
    --red:     #ff4d6d;
    --dkred:   #8c0020;
    --yellow:  #ffd600;
    --orange:  #ff9900;
    --blue:    #5b8cff;
    --bg:      #1a1a2e;
    --panel:   #0d0d1a;
    --muted:   #8892b0;
    --border:  #2a2a4a;
  }

  .pixel-app {
    font-family: var(--pixel-font);
    background: var(--bg);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 16px 16px 40px;
    position: relative;
    overflow-x: hidden;
  }

  /* CRT scanlines overlay */
  .pixel-app::before {
    content: '';
    position: fixed; inset: 0;
    background: repeating-linear-gradient(
      0deg, transparent, transparent 2px,
      rgba(0,0,0,0.055) 2px, rgba(0,0,0,0.055) 4px
    );
    pointer-events: none; z-index: 999;
  }

  /* ── Stars ── */
  .pixel-stars { position: fixed; inset: 0; pointer-events: none; z-index: 0; }
  .star {
    position: absolute; width: 2px; height: 2px; background: #fff;
    opacity: 0; image-rendering: pixelated;
    animation: twinkle var(--dur,3s) var(--delay,0s) ease-in-out infinite;
  }
  @keyframes twinkle { 0%,100%{opacity:0} 50%{opacity:var(--op,0.4)} }

  /* ── Header ── */
  .pixel-header {
    text-align: center; margin-bottom: 12px;
    position: relative; z-index: 1;
    display: flex; align-items: center; gap: 18px;
  }
  .pixel-title {
    font-size: 18px; color: var(--green); margin: 0;
    text-shadow: 3px 3px 0 var(--dkgreen);
    letter-spacing: 3px; line-height: 1.45; white-space: nowrap;
  }
  .pixel-subtitle { font-size: 10px; color: var(--muted); letter-spacing: 2px; margin: 0; }
  .blink {
    display: inline-block; width: 9px; height: 14px;
    background: var(--green); margin-left: 4px; vertical-align: middle;
    animation: blink-anim 1s step-end infinite; image-rendering: pixelated;
  }
  @keyframes blink-anim { 0%,100%{opacity:1} 50%{opacity:0} }

  /* ── SCHED timer bar ── */
  .timer-strip {
    width: 100%; max-width: 1400px; margin-bottom: 8px;
    position: relative; z-index: 1;
    display: flex; align-items: center; gap: 10px;
  }
  .timer-label { font-size: 10px; color: var(--muted); letter-spacing: 1.5px; white-space: nowrap; }
  .timer-bar-track {
    flex: 1; height: 8px; border: 2px solid var(--border);
    background: var(--panel); position: relative; overflow: hidden;
  }
  .timer-bar-fill {
    position: absolute; left: 0; top: 0; bottom: 0;
    background: var(--green); transition: width 1s linear;
  }
  .timer-bar-fill.low { background: var(--red); animation: pulse-red 0.5s step-end infinite; }
  @keyframes pulse-red { 0%,100%{background:var(--red)} 50%{background:#ff9999} }
  .timer-countdown { font-size: 11px; color: var(--green); min-width: 46px; text-align: right; }
  .timer-countdown.low { color: var(--red); }
  .next-card-chip {
    font-size: 10px; color: var(--green); background: var(--panel);
    border: 2px solid var(--border); padding: 2px 8px;
    white-space: nowrap; letter-spacing: 1px; min-width: 110px; text-align: center;
  }
  .next-card-chip.low { border-color: var(--red); color: var(--red); animation: pulse-red 0.5s step-end infinite; }
  .board-chip {
    font-size: 10px; color: var(--bg);
    background: var(--orange); padding: 2px 8px;
    white-space: nowrap; letter-spacing: 1px;
  }
  .board-chip.empty { background: var(--muted); }
  .board-chip.many  { background: var(--red); animation: pulse-red 1s step-end infinite; }

  /* ── Settings Gear Button ── */
  .settings-gear-btn {
    background: transparent; border: 2px solid var(--border);
    color: var(--muted); font-size: 15px; width: 32px; height: 32px;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: color 0.1s, border-color 0.1s; flex-shrink: 0;
    font-family: var(--pixel-font); letter-spacing: 0;
  }
  .settings-gear-btn:hover  { color: var(--green); border-color: var(--green); }
  .settings-gear-btn.active { color: var(--green); border-color: var(--green); background: rgba(0,255,159,0.07); }

  .logout-btn {
    background: transparent; border: 2px solid var(--border);
    color: var(--muted); font-size: 14px; width: 32px; height: 32px;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: color 0.1s, border-color 0.1s, background 0.1s; flex-shrink: 0;
    font-family: var(--pixel-font); letter-spacing: 0;
  }
  .logout-btn:hover { color: var(--red); border-color: var(--red); background: rgba(255,77,109,0.07); }

  /* ── Settings Panel ── */
  .settings-panel {
    width: 100%; max-width: 1400px; margin-bottom: 8px;
    background: var(--panel); border: 2px solid var(--green);
    box-shadow: 4px 4px 0 var(--dkgreen);
    padding: 14px 18px; position: relative; z-index: 2;
    display: flex; flex-wrap: wrap; align-items: center; gap: 14px;
  }
  .settings-panel-title {
    font-size: 11px; color: var(--green); letter-spacing: 2px;
    white-space: nowrap; flex-shrink: 0;
  }
  .settings-divider { width: 2px; height: 22px; background: var(--border); flex-shrink: 0; }
  .settings-field   { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .settings-field-label {
    font-size: 10px; color: var(--muted); letter-spacing: 1px; white-space: nowrap;
  }
  .settings-input {
    font-family: var(--pixel-font); font-size: 13px;
    background: #050510; color: var(--green);
    border: 3px solid var(--border); padding: 6px 10px;
    width: 72px; outline: none; letter-spacing: 1px;
    caret-color: var(--green); text-align: center;
    transition: border-color 0.15s;
  }
  .settings-input:focus { border-color: var(--green); }
  .settings-unit { font-size: 10px; color: var(--muted); letter-spacing: 1px; }
  .settings-apply-btn {
    font-family: var(--pixel-font); font-size: 10px;
    background: var(--green); color: var(--bg);
    border: 3px solid var(--green); padding: 6px 12px;
    cursor: pointer; letter-spacing: 1px;
    box-shadow: 3px 3px 0 var(--dkgreen); transition: all 0.08s;
  }
  .settings-apply-btn:hover  { transform: translate(1px,1px); box-shadow: 2px 2px 0 var(--dkgreen); }
  .settings-apply-btn:active { transform: translate(3px,3px); box-shadow: none; }
  .settings-info {
    font-size: 9px; color: var(--muted); letter-spacing: 1px; line-height: 1.8;
    margin-left: auto;
  }

  /* ── Whiteboard Canvas ── */
  .whiteboard-wrapper {
    width: 100%; max-width: 1400px;
    margin-bottom: 18px; position: relative; z-index: 1;
    flex: 1; display: flex; flex-direction: column;
  }
  .whiteboard-label {
    font-size: 11px; color: var(--green); letter-spacing: 1.5px;
    margin-bottom: 6px; display: flex; align-items: center; gap: 10px;
  }
  .whiteboard-label::before { content: '▶'; font-size: 9px; }
  .wb-label-count { font-size: 9px; color: var(--muted); border: 2px solid var(--border); padding: 1px 6px; }

  .whiteboard {
    min-height: 80vh; flex: 1;
    border: 4px solid var(--green);
    box-shadow: 6px 6px 0 var(--dkgreen), inset 0 0 60px rgba(0,255,159,0.03);
    position: relative;
    padding: 32px 20px 32px;
    overflow: hidden;
    background-color: #ece8e0;
    background-image:
      radial-gradient(circle, rgba(80,110,160,0.28) 1px, transparent 1px),
      repeating-linear-gradient(0deg, transparent, transparent 27px, rgba(130,160,200,0.22) 27px, rgba(130,160,200,0.22) 28px),
      repeating-linear-gradient(90deg, transparent, transparent 27px, rgba(130,160,200,0.10) 27px, rgba(130,160,200,0.10) 28px);
    background-size: 28px 28px, 100% 100%, 100% 100%;
  }
  .whiteboard::before, .whiteboard::after {
    content: ''; position: absolute;
    width: 12px; height: 12px; background: var(--bg); z-index: 2;
  }
  .whiteboard::before { top: -4px; right: -4px; }
  .whiteboard::after  { bottom: -4px; left: -4px; }

  .wb-tack {
    position: absolute; z-index: 3;
    width: 10px; height: 10px; border-radius: 50%; background: #c8a880;
    border: 2px solid #9a7a54; box-shadow: inset 0 1px 0 rgba(255,255,255,0.3);
  }
  .wb-tack.tl { top: 10px;    left: 10px;  }
  .wb-tack.tr { top: 10px;    right: 10px; }
  .wb-tack.bl { bottom: 10px; left: 10px;  }
  .wb-tack.br { bottom: 10px; right: 10px; }

  .whiteboard-cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
    gap: 36px 28px;
    align-content: start;
    min-height: calc(80vh - 64px);
  }

  /* ── Empty state ── */
  .wb-empty {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    pointer-events: none; text-align: center; z-index: 0;
  }
  .wb-empty-icon  { font-size: 38px; margin-bottom: 14px; animation: float 3s ease-in-out infinite; filter: grayscale(0.3); }
  @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
  .wb-empty-title { font-size: 14px; color: #9a9080; margin: 0 0 10px; letter-spacing: 1px; }
  .wb-empty-hint  { font-size: 10px; color: #b0a898; margin: 0; line-height: 2.4; letter-spacing: 1px; }

  /* ── Post-it Card ── */
  .postit-card {
    position: relative; display: flex; flex-direction: column;
    box-shadow: 4px 6px 0 rgba(0,0,0,0.25), 0 2px 0 rgba(0,0,0,0.1);
    transform: rotate(var(--rot,0deg)); transform-origin: center top;
    animation: card-pop 0.26s steps(4) forwards;
    transition: box-shadow 0.1s, transform 0.18s; z-index: 1;
  }
  .postit-card:hover {
    box-shadow: 7px 10px 0 rgba(0,0,0,0.32);
    transform: rotate(var(--rot,0deg)) translateY(-6px) scale(1.025); z-index: 10;
  }
  @keyframes card-pop {
    0%  { transform: rotate(var(--rot,0deg)) scale(0.4) translateY(30px); opacity: 0; }
    55% { transform: rotate(var(--rot,0deg)) scale(1.07) translateY(-5px); opacity: 1; }
    100%{ transform: rotate(var(--rot,0deg)) scale(1); opacity: 1; }
  }
  .postit-card.master     { background: #e4fff2; border: 3px solid #00cc7a; }
  .postit-card.learning   { background: #e6eeff; border: 3px solid #5b8cff; }
  .postit-card.struggling { background: #fffce4; border: 3px solid #c8a000; }
  .postit-card.weak       { background: #fff4e4; border: 3px solid #cc6600; }
  .postit-card.critical   {
    background: #fff0f3; border: 3px solid #cc0020;
    animation: card-pop 0.26s steps(4) forwards, card-crit 1.4s step-end infinite 0.4s;
  }
  @keyframes card-crit { 0%,100%{border-color:#cc0020} 50%{border-color:#ff668a} }
  .postit-card.new {
    background: #fef0ff; border: 3px solid #cc00cc;
    animation: card-pop 0.26s steps(4) forwards, card-new 0.9s step-end infinite 0.4s;
  }
  @keyframes card-new { 0%,100%{border-color:#cc00cc} 50%{border-color:#ff66ff} }

  /* ── Prestige Tier Overrides (Combo System) ── */
  /* Common Sweep Animation Layer for all prestige tiers */
  .prestige-sweep {
    position: absolute; top: -50%; left: -50%; width: 200%; height: 200%;
    animation: prestige-sweep-anim 3s linear infinite; pointer-events: none; z-index: 5;
  }
  @keyframes prestige-sweep-anim {
    0% { transform: translate(-100%, -100%); opacity: 0; }
    15% { opacity: 1; }
    35% { transform: translate(50%, 50%); opacity: 0; }
    100% { transform: translate(50%, 50%); opacity: 0; }
  }
  
  .sweep-silver {
    background: linear-gradient(135deg, transparent 40%, rgba(255,255,255,0.6) 45%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0.6) 55%, transparent 60%);
    mix-blend-mode: overlay;
  }
  .sweep-gold {
    background: linear-gradient(135deg, transparent 40%, rgba(255,250,220,0.5) 45%, rgba(255,255,220,0.95) 50%, rgba(255,250,220,0.5) 55%, transparent 60%);
    mix-blend-mode: soft-light; filter: brightness(1.15);
  }
  .sweep-diamond {
    background: linear-gradient(135deg, transparent 40%, rgba(255,255,255,0.5) 45%, rgba(255,255,255,0.9) 48%, rgba(128,222,234,1) 50%, rgba(178,235,242,1) 52%, rgba(255,255,255,0.9) 55%, transparent 60%);
    mix-blend-mode: color-dodge; animation-duration: 2.2s; 
  }

  /* Tier 1 – Silver (combo ≥ 2) */
  .postit-card.prestige-silver {
    background: linear-gradient(135deg, #e4e4ed 0%, #c8c8d8 25%, #f4f4ff 50%, #bcbccf 75%, #e4e4ed 100%) !important;
    background-size: 400% 400% !important;
    border: 3px solid #aaaacc !important;
    animation: card-pop 0.26s steps(4) forwards, silver-shimmer 3s ease-in-out infinite 0.4s !important;
    box-shadow: 4px 6px 0 rgba(0,0,0,0.25), 0 0 16px rgba(160,180,240,0.6) !important;
    overflow: hidden;
  }
  .postit-card.prestige-silver .postit-pin { background: #b0b0d0 !important; }
  @keyframes silver-shimmer {
    0%   { background-position: 0% 50%; border-color: #aaaacc; box-shadow: 4px 6px 0 rgba(0,0,0,0.25), 0 0 10px rgba(180,180,220,0.4); }
    25%  { border-color: #ccccee; box-shadow: 4px 6px 0 rgba(0,0,0,0.25), 0 0 20px rgba(200,200,255,0.7); }
    50%  { background-position: 100% 50%; border-color: #aaaacc; box-shadow: 4px 6px 0 rgba(0,0,0,0.25), 0 0 10px rgba(180,180,220,0.4); }
    75%  { border-color: #ccccee; box-shadow: 4px 6px 0 rgba(0,0,0,0.25), 0 0 20px rgba(200,200,255,0.7); }
    100% { background-position: 0% 50%; border-color: #aaaacc; box-shadow: 4px 6px 0 rgba(0,0,0,0.25), 0 0 10px rgba(180,180,220,0.4); }
  }

  /* Tier 2 – Gold (combo ≥ 10) */
  .postit-card.prestige-gold {
    background: linear-gradient(135deg, #fff0a0 0%, #ffd700 20%, #ffc800 40%, #ffeb60 60%, #ffa500 80%, #fff0a0 100%) !important;
    background-size: 400% 400% !important;
    border: 3px solid #cc9900 !important;
    animation: card-pop 0.26s steps(4) forwards, gold-shimmer 2s ease-in-out infinite 0.4s !important;
    box-shadow: 4px 6px 0 rgba(0,0,0,0.25), 0 0 24px rgba(255,180,0,0.8), inset 0 0 15px rgba(255,215,0,0.3) !important;
    overflow: hidden;
  }
  .postit-card.prestige-gold::after {
    content: ''; position: absolute; inset: -50px; pointer-events: none; z-index: 5;
    background-image: radial-gradient(rgba(255,220,100,0.8) 1.5px, transparent 2px), radial-gradient(rgba(255,255,255,0.9) 1px, transparent 2px);
    background-size: 30px 40px, 45px 55px;
    background-position: 0 0, 15px 20px;
    animation: gold-dust 4s linear infinite;
    mix-blend-mode: color-dodge;
  }
  @keyframes gold-dust {
    0% { transform: translateY(0); opacity: 0.1; }
    50% { opacity: 0.6; }
    100% { transform: translateY(-40px); opacity: 0.1; }
  }
  .postit-card.prestige-gold .postit-pin { background: #ffcc00 !important; }
  @keyframes gold-shimmer {
    0%   { background-position: 0% 50%; border-color: #cc9900; box-shadow: 4px 6px 0 rgba(0,0,0,0.25), 0 0 18px rgba(255,180,0,0.5); }
    25%  { border-color: #ffdd00; box-shadow: 4px 6px 0 rgba(0,0,0,0.25), 0 0 35px rgba(255,220,0,0.9); }
    50%  { background-position: 100% 50%; border-color: #cc9900; box-shadow: 4px 6px 0 rgba(0,0,0,0.25), 0 0 18px rgba(255,180,0,0.5); }
    75%  { border-color: #ffdd00; box-shadow: 4px 6px 0 rgba(0,0,0,0.25), 0 0 35px rgba(255,220,0,0.9); }
    100% { background-position: 0% 50%; border-color: #cc9900; box-shadow: 4px 6px 0 rgba(0,0,0,0.25), 0 0 18px rgba(255,180,0,0.5); }
  }

  /* Tier 3 – Diamond (combo ≥ 20) */
  .postit-card.prestige-diamond {
    background: linear-gradient(
      135deg,
      #e0f7fa, #b2ebf2, #ffffff,
      #80deea, #e0f7fa, #ffffff,
      #b2ebf2, #e0f7fa, #ffffff,
      #80deea, #b2ebf2, #e0f7fa,
      #ffffff
    ) !important;
    background-size: 800% 800% !important;
    border: 3px solid #80deea !important;
    animation: card-pop 0.26s steps(4) forwards, diamond-holo 2.5s linear infinite 0.4s !important;
    box-shadow: 4px 6px 0 rgba(0,0,0,0.25), 0 0 30px rgba(128,222,234,0.8), inset 0 0 40px rgba(255,255,255,0.6) !important;
    overflow: hidden;
  }
  .postit-card.prestige-diamond::before,
  .postit-card.prestige-diamond::after {
    content: '✦'; position: absolute; color: white; font-family: sans-serif; font-size: 24px; line-height: 1; pointer-events: none; z-index: 8;
    text-shadow: 0 0 5px white, 0 0 10px #80deea, 0 0 15px #b2ebf2;
    animation: flare-anim 1.5s linear infinite;
  }
  .postit-card.prestige-diamond::before { top: -6px; left: -2px; }
  .postit-card.prestige-diamond::after { bottom: -6px; right: -2px; animation-delay: -0.75s; }
  
  @keyframes flare-anim {
    0%   { transform: rotate(0deg) scale(0.5); opacity: 0.3; }
    25%  { transform: rotate(45deg) scale(1.3); opacity: 1; text-shadow: 0 0 10px white, 0 0 20px #80deea; }
    50%  { transform: rotate(90deg) scale(0.5); opacity: 0.3; }
    75%  { transform: rotate(135deg) scale(1.3); opacity: 1; text-shadow: 0 0 10px white, 0 0 20px #b2ebf2; }
    100% { transform: rotate(180deg) scale(0.5); opacity: 0.3; }
  }

  .postit-card.prestige-diamond .postit-pin { background: #80deea !important; animation: diamond-pin 0.9s step-end infinite !important; }
  @keyframes diamond-pin { 0%,100%{background:#80deea} 33%{background:#b2ebf2} 66%{background:#e0f7fa} }
  @keyframes diamond-holo {
    0%   { background-position: 0% 0%; border-color: #80deea; box-shadow: 4px 6px 0 rgba(0,0,0,0.25), 0 0 30px rgba(128,222,234,0.8); }
    16%  { border-color: #b2ebf2; box-shadow: 4px 6px 0 rgba(0,0,0,0.25), 0 0 45px rgba(178,235,242,1); }
    33%  { background-position: 50% 100%; border-color: #e0f7fa; box-shadow: 4px 6px 0 rgba(0,0,0,0.25), 0 0 45px rgba(224,247,250,1); }
    50%  { border-color: #80deea; box-shadow: 4px 6px 0 rgba(0,0,0,0.25), 0 0 30px rgba(128,222,234,0.8); }
    66%  { border-color: #b2ebf2; box-shadow: 4px 6px 0 rgba(0,0,0,0.25), 0 0 45px rgba(178,235,242,1); }
    83%  { background-position: 100% 0%; border-color: #e0f7fa; box-shadow: 4px 6px 0 rgba(0,0,0,0.25), 0 0 45px rgba(224,247,250,1); }
    100% { background-position: 0% 0%; border-color: #80deea; box-shadow: 4px 6px 0 rgba(0,0,0,0.25), 0 0 30px rgba(128,222,234,0.8); }
  }
  /* Floating sparkle particles inside diamond cards */
  .diamond-sparkle {
    position: absolute; pointer-events: none; z-index: 6;
    width: 4px; height: 4px; image-rendering: pixelated;
    animation: sparkle-float var(--sdur, 2s) ease-in-out var(--sdelay, 0s) infinite;
  }
  @keyframes sparkle-float {
    0%   { transform: translate(0, 0) scale(0); opacity: 0; }
    20%  { opacity: 1; transform: translate(var(--sx,0px), var(--sy,-10px)) scale(1.2); }
    80%  { opacity: 0.6; transform: translate(var(--sx2,4px), var(--sy2,-28px)) scale(0.8); }
    100% { opacity: 0; transform: translate(var(--sx3, 8px), var(--sy3,-40px)) scale(0); }
  }
  .postit-card.card-exit { animation: card-exit 0.38s steps(5) forwards !important; pointer-events: none; }
  @keyframes card-exit {
    0%  { transform: rotate(var(--rot,0deg)) scale(1); opacity: 1; }
    40% { transform: rotate(calc(var(--rot,0deg) + 12deg)) scale(1.12); opacity: 0.7; }
    100%{ transform: rotate(calc(var(--rot,0deg) + 22deg)) scale(0); opacity: 0; }
  }

  /* ── Pushpin ── */
  .postit-pin {
    position: absolute; top: -11px; left: 50%; transform: translateX(-50%);
    width: 17px; height: 17px; border-radius: 50%;
    border: 3px solid rgba(0,0,0,0.2); z-index: 4; image-rendering: pixelated;
    box-shadow: 0 3px 0 rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.35);
  }
  .postit-card.master     .postit-pin { background: #00e688; }
  .postit-card.learning   .postit-pin { background: #5b8cff; }
  .postit-card.struggling .postit-pin { background: #e8c000; }
  .postit-card.weak       .postit-pin { background: #ff9900; }
  .postit-card.critical   .postit-pin { background: var(--red); animation: pin-pulse 0.8s step-end infinite; }
  .postit-card.new        .postit-pin { background: #ff00ff;   animation: pin-pulse 0.5s step-end infinite; }
  @keyframes pin-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

  .postit-tape {
    height: 13px; background: rgba(195,212,248,0.45);
    border-bottom: 1px solid rgba(140,165,210,0.22);
    flex-shrink: 0; margin: 0 -3px;
  }
  .postit-header {
    padding: 10px 14px 6px; display: flex; justify-content: space-between;
    align-items: center; flex-shrink: 0;
  }
  .postit-badge {
    font-size: 12px; padding: 3px 7px; border: 2px solid;
    letter-spacing: 0.5px; display: inline-flex; align-items: center; gap: 3px;
  }
  .postit-badge.master     { border-color: #008c57; color: #006640; }
  .postit-badge.learning   { border-color: #3a6aff; color: #2a50cc; }
  .postit-badge.struggling { border-color: #9a7800; color: #7a5c00; }
  .postit-badge.weak       { border-color: #994400; color: #773300; }
  .postit-badge.critical   { border-color: #cc0020; color: #aa0018; animation: badge-blink 0.8s step-end infinite; }
  .postit-badge.new        { border-color: #cc00cc; color: #aa00aa; animation: badge-blink 0.5s step-end infinite; }
  @keyframes badge-blink { 0%,100%{opacity:1} 50%{opacity:0.3} }

  .postit-err-bar { margin: 0 14px; height: 6px; background: rgba(0,0,0,0.08); overflow: hidden; }
  .postit-err-fill { height: 100%; transition: width 0.4s steps(10); }
  .postit-err-fill.master     { background: #00aa66; }
  .postit-err-fill.learning   { background: #3a6aff; }
  .postit-err-fill.struggling { background: #c8a000; }
  .postit-err-fill.weak       { background: #cc6600; }
  .postit-err-fill.critical   { background: #cc0020; }
  .postit-err-fill.new        { background: #cc00cc; animation: fill-pulse 0.5s step-end infinite; }
  @keyframes fill-pulse { 0%,100%{opacity:1} 50%{opacity:0.45} }

  .postit-diff-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 4px 14px 8px; gap: 6px;
  }
  .postit-diff-label { font-size: 11px; color: #999; letter-spacing: 0.5px; }
  .postit-diff-val   { font-size: 11px; color: #bbb; letter-spacing: 0.5px; }
  .postit-card.new .postit-diff-label { color: #cc00cc; }
  .postit-card.new .postit-diff-val   { color: #cc00cc; font-weight: bold; }

  .postit-new-stamp {
    position: absolute; top: 8px; right: 8px;
    background: #cc00cc; color: #fff; font-size: 10px; padding: 4px 8px;
    letter-spacing: 1px; z-index: 5; animation: stamp-blink 0.9s step-end infinite;
    box-shadow: 2px 2px 0 #660066;
  }
  @keyframes stamp-blink { 0%,100%{opacity:1} 50%{opacity:0.5} }

  /* ── Combo Badge (top-right of PostIt card) ── */
  .combo-badge {
    position: absolute; top: 8px; right: 8px;
    font-family: var(--pixel-font); font-size: 10px;
    letter-spacing: 1px; z-index: 7;
    padding: 3px 7px; border: 2px solid;
    pointer-events: none; white-space: nowrap;
  }
  .combo-badge.tier-silver {
    background: #c8c8e0; color: #3a3a6a; border-color: #8888bb;
    box-shadow: 2px 2px 0 #5a5a8a;
    animation: combo-silver-pulse 1.5s step-end infinite;
  }
  @keyframes combo-silver-pulse { 0%,100%{box-shadow:2px 2px 0 #5a5a8a} 50%{box-shadow:2px 2px 0 #8888cc, 0 0 8px rgba(180,180,255,0.7)} }
  .combo-badge.tier-gold {
    background: #ffe040; color: #5a3a00; border-color: #cc8800;
    box-shadow: 2px 2px 0 #7a5200;
    animation: combo-gold-pulse 0.9s step-end infinite;
  }
  @keyframes combo-gold-pulse { 0%,100%{box-shadow:2px 2px 0 #7a5200} 50%{box-shadow:2px 2px 0 #cc8800, 0 0 12px rgba(255,200,0,0.9)} }
  .combo-badge.tier-diamond {
    background: linear-gradient(90deg, #c8f4ff, #fce4ff, #c8f4ff);
    background-size: 200% 100%;
    color: #1a0a3a; border-color: #88ccff;
    box-shadow: 2px 2px 0 #4488aa;
    animation: combo-diamond-shift 0.7s linear infinite;
  }
  @keyframes combo-diamond-shift {
    0%   { background-position: 0% 50%; box-shadow: 2px 2px 0 #4488aa, 0 0 14px rgba(150,230,255,0.8); }
    33%  { background-position: 50% 50%; box-shadow: 2px 2px 0 #aa44cc, 0 0 14px rgba(200,150,255,0.8); }
    66%  { background-position: 100% 50%; box-shadow: 2px 2px 0 #44aaaa, 0 0 14px rgba(100,255,220,0.8); }
    100% { background-position: 0% 50%; box-shadow: 2px 2px 0 #4488aa, 0 0 14px rgba(150,230,255,0.8); }
  }

  /* ── Combo badge in WordBank cards ── */
  .word-card-combo {
    font-family: var(--pixel-font); font-size: 9px;
    padding: 1px 5px; border: 2px solid; letter-spacing: 0.5px;
    white-space: nowrap; margin-left: auto; flex-shrink: 0;
  }
  .word-card-combo.tier-silver { background: #c8c8e0; color: #3a3a6a; border-color: #8888bb; }
  .word-card-combo.tier-gold   { background: #ffe040; color: #5a3a00; border-color: #cc8800; }
  .word-card-combo.tier-diamond {
    background: linear-gradient(90deg, #c8f4ff, #fce4ff, #c8f4ff);
    background-size: 200% 100%;
    color: #1a0a3a; border-color: #88ccff;
    animation: combo-diamond-shift 0.7s linear infinite;
  }

  .postit-trigger { font-size: 11px; padding: 3px 6px; color: #777; background: rgba(0,0,0,0.06); letter-spacing: 0.5px; }
  .postit-trigger.early { color: #994400; background: rgba(255,150,0,0.14); }

  .postit-body { padding: 0 14px 12px; flex: 1; }
  .postit-meaning { font-size: 18px; color: #1a1a2e; line-height: 1.6; margin: 0 0 6px; word-break: break-word; }
  .postit-hint    { font-size: 13px; color: #aaa; margin: 0 0 10px; letter-spacing: 0.5px; }
  .postit-blanks  { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
  .blank-box {
    width: 20px; height: 26px; border-bottom: 3px solid #555;
    display: flex; align-items: flex-end; justify-content: center; padding-bottom: 2px;
  }
  .blank-box span { font-size: 18px; color: #1a1a2e; line-height: 1; font-weight: bold; }

  .postit-input-row { display: flex; border-top: 2px solid rgba(0,0,0,0.1); flex-shrink: 0; }
  .postit-input {
    font-family: var(--pixel-font); font-size: 16px;
    background: rgba(255,255,255,0.68); color: #1a1a2e;
    border: none; border-right: 2px solid rgba(0,0,0,0.1);
    padding: 10px 12px; flex: 1; outline: none; caret-color: #333; min-width: 0;
  }
  .postit-input:focus { background: rgba(255,255,255,0.95); }
  .postit-input.anim-shake {
    animation: input-shake 0.32s steps(4);
    background: #fff0f2 !important; color: #cc0020 !important;
  }
  .postit-input.anim-flash { animation: input-flash 0.3s steps(3); }
  @keyframes input-shake {
    0%,100%{transform:translateX(0)} 25%{transform:translateX(-5px)} 75%{transform:translateX(5px)}
  }
  @keyframes input-flash {
    0%  {background:rgba(0,255,159,0.06);}
    50% {background:rgba(0,255,159,0.32);}
    100%{background:rgba(255,255,255,0.95);}
  }
  .postit-submit {
    font-family: var(--pixel-font); font-size: 14px;
    background: rgba(0,0,0,0.07); color: #333;
    border: none; padding: 10px 14px; cursor: pointer;
    letter-spacing: 0.5px; white-space: nowrap; transition: background 0.08s;
  }
  .postit-submit:hover  { background: rgba(0,0,0,0.16); }
  .postit-submit:active { background: rgba(0,0,0,0.28); }
  .postit-hint-btn { color: var(--orange); border-right: 2px solid rgba(0,0,0,0.1); width: 44px; font-weight: bold; font-size: 15px; }
  .postit-hint-btn:disabled { opacity: 0.4; cursor: not-allowed; background: rgba(0,0,0,0.07); color: rgba(0,0,0,0.3); }

  .postit-result {
    padding: 12px 14px; display: flex; flex-direction: column;
    align-items: center; gap: 4px; flex-shrink: 0;
    border-top: 2px solid rgba(0,0,0,0.08);
    animation: result-pop 0.12s steps(2) forwards;
  }
  @keyframes result-pop { 0%{transform:scale(0.85);opacity:0} 100%{transform:scale(1);opacity:1} }
  .postit-result.success { background: rgba(0,200,120,0.1); }
  .postit-result.failure { background: rgba(255,77,109,0.08); }
  .postit-result-emoji  { font-size: 26px; line-height: 1; }
  .postit-result-text   { font-size: 14px; letter-spacing: 0.5px; }
  .postit-result.success .postit-result-text { color: #007a44; }
  .postit-result.failure .postit-result-text { color: #8c0020; }
  .postit-result-sub    { font-size: 11px; color: #777; letter-spacing: 0.5px; text-align: center; }

  /* ── Pixel Diff UI ── */
  .diff-row {
    display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px;
  }
  .diff-box {
    width: 26px; height: 32px; border: 2px solid transparent;
    display: flex; align-items: center; justify-content: center;
    image-rendering: pixelated; flex-shrink: 0;
  }
  .diff-box span { font-size: 16px; line-height: 1; font-family: var(--pixel-font); font-weight: bold; }
  .diff-box.correct {
    background: rgba(0,220,140,0.22); border-color: #00aa66; color: #005c38;
  }
  .diff-box.wrong {
    background: rgba(255,77,109,0.18); border-color: #cc0020; color: #cc0020;
  }
  .diff-box.wrong span {
    text-decoration: line-through; text-decoration-color: #cc0020;
    text-decoration-thickness: 2px;
  }
  .diff-box.missing {
    background: rgba(0,0,0,0.04); border-color: #ccc; color: #bbb;
  }
  .diff-box.extra {
    background: rgba(255,77,109,0.14); border-color: #aa0018; color: #aa0018;
  }
  .diff-box.extra span { text-decoration: line-through; text-decoration-color: #aa0018; text-decoration-thickness: 2px; }

  /* ── Correct-answer row ── */
  .postit-diff-panel {
    padding: 8px 14px 10px; border-top: 2px solid rgba(0,0,0,0.08);
    background: rgba(255,77,109,0.05); display: flex; flex-direction: column;
    align-items: center; gap: 5px; flex-shrink: 0;
    animation: result-pop 0.12s steps(2) forwards;
  }
  .diff-panel-label {
    font-size: 11px; color: #aaa; letter-spacing: 1.5px; margin-top: 2px;
  }
  .correct-row {
    display: flex; gap: 4px; flex-wrap: wrap; justify-content: center;
  }
  .correct-box {
    width: 26px; height: 32px; border: 2px solid #ccc;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.06); flex-shrink: 0;
  }
  .correct-box span { font-size: 16px; line-height: 1; color: #888; font-family: var(--pixel-font); font-weight: bold; }

  /* ── Burst particles ── */
  .burst-wrap { position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 20; }
  .pixel-particle {
    position: absolute; width: 6px; height: 6px; opacity: 0; image-rendering: pixelated;
    animation: burst-fly var(--dur,0.6s) steps(8) var(--delay,0s) forwards;
  }
  @keyframes burst-fly {
    0%  { transform: translate(0,0) scale(1.5); opacity: 1; }
    100%{ transform: translate(var(--tx,40px),var(--ty,-50px)) scale(0); opacity: 0; }
  }

  /* ── Toast ── */
  .roll-toast {
    position: fixed; bottom: 24px; right: 16px; z-index: 500;
    border: 3px solid var(--orange); background: var(--panel);
    padding: 10px 14px; font-size: 10px; color: var(--orange);
    letter-spacing: 1px; line-height: 2; max-width: 210px;
    box-shadow: 4px 4px 0 #5a3a00; animation: toast-in 0.1s steps(2) forwards;
  }
  .roll-toast.fade-out { animation: toast-out 0.2s steps(2) forwards; }
  @keyframes toast-in  { from{transform:translateY(20px);opacity:0} to{transform:translateY(0);opacity:1} }
  @keyframes toast-out { from{opacity:1} to{opacity:0} }
  .toast-title { color: var(--yellow); display: block; margin-bottom: 4px; }

  /* ── Action Rows ── */
  .action-primary {
    width: 100%; max-width: 1400px;
    display: flex; gap: 10px;
    margin-bottom: 8px; position: relative; z-index: 1;
  }
  .action-secondary {
    width: 100%; max-width: 1400px;
    display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;
    margin-bottom: 20px; position: relative; z-index: 1;
  }
  .pixel-btn {
    font-family: var(--pixel-font); font-size: 12px;
    border: 4px solid; padding: 10px 16px; cursor: pointer;
    letter-spacing: 1px; transition: all 0.08s;
    display: flex; align-items: center; gap: 8px;
  }
  .pixel-btn:hover  { transform: translate(2px,2px); }
  .pixel-btn:active { transform: translate(4px,4px); }
  .pixel-btn-add {
    background: var(--green); color: var(--bg);
    border-color: var(--green); box-shadow: 4px 4px 0 var(--dkgreen);
    flex: 1; justify-content: center;
  }
  .pixel-btn-add:hover  { background: var(--bg); color: var(--green); box-shadow: 2px 2px 0 var(--dkgreen); }
  .pixel-btn-add:active { box-shadow: none; }
  .pixel-btn-study {
    background: transparent; color: #d8d4ca;
    border-color: #4a4a6a; box-shadow: 4px 4px 0 #2a2a3e;
    flex: 1; justify-content: center;
  }
  .pixel-btn-study:hover  { background: #4a4a6a; box-shadow: 2px 2px 0 #2a2a3e; }
  .pixel-btn-study:active { box-shadow: none; }

  /* ── Quantity Selector ── */
  .study-quantity-selector {
    display: flex; align-items: center; justify-content: center;
    border: 4px solid #4a4a6a; background: var(--panel);
    box-shadow: 4px 4px 0 #2a2a3e; height: auto;
  }
  .qty-btn {
    font-family: var(--pixel-font); font-size: 16px;
    background: transparent; color: #d8d4ca; border: none;
    width: 28px; height: 100%; cursor: pointer; transition: background 0.1s;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .qty-btn:hover { background: #4a4a6a; }
  .qty-btn:active { background: #2a2a3e; }
  .qty-val {
    font-family: var(--pixel-font); font-size: 14px;
    color: var(--green); display: flex; align-items: center; justify-content: center;
    min-width: 32px; height: 100%; font-weight: bold;
    border-left: 2px solid #2a2a3e; border-right: 2px solid #2a2a3e;
  }

  .pixel-btn-reset {
    font-family: var(--pixel-font); font-size: 11px;
    background: transparent; color: var(--red);
    border: 3px solid var(--dkred); padding: 9px 14px;
    cursor: pointer; letter-spacing: 1px;
    box-shadow: 3px 3px 0 #3a0010; transition: all 0.08s;
  }
  .pixel-btn-reset:hover  { background: var(--dkred); color: #fff; transform: translate(1px,1px); box-shadow: 2px 2px 0 #3a0010; }
  .pixel-btn-reset:active { transform: translate(3px,3px); box-shadow: none; }
  .pixel-btn-export {
    font-family: var(--pixel-font); font-size: 11px;
    background: transparent; color: var(--blue);
    border: 3px solid var(--blue); padding: 10px 14px;
    cursor: pointer; letter-spacing: 1px;
    box-shadow: 3px 3px 0 #1a2a5a; transition: all 0.08s;
    display: flex; align-items: center; gap: 6px;
  }
  .pixel-btn-export:hover  { background: var(--blue); color: #fff; transform: translate(1px,1px); box-shadow: 2px 2px 0 #1a2a5a; }
  .pixel-btn-export:active { transform: translate(3px,3px); box-shadow: none; }
  .pixel-btn-export:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
  .pixel-btn-import {
    font-family: var(--pixel-font); font-size: 11px;
    background: transparent; color: #c084fc;
    border: 3px solid #c084fc; padding: 10px 14px;
    cursor: pointer; letter-spacing: 1px;
    box-shadow: 3px 3px 0 #4a1a6a; transition: all 0.08s;
    display: flex; align-items: center; gap: 6px;
  }
  .pixel-btn-import:hover  { background: #c084fc; color: #fff; transform: translate(1px,1px); box-shadow: 2px 2px 0 #4a1a6a; }
  .pixel-btn-import:active { transform: translate(3px,3px); box-shadow: none; }
  .pixel-btn-import:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }

  /* ── Search Bar ── */
  .search-wrapper { width: 100%; max-width: 1400px; margin-bottom: 12px; position: relative; z-index: 1; display: flex; align-items: center; }
  .search-icon { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); font-size: 14px; pointer-events: none; opacity: 0.6; }
  .search-input { width: 100%; font-family: var(--pixel-font); font-size: 14px; background: var(--panel); color: var(--green); border: 3px solid var(--border); padding: 12px 12px 12px 42px; outline: none; caret-color: var(--green); transition: border-color 0.15s; letter-spacing: 1px; box-shadow: 4px 4px 0 rgba(0,0,0,0.2); }
  .search-input:focus { border-color: var(--green); box-shadow: 4px 4px 0 var(--dkgreen); }
  .search-input::placeholder { color: var(--muted); }

  /* ── Inline Edit ── */
  .word-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 4px; width: 100%; }
  .pencil-btn { background: transparent; border: none; color: var(--muted); cursor: pointer; font-size: 11px; padding: 0; opacity: 0.5; transition: opacity 0.15s, color 0.15s; line-height: 1; margin-top: 1px; flex-shrink: 0; }
  .pencil-btn:hover { opacity: 1; color: var(--green); }
  .pencil-btn.delete-btn:hover { color: var(--red); }
  .edit-input-group { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; width: 100%; }
  .inline-edit-input { font-family: var(--pixel-font); font-size: 11px; background: rgba(0,0,0,0.3); color: var(--green); border: 2px solid var(--border); padding: 5px 6px; outline: none; width: 100%; transition: border-color 0.15s; letter-spacing: 0.5px; }
  .inline-edit-input:focus { border-color: var(--green); background: #050510; }
  .inline-edit-input::placeholder { color: #3a3a5a; }

  /* ── Word Bank ── */
  .wordbank-wrapper { width: 100%; max-width: 1400px; position: relative; z-index: 1; }
  .wordbank-header  { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .wordbank-title   { font-size: 11px; color: var(--muted); letter-spacing: 1.5px; display: flex; align-items: center; gap: 8px; }
  .wordbank-title::before { content: '▶'; font-size: 9px; }
  .wordbank-count   { background: var(--green); color: var(--bg); font-size: 10px; padding: 2px 8px; }
  .wordbank-empty   { border: 4px dashed #2a2a4a; padding: 24px; text-align: center; color: #3a3a5a; font-size: 11px; line-height: 2.4; letter-spacing: 1px; }
  .wordbank-grid    { display: grid; grid-template-columns: repeat(auto-fill,minmax(176px,1fr)); gap: 8px; }
  .word-card        { border: 3px solid var(--border); background: var(--panel); padding: 12px; transition: border-color 0.15s; }
  .word-card:hover  { border-color: var(--green); }
  .word-card.hot    { border-color: var(--red) !important; animation: card-pulse 1.2s step-end infinite; }
  .word-card.on-board { border-color: var(--orange) !important; }
  @keyframes card-pulse { 0%,100%{border-color:var(--red)} 50%{border-color:#ff9999} }
  .pixel-type-badge { font-size: 11px; color: var(--bg); background: var(--blue); padding: 2px 6px; display: inline-flex; align-items: center; justify-content: center; letter-spacing: 0.5px; border: 1px solid #1a2a5a; margin: 0 4px; box-shadow: 1px 1px 0 #1a2a5a; vertical-align: middle; }
  .word-card-term    { font-size: 12px; color: var(--green); margin: 0 0 4px; letter-spacing: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; cursor: text; }
  .word-card-meaning { font-size: 10px; color: var(--muted); margin: 0 0 8px; line-height: 1.8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: text; }
  .word-card-footer  { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
  .pip-row { display: flex; gap: 2px; }
  .pip { width: 6px; height: 6px; border: 1px solid #3a3a5a; image-rendering: pixelated; }
  .pip.filled-master     { background: var(--dkgreen); border-color: var(--green);  }
  .pip.filled-learning   { background: #3a6aff;         border-color: var(--blue);   }
  .pip.filled-struggling { background: #9a8000;         border-color: var(--yellow); }
  .pip.filled-weak       { background: #cc6600;         border-color: var(--orange); }
  .pip.filled-critical   { background: #cc0020;         border-color: var(--red);    }
  .word-card-prob { font-size: 9px; color: var(--orange); letter-spacing: 0.5px; white-space: nowrap; }

  /* ── Word Count Badge ── */
  .word-count-badge {
    position: fixed; top: 12px; right: 12px; z-index: 150;
    background: var(--panel); border: 3px solid var(--green);
    box-shadow: 3px 3px 0 var(--dkgreen);
    padding: 8px 12px; display: flex; flex-direction: column;
    align-items: center; gap: 2px; min-width: 68px;
  }
  .word-count-label { font-size: 9px;  color: var(--muted);   letter-spacing: 1px; }
  .word-count-num   { font-size: 18px; color: var(--green);   line-height: 1; }
  .word-count-sub   { font-size: 9px;  color: var(--dkgreen); letter-spacing: 1px; }

  /* ── Modal ── */
  .modal-overlay { position: fixed; inset: 0; background: rgba(10,10,26,0.88); display: flex; align-items: center; justify-content: center; z-index: 300; padding: 16px; }
  .pixel-modal   { background: var(--panel); border: 4px solid var(--green); box-shadow: 8px 8px 0 var(--dkgreen); width: 100%; max-width: 400px; padding: 28px; }
  .modal-title   { font-size: 15px; color: var(--green); margin: 0 0 22px; letter-spacing: 1px; border-bottom: 2px solid #1a3a2a; padding-bottom: 12px; }
  .modal-field   { margin-bottom: 16px; }
  .modal-field-label { font-size: 10px; color: var(--muted); letter-spacing: 1px; display: block; margin-bottom: 8px; text-transform: uppercase; }
  .modal-input   { font-family: var(--pixel-font); font-size: 13px; background: #050510; color: var(--green); border: 3px solid #2a3a2a; padding: 12px; width: 100%; outline: none; letter-spacing: 1px; caret-color: var(--green); transition: border-color 0.15s; }
  .modal-input:focus { border-color: var(--green); }
  .modal-input::placeholder { color: #1a3a2a; }
  .modal-actions { display: flex; gap: 10px; margin-top: 22px; }
  .modal-btn-confirm { font-family: var(--pixel-font); font-size: 12px; background: var(--green); color: var(--bg); border: 3px solid var(--green); padding: 12px; cursor: pointer; flex: 1; letter-spacing: 1px; box-shadow: 3px 3px 0 var(--dkgreen); transition: all 0.08s; }
  .modal-btn-confirm:hover  { transform: translate(1px,1px); box-shadow: 2px 2px 0 var(--dkgreen); }
  .modal-btn-confirm:active { transform: translate(3px,3px); box-shadow: none; }
  .modal-btn-cancel  { font-family: var(--pixel-font); font-size: 12px; background: transparent; color: var(--muted); border: 3px solid #3a3a5a; padding: 12px; cursor: pointer; flex: 1; letter-spacing: 1px; box-shadow: 3px 3px 0 #2a2a3a; transition: all 0.08s; }
  .modal-btn-cancel:hover  { background: #1a1a2e; transform: translate(1px,1px); box-shadow: 2px 2px 0 #2a2a3a; }
  .modal-btn-cancel:active { transform: translate(3px,3px); box-shadow: none; }
  .modal-error { font-size: 10px; color: var(--red); letter-spacing: 1px; margin-top: -8px; margin-bottom: 8px; animation: input-shake 0.3s steps(4); }

  /* ── Board + Stats layout ── */
  .board-layout {
    display: flex; align-items: stretch; gap: 14px;
    width: 100%; max-width: 1400px;
    margin-bottom: 18px; position: relative; z-index: 1;
  }
  .board-layout .whiteboard-wrapper {
    flex: 1; min-width: 0;
    max-width: none; margin-bottom: 0;
    display: flex; flex-direction: column;
  }

  /* ── Stats Dashboard ── */
  .stats-wrapper {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
  }
  .stats-dashboard {
    width: 188px; flex: 1;
    display: flex; flex-direction: column;
    background: var(--panel);
    border: 3px solid var(--green);
    box-shadow: 4px 4px 0 var(--dkgreen);
    padding: 14px 12px;
    font-family: var(--pixel-font);
  }
  .stats-title {
    font-size: 10px; color: var(--green);
    letter-spacing: 2px; margin: 0 0 12px;
    border-bottom: 2px solid var(--border); padding-bottom: 8px;
    display: flex; align-items: center; gap: 6px;
  }
  .stats-title::before { content: '▶'; font-size: 8px; }

  .stats-total-row {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 14px;
  }
  .stats-total-label { font-size: 9px; color: var(--muted); letter-spacing: 1px; }
  .stats-total-val   { font-size: 20px; color: var(--green); line-height: 1; }

  .stats-item { margin-bottom: 12px; }
  .stats-item-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 4px;
  }
  .stats-item-label { font-size: 9px; letter-spacing: 1px; }
  .stats-item-label.mastered   { color: var(--green); }
  .stats-item-label.learning   { color: var(--yellow); }
  .stats-item-label.struggling { color: var(--red); }
  .stats-item-count { font-size: 13px; line-height: 1; }
  .stats-item-count.mastered   { color: var(--green); }
  .stats-item-count.learning   { color: var(--yellow); }
  .stats-item-count.struggling { color: var(--red); }

  .stats-bar-track {
    width: 100%; height: 8px;
    background: var(--bg); border: 2px solid var(--border);
    overflow: hidden; position: relative; image-rendering: pixelated;
  }
  .stats-bar-fill {
    height: 100%; position: absolute; left: 0; top: 0; bottom: 0;
    transition: width 0.5s steps(10);
    image-rendering: pixelated;
  }
  .stats-bar-fill.mastered   { background: var(--green); }
  .stats-bar-fill.learning   { background: var(--yellow); }
  .stats-bar-fill.struggling { background: var(--red); }

  .stats-divider { width: 100%; height: 2px; background: var(--border); margin: 4px 0 12px; }

  .stats-pct { font-size: 8px; color: var(--muted); letter-spacing: 1px; text-align: right; margin-top: 2px; }

  .stats-empty {
    font-size: 9px; color: var(--muted); text-align: center;
    padding: 12px 0; letter-spacing: 1px; line-height: 2;
  }

  /* ── Footer ── */
  .pixel-footer { margin-top: auto; padding-top: 28px; font-size: 10px; color: #2a2a4a; letter-spacing: 1px; text-align: center; }
`
const styleEl = document.createElement('style')
styleEl.textContent = css
document.head.appendChild(styleEl)

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_INTERVAL_MINS = 5          // default minutes per card
const SCHEDULE_SECONDS = DEFAULT_INTERVAL_MINS * 60   // fallback used before state loads
const TOTAL_PIPS = 10
const BALANCE_PIVOT = 10

const SEED_WORDS = []

const STARS = Array.from({ length: 44 }, (_, i) => ({
  id: i,
  top: `${Math.random() * 100}%`,
  left: `${Math.random() * 100}%`,
  dur: `${2 + Math.random() * 4}s`,
  delay: `${Math.random() * 5}s`,
  op: 0.12 + Math.random() * 0.3,
}))

const SUCCESS_COLORS = ['#00ff9f', '#00cc7a', '#ffffff', '#aaffdd', '#ffd600']
const FAIL_COLORS = ['#ff4d6d', '#ff9999', '#ff0000', '#ffd600', '#ffffff']

// ─── Pure Helpers ─────────────────────────────────────────────────────────────
function makeBurst(colors, count = 22) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    color: colors[i % colors.length],
    tx: `${(Math.random() - 0.5) * 300}px`,
    ty: `${(Math.random() - 0.5) * 240}px`,
    dur: `${0.4 + Math.random() * 0.48}s`,
    delay: `${Math.random() * 0.1}s`,
    top: `${20 + Math.random() * 60}%`,
    left: `${10 + Math.random() * 80}%`,
  }))
}

function formatTime(sec) {
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
}

function calcProbability(mastery, totalWords) {
  if (mastery >= 100) return 0.05 // Mastered words rarely auto-spawn
  const raw = Math.max(0, (100 - mastery) / 100)
  const factor = Math.min(1, BALANCE_PIVOT / Math.max(1, totalWords))
  return raw * factor
}

function masteryTier(mastery) {
  if (mastery >= 100) return { tier: 'master', label: 'MASTER', pips: 10 }
  if (mastery >= 75) return { tier: 'learning', label: 'LEARNING', pips: 7 }
  if (mastery >= 50) return { tier: 'struggling', label: 'STRUGGLING', pips: 4 }
  if (mastery >= 25) return { tier: 'weak', label: 'WEAK', pips: 2 }
  if (mastery > 0) return { tier: 'critical', label: 'CRITICAL', pips: 0 }
  return { tier: 'new', label: 'NEW WORD', pips: 0 }
}

function cardRotation(uid) {
  const n = uid.split('').reduce((acc, ch, i) => acc + ch.charCodeAt(0) * (i + 1), 0)
  return ((n % 7) - 3) * 0.9
}

// ─── Combo/Prestige helpers ───────────────────────────────────────────────────
const DIAMOND_SPARKLES = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  color: ['#e0f7fa','#b2ebf2','#ffffff','#80deea','#ccffff'][i % 5],
  sdur: `${1.2 + (i * 0.3)}s`,
  sdelay: `${(i * 0.22)}s`,
  sx:  `${(Math.sin(i * 1.3) * 30).toFixed(1)}px`,
  sy:  `${-8 - (i % 4) * 4}px`,
  sx2: `${(Math.cos(i * 1.1) * 20).toFixed(1)}px`,
  sy2: `${-20 - (i % 3) * 6}px`,
  sx3: `${(Math.sin(i * 0.7) * 15).toFixed(1)}px`,
  sy3: `${-38 - (i % 5) * 3}px`,
  top: `${15 + (i % 5) * 15}%`,
  left: `${8 + (i % 7) * 12}%`,
}))

function getPrestigeTier(comboCount) {
  if ((comboCount ?? 0) >= 20) return 'diamond'
  if ((comboCount ?? 0) >= 10) return 'gold'
  if ((comboCount ?? 0) >= 2)  return 'silver'
  return null
}

// ─── PostItCard Component ─────────────────────────────────────────────────────
function PostItCard({ card, totalWords, onAnswer, onUpdateField, onAnimEnd, onCardHint, index }) {
  const inputRef = useRef(null)

  useEffect(() => {
    const t = setTimeout(() => {
      if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        inputRef.current?.focus()
      }
    }, 80)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (card.revealedHintIndices && card.revealedHintIndices.length > 0) {
      inputRef.current?.focus()
    }
  }, [card.revealedHintIndices?.length])

  const getReconstructedAnswer = () => {
    let typedIndex = 0
    return Array.from({ length: card.word.length }).map((_, i) => {
      if (card.revealedHintIndices?.includes(i)) {
        return { char: card.word[i].toUpperCase(), isHint: true }
      } else {
        const char = card.answer[typedIndex] ? card.answer[typedIndex].toUpperCase() : ''
        typedIndex++
        return { char, isHint: false }
      }
    })
  }

  const { tier, label } = masteryTier(card.mastery)
  const prob = (calcProbability(card.mastery, totalWords) * 100).toFixed(0)
  const rot = cardRotation(card.uid)
  const isNew = card.mastery === 0
  const diffPct = card.mastery
  const prestigeTier = getPrestigeTier(card.comboCount)
  const prestigeClass = prestigeTier ? ` prestige-${prestigeTier}` : ''

  return (
    <div
      className={`postit-card ${tier}${card.exiting ? ' card-exit' : ''}${prestigeClass}`}
      style={{ '--rot': `${rot}deg` }}
    >
      <div className="postit-pin" aria-hidden />
      {prestigeTier && <div className={`prestige-sweep sweep-${prestigeTier}`} />}
      
      {index !== undefined && index < 9 && (
        <div style={{
          position: 'absolute', top: '7px', left: '8px', zIndex: 10,
          background: 'rgba(0,0,0,0.06)', color: '#4a4a4a', fontSize: '10px',
          padding: '2px 5px', fontFamily: 'var(--pixel-font)', letterSpacing: '1px',
          pointerEvents: 'none'
        }}>[ {index + 1} ]</div>
      )}

      {/* Diamond sparkle particles */}
      {prestigeTier === 'diamond' && DIAMOND_SPARKLES.map(s => (
        <div key={s.id} className="diamond-sparkle"
          style={{
            background: s.color,
            top: s.top, left: s.left,
            '--sdur': s.sdur, '--sdelay': s.sdelay,
            '--sx': s.sx, '--sy': s.sy,
            '--sx2': s.sx2, '--sy2': s.sy2,
            '--sx3': s.sx3, '--sy3': s.sy3,
          }}
        />
      ))}

      {/* Combo prestige badge */}
      {(card.comboCount ?? 0) >= 2 && !isNew && (
        <div className={`combo-badge tier-${prestigeTier}`}>
          x{card.comboCount} COMBO
        </div>
      )}

      {isNew && <div className="postit-new-stamp">★ NEW</div>}
      <div className="postit-tape" aria-hidden />

      <div className="postit-header">
        <span className={`postit-badge ${tier}`}>{label}</span>
        <span className={`postit-trigger${card.trigger === 'early' ? ' early' : ''}`}>
          {card.trigger === 'early' ? '⚡ROLL' : '📅SCHED'}
        </span>
      </div>

      <div className="postit-err-bar">
        <div className={`postit-err-fill ${tier}`} style={{ width: `${diffPct}%` }} />
      </div>

      <div className="postit-diff-row">
        <span className="postit-diff-label">MASTERY</span>
        <span className="postit-diff-val">
          {isNew
            ? `0/100 · P:100% · +8 if correct`
            : `${diffPct}/100 · P:${prob}% · ${card.mastery < 100 ? '+8 ✓  Penalty ✗' : 'MASTERED'}`}
        </span>
      </div>

      <div className="postit-body">
        <p className="postit-meaning">{card.meaning}</p>
        <p className="postit-hint">
          {card.word.length} letters
          {card.type && <span className="pixel-type-badge">[{card.type}]</span>}
        </p>
        {card.result === 'failure' ? (() => {
          const typed = card.wrongAnswer.toUpperCase().split('')
          const correct = card.word.toUpperCase().split('')
          const maxLen = Math.max(typed.length, correct.length)
          return (
            <div className="diff-row">
              {Array.from({ length: maxLen }, (_, i) => {
                const t = typed[i], c = correct[i]
                let cls = 'diff-box'
                if (t === undefined) cls += ' missing'
                else if (c === undefined) cls += ' extra'
                else if (t === c) cls += ' correct'
                else cls += ' wrong'
                return (
                  <div className={cls} key={i}>
                    <span>{t ?? '_'}</span>
                  </div>
                )
              })}
            </div>
          )
        })() : (
          <div className="postit-blanks">
            {getReconstructedAnswer().map((slot, i) => (
              <div className="blank-box" key={i}>
                <span style={slot.isHint ? { color: 'var(--yellow)' } : {}}>{slot.char}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {card.result === 'success' ? (
        <div className="postit-result success">
          <span className="postit-result-emoji">🎉</span>
          <span className="postit-result-text">CORRECT!</span>
        </div>
      ) : card.result === 'failure' ? (
        <div className="postit-diff-panel">
          <div className="correct-row">
            {card.word.toUpperCase().split('').map((ch, i) => (
              <div className="correct-box" key={i}><span>{ch}</span></div>
            ))}
          </div>
          <div className="diff-panel-label">▲ CORRECT ANSWER</div>
          {card.penaltyApplied !== undefined && (
            <div className="diff-panel-sub" style={{ fontSize: '10px', color: '#cc0020', marginTop: '2px', fontWeight: 'bold' }}>
              PENALTY: -{card.penaltyApplied} MASTERY
            </div>
          )}
        </div>
      ) : (
        <div className="postit-input-row">
          <input
            ref={inputRef}
            className={`postit-input ${card.inputAnim}`}
            type="text"
            placeholder="type answer…"
            value={card.answer}
            onChange={e => onUpdateField(card.uid, 'answer', e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onAnswer(card.uid)}
            onAnimationEnd={() => onAnimEnd(card.uid)}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            className="postit-submit postit-hint-btn"
            onClick={() => onCardHint(card.uid)}
            disabled={card.revealedHintIndices?.length >= card.word.length}
            title={`Request a Hint (Next: -${4 * Math.pow(2, card.hintsUsed || 0)} Mastery)`}
          >?</button>
          <button className="postit-submit" onClick={() => onAnswer(card.uid)}>OK▶</button>
        </div>
      )}
    </div>
  )
}


// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const { user, authLoading, loginWithGoogle, loginAsGuest, logout } = useFirebase()
  const {
    cloudWords,
    cloudLoading,
    addWordCloud,
    updateWordCloud,
    deleteWordCloud,
    bulkOverwriteCloud
  } = useFirestoreBank(user)

  // ── Word library ─────────────────────────────────────────────────────────
  const [words, setWords] = useState([])

  useEffect(() => {
    if (user && !cloudLoading) {
      const migrated = cloudWords.map(w => {
        if ('errorCount' in w && !('mastery' in w)) {
          w.mastery = 0
          delete w.errorCount
        }
        return w
      })
      setWords(migrated)
    } else if (!user) {
      setWords([])
    }
  }, [user, cloudLoading, cloudWords])

  // ── Global Upward Data Flow Callbacks ────────────────────────────────────
  const updateWordMastery = useCallback((wordId, newMastery) => {
    setWords(ws => ws.map(w => w.id === wordId ? { ...w, mastery: newMastery } : w))
    updateWordCloud(wordId, { mastery: newMastery })
  }, [updateWordCloud])

  const updateWordCombo = useCallback((wordId, newCombo) => {
    setWords(ws => ws.map(w => w.id === wordId ? { ...w, comboCount: newCombo } : w))
    updateWordCloud(wordId, { comboCount: newCombo })
  }, [updateWordCloud])

  // ── Stats (memoised — recomputes only when words change) ─────────────────
  const stats = useMemo(() => {
    const mastered = words.filter(w => (w.mastery ?? 0) >= 90).length
    const learning = words.filter(w => { const m = w.mastery ?? 0; return m >= 60 && m < 90 }).length
    const struggling = words.filter(w => (w.mastery ?? 0) < 60).length
    return { mastered, learning, struggling, total: words.length }
  }, [words])

  const [activeCards, setActiveCards] = useState([])
  const [schedLeft, setSchedLeft] = useState(() => {
    try {
      const saved = localStorage.getItem('pixelEnglish_interval')
      if (saved) { const n = Number(saved); if (!isNaN(n) && n >= 1 && n <= 60) return n * 60 }
    } catch { }
    return SCHEDULE_SECONDS
  })
  const [burst, setBurst] = useState([])
  const [toast, setToast] = useState(null)
  const toastTimerRef = useRef(null)
  const [showModal, setShowModal] = useState(false)
  const [newWord, setNewWord] = useState({ word: '', meaning: '', type: '' })
  const [modalError, setModalError] = useState('')
  const modalInput1 = useRef(null)
  const importFileRef = useRef(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingWordId, setEditingWordId] = useState(null)
  const [editFormData, setEditFormData] = useState({ word: '', type: '', meaning: '' })

  const [studyQuantity, setStudyQuantity] = useState(1)

  const [dailyStats, setDailyStats] = useState(() => {
    try {
      const saved = localStorage.getItem('pixelEnglish_dailyStats')
      if (saved) {
        const parsed = JSON.parse(saved)
        const today = new Date().toISOString().slice(0, 10)
        if (parsed.date === today) {
          return { correctToday: parsed.correctToday || 0, incorrectToday: parsed.incorrectToday || 0, date: today }
        }
      }
    } catch { }
    return { correctToday: 0, incorrectToday: 0, date: new Date().toISOString().slice(0, 10) }
  })

  // ── Persist dailyStats
  useEffect(() => {
    try { localStorage.setItem('pixelEnglish_dailyStats', JSON.stringify(dailyStats)) } catch { }
  }, [dailyStats])

  // ── Interval / settings state ─────────────────────────────────────────────
  const [intervalMinutes, setIntervalMinutes] = useState(() => {
    try {
      const saved = localStorage.getItem('pixelEnglish_interval')
      if (saved) { const n = Number(saved); if (!isNaN(n) && n >= 1 && n <= 60) return n }
    } catch { }
    return DEFAULT_INTERVAL_MINS
  })
  const [settingsInput, setSettingsInput] = useState(String(intervalMinutes))
  const [showSettings, setShowSettings] = useState(false)
  const intervalSecs = intervalMinutes * 60
  // Refs so timer callbacks always see current values without re-creating the interval
  const intervalSecsRef = useRef(intervalSecs)
  const schedEndRef = useRef(Date.now() + intervalSecs * 1000)

  // ── Persist interval preference ───────────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem('pixelEnglish_interval', String(intervalMinutes)) } catch { }
    intervalSecsRef.current = intervalMinutes * 60
  }, [intervalMinutes])

  // ── Modal auto-focus ──────────────────────────────────────────────────────
  useEffect(() => {
    if (showModal) {
      const t = setTimeout(() => modalInput1.current?.focus(), 80)
      return () => clearTimeout(t)
    }
  }, [showModal])

  // ── Toast ─────────────────────────────────────────────────────────────────
  const showToast = useCallback((msg) => {
    clearTimeout(toastTimerRef.current)
    setToast({ msg, fadeOut: false })
    toastTimerRef.current = setTimeout(() => {
      setToast(t => t ? { ...t, fadeOut: true } : null)
      setTimeout(() => setToast(null), 300)
    }, 3500)
  }, [])

  // ── Card helpers ──────────────────────────────────────────────────────────
  const appendCard = useCallback((word, trigger = 'scheduled') => {
    setActiveCards(prev => {
      if (prev.some(c => c.wordId === word.id && !c.exiting)) return prev
      return [...prev, {
        uid: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        wordId: word.id,
        word: word.word,
        meaning: word.meaning,
        type: word.type || '',
        mastery: word.mastery ?? 0,
        hintsUsed: 0,
        revealedHintIndices: [],
        trigger,
        answer: '',
        inputAnim: '',
        result: null,
        wrongAnswer: '',
        exiting: false,
        comboCount: word.comboCount ?? 0,
      }]
    })
  }, [])

  const triggerCard = useCallback((pool, count = studyQuantity) => {
    const src = pool || words
    if (src.length === 0) return
    const weighted = src.flatMap(w => {
      const weight = 1 + Math.floor((100 - (w.mastery ?? 0)) / 10)
      return Array(weight).fill(w)
    })
    
    setActiveCards(prev => {
      const next = [...prev]
      let added = 0
      let attempts = 0
      
      const availableUnique = new Set(src.map(w => w.id))
      next.forEach(c => {
         if (!c.exiting) availableUnique.delete(c.wordId)
      })
      const maxPossibleToAdd = Math.min(count, availableUnique.size)
      
      while (added < maxPossibleToAdd && attempts < 200) {
        attempts++
        const word = weighted[Math.floor(Math.random() * weighted.length)]
        if (!next.some(c => c.wordId === word.id && !c.exiting)) {
          next.push({
            uid: `${Date.now()}-${attempts}-${Math.random().toString(36).slice(2, 7)}`,
            wordId: word.id,
            word: word.word,
            meaning: word.meaning,
            type: word.type || '',
            mastery: word.mastery ?? 0,
            hintsUsed: 0,
            revealedHintIndices: [],
            trigger: 'scheduled',
            answer: '',
            inputAnim: '',
            result: null,
            wrongAnswer: '',
            exiting: false,
            comboCount: word.comboCount ?? 0,
          })
          added++
        }
      }
      return next
    })
  }, [words, studyQuantity])

  // ── Keyboard Navigation (1-9 & Tab) ───────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if currently typed in a modal, search box, or inline edit
      if (
        document.activeElement?.closest('.modal-overlay') ||
        document.activeElement?.classList.contains('search-input') ||
        document.activeElement?.className.includes('inline-edit-input')
      ) return

      // Tab shortcut: Next Card / Study
      if (e.key === 'Tab') {
        e.preventDefault()
        triggerCard()
        return
      }

      // 1-9 shortcuts: Focus specific board cards
      if (e.key >= '1' && e.key <= '9' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const index = parseInt(e.key, 10) - 1
        const inputs = document.querySelectorAll('.postit-input')
        if (inputs[index]) {
          e.preventDefault() // Prevent typing the actual number into the target card
          inputs[index].focus()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [triggerCard])

  // ── Accurate SCHED countdown ──────────────────────────────────────────────
  // We anchor to an absolute end-time (schedEndRef) so the countdown never
  // drifts due to re-renders, tab throttling, or interval jitter.
  // Ticks every 500 ms so the displayed MM:SS is always ≤ 0.5 s behind reality.
  useEffect(() => {
    const id = setInterval(() => {
      const ms = schedEndRef.current - Date.now()
      const remaining = Math.max(0, Math.round(ms / 1000))
      setSchedLeft(remaining)
      if (remaining <= 0) {
        // Reset end-time FIRST so we don't double-fire
        schedEndRef.current = Date.now() + intervalSecsRef.current * 1000
        setWords(ws => {
          if (ws.length > 0) {
            const weighted = ws.flatMap(w => {
              const weight = 1 + Math.floor((100 - (w.mastery ?? 0)) / 10)
              return Array(weight).fill(w)
            })
            appendCard(weighted[Math.floor(Math.random() * weighted.length)], 'scheduled')
          }
          return ws
        })
      }
    }, 500)
    return () => clearInterval(id)
  }, [appendCard]) // intentionally no intervalSecs dep — we use the ref inside

  // ── Apply new interval from settings (resets the countdown) ───────────────
  // Runs whenever intervalMinutes changes so the bar rescales immediately.
  useEffect(() => {
    schedEndRef.current = Date.now() + intervalSecsRef.current * 1000
    setSchedLeft(intervalSecsRef.current)
  }, [intervalMinutes])

  const updateCardField = useCallback((uid, field, value) => {
    setActiveCards(prev => prev.map(c => c.uid === uid ? { ...c, [field]: value } : c))
  }, [])

  const clearCardAnim = useCallback((uid) => {
    setActiveCards(prev => prev.map(c => c.uid === uid ? { ...c, inputAnim: '' } : c))
  }, [])

  const handleRequestHint = useCallback((uid) => {
    setActiveCards(prev => {
      const card = prev.find(c => c.uid === uid)
      if (!card || card.result) return prev

      const unrevealed = []
      for (let i = 0; i < card.word.length; i++) {
        const typedIndex = i - (card.revealedHintIndices?.filter(idx => idx < i).length || 0)
        const typedChar = card.answer[typedIndex]
        if (!card.revealedHintIndices?.includes(i) && (!typedChar || typedChar.toLowerCase() !== card.word[i].toLowerCase())) {
          unrevealed.push(i)
        }
      }

      if (unrevealed.length === 0) return prev
      const targetIndex = unrevealed[Math.floor(Math.random() * unrevealed.length)]
      const nextHints = [...(card.revealedHintIndices || []), targetIndex]
      const currentHintsUsed = card.hintsUsed || 0
      const nextHintsUsed = currentHintsUsed + 1
      const penalty = 4 * Math.pow(2, currentHintsUsed)
      const nextMastery = Math.max(0, (card.mastery ?? 0) - penalty)

      const prevCombo = card.comboCount ?? 0
      const comboBroken = prevCombo > 0

      setTimeout(() => {
        updateWordMastery(card.wordId, nextMastery)
        if (comboBroken) {
          updateWordCombo(card.wordId, 0)
          showToast(`💥 COMBO BROKEN!\nx${prevCombo} STREAK LOST\n(Hint used)`)
        }
      }, 0)

      return prev.map(c => c.uid === uid ? {
        ...c,
        revealedHintIndices: nextHints,
        hintsUsed: nextHintsUsed,
        mastery: nextMastery,
        comboCount: comboBroken ? 0 : prevCombo
      } : c)
    })
  }, [updateWordMastery, updateWordCombo, showToast])

  const checkCardAnswer = useCallback((uid) => {
    setActiveCards(prev => {
      const card = prev.find(c => c.uid === uid)
      if (!card || card.result) return prev

      let reconstructed = ''
      let typedIndex = 0
      for (let i = 0; i < card.word.length; i++) {
        if (card.revealedHintIndices?.includes(i)) {
          reconstructed += card.word[i]
        } else {
          reconstructed += card.answer[typedIndex] || ''
          typedIndex++
        }
      }

      const correct = reconstructed.trim().toLowerCase() === card.word.toLowerCase()

      if (correct) {
        const nextMastery = Math.min(100, (card.mastery ?? 0) + 8)

        // ── Combo logic: only triggers when the word already had FULL mastery (100) ──
        const wasFullyMastered = (card.mastery ?? 0) >= 100
        const prevCombo = card.comboCount ?? 0
        const nextCombo = wasFullyMastered ? prevCombo + 1 : prevCombo

        setTimeout(() => {
          updateWordMastery(card.wordId, nextMastery)
          updateWordCombo(card.wordId, nextCombo)
          setDailyStats(prev => {
            const today = new Date().toISOString().slice(0, 10)
            if (prev.date !== today) return { correctToday: 1, incorrectToday: 0, date: today }
            return { ...prev, correctToday: prev.correctToday + 1 }
          })
          // Announce tier transitions
          if (wasFullyMastered) {
            if (nextCombo === 2)  showToast(`★ SILVER COMBO x2!\nKEEP GOING!`)
            if (nextCombo === 10) showToast(`✨ GOLD COMBO x10!\nON FIRE!!`)
            if (nextCombo === 20) showToast(`💎 DIAMOND COMBO x20!\nLEGENDARY!`)
          }
        }, 0)
        setBurst(makeBurst(SUCCESS_COLORS))
        setTimeout(() => {
          setActiveCards(cs => cs.map(c => c.uid === uid ? { ...c, exiting: true } : c))
          setTimeout(() => {
            setActiveCards(cs => cs.filter(c => c.uid !== uid))
            setBurst([])
          }, 400)
        }, 1300)
        return prev.map(c => c.uid === uid
          ? { ...c, result: 'success', inputAnim: 'anim-flash', mastery: nextMastery, comboCount: nextCombo }
          : c
        )
      } else {
        const correctLetters = card.word.toLowerCase().split('')
        const typedLetters = reconstructed.trim().toLowerCase().split('')
        const maxLen = Math.max(correctLetters.length, typedLetters.length)
        let wrongCount = 0

        for (let i = 0; i < maxLen; i++) {
          if (typedLetters[i] !== correctLetters[i]) wrongCount++
        }

        const penaltyPerLetter = 20 / card.word.length
        const penalty = Math.round(wrongCount * penaltyPerLetter)
        const nextMastery = Math.max(0, (card.mastery ?? 0) - penalty)

        // ── Combo break: reset if the word had a combo streak ──
        const prevCombo = card.comboCount ?? 0
        const comboBroken = prevCombo > 0

        setTimeout(() => {
          updateWordMastery(card.wordId, nextMastery)
          if (comboBroken) {
            updateWordCombo(card.wordId, 0)
            showToast(`💥 COMBO BROKEN!\nx${prevCombo} STREAK LOST\nSTAY FOCUSED!`)
          }
          setDailyStats(prev => {
            const today = new Date().toISOString().slice(0, 10)
            if (prev.date !== today) return { correctToday: 0, incorrectToday: 1, date: today }
            return { ...prev, incorrectToday: prev.incorrectToday + 1 }
          })
        }, 0)
        setBurst(makeBurst(FAIL_COLORS, 12))
        setTimeout(() => {
          setActiveCards(cs => cs.map(c => c.uid === uid
            ? { ...c, result: null, answer: '', inputAnim: '', wrongAnswer: '', comboCount: comboBroken ? 0 : prevCombo }
            : c
          ))
          setBurst([])
        }, 1900)
        return prev.map(c => c.uid === uid
          ? { ...c, result: 'failure', inputAnim: 'anim-shake', wrongAnswer: reconstructed.trim() || '???', mastery: nextMastery, penaltyApplied: penalty, comboCount: comboBroken ? 0 : prevCombo }
          : c
        )
      }
    })
  }, [updateWordCombo, showToast])

  // ── Modal handlers ────────────────────────────────────────────────────────
  const openModal = () => { setNewWord({ word: '', meaning: '', type: '' }); setModalError(''); setShowModal(true) }
  const closeModal = () => setShowModal(false)

  const handleAddWord = () => {
    const w = newWord.word.trim(), m = newWord.meaning.trim(), t = newWord.type.trim()
    if (!w) { setModalError('⚠ English word cannot be empty'); return }
    if (!m) { setModalError('⚠ Vietnamese meaning cannot be empty'); return }
    if (words.some(x => x.word.toLowerCase() === w.toLowerCase())) {
      setModalError(`⚠ "${w}" already exists`); return
    }
    const entry = { id: Date.now(), word: w, meaning: m, type: t, mastery: 0, comboCount: 0 }
    setWords(prev => [...prev, entry])
    addWordCloud(entry)
    appendCard(entry, 'scheduled')
    showToast(`★ NEW WORD ADDED\n${w.toUpperCase()}\nMASTERY: 0 → P:100%\nGet it right to build!`)
    closeModal()
  }

  // ── Edit logic ────────────────────────────────────────────────────────────
  const handleEditClick = (w) => {
    setEditingWordId(w.id)
    setEditFormData({ word: w.word, type: w.type || '', meaning: w.meaning })
  }

  const handleEditSave = (w) => {
    if (!editFormData.word.trim() || !editFormData.meaning.trim()) {
      showToast('⚠ WORD OR MEANING\nCANNOT BE EMPTY')
      return
    }
    const updatedWord = {
      ...w,
      word: editFormData.word.trim(),
      type: editFormData.type.trim(),
      meaning: editFormData.meaning.trim()
    }
    setWords(prev => prev.map(word => word.id === w.id ? updatedWord : word))
    updateWordCloud(w.id, {
      word: updatedWord.word,
      type: updatedWord.type,
      meaning: updatedWord.meaning
    })
    setActiveCards(prev => prev.map(c =>
      c.wordId === w.id
        ? { ...c, word: updatedWord.word, type: updatedWord.type, meaning: updatedWord.meaning }
        : c
    ))
    setEditingWordId(null)
    showToast('✔ WORD UPDATED')
  }

  const handleEditCancel = () => {
    setEditingWordId(null)
  }

  const handleDeleteWord = useCallback((wordId, wordText) => {
    if (!window.confirm(`Delete word "${wordText.toUpperCase()}" permanently?\nThis will also remove it from the Whiteboard.`)) return
    setWords(prev => prev.filter(w => w.id !== wordId))
    deleteWordCloud(wordId)
    setActiveCards(prev => prev.filter(c => c.wordId !== wordId))
    setEditingWordId(null) // in case user deletes while editing somehow
    showToast(`🗑 WORD DELETED\nRemoved "${wordText.toUpperCase()}"`)
  }, [showToast, deleteWordCloud])

  const handleCardBlur = (e, w) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      handleEditSave(w)
    }
  }

  const handleEditKeyDown = (e, w) => {
    if (e.key === 'Enter') handleEditSave(w)
    if (e.key === 'Escape') handleEditCancel()
  }

  // ── Reset ─────────────────────────────────────────────────────────────────
  const handleReset = () => {
    if (!window.confirm('Reset ALL data?\n\nThis clears your word list and progress.')) return
    try { localStorage.removeItem('pixelEnglish_words') } catch { }
    setWords(SEED_WORDS)
    bulkOverwriteCloud(SEED_WORDS)
    setActiveCards([])
    setBurst([])
    showToast('🗑 DATA RESET\nReverted to seed words')
  }

  // ── Export to Excel (xlsx npm package) ───────────────────────────────────
  const [exporting, setExporting] = useState(false)

  const exportToExcel = useCallback(() => {
    if (words.length === 0) { showToast('⚠ EXPORT FAILED\nNo words to export'); return }
    setExporting(true)
    try {
      // Columns: Word | Type | Meaning | Mastery | Example | Category | Combo | _hash
      const headerRow = ['Word', 'Type', 'Meaning', 'Mastery', 'Example', 'Category', 'Combo', '_hash']
      const dataRows = words.map(w => [
        w.word,
        w.type ?? '',
        w.meaning,
        w.mastery ?? 0,
        w.example ?? '',
        w.category ?? '',
        w.comboCount ?? 0,
        computeComboHash(w.id, w.comboCount ?? 0),
      ])

      const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows])

      // Column widths
      ws['!cols'] = [
        { wch: 22 }, { wch: 14 }, { wch: 38 },
        { wch: 12 }, { wch: 44 }, { wch: 18 },
        { wch: 10 }, { wch: 14 },
      ]

      const range = XLSX.utils.decode_range(ws['!ref'])

      // Style all header cells
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddr = XLSX.utils.encode_cell({ r: 0, c: col })
        if (!ws[cellAddr]) continue

        if (col === 6) {
          // Combo header: RED background, bold white text
          ws[cellAddr].s = {
            font: { bold: true, color: { rgb: 'FFFFFF' } },
            fill: { fgColor: { rgb: 'CC0020' }, patternType: 'solid' },
            alignment: { horizontal: 'center', vertical: 'center' },
          }
        } else if (col === 7) {
          // _hash header: muted grey (hidden-feel)
          ws[cellAddr].s = {
            font: { bold: true, color: { rgb: '888888' } },
            fill: { fgColor: { rgb: '2A2A2A' }, patternType: 'solid' },
            alignment: { horizontal: 'center', vertical: 'center' },
          }
        } else {
          ws[cellAddr].s = {
            font: { bold: true },
            fill: { fgColor: { rgb: '1A1A2E' }, patternType: 'solid' },
            alignment: { horizontal: 'center', vertical: 'center' },
          }
        }
      }

      // Style all Combo data cells (col 6): red bold text
      for (let row = 1; row <= range.e.r; row++) {
        const comboCellAddr = XLSX.utils.encode_cell({ r: row, c: 6 })
        if (ws[comboCellAddr]) {
          ws[comboCellAddr].s = {
            font: { bold: true, color: { rgb: 'CC0020' } },
            alignment: { horizontal: 'center' },
          }
        }
        // _hash cells: greyed out italic
        const hashCellAddr = XLSX.utils.encode_cell({ r: row, c: 7 })
        if (ws[hashCellAddr]) {
          ws[hashCellAddr].s = {
            font: { color: { rgb: '666666' }, italic: true },
            alignment: { horizontal: 'center' },
          }
        }
      }

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Word Bank')

      const date = new Date().toISOString().slice(0, 10)
      XLSX.writeFile(wb, `pixel-english-backup-${date}.xlsx`)
      showToast(`💾 BACKUP DONE\n${words.length} words exported\n🔒 Combo hashes included\n${date}`)
    } catch (err) {
      console.error('Export failed:', err)
      showToast('⚠ EXPORT ERROR\nCheck console for details')
    } finally {
      setExporting(false)
    }
  }, [words, showToast])

  // ── Import from Excel (xlsx npm package) ─────────────────────────────────
  const [importing, setImporting] = useState(false)

  const importFromExcel = useCallback(async (file) => {
    if (!file) return
    setImporting(true)
    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      if (!ws) throw new Error('No worksheet found in the file')

      // Convert to array-of-arrays for header-aware parsing
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 })
      if (rows.length < 2) throw new Error('No data rows found')

      // Build column index map from header row (case-insensitive, robust to reordering)
      const headerRow = rows[0].map(h => String(h ?? '').trim().toLowerCase())
      const COL = {
        word:     headerRow.indexOf('word'),
        meaning:  headerRow.indexOf('meaning'),
        mastery:  headerRow.indexOf('mastery'),
        type:     headerRow.indexOf('type'),
        example:  headerRow.indexOf('example'),
        category: headerRow.indexOf('category'),
        combo:    headerRow.indexOf('combo'),
        hash:     headerRow.indexOf('_hash'),
      }

      if (COL.word === -1 || COL.meaning === -1) {
        throw new Error('"Word" and "Meaning" columns are required')
      }

      // Parse data rows
      const parsed = []
      let cheatCount = 0

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i]
        const rawWord = String(row[COL.word] ?? '').trim()
        const rawMeaning = String(row[COL.meaning] ?? '').trim()
        if (!rawWord || !rawMeaning) continue

        let parsedMastery = 0;
        if (COL.mastery !== -1 && row[COL.mastery] !== undefined && row[COL.mastery] !== '') {
          parsedMastery = parseInt(row[COL.mastery], 10);
          if (isNaN(parsedMastery)) parsedMastery = 0;
        }
        const mastery = Math.max(0, Math.min(100, parsedMastery));

        // ── Combo: read raw value, then verify hash ──
        let parsedCombo = 0
        if (COL.combo !== -1 && row[COL.combo] !== undefined && row[COL.combo] !== '') {
          parsedCombo = parseInt(row[COL.combo], 10)
          if (isNaN(parsedCombo) || parsedCombo < 0) parsedCombo = 0
        }

        parsed.push({
          word: rawWord,
          meaning: rawMeaning,
          mastery,
          comboRaw: parsedCombo,
          hashInFile: COL.hash !== -1 ? String(row[COL.hash] ?? '').trim().toUpperCase() : null,
          ...(COL.type !== -1     && { type:     String(row[COL.type]     ?? '').trim() }),
          ...(COL.example !== -1  && { example:  String(row[COL.example]  ?? '').trim() }),
          ...(COL.category !== -1 && { category: String(row[COL.category] ?? '').trim() }),
        })
      }

      if (parsed.length === 0) throw new Error('No valid rows found in the file')

      // Merge: update existing words, append new ones
      let updatedCount = 0
      let addedCount = 0

      setWords(prev => {
        const lookup = new Map(prev.map(w => [w.word.toLowerCase(), w]))
        const next = [...prev]

        parsed.forEach(incoming => {
          const key = incoming.word.toLowerCase()
          const existing = lookup.get(key)

          if (existing) {
            const idx = next.findIndex(w => w.id === existing.id)
            if (idx !== -1) {
              // ── Hash verification: recompute using the existing DB word ID ──
              let verifiedCombo = 0
              if (incoming.hashInFile !== null && incoming.comboRaw > 0) {
                const expectedHash = computeComboHash(existing.id, incoming.comboRaw)
                if (expectedHash === incoming.hashInFile) {
                  verifiedCombo = incoming.comboRaw
                } else {
                  // Hash mismatch — manual tamper detected, reset combo
                  cheatCount++
                  verifiedCombo = 0
                }
              } else if (incoming.hashInFile === null) {
                // No hash column in file (old export) — preserve existing combo
                verifiedCombo = next[idx].comboCount ?? 0
              }
              // else: hash present but combo === 0, no combo to verify

              next[idx] = {
                ...next[idx],
                meaning: incoming.meaning,
                mastery: incoming.mastery,
                comboCount: verifiedCombo,
                ...(incoming.type     !== undefined && { type:     incoming.type }),
                ...(incoming.example  !== undefined && { example:  incoming.example }),
                ...(incoming.category !== undefined && { category: incoming.category }),
              }
              updatedCount++
            }
          } else {
            // New word: no existing ID, so we cannot verify hash → combo resets to 0
            next.push({
              id: Date.now() + Math.random(),
              word: incoming.word,
              meaning: incoming.meaning,
              mastery: incoming.mastery,
              comboCount: 0,
              ...(incoming.type     !== undefined && { type:     incoming.type }),
              ...(incoming.example  !== undefined && { example:  incoming.example }),
              ...(incoming.category !== undefined && { category: incoming.category }),
            })
            lookup.set(key, { word: incoming.word })
            addedCount++
          }
        })

        bulkOverwriteCloud(next)
        return next
      })

      setTimeout(() => {
        const total = addedCount + updatedCount
        let msg = `📥 IMPORT DONE\n` +
          `${total} word${total !== 1 ? 's' : ''} processed\n` +
          `+${addedCount} new  ~${updatedCount} updated`
        if (cheatCount > 0) {
          msg += `\n⚠ ${cheatCount} COMBO RESET\nManual edit detected`
        }
        showToast(msg)
      }, 50)

    } catch (err) {
      console.error('Import failed:', err)
      showToast(`⚠ IMPORT ERROR\n${err.message ?? 'Unknown error'}`)
    } finally {
      setImporting(false)
      if (importFileRef.current) importFileRef.current.value = ''
    }
  }, [showToast])

  // ── Settings apply ────────────────────────────────────────────────────────
  const applyIntervalSetting = useCallback(() => {
    const n = parseInt(settingsInput, 10)
    if (isNaN(n) || n < 1 || n > 60) {
      showToast('⚠ INVALID INTERVAL\nEnter 1–60 minutes')
      return
    }
    setIntervalMinutes(n)
    showToast(`⚙ INTERVAL UPDATED\n${n} min per card\nTimer reset`)
    setShowSettings(false)
  }, [settingsInput, showToast])

  // ── Derived values ────────────────────────────────────────────────────────
  const schedPct = Math.min(100, (schedLeft / intervalSecs) * 100)
  const schedLow = schedLeft <= Math.min(30, intervalSecs * 0.1)
  const masteredCount = words.filter(w => w.errorCount === 0).length
  const liveCards = activeCards.filter(c => !c.exiting)
  const onBoardIds = new Set(liveCards.map(c => c.wordId))
  const chipClass = liveCards.length === 0 ? ' empty' : liveCards.length >= 8 ? ' many' : ''
  const filteredWords = words.filter(w => {
    if (!searchQuery.trim()) return true
    const term = searchQuery.toLowerCase()
    const matchWord = w.word.toLowerCase().includes(term)
    const matchMeaning = w.meaning.toLowerCase().includes(term)
    return matchWord || matchMeaning
  })

  if (authLoading || cloudLoading) {
    return (
      <div className="pixel-app" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <h1 className="pixel-title" style={{ fontSize: '24px' }}>LOADING...<span className="blink" /></h1>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="pixel-app">
        <header className="pixel-header">
          <div>
            <h1 className="pixel-title">INLIC<span className="blink" /></h1>
            <p className="pixel-subtitle">whiteboard canvas · v1.0</p>
          </div>
        </header>
        <Login onLoginWithGoogle={loginWithGoogle} onLoginAsGuest={loginAsGuest} />
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="pixel-app">

      {/* Stars */}
      <div className="pixel-stars" aria-hidden>
        {STARS.map(s => (
          <div key={s.id} className="star"
            style={{ top: s.top, left: s.left, '--dur': s.dur, '--delay': s.delay, '--op': s.op }}
          />
        ))}
      </div>

      {/* Word count badge */}
      <div className="word-count-badge">
        <span className="word-count-label">WORDS</span>
        <span className="word-count-num">{words.length}</span>
        <span className="word-count-sub">✓{masteredCount} DONE</span>
      </div>

      {/* Header */}
      <header className="pixel-header">
        <div>
          <h1 className="pixel-title">INLIC<span className="blink" /></h1>
          <p className="pixel-subtitle">whiteboard canvas · v1.0</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
          <button
            className={`settings-gear-btn${showSettings ? ' active' : ''}`}
            onClick={() => { setShowSettings(s => !s); setSettingsInput(String(intervalMinutes)) }}
            title="Settings"
            aria-label="Open settings"
          >⚙</button>
          <button
            className="logout-btn"
            onClick={logout}
            title="Logout"
            aria-label="Logout"
          >🚪</button>
        </div>
      </header>

      {/* Settings Panel */}
      {showSettings && (
        <div className="settings-panel">
          <span className="settings-panel-title">⚙ SETTINGS</span>
          <div className="settings-divider" />
          <div className="settings-field">
            <span className="settings-field-label">MINUTES PER CARD</span>
            <input
              className="settings-input"
              type="number"
              min="1"
              max="60"
              value={settingsInput}
              onChange={e => setSettingsInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applyIntervalSetting()}
            />
            <span className="settings-unit">MIN</span>
            <button className="settings-apply-btn" onClick={applyIntervalSetting}>✔ APPLY</button>
          </div>
          <div className="settings-info">
            CURRENT: {intervalMinutes} MIN/CARD<br />
            RANGE: 1–60 MIN
          </div>
        </div>
      )}

      {/* SCHED timer bar */}
      <div className="timer-strip">
        <span className="timer-label">SCHED</span>
        <div className="timer-bar-track">
          <div className={`timer-bar-fill${schedLow ? ' low' : ''}`} style={{ width: `${schedPct}%` }} />
        </div>
        <span className={`timer-countdown${schedLow ? ' low' : ''}`}>{formatTime(schedLeft)}</span>
        <span className={`next-card-chip${schedLow ? ' low' : ''}`}>NEXT CARD IN {formatTime(schedLeft)}</span>
        <span className={`board-chip${chipClass}`}>{liveCards.length} ON BOARD</span>
      </div>

      {/* Board + Stats side-by-side */}
      <div className="board-layout">
        {/* Whiteboard Canvas */}
        <section className="whiteboard-wrapper">
          <div className="whiteboard-label">
            WHITEBOARD CANVAS
            <span className="wb-label-count">{liveCards.length} active</span>
          </div>

          <div className="whiteboard">
            <div className="wb-tack tl" aria-hidden />
            <div className="wb-tack tr" aria-hidden />
            <div className="wb-tack bl" aria-hidden />
            <div className="wb-tack br" aria-hidden />

            {burst.length > 0 && (
              <div className="burst-wrap" aria-hidden>
                {burst.map(p => (
                  <div key={p.id} className="pixel-particle"
                    style={{
                      background: p.color, top: p.top, left: p.left,
                      '--tx': p.tx, '--ty': p.ty, '--dur': p.dur, animationDelay: p.delay,
                    }}
                  />
                ))}
              </div>
            )}

            {activeCards.length === 0 && (
              <div className="wb-empty">
                <span className="wb-empty-icon">📋</span>
                <p className="wb-empty-title">BOARD IS CLEAR</p>
                <p className="wb-empty-hint">
                  NEXT CARD IN {formatTime(schedLeft)}<br />
                  INTERVAL: {intervalMinutes} MIN/CARD (⚙ to change)<br />
                  OR HIT ▶ STUDY BELOW<br />
                  PROB ROLLS RUN SILENTLY IN BG<br />
                  UNANSWERED CARDS STACK UP OVER TIME
                </p>
              </div>
            )}

            <div className="whiteboard-cards">
              {activeCards.map((card, i) => (
                <PostItCard
                  key={card.uid}
                  card={card}
                  index={i}
                  totalWords={words.length}
                  onAnswer={checkCardAnswer}
                  onUpdateField={updateCardField}
                  onAnimEnd={clearCardAnim}
                  onCardHint={handleRequestHint}
                />
              ))}
            </div>
          </div>
        </section>

        {/* Stats Dashboard */}
        <StatsDashboard stats={stats} dailyStats={dailyStats} />
      </div>

      {/* Primary Action Row */}
      <div className="action-primary">
        <button className="pixel-btn pixel-btn-add" onClick={openModal}>＋ ADD WORD</button>
        
        <div className="study-quantity-selector">
          <button className="qty-btn" onClick={() => setStudyQuantity(q => Math.max(1, q - 1))}>-</button>
          <span className="qty-val">{studyQuantity}</span>
          <button className="qty-btn" onClick={() => setStudyQuantity(q => q + 1)}>+</button>
        </div>

        <button className="pixel-btn pixel-btn-study" onClick={() => triggerCard()}>
          ▶ STUDY {studyQuantity} {studyQuantity === 1 ? 'WORD' : 'WORDS'} <span style={{ opacity: 0.7, fontSize: '10px', marginLeft: '6px' }}>[TAB]</span>
        </button>
      </div>

      {/* Secondary Action Row */}
      <div className="action-secondary">
        <button
          className="pixel-btn-export"
          onClick={exportToExcel}
          disabled={exporting || words.length === 0}
          title="Export word bank to Excel (.xlsx)"
        >
          {exporting ? '⏳ EXPORTING…' : '💾 EXPORT XLS'}
        </button>
        <input
          ref={importFileRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: 'none' }}
          onChange={e => importFromExcel(e.target.files?.[0])}
        />
        <button
          className="pixel-btn-import"
          onClick={() => importFileRef.current?.click()}
          disabled={importing}
          title="Import words from Excel (.xlsx)"
        >
          {importing ? '⏳ IMPORTING…' : '📥 IMPORT XLS'}
        </button>
        <button className="pixel-btn-reset" onClick={handleReset}>🗑 RESET</button>
      </div>

      {/* Word Bank */}
      <WordBank
        words={words}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        filteredWords={filteredWords}
        onBoardIds={onBoardIds}
        editingWordId={editingWordId}
        editFormData={editFormData}
        setEditFormData={setEditFormData}
        handleCardBlur={handleCardBlur}
        handleEditKeyDown={handleEditKeyDown}
        handleEditClick={handleEditClick}
        handleDeleteWord={handleDeleteWord}
      />

      <footer className="pixel-footer">▓▒░ WHITEBOARD CANVAS v1.0 ░▒▓</footer>

      {/* Add Word Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="pixel-modal" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">+ ADD NEW WORD</h2>
            <div className="modal-field">
              <label className="modal-field-label">WORD</label>
              <input
                ref={modalInput1}
                className="modal-input"
                type="text"
                placeholder="e.g. SERENITY"
                value={newWord.word}
                onChange={e => { setModalError(''); setNewWord(p => ({ ...p, word: e.target.value })) }}
                onKeyDown={e => e.key === 'Enter' && handleAddWord()}
              />
            </div>
            <div className="modal-field">
              <label className="modal-field-label">MEANING</label>
              <input
                className="modal-input"
                type="text"
                placeholder="e.g. Bình yên, thanh thản"
                value={newWord.meaning}
                onChange={e => { setModalError(''); setNewWord(p => ({ ...p, meaning: e.target.value })) }}
                onKeyDown={e => e.key === 'Enter' && handleAddWord()}
              />
            </div>
            <div className="modal-field">
              <label className="modal-field-label">Word Type (optional)</label>
              <input
                className="modal-input"
                type="text"
                placeholder="e.g. noun, v, adj"
                value={newWord.type}
                onChange={e => { setModalError(''); setNewWord(p => ({ ...p, type: e.target.value })) }}
                onKeyDown={e => e.key === 'Enter' && handleAddWord()}
              />
            </div>
            {modalError && <div className="modal-error">{modalError}</div>}
            <div className="modal-actions">
              <button className="modal-btn-confirm" onClick={handleAddWord}>✔ SAVE</button>
              <button className="modal-btn-cancel" onClick={closeModal}>✖ CANCEL</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`roll-toast${toast.fadeOut ? ' fade-out' : ''}`}>
          <span className="toast-title">FREQ ENGINE</span>
          {toast.msg.split('\n').map((line, i) => <span key={i}>{line}<br /></span>)}
        </div>
      )}
    </div>
  )
}
