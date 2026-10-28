#import "../native/SafeUnlock.h"
// All writes/wakes/event delivery are replaced by recorders. No real Mac field
// or event receiver is touched; admission and Return routing use production code.
@interface UnlockFixture : SeedSafeUnlock
@property(copy) NSString *fixtureState;
@property BOOL untrusted, hasField, validField, focused, unlockDuringWrite, unlockDuringLookup;
@property NSUInteger scans, writes, returnEvents;
@property AXError writeResult;
@property pid_t targetPID;
@end
@implementation UnlockFixture
- (BOOL)trusted { return !self.untrusted; }
- (NSString *)lockState { return self.fixtureState; }
- (BOOL)isLoginProcess:(pid_t)pid { return pid==getpid(); }
- (AXUIElementRef)copyField { self.scans++; if(self.unlockDuringLookup) self.fixtureState=@"unlocked"; return self.hasField?AXUIElementCreateApplication(getpid()):NULL; }
- (BOOL)isLoginField:(AXUIElementRef)field { return field && self.validField; }
- (BOOL)isFocusedField:(AXUIElementRef)field { return self.focused; }
- (void)wakeForEntry {}
- (AXError)writePassword:(NSString *)password field:(AXUIElementRef)field { self.writes++; if(self.unlockDuringWrite) self.fixtureState=@"unlocked"; return self.writeResult; }
- (void)postReturn:(CGEventRef)event toPID:(pid_t)pid {
 if(CGEventGetIntegerValueField(event,kCGKeyboardEventKeycode)!=0x24) abort();
 self.targetPID=pid; self.returnEvents++;
}
@end
static void require(BOOL ok, NSString *message) { if(!ok) { NSLog(@"FAIL: %@",message); exit(1); } }
static UnlockFixture *fixture(void) { UnlockFixture *f=[UnlockFixture new]; f.fixtureState=@"locked"; f.hasField=YES; f.validField=YES; f.focused=YES; f.writeResult=kAXErrorSuccess; return f; }
static NSDictionary *status(UnlockFixture *f) { return [f handle:@{@"op":@"unlock-status"}]; }
static NSDictionary *submit(UnlockFixture *f, NSDictionary *state) { return [f handle:@{@"op":@"unlock-submit",@"cycle":state[@"cycle"],@"nonce":state[@"nonce"],@"password":@"synthetic-only"}]; }
int main(void) { @autoreleasepool {
 // Trust and UI objects are fixture values; OS permissions remain unchanged.
 UnlockFixture *f=fixture(); NSDictionary *s=status(f);
 require(f.scans==0,@"polling never scans or changes login controls");

 require([s[@"ready"] boolValue]&&[s[@"protocol"] intValue]==2,@"one-button protocol");
 NSDictionary *r=submit(f,s); require([r[@"ok"] boolValue]&&f.writes==1&&f.returnEvents==2&&f.targetPID==getpid(),@"secure write and Return to the same process");
 r=submit(f,s); require(![r[@"ok"] boolValue]&&f.writes==1,@"duplicate nonce rejected");
 s=status(f); r=submit(f,s); require([r[@"ok"] boolValue]&&f.writes==2,@"next explicit tap works immediately without retry state");
 f=fixture(); s=status(f); f.fixtureState=@"unlocked"; submit(f,s); require(f.writes==0&&f.returnEvents==0,@"stale locked video cannot write on unlocked desktop");
 f=fixture(); s=status(f); f.unlockDuringLookup=YES; submit(f,s); require(f.writes==0,@"unlock during field lookup blocks write");
 f=fixture(); s=status(f); f.unlockDuringWrite=YES; submit(f,s); require(f.writes==1&&f.returnEvents==0,@"unlock after exact-field write blocks Return");
 f=fixture(); s=status(f); f.hasField=NO; r=submit(f,s); require(![r[@"sent"] boolValue]&&f.writes==0,@"account chooser sends no password");
 f.hasField=YES; s=status(f); submit(f,s); require(f.writes==1,@"choosing account does not require a cooldown or reset");
 f=fixture(); s=status(f); f.writeResult=kAXErrorCannotComplete; submit(f,s); require(f.returnEvents==0,@"failed entry never submits any button");
 s=status(f); require([s[@"ready"] boolValue],@"failed write leaves the next user tap available");
 f=fixture(); f.untrusted=YES; s=status(f); submit(f,s); require(f.writes==0&&![s[@"ready"] boolValue],@"missing Accessibility trust cannot write");
 puts("Native unlock flow passed: read-only polling, exact-field writes, process-targeted Return, immediate explicit retries, nonce replay rejection, and unlock races. All writes and event delivery were mocked.");
} return 0; }
