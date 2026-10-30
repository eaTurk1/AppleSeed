// JXA runs in a short-lived, time-bounded worker. No page scripts, URLs or page content.
function run(argv) {
  try {
    const allowed = ['com.google.Chrome','com.google.Chrome.beta','com.google.Chrome.canary','com.microsoft.edgemac','com.brave.Browser','org.chromium.Chromium','com.vivaldi.Vivaldi'];
    const bundle = argv[0], op = argv[1];
    if (allowed.indexOf(bundle) < 0 || ['list','select'].indexOf(op) < 0) throw Error('Invalid browser request.');
    const browser = Application(bundle);
    if (!browser.running()) throw Error('The browser closed. Refresh Apps.');
    const target = op === 'select' ? JSON.parse(argv[2]) : null;
    const windows = browser.windows();
    const tabs = [];
    for (let wi = 0; wi < Math.min(windows.length,32); wi++) {
      const win = windows[wi], windowId = String(win.id());
      if (target && windowId !== target.windowId) continue;
      const children = win.tabs();
      if (target) {
        const currentIds = win.tabs.id();
        for (let ti = 0; ti < currentIds.length; ti++) {
          if (String(currentIds[ti]) !== target.tabId) continue;
          win.activeTabIndex = ti + 1;
          win.minimized = false;
          win.index = 1;
          browser.activate();
          return JSON.stringify({ok:true});
        }
        throw Error('That tab closed or moved to another window. Refresh tabs.');
      }
      const titles = win.tabs.title(), ids = win.tabs.id(), active = win.activeTabIndex();
      for (let ti = 0; ti < Math.min(children.length,500-tabs.length); ti++) {
        tabs.push({windowId:windowId,tabId:String(ids[ti]),title:String(titles[ti] || 'Untitled tab').slice(0,512),window:wi+1,active:active===ti+1});
      }
      if (tabs.length >= 500) break;
    }
    if (target) throw Error('That browser window closed. Refresh tabs.');
    return JSON.stringify({ok:true,tabs:tabs,truncated:tabs.length>=500 || windows.length>32});
  } catch (error) {
    return JSON.stringify({ok:false,permission:Number(error.errorNumber)===-1743,error:Number(error.errorNumber)===-1743?'Allow AppleSeed to control this browser in Mac System Settings > Privacy & Security > Automation, then refresh tabs.':'The browser could not complete this action. Refresh tabs and try again.'});
  }
}
