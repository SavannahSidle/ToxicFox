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
  const foxLabSpine = {
    ribX:0,ribXV:0,ribY:0,ribYV:0,ribAngle:0,ribAngleV:0,
    pelvisX:0,pelvisXV:0,pelvisY:0,pelvisYV:0,pelvisAngle:0,pelvisAngleV:0,
    waistY:0,waistYV:0,waistAngle:0,waistAngleV:0,neckAngle:0,neckAngleV:0,headY:0,headYV:0
  };
  const foxLabEar={angle:0,angleV:0},foxLabEarTip={angle:0,angleV:0};
  const foxLabLegStates=Array.from({length:4},()=>({ready:false,pawX:0,pawXV:0,pawY:0,pawYV:0}));
  const foxLabFootContacts=Array.from({length:4},()=>({planted:false,released:false,weight:0,x:0,y:0}));
  const foxLabLegConfigs=[
    {hip:-31,front:false,far:true,walk:Math.PI*1.5,trot:0,upper:26,lower:34,toeX:2,toeY:6.5,bend:-1},
    {hip:24,front:true,far:true,walk:Math.PI*.5,trot:Math.PI,upper:22,lower:32,toeX:2,toeY:6.7,bend:1},
    {hip:-32,front:false,far:false,walk:0,trot:Math.PI,upper:26,lower:34,toeX:2,toeY:6.5,bend:-1},
    {hip:23,front:true,far:false,walk:Math.PI,trot:0,upper:22,lower:32,toeX:2,toeY:6.7,bend:1}
  ];
  const foxLabSurfaces = [
    {x:0,y:480,w:960,h:60,ground:true},
    {x:190,y:452,w:112,h:14}, {x:302,y:432,w:112,h:14},
    {x:414,y:412,w:112,h:14}, {x:605,y:386,w:148,h:14},
    {x:753,y:430,w:128,h:14}, {x:455,y:328,w:118,h:14}
  ];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };
  const cubic = t=>t*t*(3-2*t);
  function cycleSample(phase,values){
    const count=values.length,x=((phase/(Math.PI*2)%1)+1)%1*count,index=Math.floor(x),t=x-index;
    const y0=values[index],y1=values[(index+1)%count],m0=(y1-values[(index+count-1)%count])*.5,m1=(values[(index+2)%count]-y0)*.5;
    const t2=t*t,t3=t2*t;
    return (2*t3-3*t2+1)*y0+(t3-2*t2+t)*m0+(-2*t3+3*t2)*y1+(t3-t2)*m1;
  }
  function gaitPhase(walkOffset,trotOffset){
    const walk=foxLabStridePhase+walkOffset,run=foxLabStridePhase+trotOffset;
    return walk+Math.atan2(Math.sin(run-walk),Math.cos(run-walk))*foxLabTrotBlend;
  }
  function springTo(state,valueKey,target,frequency,damping,dt){
    const velocityKey=valueKey+"V",omega=frequency;
    state[velocityKey]+=((target-state[valueKey])*omega*omega-2*damping*omega*state[velocityKey])*dt;
    state[valueKey]+=state[velocityKey]*dt;
  }
  function turnPulse(start,end){
    return smooth(start,Math.min(start+.14,end),foxLabTurnProgress)*(1-smooth(Math.max(start+.14,end-.14),end,foxLabTurnProgress));
  }
  function solveFixedLimb(rootX,rootY,pawX,pawY,config,keepGround){
    const {upper,lower,toeX,toeY,bend}=config;
    const minReach=Math.abs(upper-lower)+10;
    const extensionReserve=Math.max(2.5,Math.min(upper,lower)*.1);
    const maxReach=upper+lower-extensionReserve;
    let dx=pawX-toeX-rootX,dy=pawY-toeY-rootY;
    const rawDistance=Math.hypot(dx,dy);
    let distance=rawDistance;
    if(keepGround&&Math.abs(dy)<maxReach&&rawDistance>maxReach){
      const maxHorizontal=Math.sqrt(maxReach*maxReach-dy*dy);
      dx=clamp(dx,-maxHorizontal,maxHorizontal);
      distance=Math.hypot(dx,dy);
    }else if(rawDistance>maxReach){
      const ratio=maxReach/rawDistance;dx*=ratio;dy*=ratio;distance=maxReach;
    }
    if(distance<minReach){
      if(distance<.001){dx=0;dy=minReach;}
      else{const ratio=minReach/distance;dx*=ratio;dy*=ratio;}
      distance=minReach;
    }
    const ux=dx/distance,uy=dy/distance;
    const hockX=rootX+dx,hockY=rootY+dy;
    const along=(upper*upper-lower*lower+distance*distance)/(2*distance);
    const height=Math.sqrt(Math.max(0,upper*upper-along*along));
    const kneeX=rootX+ux*along-uy*height*bend,kneeY=rootY+uy*along+ux*height*bend;
    return {kneeX,kneeY,hockX,hockY,pawX:hockX+toeX,pawY:hockY+toeY,upper,lower,toeX,toeY,minReach,maxReach,distance};
  }

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
        foxLabTailVelocities[0]+=Math.min(1.15,fallSpeed*.0021);
        foxLabTailVelocities[1]+=Math.min(.72,fallSpeed*.0013);
        foxLabTailVelocities[2]+=Math.min(.42,fallSpeed*.00075);
        foxLabTailVelocities[3]+=Math.min(.2,fallSpeed*.00035);
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

    const phase=foxLabStridePhase,run=foxLabRunBlend,trot=foxLabTrotBlend,moveBlend=smooth(5,180,currentSpeed);
    const hindDrive=cycleSample(phase-.13,[.02,.46,.92,.42,-.36,-.82,-.28,.58]);
    const foreLoad=cycleSample(phase+.27,[.06,.48,.84,.22,-.52,-.76,-.08,.55]);
    const lumbarWave=cycleSample(phase-.51,[.04,.22,.72,.84,.12,-.69,-.78,-.02]);
    const turnDelta=foxLabTurnTo-foxLabTurnFrom;
    const turnHead=turnPulse(.02,.73)*turnDelta,turnShoulder=turnPulse(.17,.88)*turnDelta,turnPelvis=turnPulse(.34,1)*turnDelta;
    const jumpStretch=!player.grounded?clamp(-player.vy/545,0,1):0;
    const jumpDescend=!player.grounded?smooth(35,470,player.vy):0;
    const jumpAge=!player.grounded?Math.max(0,now-(foxLabTakeoffUntil-145)):0;
    const jumpDrive=!player.grounded?smooth(0,65,jumpAge)*(1-smooth(175,315,jumpAge)):0;
    const jumpApex=!player.grounded?clamp(1-Math.abs(player.vy)/125,0,1):0;
    const support=(cfg)=>{const p=((gaitPhase(cfg.walk,cfg.trot)%(Math.PI*2))+Math.PI*2)%(Math.PI*2),u=p/(Math.PI*2);return smooth(0,.035,u)*(1-smooth(.565,.61,u));};
    const hindSupport=(support(foxLabLegConfigs[0])+support(foxLabLegConfigs[2]))*.5;
    const foreSupport=(support(foxLabLegConfigs[1])+support(foxLabLegConfigs[3]))*.5;
    const pelvisY=hindDrive*(.12+trot*.48+run*1.42)*moveBlend+hindSupport*run*.38+foxLabJumpAnticipation*1.25-jumpStretch*1.15-jumpDrive*.95+jumpApex*.3+jumpDescend*.72+foxLabLandingImpact*1.45;
    const ribY=foreLoad*(.14+trot*.42+run*1.04)*moveBlend+foreSupport*run*.24+foxLabJumpAnticipation*.38-jumpStretch*.78-jumpDrive*.58-jumpApex*.42+jumpDescend*.4+foxLabLandingImpact*1.02;
    const pelvisAngle=hindDrive*(trot*.024+run*.082)+clamp(foxLabBodyAcceleration/1100,-1,1)*.038+turnPelvis*.072-jumpStretch*.092-jumpDrive*.062+jumpApex*.038+jumpDescend*.067+foxLabLandingImpact*.04;
    const ribAngle=foreLoad*(trot*.018+run*.061)+clamp(foxLabBodyAcceleration/1100,-1,1)*.02+turnShoulder*.082-jumpStretch*.112-jumpDrive*.062+jumpApex*.048+jumpDescend*.078+foxLabLandingImpact*.047;
    const pelvisX=hindDrive*(trot*.48+run*2.45)+clamp(foxLabBodyAcceleration/1100,-1,1)*.68+turnPelvis*.68-jumpStretch*.55+jumpDrive*1.6+jumpApex*.3+jumpDescend*.45;
    const ribX=foreLoad*(trot*.34+run*1.56)+turnShoulder*1.05-clamp(foxLabBodyAcceleration/1100,-1,1)*.32+jumpStretch*.6+jumpDrive*1.9+jumpApex*.4-jumpDescend*.35;
    const waistY=(ribY-pelvisY)*.38+lumbarWave*(trot*.58+run*2.05)*moveBlend+foxLabJumpAnticipation*.72-jumpStretch*2.1-jumpDrive*1.1+jumpApex*.85+jumpDescend*1.15+foxLabLandingImpact*.94;
    const waistAngle=(ribAngle-pelvisAngle)*.5+lumbarWave*(trot*.017+run*.071)*moveBlend+foxLabJumpAnticipation*.038-jumpStretch*.135-jumpDrive*.06+jumpApex*.075+jumpDescend*.095+foxLabLandingImpact*.05;
    springTo(foxLabSpine,"pelvisX",pelvisX,12,.88,dt);springTo(foxLabSpine,"pelvisY",pelvisY,13,.9,dt);springTo(foxLabSpine,"pelvisAngle",pelvisAngle,11,.9,dt);
    springTo(foxLabSpine,"ribX",ribX,10,.92,dt);springTo(foxLabSpine,"ribY",ribY,11,.95,dt);springTo(foxLabSpine,"ribAngle",ribAngle,10,.92,dt);
    springTo(foxLabSpine,"waistY",waistY,8.5,.92,dt);springTo(foxLabSpine,"waistAngle",waistAngle,8.5,.94,dt);
    springTo(foxLabSpine,"neckAngle",-ribAngle*.62-waistAngle*.28+turnHead*.055+clamp(foxLabBodyAcceleration/1100,-1,1)*.012,12,.98,dt);
    springTo(foxLabSpine,"headY",-foxLabSpine.ribY*.7-foxLabSpine.pelvisY*.08+foreLoad*moveBlend*.1,13,1,dt);
    const earForce=clamp(foxLabBodyAcceleration/1000,-1,1)*.075+clamp(-foxLabVerticalAcceleration/5000,0,1)*.1
      +jumpDrive*.06+jumpStretch*.045+jumpDescend*.04+foxLabLandingImpact*.14+foxLabJumpAnticipation*.024
      +clamp(-foxLabSpine.neckAngleV*.015,-.025,.025);
    springTo(foxLabEar,"angle",clamp(earForce,-.08,.22),15,.94,dt);
    springTo(foxLabEarTip,"angle",foxLabEar.angle,9,.98,dt);

    const turnSway=turnPulse(.2,.98)*turnDelta;
    const tailActivity=smooth(5,90,currentSpeed),idleTailAngle=mix(.34,.085,tailActivity);
    const gaitTail=cycleSample(foxLabStridePhase-.14,[0,.03,.05,.01,-.02,-.045,-.01,.02])*tailActivity*(.55+foxLabTrotBlend+foxLabRunBlend);
    const speedTrail=smooth(55,285,currentSpeed)*.055;
    const airborne=player.grounded?0:1,ballistic=clamp(Math.max(airborne,foxLabLandingRecovery),0,1);
    const jumpVelocity=airborne*clamp(-player.vy/545,-1,1)*.58;
    const jumpAcceleration=airborne*clamp(-foxLabVerticalAcceleration/2400,-1,1)*.24;
    const bodyFollow=-(foxLabSpine.pelvisAngleV*.06+foxLabSpine.waistAngleV*.035)*(1+airborne*1.5);
    const tailTarget=clamp(idleTailAngle+speedTrail+foxLabBodyAcceleration*.00024-player.vy*.0004-foxLabVerticalAcceleration*.000009
      +foxLabTailLaunch*(airborne?.65:.31)+jumpVelocity+jumpAcceleration+foxLabJumpAnticipation*.18
      +turnSway*.16+bodyFollow+gaitTail+foxLabInvestigation*.16-foxLabLandingRecovery*.24,-1.05,1.18);
    for(let i=0;i<foxLabTailAngles.length;i++){
      const prior=i?foxLabTailAngles[i-1]:tailTarget;
      const target=i?tailTarget+(prior-tailTarget)*mix(.43,.58,ballistic):tailTarget;
      const stiffness=29-i*2.15,damping=(5.8-i*.36)*(1-.28*ballistic);
      foxLabTailVelocities[i]+=(target-foxLabTailAngles[i])*stiffness*dt;
      foxLabTailVelocities[i]*=Math.exp(-damping*dt);
      foxLabTailAngles[i]=clamp(foxLabTailAngles[i]+foxLabTailVelocities[i]*dt,-.82,.9);
    }
  }

