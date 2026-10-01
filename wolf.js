(() => {
  "use strict";
  const canvas=document.querySelector("#field"),ctx=canvas.getContext("2d"),status=document.querySelector("#status"),speedReadout=document.querySelector("#speed");
  const W=canvas.width,H=canvas.height,keys=Object.create(null);
  const wolf={x:185,y:380,vx:0,vy:0,facing:1,grounded:true};
  const surfaces=[{x:0,y:480,w:960,h:60,ground:true},{x:320,y:452,w:112,h:14},{x:432,y:432,w:112,h:14},{x:544,y:412,w:112,h:14},{x:656,y:386,w:112,h:14},{x:768,y:430,w:128,h:14},{x:455,y:328,w:118,h:14}];
  const legs=[
    {root:-63,front:false,far:true,walk:Math.PI*1.5,trot:0,gallop:0,upper:37,lower:43,bend:-1,toeX:5,toeY:7},
    {root:42,front:true,far:true,walk:Math.PI*.5,trot:Math.PI,gallop:Math.PI*1.35,upper:34,lower:42,bend:1,toeX:5,toeY:7},
    {root:-48,front:false,far:false,walk:0,trot:Math.PI,gallop:.16,upper:37,lower:43,bend:-1,toeX:5,toeY:7},
    {root:56,front:true,far:false,walk:Math.PI,trot:0,gallop:Math.PI*1.55,upper:34,lower:42,bend:1,toeX:5,toeY:7}
  ];
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),mix=(a,b,t)=>a+(b-a)*t;
  const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
  const wrap=a=>((a%(Math.PI*2))+Math.PI*2)%(Math.PI*2);
  const spring=(s,k,target,f,d,dt)=>{s[k+"V"]+=((target-s[k])*f*f-2*d*f*s[k+"V"])*dt;s[k]+=s[k+"V"]*dt;};
  const body={pelvisX:0,pelvisXV:0,pelvisY:0,pelvisYV:0,pelvisA:0,pelvisAV:0,ribX:0,ribXV:0,ribY:0,ribYV:0,ribA:0,ribAV:0,waistA:0,waistAV:0,headA:0,headAV:0};
  const tailA=Array(7).fill(.42),tailV=Array(7).fill(0);
  let phase=0,walkBlend=0,gallopBlend=0,jumpPending=0,jumpLoad=0,landImpact=0,focus=0,bodyAccel=0,oldVx=0,lastFrame=0;

  addEventListener("keydown",e=>{if(["ArrowLeft","ArrowRight","ArrowUp","Space"].includes(e.code))e.preventDefault();keys[e.code]=true;if(["Space","ArrowUp","KeyW"].includes(e.code)&&wolf.grounded&&jumpPending<=0)jumpPending=.09;});
  addEventListener("keyup",e=>{keys[e.code]=false;});

  function solveLeg(rx,ry,px,py,c){
    let dx=px-c.toeX-rx,dy=py-c.toeY-ry;const raw=Math.hypot(dx,dy)||.001;
    const d=clamp(raw,Math.abs(c.upper-c.lower)+4,c.upper+c.lower-3.5),scale=d/raw;dx*=scale;dy*=scale;
    const ux=dx/d,uy=dy/d,along=(c.upper*c.upper-c.lower*c.lower+d*d)/(2*d),h=Math.sqrt(Math.max(0,c.upper*c.upper-along*along));
    const kx=rx+ux*along-uy*h*c.bend,ky=ry+uy*along+ux*h*c.bend;
    return {kx,ky,hx:rx+dx,hy:ry+dy,px:rx+dx+c.toeX,py:ry+dy+c.toeY};
  }

  function update(dt,now,left,right,up,focusKey){
    const input=(left?-1:0)+(right?1:0),oldY=wolf.vy,speed=Math.abs(wolf.vx),reverse=input&&speed>8&&Math.sign(wolf.vx)!==input;
    if(input){wolf.vx+=input*(wolf.grounded?(reverse?1060:720):310)*dt;wolf.facing=input;}
    else wolf.vx*=Math.exp(-(wolf.grounded?4.8:1.4)*dt);
    wolf.vx=clamp(wolf.vx,-280,280);if(Math.abs(wolf.vx)<1.3&&!input)wolf.vx=0;
    if(jumpPending>0){jumpPending=Math.max(0,jumpPending-dt);jumpLoad=1-jumpPending/.09;if(jumpPending===0&&wolf.grounded){wolf.vy=-560;wolf.grounded=false;jumpLoad=0;}}
    else jumpLoad*=Math.exp(-9*dt);
    const wasBottom=wolf.y+100,fall=wolf.vy,hold=up&&wolf.vy<0?1:0;
    wolf.vy=Math.min(880,wolf.vy+(1540-hold*430)*dt);wolf.x=clamp(wolf.x+wolf.vx*dt,140,W-145);wolf.y+=wolf.vy*dt;wolf.grounded=false;
    let landing=null;if(wolf.vy>=0)for(const s of surfaces)if(wasBottom<=s.y+1&&wolf.y+100>=s.y&&wolf.x+115>s.x&&wolf.x-115<s.x+s.w&&(!landing||s.y<landing.y))landing=s;
    if(landing){wolf.y=landing.y-100;wolf.vy=0;wolf.grounded=true;if(fall>45)landImpact=Math.min(1,fall/720);}
    if(wolf.y<18){wolf.y=18;wolf.vy=Math.max(0,wolf.vy);}
    const v=Math.abs(wolf.vx),targetTrot=smooth(55,145,v),targetGallop=smooth(145,250,v);
    walkBlend+=(targetTrot-walkBlend)*(1-Math.exp(-4.7*dt));gallopBlend+=(targetGallop-gallopBlend)*(1-Math.exp(-4.2*dt));
    const stride=mix(48,91,Math.max(walkBlend,gallopBlend));if(wolf.grounded&&v>1)phase+=v*dt*Math.PI/stride;
    const accel=(wolf.vx-oldVx)/Math.max(dt,.001)*(wolf.facing||1),accelBlend=1-Math.exp(-7*dt);bodyAccel=mix(bodyAccel,accel,accelBlend);oldVx=wolf.vx;
    landImpact*=Math.exp(-7.5*dt);const attention=focusKey&&wolf.grounded&&v<12?1:0;focus+=(attention-focus)*(1-Math.exp(-4.5*dt));
    const g=phase,walkWave=Math.sin(g-.45),push=Math.sin(g-.15),foreLoad=Math.sin(g+.5),run=smooth(135,255,v),air=wolf.grounded?0:1;
    spring(body,"pelvisX",clamp(bodyAccel/1400,-1,1)*1.3+push*run*2-jumpLoad*.6,9,.9,dt);
    spring(body,"pelvisY",push*run*1.3-jumpLoad*1.7+air*clamp(-wolf.vy/560,-.5,.5)*.6+landImpact*1.5,10,.9,dt);
    spring(body,"pelvisA",push*run*.045+clamp(bodyAccel/1400,-1,1)*.025-air*clamp(-wolf.vy/560,-1,1)*.065+landImpact*.035,8,.9,dt);
    spring(body,"ribX",foreLoad*run*1.1-jumpLoad*.5,8,.95,dt);spring(body,"ribY",foreLoad*run*.65-jumpLoad*.9+landImpact*.8,9,.95,dt);
    spring(body,"ribA",foreLoad*run*.035-air*clamp(-wolf.vy/560,-1,1)*.075+landImpact*.045,8,.95,dt);
    spring(body,"waistA",(body.ribA-body.pelvisA)*.6+walkWave*run*.035+air*(wolf.vy<0?-.035:.025),7,.95,dt);
    spring(body,"headA",-(body.ribA*.7+body.waistA*.3)+clamp(bodyAccel/2000,-1,1)*.025,8,.96,dt);
    const verticalAccel=(wolf.vy-oldY)/Math.max(dt,.001),tailTarget=clamp(.4-smooth(15,230,v)*.3-bodyAccel*.0002+wolf.vy*.00024-verticalAccel*.000012,-.25,.8);
    for(let i=0;i<tailA.length;i++){const target=i?tailTarget+(tailA[i-1]-tailTarget)*.5:tailTarget,stiff=22-i*1.7,damp=5.8-i*.36;tailV[i]+=(target-tailA[i])*stiff*dt;tailV[i]*=Math.exp(-damp*dt);tailA[i]=clamp(tailA[i]+tailV[i]*dt,-.5,1.05);}
  }

  function drawWolf(now,dt){
    const speed=Math.abs(wolf.vx),move=smooth(3,45,speed),trot=walkBlend,gallop=gallopBlend,air=!wolf.grounded;
    const bounce=wolf.grounded?Math.sin(phase*2)*move*(.15+gallop*.18):0;
    const originX=wolf.x,originY=wolf.y+31+bounce+landImpact*3+air*clamp(wolf.vy*.00008,-.05,.05),f=wolf.facing;
    const pitch=air?clamp(wolf.vy*.0001,-.07,.07):-.014*gallop+clamp(bodyAccel/1800,-1,1)*.018;
    ctx.save();ctx.translate(originX,originY);ctx.scale(f,1);ctx.rotate(pitch);
    const spinePoint=(x,y)=>{
      const part=(pivot,sx,sy,a)=>{const dx=x-pivot,c=Math.cos(a),s=Math.sin(a);return[pivot+sx+dx*c-y*s,sy+dx*s+y*c];};
      const hip=part(-42,body.pelvisX,body.pelvisY,body.pelvisA),waist=part(0,body.pelvisX*.25+body.ribX*.15,body.waistA*8,body.waistA),rib=part(43,body.ribX,body.ribY,body.ribA);
      const t=x< -8?smooth(-43,-8,x):smooth(-8,42,x),a=x< -8?hip:waist,b=x< -8?waist:rib;return[mix(a[0],b[0],t),mix(a[1],b[1],t)];
    };
    const smoothPath=points=>{ctx.moveTo(...points[0]);for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1];ctx.quadraticCurveTo(...a,(a[0]+b[0])/2,(a[1]+b[1])/2);}ctx.lineTo(...points.at(-1));};

    // A low, heavy winter brush follows the pelvis and continues its motion toward the tip.
    const tailBase=spinePoint(-76,1),tailPts=[tailBase];let tx=tailBase[0],ty=tailBase[1];
    const lengths=[13,15,16,16,15,13,11];for(let i=0;i<lengths.length;i++){const a=tailA[i]+body.pelvisA;tx-=Math.cos(a)*lengths[i];ty+=Math.sin(a)*lengths[i];tailPts.push([tx,ty]);}
    const tw=[7,11,14,16,16,13,9,4],upper=[],lower=[];
    for(let i=0;i<tailPts.length;i++){const p=tailPts[i],a=tailPts[Math.max(i-1,0)],b=tailPts[Math.min(i+1,tailPts.length-1)],dx=b[0]-a[0],dy=b[1]-a[1],n=Math.hypot(dx,dy)||1;upper.push([p[0]-dy/n*tw[i],p[1]+dx/n*tw[i]]);lower.push([p[0]+dy/n*tw[i],p[1]-dx/n*tw[i]]);}
    const tailOutline=upper.concat(lower.slice().reverse());
    const tg=ctx.createLinearGradient(tailPts[0][0],tailPts[0][1]-10,tailPts.at(-1)[0],tailPts.at(-1)[1]+10);tg.addColorStop(0,"#e9e8e2");tg.addColorStop(.65,"#f4f3ed");tg.addColorStop(1,"#b8c2c5");ctx.fillStyle=tg;ctx.beginPath();smoothPath(tailOutline);ctx.closePath();ctx.fill();
    ctx.strokeStyle="rgba(255,255,255,.52)";ctx.lineWidth=1.4;ctx.beginPath();smoothPath(tailPts.map(p=>[p[0],p[1]-2]));ctx.stroke();

    const footLine=wolf.y+100-originY-2,bodyTravel=48+speed*.13;
    const drawLeg=i=>{
      const c=legs[i],p=wrap(phase+mix(mix(c.walk,c.trot,trot),c.gallop,gallop)),u=p/(Math.PI*2),stance=u<.61;
      const q=stance?u/.61:(u-.61)/.39,e=q*q*(3-2*q),reach=mix(.28,.2,gallop),sweep=stance?reach-2*reach*q:-reach+2*reach*e;
      let px=c.root+sweep*bodyTravel*move+(1-move)*(c.front?(c.far?-3:2.5):(c.far?3:-2)),py=footLine;
      if(!stance)py-=Math.sin(Math.PI*q)*(5+gallop*9)*move;
      if(air){const descending=smooth(-40,420,wolf.vy);px=c.root+(c.front?9:-8)+(c.front?descending*8:-descending*7);py=footLine-(1-descending)*(12+gallop*3)+(c.front?0:-descending*2);}
      const rx=c.root+(c.front?body.ribX:body.pelvisX),ry=(c.front?-8:-4)+(c.front?body.ribY:body.pelvisY),s=solveLeg(rx,ry,px,py,c);
      const fur=c.far?"#aeb8bb":"#d7d9d5",shadow=c.far?"#727f85":"#89979b";ctx.globalAlpha=c.far?.56:1;
      const bone=(ax,ay,bx,by,w0,w1,fill)=>{const dx=bx-ax,dy=by-ay,n=Math.hypot(dx,dy)||1,nx=-dy/n,ny=dx/n;ctx.fillStyle=fill;ctx.beginPath();ctx.moveTo(ax+nx*w0,ay+ny*w0);ctx.quadraticCurveTo((ax+bx)/2+nx*(w0+w1)*.2,(ay+by)/2+ny*(w0+w1)*.2,bx+nx*w1,by+ny*w1);ctx.lineTo(bx-nx*w1,by-ny*w1);ctx.quadraticCurveTo((ax+bx)/2-nx*(w0+w1)*.2,(ay+by)/2-ny*(w0+w1)*.2,ax-nx*w0,ay-ny*w0);ctx.closePath();ctx.fill();};
      bone(rx,ry,s.kx,s.ky,c.front?5:8,c.front?3.2:4.4,fur);bone(s.kx,s.ky,s.hx,s.hy,3.4,2.5,fur);bone(s.hx,s.hy,s.px,s.py,2,1.5,shadow);
      if(!c.front){ctx.fillStyle=fur;ctx.beginPath();ctx.ellipse(rx+(s.kx-rx)*.36,ry+(s.ky-ry)*.36,10,15,Math.atan2(s.ky-ry,s.kx-rx),0,Math.PI*2);ctx.fill();}
      ctx.fillStyle=shadow;ctx.beginPath();ctx.arc(s.kx,s.ky,c.front?2.8:3.5,0,Math.PI*2);ctx.arc(s.hx,s.hy,2.1,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=c.far?"#bac2c4":"#e8e7df";ctx.beginPath();ctx.ellipse(s.px+1.4,s.py,5.8,2.8,-.05,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="rgba(91,103,108,.38)";for(let toe=-1;toe<=1;toe++){ctx.beginPath();ctx.ellipse(s.px+4+toe*2,s.py+.7,1.25,.55,0,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;
    };
    drawLeg(0);drawLeg(1);

    // One continuous winter body: deep forechest, level back, tucked waist, and joined haunch.
    const outline=[[-91,-4],[-86,-20],[-68,-29],[-45,-31],[-22,-29],[-2,-26],[20,-30],[39,-36],[55,-34],[70,-27],[82,-12],[87,-1],[82,13],[69,21],[51,23],[33,17],[14,11],[-5,12],[-25,16],[-48,16],[-68,10],[-84,4]].map(([x,y])=>spinePoint(x,y));
    const coat=ctx.createLinearGradient(0,-36,0,20);coat.addColorStop(0,"#faf9f4");coat.addColorStop(.48,"#e8e9e5");coat.addColorStop(1,"#c4ccce");ctx.fillStyle=coat;ctx.beginPath();smoothPath(outline);ctx.closePath();ctx.fill();ctx.strokeStyle="#89969a";ctx.lineWidth=1.2;ctx.stroke();
    ctx.fillStyle="rgba(161,174,179,.34)";ctx.beginPath();ctx.moveTo(...spinePoint(-63,3));ctx.quadraticCurveTo(...spinePoint(-37,5),...spinePoint(-19,7));ctx.quadraticCurveTo(...spinePoint(-35,13),...spinePoint(-58,9));ctx.closePath();ctx.fill();
    ctx.fillStyle="rgba(255,255,255,.45)";ctx.beginPath();ctx.moveTo(...spinePoint(-64,-22));ctx.quadraticCurveTo(...spinePoint(-28,-32),...spinePoint(4,-24));ctx.quadraticCurveTo(...spinePoint(-31,-26),...spinePoint(-64,-17));ctx.closePath();ctx.fill();
    ctx.fillStyle="#ecece6";ctx.beginPath();ctx.moveTo(...spinePoint(30,-29));ctx.quadraticCurveTo(...spinePoint(44,-38),...spinePoint(61,-30));ctx.quadraticCurveTo(...spinePoint(69,-19),...spinePoint(68,-7));ctx.quadraticCurveTo(...spinePoint(59,4),...spinePoint(49,13));ctx.quadraticCurveTo(...spinePoint(43,2),...spinePoint(34,-7));ctx.closePath();ctx.fill();
    ctx.strokeStyle="rgba(255,255,255,.62)";ctx.lineWidth=1;for(const x of [35,43,51]){ctx.beginPath();ctx.moveTo(...spinePoint(x,-25));ctx.quadraticCurveTo(...spinePoint(x+4,-13),...spinePoint(x+1,1));ctx.stroke();}
    drawLeg(2);drawLeg(3);

    // Broad wolf skull, compact rounded ears, strong tapered muzzle.
    ctx.save();ctx.translate(62+body.ribX*.6,-20+body.ribY*.6);ctx.rotate(body.headA+body.ribA*.22+focus*.025);ctx.translate(-62,20);
    const drawEar=(x,len,angle,far)=>{ctx.save();ctx.translate(x,-34);ctx.rotate(angle);ctx.fillStyle=far?"#c5cbca":"#f1f0e9";ctx.beginPath();ctx.moveTo(-6,2);ctx.quadraticCurveTo(-7,-len*.6,-2,-len);ctx.quadraticCurveTo(5,-len*.8,7,1);ctx.quadraticCurveTo(1,4,-6,2);ctx.closePath();ctx.fill();if(!far){ctx.fillStyle="#9b7774";ctx.beginPath();ctx.moveTo(-2,-1);ctx.quadraticCurveTo(-3,-len*.53,-1,-len*.76);ctx.quadraticCurveTo(3,-len*.55,4,0);ctx.closePath();ctx.fill();}ctx.restore();};
    drawEar(75,18,-.23,true);
    // A soft winter ruff joins the skull to the shoulder without a collar-like seam.
    const ruff=ctx.createLinearGradient(52,-41,76,-7);ruff.addColorStop(0,"#f5f4ee");ruff.addColorStop(1,"#d9ddda");ctx.fillStyle=ruff;ctx.beginPath();ctx.moveTo(48,-28);ctx.quadraticCurveTo(54,-41,68,-40);ctx.quadraticCurveTo(84,-37,91,-25);ctx.quadraticCurveTo(91,-14,80,-8);ctx.quadraticCurveTo(67,-8,55,-17);ctx.quadraticCurveTo(48,-21,48,-28);ctx.closePath();ctx.fill();
    ctx.fillStyle="#f0efe9";ctx.beginPath();ctx.moveTo(49,-27);ctx.quadraticCurveTo(55,-42,72,-43);ctx.quadraticCurveTo(90,-44,101,-31);ctx.quadraticCurveTo(105,-24,100,-16);ctx.quadraticCurveTo(91,-9,77,-12);ctx.quadraticCurveTo(63,-13,53,-18);ctx.closePath();ctx.fill();
    drawEar(63,20,.12,false);
    ctx.fillStyle="#e5e5df";ctx.beginPath();ctx.moveTo(83,-29);ctx.quadraticCurveTo(99,-28,114,-19);ctx.lineTo(124,-14);ctx.quadraticCurveTo(122,-9,113,-9);ctx.quadraticCurveTo(98,-11,87,-17);ctx.quadraticCurveTo(81,-20,83,-29);ctx.closePath();ctx.fill();
    ctx.fillStyle="#f8f7f1";ctx.beginPath();ctx.moveTo(96,-14);ctx.quadraticCurveTo(109,-12,121,-12);ctx.quadraticCurveTo(118,-8,111,-9);ctx.lineTo(99,-10);ctx.closePath();ctx.fill();
    ctx.fillStyle="#30393c";ctx.beginPath();ctx.moveTo(77,-28);ctx.quadraticCurveTo(82,-33,89,-29);ctx.quadraticCurveTo(88,-24,82,-23);ctx.closePath();ctx.fill();
    ctx.fillStyle="#c99c52";ctx.beginPath();ctx.ellipse(83,-27.5,2.1,2.4,-.15,0,Math.PI*2);ctx.fill();ctx.fillStyle="#263033";ctx.beginPath();ctx.ellipse(83.6,-27.5,.8,1.8,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#222a2c";ctx.beginPath();ctx.ellipse(124,-14,3.8,2.9,-.12,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="#697579";ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(112,-8.5);ctx.quadraticCurveTo(119,-7.5,124,-10);ctx.stroke();
    ctx.restore();ctx.restore();
  }

  function drawArena(){
    const sky=ctx.createLinearGradient(0,0,0,H);sky.addColorStop(0,"#25333b");sky.addColorStop(1,"#182225");ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
    ctx.fillStyle="rgba(213,225,231,.06)";ctx.beginPath();ctx.ellipse(480,484,390,28,0,0,Math.PI*2);ctx.fill();
    for(const s of surfaces){ctx.fillStyle=s.ground?"#39443f":"#4a5557";ctx.fillRect(s.x,s.y,s.w,s.ground?s.h:14);ctx.fillStyle=s.ground?"#aeb8a4":"#aeb8b2";ctx.fillRect(s.x,s.y,s.w,2);}
    ctx.fillStyle="rgba(239,242,236,.7)";ctx.font="700 12px system-ui";ctx.textAlign="left";ctx.fillText("ARCTIC WOLF · WALK / TROT / GALLOP / JUMP",22,30);
  }
  function frame(now){
    const dt=lastFrame?Math.min((now-lastFrame)/1000,.032):0;lastFrame=now;
    const left=keys.ArrowLeft||keys.KeyA,right=keys.ArrowRight||keys.KeyD,up=keys.ArrowUp||keys.KeyW||keys.Space;
    update(dt,now,left,right,up,keys.KeyI);const v=Math.abs(wolf.vx);
    status.textContent=!wolf.grounded?(wolf.vy<0?"AIRBORNE · ASCENDING":"AIRBORNE · DESCENDING"):keys.KeyI&&v<12?"ALERT · FOCUSED":v>175?"GALLOPING":v>55?"TROTTING":v>5?"WALKING":"IDLE · ALERT";
    speedReadout.textContent=`${Math.round(v)} px/s`;drawArena();drawWolf(now,dt);requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
