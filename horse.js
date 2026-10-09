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
    const speed=Math.abs(player.vx),move=smooth(5,64,speed),run=foxLabRunBlend;
    const airborne=!player.grounded,phase=foxLabStridePhase,tau=Math.PI*2;
    const bounce=player.grounded?(Math.sin(phase*2-.45)*1.25+Math.max(0,Math.cos(phase-.25))*4.2*run)*move:0;
    const bodyPitch=airborne?clamp(player.vy*.00012,-.1,.1):Math.sin(phase-.2)*run*.018;
    const originX=player.x+player.w/2,groundY=player.y+player.h-2;
    const scale=1.18,coat="#744329",coatMid="#8f5532",coatLight="#b2764d",coatShade="#56301f";
    const mane="#281d19",maneMid="#3a2820",hoof="#282320";
    ctx.save();ctx.translate(originX,groundY+bounce);ctx.scale(player.facing*scale,scale);ctx.rotate(bodyPitch);

    const walkOrder={hindNear:0,foreNear:Math.PI*.5,hindFar:Math.PI,foreFar:Math.PI*1.5};
    const canterOrder={hindNear:0,hindFar:.42,foreFar:1.45,foreNear:2.05};
    const ease=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
    const unit=(x)=>((x%tau)+tau)%tau/tau;

    // A real four-beat walk blends into a three-beat canter, then a suspended gallop.
    const leg=(name,front,far)=>{
      const walk=walkOrder[name],gallop=canterOrder[name];
      const offset=walk+(gallop-walk)*run,cycle=unit(phase+offset);
      const stanceLimit=mix(.68,.39,run);
      let stepX=0,lift=0,kneeFold=0;
      const stride=move*(8+18*run);
      if(move>.015){
        if(cycle<stanceLimit){
          const t=cycle/stanceLimit;
          stepX=stride*(.52-1.08*t);
        }else{
          const t=(cycle-stanceLimit)/(1-stanceLimit),s=ease(t);
          stepX=stride*(-.56+1.08*s);
          lift=Math.sin(Math.PI*t)*move*(front?8+run*17:7+run*14);
          kneeFold=Math.sin(Math.PI*t)*(front?.23:.30)*(1+run*.65);
        }
      }
      if(airborne){
        const tuck=clamp(1-Math.abs(player.vy)/560,0,1);
        lift+=5+tuck*5+(front?2:0);
        stepX+=(front?1:-1)*(4+tuck*5);
        kneeFold+=tuck*.26;
      }
      const hipX=front?27:-34,hipY=front?-57:-58;
      const ankleX=hipX+stepX+(front?0:-2);
      const ankleY=-3-lift;
      const legBase=far?"#563d30":coatMid;
      const legShade=far?"#3f2e25":coatShade;
      let kneeX,kneeY,hockX,hockY;
      if(front){
        kneeX=hipX+4+stepX*.38+(far?-1:1)*2;
        kneeY=-28-lift*.2-kneeFold*8;
        hockX=ankleX+1;
        hockY=-8-lift*.78;
      }else{
        kneeX=-23+stepX*.3+(far?-1:1)*1.4;
        kneeY=-30-lift*.18-kneeFold*7;
        hockX=-39+stepX*.68+kneeFold*6;
        hockY=-18-lift*.68;
      }
      ctx.save();ctx.globalAlpha=far?.82:1;ctx.lineCap="round";ctx.lineJoin="round";
      // Muscular upper limb with a clear elbow/stifle and narrow cannon.
      ctx.strokeStyle=legBase;ctx.lineWidth=front?12.6:15.5;
      ctx.beginPath();ctx.moveTo(hipX,hipY);
      if(front)ctx.quadraticCurveTo(hipX-2,kneeY+7,kneeX,kneeY);
      else ctx.quadraticCurveTo(hipX+1,kneeY+4,kneeX,kneeY);
      ctx.stroke();
      if(!front){
        ctx.strokeStyle=legShade;ctx.lineWidth=7.4;
        ctx.beginPath();ctx.moveTo(kneeX,kneeY);ctx.quadraticCurveTo(kneeX-3,hockY+5,hockX,hockY);ctx.stroke();
      }else{
        ctx.strokeStyle=legShade;ctx.lineWidth=5.8;
        ctx.beginPath();ctx.moveTo(kneeX,kneeY);ctx.quadraticCurveTo(kneeX+1,(kneeY+hockY)*.5,hockX,hockY);ctx.stroke();
      }
      ctx.strokeStyle=legBase;ctx.lineWidth=4.9;
      ctx.beginPath();ctx.moveTo(hockX,hockY);ctx.quadraticCurveTo((hockX+ankleX)*.5,-5-lift*.32,ankleX,ankleY);ctx.stroke();
      // Fetlock and broad, hard hoof; the toe points forward.
      ctx.fillStyle=legBase;ctx.beginPath();ctx.ellipse(ankleX,ankleY+1,3.7,5,0,0,tau);ctx.fill();
      ctx.fillStyle=hoof;ctx.beginPath();ctx.moveTo(ankleX-4.2,ankleY+1);
      ctx.quadraticCurveTo(ankleX,ankleY-1,ankleX+5,ankleY+.5);
      ctx.lineTo(ankleX+6,ankleY+5);ctx.quadraticCurveTo(ankleX+1,ankleY+7,ankleX-4,ankleY+5);
      ctx.closePath();ctx.fill();
      if(!far&&front){ctx.fillStyle="#ead8c4";ctx.beginPath();ctx.moveTo(ankleX-3,ankleY+3);ctx.lineTo(ankleX+4,ankleY+3);ctx.lineTo(ankleX+4.5,ankleY+1);ctx.lineTo(ankleX-3,ankleY+1);ctx.closePath();ctx.fill();}
      ctx.restore();
    };

    // Tail, then far-side limbs.
    const tailWave=Math.sin(now*.0035+phase*.35)*5+Math.sin(phase*.8)*run*3;
    ctx.strokeStyle=mane;ctx.lineWidth=7;ctx.lineCap="round";
    ctx.beginPath();ctx.moveTo(-43,-60);ctx.bezierCurveTo(-55,-49,-57+tailWave,-31,-63+tailWave,-15);ctx.stroke();
    ctx.strokeStyle=maneMid;ctx.lineWidth=4;
    ctx.beginPath();ctx.moveTo(-46,-56);ctx.quadraticCurveTo(-58+tailWave,-35,-60+tailWave,-19);ctx.stroke();
    ctx.fillStyle=mane;ctx.beginPath();ctx.moveTo(-63+tailWave,-18);
    ctx.quadraticCurveTo(-72+tailWave,-7,-68+tailWave,1);ctx.quadraticCurveTo(-60+tailWave,-3,-57+tailWave,-14);ctx.closePath();ctx.fill();
    leg("hindFar",false,true);leg("foreFar",true,true);

    // Deep barrel, rounded croup, withers, and shoulder. The back line stays horse-shaped through the gait.
    ctx.fillStyle=coat;ctx.beginPath();ctx.moveTo(-51,-64);
    ctx.quadraticCurveTo(-55,-79,-42,-84);ctx.quadraticCurveTo(-31,-90,-15,-84);
    ctx.quadraticCurveTo(1,-81,15,-79);ctx.quadraticCurveTo(25,-80,33,-70);
    ctx.quadraticCurveTo(41,-61,39,-51);ctx.quadraticCurveTo(36,-40,24,-36);
    ctx.quadraticCurveTo(7,-31,-13,-35);ctx.quadraticCurveTo(-34,-35,-47,-47);
    ctx.quadraticCurveTo(-55,-54,-51,-64);ctx.closePath();ctx.fill();
    // Croup and shoulder planes give the torso depth instead of the fox-like narrow tube.
    ctx.fillStyle=coatMid;ctx.beginPath();ctx.moveTo(-49,-65);ctx.quadraticCurveTo(-44,-82,-32,-82);
    ctx.quadraticCurveTo(-23,-80,-21,-66);ctx.quadraticCurveTo(-20,-52,-30,-40);
    ctx.quadraticCurveTo(-43,-41,-49,-54);ctx.closePath();ctx.fill();
    ctx.fillStyle=coatLight;ctx.beginPath();ctx.moveTo(9,-75);ctx.quadraticCurveTo(23,-77,32,-67);
    ctx.quadraticCurveTo(39,-59,34,-47);ctx.quadraticCurveTo(28,-39,18,-39);
    ctx.quadraticCurveTo(23,-56,9,-75);ctx.closePath();ctx.fill();
    ctx.fillStyle="rgba(48,27,18,.28)";ctx.beginPath();ctx.moveTo(-38,-40);
    ctx.quadraticCurveTo(-8,-33,22,-43);ctx.quadraticCurveTo(3,-36,-15,-39);ctx.closePath();ctx.fill();

    // Long sloped neck joins the chest to a high poll, with a curved equine crest.
    ctx.fillStyle=coat;ctx.beginPath();ctx.moveTo(17,-75);ctx.quadraticCurveTo(31,-91,43,-111);
    ctx.quadraticCurveTo(49,-122,59,-117);ctx.quadraticCurveTo(64,-109,59,-94);
    ctx.quadraticCurveTo(54,-75,45,-61);ctx.quadraticCurveTo(39,-51,30,-48);
    ctx.quadraticCurveTo(19,-52,14,-62);ctx.closePath();ctx.fill();
    ctx.fillStyle=coatLight;ctx.beginPath();ctx.moveTo(26,-72);ctx.quadraticCurveTo(40,-94,51,-113);
    ctx.quadraticCurveTo(56,-117,58,-109);ctx.quadraticCurveTo(52,-89,42,-69);
    ctx.quadraticCurveTo(36,-59,28,-57);ctx.closePath();ctx.fill();

    // Mane forms one continuous dark crest and individual locks that stream during a canter.
    ctx.fillStyle=mane;ctx.beginPath();ctx.moveTo(34,-89);ctx.quadraticCurveTo(43,-106,48,-121);
    ctx.quadraticCurveTo(57,-127,61,-117);ctx.quadraticCurveTo(64,-107,58,-98);
    ctx.quadraticCurveTo(64,-91,56,-83);ctx.quadraticCurveTo(58,-73,49,-68);
    ctx.quadraticCurveTo(43,-77,34,-89);ctx.closePath();ctx.fill();
    ctx.strokeStyle=maneMid;ctx.lineWidth=2.5;ctx.lineCap="round";
    for(let i=0;i<5;i++){
      const x=42+i*2.3,wave=Math.sin(now*.004+i*.8+phase*.3)*(1+run*2);
      ctx.beginPath();ctx.moveTo(x,-105+i*2);ctx.quadraticCurveTo(x+5+wave,-91+i*4,x+wave,-75+i*2);ctx.stroke();
    }

    // Compact head, long tapered face, broad muzzle, nostril, and alert horse eye.
    const headNod=Math.sin(phase*.8-.8)*move*.035+(airborne?clamp(player.vy*.00008,-.06,.06):0);
    ctx.save();ctx.translate(0,0);ctx.rotate(headNod);
    ctx.fillStyle=coat;ctx.beginPath();ctx.moveTo(51,-116);
    ctx.quadraticCurveTo(59,-125,68,-118);ctx.quadraticCurveTo(76,-111,75,-101);
    ctx.quadraticCurveTo(76,-90,85,-77);ctx.quadraticCurveTo(96,-74,102,-68);
    ctx.quadraticCurveTo(103,-63,96,-61);ctx.quadraticCurveTo(85,-61,77,-68);
    ctx.quadraticCurveTo(66,-75,63,-88);ctx.quadraticCurveTo(55,-99,51,-116);ctx.closePath();ctx.fill();
    // Slender upright ears and a forward forelock break the canine silhouette.
    ctx.fillStyle=coatShade;ctx.beginPath();ctx.moveTo(55,-116);ctx.quadraticCurveTo(51,-130,55,-139);
    ctx.quadraticCurveTo(62,-131,63,-119);ctx.closePath();ctx.fill();
    ctx.fillStyle=coatMid;ctx.beginPath();ctx.moveTo(62,-116);ctx.quadraticCurveTo(64,-130,72,-136);
    ctx.quadraticCurveTo(75,-126,70,-115);ctx.closePath();ctx.fill();
    ctx.fillStyle="#d3a58d";ctx.beginPath();ctx.moveTo(66,-119);ctx.lineTo(71,-131);ctx.lineTo(69,-118);ctx.closePath();ctx.fill();
    ctx.fillStyle=mane;ctx.beginPath();ctx.moveTo(50,-118);ctx.quadraticCurveTo(56,-128,67,-121);
    ctx.quadraticCurveTo(65,-113,60,-108);ctx.quadraticCurveTo(54,-111,50,-118);ctx.closePath();ctx.fill();
    // Narrow blaze from forehead toward the nose, a soft muzzle, and small nostril.
    ctx.fillStyle="#e9d7c0";ctx.beginPath();ctx.moveTo(66,-116);ctx.quadraticCurveTo(70,-103,77,-86);
    ctx.quadraticCurveTo(79,-78,84,-72);ctx.quadraticCurveTo(80,-71,76,-78);
    ctx.quadraticCurveTo(68,-93,64,-110);ctx.closePath();ctx.fill();
    ctx.fillStyle=coatLight;ctx.beginPath();ctx.ellipse(96,-66,7.2,4.4,-.08,0,tau);ctx.fill();
    ctx.fillStyle="#201816";ctx.beginPath();ctx.ellipse(99,-67,2.1,1.6,0,0,tau);ctx.fill();
    ctx.fillStyle="#241915";ctx.beginPath();ctx.ellipse(68,-107,1.8,2.1,0,0,tau);ctx.fill();
    ctx.fillStyle="#f3dfc7";ctx.beginPath();ctx.ellipse(68.6,-107.8,.65,.7,0,0,tau);ctx.fill();
    ctx.restore();

    // Near-side limbs overlap the barrel at their shoulders and complete the four-beat gait.
    leg("hindNear",false,false);leg("foreNear",true,false);
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
