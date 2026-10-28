#import <IOKit/pwr_mgt/IOPMLib.h>

@interface SeedScreenSettings : NSObject
@property IOPMAssertionID systemAssertion, displayAssertion, activityAssertion;
@property(copy) NSString *session, *awake;
@property NSTimeInterval lease;
- (NSDictionary *)status;
- (void)end;
- (NSDictionary *)handle:(NSDictionary *)request unlocked:(BOOL)unlocked;
@end
@implementation SeedScreenSettings
- (instancetype)init { if ((self=[super init])) { _awake=@"normal"; } return self; }
- (id)saverValue {
 CFPreferencesSynchronize(CFSTR("com.apple.screensaver"), kCFPreferencesCurrentUser, kCFPreferencesCurrentHost);
 CFPropertyListRef value=CFPreferencesCopyValue(CFSTR("idleTime"),CFSTR("com.apple.screensaver"),kCFPreferencesCurrentUser,kCFPreferencesCurrentHost);
 if (!value) value=CFPreferencesCopyValue(CFSTR("idleTime"),CFSTR("com.apple.screensaver"),kCFPreferencesCurrentUser,kCFPreferencesAnyHost);
 return CFBridgingRelease(value);
}
- (NSDictionary *)status {
 id value=[self saverValue];
 CFPropertyListRef host=CFPreferencesCopyValue(CFSTR("idleTime"),CFSTR("com.apple.screensaver"),kCFPreferencesCurrentUser,kCFPreferencesCurrentHost);
 BOOL usesDefault=host==NULL; if(host) CFRelease(host);
 return @{ @"ok":@YES, @"available":@YES, @"saverSeconds":[value isKindOfClass:NSNumber.class]?value:NSNull.null,
  @"saverDefault":@(usesDefault), @"saverManaged":@(CFPreferencesAppValueIsForced(CFSTR("idleTime"),CFSTR("com.apple.screensaver"))),
  @"awake":self.awake };
}
- (void)releaseAwake {
 if (self.systemAssertion) IOPMAssertionRelease(self.systemAssertion);
 if (self.displayAssertion) IOPMAssertionRelease(self.displayAssertion);
 if (self.activityAssertion) IOPMAssertionRelease(self.activityAssertion);
 self.activityAssertion=0;
 self.systemAssertion=0; self.displayAssertion=0; self.awake=@"normal";
}
- (void)end { [self releaseAwake]; self.session=nil; self.lease=0; }
- (NSDictionary *)handle:(NSDictionary *)request unlocked:(BOOL)isUnlocked {
 NSString *op=request[@"op"];
 if ([op isEqual:@"screen-status"]) return self.status;
 NSString *session=request[@"session"];
 if (![session isKindOfClass:NSString.class] || ![[NSUUID alloc] initWithUUIDString:session]) return @{ @"ok":@NO,@"error":@"Session unavailable." };
 if (self.session && ![self.session isEqual:session]) return @{ @"ok":@NO,@"error":@"Another display session is active." };
 if ([op isEqual:@"screen-end"]) { [self end]; return self.status; }
 if ([op isEqual:@"screen-lease"]) { if (self.session) self.lease=NSDate.date.timeIntervalSince1970; return self.status; }
 if ([op isEqual:@"screen-save"]) {
  id seconds=request[@"saverSeconds"];
  if (seconds!=NSNull.null && (![seconds isKindOfClass:NSNumber.class] || [seconds doubleValue]!=[seconds integerValue] || [seconds integerValue]<0 || [seconds integerValue]>86400)) return @{ @"ok":@NO,@"error":@"Invalid screen saver timer." };
  if (CFPreferencesAppValueIsForced(CFSTR("idleTime"),CFSTR("com.apple.screensaver"))) return @{ @"ok":@NO,@"error":@"Your screen saver timer is managed by macOS." };
  CFPreferencesSetValue(CFSTR("idleTime"),seconds==NSNull.null?NULL:(__bridge CFPropertyListRef)seconds,CFSTR("com.apple.screensaver"),kCFPreferencesCurrentUser,kCFPreferencesCurrentHost);
  if (!CFPreferencesSynchronize(CFSTR("com.apple.screensaver"),kCFPreferencesCurrentUser,kCFPreferencesCurrentHost)) return @{ @"ok":@NO,@"error":@"macOS could not save the screen saver timer." };
  [NSDistributedNotificationCenter.defaultCenter postNotificationName:@"com.apple.screensaver.preferenceChanged" object:nil];
  return self.status;
 }
 if ([op isEqual:@"screen-awake"]) {
  NSString *mode=request[@"mode"];
  if (![@[@"normal",@"system",@"screens"] containsObject:mode]) return @{ @"ok":@NO,@"error":@"Invalid awake setting." };
  IOPMAssertionID system=0, screens=0;
  if (![mode isEqual:@"normal"] && IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleSystemSleep,kIOPMAssertionLevelOn,CFSTR("AppleSeed remote session"),&system)!=kIOReturnSuccess) return @{ @"ok":@NO,@"error":@"macOS could not keep this session awake." };
  if ([mode isEqual:@"screens"] && IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleDisplaySleep,kIOPMAssertionLevelOn,CFSTR("AppleSeed remote displays"),&screens)!=kIOReturnSuccess) { if(system) IOPMAssertionRelease(system); return @{ @"ok":@NO,@"error":@"macOS could not keep the displays awake." }; }
  [self releaseAwake]; self.systemAssertion=system; self.displayAssertion=screens; self.awake=mode;
  self.session=session; self.lease=NSDate.date.timeIntervalSince1970; return self.status;
 }
 if ([op isEqual:@"screen-wake"]) {
  if (self.activityAssertion) IOPMAssertionRelease(self.activityAssertion); self.activityAssertion=0; IOReturn result=IOPMAssertionDeclareUserActivity(CFSTR("AppleSeed wake displays"),kIOPMUserActiveLocal,&_activityAssertion);
  if (result!=kIOReturnSuccess) return @{ @"ok":@NO,@"error":@"macOS could not wake the displays." }; self.session=session; self.lease=NSDate.date.timeIntervalSince1970; return self.status;
 }
 if (!isUnlocked) return @{ @"ok":@NO,@"error":@"Unlock your Mac first." };
 if ([op isEqual:@"screen-settings"]) {
  NSString *url=[request[@"pane"] isEqual:@"timing"]?@"x-apple.systempreferences:com.apple.Lock-Screen-Settings.extension":@"x-apple.systempreferences:com.apple.Wallpaper-Settings.extension?ScreenSaver";
  if (![NSWorkspace.sharedWorkspace openURL:[NSURL URLWithString:url]]) return @{ @"ok":@NO,@"error":@"macOS could not open its settings." }; return self.status;
 }
 if ([op isEqual:@"screen-saver"]) {
  NSURL *url=[NSURL fileURLWithPath:@"/System/Library/CoreServices/ScreenSaverEngine.app"];
  if (![NSFileManager.defaultManager fileExistsAtPath:url.path]) return @{ @"ok":@NO,@"error":@"Screen saver is unavailable on this Mac." };
  [NSWorkspace.sharedWorkspace openApplicationAtURL:url configuration:NSWorkspaceOpenConfiguration.configuration completionHandler:nil]; return self.status;
 }
 return @{ @"ok":@NO,@"error":@"Unknown display action." };
}
@end
