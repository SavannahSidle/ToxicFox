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
  let foxLabTurnTo = 1, foxLabTurnFrom = 1, foxLabTurnProgress = 1, foxLabTurnDuration = .21;
  let foxLabInvestigation = 0, foxLabIdleTime = 0, foxLabJumpHoldBlend = 0;
  let foxLabStrideLength = 22, foxLabTrotBlend = 0, foxLabRunBlend = 0;
  let foxLabBodyAcceleration = 0, foxLabJumpPending = 0, foxLabJumpAnticipation = 0, foxLabLandingRecovery = 0;
  const foxLabSurfaces = [
    {x:0,y:480,w:960,h:60,ground:true},
    {x:190,y:452,w:112,h:14}, {x:302,y:432,w:112,h:14},
    {x:414,y:412,w:112,h:14}, {x:605,y:386,w:148,h:14},
    {x:753,y:430,w:128,h:14}, {x:455,y:328,w:118,h:14}
  ];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };

  addEventListener("keydown", event => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "Space"].includes(event.code)) event.preventDefault();
    if (keys[event.code]) return;
    keys[event.code] = true;
    if (["Space", "ArrowUp", "KeyW"].includes(event.code) && player.grounded && foxLabJumpPending <= 0) {
      foxLabJumpPending = .075;
      foxLabJumpAnticipation = 0;
    }
  });
  addEventListener("keyup", event => { keys[event.code] = false; });

  function updateFox(dt, now, left, right, up, investigate) {
    const input=(left?-1:0)+(right?1:0),oldVx=player.vx;
    const speed=Math.abs(player.vx),reversing=input&&speed>8&&Math.sign(player.vx)!==input;
    if(input&&input!==foxLabTurnTo){foxLabTurnFrom=foxLabTurnTo;foxLabTurnTo=input;foxLabTurnProgress=0;foxLabTurnDuration=.21+Math.min(speed,285)*.00032;}
    if(foxLabTurnProgress<1)foxLabTurnProgress=Math.min(1,foxLabTurnProgress+dt/foxLabTurnDuration);
    if(foxLabTurnProgress>=.52&&(Math.abs(player.vx)<34||Math.sign(player.vx)===foxLabTurnTo))player.facing=foxLabTurnTo;

    if(input){
      const accel=player.grounded?(reversing?1040:690):(reversing?410:280);
      player.vx+=input*accel*dt;
    }else player.vx*=Math.exp(-(player.grounded?5.4:1.65)*dt);
    player.vx=clamp(player.vx,-285,285);
    if(Math.abs(player.vx)<1.6&&!input)player.vx=0;

    if(foxLabJumpPending>0){
      foxLabJumpPending=Math.max(0,foxLabJumpPending-dt);
      foxLabJumpAnticipation=clamp(1-foxLabJumpPending/.075,0,1);
      if(foxLabJumpPending===0&&player.grounded){
        player.vy=-545;player.grounded=false;foxLabTakeoffUntil=now+145;
        foxLabJumpAnticipation=0;
      }
    }else foxLabJumpAnticipation*=Math.exp(-9*dt);

    const oldBottom=player.y+player.h,fallSpeed=player.vy;
    const jumpHeld=up&&player.vy<0?1:0;
    foxLabJumpHoldBlend+=(jumpHeld-foxLabJumpHoldBlend)*(1-Math.exp(-14*dt));
    player.vy=Math.min(920,player.vy+(1650-foxLabJumpHoldBlend*500)*dt);
    player.x=clamp(player.x+player.vx*dt,90,W-player.w-36);
    player.y+=player.vy*dt;player.grounded=false;
    let landing=null;
    if(player.vy>=0){
      for(const surface of foxLabSurfaces){
        if(oldBottom<=surface.y+1&&player.y+player.h>=surface.y&&player.x+player.w>surface.x&&player.x<surface.x+surface.w&&(!landing||surface.y<landing.y))landing=surface;
      }
    }
    if(landing){
      player.y=landing.y-player.h;player.vy=0;player.grounded=true;foxLabJumpHoldBlend=0;
      if(fallSpeed>35){
        foxLabLandingImpact=Math.min(1,fallSpeed/700);
        foxLabTailVelocities[0]+=Math.min(.8,fallSpeed*.0011);
        foxLabLandingRecovery=1;
      }
    }
    if(player.y<34){player.y=34;player.vy=Math.max(0,player.vy);}

    const currentSpeed=Math.abs(player.vx);
    const nextTrot=smooth(65,165,currentSpeed),nextRun=smooth(155,285,currentSpeed);
    foxLabTrotBlend+=(nextTrot-foxLabTrotBlend)*(1-Math.exp(-5.5*dt));
    foxLabRunBlend+=(nextRun-foxLabRunBlend)*(1-Math.exp(-4.2*dt));
    const walkStride=22+currentSpeed*.17;
    const fasterStride=mix(34+currentSpeed*.18,52+currentSpeed*.15,foxLabRunBlend);
    foxLabStrideLength=mix(walkStride,fasterStride,foxLabTrotBlend);
    if(player.grounded&&currentSpeed>1.4)foxLabStridePhase+=currentSpeed*dt*Math.PI/foxLabStrideLength*(1+foxLabRunBlend*.07);

    foxLabIdleTime=player.grounded&&currentSpeed<9&&!input?foxLabIdleTime+dt:0;
    const investigateTarget=investigate&&player.grounded&&!input&&currentSpeed<18?1:0;
    foxLabInvestigation+=(investigateTarget-foxLabInvestigation)*(1-Math.exp(-5.5*dt));
    foxLabLandingImpact*=Math.exp(-8.5*dt);
    foxLabLandingRecovery*=Math.exp(-4.1*dt);
    const acceleration=((player.vx-oldVx)/Math.max(dt,.001))*player.facing;
    foxLabBodyAcceleration+=(acceleration-foxLabBodyAcceleration)*(1-Math.exp(-8*dt));

    const tailTarget=clamp(.13+acceleration*.00048-player.vy*.0005+foxLabInvestigation*.2+(currentSpeed<12?.07:0),-.72,.78);
    for(let i=0;i<foxLabTailAngles.length;i++){
      const prior=i?foxLabTailAngles[i-1]:tailTarget;
      const bend=i>1?(foxLabTailAngles[i-1]-foxLabTailAngles[i-2])*.36:0;
      const target=i?prior+bend+.025*i:tailTarget;
      foxLabTailVelocities[i]+=(target-foxLabTailAngles[i])*(i?23-i*1.15:32)*dt;
      foxLabTailVelocities[i]*=Math.exp(-(i?4.9:6.8)*dt);
      foxLabTailAngles[i]=clamp(foxLabTailAngles[i]+foxLabTailVelocities[i]*dt,-.9,.96);
    }
  }

