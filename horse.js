(() => {
  "use strict";
  // Horse movement study adapted from the independent Fox Two locomotion prototype.
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
  let foxLabBlinkTimer = 2.8, foxLabBlinkRemaining = 0;
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
  // Key-pose channels are normalized, phase-continuous targets: contact → gather → drive → flight.
  const foxLabPose = {
    runContact:0,runContactV:0,runGather:0,runGatherV:0,runDrive:0,runDriveV:0,runExtension:0,runExtensionV:0,
    jumpLoad:0,jumpLoadV:0,jumpDrive:0,jumpDriveV:0,jumpExtension:0,jumpExtensionV:0,
    jumpApex:0,jumpApexV:0,jumpLanding:0,jumpLandingV:0
  };
  const foxLabEar={angle:0,angleV:0},foxLabEarTip={angle:0,angleV:0};
  const foxLabRestPose={sit:0,sitV:0,lie:0,lieV:0};let foxLabRestTarget=0;
  const foxLabLegStates=Array.from({length:4},()=>({ready:false,pawX:0,pawXV:0,pawY:0,pawYV:0}));
  const foxLabFootContacts=Array.from({length:4},()=>({planted:false,released:false,weight:0,x:0,y:0}));
  // Walk order: near hind → near fore → far hind → far fore; trot pairs diagonal limbs.
  const foxLabLegConfigs=[
    {hip:-39,front:false,far:true,walk:Math.PI,trot:0,upper:32.5,lower:22,toeX:2,toeY:22.5,bend:-1},
    {hip:20,front:true,far:true,walk:Math.PI*1.5,trot:Math.PI,upper:29,lower:25,toeX:1.4,toeY:8.5,bend:1},
    {hip:-40,front:false,far:false,walk:0,trot:Math.PI,upper:32.5,lower:22,toeX:2,toeY:22.5,bend:-1},
    {hip:33,front:true,far:false,walk:Math.PI*.5,trot:0,upper:29,lower:25,toeX:1.4,toeY:8.5,bend:1}
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
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "Space", "KeyX", "KeyZ"].includes(event.code)) event.preventDefault();
    if (keys[event.code]) return;
    keys[event.code] = true;
    
    
    if (["Space", "ArrowUp", "KeyW"].includes(event.code) && player.grounded && foxLabJumpPending <= 0) {
      foxLabRestTarget=0;
      foxLabJumpPending = .075;
      foxLabJumpAnticipation = 0;
    }
  });
  addEventListener("keyup", event => { keys[event.code] = false; });

  function updateFox(dt, now, left, right, up, investigate) {
    const walkModifier=keys.ShiftLeft||keys.ShiftRight;
    const input=(left?-1:0)+(right?1:0),oldVx=player.vx,oldVy=player.vy;
    if(input)foxLabRestTarget=0;
    const speed=Math.abs(player.vx),reversing=input&&speed>8&&Math.sign(player.vx)!==input;
    if(input&&input!==foxLabTurnTo){foxLabTurnFrom=foxLabTurnTo;foxLabTurnTo=input;foxLabTurnProgress=0;foxLabTurnDuration=.21+Math.min(speed,285)*.00032;}
    if(foxLabTurnProgress<1)foxLabTurnProgress=Math.min(1,foxLabTurnProgress+dt/foxLabTurnDuration);
    if(foxLabTurnProgress>=.52&&(Math.abs(player.vx)<34||Math.sign(player.vx)===foxLabTurnTo))player.facing=foxLabTurnTo;

    if(input){
      const accel=player.grounded?(reversing?(walkModifier?760:1040):(walkModifier?430:690)):(reversing?410:walkModifier?220:280);
      player.vx+=input*accel*dt;
    }else player.vx*=Math.exp(-(player.grounded?5.4:1.65)*dt);
    if(walkModifier&&Math.abs(player.vx)>105){
      const excess=Math.abs(player.vx)-105,brake=Math.min(excess,(input&&Math.sign(player.vx)===input?560:850)*dt);
      player.vx-=Math.sign(player.vx)*brake;
    }
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
    // Give every gait a longer stride span while keeping walk, trot, and run speed-blended.
    const walkStride=34+currentSpeed*.23;
    const fasterStride=mix(48+currentSpeed*.22,80+currentSpeed*.2,foxLabRunBlend);
    foxLabStrideLength=mix(walkStride,fasterStride,foxLabTrotBlend);
    if(player.grounded&&currentSpeed>1.4)foxLabStridePhase+=currentSpeed*dt*Math.PI/foxLabStrideLength*(1+foxLabRunBlend*.07);
    const restReady=player.grounded&&currentSpeed<22&&!input&&foxLabJumpPending<=0;
    springTo(foxLabRestPose,"sit",restReady&&foxLabRestTarget===1?1:0,6.5,.96,dt);
    springTo(foxLabRestPose,"lie",restReady&&foxLabRestTarget===2?1:0,6.5,.96,dt);

    foxLabIdleTime=player.grounded&&currentSpeed<9&&!input?foxLabIdleTime+dt:0;
    if(foxLabBlinkRemaining>0)foxLabBlinkRemaining=Math.max(0,foxLabBlinkRemaining-dt);
    else{foxLabBlinkTimer-=dt;if(foxLabBlinkTimer<=0){foxLabBlinkRemaining=.14;foxLabBlinkTimer=3.1+Math.random()*2.7;}}
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
    const jumpArch=!player.grounded?Math.max(jumpStretch*.82,jumpApex*.58):0;
    /*
     * Reference study translated into ToxicFox poses (principles only, no traced coordinates):
     * alert stand = lifted head over quiet, weight-bearing limbs; walk = sequential four-beat contacts;
     * run = front contact → compact gather → hindquarter drive → long flight; jump = load → drive
     * → evolving airborne arc → forequarter impact → recovery. The reference's seated and nose-down
     * poses inform balance and line-of-action, but are not added as new gameplay states here.
     */
    // Pose channels remain phase-continuous and are blended over the existing fixed-length skeleton.
    const poseTargets={
      runContact:clamp(cycleSample(phase,[.16,.9,.4,0,0,.12,.74,.3]),0,1)*run,
      runGather:clamp(cycleSample(phase,[0,.04,.5,.96,.45,.02,0,0]),0,1)*run,
      runDrive:clamp(cycleSample(phase,[0,.02,.18,.84,.82,.2,0,0]),0,1)*run,
      runExtension:clamp(cycleSample(phase,[.08,.02,0,.1,.68,.98,.58,.18]),0,1)*run,
      jumpLoad:Math.max(foxLabJumpAnticipation,jumpDescend*.24),
      jumpDrive:jumpDrive,
      jumpExtension:!player.grounded?clamp(Math.max(jumpStretch,jumpDrive*.58+jumpApex*.24),0,1):0,
      jumpApex:jumpApex,
      jumpLanding:foxLabLandingImpact
    };
    for(const [key,value] of Object.entries(poseTargets))springTo(foxLabPose,key,value,key.startsWith("run")?18:12,.92,dt);
    const pose=foxLabPose;
    const support=(cfg)=>{const p=((gaitPhase(cfg.walk,cfg.trot)%(Math.PI*2))+Math.PI*2)%(Math.PI*2),u=p/(Math.PI*2);return smooth(0,.035,u)*(1-smooth(.565,.61,u));};
    const hindSupport=(support(foxLabLegConfigs[0])+support(foxLabLegConfigs[2]))*.5;
    const foreSupport=(support(foxLabLegConfigs[1])+support(foxLabLegConfigs[3]))*.5;
    const pelvisY=hindDrive*(.12+trot*.48+run*1.42)*moveBlend+hindSupport*run*.38+foxLabJumpAnticipation*1.25-jumpStretch*1.15-jumpDrive*.95+jumpApex*.3+jumpDescend*.72+foxLabLandingImpact*1.45
      +pose.runGather*2-pose.runDrive*.85-pose.runExtension*.62+pose.jumpLoad*1.6-pose.jumpDrive*.7-pose.jumpExtension*.85+pose.jumpApex*.3+pose.jumpLanding*1+foxLabRestPose.sit*3.5+foxLabRestPose.lie*5;
    const ribY=foreLoad*(.14+trot*.42+run*1.04)*moveBlend+foreSupport*run*.24+foxLabJumpAnticipation*.38-jumpStretch*.78-jumpDrive*.58-jumpApex*.42+jumpDescend*.4+foxLabLandingImpact*1.02
      +pose.runContact*.75-pose.runExtension*.55-pose.jumpExtension*.7+pose.jumpLanding*.85+foxLabRestPose.sit*.9+foxLabRestPose.lie*4.5;
    const pelvisAngle=hindDrive*(trot*.024+run*.082)+clamp(foxLabBodyAcceleration/1100,-1,1)*.038+turnPelvis*.072-jumpStretch*.092-jumpDrive*.062+jumpApex*.038+jumpDescend*.067+foxLabLandingImpact*.04
      +pose.runGather*.06-pose.runDrive*.045+pose.jumpLoad*.05-pose.jumpDrive*.04+pose.jumpLanding*.05-foxLabRestPose.sit*.055+foxLabRestPose.lie*.012;
    const ribAngle=foreLoad*(trot*.018+run*.061)+clamp(foxLabBodyAcceleration/1100,-1,1)*.02+turnShoulder*.082-jumpStretch*.112-jumpDrive*.062+jumpApex*.048+jumpDescend*.078+foxLabLandingImpact*.047
      +pose.runContact*.032+pose.runExtension*.025-pose.jumpDrive*.04+pose.jumpLanding*.05-foxLabRestPose.sit*.02+foxLabRestPose.lie*.035;
    const pelvisX=hindDrive*(trot*.48+run*2.45)+clamp(foxLabBodyAcceleration/1100,-1,1)*.68+turnPelvis*.68-jumpStretch*.55+jumpDrive*1.6+jumpApex*.3+jumpDescend*.45
      -pose.runGather*.7+pose.runDrive*1.2+pose.runExtension*.5-pose.jumpLoad*.5+pose.jumpDrive*1+pose.jumpExtension*.55;
    const ribX=foreLoad*(trot*.34+run*1.56)+turnShoulder*1.05-clamp(foxLabBodyAcceleration/1100,-1,1)*.32+jumpStretch*.6+jumpDrive*1.9+jumpApex*.4-jumpDescend*.35
      +pose.runContact*.3+pose.runExtension*.8+pose.jumpDrive*.65+pose.jumpExtension*.8-pose.jumpLanding*.45;
    const waistY=(ribY-pelvisY)*.38+lumbarWave*(trot*.58+run*2.05)*moveBlend+foxLabJumpAnticipation*.72-jumpStretch*2.1-jumpDrive*1.1+jumpApex*.85+jumpDescend*1.15-jumpArch*5.5+foxLabLandingImpact*.94
      +pose.runGather*.8-pose.runExtension*.55+pose.jumpLoad*.7-pose.jumpDrive*.45+pose.jumpApex*.3+pose.jumpLanding*.8+foxLabRestPose.sit*2+foxLabRestPose.lie*4;
    const waistAngle=(ribAngle-pelvisAngle)*.5+lumbarWave*(trot*.017+run*.071)*moveBlend+foxLabJumpAnticipation*.038-jumpStretch*.135-jumpDrive*.06+jumpApex*.075+jumpDescend*.095-jumpArch*.11+foxLabLandingImpact*.05
      +pose.runGather*.07-pose.runExtension*.085+pose.jumpLoad*.075-pose.jumpDrive*.07+pose.jumpApex*.035+pose.jumpLanding*.07+foxLabRestPose.sit*.025-foxLabRestPose.lie*.03;
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
    const tailActivity=smooth(5,90,currentSpeed),idleTailAngle=mix(.4,.09,tailActivity);
    const gaitTail=cycleSample(foxLabStridePhase-.14,[0,.11,.2,.08,-.04,-.16,-.09,.03])*tailActivity*(.75+foxLabTrotBlend*.7+foxLabRunBlend*.85);
    const idleTailDrift=(1-tailActivity)*(Math.sin(foxLabIdleTime*.48)*.16+Math.sin(foxLabIdleTime*.21+1.3)*.055);
    const speedTrail=-smooth(45,285,currentSpeed)*.105;
    const airborne=player.grounded?0:1,ballistic=clamp(Math.max(airborne,foxLabLandingRecovery),0,1);
    const jumpVelocity=airborne*clamp(-player.vy/545,-1,1)*.58;
    const jumpAcceleration=airborne*clamp(-foxLabVerticalAcceleration/2400,-1,1)*.24;
    const bodyFollow=-(foxLabSpine.pelvisAngleV*.06+foxLabSpine.waistAngleV*.035)*(1+airborne*1.5);
    const tailTarget=clamp(idleTailAngle+speedTrail+foxLabBodyAcceleration*.00024-player.vy*.0004-foxLabVerticalAcceleration*.000009
      +foxLabTailLaunch*(airborne?.78:.31)+jumpVelocity+jumpAcceleration+foxLabJumpAnticipation*.18+(airborne?.48:0)
      +turnSway*.22+bodyFollow+gaitTail+idleTailDrift+foxLabInvestigation*.16-foxLabLandingRecovery*.24,-1.05,1.18);
    for(let i=0;i<foxLabTailAngles.length;i++){
      const distal=i/(foxLabTailAngles.length-1);
      // At rest, gravity adds a smooth base-to-tip droop; a rare damped pulse gives the tip life without wagging.
      const idleTailSag=(1-tailActivity)*(.11+distal*.5)+((1-tailActivity)*Math.sin(foxLabIdleTime*.62)*.025);
      const idleTailTwitch=(1-tailActivity)*(foxLabIdleTime>1.2?Math.pow(Math.max(0,Math.sin(foxLabIdleTime*.86-i*.29)),7)*.32*distal:0);
      const segmentTarget=clamp(tailTarget+idleTailSag+idleTailTwitch,-1.05,.9);
      const prior=i?foxLabTailAngles[i-1]:segmentTarget;
      const target=i?segmentTarget+(prior-segmentTarget)*mix(.55,.8,ballistic):segmentTarget;
      const stiffness=29-i*2.15,damping=(5.8-i*.36)*(1-.34*ballistic);
      foxLabTailVelocities[i]+=(target-foxLabTailAngles[i])*stiffness*dt;
      foxLabTailVelocities[i]*=Math.exp(-damping*dt);
      foxLabTailAngles[i]=clamp(foxLabTailAngles[i]+foxLabTailVelocities[i]*dt,-.82,.9);
    }
  }

