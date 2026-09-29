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
  const foxLabTailAngles = Array(8).fill(0), foxLabTailVelocities = Array(8).fill(0);
  let foxLabLandingImpact = 0, foxLabTakeoffUntil = 0;
  let foxLabTurnTo = 1, foxLabTurnFrom = 1, foxLabTurnProgress = 1, foxLabTurnDuration = .21;
  let foxLabInvestigation = 0, foxLabIdleTime = 0, foxLabJumpHoldBlend = 0;
  let foxLabStrideLength = 22, foxLabTrotBlend = 0, foxLabRunBlend = 0;
  let foxLabBodyAcceleration = 0, foxLabJumpPending = 0, foxLabJumpAnticipation = 0, foxLabLandingRecovery = 0;
  let foxLabTailLaunch = 0, foxLabVerticalAcceleration = 0;
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
    const input=(left?-1:0)+(right?1:0),oldVx=player.vx,oldVy=player.vy;
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
        foxLabJumpAnticipation=0;foxLabTailLaunch=1;
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
        foxLabTailVelocities[1]+=Math.min(.34,fallSpeed*.00042);
        foxLabTailVelocities[2]+=Math.min(.16,fallSpeed*.0002);
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
    const verticalAcceleration=player.grounded?0:(player.vy-oldVy)/Math.max(dt,.001);
    foxLabVerticalAcceleration+=(verticalAcceleration-foxLabVerticalAcceleration)*(1-Math.exp(-13*dt));
    foxLabTailLaunch*=Math.exp(-2.7*dt);

    const turnSway=Math.sin(foxLabTurnProgress*Math.PI)*(foxLabTurnTo-foxLabTurnFrom);
    const gaitTail=Math.sin(foxLabStridePhase*2-.8)*(.018+foxLabTrotBlend*.025+foxLabRunBlend*.035);
    const speedTrail=smooth(55,285,currentSpeed)*.055;
    const tailTarget=clamp(.07+speedTrail+foxLabBodyAcceleration*.00024-player.vy*.0004-foxLabVerticalAcceleration*.000009+foxLabTailLaunch*.31+turnSway*.16+gaitTail+foxLabInvestigation*.16-foxLabLandingRecovery*.1,-.68,.78);
    for(let i=0;i<foxLabTailAngles.length;i++){
      const prior=i?foxLabTailAngles[i-1]:tailTarget;
      const target=i?tailTarget+(prior-tailTarget)*.43:tailTarget;
      const stiffness=29-i*2.15,damping=5.8-i*.36;
      foxLabTailVelocities[i]+=(target-foxLabTailAngles[i])*stiffness*dt;
      foxLabTailVelocities[i]*=Math.exp(-damping*dt);
      foxLabTailAngles[i]=clamp(foxLabTailAngles[i]+foxLabTailVelocities[i]*dt,-.82,.9);
    }
  }

