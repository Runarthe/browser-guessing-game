"use strict";

/* Original code-native paper-cutout character system. It supports both Canvas
   games and DOM-based game boards without external image assets. */
(function () {
  const TAU = Math.PI * 2;

  function motion(state, time) {
    const t = time / 1000;
    if (state === "run" || state === "walk") {
      return { bob: Math.abs(Math.sin(t * 11)) * -2, tilt: Math.sin(t * 11) * .055, leg: Math.sin(t * 14) * 5, arm: Math.sin(t * 14) * 5, head: Math.sin(t * 11) * -1, sx: 1.02, sy: .98 };
    }
    if (state === "jump") return { bob: -3, tilt: -.08, leg: -3, arm: -7, head: -2, sx: .9, sy: 1.1 };
    if (state === "fall") return { bob: 1, tilt: .1, leg: 4, arm: 4, head: 1, sx: 1.07, sy: .93 };
    if (state === "land") return { bob: 4, tilt: 0, leg: 5, arm: 2, head: 3, sx: 1.12, sy: .82 };
    if (state === "stunned") return { bob: Math.sin(t * 24) * 2, tilt: Math.sin(t * 18) * .22, leg: 0, arm: Math.sin(t*20)*3, head: 0, sx: 1, sy: 1 };
    if (state === "eliminated") return { bob: 5, tilt: Math.sin(t * 5) * .25, leg: 4, arm: 5, head: 2, sx: .88, sy: .82 };
    if (state === "celebrate") return { bob: Math.abs(Math.sin(t * 8)) * -9, tilt: Math.sin(t * 8) * .12, leg: -4, arm: -11, head: -2, sx: .97, sy: 1.05 };
    if (state === "sad") return { bob: 3, tilt: -.08, leg: 1, arm: 6, head: 2, sx: 1.04, sy: .9 };
    return { bob: Math.sin(t * 3) * 1.4, tilt: Math.sin(t * 2.2) * .025, leg: 0, arm: 0, head: Math.sin(t*3)*-.5, sx: 1, sy: 1 };
  }

  function shade(hex, amount) {
    const match = /^#([0-9a-f]{6})$/i.exec(hex || "");
    if (!match) return "#b58b2c";
    const n = parseInt(match[1], 16);
    const part = (shift) => Math.max(0, Math.min(255, ((n >> shift) & 255) + amount));
    return `rgb(${part(16)},${part(8)},${part(0)})`;
  }

  function draw(ctx, options) {
    const o = options || {};
    const x = Number(o.x) || 0, y = Number(o.y) || 0;
    const size = Number(o.size) || 42, direction = o.direction === -1 ? -1 : 1;
    const state = o.state || "idle", avatar = o.avatar || {};
    const color = avatar.color || "#ffcb3d", emoji = avatar.emoji || "🙂";
    const m = motion(state, o.time ?? performance.now());
    const alpha = state === "eliminated" ? .58 : 1;

    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(x, y + m.bob);

    // Soft ground shadow remains untransformed to sell the paper-cutout lift.
    ctx.save();
    ctx.fillStyle = "rgba(4,8,25,.24)";
    ctx.scale(1, .35);
    ctx.beginPath(); ctx.ellipse(0, size * 1.28, size * .42, size * .19, 0, 0, TAU); ctx.fill();
    ctx.restore();

    ctx.scale(direction * m.sx, m.sy);
    ctx.rotate(m.tilt);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // Legs and chunky shoes.
    ctx.strokeStyle = shade(color, -45);
    ctx.lineWidth = Math.max(3, size * .09);
    ctx.beginPath();
    ctx.moveTo(-size * .13, size * .25); ctx.lineTo(-size * .17 - m.leg, size * .48);
    ctx.moveTo(size * .13, size * .25); ctx.lineTo(size * .17 + m.leg, size * .48);
    ctx.stroke();
    ctx.fillStyle="#20243b";
    ctx.beginPath();ctx.ellipse(-size*.18-m.leg,size*.5,size*.105,size*.05,0,0,TAU);
    ctx.ellipse(size*.18+m.leg,size*.5,size*.105,size*.05,0,0,TAU);ctx.fill();

    // Small torso and visible arms make the silhouette readable at game scale.
    ctx.fillStyle = color;
    ctx.strokeStyle = "#20243b";
    ctx.lineWidth = Math.max(2, size * .065);
    ctx.beginPath();
    ctx.moveTo(-size * .24, -size * .04);
    ctx.quadraticCurveTo(-size * .34, size * .16, -size * .26, size * .34);
    ctx.quadraticCurveTo(0, size * .42, size * .26, size * .34);
    ctx.quadraticCurveTo(size * .34, size * .16, size * .24, -size * .04);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = shade(color,-35); ctx.lineWidth = Math.max(3,size*.08);
    ctx.beginPath();
    ctx.moveTo(-size*.22,size*.06);ctx.lineTo(-size*.38,size*.2 + m.arm);
    ctx.moveTo(size*.22,size*.06);ctx.lineTo(size*.38,size*.2 - m.arm);ctx.stroke();
    ctx.fillStyle="#fff8e8";ctx.strokeStyle="#20243b";ctx.lineWidth=Math.max(1.5,size*.035);
    for(const [hx,hy] of [[-size*.39,size*.2+m.arm],[size*.39,size*.2-m.arm]]){
      ctx.beginPath();ctx.arc(hx,hy,size*.065,0,TAU);ctx.fill();ctx.stroke();
    }

    // Oversized head with a colored rim and warm paper face.
    ctx.fillStyle = color; ctx.strokeStyle="#20243b"; ctx.lineWidth=Math.max(2,size*.065);
    ctx.beginPath();ctx.arc(0,-size*.25 + m.head,size*.34,0,TAU);ctx.fill();ctx.stroke();
    ctx.fillStyle = "#fff8e8";
    ctx.beginPath(); ctx.arc(0, -size * .25 + m.head, size * .255, 0, TAU); ctx.fill();
    ctx.font = `${Math.round(size * .39)}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(emoji, 0, -size * .245 + m.head);

    // Paper highlight and tiny collar.
    ctx.strokeStyle = "rgba(255,255,255,.45)"; ctx.lineWidth = Math.max(1, size * .035);
    ctx.beginPath();ctx.arc(-size*.05,-size*.29+m.head,size*.22,3.3,4.5);ctx.stroke();
    ctx.fillStyle=shade(color,-30);ctx.beginPath();ctx.moveTo(-size*.1,.02*size);ctx.lineTo(0,size*.1);ctx.lineTo(size*.1,.02*size);ctx.fill();

    if (state === "stunned") {
      ctx.font = `${Math.round(size * .25)}px sans-serif`;
      ctx.fillText("★", -size * .32, -size * .62); ctx.fillText("★", size * .34, -size * .56);
    }
    if (state === "celebrate") {
      ctx.fillStyle="#ffd43b";ctx.font=`${Math.round(size*.18)}px sans-serif`;
      ctx.fillText("✦",-size*.42,-size*.5);ctx.fillText("✦",size*.43,-size*.42);
    }
    ctx.restore();
  }

  function element(avatar, state, label) {
    const root = document.createElement("span");
    root.className = `paper-character pc-${state || "idle"}`;
    root.style.setProperty("--pc-color", avatar?.color || "#ffcb3d");
    root.setAttribute("aria-label", label || "Player");
    root.innerHTML =
      `<span class="pc-shadow"></span><span class="pc-leg pc-leg-a"></span>` +
      `<span class="pc-leg pc-leg-b"></span><span class="pc-body">` +
      `<span class="pc-face"></span></span>`;
    root.querySelector(".pc-face").textContent = avatar?.emoji || "🙂";
    return root;
  }

  window.PaperCharacter = { draw, element, motion };
})();
