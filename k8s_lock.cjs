// CommonJS wrapper for k8s_lock
async function loadModule() {
    const module = await import('./k8s_lock.js');
    return module;
}

let K8SLockClass = null;

class K8SLock {
    constructor(options) {
        // Store options for lazy initialization
        this._options = options;
        this._initialized = false;
        this._instance = null;
    }

    async _ensureInitialized() {
        if (!this._initialized) {
            if (!K8SLockClass) {
                const module = await loadModule();
                K8SLockClass = module.K8SLock;
            }
            this._instance = new K8SLockClass(this._options);
            this._initialized = true;
        }
    }

    async _lock() {
        await this._ensureInitialized();
        return this._instance._lock();
    }

    async _keepLocking() {
        await this._ensureInitialized();
        return this._instance._keepLocking();
    }

    async startLocking() {
        await this._ensureInitialized();
        const result = await this._instance.startLocking();
        // Sync the state back
        this.isLocking = this._instance.isLocking;
        this.keepLocking = this._instance.keepLocking;
        return result;
    }

    async stopLocking() {
        await this._ensureInitialized();
        return this._instance.stopLocking();
    }

    async getLock(waitUntilLock) {
        await this._ensureInitialized();
        return this._instance.getLock(waitUntilLock);
    }
}

module.exports = { K8SLock };
