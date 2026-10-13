// Multi-account R2 controls. Secrets are write-only and never returned by the API.
async function loadR2Accounts() {
  const d=await api('/api/r2-accounts');state.r2Accounts=d.accounts;
  document.querySelector('#r2Spaces').innerHTML=d.accounts.map(a=>`<button class="storage-tab" data-storage="r2:${esc(a.id)}"><span class="storage-dot r2"></span><span><b>${esc(a.name)}</b><small>${esc(a.bucket)}</small></span><i>›</i></button>`).join('');
  document.querySelectorAll('.storage-tab').forEach(x=>{x.classList.toggle('active',x.dataset.storage===state.storage);x.onclick=()=>setStorage(x.dataset.storage)});
  renderR2Connections();
}
function selectedR2(){return (state.r2Accounts||[]).find(a=>'r2:'+a.id===state.storage)}
function renderR2Connections(){
  document.querySelector('#r2Connections').innerHTML=(state.r2Accounts||[]).map(a=>`<div class="r2-connection"><div><b>${esc(a.name)}</b><small>${esc(a.bucket)} · ${esc(a.accountId.slice(0,8))}…</small></div><button type="button" class="table-button" data-edit-r2="${esc(a.id)}">编辑</button></div>`).join('')||'<p class="muted">尚未添加其他 R2 账号，原 R2 空间不受影响。</p>';
}
function editR2(id=''){
  const a=(state.r2Accounts||[]).find(x=>x.id===id)||{};
  document.querySelector('#r2Id').value=a.id||'';
  for(const [field,key]of [['r2Name','name'],['r2Account','accountId'],['r2Bucket','bucket'],['r2Prefix','prefix'],['r2Jurisdiction','jurisdiction'],['r2Capacity','capacityGb']])document.querySelector('#'+field).value=a[key]??(key==='prefix'?'pan-cloudflare/':key==='capacityGb'?10:'');
  for(const field of ['r2Account','r2Bucket','r2Prefix','r2Jurisdiction'])document.querySelector('#'+field).disabled=Boolean(id);
  document.querySelector('#r2Access').value='';document.querySelector('#r2Secret').value='';
  document.querySelector('#r2Status').textContent=id?'密钥留空沿用原值；存储定位固定，避免旧文件及分享失效。':'填写目标账号的 R2 S3 凭据，测试成功后保存。';
  document.querySelector('#removeR2').hidden=!id;
}
document.querySelector('#openR2Settings').onclick=async()=>{document.querySelector('#r2Dialog').showModal();editR2();try{await loadR2Accounts()}catch(e){document.querySelector('#r2Status').textContent=e.message}};
document.querySelector('#newR2').onclick=()=>editR2();
document.querySelector('#r2Connections').onclick=e=>{const b=e.target.closest('[data-edit-r2]');if(b)editR2(b.dataset.editR2)};
document.querySelector('#r2Close').onclick=()=>document.querySelector('#r2Dialog').close();
document.querySelector('#saveR2').onclick=async()=>{
  const b=document.querySelector('#saveR2'),status=document.querySelector('#r2Status');b.disabled=true;status.textContent='正在验证 R2 桶连接…';
  try{
    const data={};for(const[field,key]of [['r2Id','id'],['r2Name','name'],['r2Account','accountId'],['r2Bucket','bucket'],['r2Prefix','prefix'],['r2Jurisdiction','jurisdiction'],['r2Capacity','capacityGb'],['r2Access','accessKey'],['r2Secret','secretKey']])data[key]=document.querySelector('#'+field).value;
    const d=await api('/api/r2-accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    document.querySelector('#r2Access').value='';document.querySelector('#r2Secret').value='';
    await loadR2Accounts();editR2(d.account.id);status.textContent='连接已验证并保存；请确认目标桶已配置下方 CORS 后再上传。';toast('R2 连接已保存');
    if(state.storage==='r2:'+d.account.id)loadUsage(true);
  }catch(e){status.textContent=e.message}finally{b.disabled=false}
};
document.querySelector('#removeR2').onclick=async()=>{
  const id=document.querySelector('#r2Id').value;if(!confirm('移除此 R2 连接？有文件或文件夹时会拒绝移除。'))return;
  try{await api('/api/r2-accounts',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});await loadR2Accounts();editR2();if(state.storage==='r2:'+id)setStorage('r2');toast('R2 连接已移除')}catch(e){document.querySelector('#r2Status').textContent=e.message}
};
document.querySelector('#r2Cors').textContent=JSON.stringify([{AllowedOrigins:[location.origin,'https://pan.ailxw.com','https://isoziyuan-pan.pages.dev'].filter((v,i,a)=>a.indexOf(v)===i),AllowedMethods:['GET','PUT','HEAD'],AllowedHeaders:['Content-Type'],ExposeHeaders:['ETag'],MaxAgeSeconds:3600}],null,2);
