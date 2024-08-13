const { KubeConfig, V1MicroTime } = require("@kubernetes/client-node");
const k8s = require("@kubernetes/client-node");

// https://github.com/kubernetes-client/javascript/issues/754#issuecomment-2004562303
const headerPatchMiddleware = {
  pre: async (requestContext) => {
    // Careful, case matters here. Samples have `Content-type` but don't appear to work
    requestContext.setHeaderParam(
      "Content-Type",
      "application/strategic-merge-patch+json",
    );
    return requestContext;
  },
  post: async (responseContext) => responseContext,
};

class K8SLock {
  constructor({
    kubeConfig,
    leaseName,
    namespace,
    createLeaseIfNotExist = true,
    labels = {},
    lockLeaserId,
    leaseDurationInSeconds = 30,
    refreshLockInterval,
    lockTryInterval,
  } = {}) {
    this.kubeConfig = kubeConfig;
    if (!this.kubeConfig) {
      this.kubeConfig = new KubeConfig();
      this.kubeConfig.loadFromDefault();
    }
    this.leaseName = leaseName;
    this.namespace = namespace;
    this.createLeaseIfNotExist = createLeaseIfNotExist;
    this.labels = labels;
    this.lockLeaserId = lockLeaserId;
    this.leaseDurationInSeconds = leaseDurationInSeconds;
    this.refreshLock =
      refreshLockInterval || (this.leaseDurationInSeconds * 1000) / 2; //half time lease guarantee lease will be keep
    this.lockTryInterval =
      lockTryInterval || this.leaseDurationInSeconds * 1000;
    this.isLocking = false;
  }

  _buildPatchConfig(kubeConfig) {
    const currentCluster = kubeConfig.getCurrentCluster();
    if (!currentCluster) {
      throw new Error("Kube config does not have current cluster.");
    }

    const server = currentCluster.server;
    if (!server) {
      throw new Error("Kube config cluster does not have server.");
    }

    // Only applied on patch request
    return k8s.createConfiguration({
      middleware: [headerPatchMiddleware], // This does nothing https://github.com/kubernetes-client/javascript/issues/1499
      baseServer: new k8s.ServerConfiguration(server, {}),
      authMethods: {
        default: {
          applySecurityAuthentication: async (req) => {
            await headerPatchMiddleware.pre(req); // Workaround until patch middleware is taken care of in k8s client
            await kubeConfig.applySecurityAuthentication(req);
          },
        },
      },
    });
  }

  async _lock() {
    const k8sApi = this.kubeConfig.makeApiClient(k8s.CoordinationV1Api);
    let lease;
    try {
      lease = await k8sApi.readNamespacedLease({
        name: this.leaseName,
        namespace: this.namespace,
      });
    } catch (e) {
      if (e?.code === 404 && this.createLeaseIfNotExist) {
        lease = await k8sApi.createNamespacedLease({
          namespace: this.namespace,
          body: {
            metadata: {
              name: this.leaseName,
              labels: this.labels,
            },
            spec: {},
          },
        });
      } else {
        throw e;
      }
    }
    if (this.isLocking && lease.spec.holderIdentity === this.lockLeaserId) {
      this.isLocking = false;
    }
    if (
      new Date(lease.spec.renewTime || 0) < new Date() ||
      lease.spec.holderIdentity === this.lockLeaserId
    ) {
      const currentDate = new V1MicroTime();
      try {
        const body = {
          metadata: {
            labels: this.labels,
            resourceVersion: lease.metadata.resourceVersion,
          },
          spec: {
            leaseDurationSeconds: this.leaseDurationInSeconds,
            holderIdentity: this.lockLeaserId,
            renewTime: new V1MicroTime(
              currentDate.getTime() + this.leaseDurationInSeconds * 1000,
            ),
          },
        };
        if (lease.spec.holderIdentity !== this.lockLeaserId) {
          body.spec.leaseTransitions = (lease.spec.leaseTransitions || 0) + 1;
          body.spec.acquireTime = currentDate;
        }
        await k8sApi.patchNamespacedLease(
          { name: this.leaseName, namespace: this.namespace, body },
          this._buildPatchConfig(this.kubeConfig),
        );
      } catch (e) {
        if (e?.code === 409) {
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
    while (this.keepLocking) {
      const resp = await this._lock();
      if (!resp) {
        this.keepLocking = false;
      }
      await new Promise((accept) => setTimeout(accept, this.refreshLock));
    }
  }

  async startLocking() {
    let self = this;
    const lock = await this.getLock(true);
    if (this.isLocking) {
      this.keepLocking = true;
      setTimeout(() => {
        self._keepLocking();
      }, this.refreshLock); //launch async
      return { isLocking: this.isLocking };
    }
  }

  async stopLocking() {
    this.keepLocking = false;
  }

  async getLock(waitUntilLock) {
    let locked = await this._lock();
    if (waitUntilLock) {
      while (!locked) {
        await new Promise((accept) => setTimeout(accept, this.lockTryInterval));
        locked = await this._lock();
      }
    }
    return locked;
  }
}

module.exports = { K8SLock };
