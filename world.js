(() => {
  const canvas = document.querySelector('[data-world-canvas]');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const connect = document.querySelector('[data-world-connect]');
  const walletLabel = document.querySelector('[data-world-wallet]');
  const nftLabel = document.querySelector('[data-world-nft]');
  const avatar = document.querySelector('[data-world-avatar]');
  const dialog = document.querySelector('[data-world-dialog]');
  const placeLabel = document.querySelector('[data-world-place]');
  const valueLabel = document.querySelector('[data-world-value]');
  const copyLabel = document.querySelector('[data-world-copy]');
  const closeDialog = document.querySelector('[data-world-close]');
  const WORLD = { width: 1800, height: 1200 };
  const player = { x: 900, y: 650, speed: 260, image: new Image(), name: 'Guest Rare' };
  player.image.src = 'assets/9.png';
  const keys = new Set();
  let last = performance.now();
  let stats = { marketCap: null, volume: null, liquidity: null, holders: null, floor: null, owners: null };
  let connectedAddress = '';

  const landmarks = [
    { x:280,y:265,w:260,h:170,title:'VOLUME TOWER',key:'volume',color:'#5530df',copy:'All-time $RARE trading volume across tracked pools.' },
    { x:1260,y:220,w:290,h:190,title:'MARKET-CAP GATE',key:'marketCap',color:'#b6ff00',copy:'Live $RARE market capitalization from the DEX feed.' },
    { x:220,y:810,w:300,h:210,title:'FLOOR POND',key:'floor',color:'#36d6ff',copy:'The live Ultra Rares collection floor on OpenSea.' },
    { x:760,y:210,w:260,h:180,title:'HOLDER HOUSE',key:'holders',color:'#ffdf4d',copy:'Unique wallets currently holding $RARE.' },
    { x:1220,y:790,w:310,h:205,title:'LIQUIDITY GARDEN',key:'liquidity',color:'#ff5e7d',copy:'Liquidity supporting the live $RARE market.' },
    { x:720,y:850,w:320,h:190,title:'RARE CLUB',key:'owners',color:'#f4f1e9',copy:'Ultra Rares collectors. Only 420 tokens exist.' },
  ];

  const money = (value) => value == null ? 'FEED RETRYING' : Number(value).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
  const values = () => ({ marketCap:money(stats.marketCap),volume:money(stats.volume),liquidity:money(stats.liquidity),holders:stats.holders == null?'FEED RETRYING':`${stats.holders} WALLETS`,floor:stats.floor==null?'FEED RETRYING':`${Number(stats.floor).toFixed(4)} ETH`,owners:stats.owners==null?'FEED RETRYING':`${stats.owners} / 420` });
  const short = (address) => `${address.slice(0,6)}…${address.slice(-4)}`;
  const ipfs = (url) => String(url || '').replace('ipfs://','https://dweb.link/ipfs/');

  async function loadStats(){
    try{
      const [market,collection]=await Promise.all([fetch('/api/rare-market',{cache:'no-store'}).then(r=>r.json()),fetch('/api/collection-stats',{cache:'no-store'}).then(r=>r.json())]);
      stats={marketCap:market.marketCap,volume:market.totalVolumeUsd,liquidity:market.liquidityUsd,holders:market.holderCount,floor:collection.floorNative,owners:collection.owners};
    }catch{}
  }

  function resize(){const dpr=Math.min(2,devicePixelRatio||1);canvas.width=Math.floor(innerWidth*dpr);canvas.height=Math.floor((innerHeight-canvas.getBoundingClientRect().top)*dpr);ctx.setTransform(dpr,0,0,dpr,0,0)}
  function building(item,camera){const x=Math.round(item.x-camera.x),y=Math.round(item.y-camera.y);ctx.fillStyle='#000';ctx.fillRect(x-8,y-8,item.w+16,item.h+16);ctx.fillStyle=item.color;ctx.fillRect(x,y,item.w,item.h);ctx.fillStyle='rgba(0,0,0,.16)';for(let yy=14;yy<item.h-30;yy+=32)for(let xx=14;xx<item.w-14;xx+=38)ctx.fillRect(x+xx,y+yy,20,18);ctx.fillStyle='#000';ctx.fillRect(x+15,y+item.h-48,item.w-30,35);ctx.fillStyle=item.color;ctx.font='900 15px Arial';ctx.textAlign='center';ctx.fillText(item.title,x+item.w/2,y+item.h-25)}
  function draw(){
    const viewW=canvas.clientWidth,viewH=canvas.clientHeight,camera={x:Math.max(0,Math.min(WORLD.width-viewW,player.x-viewW/2)),y:Math.max(0,Math.min(WORLD.height-viewH,player.y-viewH/2))};
    ctx.fillStyle='#9dcc46';ctx.fillRect(0,0,viewW,viewH);const tile=48;for(let y=-camera.y%tile;y<viewH;y+=tile)for(let x=-camera.x%tile;x<viewW;x+=tile){ctx.fillStyle=((Math.floor((x+camera.x)/tile)+Math.floor((y+camera.y)/tile))%2)?'#94c23e':'#a4d34c';ctx.fillRect(x,y,tile,tile)}
    ctx.fillStyle='#ead993';ctx.fillRect(0,Math.round(560-camera.y),viewW,120);ctx.fillRect(Math.round(830-camera.x),0,140,viewH);ctx.fillStyle='#000';ctx.font='900 13px Arial';ctx.textAlign='left';ctx.fillText('ROBINHOOD CHAIN · LIVE DATA DISTRICT',24,Math.round(625-camera.y));
    landmarks.forEach(item=>building(item,camera));
    const px=Math.round(player.x-camera.x),py=Math.round(player.y-camera.y);ctx.save();ctx.imageSmoothingEnabled=false;ctx.beginPath();ctx.rect(px-30,py-46,60,60);ctx.clip();ctx.drawImage(player.image,px-30,py-46,60,60);ctx.restore();ctx.strokeStyle='#000';ctx.lineWidth=4;ctx.strokeRect(px-30,py-46,60,60);ctx.fillStyle='#000';ctx.fillRect(px-40,py+20,80,20);ctx.fillStyle='#b6ff00';ctx.font='900 10px Arial';ctx.textAlign='center';ctx.fillText(player.name.toUpperCase().slice(0,14),px,py+34);
  }
  function nearby(){return landmarks.find(item=>player.x>item.x-70&&player.x<item.x+item.w+70&&player.y>item.y-70&&player.y<item.y+item.h+70)}
  function inspect(){const item=nearby();if(!item)return;placeLabel.textContent=item.title;valueLabel.textContent=values()[item.key];copyLabel.textContent=item.copy;dialog.hidden=false}
  function tick(now){const dt=Math.min(.04,(now-last)/1000);last=now;let dx=0,dy=0;if(keys.has('arrowleft')||keys.has('a'))dx--;if(keys.has('arrowright')||keys.has('d'))dx++;if(keys.has('arrowup')||keys.has('w'))dy--;if(keys.has('arrowdown')||keys.has('s'))dy++;if(dx&&dy){dx*=.707;dy*=.707}player.x=Math.max(35,Math.min(WORLD.width-35,player.x+dx*player.speed*dt));player.y=Math.max(55,Math.min(WORLD.height-35,player.y+dy*player.speed*dt));draw();requestAnimationFrame(tick)}
  addEventListener('keydown',event=>{const key=event.key.toLowerCase();if(['arrowleft','arrowright','arrowup','arrowdown','w','a','s','d',' '].includes(key))event.preventDefault();keys.add(key);if(key===' ')inspect()});addEventListener('keyup',event=>keys.delete(event.key.toLowerCase()));
  document.querySelectorAll('[data-move]').forEach(button=>{const key={up:'arrowup',down:'arrowdown',left:'arrowleft',right:'arrowright'}[button.dataset.move];if(button.dataset.move==='action'){button.addEventListener('click',inspect);return}const start=e=>{e.preventDefault();keys.add(key)},stop=e=>{e.preventDefault();keys.delete(key)};button.addEventListener('pointerdown',start);button.addEventListener('pointerup',stop);button.addEventListener('pointercancel',stop)});
  closeDialog.addEventListener('click',()=>dialog.hidden=true);
  connect.addEventListener('click',async()=>{if(!window.ethereum?.request){nftLabel.textContent='Wallet extension not found';return}try{const accounts=await window.ethereum.request({method:'eth_requestAccounts'});const address=String(accounts?.[0]||'');if(!/^0x[a-fA-F0-9]{40}$/.test(address))throw new Error();connectedAddress=address.toLowerCase();walletLabel.textContent=short(address);connect.textContent=short(address);nftLabel.textContent='Finding your Ultra Rares…';const owned=await fetch(`/api/owned-rares?address=${encodeURIComponent(address)}`).then(r=>r.json());if(owned.items?.length){const rare=owned.items[0];player.name=rare.name||`Rare #${rare.tokenId}`;nftLabel.textContent=`${owned.count} owned · playing as ${player.name}`;if(rare.image){player.image.src=ipfs(rare.image);avatar.src=ipfs(rare.image)}}else nftLabel.textContent='No Ultra Rare found · guest avatar active'}catch{nftLabel.textContent='Connection cancelled · guest mode active'}});
  addEventListener('resize',resize);resize();loadStats();setInterval(loadStats,60000);requestAnimationFrame(tick);
})();
