(() => {
  "use strict";
  // Isolated ToxicFox copy of Gecko Escape's current fox controller and renderer.
  const canvas = document.querySelector("#field");
  const ctx = canvas.getContext("2d");
  const status = document.querySelector("#status");
  const speedReadout = document.querySelector("#speed");
  const W = canvas.width, H = canvas.height;
  const keys = Object.create(null);
  const player = { x: 150, y: 380, w: 120, h: 100, vx: 0, vy: 0, facing: 1, grounded: false };
  let foxLabStridePhase = 0;
  const foxLabTailAngles = [0, 0, 0, 0, 0], foxLabTailVelocities = [0, 0, 0, 0, 0];
  let foxLabLandingImpact = 0, foxLabTakeoffUntil = 0;
  let foxLabTurnTo = 1, foxLabTurnProgress = 1, foxLabFacingVisual = 1, foxLabTurnDuration = .21;
  let foxLabInvestigation = 0, foxLabIdleTime = 0, foxLabJumpHoldBlend = 0;
  const foxLabSurfaces = [
    {x:0,y:480,w:960,h:60,ground:true},
    {x:190,y:452,w:112,h:14}, {x:302,y:432,w:112,h:14},
    {x:414,y:412,w:112,h:14}, {x:605,y:386,w:148,h:14},
    {x:753,y:430,w:128,h:14}, {x:455,y:328,w:118,h:14}
  ];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  addEventListener("keydown", event => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "Space"].includes(event.code)) event.preventDefault();
    if (keys[event.code]) return;
    keys[event.code] = true;
    if (["Space", "ArrowUp", "KeyW"].includes(event.code) && player.grounded) {
      player.vy = -545;
      player.grounded = false;
      foxLabTakeoffUntil = performance.now() + 145;
    }
  });
  addEventListener("keyup", event => { keys[event.code] = false; });

  function updateFox(dt,now,left,right,up,investigate){
    const input=(left?-1:0)+(right?1:0),oldVx=player.vx;
    const speed=Math.abs(player.vx),reversing=input&&speed>8&&Math.sign(player.vx)!==input;
    if(input&&input!==foxLabTurnTo){foxLabTurnTo=input;foxLabTurnProgress=0;foxLabTurnDuration=.21+Math.min(speed,285)*.00032;}
    if(foxLabTurnProgress<1)foxLabTurnProgress=Math.min(1,foxLabTurnProgress+dt/foxLabTurnDuration);
    if(foxLabTurnProgress>=.52&&(Math.abs(player.vx)<34||Math.sign(player.vx)===foxLabTurnTo))foxLabFacingVisual=player.facing=foxLabTurnTo;

    if(input){
      const accel=player.grounded?(reversing?1040:690):(reversing?410:280);
      player.vx+=input*accel*dt;
    }else player.vx*=Math.exp(-(player.grounded?5.4:1.65)*dt);
    player.vx=Math.max(-285,Math.min(285,player.vx));
    if(Math.abs(player.vx)<1.6&&!input)player.vx=0;

    const oldBottom=player.y+player.h,fallSpeed=player.vy;
    const jumpHeld=up&&player.vy<0?1:0;
    foxLabJumpHoldBlend+=(jumpHeld-foxLabJumpHoldBlend)*(1-Math.exp(-14*dt));
    player.vy=Math.min(920,player.vy+(1650-foxLabJumpHoldBlend*500)*dt);
    player.x=Math.max(90,Math.min(W-player.w-36,player.x+player.vx*dt));
    player.y+=player.vy*dt;player.grounded=false;
    let landing=null;
    if(player.vy>=0){
      for(const surface of foxLabSurfaces){
        if(oldBottom<=surface.y+1&&player.y+player.h>=surface.y&&player.x+player.w>surface.x&&player.x<surface.x+surface.w&&(!landing||surface.y<landing.y))landing=surface;
      }
    }
    if(landing){
      player.y=landing.y-player.h;player.vy=0;player.grounded=true;foxLabJumpHoldBlend=0;
      if(fallSpeed>35){foxLabLandingImpact=Math.min(1,fallSpeed/700);foxLabTailVelocities[0]+=Math.min(.8,fallSpeed*.0011);}
    }
    if(player.y<34){player.y=34;player.vy=Math.max(0,player.vy);}

    const currentSpeed=Math.abs(player.vx),strideLength=22+currentSpeed*.17;
    if(player.grounded&&currentSpeed>1.4)foxLabStridePhase+=currentSpeed*dt*Math.PI/strideLength;
    foxLabIdleTime=player.grounded&&currentSpeed<9&&!input?foxLabIdleTime+dt:0;
    const investigateTarget=investigate&&player.grounded&&!input&&currentSpeed<18?1:0;
    foxLabInvestigation+=(investigateTarget-foxLabInvestigation)*(1-Math.exp(-5.5*dt));
    foxLabLandingImpact*=Math.exp(-8.5*dt);

    const acceleration=((player.vx-oldVx)/Math.max(dt,.001))*player.facing;
    // The pelvis turns first; each tail segment receives that impulse later and loses energy as it travels outward.
    const tailTarget=Math.max(-.72,Math.min(.78,.13+acceleration*.00048-player.vy*.0005+foxLabInvestigation*.2+(currentSpeed<12?.07:0)));
    for(let i=0;i<foxLabTailAngles.length;i++){
      const prior=i?foxLabTailAngles[i-1]:tailTarget;
      const bend=i>1?(foxLabTailAngles[i-1]-foxLabTailAngles[i-2])*.36:0;
      const target=i?prior+bend+.025*i:tailTarget;
      foxLabTailVelocities[i]+=(target-foxLabTailAngles[i])*(i?23-i*1.15:32)*dt;
      foxLabTailVelocities[i]*=Math.exp(-(i?4.9:6.8)*dt);
      foxLabTailAngles[i]=Math.max(-.9,Math.min(.96,foxLabTailAngles[i]+foxLabTailVelocities[i]*dt));
    }
  }

