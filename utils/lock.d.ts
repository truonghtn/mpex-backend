declare module "lock" {
    function Lock(): lock.Locker;
    namespace lock {
        class Locker {
            lock(key: string, callback: (release: () => void) => void);
            lock(keys: [string], callback: (release: () => void) => void);
        }
    }

    export = Lock;
}