function drawHorse(now,dt=1/60){
    const speed=Math.abs(player.vx),move=smooth(3,42,speed),run=foxLabRunBlend;
    const airborne=!player.grounded,phase=foxLabStridePhase;
    const bounce=player.grounded?Math.sin(phase*2)*move*(.3+run*.8):0;
    const pitch=airborne?clamp(player.vy*.0001,-.09,.09):Math.sin(phase)*run*.025;
    const originX=player.x+player.w/2;
    const groundY=player.y+player.h-3;
    ctx.save();
    ctx.translate(originX,groundY+bounce);
    ctx.scale(player.facing,1);
    ctx.rotate(pitch);

    const coat="#9a5b35",coatLight="#b97748",coatShade="#754126",mane="#33241f",maneLight="#4a3025",hoof="#2c2522";
    const gallop=run;
    const gait=(front,far)=>{
      const walkOffset=front?(far?Math.PI:0):(far?Math.PI*1.5:Math.PI*.5);
      const gallopOffset=front?(far?.48:0):(far?2.1:1.55);
      const off=walkOffset+(Math.atan2(Math.sin(gallopOffset-walkOffset),Math.cos(gallopOffset-walkOffset))*gallop);
      const ph=phase+off;
      const swing=Math.sin(ph),lift=Math.max(0,Math.cos(ph));
      const stride=(4+gallop*11)*move;
      let footX=(front?25:-31)+swing*stride;
      let footLift=lift*(3+gallop*9)*move;
      if(airborne){footLift+=5+Math.max(0,-player.vy)*.008+(front?2:0);footX+=(front?1:-1)*Math.sin(ph)*5;}
      const rootX=front?24:-31,rootY=front?-41:-42;
      let kneeX,kneeY,hockX,hockY;
      if(front){
        kneeX=rootX+3+swing*stride*.38;kneeY=-20-footLift*.2;
        hockX=footX+1;hockY=-4-footLift;
      }else{
        kneeX=-23+swing*stride*.35;kneeY=-21-footLift*.18;
        hockX=-30+swing*stride*.72;hockY=-8-footLift*.72;
      }
      const base=far?"#67442f":coat,shadow=far?"#4c3529":coatShade;
      ctx.save();ctx.globalAlpha=far?.78:1;
      ctx.lineCap="round";ctx.lineJoin="round";
      // Broad upper limb and tapering cannon read as a connected horse leg.
      ctx.strokeStyle=base;ctx.lineWidth=front?11:13;
      ctx.beginPath();ctx.moveTo(rootX,rootY);ctx.quadraticCurveTo((rootX+kneeX)/2-2,(rootY+kneeY)/2-1,kneeX,kneeY);ctx.stroke();
      if(!front){
        ctx.strokeStyle=shadow;ctx.lineWidth=7.2;ctx.beginPath();ctx.moveTo(kneeX,kneeY);ctx.lineTo(hockX,hockY);ctx.stroke();
        ctx.strokeStyle=base;ctx.lineWidth=4.3;ctx.beginPath();ctx.moveTo(hockX,hockY);ctx.lineTo(footX, -2-footLift);ctx.stroke();
      }else{
        ctx.strokeStyle=shadow;ctx.lineWidth=5.2;ctx.beginPath();ctx.moveTo(kneeX,kneeY);ctx.quadraticCurveTo(kneeX+2,(kneeY+hockY)/2,hockX,hockY);ctx.stroke();
        ctx.strokeStyle=base;ctx.lineWidth=4.1;ctx.beginPath();ctx.moveTo(hockX,hockY);ctx.lineTo(footX,-2-footLift);ctx.stroke();
      }
      // Fetlock and solid, squared hoof.
      ctx.fillStyle=base;ctx.beginPath();ctx.ellipse(footX,-3-footLift,3.1,4,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=hoof;ctx.beginPath();ctx.moveTo(footX-4.4,-2-footLift);ctx.lineTo(footX+4.2,-2-footLift);
      ctx.lineTo(footX+3.1,2-footLift);ctx.quadraticCurveTo(footX,3.2-footLift,footX-3.4,2-footLift);ctx.closePath();ctx.fill();
      ctx.restore();
    };

    // Tail and distant legs sit behind the barrel.
    ctx.save();ctx.strokeStyle=mane;ctx.lineCap="round";ctx.lineWidth=5.5;
    ctx.beginPath();ctx.moveTo(-39,-47);ctx.quadraticCurveTo(-52,-37+Math.sin(now*.004)*2,-56,-22+Math.sin(now*.003)*2);ctx.stroke();
    ctx.strokeStyle=maneLight;ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(-42,-44);ctx.quadraticCurveTo(-50,-36+Math.sin(now*.004)*2,-54,-25);ctx.stroke();
    ctx.fillStyle=mane;ctx.beginPath();ctx.moveTo(-56,-24);ctx.quadraticCurveTo(-66,-14,-61,-5);ctx.quadraticCurveTo(-53,-10,-51,-21);ctx.closePath();ctx.fill();
    ctx.restore();
    gait(false,true);gait(true,true);

    // Barrel, rounded croup, chest, and a sloping neck give the horse its silhouette.
    ctx.fillStyle=coat;ctx.beginPath();
    ctx.moveTo(-48,-47);ctx.quadraticCurveTo(-47,-61,-33,-63);ctx.quadraticCurveTo(-18,-67,1,-61);
    ctx.quadraticCurveTo(15,-58,26,-52);ctx.quadraticCurveTo(37,-49,37,-39);
    ctx.quadraticCurveTo(34,-27,20,-24);ctx.quadraticCurveTo(2,-20,-18,-24);
    ctx.quadraticCurveTo(-38,-26,-46,-34);ctx.quadraticCurveTo(-52,-39,-48,-47);ctx.closePath();ctx.fill();
    // Shoulder and hindquarter muscle planes, kept subtle rather than balloon-like.
    ctx.fillStyle=coatLight;ctx.beginPath();ctx.ellipse(-34,-43,13,17,-.22,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=coat;ctx.beginPath();ctx.ellipse(22,-42,11,16,.2,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="rgba(74,37,23,.23)";ctx.beginPath();ctx.moveTo(-33,-28);ctx.quadraticCurveTo(-8,-21,19,-28);ctx.quadraticCurveTo(2,-24,-13,-26);ctx.closePath();ctx.fill();

    // Neck rises from the chest to the poll; the dark crest becomes the mane.
    ctx.fillStyle=coat;ctx.beginPath();ctx.moveTo(16,-51);ctx.quadraticCurveTo(29,-68,40,-86);
    ctx.quadraticCurveTo(46,-92,55,-86);ctx.quadraticCurveTo(55,-72,49,-57);
    ctx.quadraticCurveTo(44,-43,34,-34);ctx.quadraticCurveTo(23,-32,16,-39);ctx.closePath();ctx.fill();
    ctx.fillStyle=coatLight;ctx.beginPath();ctx.moveTo(25,-54);ctx.quadraticCurveTo(35,-70,43,-85);
    ctx.quadraticCurveTo(47,-88,50,-83);ctx.quadraticCurveTo(46,-67,39,-53);ctx.quadraticCurveTo(33,-45,27,-43);ctx.closePath();ctx.fill();

    // Mane follows the neck crest and moves with the stride.
    ctx.fillStyle=mane;ctx.beginPath();ctx.moveTo(31,-65);
    ctx.quadraticCurveTo(37,-79,40,-91);ctx.quadraticCurveTo(47,-87,49,-78);
    ctx.quadraticCurveTo(55,-73,50,-66);ctx.quadraticCurveTo(55,-59,46,-53);
    ctx.quadraticCurveTo(47,-44,38,-42);ctx.quadraticCurveTo(35,-51,31,-65);ctx.closePath();ctx.fill();
    ctx.strokeStyle=maneLight;ctx.lineWidth=2.4;ctx.lineCap="round";
    for(let i=0;i<4;i++){const x=37+i*3;ctx.beginPath();ctx.moveTo(x,-77+i*3);ctx.quadraticCurveTo(x+4,-65+i*2,x+1+Math.sin(now*.004+i)*1.5,-53+i*2);ctx.stroke();}

    // Head with long tapering face, upright ears, soft blaze, and an alert horse eye.
    ctx.fillStyle=coat;ctx.beginPath();ctx.moveTo(43,-86);ctx.quadraticCurveTo(51,-94,59,-87);
    ctx.quadraticCurveTo(64,-80,67,-70);ctx.quadraticCurveTo(75,-68,83,-62);
    ctx.quadraticCurveTo(84,-57,78,-56);ctx.quadraticCurveTo(69,-58,60,-62);
    ctx.quadraticCurveTo(54,-66,51,-75);ctx.quadraticCurveTo(44,-77,43,-86);ctx.closePath();ctx.fill();
    // Two pointed ears, with the far ear behind the poll.
    ctx.fillStyle=coatShade;ctx.beginPath();ctx.moveTo(47,-88);ctx.quadraticCurveTo(45,-101,49,-108);
    ctx.quadraticCurveTo(56,-101,56,-91);ctx.closePath();ctx.fill();
    ctx.fillStyle=coat;ctx.beginPath();ctx.moveTo(53,-88);ctx.quadraticCurveTo(53,-102,59,-108);
    ctx.quadraticCurveTo(64,-100,61,-88);ctx.closePath();ctx.fill();
    ctx.fillStyle="#d49a76";ctx.beginPath();ctx.moveTo(56,-91);ctx.lineTo(59,-103);ctx.lineTo(60,-91);ctx.closePath();ctx.fill();
    // Narrow white star/blaze, broad muzzle, nostril, and readable eye.
    ctx.fillStyle="#ead6ba";ctx.beginPath();ctx.moveTo(53,-87);ctx.quadraticCurveTo(59,-78,65,-68);
    ctx.quadraticCurveTo(61,-67,58,-72);ctx.quadraticCurveTo(54,-80,52,-85);ctx.closePath();ctx.fill();
    ctx.fillStyle=coatLight;ctx.beginPath();ctx.ellipse(77,-61,7,4,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#211a17";ctx.beginPath();ctx.ellipse(81,-62,2.7,2.1,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#211a17";ctx.beginPath();ctx.ellipse(58,-81,1.5,1.8,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#f7e5cc";ctx.beginPath();ctx.ellipse(58.5,-81.7,.55,.6,0,0,Math.PI*2);ctx.fill();

    // Forelegs in front of the chest complete the four-beat cycle.
    gait(false,false);gait(true,false);
    ctx.restore();
  }

function drawFoxLabArena(){
    ctx.fillStyle="#cbd4ce";ctx.fillRect(0,0,W,H);
    for(const s of foxLabSurfaces){ctx.fillStyle=s.ground?"#64716a":"#77827c";ctx.fillRect(s.x,s.y,s.w,s.ground?s.h:14);ctx.fillStyle="#a7b39e";ctx.fillRect(s.x,s.y,s.w,2);}
    ctx.fillStyle="rgba(35,47,43,.78)";ctx.font="700 12px system-ui";ctx.textAlign="left";ctx.fillText("TOXICFOX · WALK  /  RUN  /  TURN  /  JUMP  /  LAND",22,30);
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
      : foxLabRestPose.lie>.55 ? "LYING DOWN" : foxLabRestPose.sit>.55 ? "SITTING" : foxLabInvestigation > .55 ? "INVESTIGATING" : velocity > 175 ? "RUNNING" : velocity > 8 ? "WALKING" : "IDLE";
    status.textContent = `${motion} · ${player.grounded ? "GROUNDED" : "AIRBORNE"}`;
    speedReadout.textContent = `${Math.round(velocity)} px/s`;
    drawFoxLabArena();
    drawHorse(now,dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