function drawFox(now,dt=1/60){
    const speed=Math.abs(player.vx),move=smooth(4,58,speed),trot=foxLabTrotBlend,run=foxLabRunBlend;
    const airborne=!player.grounded,phase=foxLabStridePhase,impact=foxLabLandingImpact,investigate=foxLabInvestigation;
    const launch=airborne?smooth(0,145,now-(foxLabTakeoffUntil-145)):0;
    const stride=foxLabStrideLength;
    const bodyWave=cycleSample(phase-.16,[-.2,.05,.42,.2,-.08,-.46,-.24,.14]),stepWave=cycleSample(phase,[0,.36,.72,.28,-.18,-.64,-.35,.11]);
    const compress=Math.max(0,cycleSample(phase+.34,[-.1,.22,.82,.48,-.16,-.72,-.4,.09]))*run*.42;
    const bounce=player.grounded?stepWave*move*(.12+run*.26):0;
    const shoulderMotion=foxLabSpine.ribY;
    const accelerationLean=clamp(foxLabBodyAcceleration/1100,-1,1);
    const braking=clamp(-foxLabBodyAcceleration/1000,0,1);
    const anticipation=foxLabJumpAnticipation,recovery=foxLabLandingRecovery;
    const verticalMotion=stepWave*(trot*.16+run*.3)-recovery*1.4;
    const pitch=airborne?clamp(player.vy*.00016,-.15,.15):(-.025*run+bodyWave*.008*trot+accelerationLean*.035-braking*.014-impact*.045+investigate*.018);
    const breathe=player.grounded&&speed<9?Math.sin(now*.0021)*.35:0;
    const rise=8+compress*.8+launch*1.2-investigate*1.5+breathe;
    const footLine=player.h/2-2+rise-bounce-impact*5-verticalMotion-anticipation*3+recovery*2.6;
    const turnDelta=foxLabTurnTo-foxLabTurnFrom,turnWave=turnPulse(.03,.98)*turnDelta;
    // A 2D mirror is discrete. Interpolating its scale through zero collapses every bone mid-turn.
    const fwd=player.facing;
    const turnLean=turnPulse(.18,.84)*turnDelta*.052;
    const originX=player.x+player.w/2,originY=player.y+player.h/2+bounce+impact*5+verticalMotion+anticipation*3-recovery*2.6-rise;
    // Flipping and rotation preserve segment lengths; gait squash must not scale the skeleton.
    const scaleX=fwd,scaleY=1,bodyAngle=pitch*.34+turnLean*.5;
    const localToWorld=(x,y)=>({x:originX+scaleX*(x*Math.cos(bodyAngle)-y*Math.sin(bodyAngle)),y:originY+scaleY*(x*Math.sin(bodyAngle)+y*Math.cos(bodyAngle))});
    const worldToLocal=(x,y)=>{const dx=(x-originX)/scaleX,dy=(y-originY)/scaleY;return{x:dx*Math.cos(bodyAngle)+dy*Math.sin(bodyAngle),y:-dx*Math.sin(bodyAngle)+dy*Math.cos(bodyAngle)};};
    ctx.save();ctx.translate(originX,originY);ctx.scale(scaleX,scaleY);ctx.rotate(bodyAngle);

    // A weighted brush tail whose bend travels from pelvis to tip.
    const tailBaseX=-41+foxLabSpine.pelvisX,tailBaseY=foxLabSpine.pelvisY;
    const tailPts=[[tailBaseX,tailBaseY]],tailLens=[13,15,16,16,16,16,15,13];let tx=tailBaseX,ty=tailBaseY;
    for(let i=0;i<tailLens.length;i++){const a=foxLabTailAngles[i]+foxLabSpine.pelvisAngle;tx-=Math.cos(a)*tailLens[i];ty+=Math.sin(a)*tailLens[i];tailPts.push([tx,ty]);}
    const widths=[6.5,10,14,16,17,16,13,8,3.2],upper=[],lower=[];
    for(let i=0;i<tailPts.length;i++){const p=tailPts[i],before=tailPts[Math.max(0,i-1)],after=tailPts[Math.min(tailPts.length-1,i+1)],dx=after[0]-before[0],dy=after[1]-before[1],len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;upper.push([p[0]+nx*widths[i],p[1]+ny*widths[i]]);lower.push([p[0]-nx*widths[i],p[1]-ny*widths[i]]);}
    const traceSmooth=(points,reverse=false,move=true)=>{const ordered=reverse?points.slice().reverse():points;if(move)ctx.moveTo(...ordered[0]);else ctx.lineTo(...ordered[0]);for(let i=0;i<ordered.length-1;i++){const a=ordered[i],b=ordered[i+1];ctx.quadraticCurveTo(...a,(a[0]+b[0])/2,(a[1]+b[1])/2);}ctx.lineTo(...ordered.at(-1));};
    ctx.fillStyle="#a84727";ctx.beginPath();traceSmooth(upper);traceSmooth(lower,true,false);ctx.closePath();ctx.fill();
    // The white brush starts on the distal tail itself so it follows every segment bend.
    const whiteStart=6;ctx.fillStyle="#f0dfc5";ctx.beginPath();
    ctx.moveTo(...upper[whiteStart]);
    for(let i=whiteStart;i<upper.length-1;i++){const a=upper[i],b=upper[i+1];ctx.quadraticCurveTo(...a,(a[0]+b[0])/2,(a[1]+b[1])/2);}
    ctx.lineTo(...upper.at(-1));
    for(let i=lower.length-1;i>whiteStart;i--){const a=lower[i],b=lower[i-1];ctx.quadraticCurveTo(...a,(a[0]+b[0])/2,(a[1]+b[1])/2);}
    ctx.lineTo(...lower[whiteStart]);ctx.closePath();ctx.fill();
    ctx.strokeStyle="rgba(255,218,178,.48)";ctx.lineWidth=2;ctx.beginPath();traceSmooth(tailPts.map(p=>[p[0],p[1]-2]));ctx.stroke();
    const tip=tailPts.at(-1),base=tailPts.at(-2),tailDx=tip[0]-base[0],tailDy=tip[1]-base[1],tailSize=Math.hypot(tailDx,tailDy)||1,tailNx=-tailDy/tailSize,tailNy=tailDx/tailSize;
    ctx.fillStyle="#f0dfc5";ctx.beginPath();ctx.moveTo(tip[0]+tailNx*2.5,tip[1]+tailNy*2.5);ctx.quadraticCurveTo(tip[0]+tailDx/tailSize*4,tip[1]+tailDy/tailSize*4,tip[0]+tailDx/tailSize*12,tip[1]+tailDy/tailSize*12);ctx.quadraticCurveTo(tip[0]+tailDx/tailSize*4,tip[1]+tailDy/tailSize*4,tip[0]-tailNx*2.5,tip[1]-tailNy*2.5);ctx.closePath();ctx.fill();

    // Muscled, three-part limbs: shoulder/hip, elbow/knee, wrist/hock, then a small planted paw.
    const limb=index=>{
      const config=foxLabLegConfigs[index],front=config.front,far=config.far;
      const hip=config.hip+(front?foxLabSpine.ribX:foxLabSpine.pelvisX),rootY=front?foxLabSpine.ribY:foxLabSpine.pelvisY;
      const p=((gaitPhase(config.walk,config.trot)%(Math.PI*2))+Math.PI*2)%(Math.PI*2),stance=p<Math.PI*1.17;
      const t=stance?p/(Math.PI*1.17):(p-Math.PI*1.17)/(.83*Math.PI);
      const swing=cubic(t),reach=mix(.38,.25,run),travel=stance?reach-2*reach*t:-reach+2*reach*swing,lift=stance?0:2.4*t*(1-t);
      const restingOffset=front?(far?-2.2:1.8):(far?2.4:-1.8);
      let pawX=hip+travel*stride*move+restingOffset*(1-move),pawY=footLine-lift*(5+run*10)*move;
      if(airborne){
        const descending=smooth(-80,430,player.vy);
        pawX=hip+(front?8:-7)+(front?descending*(7+run*2):-descending*(6+run*3));
        pawY=footLine-(1-descending)*(front?13+launch*3:10+launch*2)+(front?0:-descending*3);
      }
      if(impact&&!airborne)pawY=footLine-impact*2;
      const joints=foxLabLegStates[index];
      if(!joints.ready){joints.pawX=pawX;joints.pawY=pawY;joints.ready=true;}
      else{springTo(joints,"pawX",pawX,22,.98,dt);springTo(joints,"pawY",pawY,22,.98,dt);pawX=joints.pawX;pawY=joints.pawY;}
      const contact=foxLabFootContacts[index],maxReach=config.upper+config.lower-Math.max(2.5,Math.min(config.upper,config.lower)*.1);
      if(!stance||speed<=7||!player.grounded)contact.released=false;
      const canLock=player.grounded&&speed>7&&stance&&!contact.released&&Math.abs(scaleX)>.28;
      if(canLock&&!contact.planted){
        const anchor=localToWorld(pawX,pawY),local=worldToLocal(anchor.x,anchor.y);
        if(Math.hypot(local.x-config.toeX-hip,local.y-config.toeY-rootY)<maxReach-1.2){contact.x=anchor.x;contact.y=anchor.y;contact.planted=true;}
        else contact.released=true;
      }
      if(!canLock)contact.planted=false;
      if(Math.abs(scaleX)<=.28)contact.weight=0;
      contact.weight+=(Number(canLock&&contact.planted)-contact.weight)*(1-Math.exp(-20*dt));
      const freePawX=pawX,freePawY=pawY;
      if(contact.weight>.001&&Math.abs(scaleX)>.28){
        const locked=worldToLocal(contact.x,contact.y),reach=Math.hypot(locked.x-config.toeX-hip,locked.y-config.toeY-rootY);
        if(contact.planted&&reach>maxReach-1.2){contact.planted=false;contact.released=true;contact.weight=0;pawX=freePawX;pawY=freePawY;}
        else{pawX=mix(pawX,locked.x,contact.weight);pawY=mix(pawY,locked.y,contact.weight);}
      }
      const solved=solveFixedLimb(hip,rootY,pawX,pawY,config,player.grounded&&stance);
      pawX=solved.pawX;pawY=solved.pawY;
      const jointX=solved.kneeX,jointY=solved.kneeY,midX=solved.hockX,midY=solved.hockY;
      const pawWorld=localToWorld(pawX,pawY);contact.renderX=pawWorld.x;contact.renderY=pawWorld.y;
      const color=far?"#87402c":"#a34b2c",alpha=far?.54:1;
      const bone=(ax,ay,bx,by,wide,thin)=>{const dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;ctx.beginPath();ctx.moveTo(ax+nx*wide,ay+ny*wide);ctx.quadraticCurveTo((ax+bx)/2+nx*(wide+thin)*.24,(ay+by)/2+ny*(wide+thin)*.24,bx+nx*thin,by+ny*thin);ctx.lineTo(bx-nx*thin,by-ny*thin);ctx.quadraticCurveTo((ax+bx)/2-nx*(wide+thin)*.24,(ay+by)/2-nx*(wide+thin)*.24,ax-nx*wide,ay-ny*wide);ctx.closePath();ctx.fill();};
      ctx.globalAlpha=alpha;ctx.fillStyle=color;
      bone(hip,rootY,jointX,jointY,front?(far?3:4.05):(far?3.4:4.5),front?(far?2.3:3):(far?2.6:3.3));
      bone(jointX,jointY,midX,midY,front?(far?2.25:2.9):(far?2.4:3.15),front?(far?1.65:2.05):(far?1.7:2.25));
      bone(midX,midY,pawX,pawY,far?1.5:1.8,far?1.1:1.35);
      if(!front){
        const thighDx=jointX-hip,thighDy=jointY-rootY,thighLength=Math.hypot(thighDx,thighDy),thighAngle=Math.atan2(thighDy,thighDx);
        ctx.save();ctx.translate(hip+thighDx*.3,rootY+thighDy*.3);ctx.rotate(thighAngle);
        ctx.fillStyle=far?"#87402c":"#bb552d";ctx.beginPath();ctx.moveTo(-thighLength*.44,0);
        ctx.quadraticCurveTo(-thighLength*.24,-9.2,-thighLength*.02,-9.6);
        ctx.quadraticCurveTo(thighLength*.3,-6.2,thighLength*.4,0);
        ctx.quadraticCurveTo(thighLength*.28,5,thighLength*.05,8.1);
        ctx.quadraticCurveTo(-thighLength*.29,6.3,-thighLength*.44,0);ctx.closePath();ctx.fill();ctx.restore();
      }
      ctx.fillStyle=far?"#6f3628":"#833d29";ctx.beginPath();ctx.arc(jointX,jointY,far?1.45:1.9,0,Math.PI*2);ctx.arc(midX,midY,far?1:1.35,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=far?"#6f3628":"#833d29";ctx.beginPath();ctx.ellipse(pawX+1.4,pawY,3.1,1.65,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
    };
    // Four-beat walk: each paw lands in sequence. The faster gait blends toward diagonal-pair trot timing.
    limb(0);
    limb(1);

    // Deform each trunk region around its own delayed anchor so the back line bends continuously.
    const spinePoint=(x,y)=>{
      const transform=(pivotX,shiftX,shiftY,angle)=>{const dx=x-pivotX,dy=y,c=Math.cos(angle),s=Math.sin(angle);return[pivotX+shiftX+dx*c-dy*s,shiftY+dx*s+dy*c];};
      const pelvis=transform(-29,foxLabSpine.pelvisX,foxLabSpine.pelvisY,foxLabSpine.pelvisAngle);
      const waist=transform(-4,(foxLabSpine.pelvisX+foxLabSpine.ribX)*.18,foxLabSpine.waistY,foxLabSpine.waistAngle);
      const rib=transform(20,foxLabSpine.ribX,foxLabSpine.ribY,foxLabSpine.ribAngle);
      const mixPoint=(a,b,t)=>[mix(a[0],b[0],t),mix(a[1],b[1],t)];
      return mixPoint(mixPoint(pelvis,waist,smooth(-20,-8,x)),rib,smooth(6,18,x));
    };
    const spineOutline=[[-49,-3],[-44,-12],[-38,-15],[-29,-17],[-19,-15],[-10,-15],[-4,-17],[8,-18],[17,-17],[28,-14],[39,-7],[42,-3],[39,1],[34,5],[27,8],[18,8],[9,6],[1,4],[-9,4],[-20,7],[-29,10],[-38,8],[-45,6]].map(p=>spinePoint(...p));
    ctx.fillStyle="#bb552d";ctx.beginPath();ctx.moveTo(...spineOutline[0]);
    for(let i=0;i<spineOutline.length;i++){const a=spineOutline[i],b=spineOutline[(i+1)%spineOutline.length];ctx.quadraticCurveTo(...a,(a[0]+b[0])*.5,(a[1]+b[1])*.5);}ctx.closePath();ctx.fill();
    const chestA=spinePoint(27,-13),chestB=spinePoint(34,-9),chestC=spinePoint(34,-2),chestD=spinePoint(30,4),chestE=spinePoint(26,6),chestF=spinePoint(23,2);
    ctx.fillStyle="#f0dfc5";ctx.beginPath();ctx.moveTo(...chestA);ctx.quadraticCurveTo(...chestB,...chestC);ctx.quadraticCurveTo(...chestD,...chestE);ctx.quadraticCurveTo(...spinePoint(25,3),...chestF);ctx.closePath();ctx.fill();
    limb(2);
    limb(3);

    // The neck tapers from a soft shoulder blend to the refined skull.
    ctx.fillStyle="#c76131";ctx.beginPath();ctx.moveTo(...spinePoint(15,-14));ctx.quadraticCurveTo(...spinePoint(23,-21),...spinePoint(38,-20));ctx.quadraticCurveTo(...spinePoint(44,-19),...spinePoint(46,-13));ctx.quadraticCurveTo(...spinePoint(40,-8),...spinePoint(35,-2));ctx.quadraticCurveTo(...spinePoint(30,2),...spinePoint(24,3));ctx.quadraticCurveTo(...spinePoint(20,-2),...spinePoint(15,-5));ctx.closePath();ctx.fill();
    ctx.save();ctx.translate(34+foxLabSpine.ribX*.55+turnWave*1.4,-16+foxLabSpine.headY+shoulderMotion*.12);ctx.rotate(-pitch*.48-foxLabSpine.ribAngle*.45-foxLabSpine.waistAngle*.28+investigate*.18+Math.max(0,player.vy)*.000035+foxLabSpine.neckAngle+turnWave*.045);ctx.translate(-34,16);
    const idleTwitch=foxLabIdleTime>2.5&&Math.sin(foxLabIdleTime*2.1)>.975?1:0,earBack=investigate*.75+run*.035+idleTwitch*.07+foxLabEar.angle;
    const ear=(x,len,angle,{inner=false,outer="#b84d2a"}={})=>{const tipLagX=clamp(foxLabEar.angle-foxLabEarTip.angle,-.12,.12)*len*.38;ctx.save();ctx.translate(x,-24);ctx.rotate(angle);ctx.fillStyle=outer;ctx.beginPath();ctx.moveTo(-6,3);ctx.quadraticCurveTo(-8+tipLagX*.45,-len*.58,-1+tipLagX,-len);ctx.quadraticCurveTo(7+tipLagX*.8,-len*.68,8,3);ctx.closePath();ctx.fill();if(inner){ctx.fillStyle="#61352b";ctx.beginPath();ctx.moveTo(-2,0);ctx.quadraticCurveTo(-3+tipLagX*.25,-len*.48,-1+tipLagX*.7,-len*.72);ctx.quadraticCurveTo(3+tipLagX*.55,-len*.55,4,1);ctx.closePath();ctx.fill();}ctx.restore();};
    // The far ear is behind the head and shows only its darker outer surface.
    ear(38,22,-.14-earBack*.68,{outer:"#8f3c27"});
    ctx.fillStyle="#c76131";ctx.beginPath();ctx.moveTo(23,-15);ctx.quadraticCurveTo(29,-26,38,-26);ctx.quadraticCurveTo(47,-25,50,-18);ctx.quadraticCurveTo(45,-11,37,-9);ctx.quadraticCurveTo(28,-10,23,-15);ctx.fill();
    // The near ear stays forward and keeps the visible inner surface.
    ear(29,25,.08-earBack,{inner:true});
    const noseDrop=investigate*5;
    ctx.fillStyle="#c76131";ctx.beginPath();ctx.moveTo(40,-18);ctx.quadraticCurveTo(53,-14,67,-7+noseDrop);ctx.lineTo(78,-2+noseDrop);ctx.quadraticCurveTo(71,2+noseDrop,64,1+noseDrop);ctx.lineTo(48,0+noseDrop);ctx.quadraticCurveTo(41,-5,40,-18);ctx.fill();
    ctx.fillStyle="#f0dfc5";ctx.beginPath();ctx.moveTo(49,-4);ctx.quadraticCurveTo(62,-4,75,-1+noseDrop);ctx.quadraticCurveTo(69,2+noseDrop,63,1+noseDrop);ctx.lineTo(50,1+noseDrop);ctx.closePath();ctx.fill();
    // A soft almond eye and a light lash give her a clear, expressive cartoon-feminine read.
    ctx.fillStyle="#251a17";ctx.beginPath();ctx.moveTo(39.8,-19.3);ctx.quadraticCurveTo(44.2,-23.8,49.5,-20.5);ctx.quadraticCurveTo(50.2,-18.7,47.4,-16.3);ctx.quadraticCurveTo(42.7,-15.5,40,-17.8);ctx.closePath();ctx.fill();
    ctx.strokeStyle="#40221d";ctx.lineWidth=1;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(40.4,-20.5);ctx.quadraticCurveTo(44.8,-23.7,49.4,-20.8);ctx.moveTo(40.4,-21);ctx.lineTo(38.9,-22.2);ctx.moveTo(41.9,-22);ctx.lineTo(41.1,-23.4);ctx.stroke();
    ctx.beginPath();ctx.moveTo(75,-4+noseDrop);ctx.quadraticCurveTo(79,-5+noseDrop,80,-2+noseDrop);ctx.quadraticCurveTo(79,1+noseDrop,76,0+noseDrop);ctx.quadraticCurveTo(74,-1+noseDrop,75,-4+noseDrop);ctx.closePath();ctx.fill();
    ctx.fillStyle="#e3ad47";ctx.beginPath();ctx.ellipse(45.9,-19,2.45,2.75,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#251a17";ctx.beginPath();ctx.ellipse(46.45,-19,.92,1.75,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#fff1d3";ctx.beginPath();ctx.ellipse(44.45,-20.2,.82,.95,0,0,Math.PI*2);ctx.fill();
    ctx.restore();
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
    drawFox(now,dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
