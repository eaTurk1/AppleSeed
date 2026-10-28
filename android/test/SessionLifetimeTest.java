import org.appleseed.remote.SessionLifetime;

public final class SessionLifetimeTest {
    public static void main(String[] args) {
        SessionLifetime session = new SessionLifetime();
        require(!session.retainWhenHidden(), "An idle page was retained");
        session.start(600, 1000);
        require(session.retainWhenHidden(), "Closing the Activity would end the session");
        long originalDeadline = session.deadline();
        require(!session.expired(600999), "Timer expired early");
        require(session.expired(601000), "Timer did not expire");
        require(session.deadline() == originalDeadline, "Observing/reopening restarted the timer");
        session.start(2220, 9000);
        require(session.deadline() == 2229000, "Apply did not update the deadline");
        session.start(0, 10000);
        require(session.retainWhenHidden() && !session.expired(Long.MAX_VALUE), "No timer expired");
        session.end(); session.end();
        require(!session.retainWhenHidden() && session.deadline() == 0, "Disconnect did not release retention");
        for (int seconds : new int[]{-1, 86401}) {
            try { session.start(seconds, 0); throw new AssertionError("Invalid timer accepted"); }
            catch (IllegalArgumentException expected) {}
        }
        System.out.println("Android session lifetime: 10 checks passed.");
    }
    private static void require(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
}
