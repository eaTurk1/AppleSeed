#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>
#import <IOKit/pwr_mgt/IOPMLib.h>

// Passwords go only to the loginwindow secure-field object. Return is posted to
// that same process, never to the foreground app or an unverified default button.
@interface SeedSafeUnlock : NSObject
@property(copy) NSString *cycle, *nonce, *lastState;
@property NSTimeInterval issued;
@property(copy) NSString *lastOutcome;
@property NSInteger lastEntryError;
- (NSDictionary *)handle:(NSDictionary *)request;
@end

@implementation SeedSafeUnlock
- (instancetype)init {
 if ((self=[super init])) {
  self.cycle=NSUUID.UUID.UUIDString;
  NSDistributedNotificationCenter *center=NSDistributedNotificationCenter.defaultCenter;
  [center addObserver:self selector:@selector(changed:) name:@"com.apple.screenIsLocked" object:nil];
  [center addObserver:self selector:@selector(changed:) name:@"com.apple.screenIsUnlocked" object:nil];
 }
 return self;
}
- (void)changed:(NSNotification *)notification { self.cycle=NSUUID.UUID.UUIDString; self.nonce=nil; self.lastOutcome=nil; self.lastEntryError=0; }
- (NSString *)lockState {
 NSDictionary *session=CFBridgingRelease(CGSessionCopyCurrentDictionary());
 if (!session || ![session[@"kCGSSessionOnConsoleKey"] boolValue]) return @"unknown";
 if ([session[@"CGSSessionScreenIsLocked"] boolValue]) return @"locked";
 return [session[@"kCGSessionLoginDoneKey"] boolValue] ? @"unlocked" : @"unknown";
}
- (id)attribute:(CFStringRef)name of:(AXUIElementRef)element {
 CFTypeRef result=NULL;
 if (element) AXUIElementSetMessagingTimeout(element,0.2);
 if (!element || AXUIElementCopyAttributeValue(element,name,&result)!=kAXErrorSuccess) return nil;
 return CFBridgingRelease(result);
}
- (BOOL)trusted { return AXIsProcessTrusted(); }
- (BOOL)isLoginProcess:(pid_t)pid {
 if (pid<=0) return NO;
 NSRunningApplication *application=[NSRunningApplication runningApplicationWithProcessIdentifier:pid];
 return [application.bundleIdentifier isEqual:@"com.apple.loginwindow"] &&
  [application.executableURL.path isEqual:@"/System/Library/CoreServices/loginwindow.app/Contents/MacOS/loginwindow"];
}
- (BOOL)isLoginField:(AXUIElementRef)field {
 if (!field || CFGetTypeID(field)!=AXUIElementGetTypeID()) return NO;
 AXUIElementSetMessagingTimeout(field,0.2);
 pid_t pid=0; if (AXUIElementGetPid(field,&pid)!=kAXErrorSuccess || ![self isLoginProcess:pid]) return NO;
 return [[self attribute:kAXRoleAttribute of:field] isEqual:(__bridge NSString *)kAXTextFieldRole] &&
        [[self attribute:kAXSubroleAttribute of:field] isEqual:(__bridge NSString *)kAXSecureTextFieldSubrole] &&
        [[self attribute:kAXEnabledAttribute of:field] boolValue];
}
- (AXUIElementRef)copyField {
 if (![self trusted]) return NULL;
 AXUIElementRef system=AXUIElementCreateSystemWide();
 id focused=[self attribute:kAXFocusedUIElementAttribute of:system]; CFRelease(system);
 if (focused && [self isLoginField:(__bridge AXUIElementRef)focused]) return (AXUIElementRef)CFRetain((__bridge CFTypeRef)focused);
 // A phone user should not have to focus a field for the shortcut. Look only
 // inside Apple's loginwindow, and refuse an ambiguous set of secure fields.
 NSMutableArray *queue=[NSMutableArray array], *matches=[NSMutableArray array];
 for (NSRunningApplication *application in NSWorkspace.sharedWorkspace.runningApplications) {
  if (![self isLoginProcess:application.processIdentifier]) continue;
  [queue addObject:CFBridgingRelease(AXUIElementCreateApplication(application.processIdentifier))];
 }
 NSTimeInterval deadline=NSProcessInfo.processInfo.systemUptime+0.8;
 NSUInteger index=0; BOOL truncated=NO;
 for (; index<queue.count && index<64 && NSProcessInfo.processInfo.systemUptime<deadline; index++) {
  AXUIElementRef node=(__bridge AXUIElementRef)queue[index];
  if ([self isLoginField:node]) { [matches addObject:queue[index]]; if(matches.count>1) return NULL; }
  id children=[self attribute:kAXChildrenAttribute of:node];
  if ([children isKindOfClass:NSArray.class]) for(id child in children) {
   if(queue.count>=64) { truncated=YES; break; }
   if(CFGetTypeID((__bridge CFTypeRef)child)==AXUIElementGetTypeID()) [queue addObject:child];
  }
 }
 return !truncated && index==queue.count && matches.count==1?(AXUIElementRef)CFRetain((__bridge CFTypeRef)matches[0]):NULL;
}
- (AXError)writePassword:(NSString *)password field:(AXUIElementRef)field {
 return AXUIElementSetAttributeValue(field,kAXValueAttribute,(__bridge CFStringRef)password);
}
- (BOOL)isFocusedField:(AXUIElementRef)field {
 AXUIElementRef system=AXUIElementCreateSystemWide();
 id focused=[self attribute:kAXFocusedUIElementAttribute of:system]; CFRelease(system);
 return focused && CFGetTypeID((__bridge CFTypeRef)focused)==AXUIElementGetTypeID() && CFEqual((__bridge CFTypeRef)focused,field);
}
- (void)postReturn:(CGEventRef)event toPID:(pid_t)pid { CGEventPostToPid(pid,event); }
- (BOOL)submitField:(AXUIElementRef)field {
 pid_t pid=0;
 if (![self.lockState isEqual:@"locked"] || ![self isLoginField:field] || ![self isFocusedField:field] || AXUIElementGetPid(field,&pid)!=kAXErrorSuccess || ![self isLoginProcess:pid]) return NO;
 CGEventRef down=CGEventCreateKeyboardEvent(NULL,0x24,true), up=CGEventCreateKeyboardEvent(NULL,0x24,false);
 if (!down || !up) { if(down) CFRelease(down); if(up) CFRelease(up); return NO; }
 CGEventSetFlags(down,0); CGEventSetFlags(up,0);
 // The only synthesized key is Return. Never put password text in an event.
 // A race with unlock cannot route this key to a different application.
 BOOL locked=[self.lockState isEqual:@"locked"] && [self isLoginProcess:pid] && [self isFocusedField:field];
 if(locked) { [self postReturn:down toPID:pid]; [self postReturn:up toPID:pid]; }
 CFRelease(down); CFRelease(up); return locked;
}
- (void)wakeForEntry {
 IOPMAssertionID activity=0;
 if(IOPMAssertionDeclareUserActivity(CFSTR("AppleSeed sign in"),kIOPMUserActiveLocal,&activity)==kIOReturnSuccess && activity) IOPMAssertionRelease(activity);
}
- (NSDictionary *)handle:(NSDictionary *)request {
 NSString *state=self.lockState;
 if (self.lastState && ![self.lastState isEqual:state]) [self changed:nil];
 self.lastState=state;
 BOOL locked=[state isEqual:@"locked"], trusted=[self trusted];
 if ([request[@"op"] isEqual:@"unlock-status"]) {
  // Polling is read-only and never touches, focuses or submits a login control.
  if (locked && trusted) {
   if (!self.nonce || NSDate.date.timeIntervalSince1970-self.issued>10) { self.nonce=NSUUID.UUID.UUIDString; self.issued=NSDate.date.timeIntervalSince1970; }
  } else self.nonce=nil;
  return @{ @"ok":@YES,@"protocol":@2,@"state":state,@"ready":@(locked&&trusted),@"pending":@NO,
    @"cycle":self.cycle,@"nonce":self.nonce?:@"",@"accessibility":@(trusted),@"lastOutcome":self.lastOutcome?:@"none",@"lastEntryError":@(self.lastEntryError) };
 }
 if (![request[@"op"] isEqual:@"unlock-submit"]) return @{ @"ok":@NO,@"sent":@NO,@"error":@"Invalid unlock action." };
 BOOL authorized=locked&&trusted&&self.nonce&&[request[@"nonce"] isEqual:self.nonce]&&
  [request[@"cycle"] isEqual:self.cycle]&&NSDate.date.timeIntervalSince1970-self.issued<=10;
 self.nonce=nil;
 if (!authorized) return @{ @"ok":@NO,@"state":state,@"sent":@NO,@"error":[state isEqual:@"unlocked"]?@"Mac is already unlocked.":@"Could not verify the Mac lock screen. Tap Unlock Mac to check again." };
 NSString *password=request[@"password"];
 if (![password isKindOfClass:NSString.class] || !password.length || password.length>4096) return @{ @"ok":@NO,@"sent":@NO,@"error":@"Enter your Mac password." };
 [self wakeForEntry];
 AXUIElementRef field=[self copyField];
 if (!field) { self.lastOutcome=@"choose-account"; return @{ @"ok":@NO,@"sent":@NO,@"error":@"Choose your Mac account on the live screen, then tap Unlock Mac." }; }
 if (![self.lockState isEqual:@"locked"] || ![self isLoginField:field]) { CFRelease(field); return @{ @"ok":@NO,@"state":self.lockState,@"sent":@NO,@"error":@"Mac lock state changed. No password was sent." }; }
 if (![self isFocusedField:field]) AXUIElementSetAttributeValue(field,kAXFocusedAttribute,kCFBooleanTrue);
 if (![self.lockState isEqual:@"locked"] || ![self isLoginField:field]) { CFRelease(field); return @{ @"ok":@NO,@"state":self.lockState,@"sent":@NO,@"error":@"Mac lock state changed. No password was sent." }; }
 AXError result=[self writePassword:password field:field];
 BOOL submitted=result==kAXErrorSuccess?[self submitField:field]:NO;
 CFRelease(field);
 self.lastEntryError=result; self.lastOutcome=result!=kAXErrorSuccess?@"entry-failed":submitted?@"submitted":@"filled";
 if(result!=kAXErrorSuccess) return @{ @"ok":@NO,@"pending":@NO,@"error":@"macOS could not fill its secure password field. Tap Unlock Mac to try again, or use Keyboard." };
 return @{ @"ok":@YES,@"pending":@NO,@"submitted":@(submitted),@"message":submitted?@"Sign-in sent.":@"Password filled. Tap the Mac login arrow to finish." };
}
@end
