/**
 * puzzle.js
 * パズルロジック・Canvas描画・タッチ/マウス操作
 */

import { saveState, clearState } from './storage.js';

const SNAP_THRESHOLD = 0.4; // ピースサイズの40%以内でスナップ
const SAVE_DEBOUNCE = 500;  // ms

export class Puzzle {
  constructor({ canvas, image, cols, rows, elapsed = 0, savedPieces = null, onComplete, onUpdate }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.image = image;
    this.cols = cols;
    this.rows = rows;
    this.elapsed = elapsed;
    this.onComplete = onComplete;
    this.onUpdate = onUpdate;

    this.pieces = [];
    this.dragging = null;
    this.timerInterval = null;
    this.saveTimer = null;
    this.completed = false;

    this._resize = this._resize.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);

    this._setupCanvas();
    this._initPieces(savedPieces);
    this._attachEvents();
    this._startTimer();
    this._render();
  }

  _setupCanvas() {
    this._resize();
    window.addEventListener('resize', this._resize);
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const container = this.canvas.parentElement;
    const w = container.clientWidth;
    const h = container.clientHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.scale(dpr, dpr);
    this.viewW = w;
    this.viewH = h;

    const margin = 0.85;
    this.pieceW = Math.floor((w * margin) / this.cols);
    this.pieceH = Math.floor((h * margin) / this.rows);

    const gridW = this.pieceW * this.cols;
    const gridH = this.pieceH * this.rows;
    this.gridOffsetX = Math.floor((w - gridW) / 2);
    this.gridOffsetY = Math.floor((h - gridH) / 2);

    // リサイズ時に配置済みピースの座標を正しい位置に更新
    if (this.pieces.length > 0) {
      for (const p of this.pieces) {
        if (p.placed) {
          p.x = this._correctX(p);
          p.y = this._correctY(p);
        }
      }
      this._render();
    }
  }

  _initPieces(saved) {
    if (saved) {
      // 復元時: 配置済みは正しい座標に、未配置は現在の画面内にクランプ
      this.pieces = saved.map(p => {
        const piece = { ...p };
        if (piece.placed) {
          piece.x = this._correctX(piece);
          piece.y = this._correctY(piece);
        } else {
          piece.x = Math.max(0, Math.min(piece.x, this.viewW - this.pieceW));
          piece.y = Math.max(0, Math.min(piece.y, this.viewH - this.pieceH));
        }
        return piece;
      });
      return;
    }
    const pieces = [];
    const { cols, rows, pieceW, pieceH, viewW, viewH } = this;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = Math.random() * (viewW - pieceW);
        const y = Math.random() * (viewH - pieceH);
        pieces.push({ c, r, x, y, placed: false });
      }
    }
    this.pieces = pieces;
  }

  _correctX(piece) { return this.gridOffsetX + piece.c * this.pieceW; }
  _correctY(piece) { return this.gridOffsetY + piece.r * this.pieceH; }

  _render() {
    const { ctx, viewW, viewH, pieces, image, pieceW, pieceH, cols, rows } = this;
    ctx.clearRect(0, 0, viewW, viewH);

    // グリッドガイド（薄い枠）
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = this.gridOffsetX + c * pieceW;
        const y = this.gridOffsetY + r * pieceH;
        ctx.strokeRect(x, y, pieceW, pieceH);
      }
    }
    ctx.restore();

    // 配置済みピースを先に描画（下レイヤー）
    for (const p of pieces) {
      if (p.placed) this._drawPiece(p);
    }
    // 未配置ピースを上に描画
    for (const p of pieces) {
      if (!p.placed && p !== this.dragging) this._drawPiece(p);
    }
    // ドラッグ中は最前面
    if (this.dragging) this._drawPiece(this.dragging);
  }

  _drawPiece(p) {
    const { ctx, image, pieceW, pieceH, cols, rows } = this;
    const sx = (p.c / cols) * image.width;
    const sy = (p.r / rows) * image.height;
    const sw = image.width / cols;
    const sh = image.height / rows;

    ctx.save();
    if (!p.placed) {
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
    }
    ctx.drawImage(image, sx, sy, sw, sh, p.x, p.y, pieceW, pieceH);

    // ピース枠
    ctx.strokeStyle = p.placed ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.6)';
    ctx.lineWidth = p === this.dragging ? 2 : 1;
    ctx.strokeRect(p.x, p.y, pieceW, pieceH);
    ctx.restore();
  }

  _getEventPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  }

  _hitTest(x, y) {
    // 逆順（前面優先）
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      if (p.placed) continue;
      if (x >= p.x && x <= p.x + this.pieceW && y >= p.y && y <= p.y + this.pieceH) {
        return { piece: p, index: i };
      }
    }
    return null;
  }

  _onPointerDown(e) {
    e.preventDefault();
    const { x, y } = this._getEventPos(e);
    const hit = this._hitTest(x, y);
    if (!hit) return;
    const { piece, index } = hit;
    this.dragging = piece;
    this.dragOffsetX = x - piece.x;
    this.dragOffsetY = y - piece.y;
    // ドラッグ中ピースを配列末尾へ（最前面）
    this.pieces.splice(index, 1);
    this.pieces.push(piece);
  }

  _onPointerMove(e) {
    e.preventDefault();
    if (!this.dragging) return;
    const { x, y } = this._getEventPos(e);
    this.dragging.x = x - this.dragOffsetX;
    this.dragging.y = y - this.dragOffsetY;
    this._render();
  }

  _onPointerUp(e) {
    e.preventDefault();
    if (!this.dragging) return;
    const p = this.dragging;
    this.dragging = null;

    // スナップ判定
    const cx = this._correctX(p);
    const cy = this._correctY(p);
    const dist = Math.hypot(p.x - cx, p.y - cy);
    const threshold = Math.min(this.pieceW, this.pieceH) * SNAP_THRESHOLD;

    if (dist < threshold) {
      p.x = cx;
      p.y = cy;
      p.placed = true;
    }

    this._render();
    this._scheduleSave();
    // ピース移動直後に進捗を即時反映
    if (this.onUpdate) this.onUpdate(this.elapsed);
    this._checkComplete();
  }

  _attachEvents() {
    const c = this.canvas;
    c.addEventListener('touchstart', this._onPointerDown, { passive: false });
    c.addEventListener('touchmove', this._onPointerMove, { passive: false });
    c.addEventListener('touchend', this._onPointerUp, { passive: false });
    c.addEventListener('mousedown', this._onPointerDown);
    window.addEventListener('mousemove', this._onPointerMove);
    window.addEventListener('mouseup', this._onPointerUp);
  }

  _detachEvents() {
    const c = this.canvas;
    c.removeEventListener('touchstart', this._onPointerDown);
    c.removeEventListener('touchmove', this._onPointerMove);
    c.removeEventListener('touchend', this._onPointerUp);
    c.removeEventListener('mousedown', this._onPointerDown);
    window.removeEventListener('mousemove', this._onPointerMove);
    window.removeEventListener('mouseup', this._onPointerUp);
    window.removeEventListener('resize', this._resize);
  }

  _startTimer() {
    this.timerInterval = setInterval(() => {
      this.elapsed++;
      if (this.onUpdate) this.onUpdate(this.elapsed);
    }, 1000);
  }

  _stopTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
  }

  _scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this._save(), SAVE_DEBOUNCE);
  }

  async _save() {
    if (this.completed) return;
    if (this._imageBlob) {
      await saveState({
        imageBlob: this._imageBlob,
        pieces: this.pieces.map(p => ({ ...p })),
        cols: this.cols,
        rows: this.rows,
        elapsed: this.elapsed,
      });
    }
  }

  setImageBlob(blob) {
    this._imageBlob = blob;
  }

  _checkComplete() {
    const done = this.pieces.every(p => p.placed);
    if (!done) return;
    this.completed = true;
    this._stopTimer();
    this._detachEvents();
    clearState();
    if (this.onComplete) this.onComplete(this.elapsed);
  }

  destroy() {
    this._stopTimer();
    this._detachEvents();
    if (this.saveTimer) clearTimeout(this.saveTimer);
  }

  getPiecesSnapshot() {
    return this.pieces.map(p => ({ ...p }));
  }

  getElapsed() { return this.elapsed; }
}

export function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
