package org.appleseed.remote;

/** Monotonic session deadline independent of Activity creation and destruction. */
public final class SessionLifetime {
    private boolean active;
    private long deadline;
    public void start(int seconds, long now) {
        if (seconds < 0 || seconds > 86400) throw new IllegalArgumentException("Invalid timer");
        deadline = seconds == 0 ? 0 : now + seconds * 1000L;
        active = true;
    }
    public boolean retainWhenHidden() { return active; }
    public long deadline() { return deadline; }
    public boolean expired(long now) { return active && deadline > 0 && now >= deadline; }
    public void end() { active = false; deadline = 0; }
}
