const {KubeConfig, V1MicroTime} = require("@kubernetes/client-node");
const k8s = require("@kubernetes/client-node");
class K8SLock {

    constructor({kubeConfig, leaseName, namespace, createLeaseIfNotExist = true, labels = {}, lockLeaserId, leaseDurationInSeconds=30, refreshLockInterval, lockTryInterval}={}) {
        this.kubeConfig = kubeConfig;
        if(!this.kubeConfig) {
            this.kubeConfig = new KubeConfig();
            this.kubeConfig.loadFromDefault();
        }
        this.leaseName = leaseName;
        this.namespace = namespace;
        this.createLeaseIfNotExist = createLeaseIfNotExist;
        this.labels = labels;
        this.lockLeaserId = lockLeaserId;
        this.leaseDurationInSeconds = leaseDurationInSeconds;
        this.refreshLock = refreshLockInterval || this.leaseDurationInSeconds*1000/2; //half time lease guarantee lease will be keep
        this.lockTryInterval = lockTryInterval ||this.leaseDurationInSeconds*1000;
        this.isLocking = false;
    }

    async _lock() {
        const k8sApi = this.kubeConfig.makeApiClient(k8s.CoordinationV1Api);
        let lease;
        try {
            lease = await k8sApi.readNamespacedLease(this.leaseName, this.namespace);
        }catch (e) {
            if(e?.statusCode === 404 && this.createLeaseIfNotExist) {
                lease = await k8sApi.createNamespacedLease(this.namespace,{
                    metadata: {
                        name: this.leaseName,
                        labels: this.labels
                    },
                    spec: {
                    }
                });
            } else {
                throw e;
            }
        }
        if(this.isLocking && lease.body.spec.holderIdentity === this.lockLeaserId) {
            this.isLocking = false;
        }
        if(new Date(lease.body.spec.renewTime || 0 ) < new Date() || lease.body.spec.holderIdentity === this.lockLeaserId) {
            const currentDate = new V1MicroTime();
            try {
                await k8sApi.patchNamespacedLease(this.leaseName, this.namespace, {
                    metadata: {
                        labels: this.labels,
                        resourceVersion: lease.body.metadata.resourceVersion
                    },
                    spec: {
                        leaseTransitions: (lease.body.spec.leaseTransitions || 0) + 1,
                        leaseDurationSeconds: this.leaseDurationInSeconds,
                        acquireTime: currentDate,
                        holderIdentity: this.lockLeaserId,
                        renewTime: new V1MicroTime(currentDate.getTime() + this.leaseDurationInSeconds * 1000)
                    }
                },undefined,undefined,undefined,undefined,undefined,{
                    headers: {
                        "Content-Type": "application/strategic-merge-patch+json"
                    }
                });
            }catch (e) {
                if(e?.statusCode === 409) {
                    this.isLocking = false;
                    return false;
                }
                throw e;
            }
            this.isLocking = true;
            return true;
        } else {
            this.isLocking = false;
            return false;
        }
    }

    async _keepLocking() {
        while(this.keepLocking) {
            const resp = await this._lock();
            if (!resp) {
                this.keepLocking = false;
            }
            await new Promise((accept) => setTimeout(accept, this.refreshLock));
        }
    }

    async startLocking() {
        let self = this;
        const  lock = await this.getLock(true);
        if(this.isLocking) {
            this.keepLocking = true;
            setTimeout(() => {
                self._keepLocking()
            }, this.refreshLock); //launch async
            return {isLocking: this.isLocking};
        }
    }

    async stopLocking() {
        this.keepLocking = false;
    }

    async getLock(waitUntilLock) {
        let locked = await this._lock();
        if(waitUntilLock) {
            while(!locked) {
                await new Promise((accept) => setTimeout(accept, this.lockTryInterval));
                locked = await this._lock();
            }
        }
        return locked;
    }

}

module.exports = {K8SLock};
