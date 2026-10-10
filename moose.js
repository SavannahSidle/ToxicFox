(() => {
  "use strict";
  // Moose: heavier shoulder hump, long ungulate legs, blunt muzzle, dewlap, palmate antlers, and short tail. Fox Three remains preserved.
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
  let foxLabStrideLength = 22, foxLabTrotBlend = 0, foxLabRunBlend = 0, foxLabGallopBlend = 0;
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
  // Walk order stays four-beat; the fast gait gathers the hind limbs then drives through the forelimbs.
  const foxLabLegConfigs=[
    {hip:-47,front:false,far:true,walk:Math.PI,trot:0,upper:40,lower:29,toeX:2,toeY:22.5,bend:-1},
    {hip:17,front:true,far:true,walk:Math.PI*1.5,trot:Math.PI,upper:38,lower:31,toeX:1.4,toeY:8.5,bend:1},
    {hip:-48,front:false,far:false,walk:0,trot:Math.PI,upper:40,lower:29,toeX:2,toeY:22.5,bend:-1},
    {hip:31,front:true,far:false,walk:Math.PI*.5,trot:0,upper:38,lower:31,toeX:1.4,toeY:8.5,bend:1}
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
    if(event.code==="KeyX")foxLabRestTarget=foxLabRestTarget===1?0:1;
    if(event.code==="KeyZ")foxLabRestTarget=foxLabRestTarget===2?0:2;
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
    const nextTrot=smooth(55,145,currentSpeed),nextRun=smooth(135,250,currentSpeed),nextGallop=smooth(140,225,currentSpeed);
    foxLabTrotBlend+=(nextTrot-foxLabTrotBlend)*(1-Math.exp(-5.5*dt));
    foxLabRunBlend+=(nextRun-foxLabRunBlend)*(1-Math.exp(-4.2*dt));
    foxLabGallopBlend+=(nextGallop-foxLabGallopBlend)*(1-Math.exp(-5.2*dt));
    // Give every gait a longer stride span while keeping walk, trot, and run speed-blended.
    const walkStride=36+currentSpeed*.24;
    const fasterStride=mix(52+currentSpeed*.23,92+currentSpeed*.2,foxLabRunBlend);
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
    const waistY=(ribY-pelvisY)*.38+lumbarWave*(trot*.58+run*2.05+foxLabGallopBlend*3.2)*moveBlend+foxLabJumpAnticipation*.72-jumpStretch*2.1-jumpDrive*1.1+jumpApex*.85+jumpDescend*1.15-jumpArch*8.2+foxLabLandingImpact*.94
      +pose.runGather*.8-pose.runExtension*.55+pose.jumpLoad*.7-pose.jumpDrive*.45+pose.jumpApex*.3+pose.jumpLanding*.8+foxLabRestPose.sit*2+foxLabRestPose.lie*4;
    const waistAngle=(ribAngle-pelvisAngle)*.5+lumbarWave*(trot*.017+run*.071+foxLabGallopBlend*.13)*moveBlend+foxLabJumpAnticipation*.038-jumpStretch*.135-jumpDrive*.06+jumpApex*.075+jumpDescend*.095-jumpArch*.16+foxLabLandingImpact*.05
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

function drawFox(now,dt=1/60){
    const speed=Math.abs(player.vx),move=smooth(4,58,speed),trot=foxLabTrotBlend,run=foxLabRunBlend,sit=foxLabRestPose.sit,lie=foxLabRestPose.lie;
    const airborne=!player.grounded,phase=foxLabStridePhase,impact=foxLabLandingImpact,investigate=foxLabInvestigation;
    const launch=airborne?smooth(0,145,now-(foxLabTakeoffUntil-145)):0;
    const jumpHeadPitch=airborne?.24+foxLabPose.jumpDrive*.12+foxLabPose.jumpExtension*.06+foxLabPose.jumpLanding*.05:0;
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
    const bodyLift=8;
    const rise=8+bodyLift+compress*.8+launch*1.2-investigate*1.5+breathe-sit*4.5-lie*7;
    const footLine=player.h/2-2+rise-bounce-impact*5-verticalMotion-anticipation*3+recovery*2.6;
    const turnDelta=foxLabTurnTo-foxLabTurnFrom,turnWave=turnPulse(.03,.98)*turnDelta;
    // A 2D mirror is discrete. Interpolating its scale through zero collapses every bone mid-turn.
    const fwd=player.facing;
    const turnLean=turnPulse(.18,.84)*turnDelta*.052;
    const originX=player.x+player.w/2,originY=player.y+player.h/2+bounce+impact*5+verticalMotion+anticipation*3-recovery*2.6-rise;
    // Flipping and rotation preserve segment lengths; gait squash must not scale the skeleton.
    const scaleX=fwd,scaleY=1,bodyAngle=pitch*.34+turnLean*.5-sit*.035+lie*.022;
    const localToWorld=(x,y)=>({x:originX+scaleX*(x*Math.cos(bodyAngle)-y*Math.sin(bodyAngle)),y:originY+scaleY*(x*Math.sin(bodyAngle)+y*Math.cos(bodyAngle))});
    const worldToLocal=(x,y)=>{const dx=(x-originX)/scaleX,dy=(y-originY)/scaleY;return{x:dx*Math.cos(bodyAngle)+dy*Math.sin(bodyAngle),y:-dx*Math.sin(bodyAngle)+dy*Math.cos(bodyAngle)};};
    ctx.save();ctx.translate(originX,originY);ctx.scale(scaleX,scaleY);ctx.rotate(bodyAngle);

    // Moose tail: a short dark tuft, kept separate from the fox's articulated brush.
    const tailBaseX=-54+foxLabSpine.pelvisX,tailBaseY=foxLabSpine.pelvisY;
    ctx.fillStyle="#30261f";ctx.beginPath();ctx.moveTo(tailBaseX,tailBaseY-2);
    ctx.quadraticCurveTo(tailBaseX-5,tailBaseY-5,tailBaseX-9,tailBaseY-1);
    ctx.quadraticCurveTo(tailBaseX-14,tailBaseY+5,tailBaseX-11,tailBaseY+12);
    ctx.quadraticCurveTo(tailBaseX-8,tailBaseY+16,tailBaseX-4,tailBaseY+10);
    ctx.quadraticCurveTo(tailBaseX-1,tailBaseY+6,tailBaseX,tailBaseY+1);ctx.closePath();ctx.fill();
    ctx.strokeStyle="#725a43";ctx.lineWidth=1.25;ctx.lineCap="round";ctx.beginPath();
    ctx.moveTo(tailBaseX-8,tailBaseY+8);ctx.quadraticCurveTo(tailBaseX-9,tailBaseY+11,tailBaseX-8,tailBaseY+13);ctx.stroke();

    // Muscled, three-part limbs: shoulder/hip, elbow/knee, wrist/hock, then a small planted paw.
    const limb=index=>{
      const config=foxLabLegConfigs[index],front=config.front,far=config.far;
      const walkTrotPhase=gaitPhase(config.walk,config.trot),gallopPhase=foxLabStridePhase+(front?Math.PI:0)+(far?.18:0),phaseDelta=Math.atan2(Math.sin(gallopPhase-walkTrotPhase),Math.cos(gallopPhase-walkTrotPhase)),forePhase=walkTrotPhase+phaseDelta*foxLabGallopBlend,walkScapula=front?Math.sin(forePhase)*2.4*move*(1-run):0;
      const shoulderGlide=front?(foxLabPose.runContact*.55-foxLabPose.runExtension*.42+foxLabPose.jumpDrive*.38-foxLabPose.jumpLanding*.28+walkScapula):0;
      const hip=config.hip+(front?foxLabSpine.ribX+shoulderGlide:foxLabSpine.pelvisX+foxLabPose.runDrive*.22),rootY=front?foxLabSpine.ribY+foxLabPose.runContact*.32+foxLabPose.jumpLanding*.38-3+bodyLift:foxLabSpine.pelvisY+foxLabPose.runGather*.32-6.5+bodyLift;
      const p=((forePhase%(Math.PI*2))+Math.PI*2)%(Math.PI*2),stanceSpan=Math.PI*mix(1.17,.8,foxLabGallopBlend),swingSpan=Math.PI*2-stanceSpan,stance=p<stanceSpan;
      const t=stance?p/stanceSpan:(p-stanceSpan)/swingSpan;
      const swing=cubic(t),reach=mix(.38,.25,run)*(front?mix(1.2,1.06,run):1.28),hindSwing=-reach+2*reach*swing-.07*reach*Math.sin(2*Math.PI*t),travel=stance?reach-2*reach*t:(front?-reach+2*reach*swing:hindSwing),lift=stance?0:(front?2.4:2.75)*t*(1-t);
      const restingOffset=front?(far?-2.2:1.8):(far?2.4:-1.8);
      let pawX=hip+travel*stride*move+restingOffset*(1-move),pawY=footLine-lift*(5+run*10)*move;
      if(!airborne){const restFold=Math.max(sit,lie),foldedX=front?hip+restingOffset:hip+10*sit+7*lie;pawX=mix(pawX,foldedX,restFold);}
      if(airborne){
        const descending=smooth(-80,430,player.vy);
        const tuck=clamp(1-Math.abs(player.vy)/560,0,1);
        const reach=front?mix(16,13,descending)-tuck*10:mix(-17,-13,descending)+tuck*13;
        const lift=(1-descending)*(front?5+launch*3:4+launch*2)+tuck*4;
        pawX=hip+reach;
        pawY=footLine-lift;
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
      const color=far?"#382d27":"#594130",alpha=far?.78:1;
      const bone=(ax,ay,bx,by,wide,thin,fur=0)=>{const dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;ctx.beginPath();ctx.moveTo(ax+nx*wide,ay+ny*wide);if(fur){for(const t of [.2,.34,.39,.48,.53,.63,.68,.82,1]){const w=wide*(1-t)+thin*t,tuft=t===.39?fur:t===.68?fur*.72:0;ctx.lineTo(ax+dx*t+nx*(w+tuft),ay+dy*t+ny*(w+tuft));}}else ctx.quadraticCurveTo((ax+bx)/2+nx*(wide+thin)*.24,(ay+by)/2+ny*(wide+thin)*.24,bx+nx*thin,by+ny*thin);ctx.lineTo(bx-nx*thin,by-ny*thin);ctx.quadraticCurveTo((ax+bx)/2-nx*(wide+thin)*.24,(ay+by)/2-ny*(wide+thin)*.24,ax-nx*wide,ay-ny*wide);ctx.closePath();ctx.fill();};
      ctx.globalAlpha=alpha;ctx.fillStyle=!front?(far?"#382d27":"#594130"):color;
      bone(hip,rootY,jointX,jointY,front?(far?3.15:4.2):(far?4.2:5.4),front?(far?2.4:3.1):(far?3.1:4.1),.55);
      ctx.fillStyle="#6b4d39";
      ctx.fillStyle=far?"#2a201c":"#342820";
      bone(jointX,jointY,midX,midY,front?(far?3.05:4.05):(far?3.35:4.3),front?(far?2.35:3):(far?2.55:3.1),0);
      ctx.fillStyle=far?"#2a201c":"#342820";
      bone(midX,midY,pawX,pawY,far?2.05:2.35,far?1.6:1.85,0);
      if(!front){
        const thighDx=jointX-hip,thighDy=jointY-rootY,thighLength=Math.hypot(thighDx,thighDy),thighAngle=Math.atan2(thighDy,thighDx);
        ctx.save();ctx.translate(hip+thighDx*.34,rootY+thighDy*.34);ctx.rotate(thighAngle);
        ctx.fillStyle=far?"#4d382b":"#644832";ctx.beginPath();ctx.moveTo(-thighLength*.54,0);
        // A narrow muscular wedge tapers from the hip toward the stifle.
        ctx.quadraticCurveTo(-thighLength*.32,-8.4,-thighLength*.08,-11.5);
        ctx.quadraticCurveTo(thighLength*.24,-8.8,thighLength*.52,-3.4);
        ctx.quadraticCurveTo(thighLength*.63,-1.2,thighLength*.64,0);
        ctx.quadraticCurveTo(thighLength*.40,4.8,thighLength*.08,8.6);
        ctx.quadraticCurveTo(-thighLength*.30,5.8,-thighLength*.54,0);ctx.closePath();ctx.fill();ctx.restore();
      }
      // No circular joint markers: limb segments meet with a continuous fur silhouette.
      ctx.fillStyle=far?"#211a17":"#352019";ctx.beginPath();ctx.ellipse(pawX+1.5,pawY,3.65,1.95,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
    };
    // Walk blends into a bounding gallop: hind limbs drive together, forelimbs reach, and a brief flight phase opens.
    limb(0);
    limb(1);

    // Deform each trunk region around its own delayed anchor so the back line bends continuously.
    const spinePoint=(x,y)=>{
      // Keep the torso contour at its authored length; limb reach remains controlled by the fixed skeleton.
      const transform=(pivotX,shiftX,shiftY,angle)=>{const dx=x-pivotX,dy=y,c=Math.cos(angle),s=Math.sin(angle);return[pivotX+shiftX+dx*c-dy*s,shiftY+dx*s+dy*c];};
      const pelvis=transform(-29,foxLabSpine.pelvisX,foxLabSpine.pelvisY,foxLabSpine.pelvisAngle);
      const waist=transform(-4,(foxLabSpine.pelvisX+foxLabSpine.ribX)*.18,foxLabSpine.waistY,foxLabSpine.waistAngle);
      const rib=transform(20,foxLabSpine.ribX,foxLabSpine.ribY,foxLabSpine.ribAngle);
      const mixPoint=(a,b,t)=>[mix(a[0],b[0],t),mix(a[1],b[1],t)];
      return mixPoint(mixPoint(pelvis,waist,smooth(-20,-8,x)),rib,smooth(6,18,x));
    };
    const spineOutline=[[-46,-2],[-44,-8],[-39,-12],[-33,-13],[-27,-13],[-19,-14],[-10,-16],[-2,-18],[7,-18],[16,-21],[25,-26],[34,-28],[40,-23],[44,-12],[42,0],[39,5],[34,8],[27,10],[18,11],[9,10],[0,8],[-10,7],[-19,8],[-27,9],[-32,8],[-37,6],[-43,2]].map(([x,y])=>spinePoint(x*1.32,y*1.42));
    const foxThreeCoat=ctx.createLinearGradient(-52,-20,55,18);
    foxThreeCoat.addColorStop(0,"#715840");foxThreeCoat.addColorStop(.48,"#594130");foxThreeCoat.addColorStop(1,"#3e3028");
    ctx.fillStyle=foxThreeCoat;ctx.beginPath();ctx.moveTo(...spineOutline[0]);
    for(let i=0;i<spineOutline.length;i++){const a=spineOutline[i],b=spineOutline[(i+1)%spineOutline.length];ctx.quadraticCurveTo(...a,(a[0]+b[0])*.5,(a[1]+b[1])*.5);}ctx.closePath();ctx.fill();
    limb(2);

    // A thick sloped neck flows into the moose shoulder and blunt head.
    const neckPath=new Path2D();
    neckPath.moveTo(...spinePoint(18,-5));
    neckPath.quadraticCurveTo(...spinePoint(25,-21),...spinePoint(32,-32));
    neckPath.quadraticCurveTo(...spinePoint(35,-38),...spinePoint(38,-42));
    neckPath.quadraticCurveTo(...spinePoint(40,-45),...spinePoint(43,-44));
    neckPath.quadraticCurveTo(...spinePoint(46,-42),...spinePoint(47,-38));
    neckPath.quadraticCurveTo(...spinePoint(48,-30),...spinePoint(48,-22));
    neckPath.quadraticCurveTo(...spinePoint(49,-12),...spinePoint(46,-4));
    neckPath.quadraticCurveTo(...spinePoint(41,-2),...spinePoint(33,0));
    neckPath.quadraticCurveTo(...spinePoint(27,-4),...spinePoint(22,-5));
    neckPath.quadraticCurveTo(...spinePoint(18,-5),...spinePoint(18,-5));
    neckPath.closePath();
    ctx.fillStyle=foxThreeCoat;ctx.fill(neckPath);

    // The cream bib is a coat marking clipped to the connected torso/neck silhouette.
    const coatClip=new Path2D();
    coatClip.moveTo(...spineOutline[0]);
    for(let i=0;i<spineOutline.length;i++){const a=spineOutline[i],b=spineOutline[(i+1)%spineOutline.length];coatClip.quadraticCurveTo(...a,(a[0]+b[0])*.5,(a[1]+b[1])*.5);}
    coatClip.closePath();coatClip.addPath(neckPath);
    const throatPatch=new Path2D();
    throatPatch.moveTo(...spinePoint(37,-42+investigate*2));
    throatPatch.quadraticCurveTo(...spinePoint(41,-44+investigate*2),...spinePoint(45,-42));
    throatPatch.quadraticCurveTo(...spinePoint(47,-37),...spinePoint(46,-29));
    throatPatch.quadraticCurveTo(...spinePoint(47,-14),...spinePoint(47,1));
    throatPatch.quadraticCurveTo(...spinePoint(45,11),...spinePoint(38,15));
    throatPatch.quadraticCurveTo(...spinePoint(27,14),...spinePoint(12,10));
    throatPatch.quadraticCurveTo(...spinePoint(10,3),...spinePoint(17,-6));
    throatPatch.quadraticCurveTo(...spinePoint(24,-21),...spinePoint(32,-32));
    throatPatch.quadraticCurveTo(...spinePoint(34,-37),...spinePoint(37,-42+investigate*2));
    throatPatch.closePath();
    // Clip the cream chest marking cleanly to the connected body and neck.
    ctx.save();ctx.clip(coatClip);ctx.fillStyle="#8a7157";ctx.fill(throatPatch);ctx.restore();
    // The hanging throat bell (dewlap) breaks the fox-like neck line.
    const dewlap=new Path2D();
    dewlap.moveTo(...spinePoint(39,3));
    dewlap.quadraticCurveTo(...spinePoint(46,8),...spinePoint(47,17));
    dewlap.quadraticCurveTo(...spinePoint(47,28),...spinePoint(42,31));
    dewlap.quadraticCurveTo(...spinePoint(38,27),...spinePoint(37,17));
    dewlap.quadraticCurveTo(...spinePoint(35,9),...spinePoint(33,7));
    dewlap.closePath();ctx.fillStyle="#49372b";ctx.fill(dewlap);
    ctx.strokeStyle="rgba(162,132,96,.62)";ctx.lineWidth=1;ctx.beginPath();
    ctx.moveTo(...spinePoint(42,13));ctx.quadraticCurveTo(...spinePoint(45,22),...spinePoint(42,27));ctx.stroke();
    // Draw the near foreleg once, on top of the chest marking, so it stays visible.
    limb(3);

    ctx.save();ctx.translate(39+foxLabSpine.ribX*.55+turnWave*1.4,-34+foxLabSpine.headY+shoulderMotion*.12);ctx.rotate(-pitch*.48-foxLabSpine.ribAngle*.45-foxLabSpine.waistAngle*.28+investigate*.18+Math.max(0,player.vy)*.000035+foxLabSpine.neckAngle+turnWave*.045+jumpHeadPitch);ctx.translate(-34,16);
    // Moose proportions: enlarge the skull, ears, muzzle, and eyes while keeping the antlers broad.
    ctx.save();ctx.translate(43,-20);ctx.scale(1.22,1.24);ctx.translate(-43,20);
    const idleTwitch=foxLabIdleTime>2.5&&Math.sin(foxLabIdleTime*2.1)>.975?1:0,jumpEarBack=airborne?.1+foxLabPose.jumpDrive*.16+foxLabPose.jumpExtension*.06+foxLabPose.jumpLanding*.07:0,earBack=investigate*.75+run*.14+jumpEarBack+clamp(foxLabBodyAcceleration/1100,0,1)*.035+Math.sin(phase*.5)*move*.1+Math.sin(now*.0011)*.025+idleTwitch*.09+foxLabEar.angle;
    const earFlickFar=foxLabIdleTime>1?Math.pow(Math.max(0,Math.sin(foxLabIdleTime*.93)),7)*.29:0,earFlickNear=foxLabIdleTime>1.4?Math.pow(Math.max(0,Math.sin(foxLabIdleTime*.76+1.2)),7)*.25:0;
    const ear=(x,len,angle,{inner=false,outer="#7f6248"}={})=>{const tipLagX=clamp(foxLabEar.angle-foxLabEarTip.angle,-.12,.12)*len*.38;ctx.save();ctx.translate(x,-25);ctx.rotate(angle);ctx.fillStyle=outer;ctx.beginPath();ctx.moveTo(-5.5,3);ctx.quadraticCurveTo(-8+tipLagX*.35,-len*.54,-5+tipLagX,-len*.82);ctx.quadraticCurveTo(-2+tipLagX*.4,-len,4+tipLagX,-len*.82);ctx.quadraticCurveTo(10+tipLagX*.65,-len*.54,8,3);ctx.closePath();ctx.fill();if(inner){ctx.fillStyle="#332820";ctx.beginPath();ctx.moveTo(-1.8,0);ctx.quadraticCurveTo(-2.5+tipLagX*.2,-len*.46,-.7+tipLagX*.7,-len*.76);ctx.quadraticCurveTo(2.7+tipLagX*.5,-len*.56,3.7,1);ctx.closePath();ctx.fill();ctx.strokeStyle="rgba(241,177,135,.7)";ctx.lineWidth=.65;ctx.beginPath();ctx.moveTo(-.5,-3);ctx.quadraticCurveTo(.2,-len*.4,1.4,-len*.66);ctx.stroke();}ctx.restore();};
    // Wide palmate moose antlers, with the far paddle tucked behind the skull.
    const drawPaddleAntler=(side,scale,color)=>{
      ctx.save();ctx.translate(37,-27);ctx.scale(side*scale,scale);
      ctx.fillStyle=color;ctx.strokeStyle="#a48a68";ctx.lineWidth=.8;ctx.lineJoin="round";
      ctx.beginPath();ctx.moveTo(0,4);
      ctx.quadraticCurveTo(-7,-8,-11,-19);ctx.quadraticCurveTo(-19,-24,-31,-28);
      ctx.quadraticCurveTo(-44,-33,-47,-41);ctx.quadraticCurveTo(-49,-48,-43,-50);
      ctx.quadraticCurveTo(-38,-51,-33,-45);ctx.lineTo(-27,-38);
      ctx.quadraticCurveTo(-33,-51,-34,-59);ctx.quadraticCurveTo(-34,-67,-28,-68);
      ctx.quadraticCurveTo(-23,-68,-22,-61);ctx.lineTo(-20,-48);
      ctx.quadraticCurveTo(-20,-62,-16,-72);ctx.quadraticCurveTo(-12,-79,-7,-75);
      ctx.quadraticCurveTo(-3,-72,-7,-64);ctx.lineTo(-10,-49);
      ctx.quadraticCurveTo(-4,-59,3,-63);ctx.quadraticCurveTo(10,-66,12,-60);
      ctx.quadraticCurveTo(13,-55,6,-51);ctx.lineTo(0,-43);
      ctx.quadraticCurveTo(10,-52,19,-53);ctx.quadraticCurveTo(27,-53,27,-47);
      ctx.quadraticCurveTo(26,-42,18,-39);ctx.lineTo(9,-33);
      ctx.quadraticCurveTo(20,-39,30,-38);ctx.quadraticCurveTo(38,-36,36,-30);
      ctx.quadraticCurveTo(34,-25,25,-23);ctx.quadraticCurveTo(14,-20,9,-10);
      ctx.lineTo(6,4);ctx.closePath();ctx.fill();ctx.stroke();
      ctx.strokeStyle="rgba(224,204,169,.46)";ctx.lineWidth=.65;ctx.beginPath();
      ctx.moveTo(-8,-17);ctx.quadraticCurveTo(-16,-30,-30,-34);
      ctx.moveTo(-8,-27);ctx.quadraticCurveTo(-18,-43,-23,-57);
      ctx.moveTo(-5,-32);ctx.quadraticCurveTo(5,-44,18,-46);ctx.stroke();
      ctx.restore();
    };
    drawPaddleAntler(-1,.78,"#514334");
    drawPaddleAntler(1,1,"#69543b");
    // Far ear is drawn first so the raised skull naturally occludes its inner side.
    ear(24,37,-.25-earBack*1.45-earFlickFar,{outer:"#2a201c"});
    // One compact skull/cheek mass creates a readable facial plane behind the projecting muzzle.
    ctx.fillStyle="#94765a";ctx.beginPath();
    ctx.moveTo(23,-18);ctx.quadraticCurveTo(24,-26,34,-29);
    ctx.quadraticCurveTo(42,-32,49,-27);ctx.quadraticCurveTo(54,-23,53,-18);
    ctx.quadraticCurveTo(52,-13,46,-11);ctx.quadraticCurveTo(39,-9,34,-12);
    ctx.quadraticCurveTo(28,-13,25,-18);ctx.closePath();ctx.fill();
    // Near ear sits over the skull and retains the visible inner surface.
    ear(31,41,-.04-earBack*1.35+earFlickNear,{inner:true,outer:"#342820"});
    const idleSniff=player.grounded&&speed<9?Math.pow(Math.max(0,Math.sin(now*.0016)),10):0;
    const muzzleDip=investigate*3.5+idleSniff*1.15;
    // A long, deep, blunt moose muzzle with a broad, soft upper lip.
    ctx.fillStyle="#806247";ctx.beginPath();ctx.moveTo(42,-20+muzzleDip);
    ctx.quadraticCurveTo(50,-31+muzzleDip,63,-29+muzzleDip);
    ctx.quadraticCurveTo(79,-27+muzzleDip,91,-17+muzzleDip);
    ctx.quadraticCurveTo(97,-12+muzzleDip,92,-7+muzzleDip);
    ctx.quadraticCurveTo(86,-3+muzzleDip,76,-7+muzzleDip);
    ctx.quadraticCurveTo(61,-8+muzzleDip,51,-14+muzzleDip);
    ctx.quadraticCurveTo(44,-16+muzzleDip,42,-20+muzzleDip);ctx.closePath();ctx.fill();
    ctx.fillStyle="#a78d70";ctx.beginPath();ctx.moveTo(54,-13+muzzleDip);
    ctx.quadraticCurveTo(69,-17+muzzleDip,90,-9+muzzleDip);
    ctx.quadraticCurveTo(83,-2+muzzleDip,70,-5+muzzleDip);
    ctx.quadraticCurveTo(59,-7+muzzleDip,54,-13+muzzleDip);ctx.closePath();ctx.fill();
    ctx.fillStyle="#211a17";ctx.beginPath();ctx.ellipse(92,-12+muzzleDip,5.8,4.3,.08,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#0f1110";ctx.beginPath();ctx.ellipse(93,-13+muzzleDip,1.8,1.2,0,0,Math.PI*2);ctx.fill();
    // Reduce the eye as one unit around its center; keep its gold iris and remove the lashes.
    const blinkAmount=foxLabBlinkRemaining>0?Math.sin(Math.PI*(1-foxLabBlinkRemaining/.14)):0;
    const idleGazeX=player.grounded&&speed<9?Math.sin(now*.00045)*1.05+Math.sin(now*.0009+1.1)*.35:0;
    const idleGazeY=player.grounded&&speed<9?Math.sin(now*.00033+2.2)*.42:0;
    ctx.save();ctx.translate(46.1,-23.5);ctx.scale(.82,.82*(1-blinkAmount*.96));ctx.translate(-46.1,23.5);
    ctx.fillStyle="#251a17";ctx.beginPath();ctx.moveTo(40.8,-23.6);
    ctx.quadraticCurveTo(45.1,-28,50,-24.8);ctx.quadraticCurveTo(50.6,-23,47.8,-20.8);
    ctx.quadraticCurveTo(43.4,-20,41,-22);ctx.closePath();ctx.fill();
    ctx.strokeStyle="#352a20";ctx.lineWidth=1;ctx.lineCap="round";ctx.beginPath();
    ctx.moveTo(41.3,-24.5);ctx.quadraticCurveTo(45.4,-27.8,49.8,-25);ctx.stroke();
    ctx.fillStyle="#e3ad47";ctx.beginPath();ctx.ellipse(46.1+idleGazeX,-23.5+idleGazeY,2.35,2.65,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#251a17";ctx.beginPath();ctx.ellipse(46.65+idleGazeX,-23.5+idleGazeY,.9,1.68,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#fff1d3";ctx.beginPath();ctx.ellipse(44.7+idleGazeX,-24.65+idleGazeY,.75,.88,0,0,Math.PI*2);ctx.fill();
    ctx.restore();
    if(blinkAmount>.48){ctx.strokeStyle="#352a20";ctx.lineWidth=1.1;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(41.5,-23.5);ctx.quadraticCurveTo(46,-21.3,50,-23.5);ctx.stroke();}
    ctx.restore();
    ctx.restore();
    ctx.restore();
  }

function drawFoxLabArena(){
    const sky=ctx.createLinearGradient(0,0,0,H);
    sky.addColorStop(0,"#182321");sky.addColorStop(.58,"#3d5148");sky.addColorStop(1,"#a17653");
    ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
    const dusk=ctx.createRadialGradient(685,325,8,685,325,265);
    dusk.addColorStop(0,"rgba(230,173,117,.3)");dusk.addColorStop(1,"rgba(230,173,117,0)");
    ctx.fillStyle=dusk;ctx.fillRect(390,90,570,390);
    for(let layer=0;layer<3;layer++){
      const baseY=350+layer*31,step=115-layer*14;
      ctx.fillStyle=["#26352f","#202e29","#192520"][layer];
      for(let x=-30+layer*37;x<W+step;x+=step){
        const h=92+((x*17+layer*31)%65+65)%65;
        ctx.beginPath();ctx.moveTo(x,baseY);ctx.lineTo(x+step*.47,baseY-h);ctx.lineTo(x+step*.94,baseY);ctx.closePath();ctx.fill();
        ctx.fillRect(x+step*.43,baseY,step*.08,37);
      }
    }
    const haze=ctx.createLinearGradient(0,330,0,480);
    haze.addColorStop(0,"rgba(196,172,131,0)");haze.addColorStop(1,"rgba(196,172,131,.18)");
    ctx.fillStyle=haze;ctx.fillRect(0,330,W,150);
    for(const s of foxLabSurfaces){ctx.fillStyle=s.ground?"#465449":"#5e6b5e";ctx.fillRect(s.x,s.y,s.w,s.ground?s.h:14);ctx.fillStyle="#8e9a7d";ctx.fillRect(s.x,s.y,s.w,2);}
    ctx.fillStyle="rgba(229,226,203,.82)";ctx.font="700 12px system-ui";ctx.textAlign="left";ctx.fillText("MOOSE · WALK  /  TROT  /  TURN  /  JUMP  /  LAND",22,30);
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
    drawFox(now,dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
