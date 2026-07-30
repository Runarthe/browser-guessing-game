"use strict";

/* Reusable pseudo-3D renderer for movement minigames. Game physics stay in the
   simple 720x440 arena; this layer projects that world onto a perspective stage. */
(function () {
  const W = 720, H = 440;

  class Arena25D {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.horizon = 82;
      this.bottom = 424;
      this.center = W / 2;
    }

    project(x, y, lift = 0) {
      const depth = Math.max(0, Math.min(1, y / H));
      const eased = Math.pow(depth, .84);
      const halfWidth = 205 + 145 * eased;
      return {
        x: this.center + ((x / W) - .5) * halfWidth * 2,
        y: this.horizon + eased * (this.bottom - this.horizon) - lift,
        scale: .54 + depth * .58,
        depth
      };
    }

    quad(x, y, width, height, lift = 0) {
      return [
        this.project(x, y, lift),
        this.project(x + width, y, lift),
        this.project(x + width, y + height, lift),
        this.project(x, y + height, lift)
      ];
    }

    path(points) {
      const ctx = this.ctx;
      ctx.beginPath();
      points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.closePath();
    }

    backdrop(theme = "night", time = 0) {
      const ctx = this.ctx, c = this.canvas;
      const sky = ctx.createLinearGradient(0, 0, 0, c.height);
      if (theme === "lava") {
        sky.addColorStop(0, "#24123c"); sky.addColorStop(.58, "#71301d"); sky.addColorStop(1, "#160c18");
      } else if (theme === "void") {
        sky.addColorStop(0, "#101a35"); sky.addColorStop(.55, "#243b61"); sky.addColorStop(1, "#08101e");
      } else {
        sky.addColorStop(0, "#111b39"); sky.addColorStop(.58, "#28496a"); sky.addColorStop(1, "#0b1324");
      }
      ctx.fillStyle = sky; ctx.fillRect(0, 0, c.width, c.height);

      // Layered silhouettes and slow parallax lights make the arena feel staged.
      ctx.fillStyle = "rgba(8,13,30,.6)";
      for (let i = 0; i < 11; i++) {
        const x = i * 76 - 25, h = 20 + (i * 17 % 54);
        ctx.fillRect(x, this.horizon - h, 62, h + 8);
        ctx.fillStyle = "rgba(255,221,120,.28)";
        for (let wy = this.horizon - h + 10; wy < this.horizon - 5; wy += 14) {
          ctx.fillRect(x + 10 + ((i + wy) % 2) * 20, wy, 7, 5);
        }
        ctx.fillStyle = "rgba(8,13,30,.6)";
      }
      const glow = ctx.createRadialGradient(360, this.horizon, 4, 360, this.horizon, 260);
      glow.addColorStop(0, "rgba(255,255,255,.18)");
      glow.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glow; ctx.fillRect(80, 0, 560, 270);

      ctx.fillStyle = theme === "lava" ? "#321018" : "#07101e";
      ctx.fillRect(0, this.bottom - 2, W, H - this.bottom + 2);
      ctx.fillStyle = "rgba(255,255,255,.05)";
      for (let i = 0; i < 12; i++) {
        const x = (i * 91 + time / 55) % 820 - 50;
        ctx.beginPath(); ctx.ellipse(x, 433, 30, 3, 0, 0, Math.PI * 2); ctx.fill();
      }
    }

    tile(x, y, width, height, options = {}) {
      const ctx = this.ctx;
      const lift = options.lift || 0;
      const top = this.quad(x, y, width, height, lift);
      const thickness = options.thickness ?? 9;
      if (thickness > 0) {
        const bottom = top.map((p) => ({ x: p.x, y: p.y + thickness }));
        ctx.fillStyle = options.side || "#17213a";
        this.path([top[3], top[2], bottom[2], bottom[3]]); ctx.fill();
        ctx.fillStyle = options.sideRight || options.side || "#11182b";
        this.path([top[1], top[2], bottom[2], bottom[1]]); ctx.fill();
      }
      ctx.fillStyle = options.fill || "#4b6b8b";
      this.path(top); ctx.fill();
      ctx.strokeStyle = options.stroke || "rgba(255,255,255,.25)";
      ctx.lineWidth = options.lineWidth || 1.5;
      this.path(top); ctx.stroke();
      return top;
    }

    shadow(x, y, radius, alpha = .3) {
      const ctx = this.ctx, p = this.project(x, y);
      ctx.save();
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
      ctx.beginPath(); ctx.ellipse(p.x, p.y + 8, radius * p.scale, radius * .28 * p.scale, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    lavaSparks(time, intensity = 1) {
      const ctx = this.ctx;
      ctx.save();
      for (let i = 0; i < 18 * intensity; i++) {
        const phase = (time / 18 + i * 137) % 900;
        const x = (i * 97 + Math.sin(i * 4.1) * 80) % 720;
        const y = 425 - phase * .1;
        ctx.globalAlpha = Math.max(0, 1 - phase / 900) * .65;
        ctx.fillStyle = i % 2 ? "#fb923c" : "#fde047";
        ctx.beginPath(); ctx.arc(x, y, 1.5 + (i % 3), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  window.Arena25D = Arena25D;
})();
