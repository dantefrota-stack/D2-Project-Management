// A callback from an older identity must never repopulate a newer session.
export function createSessionLifecycle({clearData, onExpired, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout}) {
  let revision = 0, deadline = 0, timer;
  const subscriptions = new Set();
  function reset() {
    revision++;
    for (const stop of subscriptions) stop();
    subscriptions.clear();
    clearTimer(timer);
    deadline = 0;
    clearData();
    return revision;
  }
  function checkExpiry() {
    if (deadline && now() >= deadline) { reset(); onExpired(); return false; }
    return true;
  }
  return {
    reset,
    current: id => id === revision,
    listen(subscribe, next, error) {
      const id = revision;
      const stop = subscribe(value => { if (id === revision && checkExpiry()) next(value); }, cause => {
        if (id === revision) error(cause);
      });
      subscriptions.add(stop);
    },
    lease(until) {
      clearTimer(timer);
      deadline = until;
      if (checkExpiry() && deadline) timer = setTimer(checkExpiry, Math.max(0, deadline - now()));
    },
    checkExpiry
  };
}
