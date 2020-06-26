const Lock = require('async-lock');

export class LockServ {
    _lock = new Lock();

    lock(keys: string | string[]): Promise<()=>void> {
        return new Promise<()=>void>((resolve, reject) => {
            this._lock.acquire(keys, (release) => {
                resolve(release);
            }, (err) => {
                reject(err);
            });
        })
    }
}

export default LockServ;