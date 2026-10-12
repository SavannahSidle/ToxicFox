(() => {
  "use strict";
  // Fox Ten: Endling-inspired refinement pass; preserves Fox Ten's rig while sharpening stealth, contact, environmental response, and presentation.
  const canvas = document.querySelector("#field");
  const ctx = canvas.getContext("2d");
  const status = document.querySelector("#status");
  const speedReadout = document.querySelector("#speed");
  const W = canvas.width, H = canvas.height;
  const FOX_COAT = "#b65436";
  let foxEightNight=false;
  const foxEightDust=[];
  const FIXED_STEP = 1/120;
  let foxLabAccumulator = 0, foxLabSimulationTime = 0;
  const keys = Object.create(null);
  const player = { x: 150, y: 380, w: 120, h: 100, vx: 0, vy: 0, facing: 1, grounded: false };
  let foxLabStridePhase = 0;
  let foxLabStealth = 0;
  const foxLabTailAngles = Array(8).fill(0), foxLabTailVelocities = Array(8).fill(0);
  let foxLabLandingImpact = 0, foxLabTakeoffUntil = 0, foxLabCoyoteTimer = .11;
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
  // Fox Ten behavior channels: soft alert shifts, breath, and scent-led nose work.
  let foxSevenAlert=0,foxSevenBreathPhase=0,foxSevenScentPulse=0,foxSevenWeightShift=0;
  const foxLabLegStates=Array.from({length:4},()=>({ready:false,pawX:0,pawXV:0,pawY:0,pawYV:0}));
  const foxLabFootContacts=Array.from({length:4},()=>({planted:false,released:false,weight:0,x:0,y:0}));
  // Walk order stays four-beat; the fast gait gathers the hind limbs then drives through the forelimbs.
  const foxLabLegConfigs=[
    // Side-view canid rig, ordered far hind, far fore, near hind, near fore.
    // Toe offsets describe the small paw extension after the hock, never a second hidden limb.
    {hip:-39,front:false,far:true,walk:Math.PI,trot:0,upper:35.5,lower:26,toeX:3.4,toeY:1.6,bend:-1,upperWidth:4.2,lowerWidth:2.65},
    {hip:19,front:true,far:true,walk:Math.PI*1.5,trot:Math.PI,upper:32.5,lower:29,toeX:3.6,toeY:1.5,bend:1,upperWidth:3.7,lowerWidth:2.35},
    {hip:-40,front:false,far:false,walk:0,trot:Math.PI,upper:36,lower:26.5,toeX:3.8,toeY:1.6,bend:-1,upperWidth:5.1,lowerWidth:2.85},
    {hip:32,front:true,far:false,walk:Math.PI*.5,trot:0,upper:32,lower:28.5,toeX:4,toeY:1.5,bend:1,upperWidth:4.5,lowerWidth:2.55}
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
    const minReach=Math.abs(upper-lower)+6.5;
    // Leave a little flex at full extension so the elbows and hocks never snap into a ruler-straight lock.
    const extensionReserve=Math.max(3.2,Math.min(upper,lower)*.095);
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
    if(event.code==="KeyN"){keys[event.code]=true;foxEightNight=!foxEightNight;return;}
    keys[event.code] = true;
    if(event.code==="KeyX")foxLabRestTarget=foxLabRestTarget===1?0:1;
    if(event.code==="KeyZ")foxLabRestTarget=foxLabRestTarget===2?0:2;
    if (["Space", "ArrowUp", "KeyW"].includes(event.code) && foxLabJumpPending <= 0) {
      foxLabRestTarget=0;
      foxLabJumpPending = .13;
      foxLabJumpAnticipation = 0;
    }
  });
  addEventListener("keyup", event => { keys[event.code] = false; });

  function foxEightGroundY(x){
    const dx=x-150;
    return 480+4*(Math.sin(dx/155)-Math.sin(0))+1.5*(Math.sin(dx/49)-Math.sin(0));
  }

  function foxEightNearPlatformEdge(direction){
    if(!player.grounded||!direction)return false;
    const bottom=player.y+player.h;
    const support=foxLabSurfaces.find(s=>!s.ground&&Math.abs(s.y-bottom)<9&&player.x+player.w*.5>=s.x&&player.x+player.w*.5<=s.x+s.w);
    if(!support)return false;
    const probe=direction>0?player.x+player.w+8:player.x-8;
    return probe<support.x||probe>support.x+support.w;
  }

  function updateFox(dt, now, left, right, up, investigate) {
    const walkModifier=keys.ShiftLeft||keys.ShiftRight,stalkModifier=keys.KeyC;
    foxLabStealth+=((stalkModifier?1:0)-foxLabStealth)*(1-Math.exp(-5.8*dt));
    const input=(left?-1:0)+(right?1:0),oldVx=player.vx,oldVy=player.vy;
    if(input)foxLabRestTarget=0;
    const speed=Math.abs(player.vx),reversing=input&&speed>8&&Math.sign(player.vx)!==input;
    if(input&&input!==foxLabTurnTo){foxLabTurnFrom=foxLabTurnTo;foxLabTurnTo=input;foxLabTurnProgress=0;foxLabTurnDuration=.21+Math.min(speed,285)*.00032;}
    if(foxLabTurnProgress<1)foxLabTurnProgress=Math.min(1,foxLabTurnProgress+dt/foxLabTurnDuration);
    if(foxLabTurnProgress>=.52&&(Math.abs(player.vx)<34||Math.sign(player.vx)===foxLabTurnTo))player.facing=foxLabTurnTo;

    if(input){
      const accel=player.grounded?(reversing?(walkModifier?760:1040):(walkModifier?430:690)):(reversing?410:walkModifier?220:280);
      player.vx+=input*accel*(stalkModifier?.42:1)*dt;
    }else player.vx*=Math.exp(-(player.grounded?(stalkModifier?8.2:5.4):1.65)*dt);
    if(walkModifier&&Math.abs(player.vx)>105){
      const excess=Math.abs(player.vx)-105,brake=Math.min(excess,(input&&Math.sign(player.vx)===input?560:850)*dt);
      player.vx-=Math.sign(player.vx)*brake;
    }
    player.vx=clamp(player.vx,stalkModifier?-58:-285,stalkModifier?58:285);
    if(stalkModifier&&foxEightNearPlatformEdge(input))player.vx=clamp(player.vx,-16,16);
    if(Math.abs(player.vx)<1.6&&!input)player.vx=0;

    foxLabCoyoteTimer=player.grounded?.11:Math.max(-1,foxLabCoyoteTimer-dt);
    if(foxLabJumpPending>0){
      foxLabJumpPending=Math.max(0,foxLabJumpPending-dt);
      foxLabJumpAnticipation=clamp(1-foxLabJumpPending/.13,0,1);
      if(foxLabJumpPending<=.075&&(player.grounded||foxLabCoyoteTimer>0)){
        player.vy=stalkModifier?-430:-545;player.grounded=false;foxLabCoyoteTimer=-1;foxLabTakeoffUntil=now+145;
        foxLabJumpAnticipation=0;foxLabTailLaunch=1;
      foxLabJumpPending=0;
      }else if(foxLabJumpPending===0)foxLabJumpAnticipation=0;
    }else foxLabJumpAnticipation*=Math.exp(-9*dt);

    const oldBottom=player.y+player.h,wasGrounded=player.grounded,fallSpeed=player.vy;
    const jumpHeld=up&&player.vy<0?1:0;
    foxLabJumpHoldBlend+=(jumpHeld-foxLabJumpHoldBlend)*(1-Math.exp(-14*dt));
    player.vy=Math.min(880,player.vy+(1580-foxLabJumpHoldBlend*620)*dt);
    player.x=clamp(player.x+player.vx*dt,90,W-player.w-36);
    player.y+=player.vy*dt;player.grounded=false;
    let landing=null;
    if(player.vy>=0){
      for(const surface of foxLabSurfaces){
        const surfaceY=surface.ground?foxEightGroundY(player.x+player.w*.5):surface.y;
        const carried=surface.ground&&wasGrounded&&Math.abs(oldBottom-surfaceY)<13;
        if((carried||oldBottom<=surfaceY+1)&&player.y+player.h>=surfaceY&&player.x+player.w>surface.x&&player.x<surface.x+surface.w&&(!landing||surfaceY<landing.y))landing={...surface,y:surfaceY};
      }
    }
    if(landing){
      player.y=landing.y-player.h;player.vy=0;player.grounded=true;foxLabJumpHoldBlend=0;
      if(fallSpeed>48){
        foxLabLandingImpact=Math.min(.88,fallSpeed/820);
        foxLabTailVelocities[0]+=Math.min(1.15,fallSpeed*.0021);
        foxLabTailVelocities[1]+=Math.min(.72,fallSpeed*.0013);
        foxLabTailVelocities[2]+=Math.min(.42,fallSpeed*.00075);
        foxLabTailVelocities[3]+=Math.min(.2,fallSpeed*.00035);
        foxLabLandingRecovery=1;
        const dustCount=clamp(Math.round(fallSpeed/85),2,8);
        for(let p=0;p<dustCount;p++)foxEightDust.push({x:player.x+player.w*.5+(Math.random()-.5)*34,y:player.y+player.h-2,vx:(Math.random()-.5)*62,vy:-18-Math.random()*44,life:.28+Math.random()*.24,max:.52,size:2+Math.random()*4});
      }
    }
    if(player.y<34){player.y=34;player.vy=Math.max(0,player.vy);}
    for(let i=foxEightDust.length-1;i>=0;i--){const p=foxEightDust[i];p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=110*dt;p.vx*=Math.exp(-2.4*dt);if(p.life<=0)foxEightDust.splice(i,1);}

    const currentSpeed=Math.abs(player.vx);
    const nextTrot=smooth(38,128,currentSpeed),nextRun=smooth(122,238,currentSpeed),nextGallop=smooth(128,218,currentSpeed);
    foxLabTrotBlend+=(nextTrot-foxLabTrotBlend)*(1-Math.exp(-5.5*dt));
    foxLabRunBlend+=(nextRun-foxLabRunBlend)*(1-Math.exp(-4.2*dt));
    foxLabGallopBlend+=(nextGallop-foxLabGallopBlend)*(1-Math.exp(-5.2*dt));
    // Give every gait a longer stride span while keeping walk, trot, and run speed-blended.
    const walkStride=40+currentSpeed*.25;
    const fasterStride=mix(58+currentSpeed*.21,84+currentSpeed*.18,foxLabRunBlend);
    foxLabStrideLength=mix(walkStride,fasterStride,foxLabTrotBlend);
    if(player.grounded&&currentSpeed>1.1)foxLabStridePhase+=currentSpeed*dt*Math.PI/foxLabStrideLength*(1+foxLabRunBlend*.045);
    const restReady=player.grounded&&currentSpeed<22&&!input&&foxLabJumpPending<=0;
    springTo(foxLabRestPose,"sit",restReady&&foxLabRestTarget===1?1:0,6.5,.96,dt);
    springTo(foxLabRestPose,"lie",restReady&&foxLabRestTarget===2?1:0,6.5,.96,dt);

    foxLabIdleTime=player.grounded&&currentSpeed<9&&!input?foxLabIdleTime+dt:0;
    const stillness=player.grounded&&currentSpeed<9?1:0;
    foxSevenAlert+=(stillness-foxSevenAlert)*(1-Math.exp(-.72*dt));
    foxSevenBreathPhase+=dt*(1.12+stillness*.22);
    foxSevenScentPulse+=(stillness*Math.pow(Math.max(0,Math.sin(now*.00072+.8)),10)-foxSevenScentPulse)*(1-Math.exp(-5*dt));
    foxSevenWeightShift+=(stillness*Math.sin(now*.00031+1.4)*1.15-foxSevenWeightShift)*(1-Math.exp(-1.8*dt));
    if(foxLabBlinkRemaining>0)foxLabBlinkRemaining=Math.max(0,foxLabBlinkRemaining-dt);
    else{foxLabBlinkTimer-=dt;if(foxLabBlinkTimer<=0){foxLabBlinkRemaining=.14;foxLabBlinkTimer=2.6+Math.random()*3.8;}}
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
    springTo(foxLabSpine,"pelvisX",pelvisX,10.5,.88,dt);springTo(foxLabSpine,"pelvisY",pelvisY,13,.9,dt);springTo(foxLabSpine,"pelvisAngle",pelvisAngle,11,.9,dt);
    springTo(foxLabSpine,"ribX",ribX,8.8,.92,dt);springTo(foxLabSpine,"ribY",ribY,11,.95,dt);springTo(foxLabSpine,"ribAngle",ribAngle,10,.92,dt);
    springTo(foxLabSpine,"waistY",waistY,6.8,.94,dt);springTo(foxLabSpine,"waistAngle",waistAngle,7.5,.95,dt);
    springTo(foxLabSpine,"neckAngle",-ribAngle*.62-waistAngle*.28+turnHead*.055+clamp(foxLabBodyAcceleration/1100,-1,1)*.012,12,.98,dt);
    springTo(foxLabSpine,"headY",-foxLabSpine.ribY*.72-foxLabSpine.pelvisY*.06+foreLoad*moveBlend*.08-Math.sin(foxLabSpine.ribAngle)*2.0,12,1,dt);
    const earForce=clamp(foxLabBodyAcceleration/1000,-1,1)*.065+clamp(-foxLabVerticalAcceleration/5000,0,1)*.1
      +jumpDrive*.06+jumpStretch*.045+jumpDescend*.04+foxLabLandingImpact*.14+foxLabJumpAnticipation*.024
      +clamp(-foxLabSpine.neckAngleV*.015,-.025,.025);
    springTo(foxLabEar,"angle",clamp(earForce,-.08,.22),15,.94,dt);
    springTo(foxLabEarTip,"angle",foxLabEar.angle,9,.98,dt);

    const turnSway=turnPulse(.2,.98)*turnDelta;
    const tailActivity=smooth(5,90,currentSpeed),idleTailAngle=mix(.28,.055,tailActivity);
    const gaitTail=cycleSample(foxLabStridePhase-.14,[0,.11,.2,.08,-.04,-.16,-.09,.03])*tailActivity*(.75+foxLabTrotBlend*.7+foxLabRunBlend*.85);
    const idleTailDrift=(1-tailActivity)*(Math.sin(foxLabIdleTime*.42)*.045+Math.sin(foxLabIdleTime*.19+1.3)*.018);
    const speedTrail=-smooth(45,285,currentSpeed)*.105;
    const airborne=player.grounded?0:1,ballistic=clamp(Math.max(airborne,foxLabLandingRecovery),0,1);
    const jumpVelocity=airborne*clamp(-player.vy/545,-1,1)*.58;
    const jumpAcceleration=airborne*clamp(-foxLabVerticalAcceleration/2400,-1,1)*.24;
    const bodyFollow=-(foxLabSpine.pelvisAngleV*.085+foxLabSpine.waistAngleV*.05)*(1+airborne*1.5);
    const tailTarget=clamp(idleTailAngle+speedTrail+foxLabBodyAcceleration*.00024-player.vy*.0004-foxLabVerticalAcceleration*.000009+foxLabStealth*.15
      +foxLabTailLaunch*(airborne?.78:.31)+jumpVelocity+jumpAcceleration+foxLabJumpAnticipation*.18+(airborne?.48:0)
      +turnSway*.3+bodyFollow+gaitTail+idleTailDrift+foxLabInvestigation*.16-foxLabLandingRecovery*.24,-1.05,1.18);
    for(let i=0;i<foxLabTailAngles.length;i++){
      const distal=i/(foxLabTailAngles.length-1);
      // At rest, gravity adds a smooth base-to-tip droop; a rare damped pulse gives the tip life without wagging.
      const idleTailSag=(1-tailActivity)*(.04+distal*.14)+((1-tailActivity)*Math.sin(foxLabIdleTime*.52)*.01);
      const idleTailTwitch=(1-tailActivity)*(foxLabIdleTime>1.2?Math.pow(Math.max(0,Math.sin(foxLabIdleTime*.79-i*.31+Math.sin(i*.7)*.18)),8)*.38*distal:0);
      const segmentTarget=clamp(tailTarget+idleTailSag+idleTailTwitch,-1.05,.9);
      const prior=i?foxLabTailAngles[i-1]:segmentTarget;
      const target=i?segmentTarget+(prior-segmentTarget)*mix(.55,.8,ballistic):segmentTarget;
      const stiffness=22-i*1.25,damping=(6.2-i*.22)*(1-.18*ballistic)*(1+foxLabLandingRecovery*.16);
      foxLabTailVelocities[i]+=(target-foxLabTailAngles[i])*stiffness*dt;
      foxLabTailVelocities[i]*=Math.exp(-damping*dt);
      foxLabTailAngles[i]=clamp(foxLabTailAngles[i]+foxLabTailVelocities[i]*dt,-.76,.84);
    }
  }

function drawFoxSkeleton(now,dt=1/60){
    const speed=Math.abs(player.vx),move=smooth(4,58,speed),run=foxLabRunBlend;
    const airborne=!player.grounded,phase=foxLabStridePhase,impact=foxLabLandingImpact;
    const stalk=Math.max(foxLabStealth,(1-smooth(16,110,speed))*1.05);
    const bodyWave=cycleSample(phase-.16,[-.2,.05,.42,.2,-.08,-.46,-.24,.14]);
    const stepWave=cycleSample(phase,[0,.36,.72,.28,-.18,-.64,-.35,.11]);
    const compress=Math.max(0,cycleSample(phase+.34,[-.1,.22,.82,.48,-.16,-.72,-.4,.09]))*run*.42;
    const bounce=player.grounded?stepWave*move*(.1+run*.22):0;
    const verticalMotion=stepWave*(foxLabTrotBlend*.16+run*.3)-foxLabLandingRecovery*1.4;
    const pitch=airborne?clamp(player.vy*.00015,-.14,.14):(-.02*run+bodyWave*.008*foxLabTrotBlend+clamp(foxLabBodyAcceleration/1100,-1,1)*.035-clamp(-foxLabBodyAcceleration/1000,0,1)*.014-impact*.045+foxLabInvestigation*.018);
    const inhale=Math.sin(foxSevenBreathPhase)*.24*(1-move)*(1-foxLabRestPose.sit*.65);
    const bodyLift=2.6-stalk*4.8;
    const rise=7+bodyLift+compress*.8+(airborne?smooth(0,145,now-(foxLabTakeoffUntil-145))*1.2:0)-foxLabInvestigation*1.5+inhale+foxSevenWeightShift-foxLabRestPose.sit*4.5-foxLabRestPose.lie*7;
    const footLine=player.h/2-2+rise-bounce-impact*5-verticalMotion-foxLabJumpAnticipation*3+foxLabLandingRecovery*2.6;
    const turnDelta=foxLabTurnTo-foxLabTurnFrom,turnLean=turnPulse(.18,.84)*turnDelta*(.028+move*.045+run*.018);
    const originX=player.x+player.w/2;
    const originY=player.y+player.h/2+bounce+impact*5+verticalMotion+foxLabJumpAnticipation*3-foxLabLandingRecovery*2.6-rise;
    const bodyAngle=pitch*.34+turnLean*.5-stalk*.035+(player.grounded?Math.atan2(foxEightGroundY(player.x+player.w)-foxEightGroundY(player.x),player.w)*.42:0)-foxLabRestPose.sit*.035+foxLabRestPose.lie*.022;
    const fwd=player.facing;
    const localToWorld=(x,y)=>({x:originX+fwd*(x*Math.cos(bodyAngle)-y*Math.sin(bodyAngle)),y:originY+x*Math.sin(bodyAngle)+y*Math.cos(bodyAngle)});
    const worldToLocal=(x,y)=>{const dx=(x-originX)/fwd,dy=y-originY;return{x:dx*Math.cos(bodyAngle)+dy*Math.sin(bodyAngle),y:-dx*Math.sin(bodyAngle)+dy*Math.cos(bodyAngle)};};
    const shadowY=player.y+player.h-1,shadowScale=clamp(1-Math.max(0,480-shadowY)*.0024,.56,1);
    ctx.save();ctx.globalAlpha=player.grounded?.19:.11*shadowScale;ctx.fillStyle="#0c1210";ctx.beginPath();ctx.ellipse(originX,shadowY+3,33*shadowScale,4.5*shadowScale,0,0,Math.PI*2);ctx.fill();ctx.restore();
    ctx.save();ctx.translate(originX,originY);ctx.scale(fwd,1);ctx.rotate(bodyAngle);
    const bone=(ax,ay,bx,by,rA,rB,shade="#e6d5aa",shine=true)=>{
      const dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy)||.001,a=Math.atan2(dy,dx),shaft=Math.max(.7,(rA+rB)*.34);
      ctx.save();ctx.translate(ax,ay);ctx.rotate(a);
      ctx.fillStyle="rgba(24,22,18,.72)";ctx.beginPath();ctx.moveTo(0,-rA*.68);ctx.quadraticCurveTo(len*.08,-rA,len*.2,-shaft);ctx.quadraticCurveTo(len*.48,-shaft*.78,len*.73,-shaft*.72);ctx.quadraticCurveTo(len*.91,-rB,len,-rB*.62);ctx.quadraticCurveTo(len+1,0,len,rB*.62);ctx.quadraticCurveTo(len*.91,rB,len*.73,shaft*.72);ctx.quadraticCurveTo(len*.48,shaft*.78,len*.2,shaft);ctx.quadraticCurveTo(len*.08,rA,0,rA*.68);ctx.quadraticCurveTo(-1,0,0,-rA*.68);ctx.closePath();ctx.fill();
      ctx.translate(-.25,-.25);ctx.fillStyle=shade;ctx.beginPath();ctx.moveTo(0,-rA*.62);ctx.quadraticCurveTo(len*.08,-rA*.86,len*.2,-shaft*.84);ctx.quadraticCurveTo(len*.48,-shaft*.66,len*.73,-shaft*.6);ctx.quadraticCurveTo(len*.91,-rB*.84,len,-rB*.52);ctx.quadraticCurveTo(len+.7,0,len,rB*.52);ctx.quadraticCurveTo(len*.91,rB*.84,len*.73,shaft*.6);ctx.quadraticCurveTo(len*.48,shaft*.66,len*.2,shaft*.84);ctx.quadraticCurveTo(len*.08,rA*.86,0,rA*.62);ctx.quadraticCurveTo(-.5,0,0,-rA*.62);ctx.closePath();ctx.fill();
      if(shine){ctx.strokeStyle="rgba(255,246,214,.68)";ctx.lineWidth=.48;ctx.beginPath();ctx.moveTo(len*.16,-shaft*.22);ctx.quadraticCurveTo(len*.48,-shaft*.36,len*.76,-shaft*.22);ctx.stroke();}
      ctx.restore();
    };
    const joint=(x,y,rX,rY,shade="#eadbb7")=>{ctx.fillStyle="rgba(24,22,18,.76)";ctx.beginPath();ctx.ellipse(x+.3,y+.45,rX+1,rY+1,0,0,Math.PI*2);ctx.fill();ctx.fillStyle=shade;ctx.beginPath();ctx.ellipse(x,y,rX,rY,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle="rgba(255,246,214,.55)";ctx.lineWidth=.45;ctx.beginPath();ctx.arc(x-.2,y-.25,rX*.72,Math.PI*1.08,Math.PI*1.8);ctx.stroke();};
    const pathBone=(points,width,color="#d9c89f")=>{ctx.strokeStyle="rgba(24,22,18,.74)";ctx.lineWidth=width+1.2;ctx.lineCap="round";ctx.lineJoin="round";ctx.beginPath();ctx.moveTo(points[0][0],points[0][1]);for(let i=1;i<points.length;i++)ctx.lineTo(points[i][0],points[i][1]);ctx.stroke();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(points[0][0],points[0][1]);for(let i=1;i<points.length;i++)ctx.lineTo(points[i][0],points[i][1]);ctx.stroke();};
    const bead=(x,y,rx,ry,color="#e4d3a8")=>{ctx.fillStyle="rgba(24,22,18,.72)";ctx.beginPath();ctx.ellipse(x+.35,y+.45,rx+.7,ry+.7,0,0,Math.PI*2);ctx.fill();ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();};
    const drawVertebra=(x,y,s,spinous=1)=>{bead(x,y,s*1.15,s*.78);pathBone([[x,y-s*.45],[x-s*.18,y-s*1.2*spinous]],Math.max(.7,s*.35),"#d5c49c");pathBone([[x-s*.35,y],[x-s*.9,y-s*.15],[x-s*.65,y+s*.3]],Math.max(.6,s*.24),"#cdbb91");};
    const spinePoint=(x,y)=>{
      const transform=(pivotX,shiftX,shiftY,angle)=>{const dx=x-pivotX,dy=y,c=Math.cos(angle),s=Math.sin(angle);return[pivotX+shiftX+dx*c-dy*s,shiftY+dx*s+dy*c];};
      const pelvis=transform(-29,foxLabSpine.pelvisX,foxLabSpine.pelvisY,foxLabSpine.pelvisAngle);
      const waist=transform(-4,(foxLabSpine.pelvisX+foxLabSpine.ribX)*.18,foxLabSpine.waistY,foxLabSpine.waistAngle);
      const rib=transform(20,foxLabSpine.ribX,foxLabSpine.ribY,foxLabSpine.ribAngle);
      const blend=(a,b,t)=>[mix(a[0],b[0],t),mix(a[1],b[1],t)];
      const p=blend(blend(pelvis,waist,smooth(-20,-8,x)),rib,smooth(6,18,x));
      return[p[0],p[1]+stalk*5.2];
    };
    const rotateRoot=(x,y,pivot,angle)=>{const dx=x-pivot,c=Math.cos(angle),s=Math.sin(angle);return[pivot+dx*c-y*s,dx*s+y*c];};
    const legPose=config=>{
      const front=config.front,far=config.far,index=foxLabLegConfigs.indexOf(config);
      const wtp=gaitPhase(config.walk,config.trot),gp=phase+(front?Math.PI:0)+(far?.18:0);
      const delta=Math.atan2(Math.sin(gp-wtp),Math.cos(gp-wtp));
      const gait=wtp+delta*foxLabGallopBlend;
      const p=((gait%(Math.PI*2))+Math.PI*2)%(Math.PI*2);
      const span=Math.PI*mix(1.22,.78,foxLabGallopBlend),stance=p<span,t=stance?p/span:(p-span)/(Math.PI*2-span),swing=cubic(t);
      const reach=mix(.32,.25,run)*(front?mix(1.12,1.04,run):1.18);
      const hindSwing=-reach+2*reach*swing-.035*reach*Math.sin(2*Math.PI*t);
      const travel=stance?reach-2*reach*t:(front?-reach+2*reach*swing:hindSwing);
      const lift=stance?0:(front?8.2:9.4)*Math.sin(Math.PI*t);
      let hip=config.hip+(front?foxLabSpine.ribX+foxLabPose.runContact*.55-foxLabPose.runExtension*.42+foxLabPose.jumpDrive*.38-foxLabPose.jumpLanding*.28:foxLabSpine.pelvisX+foxLabPose.runDrive*.22);
      let rootY=front?foxLabSpine.ribY+foxLabPose.runContact*.32+foxLabPose.jumpLanding*.38-3+bodyLift:foxLabSpine.pelvisY+foxLabPose.runGather*.32-6.5+bodyLift;
      const rotated=rotateRoot(hip,rootY,front?20:-29,front?foxLabSpine.ribAngle:foxLabSpine.pelvisAngle);hip=rotated[0];rootY=rotated[1];
      const resting=front?(far?-2.4:2.1):(far?-4.8:3.6);
      let pawX=hip+travel*foxLabStrideLength+resting*(1-move),pawY=footLine-lift*(.95+run*.42)*move;
      if(airborne){const desc=smooth(-80,430,player.vy),tuck=clamp(1-Math.abs(player.vy)/560,0,1);pawX=hip+(front?mix(16,13,desc)-tuck*10:mix(-17,-13,desc)+tuck*13);pawY=footLine-((1-desc)*(front?5:4)+tuck*4);}
      if(impact&&!airborne)pawY=footLine-impact*2;
      const state=foxLabLegStates[index];if(!state.ready){state.pawX=pawX;state.pawY=pawY;state.ready=true;}else{springTo(state,"pawX",pawX,22,.98,dt);springTo(state,"pawY",pawY,22,.98,dt);pawX=state.pawX;pawY=state.pawY;}
      const contact=foxLabFootContacts[index],maxReach=config.upper+config.lower-Math.max(3.2,Math.min(config.upper,config.lower)*.095);
      if(!stance||speed<=3||!player.grounded)contact.released=false;
      const canLock=player.grounded&&speed>3&&stance&&!contact.released;
      if(canLock&&!contact.planted){const a=localToWorld(pawX,pawY),l=worldToLocal(a.x,a.y);if(Math.hypot(l.x-config.toeX-hip,l.y-config.toeY-rootY)<maxReach-1.2){contact.x=a.x;contact.y=a.y;contact.planted=true;}else contact.released=true;}
      if(!canLock)contact.planted=false;
      contact.weight+=(Number(canLock&&contact.planted)-contact.weight)*(1-Math.exp(-26*dt));
      if(contact.weight>.001){const l=worldToLocal(contact.x,contact.y),reachLocked=Math.hypot(l.x-config.toeX-hip,l.y-config.toeY-rootY);if(contact.planted&&reachLocked>maxReach-1.2){contact.planted=false;contact.released=true;contact.weight=0;}else{pawX=mix(pawX,l.x,contact.weight);pawY=mix(pawY,l.y,contact.weight);}}
      const solved=solveFixedLimb(hip,rootY,pawX,pawY,config,player.grounded&&stance);
      contact.renderX=localToWorld(solved.pawX,solved.pawY).x;contact.renderY=localToWorld(solved.pawX,solved.pawY).y;
      return {front,far,hip,rootY,elbowX:solved.kneeX,elbowY:solved.kneeY,carpusX:solved.hockX,carpusY:solved.hockY,pawX:solved.pawX,pawY:solved.pawY,stance,t};
    };
    const drawFoot=(x,y,front,far)=>{
      const scale=front?1:.94,color=far?"#b4a47f":"#e7d8b4";ctx.save();ctx.translate(x,y);ctx.scale(scale,1);
      for(let i=0;i<5;i++)bead(-1.2+i*.72,-.2,.82,.92,color);
      for(let d=0;d<4;d++){const toeY=(d-1.5)*1.12,toeX=2.1+(1-Math.abs(d-1.5))*.5;bone(1.2,toeY*.45,toeX,toeY,.95,.72,color,false);bone(toeX,toeY,toeX+1.45,toeY+.12,.68,.46,color,false);bead(toeX+1.5,toeY+.12,.44,.37,color);}
      ctx.restore();
    };
    const drawLimb=p=>{
      const {front,far,hip,rootY,elbowX,elbowY,carpusX,carpusY,pawX,pawY}=p,shade=far?"#b4a47f":"#e9d9b2",r=far?.78:1;
      if(front){const sx=hip+7+foxLabSpine.ribX*.35,sy=rootY-13+foxLabSpine.ribY*.25;bone(sx,sy,hip-1,rootY+1,4.3*r,3.1*r,shade);joint(hip,rootY,2.7*r,3*r,shade);}
      else if(!far){pathBone([[hip+12,rootY-8],[hip+3,rootY-5],[hip,rootY]],2.5*r,shade);pathBone([[hip,rootY],[hip+10,rootY+8],[hip+17,rootY+8]],2.2*r,shade);pathBone([[hip+1,rootY+4],[hip+12,rootY+8],[hip+16,rootY+8]],1.65*r,shade);joint(hip,rootY,3.2*r,3.4*r,shade);}
      bone(hip,rootY,elbowX,elbowY,front?3.5*r:4.4*r,front?2.55*r:2.9*r,shade);joint(elbowX,elbowY,2.5*r,2.65*r,shade);
      if(front){bone(elbowX-.8,elbowY,carpusX-.8,carpusY,2.2*r,1.65*r,shade);bone(elbowX+1.5,elbowY+1,carpusX+1.5,carpusY+1,1.6*r,1.2*r,shade);}
      else{bone(elbowX,elbowY,carpusX,carpusY,2.4*r,1.7*r,shade);bone(elbowX+2.1,elbowY+.5,carpusX+2.1,carpusY+.5,1.25*r,.9*r,shade);joint(elbowX+2.2,elbowY-.4,1.35*r,1.65*r,shade);}
      joint(carpusX,carpusY,2*r,2.25*r,shade);bone(carpusX,carpusY,pawX,pawY,1.45*r,1.15*r,shade,false);drawFoot(pawX,pawY,front,far);
    };
    const legs=foxLabLegConfigs.map(legPose);
    ctx.globalAlpha=.86;legs.filter(p=>p.far).forEach(drawLimb);
    const neckPts=[];for(let i=0;i<7;i++){const t=i/6,x=22+t*14,y=-7-t*13+Math.sin(t*Math.PI)*1.8;neckPts.push(spinePoint(x,y));}
    pathBone(neckPts,1.65,"#d5c49c");neckPts.forEach((p,i)=>drawVertebra(p[0],p[1],1.18,i<2?.75:1));
    const thoracic=[];for(let i=0;i<13;i++){const t=i/12,x=18-t*34,y=-10+Math.sin(t*Math.PI)*1.1;thoracic.push(spinePoint(x,y));}
    thoracic.forEach((p,i)=>drawVertebra(p[0],p[1],1.2,i<4?1.3:1));
    const lumbar=[];for(let i=0;i<7;i++){const t=i/6,x=-17-t*14,y=-8+Math.sin(t*Math.PI)*.6;lumbar.push(spinePoint(x,y));}
    lumbar.forEach(p=>drawVertebra(p[0],p[1],1.45,1));for(let i=0;i<3;i++){const p=spinePoint(-31-i*1.3,-6+i*.45);drawVertebra(p[0],p[1],1.55,.7);}
    for(let side=0;side<2;side++){ctx.globalAlpha=side?.45:.86;ctx.strokeStyle=side?"#b3a582":"#e1d1a9";ctx.lineWidth=side?1.05:1.25;ctx.lineCap="round";for(let i=0;i<13;i++){const t=i/12,x=16-t*32,depth=side?1.1:0,span=14+Math.sin(t*Math.PI)*1.4;const p=[[x+depth,-9],[x-3+depth,-1],[x-5+depth,7],[x-2+depth,span*.84],[x+depth,span],[x+2+depth,span-1]].map(([px,py])=>spinePoint(px,py));ctx.beginPath();ctx.moveTo(...p[0]);ctx.bezierCurveTo(...p[1],...p[2],...p[3]);ctx.quadraticCurveTo(...p[4],...p[5]);ctx.stroke();}}
    ctx.globalAlpha=.9;for(let i=0;i<6;i++){const a=spinePoint(14-i*4.2,13),b=spinePoint(13-i*4.2,15.2);bone(a[0],a[1],b[0],b[1],1.15,.9,"#d5c49c",false);}
    const tailAnchor=spinePoint(-39,1.2),tailBaseX=tailAnchor[0],tailBaseY=tailAnchor[1];let tx=tailBaseX,ty=tailBaseY,tailN=0;const tailLengths=[12,14,15,15,15,15,14,12];
    for(let seg=0;seg<tailLengths.length;seg++){const a=foxLabTailAngles[seg]+foxLabSpine.pelvisAngle,dx=-Math.cos(a),dy=Math.sin(a),len=tailLengths[seg],steps=seg===7?2:3;for(let k=0;k<steps;k++){const t=(k+.5)/steps;drawVertebra(tx+dx*len*t,ty+dy*len*t,mix(1.35,.72,tailN/20),.75);tailN++;}tx+=dx*len;ty+=dy*len;pathBone([[tx-dx*1.8,ty-dy*1.8],[tx,ty]],.8,"#cbb98e");}
    ctx.save();ctx.translate(36, -20+foxLabSpine.headY);ctx.rotate(foxLabSpine.neckAngle);ctx.translate(-36,20);
    const skull="#ebddba";ctx.globalAlpha=1;ctx.fillStyle="rgba(24,22,18,.78)";ctx.beginPath();ctx.moveTo(29,-24);ctx.quadraticCurveTo(32,-30,39,-27);ctx.quadraticCurveTo(45,-25,46,-21);ctx.lineTo(53,-19);ctx.lineTo(54,-16.8);ctx.lineTo(43,-15.7);ctx.quadraticCurveTo(38,-13,32,-16);ctx.quadraticCurveTo(28,-19,29,-24);ctx.closePath();ctx.fill();
    ctx.fillStyle=skull;ctx.beginPath();ctx.moveTo(29,-24);ctx.quadraticCurveTo(32,-30,39,-27);ctx.quadraticCurveTo(45,-25,46,-21);ctx.lineTo(53,-19);ctx.lineTo(54,-16.8);ctx.lineTo(43,-15.7);ctx.quadraticCurveTo(38,-13,32,-16);ctx.quadraticCurveTo(28,-19,29,-24);ctx.closePath();ctx.fill();
    ctx.fillStyle="#32403a";ctx.beginPath();ctx.ellipse(37,-22,2.2,2.65,-.15,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#b7a780";ctx.lineWidth=.85;ctx.beginPath();ctx.ellipse(37,-22,3,3.4,-.15,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle="#46534b";ctx.beginPath();ctx.ellipse(50.1,-18.7,1.6,.72,0,0,Math.PI*2);ctx.fill();
    pathBone([[31,-18],[34,-14.5],[42,-14.2],[47,-16]],1.05,"#c6b58d");joint(42,-17,1.5,1.5,skull);pathBone([[42,-16],[40,-12.7],[46,-13.2],[51,-15.5]],1.3,"#cdbb92");
    for(const x of [43.2,45.2,47.1,49])pathBone([[x,-15.4],[x+.3,-14]],.58,"#f2e4c3");for(const x of [40.5,47.8]){ctx.fillStyle="#f2e4c3";ctx.beginPath();ctx.moveTo(x,-17);ctx.lineTo(x+1.1,-17);ctx.lineTo(x+.55,-14.8);ctx.closePath();ctx.fill();}
    const scapX=20+foxLabSpine.ribX*.35,scapY=-11+foxLabSpine.ribY*.25;bone(scapX+8,scapY-4,scapX-2,4,4.3,3.2,"#e9dab5");joint(scapX-2,4,2.7,3.1,"#e9dab5");
    legs.filter(p=>!p.far).forEach(drawLimb);
    ctx.restore();
  }

function drawFoxLabArena(){
    const sky=ctx.createLinearGradient(0,0,0,H);
    sky.addColorStop(0,foxEightNight?"#090f19":"#182321");sky.addColorStop(.58,foxEightNight?"#1c2b35":"#3d5148");sky.addColorStop(1,foxEightNight?"#37414a":"#a17653");
    ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
    const dusk=ctx.createRadialGradient(685,325,8,685,325,265);
    dusk.addColorStop(0,foxEightNight?"rgba(146,177,203,.22)":"rgba(230,173,117,.3)");dusk.addColorStop(1,foxEightNight?"rgba(146,177,203,0)":"rgba(230,173,117,0)");
    ctx.fillStyle=dusk;ctx.fillRect(390,90,570,390);
    for(let layer=0;layer<3;layer++){
      const baseY=350+layer*31,step=115-layer*14;
      ctx.fillStyle=(foxEightNight?["#1d2d36","#17262d","#101d23"]:["#26352f","#202e29","#192520"])[layer];
      const scroll=(player.x-150)*(layer+1)*.035;
      const tileOffset=Math.floor(scroll/step),fraction=scroll-tileOffset*step;
      for(let i=-2;i<Math.ceil(W/step)+2;i++){
        const tile=tileOffset+i,x=layer*37+i*step-fraction;
        const seed=((tile*17+layer*31)%65+65)%65,h=92+seed;
        ctx.beginPath();ctx.moveTo(x,baseY);ctx.lineTo(x+step*.47,baseY-h);ctx.lineTo(x+step*.94,baseY);ctx.closePath();ctx.fill();
        ctx.fillRect(x+step*.43,baseY,step*.08,37);
      }
    }
    const haze=ctx.createLinearGradient(0,330,0,480);
    haze.addColorStop(0,"rgba(196,172,131,0)");haze.addColorStop(1,"rgba(196,172,131,.18)");
    ctx.fillStyle=haze;ctx.fillRect(0,330,W,150);
    for(const s of foxLabSurfaces){
      if(s.ground){
        ctx.fillStyle=foxEightNight?"#29363a":"#465449";ctx.beginPath();ctx.moveTo(0,foxEightGroundY(0));
        for(let x=16;x<=W;x+=16)ctx.lineTo(x,foxEightGroundY(x));
        ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.closePath();ctx.fill();
        ctx.strokeStyle=foxEightNight?"#677b7d":"#8e9a7d";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,foxEightGroundY(0));for(let x=16;x<=W;x+=16)ctx.lineTo(x,foxEightGroundY(x));ctx.stroke();
      }else{ctx.fillStyle=foxEightNight?"#39464a":"#5e6b5e";ctx.fillRect(s.x,s.y,s.w,14);ctx.fillStyle=foxEightNight?"#677b7d":"#8e9a7d";ctx.fillRect(s.x,s.y,s.w,2);}
    }
    for(const p of foxEightDust){ctx.globalAlpha=clamp(p.life/p.max,0,1)*.55;ctx.fillStyle=foxEightNight?"#c1c8bd":"#d9c8aa";ctx.beginPath();ctx.ellipse(p.x,p.y,p.size,p.size*.58,0,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;
    ctx.fillStyle=foxEightNight?"rgba(222,231,226,.9)":"rgba(229,226,203,.82)";ctx.font="700 12px system-ui";ctx.textAlign="left";ctx.fillText("FOX TEN · RED FOX SKELETON · N: NIGHT",22,30);
  }

  function frame(now) {
    const dt = frame.last ? clamp((now - frame.last) / 1000, 0, .05) : 0;
    frame.last = now;
    const left = keys.ArrowLeft || keys.KeyA;
    const right = keys.ArrowRight || keys.KeyD;
    const up = keys.ArrowUp || keys.KeyW || keys.Space;
    if(!foxLabSimulationTime)foxLabSimulationTime=now;
    foxLabAccumulator=Math.min(.05,foxLabAccumulator+dt);
    while(foxLabAccumulator>=FIXED_STEP){
      foxLabSimulationTime+=FIXED_STEP*1000;
      updateFox(FIXED_STEP,foxLabSimulationTime,left,right,up,keys.KeyI);
      foxLabAccumulator-=FIXED_STEP;
    }
    const velocity = Math.abs(player.vx);
    const motion = !player.grounded ? (player.vy < 0 ? "AIRBORNE · ASCENDING" : "AIRBORNE · DESCENDING")
      : foxLabRestPose.lie>.55 ? "LYING DOWN" : foxLabRestPose.sit>.55 ? "SITTING" : foxLabInvestigation > .55 ? "INVESTIGATING" : foxLabStealth>.45&&velocity>3 ? "STALKING" : velocity > 175 ? "RUNNING" : velocity > 8 ? "WALKING" : foxLabStealth>.45 ? "LOW / ALERT" : "IDLE";
    status.textContent = `${motion} · ${player.grounded ? "GROUNDED" : "AIRBORNE"}`;
    speedReadout.textContent = `${Math.round(velocity)} px/s`;
    drawFoxLabArena();
    drawFoxSkeleton(now,dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
