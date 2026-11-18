/* Manifest hero globe: one tiny WebGL2 shader, no libraries.
   Cheap by design: ~30fps cap, capped resolution, auto-lowers quality on slow devices,
   pauses when off-screen or tab hidden, honours "reduce motion", falls back to the still photo. */
(function(){
var hero=document.querySelector('.hero'),cv=document.getElementById('globe');
if(!hero||!cv)return;
var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
var gl=cv.getContext('webgl2',{antialias:false,alpha:false,depth:false,stencil:false,powerPreference:'low-power',preserveDrawingBuffer:false});
if(!gl){hero.classList.add('still');return}
var VS='#version 300 es\nin vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
var FS='#version 300 es\nprecision highp float;precision highp sampler2D;\n'+
'uniform vec2 res;uniform float t,hz,tilt,spin,R,D;uniform sampler2D tN;out vec4 o;\n'+
'const float PI=3.14159265;\n'+
'float h21(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}\n'+
'float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}\n'+
'vec3 sky(vec2 p,vec2 fc){return vec3(0.);}\n'+
'void main(){\n'+
' vec2 fc=gl_FragCoord.xy;vec2 p=(2.*fc-res)/res.x;\n'+
' float F=1.5;float ytop=(2.*hz-1.)*res.y/res.x;float cy=R-ytop*D/F;\n'+
' vec3 ro=vec3(0.),rd=normalize(vec3(p,-F)),C=vec3(0.,-cy,-D);\n'+
' vec3 oc=ro-C;float b=dot(oc,rd),c=dot(oc,oc)-R*R,d=b*b-c;vec3 col;\n'+
' if(d>0.){\n'+
'  float tt=-b-sqrt(d);vec3 n=normalize(rd*tt-C);float ndv=clamp(dot(n,-rd),0.,1.);\n'+
'  vec3 q=n;float ct=cos(tilt),st=sin(tilt);q=vec3(q.x,q.y*ct-q.z*st,q.y*st+q.z*ct);\n'+
'  float cs=cos(spin),ss=sin(spin);q=vec3(q.x*cs-q.z*ss,q.y,q.x*ss+q.z*cs);\n'+
'  float u=atan(q.x,q.z)/(2.*PI)+.5;float v=asin(clamp(q.y,-1.,1.))/PI+.5;\n'+
'  vec2 uv=vec2(u,v),uvB=vec2(fract(u+.5)-.5,v);\n'+
'  vec2 dx=dFdx(uv),dy=dFdy(uv),bx=dFdx(uvB),by=dFdy(uvB);\n'+
'  if(abs(bx.x)<abs(dx.x))dx.x=bx.x;if(abs(by.x)<abs(dy.x))dy.x=by.x;\n'+
'  vec3 L=textureGrad(tN,uv,dx,dy).rgb;\n'+
'  float lum=dot(L,vec3(.3,.59,.11));\n'+
'  col=vec3(.01,.018,.045)+L*vec3(1.1,1.05,1.2)*1.7+vec3(1.,.66,.2)*pow(lum,1.5)*2.4;\n'+
'  float fr=1.-ndv;\n'+
'  col*=.55+.45*ndv;\n'+
'  col+=vec3(.10,.36,.95)*pow(fr,2.6)*1.05+vec3(.2,.9,.9)*pow(fr,5.)*.55+vec3(.75,.88,1.)*pow(fr,10.)*.9;\n'+
' }else{\n'+
'  float tc=max(-b,0.);vec3 qq=ro+rd*tc;float dist=max(length(qq-C)-R,0.)/R*3.4;\n'+
'  float g=exp(-dist*10.);col=sky(p,fc)*(1.-clamp(g*1.5,0.,1.))+vec3(.12,.42,1.)*g*.8+vec3(.1,.85,.8)*g*g*.55;\n'+
' }\n'+
' col+=(h21(fc+.5)-.5)/180.;\n'+
' o=vec4(col,1.);}\n';
function sh(t,s){var x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);if(!gl.getShaderParameter(x,gl.COMPILE_STATUS)){console.warn(gl.getShaderInfoLog(x));return null}return x}
var v=sh(gl.VERTEX_SHADER,VS),f=sh(gl.FRAGMENT_SHADER,FS);if(!v||!f){hero.classList.add('still');return}
var pr=gl.createProgram();gl.attachShader(pr,v);gl.attachShader(pr,f);gl.linkProgram(pr);
if(!gl.getProgramParameter(pr,gl.LINK_STATUS)){hero.classList.add('still');return}
gl.useProgram(pr);
var bf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,bf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
var loc=gl.getAttribLocation(pr,'a');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
var U={};['res','t','hz','tilt','spin','R','D','tN'].forEach(function(n){U[n]=gl.getUniformLocation(pr,n)});
var scale=Math.min(window.devicePixelRatio||1,1.5),ready=false,vis=true,run=false,last=0,t0=performance.now(),slow=0,n=0,acc=0;
var small=Math.min(screen.width,screen.height)<700;if(small)scale=Math.min(scale,1.25);
function size(){var w=hero.clientWidth,h=hero.clientHeight,s=scale;
 var px=w*h*s*s,cap=small?1100000:2200000;if(px>cap)s*=Math.sqrt(cap/px);
 cv.width=Math.max(2,Math.round(w*s));cv.height=Math.max(2,Math.round(h*s));gl.viewport(0,0,cv.width,cv.height)}
function draw(now){var t=(now-t0)/1000;
 gl.uniform2f(U.res,cv.width,cv.height);gl.uniform1f(U.t,t);var P=window.__GP||{};gl.uniform1f(U.R,P.R||12);gl.uniform1f(U.D,P.D||11);gl.uniform1f(U.hz,P.hz||.5);gl.uniform1f(U.tilt,P.tilt!=null?P.tilt:.2);gl.uniform1f(U.spin,(P.spin!=null?P.spin:-.12)+(reduce?0:t*.012));
 gl.drawArrays(gl.TRIANGLES,0,3)}
function loop(now){if(!run)return;requestAnimationFrame(loop);
 if(now-last<33)return;var dt=now-last;last=now;
 if(++n>10){acc+=dt;if(n%30===0){if(acc/30>46&&scale>.6){scale*=.8;size();slow++}acc=0}}
 draw(now)}
function go(){if(run||!ready||!vis||document.hidden||reduce)return;run=true;last=0;requestAnimationFrame(loop)}
function stop(){run=false}
function start(){
 var img=new Image();img.onload=function(){
  var tx=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tx);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,img);gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.uniform1i(U.tN,0);size();ready=true;draw(performance.now());cv.classList.add('on');go()};
 img.src='/assets/earth-night.jpg?v=8'}
if('ResizeObserver' in window)new ResizeObserver(function(){if(ready){size();draw(performance.now())}}).observe(hero);
if('IntersectionObserver' in window)new IntersectionObserver(function(e){vis=e[0].isIntersecting;vis?go():stop()}).observe(hero);
document.addEventListener('visibilitychange',function(){document.hidden?stop():go()});
cv.addEventListener('webglcontextlost',function(e){e.preventDefault();stop();ready=false;cv.classList.remove('on')});
var go2=function(){(window.requestIdleCallback||function(f){setTimeout(f,150)})(start)};
if(document.readyState==='complete')go2();else addEventListener('load',go2);
})();
