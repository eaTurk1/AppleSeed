#import <libproc.h>

// App and tab references are short-lived opaque capabilities, never executable input.
@interface SeedAppSwitcher : NSObject
@property(strong) NSMutableDictionary *apps;
@property(strong) NSMutableDictionary *tabs;
@property(strong) NSMutableDictionary *windows;
@property(strong) NSMutableSet *permissionRequests;
- (NSDictionary *)handle:(NSDictionary *)request;
@end
@implementation SeedAppSwitcher
- (instancetype)init { if ((self=[super init])) { self.apps=[NSMutableDictionary new]; self.tabs=[NSMutableDictionary new]; self.windows=[NSMutableDictionary new]; self.permissionRequests=[NSMutableSet new]; } return self; }
- (BOOL)browser:(NSString *)bundle {
 return [@[@"com.google.Chrome",@"com.google.Chrome.beta",@"com.google.Chrome.canary",@"com.microsoft.edgemac",@"com.brave.Browser",@"org.chromium.Chromium",@"com.vivaldi.Vivaldi"] containsObject:bundle?:@""];
}
- (NSDictionary *)failure:(NSString *)message { return @{@"ok":@NO,@"error":message}; }
- (BOOL)unlocked {
 NSDictionary *s=CFBridgingRelease(CGSessionCopyCurrentDictionary());
 return s && [s[@"kCGSSessionOnConsoleKey"] boolValue] && ![s[@"CGSSessionScreenIsLocked"] boolValue];
}
- (NSString *)processStart:(pid_t)pid {
 struct proc_bsdinfo info; int size=proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&info,sizeof(info));
 return size==sizeof(info)?[NSString stringWithFormat:@"%llu:%llu",(unsigned long long)info.pbi_start_tvsec,(unsigned long long)info.pbi_start_tvusec]:nil;
}
- (NSRunningApplication *)target:(NSString *)token {
 NSDictionary *item=self.apps[token]; NSRunningApplication *app=item[@"app"];
 if (!app || app.terminated || NSDate.date.timeIntervalSince1970-[item[@"time"] doubleValue]>300) return nil;
 NSRunningApplication *current=[NSRunningApplication runningApplicationWithProcessIdentifier:app.processIdentifier];
 return current && [item[@"start"] isEqual:[self processStart:app.processIdentifier]] && [current.bundleIdentifier isEqual:app.bundleIdentifier]?current:nil;
}
- (NSString *)icon:(NSImage *)image {
 if (!image) return @"";
 NSImage *small=[[NSImage alloc] initWithSize:NSMakeSize(32,32)];
 [small lockFocus]; [image drawInRect:NSMakeRect(0,0,32,32) fromRect:NSZeroRect operation:NSCompositingOperationCopy fraction:1]; [small unlockFocus];
 NSBitmapImageRep *rep=[[NSBitmapImageRep alloc] initWithData:small.TIFFRepresentation];
 NSData *png=[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
 return png.length<16384?[@"data:image/png;base64," stringByAppendingString:[png base64EncodedStringWithOptions:0]]:@"";
}
- (NSDictionary *)location:(NSRunningApplication *)app {
 // Window geometry uses macOS desktop coordinates, including monitors left of the main display.
 CGRect rect=CGRectNull;
 AXUIElementRef owner=AXUIElementCreateApplication(app.processIdentifier); AXUIElementSetMessagingTimeout(owner,.35);
 CFTypeRef window=NULL, position=NULL, size=NULL;
 if (AXUIElementCopyAttributeValue(owner,kAXFocusedWindowAttribute,&window)==kAXErrorSuccess) {
  AXUIElementSetMessagingTimeout(window,.25);
  if (AXUIElementCopyAttributeValue(window,kAXPositionAttribute,&position)==kAXErrorSuccess && AXUIElementCopyAttributeValue(window,kAXSizeAttribute,&size)==kAXErrorSuccess && CFGetTypeID(position)==AXValueGetTypeID() && CFGetTypeID(size)==AXValueGetTypeID()) {
   CGPoint p; CGSize s;
   if(AXValueGetValue(position,kAXValueCGPointType,&p)&&AXValueGetValue(size,kAXValueCGSizeType,&s)) rect=CGRectMake(p.x,p.y,s.width,s.height);
  }
 }
 if (position) CFRelease(position); if(size) CFRelease(size); if(window) CFRelease(window); CFRelease(owner);
 if(CGRectIsNull(rect)) return @{};
 CGDirectDisplayID ids[32]; uint32_t count=0; CGGetOnlineDisplayList(32,ids,&count); double best=0; CGDirectDisplayID selected=0;
 for(uint32_t i=0;i<count;i++){ CGRect intersection=CGRectIntersection(rect,CGDisplayBounds(ids[i])); double area=CGRectIsNull(intersection)?0:intersection.size.width*intersection.size.height; if(area>best){best=area;selected=ids[i];} }
 return selected?@{@"displayId":[NSString stringWithFormat:@"%u",selected]}:@{};
}
- (NSDictionary *)mainAction:(NSDictionary *)request {
 if(!self.unlocked) { [self.apps removeAllObjects]; [self.tabs removeAllObjects]; [self.windows removeAllObjects]; return [self failure:@"Unlock your Mac first, then open Apps."]; }
 NSString *op=request[@"op"];
 if([op isEqual:@"apps-list"]){
  NSMutableArray *list=[NSMutableArray new]; NSMutableDictionary *next=[NSMutableDictionary new];
  NSArray *running=[NSWorkspace.sharedWorkspace.runningApplications sortedArrayUsingComparator:^NSComparisonResult(NSRunningApplication *a,NSRunningApplication *b){ if(a.active!=b.active)return a.active?NSOrderedAscending:NSOrderedDescending; return [a.localizedName?:@"" localizedCaseInsensitiveCompare:b.localizedName?:@""]; }];
  for(NSRunningApplication *app in running){
   if(app.activationPolicy!=NSApplicationActivationPolicyRegular || app.terminated || app.processIdentifier==getpid() || !app.bundleIdentifier.length) continue;
   NSString *token=nil;
   for(NSString *key in self.apps) if([self.apps[key][@"app"] processIdentifier]==app.processIdentifier && [self target:key]){token=key;break;}
   if(!token)token=NSUUID.UUID.UUIDString;
   NSString *start=[self processStart:app.processIdentifier];if(!start)continue;
   next[token]=@{@"app":app,@"time":@(NSDate.date.timeIntervalSince1970),@"start":start};
   NSString *name=app.localizedName?:@"Application";
   [list addObject:@{@"id":token,@"name":[name substringToIndex:MIN(name.length,180)],@"icon":[self icon:app.icon],@"browser":@([self browser:app.bundleIdentifier]),@"active":@(app.active)}];
   if(list.count>=100)break;
  }
  self.apps=next; [self.tabs removeAllObjects]; [self.windows removeAllObjects]; return @{@"ok":@YES,@"apps":list};
 }
 NSRunningApplication *app=[self target:request[@"app"]]; if(!app)return [self failure:@"That app closed or the list expired. Refresh Apps."];
 if([op isEqual:@"apps-windows"]){
  if(!AXIsProcessTrusted())return [self failure:@"Enable AppleSeed in Mac System Settings > Privacy & Security > Accessibility to list app windows."];
  AXUIElementRef owner=AXUIElementCreateApplication(app.processIdentifier);AXUIElementSetMessagingTimeout(owner,.25);CFTypeRef items=NULL;
  AXError error=AXUIElementCopyAttributeValue(owner,kAXWindowsAttribute,&items);CFRelease(owner);
  if(error!=kAXErrorSuccess)return [self failure:@"This app does not expose its windows to macOS Accessibility. Tap the app name to bring it forward."];
  NSMutableArray *windows=[NSMutableArray new];
  for(NSString *key in [self.windows.allKeys copy])if([self.windows[key][@"app"] isEqual:request[@"app"]])[self.windows removeObjectForKey:key];
  NSUInteger inspected=0;
  for(id item in (__bridge NSArray *)items){
   if(inspected++>=20)break;
   AXUIElementRef window=(__bridge AXUIElementRef)item;AXUIElementSetMessagingTimeout(window,.1);
   CFArrayRef actions=NULL;AXUIElementCopyActionNames(window,&actions);
   BOOL canRaise=actions && CFArrayContainsValue(actions,CFRangeMake(0,CFArrayGetCount(actions)),kAXRaiseAction);
   if(actions)CFRelease(actions);if(!canRaise)continue;
   CFTypeRef title=NULL;AXUIElementCopyAttributeValue(window,kAXTitleAttribute,&title);
   NSString *name=title && CFGetTypeID(title)==CFStringGetTypeID()?(__bridge NSString *)title:@"";
   NSString *token=NSUUID.UUID.UUIDString;self.windows[token]=@{@"window":item,@"app":request[@"app"]};
   [windows addObject:@{@"id":token,@"title":name.length?[name substringToIndex:MIN(name.length,512)]:@"Untitled window",@"window":@(windows.count+1),@"kind":@"window"}];
   if(title)CFRelease(title);if(windows.count>=20)break;
  }
  CFRelease(items);return @{@"ok":@YES,@"tabs":windows};
 }
 if([op isEqual:@"apps-window-activate"]){
  NSDictionary *saved=self.windows[request[@"window"]];if(![saved[@"app"] isEqual:request[@"app"]])return [self failure:@"That window is no longer in the list. Refresh Apps."];
  AXUIElementRef window=(__bridge AXUIElementRef)saved[@"window"];pid_t pid=0;
  if(AXUIElementGetPid(window,&pid)!=kAXErrorSuccess || pid!=app.processIdentifier)return [self failure:@"That window closed. Refresh Apps."];
  [app unhide];[app activateWithOptions:NSApplicationActivateIgnoringOtherApps];AXUIElementSetAttributeValue(window,kAXMinimizedAttribute,kCFBooleanFalse);
  AXUIElementSetMessagingTimeout(window,1);AXError raised=AXUIElementPerformAction(window,kAXRaiseAction);
  if(raised!=kAXErrorSuccess)return [self failure:@"That window did not respond. Refresh Apps or tap the app name."];
  AXUIElementSetAttributeValue(window,kAXMainAttribute,kCFBooleanTrue);AXUIElementSetAttributeValue(window,kAXFocusedAttribute,kCFBooleanTrue);
  NSMutableDictionary *result=[NSMutableDictionary dictionaryWithDictionary:[self location:app]];result[@"ok"]=@YES;return result;
 }
 if([op isEqual:@"apps-activate"]){
  [app unhide]; BOOL ok=[app activateWithOptions:NSApplicationActivateIgnoringOtherApps];
  AXUIElementRef owner=AXUIElementCreateApplication(app.processIdentifier); AXUIElementSetMessagingTimeout(owner,.35); CFTypeRef window=NULL;
  if(AXUIElementCopyAttributeValue(owner,kAXMainWindowAttribute,&window)==kAXErrorSuccess){
   AXUIElementSetMessagingTimeout(window,.25);
   AXUIElementSetAttributeValue(window,kAXMinimizedAttribute,kCFBooleanFalse); AXUIElementPerformAction(window,kAXRaiseAction); CFRelease(window);
  }
  CFRelease(owner); if(!ok)return [self failure:@"macOS could not bring that app forward. Try again."];
  NSMutableDictionary *result=[NSMutableDictionary dictionaryWithDictionary:[self location:app]]; result[@"ok"]=@YES; return result;
 }
 return [self failure:@"Invalid app action."];
}
- (NSDictionary *)browserAction:(NSDictionary *)request {
 __block NSRunningApplication *app; __block NSDictionary *tab; __block NSDictionary *failure;
 dispatch_sync(dispatch_get_main_queue(), ^{
  if(!self.unlocked) { failure=[self failure:@"Unlock your Mac first, then open Apps."]; return; }
  app=[self target:request[@"app"]];
  if(!app || ![self browser:app.bundleIdentifier]) {failure=[self failure:@"That browser closed or the list expired. Refresh Apps."];return;}
  if([request[@"op"] isEqual:@"apps-tab-activate"]){tab=self.tabs[request[@"tab"]]; if(![tab[@"app"] isEqual:request[@"app"]])failure=[self failure:@"That tab is no longer in the list. Refresh tabs."];}
 });
 if(failure)return failure;
 NSAppleEventDescriptor *target=[NSAppleEventDescriptor descriptorWithDescriptorType:typeApplicationBundleID data:[app.bundleIdentifier dataUsingEncoding:NSUTF8StringEncoding]];
 OSStatus permission=AEDeterminePermissionToAutomateTarget(target.aeDesc,typeWildCard,typeWildCard,false);
 if([request[@"op"] isEqual:@"apps-browser-permission"]){
  if(permission==noErr)return @{@"ok":@YES,@"permissionPending":@NO};
  @synchronized(self.permissionRequests){
   if(![self.permissionRequests containsObject:app.bundleIdentifier]){
    [self.permissionRequests addObject:app.bundleIdentifier];
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY,0),^{
     AEDeterminePermissionToAutomateTarget(target.aeDesc,typeWildCard,typeWildCard,true);
     @synchronized(self.permissionRequests){[self.permissionRequests removeObject:app.bundleIdentifier];}
    });
   }
  }
  return @{@"ok":@YES,@"permissionPending":@YES};
 }
 if(permission!=noErr)return @{@"ok":@NO,@"permission":@YES,@"error":@"Browser tabs need Automation permission on your Mac. Allow AppleSeed to control this browser, then refresh tabs."};
 NSString *script=[NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"runtime/native/BrowserTabs.js"];
 NSTask *task=[NSTask new]; task.executableURL=[NSURL fileURLWithPath:@"/usr/bin/osascript"];
 NSMutableArray *args=[NSMutableArray arrayWithArray:@[@"-l",@"JavaScript",script,app.bundleIdentifier,tab?@"select":@"list"]];
 if(tab){NSData *data=[NSJSONSerialization dataWithJSONObject:@{@"windowId":tab[@"windowId"],@"tabId":tab[@"tabId"]} options:0 error:nil]; [args addObject:[[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding]];}
 task.arguments=args; NSPipe *output=[NSPipe pipe]; task.standardOutput=output; task.standardError=[NSFileHandle fileHandleWithNullDevice];
 NSError *error=nil; if(![task launchAndReturnError:&error])return [self failure:@"Browser tabs are unavailable. Update the Mac companion."];
 // Reading runs concurrently, so a large tab list cannot fill the child pipe and hang.
 __block NSMutableData *bytes=[NSMutableData new]; dispatch_group_t group=dispatch_group_create();
 dispatch_group_async(group,dispatch_get_global_queue(QOS_CLASS_UTILITY,0),^{ NSData *chunk; while((chunk=[output.fileHandleForReading readDataOfLength:8192]).length){ if(bytes.length+chunk.length<=1024*1024)[bytes appendData:chunk]; else { [task terminate]; break; } } });
 NSDate *deadline=[NSDate dateWithTimeIntervalSinceNow:7]; while(task.running && deadline.timeIntervalSinceNow>0)[NSThread sleepForTimeInterval:.025];
 if(task.running){[task terminate]; dispatch_after(dispatch_time(DISPATCH_TIME_NOW,NSEC_PER_SEC),dispatch_get_global_queue(QOS_CLASS_UTILITY,0),^{if(task.running)kill(task.processIdentifier,SIGKILL);});}
 if(dispatch_group_wait(group,dispatch_time(DISPATCH_TIME_NOW,2*NSEC_PER_SEC)))return [self failure:@"Browser did not respond. Check the Mac for an Automation permission prompt, then refresh tabs."];
 if(deadline.timeIntervalSinceNow<=0)return [self failure:@"Browser did not respond. Check the Mac for an Automation permission prompt, then refresh tabs."];
 NSDictionary *result=[NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil];
 if(![result isKindOfClass:NSDictionary.class])return [self failure:@"Browser tabs are unavailable. Check Automation permission on the Mac."];
 __block NSDictionary *response;
 dispatch_sync(dispatch_get_main_queue(),^{
  if(!self.unlocked || ![self target:request[@"app"]]) {response=[self failure:@"Mac locked or browser closed. Refresh Apps after unlocking."];return;}
  if(![result[@"ok"] boolValue]){response=result;return;}
  if(tab){NSMutableDictionary *r=[NSMutableDictionary dictionaryWithDictionary:[self location:app]];r[@"ok"]=@YES;response=r;return;}
  NSMutableArray *tabs=[NSMutableArray new];
  // Replace this browser's old snapshot. Other expanded browsers remain usable.
  for(NSString *key in [self.tabs.allKeys copy])if([self.tabs[key][@"app"] isEqual:request[@"app"]])[self.tabs removeObjectForKey:key];
  for(NSDictionary *entry in result[@"tabs"]){ if(tabs.count>=500)break; if(![entry isKindOfClass:NSDictionary.class] || ![entry[@"windowId"] isKindOfClass:NSString.class] || ![entry[@"tabId"] isKindOfClass:NSString.class])continue;
   NSString *token=NSUUID.UUID.UUIDString; NSMutableDictionary *saved=[entry mutableCopy];saved[@"app"]=request[@"app"];self.tabs[token]=saved;
   [tabs addObject:@{@"id":token,@"title":entry[@"title"]?:@"Untitled tab",@"window":entry[@"window"]?:@1,@"active":entry[@"active"]?:@NO}];
  }
  response=@{@"ok":@YES,@"tabs":tabs,@"truncated":result[@"truncated"]?:@NO};
 }); return response;
}
- (NSDictionary *)handle:(NSDictionary *)request {
 if([@[@"apps-tabs",@"apps-tab-activate",@"apps-browser-permission"] containsObject:request[@"op"]])return [self browserAction:request];
 __block NSDictionary *result; dispatch_sync(dispatch_get_main_queue(), ^{result=[self mainAction:request];}); return result;
}
@end
