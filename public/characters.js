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

  function drawAccessory(ctx, frame, size, headY) {
    const accessory = { cat:"cat", party:"party", crown:"crown", halo:"halo" }[frame];
    if (!accessory) return;
    ctx.save(); ctx.strokeStyle="#20243b"; ctx.lineWidth=Math.max(1.5,size*.04); ctx.lineJoin="round";
    if(accessory==="cat"){
      // Two separate ears sit on the head rather than forming a wide, wobbly
      // band across it. This keeps the frame centred at every character size.
      ctx.fillStyle="#f472b6";
      [[-size*.27,-size*.08], [size*.08,size*.27]].forEach(([left,right])=>{
        ctx.beginPath();ctx.moveTo(left,headY-size*.16);ctx.lineTo((left+right)/2,headY-size*.50);ctx.lineTo(right,headY-size*.16);ctx.closePath();ctx.fill();ctx.stroke();
      });
    }else if(accessory==="party"){
      ctx.fillStyle="#60a5fa";ctx.beginPath();ctx.moveTo(-size*.17,headY-size*.28);ctx.lineTo(size*.08,headY-size*.72);ctx.lineTo(size*.28,headY-size*.25);ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle="#facc15";ctx.beginPath();ctx.arc(size*.08,headY-size*.75,size*.07,0,TAU);ctx.fill();
    }else if(accessory==="crown"){
      ctx.fillStyle="#facc15";ctx.beginPath();ctx.moveTo(-size*.26,headY-size*.28);ctx.lineTo(-size*.27,headY-size*.55);ctx.lineTo(-size*.1,headY-size*.4);ctx.lineTo(0,headY-size*.64);ctx.lineTo(size*.1,headY-size*.4);ctx.lineTo(size*.27,headY-size*.55);ctx.lineTo(size*.26,headY-size*.28);ctx.closePath();ctx.fill();ctx.stroke();
    }else{ctx.strokeStyle="#fde68a";ctx.lineWidth=Math.max(2,size*.07);ctx.beginPath();ctx.ellipse(0,headY-size*.53,size*.28,size*.08,0,0,TAU);ctx.stroke();}
    ctx.restore();
  }

  // The same vector artwork drives menu SVGs and canvas characters.
  // Cream face discs, smiling eyes and pink tongues echo the capsule cast.
  const ink = "#191541", pink = "#ff668c";
  const smile = [
    ["M6 14 Q12 12.7 18 14 C18 22 6 22 6 14Z", ink],
    ["M8.5 18 Q12 16.5 15.5 18 Q12 21 8.5 18Z", pink]
  ];
  const faceArt = {
    joy: [["M5 10 Q7 4.5 9 10 M15 10 Q17 4.5 19 10", null, ink], ...smile],
    wink: [["M5 9 A2 3 0 1 0 9 9 A2 3 0 1 0 5 9", ink], ["M18 6 L14 9 L18 11", null, ink], ...smile],
    wow: [["M5 8 A2 2.6 0 1 0 9 8 A2 2.6 0 1 0 5 8 M15 8 A2 2.6 0 1 0 19 8 A2 2.6 0 1 0 15 8", ink], ["M9 16 A3 4 0 1 0 15 16 A3 4 0 1 0 9 16", ink], ["M10 18 Q12 17 14 18 Q12 20 10 18", pink]],
    cool: [["M3.5 7 H10.5 V9 Q10.5 12 7 12 Q3.5 12 3.5 9Z M13.5 7 H20.5 V9 Q20.5 12 17 12 Q13.5 12 13.5 9Z", ink], ["M10 8 H14", null, ink], ["M5 8 L7 8 M15 8 L17 8", null, "#9bc9f6"], ...smile],
    heart: [["M7 12 C-1 7 4 2 7 6 C10 2 15 7 7 12Z M17 12 C9 7 14 2 17 6 C20 2 25 7 17 12Z", pink], ...smile],
    dizzy: [["M5 6 L9 11 M9 6 L5 11 M15 6 L19 11 M19 6 L15 11", null, ink], ...smile]
  };
  function faceParts(face) { return faceArt[String(face).replace(/^face-/, "")] || faceArt.joy; }
  function faceSvg(face) {
    return '<svg class="face-badge" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#fff0ca"/>' +
      faceParts(face).map(([d, fill, stroke]) => `<path d="${d}" fill="${fill || "none"}" stroke="${stroke || "none"}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`).join("") + '</svg>';
  }
  const facePaths = new Map();
  function drawBadgeFace(ctx, face, size, y) {
    ctx.save();
    const scale = size * .52 / 24;
    ctx.translate(-12 * scale, y - 12 * scale);ctx.scale(scale, scale);
    ctx.lineWidth=2.2;ctx.lineCap="round";ctx.lineJoin="round";
    for (const [d, fill, stroke] of faceParts(face)) {
      if (!facePaths.has(d)) facePaths.set(d, new Path2D(d));
      const path = facePaths.get(d);
      if (fill) { ctx.fillStyle=fill;ctx.fill(path); }
      if (stroke) { ctx.strokeStyle=stroke;ctx.stroke(path); }
    }
    ctx.restore();
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
    if(String(emoji).startsWith("face-"))drawBadgeFace(ctx,emoji,size,-size*.27+m.head);
    else {ctx.font = `${Math.round(size * .39)}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`;ctx.textAlign = "center";ctx.textBaseline = "middle";ctx.fillText(emoji, 0, -size * .245 + m.head);}
    drawAccessory(ctx, avatar.frame, size, -size*.25+m.head);

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

  window.PaperCharacter = { draw, drawBadgeFace, faceSvg, element, motion };
})();
