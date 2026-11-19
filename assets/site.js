(function(){
var LOGO='<svg viewBox="0 0 400 400" aria-hidden="true"><g stroke-width="9" stroke-linejoin="round" stroke="#000"><polygon points="200,50 330,125 200,200 70,125" fill="#9CC2FF"/><polygon points="70,125 200,200 200,350 70,275" fill="#2F6BF0"/><polygon points="200,200 330,125 330,275 200,350" fill="#0F2A5E"/></g></svg>';
var MAIL='manifesttracking.updates@gmail.com';
var hd=document.getElementById('hd');
if(hd){hd.className='hd';hd.innerHTML='<div class="wrap"><a class="brand" href="/">'+LOGO+'Manifest</a><div class="hr"><a class="pill sm" href="/app/">Start now</a><button class="burger" id="bg" aria-label="Open menu" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button></div></div>';
 var d=document.createElement('div');d.className='drawer';d.id='dr';
 d.innerHTML='<div class="dp" role="dialog" aria-label="Menu"><div class="top"><a class="brand" href="/">'+LOGO+'Manifest</a><button class="burger" id="bx" aria-label="Close menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><nav><a href="/why/">Why Choose Manifest?</a><a href="/#pricing">Pricing</a><a href="/platform/">Platform Capabilities</a></nav><div class="bot"><a class="pill ghost" href="/app/?mode=signin">Login</a><a class="pill" href="/app/">Start now</a></div></div>';
 document.body.appendChild(d);
 var bg=document.getElementById('bg');
 function op(v){d.classList.toggle('on',v);bg.setAttribute('aria-expanded',v);document.body.style.overflow=v?'hidden':''}
 bg.onclick=function(){op(true)};document.getElementById('bx').onclick=function(){op(false)};
 d.addEventListener('click',function(e){if(e.target===d||e.target.closest('nav a'))op(false)});
 document.addEventListener('keydown',function(e){if(e.key==='Escape')op(false)});
}
var ft=document.getElementById('ft');
if(ft){ft.className='ft';ft.innerHTML='<div class="wrap"><div class="fg"><div><a class="brand" href="/">'+LOGO+'Manifest</a><p class="desc">Automated shipment visibility via WhatsApp &amp; email, without chasing transporters.</p><span class="ok-b"><i></i>All Systems Operational</span></div>'+
'<div><h4>Product</h4><ul><li><a href="/why/">Why Choose Manifest</a></li><li><a href="/platform/">Services &amp; AI</a></li><li><a href="/#pricing">Pricing Plans</a></li><li>Integrations <span class="soon">Coming soon</span></li><li><a href="/info/?p=changelog">What\'s New / Changelog</a></li></ul></div>'+
'<div><h4>Support &amp; Resources</h4><ul><li><a href="/info/?p=help">Help Center &amp; Guides</a></li><li><a href="mailto:'+MAIL+'?subject=Support%20ticket">Submit a Support Ticket</a></li><li><a href="/info/?p=whatsapp">WhatsApp &amp; Email Setup</a></li><li><a href="mailto:'+MAIL+'?subject=Book%20a%20demo">Book a Demo (Enterprise)</a></li><li><a href="mailto:'+MAIL+'">Contact Us</a></li></ul></div>'+
'<div><h4>Legal &amp; Compliance</h4><ul><li><a href="/info/?p=privacy">Privacy Policy</a></li><li><a href="/info/?p=terms">Terms of Service</a></li><li><a href="/info/?p=dpa">Data Processing Agreement (DPA)</a></li><li><a href="/info/?p=cookies">Cookie Policy</a></li><li><a href="/info/?p=security">Security &amp; Trust</a></li></ul></div></div><div class="cp">© '+new Date().getFullYear()+' Manifest. All rights reserved.</div></div>'}
/* pricing */
var P=[{n:'Starter',p:'$0',u:'/ forever',b:['5 active shipments at once','1 user','Unlimited email check-ins','6 AI email reads / mo','In-app delay alerts & board view','22+ messaging languages'],c:'Start Free'},
{n:'Growth',p:'$69',u:'/ mo',hot:1,b:['100 active shipments at once','1 user','500 WhatsApp check-ins / mo','250 AI email & PDF reads / mo','5 GB Document storage','Integrations <em>(Coming soon)</em>','Send from your own email'],c:'Start 3-day free trial'},
{n:'Pro',p:'$149',u:'/ mo',b:['500 active shipments at once','10 team members (role-based)','2,500 WhatsApp check-ins / mo','1,500 AI email & PDF reads / mo','25 GB Document storage','Priority 8h support','Everything in Growth'],c:'Start 3-day free trial'}];
window.renderPricing=function(el,cls){el.className=cls;el.innerHTML=P.map(function(x){return'<div class="pc'+(x.hot?' hot':'')+'">'+(x.hot?'<span class="bd">Most Popular</span>':'')+'<h3>'+x.n+'</h3><div class="pr">'+x.p+' <small>'+x.u+'</small></div><ul>'+x.b.map(function(i){return'<li><span>'+i+'</span></li>'}).join('')+'</ul><a class="pill'+(x.hot?' glow':'')+'" href="/app/">'+x.c+'</a></div>'}).join('')};
var pe=document.getElementById('pricing-grid');if(pe)renderPricing(pe,'hs');
var ph=document.getElementById('pricing-hs');if(ph)renderPricing(ph,'hs');
/* reveal */
var rv=document.querySelectorAll('.rv');
if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:.12});rv.forEach(function(r){io.observe(r)})}else rv.forEach(function(r){r.classList.add('in')});
/* resolve */
document.querySelectorAll('[data-resolve]').forEach(function(b){b.onclick=function(){var r=b.closest('.al');r.classList.add('done');var d=r.querySelector('.pd');d.className='pd g';b.outerHTML='<span class="bdg" style="margin:0;color:#34D399;border-color:#12382c">Resolved</span>';var s=r.querySelector('small');if(s)s.textContent='Resolved just now'}});
/* kanban */
var K={sea:{cols:[['In Transit',[['MSKU 4821937','Karachi → Rotterdam']]],['Customs',[['CMAU 7730215','Jebel Ali → Karachi']]],['Delivered',[['HLXU 6092274','Shanghai → Karachi']]]],docs:['Bill of Lading.pdf','Commercial Invoice.pdf']},
 truck:{cols:[['In Transit',[['TRK-4471','Karachi → Lahore'],['TRK-2290','Port Qasim → Faisalabad']]],['Customs',[['TRK-8815','Torkham → Peshawar']]],['Delivered',[['TRK-1034','Lahore → Multan']]]],docs:['Driver: Replied 2h ago','Delivery note.pdf']}};
var kb=document.getElementById('kb');
function rk(m){if(!kb)return;var k=K[m];kb.innerHTML='<div class="kb">'+k.cols.map(function(c){return'<div class="kc"><h4>'+c[0]+'</h4>'+c[1].map(function(s){return'<div class="kk"><b>'+s[0]+'</b><span>'+s[1]+'</span></div>'}).join('')+'</div>'}).join('')+'</div><div class="docs">Attached docs: '+k.docs.map(function(d){return'<em>'+d+'</em>'}).join('')+'</div>';
 document.querySelectorAll('#tg button').forEach(function(b){b.classList.toggle('on',b.dataset.m===m)})}
if(kb){document.querySelectorAll('#tg button').forEach(function(b){b.onclick=function(){rk(b.dataset.m)}});rk('sea')}
})();
