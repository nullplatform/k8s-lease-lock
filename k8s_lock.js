import {KubeConfig, V1MicroTime, CoordinationV1Api} from "@kubernetes/client-node";
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
        const k8sApi = this.kubeConfig.makeApiClient(CoordinationV1Api);
        let lease;
        try {
            lease = await k8sApi.readNamespacedLease({
                name: this.leaseName,
                namespace: this.namespace
            });
        }catch (e) {
            if(e?.statusCode === 404 && this.createLeaseIfNotExist) {
                lease = await k8sApi.createNamespacedLease({
                    namespace: this.namespace,
                    body: {
                        metadata: {
                            name: this.leaseName,
                            labels: this.labels
                        },
                        spec: {
                        }
                    }
                });
            } else {
                throw e;
            }
        }
        if(this.isLocking && lease.spec.holderIdentity === this.lockLeaserId) {
            this.isLocking = false;
        }
        if(new Date(lease.spec.renewTime || 0 ) < new Date() || lease.spec.holderIdentity === this.lockLeaserId) {
            const currentDate = new V1MicroTime();
            try {
                const body = {
                    metadata: {
                        labels: this.labels,
                        resourceVersion: lease.metadata.resourceVersion
                    },
                    spec: {
                        leaseDurationSeconds: this.leaseDurationInSeconds,
                        holderIdentity: this.lockLeaserId,
                        renewTime: new V1MicroTime(currentDate.getTime() + this.leaseDurationInSeconds * 1000)
                    }
                };
                if(lease.spec.holderIdentity !== this.lockLeaserId) {
                    body.spec.leaseTransitions = (lease.spec.leaseTransitions || 0) + 1;
                    body.spec.acquireTime= currentDate;
                }
                // Use strategic merge patch via raw HTTP request to avoid content-type issues
                const cluster = this.kubeConfig.getCurrentCluster();
                const user = this.kubeConfig.getCurrentUser();
                const namespace = this.namespace;
                const leaseName = this.leaseName;

                const requestOptions = {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/strategic-merge-patch+json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify(body)
                };

                // Apply authentication
                await this.kubeConfig.applyToHTTPSOptions(requestOptions);

                const url = `${cluster.server}/apis/coordination.k8s.io/v1/namespaces/${namespace}/leases/${leaseName}`;
                const https = await import('https');
                const nodeUrl = await import('url');

                await new Promise((resolve, reject) => {
                    const parsedUrl = new nodeUrl.URL(url);
                    const options = {
                        hostname: parsedUrl.hostname,
                        port: parsedUrl.port,
                        path: parsedUrl.pathname,
                        method: requestOptions.method,
                        headers: requestOptions.headers,
                        ...requestOptions
                    };

                    const req = https.request(options, (res) => {
                        let data = '';
                        res.on('data', (chunk) => data += chunk);
                        res.on('end', () => {
                            if (res.statusCode >= 200 && res.statusCode < 300) {
                                resolve(JSON.parse(data));
                            } else if (res.statusCode === 409) {
                                reject({ statusCode: 409 });
                            } else {
                                reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                            }
                        });
                    });

                    req.on('error', reject);
                    req.write(requestOptions.body);
                    req.end();
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

export {K8SLock};
