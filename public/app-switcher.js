// Only private-session APIs are used. App/tab titles live in this sheet's memory only.
export function monitorForApp(displayId, hosts = [], monitors = []) {
  const index = hosts.findIndex(s => String(s.id) === String(displayId));
  if (index < 0 || monitors.length < 2) return null;
  return monitors.find(s => s.id === `host-${displayId}`)?.id || monitors[index + 1]?.id || null;
}

export class AppSwitcher {
  constructor(desktop, { session, request = (...args) => fetch(...args), notify = () => {} } = {}) {
    this.desktop = desktop; this.session = session; this.request = request; this.notify = notify;
    this.generation = 0; this.pending = new Set(); this.apps = []; this.expanded = new Map(); this.busy = false;
    const doc = document;
    this.button = doc.createElement('button'); this.button.id = 'apps-toggle'; this.button.type = 'button'; this.button.className = 'secondary quick-action';
    this.button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg><span>Apps</span>';
    this.button.setAttribute('aria-haspopup','dialog'); this.button.setAttribute('aria-expanded','false');
    desktop.$('keyboard-toggle').before(this.button); desktop.$('keyboard-toggle').parentElement.classList.add('with-apps');
    this.panel = doc.createElement('dialog'); this.panel.id = 'apps-sheet'; this.panel.setAttribute('aria-label','Open applications');
    this.panel.innerHTML = '<div class="apps-heading"><div><h2>Open apps</h2><p>Tap an app. Expand to choose a window or browser tab.</p></div><button type="button" class="secondary" id="apps-close" aria-label="Close apps">×</button></div><div class="apps-search"><input id="apps-search" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Filter apps and loaded tabs" placeholder="Find an app or loaded tab"><button type="button" id="apps-refresh" class="secondary" aria-label="Refresh open apps">↻</button></div><p id="apps-status" class="small" role="status"></p><div id="apps-list"></div><p class="apps-hint">Three-finger swipe up on the desktop opens Apps.</p>';
    doc.body.append(this.panel);
    this.$ = id => doc.getElementById(id);
    this.button.addEventListener('click', () => this.open());
    this.$('apps-close').addEventListener('click', () => this.close());
    this.$('apps-refresh').addEventListener('click', () => this.load());
    this.$('apps-search').addEventListener('input', () => this.paint());
    this.panel.addEventListener('close', () => { if(!this.destroyed && !this.panel.open)this.clear(); });
    this.panel.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    this.panel.addEventListener('click', event => { if (event.target === this.panel) { const r=this.panel.getBoundingClientRect(); if(event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom)this.close(); } });
    this.background = () => { if (document.hidden) this.close(); };
    document.addEventListener('visibilitychange',this.background);
  }
  async command(op, values = {}) {
    const abort = new AbortController(); this.pending.add(abort);
    const timeout = setTimeout(() => abort.abort(), 11000);
    try {
      const response = await this.request('/api/apps', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({op, session:this.session,...values}), signal:abort.signal });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw Object.assign(Error(result?.error || (response.status===404 ? 'Update the AppleSeed Mac companion and service to use Apps.' : response.status===409 ? 'Session ended. Reconnect to your Mac.' : 'Apps could not be loaded. Try Refresh.')), {permission:!!result?.permission});
      return result;
    } finally { clearTimeout(timeout); this.pending.delete(abort); }
  }
  open() {
    if (this.destroyed || this.panel.open) return;
    this.desktop.release(); this.desktop.toggleKeyboard(false); this.desktop.options.closeUnlock?.(); this.desktop.$('session-tools').hidden=true;
    this.button.setAttribute('aria-expanded','true'); this.panel.showModal(); this.$('apps-close').focus(); this.load();
  }
  clear() { this.generation++; for(const p of this.pending)p.abort(); this.pending.clear(); this.apps=[];this.expanded.clear();this.busy=false;this.$('apps-search').value='';this.$('apps-list').replaceChildren();this.button.setAttribute('aria-expanded','false'); }
  close() { if(this.panel.open)this.panel.close(); this.clear(); this.desktop.nativeCall('keyboard',{enabled:false}); }
  async load() {
    for(const p of this.pending)p.abort();
    const generation=++this.generation; this.apps=[];this.expanded.clear();this.busy=false;this.$('apps-search').value='';this.$('apps-status').textContent='Loading open apps…';this.$('apps-list').replaceChildren();
    try { const result=await this.command('list'); if(generation!==this.generation || !this.panel.open)return; this.apps=result.apps||[];this.$('apps-status').textContent=this.apps.length ? `${this.apps.length} open apps`:'No open apps.';this.paint(); }
    catch(error){if(generation===this.generation && this.panel.open)this.$('apps-status').textContent=error.name==='AbortError'?'Mac did not respond. Try Refresh.':error.message;}
  }
  async expand(app) {
    if(this.expanded.has(app.id)){this.expanded.delete(app.id);this.paint();return;}
    const generation=this.generation, state={loading:true,tabs:[]};this.expanded.set(app.id,state);this.paint();
    try{const result=await this.command(app.browser?'tabs':'windows',{app:app.id});if(generation!==this.generation || this.expanded.get(app.id)!==state)return;Object.assign(state,{loading:false,tabs:result.tabs||[],truncated:result.truncated});}
    catch(error){if(generation!==this.generation || this.expanded.get(app.id)!==state)return;state.loading=false;state.permission=error.permission;state.error=error.name==='AbortError'?'Browser did not respond. Collapse and expand to retry.':error.message;}
    if(this.panel.open)this.paint();
  }
  async permission(app) {
    const state=this.expanded.get(app.id), generation=this.generation;if(!state)return;
    try{const result=await this.command('browser-permission',{app:app.id});if(generation!==this.generation || this.expanded.get(app.id)!==state)return;state.error=result.permissionPending?'Approve AppleSeed’s browser access on your Mac. Then collapse and expand this browser to refresh tabs.':'Permission is ready. Collapse and expand to load tabs.';this.paint();}
    catch(error){if(generation===this.generation){state.error=error.message;this.paint();}}
  }
  async activate(app, tab) {
    if(this.busy)return;this.busy=true;const generation=this.generation;this.paint();this.$('apps-status').textContent=tab?'Opening tab…':`Opening ${app.name}…`;
    try{
      this.desktop.release();const result=await this.command(tab?(tab.kind==='window'?'window-activate':'tab-activate'):'activate',{app:app.id,...(tab?(tab.kind==='window'?{window:tab.id}:{tab:tab.id}):{})});
      if(generation!==this.generation || !this.panel.open)return;
      const monitor=monitorForApp(result.displayId,this.desktop.hostScreens,this.desktop.monitors);
      if(monitor && this.desktop.$('monitor-select').value!==monitor)this.desktop.selectMonitor(monitor);
      this.close();
    }catch(error){if(generation===this.generation && this.panel.open){this.$('apps-status').textContent=error.name==='AbortError'?'No response. Refresh before trying again.':error.message;this.busy=false;this.paint();}}
  }
  paint() {
    const list=this.$('apps-list'), query=this.$('apps-search').value.trim().toLocaleLowerCase();list.replaceChildren();let visible=0;
    for(const app of this.apps){
      const state=this.expanded.get(app.id), appMatch=app.name.toLocaleLowerCase().includes(query), tabs=(state?.tabs||[]).filter(t=>appMatch || t.title.toLocaleLowerCase().includes(query));
      if(!appMatch && !tabs.length)continue;visible++;
      const row=document.createElement('section');row.className='app-entry';
      const heading=document.createElement('div');heading.className='app-row';
      const activate=document.createElement('button');activate.type='button';activate.className='app-activate';activate.disabled=this.busy;activate.setAttribute('aria-label',`Switch to ${app.name}`);
      if(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(app.icon||'')){const image=document.createElement('img');image.src=app.icon;image.alt='';image.width=32;image.height=32;activate.append(image);}
      const name=document.createElement('span');name.textContent=app.name;activate.append(name);
      if(app.active){const current=document.createElement('small');current.textContent='Current';activate.append(current);}
      activate.addEventListener('click',()=>this.activate(app));heading.append(activate);
      {const expand=document.createElement('button');expand.type='button';expand.className='app-expand';expand.textContent=state?'⌃':'⌄';expand.setAttribute('aria-label',`${state?'Collapse':'Expand'} ${app.name} ${app.browser?'tabs':'windows'}`);expand.setAttribute('aria-expanded',String(!!state));expand.disabled=this.busy;expand.addEventListener('click',()=>this.expand(app));heading.append(expand);}
      row.append(heading);
      if(state){const children=document.createElement('div');children.className='app-tabs';
        if(state.loading || state.error || !state.tabs.length){const note=document.createElement('p');note.textContent=state.loading?(app.browser?'Loading tabs…':'Loading windows…'):state.error||(app.browser?'No browser tabs open.':'No app windows open.');children.append(note);}
        if(state.permission){const allow=document.createElement('button');allow.type='button';allow.className='secondary browser-permission';allow.textContent='Request browser access on Mac';allow.addEventListener('click',()=>this.permission(app));children.append(allow);}
        for(const tab of tabs){const button=document.createElement('button');button.type='button';button.className='app-tab';button.disabled=this.busy;const title=document.createElement('span');title.textContent=tab.title;const window=document.createElement('small');window.textContent=`Window ${tab.window}${tab.active?' · Selected':''}`;button.append(title,window);button.addEventListener('click',()=>this.activate(app,tab));children.append(button);}
        if(state.truncated){const note=document.createElement('p');note.textContent='Showing the first 500 tabs across up to 32 windows.';children.append(note);} row.append(children);
      }
      list.append(row);
    }
    if(query && !visible){const note=document.createElement('p');note.className='small';note.textContent='No matching apps or loaded tabs. Expand a browser to load its tabs.';list.append(note);}
  }
  destroy(){this.close();this.destroyed=true;document.removeEventListener('visibilitychange',this.background);this.panel.remove();this.button.remove();}
}
