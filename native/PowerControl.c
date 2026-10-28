// Fixed, root-owned command vocabulary. Never accepts shell commands or pmset keys.
#include <unistd.h>
#include <stdio.h>
#include <string.h>
static int minutes(const char *s) { unsigned n=0; if (!s || !*s || strlen(s)>4) return 0; for (;*s;s++) { if (*s<'0'||*s>'9') return 0; n=n*10+(*s-'0'); } return n<=1440; }
int main(int argc, char **argv) {
 const char *source=NULL;
 if (argc==5 && !strcmp(argv[1],"save") && minutes(argv[3]) && minutes(argv[4])) {
  if (!strcmp(argv[2],"ac")) source="-c";
  else if (!strcmp(argv[2],"battery")) source="-b";
  else if (!strcmp(argv[2],"ups")) source="-u";
  if (!source) return 64;
 } else if (!(argc==2 && (!strcmp(argv[1],"check") || !strcmp(argv[1],"off")))) return 64;
 if (geteuid()!=0) { fputs("Power settings helper requires its installed permission.\n",stderr); return 77; }
 if (!strcmp(argv[1],"check")) { puts("ready"); return 0; }
 if (source) { char *save[]={"/usr/bin/pmset",(char *)source,"displaysleep",argv[3],"sleep",argv[4],NULL};
 execv("/usr/bin/pmset",save); perror("pmset"); return 74; }
 char *off[]={"/usr/bin/pmset","displaysleepnow",NULL};
 execv("/usr/bin/pmset",off); perror("pmset"); return 74;
}