function drawFox(now){
    const speed=Math.abs(player.vx),move=Math.max(0,Math.min(1,speed/54)),run=Math.max(0,Math.min(1,(speed-118)/150));
    const airborne=!player.grounded,phase=foxLabStridePhase,impact=foxLabLandingImpact,investigate=foxLabInvestigation;
    const launch=airborne?Math.max(0,Math.min(1,(now-(foxLabTakeoffUntil-145))/145)):0;
    const stride=22+speed*.17,walkBeat=phase,runBeat=phase*1.08;
    const bodyWave=Math.sin(phase*.5-.4),compress=Math.max(0,bodyWave)*run;
    const bounce=player.grounded?(Math.sin(phase)*run*2.1+Math.abs(Math.sin(phase))*move*.65):0;
    const pitch=airborne?Math.max(-.16,Math.min(.16,player.vy*.00022)):(-.035*run+bodyWave*.025*run-impact*.07+investigate*.025);
    const breathe=player.grounded&&speed<9?Math.sin(now*.0021)*.7:0;
    const rise=8+compress*1.7+launch*1.8-investigate*1.5+breathe;
    const footLine=player.h/2-2+rise-bounce-impact*5;
    const fwd=foxLabFacingVisual,turnCompress=Math.sin(foxLabTurnProgress*Math.PI)*.09;
    ctx.save();ctx.translate(player.x+player.w/2,player.y+player.h/2+bounce+impact*5-rise);
    ctx.scale(fwd*(1-turnCompress),1-impact*.035+launch*.018);ctx.rotate(pitch);

    // A weighted brush tail whose bend travels from pelvis to tip.
    const tailPts=[[-39,0]],tailLens=[16,19,20,19,16];let tx=-39,ty=0;
    for(let i=0;i<tailLens.length;i++){const a=foxLabTailAngles[i];tx-=Math.cos(a)*tailLens[i];ty+=Math.sin(a)*tailLens[i];tailPts.push([tx,ty]);}
    const widths=[4,10,14,15,12,7],upper=[],lower=[];
    for(let i=0;i<tailPts.length;i++){const p=tailPts[i],before=tailPts[Math.max(0,i-1)],after=tailPts[Math.min(tailPts.length-1,i+1)],dx=after[0]-before[0],dy=after[1]-before[1],len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;upper.push([p[0]+nx*widths[i],p[1]+ny*widths[i]]);lower.push([p[0]-nx*widths[i],p[1]-ny*widths[i]]);}
    ctx.fillStyle="#a84727";ctx.beginPath();upper.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));for(let i=lower.length-1;i>=0;i--)ctx.lineTo(...lower[i]);ctx.closePath();ctx.fill();
    ctx.strokeStyle="rgba(255,218,178,.48)";ctx.lineWidth=2;ctx.beginPath();tailPts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]-2):ctx.moveTo(p[0],p[1]-2));ctx.stroke();
    const tip=tailPts.at(-1);ctx.fillStyle="#f0dfc5";ctx.beginPath();ctx.ellipse(tip[0]+3,tip[1],5,4,foxLabTailAngles.at(-1),0,Math.PI*2);ctx.fill();

    // Muscled, three-part limbs: shoulder/hip, elbow/knee, wrist/hock, then a small planted paw.
    const gait=(walkOffset,runOffset)=>walkBeat+walkOffset+Math.atan2(Math.sin(runBeat+runOffset-walkBeat-walkOffset),Math.cos(runBeat+runOffset-walkBeat-walkOffset))*run;
    const limb=(hip,off,front,far)=>{
      const p=((off%(Math.PI*2))+Math.PI*2)%(Math.PI*2),stance=p<Math.PI*1.2;
      const t=stance?p/(Math.PI*1.2):(p-Math.PI*1.2)/(.8*Math.PI);
      const travel=stance?.6-1.2*t:-.6+1.2*t,lift=stance?0:Math.sin(t*Math.PI);
      let pawX=hip+travel*stride*move*.84,pawY=footLine-lift*(5+run*13)*move;
      let jointX,midX,jointY,midY;
      const tuck=airborne?Math.max(launch,.25):impact*.68;
      if(airborne){
        const descending=Math.max(0,Math.min(1,(player.vy+40)/360));
        pawX=hip+(front?13:-12)+(front?descending*8:-descending*6);pawY=footLine-(1-descending)*14;
        jointX=hip+(front?8:12);jointY=17-tuck*5;midX=pawX+(front?-5:-9);midY=footLine-8-tuck*4;
      }else if(front){
        jointX=hip+(pawX-hip)*.28-5;jointY=17+lift*5+impact*4;
        midX=pawX-5;midY=footLine-8-lift*3;
      }else{
        jointX=hip+(pawX-hip)*.36+11;jointY=16+lift*5+impact*4;
        midX=pawX-11;midY=footLine-8-lift*3;
      }
      if(impact&&!airborne)pawY=footLine-impact*2;
      const color=far?"#87402c":"#a34b2c",alpha=far?.54:1;
      const bone=(ax,ay,bx,by,wide,thin)=>{const dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;ctx.beginPath();ctx.moveTo(ax+nx*wide,ay+ny*wide);ctx.quadraticCurveTo((ax+bx)/2+nx*(wide+thin)*.24,(ay+by)/2+ny*(wide+thin)*.24,bx+nx*thin,by+ny*thin);ctx.lineTo(bx-nx*thin,by-ny*thin);ctx.quadraticCurveTo((ax+bx)/2-nx*(wide+thin)*.24,(ay+by)/2-ny*(wide+thin)*.24,ax-nx*wide,ay-ny*wide);ctx.closePath();ctx.fill();};
      ctx.globalAlpha=alpha;ctx.fillStyle=color;bone(hip,0,jointX,jointY,far?3.8:5.6,far?3:4.2);bone(jointX,jointY,midX,midY,far?3:4.1,far?2.25:3.1);bone(midX,midY,pawX,pawY-2,far?2.25:3.1,far?1.5:2.1);
      ctx.fillStyle=far?"#6f3628":"#833d29";ctx.beginPath();ctx.arc(jointX,jointY,far?1.8:2.35,0,Math.PI*2);ctx.arc(midX,midY,far?1.25:1.7,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle="#302622";ctx.lineWidth=far?2.25:2.7;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(pawX-2,pawY-1);ctx.quadraticCurveTo(pawX+2.5,pawY+1,pawX+6.5,pawY);ctx.stroke();ctx.globalAlpha=1;
    };
    limb(-31,gait(Math.PI,Math.PI+.12),false,true);limb(24,gait(Math.PI/2,.1),true,true);

    const flex=Math.sin(runBeat-.5)*run*3.1-compress*1.2+launch*2-impact*2;
    // Lean torso, raised chest and tucked abdomen.
    const spineExtend=1+run*.025+Math.sin(runBeat)*run*.025+launch*.02-impact*.02;
    ctx.save();ctx.translate(1,0);ctx.scale(spineExtend,1);ctx.translate(-1,0);
    ctx.fillStyle="#bb552d";ctx.beginPath();ctx.moveTo(-49,-4);ctx.quadraticCurveTo(-44,-17,-24,-18-flex*.22);ctx.quadraticCurveTo(-4,-21-flex*.2,15,-17);ctx.quadraticCurveTo(37,-14,43,-2);ctx.quadraticCurveTo(33,9,13,12+flex*.16);ctx.lineTo(-18,10+flex*.2);ctx.quadraticCurveTo(-43,10,-49,-4);ctx.closePath();ctx.fill();
    ctx.fillStyle="#d16a36";ctx.beginPath();ctx.ellipse(-28,-7,18,9,-.04,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#f0dfc5";ctx.beginPath();ctx.moveTo(12,-14);ctx.quadraticCurveTo(33,-13,39,-2);ctx.quadraticCurveTo(29,9,14,11);ctx.quadraticCurveTo(8,2,12,-14);ctx.fill();
    ctx.restore();
    limb(-32,gait(0,Math.PI),false,false);limb(23,gait(Math.PI*1.5,0),true,false);

    // Stable narrow head on a long neck; sniffing lowers the nose and folds ears back.
    ctx.save();ctx.translate(31,-15);ctx.rotate(-pitch*.82+investigate*.18+Math.max(0,player.vy)*.000045);ctx.translate(-31,15);
    ctx.fillStyle="#c76131";ctx.beginPath();ctx.moveTo(19,-14);ctx.quadraticCurveTo(28,-28,40,-27);ctx.lineTo(51,-16);ctx.lineTo(48,-8);ctx.lineTo(32,-3);ctx.quadraticCurveTo(21,-4,19,-14);ctx.fill();
    const idleTwitch=foxLabIdleTime>2.5&&Math.sin(foxLabIdleTime*2.1)>.975?1:0,earBack=investigate*.43+run*.045+idleTwitch*.07;
    const ear=(x,len,angle)=>{ctx.save();ctx.translate(x,-24);ctx.rotate(angle);ctx.fillStyle="#b84d2a";ctx.beginPath();ctx.moveTo(-6,3);ctx.quadraticCurveTo(-8,-len*.58,-1,-len);ctx.quadraticCurveTo(7,-len*.68,8,3);ctx.closePath();ctx.fill();ctx.fillStyle="#61352b";ctx.beginPath();ctx.moveTo(-2,0);ctx.lineTo(-1,-len*.72);ctx.lineTo(4,1);ctx.closePath();ctx.fill();ctx.restore();};
    ear(27,24,.11-earBack);ear(42,25,-.13-earBack*.82);
    const noseDrop=investigate*6;
    ctx.fillStyle="#c76131";ctx.beginPath();ctx.moveTo(38,-17);ctx.quadraticCurveTo(51,-14,65,-7+noseDrop);ctx.lineTo(77,-2+noseDrop);ctx.lineTo(69,2+noseDrop);ctx.lineTo(49,1+noseDrop);ctx.quadraticCurveTo(39,-3,38,-17);ctx.fill();
    ctx.fillStyle="#f0dfc5";ctx.beginPath();ctx.moveTo(47,-4);ctx.quadraticCurveTo(61,-5,74,-1+noseDrop);ctx.lineTo(68,2+noseDrop);ctx.lineTo(49,1+noseDrop);ctx.closePath();ctx.fill();
    ctx.fillStyle="#251a17";ctx.beginPath();ctx.ellipse(48,-18,2.1,2.4,0,0,Math.PI*2);ctx.arc(77,-2+noseDrop,2.5,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#e3ad47";ctx.beginPath();ctx.ellipse(48,-18,1,1.5,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="#5a3024";ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(61,2+noseDrop);ctx.quadraticCurveTo(66,5+noseDrop,71,2+noseDrop);ctx.stroke();ctx.restore();
    ctx.restore();
  }

function drawFoxLabArena(){
    ctx.fillStyle="#202a30";ctx.fillRect(0,0,W,H);
    for(const s of foxLabSurfaces){ctx.fillStyle=s.ground?"#39443d":"#4a514b";ctx.fillRect(s.x,s.y,s.w,s.ground?s.h:14);ctx.fillStyle="#82906d";ctx.fillRect(s.x,s.y,s.w,2);}
    ctx.fillStyle="rgba(233,237,228,.66)";ctx.font="700 12px system-ui";ctx.textAlign="left";ctx.fillText("TOXICFOX · WALK  /  RUN  /  TURN  /  JUMP  /  LAND",22,30);
  }

  function frame(now) {
    const dt = frame.last ? Math.min((now - frame.last) / 1000, .032) : 0;
    frame.last = now;
    const left = keys.ArrowLeft || keys.KeyA;
    const right = keys.ArrowRight || keys.KeyD;
    const up = keys.ArrowUp || keys.KeyW || keys.Space;
    updateFox(dt, now, left, right, up, keys.KeyI);
    const velocity = Math.abs(player.vx);
    const motion = !player.grounded ? (player.vy < 0 ? "AIRBORNE · ASCENDING" : "AIRBORNE · DESCENDING")
      : foxLabInvestigation > .55 ? "INVESTIGATING" : velocity > 175 ? "RUNNING" : velocity > 8 ? "WALKING" : "IDLE";
    status.textContent = `${motion} · ${player.grounded ? "GROUNDED" : "AIRBORNE"}`;
    speedReadout.textContent = `${Math.round(velocity)} px/s`;
    drawFoxLabArena();
    drawFox(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
