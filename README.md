# K8SLock Module

The **K8SLock** module is a Node.js library designed to provide distributed locking functionality using Kubernetes leases. It allows you to manage locks in a Kubernetes cluster, ensuring that only one client or process can hold a lock at any given time. This is useful for scenarios where you need to coordinate tasks across multiple instances of your application or ensure exclusive access to shared resources.

## Installation

To use the **K8SLock** module in your Node.js project, you can install it via npm:

```shell
npm install @nullplatform/k8s-lease-lock
```

## Usage

### Importing the Module

```javascript
const { K8SLock } = require("@nullplatform/k8s-lease-lock");
```

### Creating a Lock

To create a lock, you need to instantiate the `K8SLock` class with the required configuration options. Here's an example:

```javascript
const lock = new K8SLock({
  leaseName: "test-lease-pepe",
  namespace: "n1",
  lockLeaserId: "colo2",
  leaseDurationInSeconds: 50,
});
```

- `leaseName`: The name of the lease resource used for locking.
- `namespace`: The Kubernetes namespace where the lease should be created.
- `lockLeaserId`: An identifier for the entity acquiring the lock.
- `leaseDurationInSeconds`: The duration (in seconds) for which the lock should be held.

### Starting Locking

To initiate the locking process, you can call the `startLocking` method. This method will continuously attempt to acquire and maintain the lock.

```javascript
const lockInfo = await lock.startLocking();
console.log("Locking started:", lockInfo.isLocking);
```

- `lockInfo.isLocking`: Indicates whether the lock has been acquired or not.
- `lockInfo.lockId`: An interval ID that can be used to stop the locking process.

### Stopping Locking

To stop the locking process, you can use the `stopLocking` method, passing the `lockId` obtained from `startLocking`.

```javascript
lock.stopLocking(lockInfo.lockId);
```

### Getting a Lock

You can also explicitly attempt to acquire a lock using the `getLock` method. If `waitUntilLock` is set to `true`, it will keep trying until the lock is acquired.

```javascript
const locked = await lock.getLock(true);
console.log("Lock acquired:", locked);
```

### Configuration Options

The `K8SLock` constructor accepts several configuration options:

- `kubeConfig`: A Kubernetes configuration object. If not provided, it will load the default configuration.
- `createLeaseIfNotExist`: If `true`, the module will create a lease if it doesn't already exist.
- `labels`: Labels to apply to the lease when creating it.
- `refreshLockInterval`: Interval (in milliseconds) for refreshing the lease.
- `lockTryInterval`: Interval (in milliseconds) for retrying to acquire the lock.

## Example

Here's an example of how to use the **K8SLock** module to acquire a lock:

```javascript
const { K8SLock } = require("@k8s-lock");

(async () => {
  const lock = new K8SLock({
    leaseName: "test-lease-pepe",
    namespace: "n1",
    lockLeaserId: "colo2",
    leaseDurationInSeconds: 50,
  });

  const lockInfo = await lock.startLocking();
  console.log("Locking started:", lockInfo.isLocking);
})();
```
## Required k8s configuration

Your k8s user will require to use a role with at least the following permissions 

```yaml
---
kind: Role
apiVersion: rbac.authorization.k8s.io/v1
metadata:
  name: lease-role
rules:
  - apiGroups: ["coordination.k8s.io"]
    resources: ["leases"]
    verbs: ["create", "update", "patch", "get", "list"]
---
kind: RoleBinding
apiVersion: rbac.authorization.k8s.io/v1
metadata:
  name: lease-binding
  namespace: {{ .Release.Namespace }}
subjects:
  - kind: ServiceAccount
    name: service-account-for-deploy
    namespace: {{ .Release.Namespace }}
roleRef:
  kind: Role
  name: lease-ref
  apiGroup: rbac.authorization.k8s.io
```

## License

This module is distributed under the MIT License. You can find more details in the [LICENSE](LICENSE) file.

## Contributions

Contributions and bug reports are welcome! Please feel free to open issues or pull requests on the [GitHub repository](https://github.com/nullplatform/k8s-lease-lock).