function drawFox(now){
    const speed=Math.abs(player.vx),move=smooth(4,58,speed),trot=foxLabTrotBlend,run=foxLabRunBlend;
    const airborne=!player.grounded,phase=foxLabStridePhase,impact=foxLabLandingImpact,investigate=foxLabInvestigation;
    const launch=airborne?smooth(0,145,now-(foxLabTakeoffUntil-145)):0;
    const stride=foxLabStrideLength,walkBeat=phase,runBeat=phase*(1.08+run*.12);
    const bodyWave=Math.sin(phase*.5-.4),stepWave=Math.sin(phase*2-.35);
    const compress=Math.max(0,Math.sin(phase*2+.45))*run;
    const spineFlex=Math.sin(phase*2-.45)*(.012+trot*.024+run*.052)-compress*.018;
    const bounce=player.grounded?(Math.sin(phase*2)*move*.7+Math.max(0,stepWave)*run*2.6):0;
    const shoulderMotion=Math.sin(phase*2+Math.PI*.5)*(move*.75+run*1.8);
    const hipMotion=Math.sin(phase*2-Math.PI*.25)*(move*.65+run*2.3);
    const accelerationLean=clamp(foxLabBodyAcceleration/1100,-1,1);
    const braking=clamp(-foxLabBodyAcceleration/1000,0,1);
    const anticipation=foxLabJumpAnticipation,recovery=foxLabLandingRecovery;
    const verticalMotion=stepWave*(trot*.7+run*1.35)-recovery*2.6;
    const pitch=airborne?clamp(player.vy*.0002,-.19,.19):(-.026*run+bodyWave*.016*trot+accelerationLean*.045-braking*.018-impact*.065+investigate*.018);
    const breathe=player.grounded&&speed<9?Math.sin(now*.0021)*.7:0;
    const rise=8+compress*1.8+launch*1.8-investigate*1.5+breathe;
    const footLine=player.h/2-2+rise-bounce-impact*5-verticalMotion-anticipation*3+recovery*2.6;
    const facingBlend=smooth(0,1,foxLabTurnProgress);
    const fwd=mix(foxLabTurnFrom,foxLabTurnTo,facingBlend),turnWave=Math.sin(foxLabTurnProgress*Math.PI)*(foxLabTurnTo-foxLabTurnFrom);
    const turnCompress=Math.sin(foxLabTurnProgress*Math.PI)*.12;
    const turnLean=turnWave*.075;
    ctx.save();ctx.translate(player.x+player.w/2,player.y+player.h/2+bounce+impact*5+verticalMotion+anticipation*3-recovery*2.6-rise);
    ctx.scale(fwd*(1-turnCompress),1-impact*.04+launch*.018-anticipation*.075+recovery*.014);ctx.rotate(pitch+turnLean);

    // A weighted brush tail whose bend travels from pelvis to tip.
    const tailPts=[[-39,0]],tailLens=[16,19,20,19,16];let tx=-39,ty=0;
    for(let i=0;i<tailLens.length;i++){const a=foxLabTailAngles[i];tx-=Math.cos(a)*tailLens[i];ty+=Math.sin(a)*tailLens[i];tailPts.push([tx,ty]);}
    const widths=[4,10,14,15,12,7],upper=[],lower=[];
    for(let i=0;i<tailPts.length;i++){const p=tailPts[i],before=tailPts[Math.max(0,i-1)],after=tailPts[Math.min(tailPts.length-1,i+1)],dx=after[0]-before[0],dy=after[1]-before[1],len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;upper.push([p[0]+nx*widths[i],p[1]+ny*widths[i]]);lower.push([p[0]-nx*widths[i],p[1]-ny*widths[i]]);}
    ctx.fillStyle="#a84727";ctx.beginPath();upper.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));for(let i=lower.length-1;i>=0;i--)ctx.lineTo(...lower[i]);ctx.closePath();ctx.fill();
    ctx.strokeStyle="rgba(255,218,178,.48)";ctx.lineWidth=2;ctx.beginPath();tailPts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]-2):ctx.moveTo(p[0],p[1]-2));ctx.stroke();
    const tip=tailPts.at(-1);ctx.fillStyle="#f0dfc5";ctx.beginPath();ctx.ellipse(tip[0]+3,tip[1],5,4,foxLabTailAngles.at(-1),0,Math.PI*2);ctx.fill();

    // Muscled, three-part limbs: shoulder/hip, elbow/knee, wrist/hock, then a small planted paw.
    const gait=(walkOffset,trotOffset)=>{
      const walkPhase=walkBeat+walkOffset,runPhase=runBeat+trotOffset;
      return walkPhase+Math.atan2(Math.sin(runPhase-walkPhase),Math.cos(runPhase-walkPhase))*trot;
    };
    const limb=(hip,off,front,far,rootY)=>{
      const p=((off%(Math.PI*2))+Math.PI*2)%(Math.PI*2),stance=p<Math.PI*1.17;
      const t=stance?p/(Math.PI*1.17):(p-Math.PI*1.17)/(.83*Math.PI);
      const travel=stance?.6-1.2*t:-.6+1.2*t,lift=stance?0:Math.sin(t*Math.PI);
      const pushOff=!front&&stance?smooth(.28,.98,t)*(trot*.5+run*.9):0;
      let pawX=hip+travel*stride*move,pawY=footLine-lift*(6+run*13)*move;
      let jointX,midX,jointY,midY;
      const tuck=airborne?Math.max(launch,.18):impact*.68+anticipation*.55;
      if(airborne){
        const descending=smooth(-80,430,player.vy);
        pawX=hip+(front?13:-12)+(front?descending*(11+run*4):-descending*(8+run*7));
        pawY=footLine-(1-descending)*(12+launch*3);
        jointX=hip+(front?8:12)+(front?turnWave*2:-turnWave*1.5);
        jointY=rootY+17-tuck*6;midX=pawX+(front?-5:-9);midY=footLine-8-tuck*4;
      }else if(front){
        jointX=hip+(pawX-hip)*.28-5+turnWave*2;
        jointY=rootY+17+lift*5+impact*5+anticipation*7;
        midX=pawX-5;midY=footLine-8-lift*3+impact*3;
      }else{
        jointX=hip+(pawX-hip)*.36+11+pushOff*stride*.12-turnWave*1.5;
        jointY=rootY+16+lift*5+impact*4+anticipation*4;
        midX=pawX-11-pushOff*stride*.12;midY=footLine-8-lift*3+impact*2;
      }
      if(impact&&!airborne)pawY=footLine-impact*2;
      const color=far?"#87402c":"#a34b2c",alpha=far?.54:1;
      const bone=(ax,ay,bx,by,wide,thin)=>{const dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;ctx.beginPath();ctx.moveTo(ax+nx*wide,ay+ny*wide);ctx.quadraticCurveTo((ax+bx)/2+nx*(wide+thin)*.24,(ay+by)/2+ny*(wide+thin)*.24,bx+nx*thin,by+ny*thin);ctx.lineTo(bx-nx*thin,by-ny*thin);ctx.quadraticCurveTo((ax+bx)/2-nx*(wide+thin)*.24,(ay+by)/2-nx*(wide+thin)*.24,ax-nx*wide,ay-ny*wide);ctx.closePath();ctx.fill();};
      ctx.globalAlpha=alpha;ctx.fillStyle=color;
      bone(hip,rootY,jointX,jointY,far?3.8:5.6,far?3:4.2);
      bone(jointX,jointY,midX,midY,far?3:4.1,far?2.25:3.1);
      bone(midX,midY,pawX,pawY-2,far?2.25:3.1,far?1.5:2.1);
      ctx.fillStyle=far?"#6f3628":"#833d29";ctx.beginPath();ctx.arc(jointX,jointY,far?1.8:2.35,0,Math.PI*2);ctx.arc(midX,midY,far?1.25:1.7,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle="#302622";ctx.lineWidth=far?2.25:2.7;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(pawX-2,pawY-1);ctx.quadraticCurveTo(pawX+2.5,pawY+1,pawX+6.5,pawY);ctx.stroke();ctx.globalAlpha=1;
    };
    // Four-beat walk: each paw lands in sequence. The faster gait blends toward diagonal-pair trot timing.
    limb(-31,gait(Math.PI*1.5,0),false,true,hipMotion);
    limb(24,gait(Math.PI*.5,Math.PI),true,true,shoulderMotion);

    const hindDrive=Math.max(0,Math.sin(runBeat+.55));
    const flex=Math.sin(runBeat-.5)*run*5.2+spineFlex*85-compress*2.2+launch*3-impact*3+anticipation*2;
    // Lean torso, raised chest, loaded haunches, and a flexible spine.
    const spineExtend=1+spineFlex+run*.032+Math.sin(runBeat)*run*.045+launch*.035-impact*.035+accelerationLean*.018;
    const torsoLift=hindDrive*run*2.2-anticipation*2+recovery*1.4;
    ctx.save();ctx.translate(1,0);ctx.scale(spineExtend,1);ctx.translate(-1,0);
    ctx.fillStyle="#bb552d";ctx.beginPath();ctx.moveTo(-49,-4+torsoLift);ctx.quadraticCurveTo(-44,-17-torsoLift*.35,-24,-18-flex*.22+torsoLift*.4);ctx.quadraticCurveTo(-4,-21-flex*.2,15,-17-torsoLift*.5);ctx.quadraticCurveTo(37,-14,43,-2);ctx.quadraticCurveTo(33,9,13,12+flex*.16-torsoLift);ctx.lineTo(-18,10+flex*.2-torsoLift*.8);ctx.quadraticCurveTo(-43,10,-49,-4+torsoLift);ctx.closePath();ctx.fill();
    ctx.fillStyle="#d16a36";ctx.beginPath();ctx.ellipse(-28,-7,18,9,-.04,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#f0dfc5";ctx.beginPath();ctx.moveTo(12,-14);ctx.quadraticCurveTo(33,-13,39,-2);ctx.quadraticCurveTo(29,9,14,11);ctx.quadraticCurveTo(8,2,12,-14);ctx.fill();
    ctx.restore();
    limb(-32,gait(0,Math.PI),false,false,hipMotion);
    limb(23,gait(Math.PI,0),true,false,shoulderMotion);

    // Stable narrow head on a long neck; sniffing lowers the nose and folds ears back.
    ctx.save();ctx.translate(31+turnWave*2,-15+shoulderMotion*.45);ctx.rotate(-pitch*.78+investigate*.18+Math.max(0,player.vy)*.000045-spineFlex*.35+turnWave*.12);ctx.translate(-31,15);
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