function drawFox(now){
    const speed=Math.abs(player.vx),move=smooth(4,58,speed),trot=foxLabTrotBlend,run=foxLabRunBlend;
    const airborne=!player.grounded,phase=foxLabStridePhase,impact=foxLabLandingImpact,investigate=foxLabInvestigation;
    const launch=airborne?smooth(0,145,now-(foxLabTakeoffUntil-145)):0;
    const stride=foxLabStrideLength,walkBeat=phase,runBeat=phase*(1.08+run*.12);
    const bodyWave=Math.sin(phase*.5-.4),stepWave=Math.sin(phase*2-.35);
    const compress=Math.max(0,Math.sin(phase*2+.45))*run*.78;
    const spineFlex=Math.sin(phase*2-.45)*(.009+trot*.018+run*.063)-compress*.014;
    const bounce=player.grounded?(Math.sin(phase*2)*move*.42+Math.max(0,stepWave)*run*1.05):0;
    const shoulderMotion=Math.sin(phase*2+Math.PI*.5)*(move*.48+run*1.15);
    const hipMotion=Math.sin(phase*2-Math.PI*.25)*(move*.42+run*1.45);
    const accelerationLean=clamp(foxLabBodyAcceleration/1100,-1,1);
    const braking=clamp(-foxLabBodyAcceleration/1000,0,1);
    const anticipation=foxLabJumpAnticipation,recovery=foxLabLandingRecovery;
    const verticalMotion=stepWave*(trot*.38+run*.72)-recovery*2.1;
    const pitch=airborne?clamp(player.vy*.00017,-.16,.16):(-.034*run+bodyWave*.012*trot+accelerationLean*.04-braking*.016-impact*.055+investigate*.018);
    const breathe=player.grounded&&speed<9?Math.sin(now*.0021)*.7:0;
    const rise=8+compress*1.35+launch*1.45-investigate*1.5+breathe;
    const footLine=player.h/2-2+rise-bounce-impact*5-verticalMotion-anticipation*3+recovery*2.6;
    const facingBlend=smooth(0,1,foxLabTurnProgress);
    const fwd=mix(foxLabTurnFrom,foxLabTurnTo,facingBlend),turnWave=Math.sin(foxLabTurnProgress*Math.PI)*(foxLabTurnTo-foxLabTurnFrom);
    const turnCompress=Math.sin(foxLabTurnProgress*Math.PI)*.12;
    const turnLean=turnWave*.075;
    ctx.save();ctx.translate(player.x+player.w/2,player.y+player.h/2+bounce+impact*5+verticalMotion+anticipation*3-recovery*2.6-rise);
    ctx.scale(fwd*(1-turnCompress),1-impact*.04+launch*.018-anticipation*.075+recovery*.014);ctx.rotate(pitch+turnLean);

    // A weighted brush tail whose bend travels from pelvis to tip.
    const tailPts=[[-39,0]],tailLens=[13,15,16,16,16,16,15,13];let tx=-39,ty=0;
    for(let i=0;i<tailLens.length;i++){const a=foxLabTailAngles[i];tx-=Math.cos(a)*tailLens[i];ty+=Math.sin(a)*tailLens[i];tailPts.push([tx,ty]);}
    const widths=[4,9,14,16,17,16,13,8,3.2],upper=[],lower=[];
    for(let i=0;i<tailPts.length;i++){const p=tailPts[i],before=tailPts[Math.max(0,i-1)],after=tailPts[Math.min(tailPts.length-1,i+1)],dx=after[0]-before[0],dy=after[1]-before[1],len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;upper.push([p[0]+nx*widths[i],p[1]+ny*widths[i]]);lower.push([p[0]-nx*widths[i],p[1]-ny*widths[i]]);}
    const traceSmooth=(points,reverse=false,move=true)=>{const ordered=reverse?points.slice().reverse():points;if(move)ctx.moveTo(...ordered[0]);else ctx.lineTo(...ordered[0]);for(let i=0;i<ordered.length-1;i++){const a=ordered[i],b=ordered[i+1];ctx.quadraticCurveTo(...a,(a[0]+b[0])/2,(a[1]+b[1])/2);}ctx.lineTo(...ordered.at(-1));};
    ctx.fillStyle="#a84727";ctx.beginPath();traceSmooth(upper);traceSmooth(lower,true,false);ctx.closePath();ctx.fill();
    ctx.strokeStyle="rgba(255,218,178,.48)";ctx.lineWidth=2;ctx.beginPath();traceSmooth(tailPts.map(p=>[p[0],p[1]-2]));ctx.stroke();
    const tip=tailPts.at(-1),base=tailPts.at(-2),tailDx=tip[0]-base[0],tailDy=tip[1]-base[1],tailSize=Math.hypot(tailDx,tailDy)||1,tailNx=-tailDy/tailSize,tailNy=tailDx/tailSize;
    ctx.fillStyle="#f0dfc5";ctx.beginPath();ctx.moveTo(tip[0]+tailNx*2.5,tip[1]+tailNy*2.5);ctx.quadraticCurveTo(tip[0]+tailDx/tailSize*4,tip[1]+tailDy/tailSize*4,tip[0]+tailDx/tailSize*12,tip[1]+tailDy/tailSize*12);ctx.quadraticCurveTo(tip[0]+tailDx/tailSize*4,tip[1]+tailDy/tailSize*4,tip[0]-tailNx*2.5,tip[1]-tailNy*2.5);ctx.closePath();ctx.fill();

    // Muscled, three-part limbs: shoulder/hip, elbow/knee, wrist/hock, then a small planted paw.
    const gait=(walkOffset,trotOffset)=>{
      const walkPhase=walkBeat+walkOffset,runPhase=runBeat+trotOffset;
      return walkPhase+Math.atan2(Math.sin(runPhase-walkPhase),Math.cos(runPhase-walkPhase))*trot;
    };
    const limb=(hip,off,front,far,rootY)=>{
      const p=((off%(Math.PI*2))+Math.PI*2)%(Math.PI*2),stance=p<Math.PI*1.17;
      const t=stance?p/(Math.PI*1.17):(p-Math.PI*1.17)/(.83*Math.PI);
      const travel=stance?.585-1.17*t:-.585+1.17*t,lift=stance?0:Math.sin(t*Math.PI);
      const pushOff=!front&&stance?smooth(.42,.99,t)*(trot*.45+run*.85):0;
      let pawX=hip+travel*stride*move,pawY=footLine-lift*(5+run*10)*move;
      let jointX,midX,jointY,midY;
      const tuck=airborne?Math.max(launch,.18):impact*.68+anticipation*.55;
      if(airborne){
        const descending=smooth(-80,430,player.vy);
        pawX=hip+(front?13:-12)+(front?descending*(11+run*4):-descending*(8+run*7));
        pawY=footLine-(1-descending)*(front?13+launch*3:10+launch*2)+(front?0:-descending*3);
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
      bone(hip,rootY,jointX,jointY,front?(far?2.7:3.5):(far?3.4:4.5),front?(far?2.1:2.7):(far?2.6:3.3));
      bone(jointX,jointY,midX,midY,far?2.4:3.15,far?1.7:2.25);
      bone(midX,midY,pawX,pawY-2,far?1.8:2.35,far?1.2:1.65);
      ctx.fillStyle=far?"#6f3628":"#833d29";ctx.beginPath();ctx.arc(jointX,jointY,far?1.45:1.9,0,Math.PI*2);ctx.arc(midX,midY,far?1:1.35,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle="#302622";ctx.lineWidth=far?1.75:(front?2:2.2);ctx.lineCap="round";ctx.beginPath();ctx.moveTo(pawX-2,pawY-1);ctx.quadraticCurveTo(pawX+1.8,pawY+.8,pawX+5.5,pawY);ctx.stroke();ctx.globalAlpha=1;
    };
    // Four-beat walk: each paw lands in sequence. The faster gait blends toward diagonal-pair trot timing.
    limb(-31,gait(Math.PI*1.5,0),false,true,hipMotion);
    limb(24,gait(Math.PI*.5,Math.PI),true,true,shoulderMotion);

    const hindDrive=Math.max(0,Math.sin(runBeat+.55));
    const flex=Math.sin(runBeat-.5)*run*4.2+spineFlex*78-compress*1.8+launch*2-impact*2.4+anticipation*1.6;
    // A long, narrow trunk with a tucked waist and lean, continuous spine line.
    const spineExtend=1+spineFlex+run*.038+Math.sin(runBeat)*run*.052+launch*.045-impact*.032+accelerationLean*.016;
    const torsoLift=hindDrive*run*1.4-anticipation*1.7+recovery*1.1;
    ctx.save();ctx.translate(1,0);ctx.scale(spineExtend,1);ctx.translate(-1,0);
    ctx.fillStyle="#bb552d";ctx.beginPath();ctx.moveTo(-49,-3+torsoLift);ctx.quadraticCurveTo(-43,-14-torsoLift*.28,-27,-15-flex*.18+torsoLift*.35);ctx.quadraticCurveTo(-10,-17-flex*.16+torsoLift*.4,7,-14-torsoLift*.35);ctx.quadraticCurveTo(25,-16,39,-7);ctx.quadraticCurveTo(42,-3,39,1);ctx.quadraticCurveTo(34,7,26,7+flex*.1);ctx.quadraticCurveTo(16,7+flex*.12,8,4-torsoLift*.45);ctx.quadraticCurveTo(-10,7+flex*.16,-23,8+flex*.12);ctx.quadraticCurveTo(-42,8,-49,-3+torsoLift);ctx.closePath();ctx.fill();
    ctx.fillStyle="#d16a36";ctx.beginPath();ctx.ellipse(-29,-6,13,6,-.06,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#f0dfc5";ctx.beginPath();ctx.moveTo(22,-12);ctx.quadraticCurveTo(34,-10,39,-4);ctx.quadraticCurveTo(36,2,29,5);ctx.quadraticCurveTo(23,3,20,-3);ctx.closePath();ctx.fill();
    ctx.restore();
    limb(-32,gait(0,Math.PI),false,false,hipMotion);
    limb(23,gait(Math.PI,0),true,false,shoulderMotion);

    // Slim neck and small alert head keep the fox's line long and deliberate.
    ctx.fillStyle="#c76131";ctx.beginPath();ctx.moveTo(13,-13);ctx.quadraticCurveTo(22,-21,29,-24);ctx.quadraticCurveTo(37,-23,43,-17);ctx.lineTo(38,-8);ctx.quadraticCurveTo(27,-6,17,-5);ctx.closePath();ctx.fill();
    ctx.save();ctx.translate(34+turnWave*2,-16+shoulderMotion*.35);ctx.rotate(-pitch*.78+investigate*.18+Math.max(0,player.vy)*.000045-spineFlex*.35+turnWave*.12);ctx.translate(-34,16);
    ctx.fillStyle="#c76131";ctx.beginPath();ctx.moveTo(23,-15);ctx.quadraticCurveTo(29,-26,38,-26);ctx.quadraticCurveTo(47,-25,50,-18);ctx.quadraticCurveTo(45,-11,37,-9);ctx.quadraticCurveTo(28,-10,23,-15);ctx.fill();
    const idleTwitch=foxLabIdleTime>2.5&&Math.sin(foxLabIdleTime*2.1)>.975?1:0,earBack=investigate*.43+run*.045+idleTwitch*.07;
    const ear=(x,len,angle)=>{ctx.save();ctx.translate(x,-24);ctx.rotate(angle);ctx.fillStyle="#b84d2a";ctx.beginPath();ctx.moveTo(-6,3);ctx.quadraticCurveTo(-8,-len*.58,-1,-len);ctx.quadraticCurveTo(7,-len*.68,8,3);ctx.closePath();ctx.fill();ctx.fillStyle="#61352b";ctx.beginPath();ctx.moveTo(-2,0);ctx.lineTo(-1,-len*.72);ctx.lineTo(4,1);ctx.closePath();ctx.fill();ctx.restore();};
    ear(29,25,.08-earBack);ear(42,26,-.11-earBack*.82);
    const noseDrop=investigate*5;
    ctx.fillStyle="#c76131";ctx.beginPath();ctx.moveTo(40,-18);ctx.quadraticCurveTo(53,-14,67,-7+noseDrop);ctx.lineTo(78,-2+noseDrop);ctx.quadraticCurveTo(71,2+noseDrop,64,1+noseDrop);ctx.lineTo(48,0+noseDrop);ctx.quadraticCurveTo(41,-5,40,-18);ctx.fill();
    ctx.fillStyle="#f0dfc5";ctx.beginPath();ctx.moveTo(49,-4);ctx.quadraticCurveTo(62,-4,75,-1+noseDrop);ctx.quadraticCurveTo(69,2+noseDrop,63,1+noseDrop);ctx.lineTo(50,1+noseDrop);ctx.closePath();ctx.fill();
    ctx.fillStyle="#251a17";ctx.beginPath();ctx.ellipse(45,-19,1.8,2.1,0,0,Math.PI*2);ctx.arc(78,-2+noseDrop,2.2,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#e3ad47";ctx.beginPath();ctx.ellipse(45,-19,.9,1.3,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="#5a3024";ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(63,2+noseDrop);ctx.quadraticCurveTo(67,4+noseDrop,71,1+noseDrop);ctx.stroke();ctx.restore();
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
