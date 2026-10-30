#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>
#import "ScreenSettings.h"
#import "SafeUnlock.h"
#import <sys/socket.h>
#import <sys/un.h>
#import <sys/stat.h>
#import <signal.h>
#import <unistd.h>

static NSDictionary *errorResult(NSString *message) { return @{ @"ok": @NO, @"error": message }; }
static BOOL unlocked(void) {
 NSDictionary *session = CFBridgingRelease(CGSessionCopyCurrentDictionary());
 return session && [session[@"kCGSSessionOnConsoleKey"] boolValue] && ![session[@"CGSSessionScreenIsLocked"] boolValue];
}
#import "AppSwitcher.h"

@interface SeedCompanion : NSObject <NSApplicationDelegate>
@property(copy) NSString *socketPath;
@property int listener;
@property(strong) NSStatusItem *statusItem;
@property BOOL settingUp;
@property(strong) SeedScreenSettings *screenSettings;
@property(strong) SeedSafeUnlock *safeUnlock;
@property(strong) SeedAppSwitcher *appSwitcher;
@end
@implementation SeedCompanion
- (NSString *)runtime { return [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"runtime"]; }
- (NSString *)phoneURL {
 NSArray *files=@[@"/Library/LaunchDaemons/org.appleseed.remote.service.plist", [NSHomeDirectory() stringByAppendingPathComponent:@"Library/LaunchAgents/org.appleseed.remote.service.plist"]];
 for (NSString *file in files) {
  NSDictionary *plist=[NSDictionary dictionaryWithContentsOfFile:file]; NSString *url=plist[@"EnvironmentVariables"][@"MAC_UNLOCK_URL"];
  if ([url isKindOfClass:NSString.class] && [url hasPrefix:@"https://"]) return url;
 }
 return nil;
}
- (void)copyAddress:(id)sender {
 NSString *url=self.phoneURL;
 if (url) { [NSPasteboard.generalPasteboard clearContents]; [NSPasteboard.generalPasteboard setString:url forType:NSPasteboardTypeString]; }
 NSAlert *alert=[NSAlert new]; alert.messageText=url?@"Mac address copied":@"Set up your Mac first"; alert.informativeText=url?:@"Choose Setup Mac service from the AppleSeed menu."; [alert runModal];
}
- (void)setup:(id)sender {
 if (self.settingUp) return; self.settingUp=YES;
 NSString *runtime=self.runtime;
 dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY,0), ^{
  NSTask *task=[NSTask new]; task.executableURL=[NSURL fileURLWithPath:[runtime stringByAppendingPathComponent:@"node"]];
  task.arguments=@[[runtime stringByAppendingPathComponent:@"scripts/setup.mjs"], NSBundle.mainBundle.bundlePath];
  NSPipe *pipe=[NSPipe pipe]; task.standardOutput=pipe; task.standardError=pipe;
  NSError *error; BOOL launched=[task launchAndReturnError:&error];
  NSData *data=launched?[pipe.fileHandleForReading readDataToEndOfFile]:nil; if(launched) [task waitUntilExit];
  NSString *message=data?[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]:error.localizedDescription;
  dispatch_async(dispatch_get_main_queue(), ^{
   self.settingUp=NO; NSAlert *alert=[NSAlert new]; alert.messageText=launched&&task.terminationStatus==0?@"AppleSeed is ready":@"Mac setup needs attention";
   alert.informativeText=message.length?message:@"Check Tailscale and try Setup Mac service again."; [alert addButtonWithTitle:@"OK"]; [alert runModal];
  });
 });
}
- (void)openGuide:(id)sender { [NSWorkspace.sharedWorkspace openURL:[NSURL fileURLWithPath:[self.runtime stringByAppendingPathComponent:@"docs/SETUP.html"]]]; }
- (void)openSharing:(id)sender { [NSWorkspace.sharedWorkspace openURL:[NSURL URLWithString:@"x-apple.systempreferences:com.apple.Sharing-Settings.extension"]]; }
- (void)openTailscale:(id)sender { [NSWorkspace.sharedWorkspace openURL:[NSURL fileURLWithPath:@"/Applications/Tailscale.app"]]; }
- (void)quit:(id)sender { [NSApplication.sharedApplication terminate:nil]; }
- (void)makeMenu {
 self.statusItem=[NSStatusBar.systemStatusBar statusItemWithLength:NSVariableStatusItemLength];
 NSImage *icon=[NSApplication.sharedApplication.applicationIconImage copy]; icon.size=NSMakeSize(22,22); self.statusItem.button.image=icon; self.statusItem.button.toolTip=@"AppleSeed";
 NSMenu *menu=[NSMenu new];
 NSArray *titles=@[@"AppleSeed", @"Setup Mac service…", @"Copy Mac address", @"Setup guide", @"Screen Sharing settings", @"Open Tailscale", @"Quit AppleSeed"];
 SEL actions[]={NULL,@selector(setup:),@selector(copyAddress:),@selector(openGuide:),@selector(openSharing:),@selector(openTailscale:),@selector(quit:)};
 for(NSUInteger i=0;i<titles.count;i++) { NSMenuItem *item=[[NSMenuItem alloc] initWithTitle:titles[i] action:actions[i] keyEquivalent:@""]; item.target=self; [menu addItem:item]; }
 self.statusItem.menu=menu;
}
- (NSDictionary *)handle:(NSDictionary *)request {
 NSString *op=request[@"op"];
 if (![op isKindOfClass:NSString.class]) return errorResult(@"Invalid action.");
 if ([op hasPrefix:@"unlock-"]) return [self.safeUnlock handle:request];
 if ([op hasPrefix:@"screen-"]) return [self.screenSettings handle:request unlocked:unlocked()];
 if ([op isEqualToString:@"recover"]) { [self.screenSettings end]; return self.screenSettings.status; }
 if ([op isEqualToString:@"status"]) return self.screenSettings.status;
 return errorResult(@"Unknown display action.");
}
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
 self.screenSettings=[SeedScreenSettings new]; self.safeUnlock=[SeedSafeUnlock new]; self.appSwitcher=[SeedAppSwitcher new]; [self makeMenu];
 [NSTimer scheduledTimerWithTimeInterval:10 repeats:YES block:^(NSTimer *timer) {
  if (self.screenSettings.session && NSDate.date.timeIntervalSince1970-self.screenSettings.lease>120) [self.screenSettings end];
 }];
    NSString *directory = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/AppleSeed/companion"];
    [NSFileManager.defaultManager createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:nil];
    struct stat info; if (lstat(directory.fileSystemRepresentation, &info) || !S_ISDIR(info.st_mode) || info.st_uid != getuid()) exit(1);
    chmod(directory.fileSystemRepresentation, 0700);
    self.socketPath = [directory stringByAppendingPathComponent:@"companion.sock"];
    if (lstat(self.socketPath.fileSystemRepresentation, &info) == 0) {
        if (!S_ISSOCK(info.st_mode) || info.st_uid != getuid()) exit(1);
        unlink(self.socketPath.fileSystemRepresentation);
    }
    self.listener = socket(AF_UNIX, SOCK_STREAM, 0); struct sockaddr_un address = {0}; address.sun_family = AF_UNIX;
    if (strlen(self.socketPath.fileSystemRepresentation) >= sizeof(address.sun_path)) exit(1);
    strlcpy(address.sun_path, self.socketPath.fileSystemRepresentation, sizeof(address.sun_path));
    mode_t previous = umask(0077); int result = bind(self.listener, (struct sockaddr *)&address, sizeof(address)); umask(previous);
    if (result || listen(self.listener, 4)) exit(1);
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        while (YES) @autoreleasepool {
            int client = accept(self.listener, NULL, NULL); if (client < 0) break;
            dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY,0), ^{ @autoreleasepool {
            uid_t uid; gid_t gid; if (getpeereid(client, &uid, &gid) || uid != getuid()) { close(client); return; }
            int noPipe = 1; setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &noPipe, sizeof(noPipe));
            struct timeval timeout = {3,0}; setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout)); setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
            NSMutableData *data = [NSMutableData data]; char buffer[1024]; BOOL complete = NO;
            while (data.length < 8192) { ssize_t n = read(client, buffer, sizeof(buffer)); if (n <= 0) break; [data appendBytes:buffer length:n]; if (memchr(buffer, '\n', n)) { complete = YES; break; } }
            NSDictionary *request = complete ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
            __block NSDictionary *response;
            if ([request isKindOfClass:NSDictionary.class] && [request[@"op"] isKindOfClass:NSString.class] && [request[@"op"] hasPrefix:@"apps-"]) {
             @try { response=[self.appSwitcher handle:request]; } @catch(NSException *e) { response=errorResult(@"App switching could not complete. Refresh Apps."); }
            } else dispatch_sync(dispatch_get_main_queue(), ^{ @try { response = [request isKindOfClass:NSDictionary.class] ? [self handle:request] : errorResult(@"Invalid request."); } @catch (NSException *exception) { response = errorResult(@"macOS could not complete this display action."); } });
            NSData *bytes = [NSJSONSerialization dataWithJSONObject:response options:0 error:nil];
            const char *p = bytes.bytes; NSUInteger left = bytes.length;
            while (left) { ssize_t n = write(client, p, left); if (n <= 0) break; p += n; left -= n; }
            write(client, "\n", 1); close(client);
            } });
        }
    });
    for (NSNumber *signalNumber in @[@(SIGTERM), @(SIGINT)]) {
        int sig = signalNumber.intValue; signal(sig, SIG_IGN);
        dispatch_source_t source = dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, sig, 0, dispatch_get_main_queue());
        dispatch_source_set_event_handler(source, ^{ [self.screenSettings end]; unlink(self.socketPath.fileSystemRepresentation); exit(0); }); dispatch_resume(source);
        // Signal sources need to stay alive for the life of the companion.
        static NSMutableArray *sources; if (!sources) sources = [NSMutableArray array]; [sources addObject:source];
    }
}
- (void)applicationWillTerminate:(NSNotification *)notification { [self.screenSettings end]; if (self.socketPath) unlink(self.socketPath.fileSystemRepresentation); }
@end
int main(int argc, const char *argv[]) {
 @autoreleasepool { NSApplication *app=NSApplication.sharedApplication; [app setActivationPolicy:NSApplicationActivationPolicyAccessory]; SeedCompanion *delegate=[SeedCompanion new]; app.delegate=delegate; [app run]; }
 return 0;
}
