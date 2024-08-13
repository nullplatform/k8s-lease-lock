const { K8SLock } = require('../k8s_lock');
const k8s = require("@kubernetes/client-node");
jest.mock("@kubernetes/client-node");

describe("K8SLock", () => {
    let mockApi;

    beforeEach(() => {
        jest.resetAllMocks();

        mockApi = {
            readNamespacedLease: jest.fn(),
            createNamespacedLease: jest.fn(() => {
                return {
                        metadata: {
                            resourceVersion: 1231
                        },
                        spec: {

                        }
                }
            }),
            patchNamespacedLease: jest.fn(),
        };
        mockKubeConfig = {
            loadFromDefault: jest.fn(),
            makeApiClient: jest.fn( () =>{
                return mockApi;
            }),
            getCurrentCluster: jest.fn( () => { return { server:'localhost' } } )
        }

        k8s.KubeConfig.mockImplementation(() => mockKubeConfig);
        k8s.CoordinationV1Api.mockImplementation(() => mockApi);
    });

    it("should create a new lock if it does not exist and createLeaseIfNotExist is true", async () => {
        mockApi.readNamespacedLease.mockRejectedValue({ code: 404 });

        const lock = new K8SLock({
            leaseName: "test-lease",
            namespace: "namespace",
            createLeaseIfNotExist: true
        });
        await lock._lock();

        expect(mockApi.createNamespacedLease).toHaveBeenCalledTimes(1);
    });

    it("should not create a new lock if it does not exist and createLeaseIfNotExist is false", async () => {
        mockApi.readNamespacedLease.mockRejectedValue({ code: 404 });

        const lock = new K8SLock({
            leaseName: "test-lease",
            namespace: "namespace",
            createLeaseIfNotExist: false
        });
        let theError;
        try {
            await lock._lock();
        }catch (e) {
            theError = e;
        }

        expect(theError).toBeDefined();
        expect(mockApi.createNamespacedLease).not.toHaveBeenCalled();
    });

    it("should not overwrite lock if lock exists and is not expired", async () => {
        mockApi.readNamespacedLease.mockResolvedValue({
                metadata: {
                    resourceVersion: 1231
                },
                spec: {
                    renewTime: new Date(new Date().getTime() + 100000),  // set to a future time
                }
        });

        const lock = new K8SLock({
            leaseName: "test-lease",
            namespace: "namespace",
            lockLeaserId: "test"
        });
        const result = await lock._lock();

        expect(result).toBe(false);
        expect(mockApi.patchNamespacedLease).not.toHaveBeenCalled();
    });

    it("should overwrite lock if lock exists and is expired", async () => {
        mockApi.readNamespacedLease.mockResolvedValue({
                metadata: {
                    resourceVersion: 12312
                },
                spec: {
                    renewTime: new Date(new Date().getTime() - 10000),  // set to a past time
                }
        });

        const lock = new K8SLock({
            leaseName: "test-lease",
            namespace: "namespace",
            lockLeaserId: "test"
        });
        const result = await lock._lock();

        expect(result).toBe(true);
        expect(mockApi.patchNamespacedLease).toHaveBeenCalled();
    });

    it("should start locking if lock is acquired", async () => {
        mockApi.readNamespacedLease.mockResolvedValue({
                metadata: {
                    resourceVersion: 13112
                },
                spec: {
                    renewTime: new Date(new Date().getTime() - 10000),  // set to a past time
                }
        });
        mockApi.patchNamespacedLease.mockResolvedValue({});

        const lock = new K8SLock({
            leaseName: "test-lease",
            namespace: "namespace",
            lockLeaserId: "test"
        });
        const result = await lock.startLocking();

        expect(result.isLocking).toBe(true);
        expect(lock.keepLocking).toBe(true);
    });

    it("should stop locking when stopLocking is called", async () => {
        jest.useFakeTimers();

        mockApi.readNamespacedLease.mockResolvedValue({
                metadata: {
                    resourceVersion: 13112
                },
                spec: {
                    renewTime: new Date(new Date().getTime() - 10000),  // set to a past time
                }
        });
        mockApi.patchNamespacedLease.mockResolvedValue({});

        const lock = new K8SLock({
            leaseName: "test-lease",
            namespace: "namespace",
            lockLeaserId: "test",
            refreshLockInterval: 100

        });
        await lock.startLocking();
        await lock.stopLocking()
        jest.advanceTimersByTime(10000);  // Advan// ce timer
        jest.useRealTimers();
        await new Promise((a) => setTimeout(a, 200));//Force async calls
        expect(mockApi.patchNamespacedLease).toHaveBeenCalledTimes(1);  // Only the initial call
    });

    it("should keep trying to lock if getLock is called with waitUntilLock as true", async () => {
        jest.useFakeTimers();

        let calls = 0;
        mockApi.readNamespacedLease.mockImplementation(() => {
            calls++;
            if (calls === 1) {
                return Promise.resolve({

                        metadata: {
                            resourceVersion: 13112
                        },
                        spec: {
                            renewTime: new Date(new Date().getTime() + 10000),  // set to a past time
                        }

                });
            } else {
                return Promise.resolve({
                        metadata: {
                            resourceVersion: 13112
                        },
                        spec: {
                            renewTime: new Date(new Date().getTime() - 10000),  // set to a past time
                        }
                });
            }
        });
        mockApi.patchNamespacedLease.mockResolvedValue({});

        const lock = new K8SLock({
            leaseName: "test-lease",
            namespace: "namespace",
            lockLeaserId: "test"
        });
        const lockingPromise = lock.getLock(true);

        jest.advanceTimersByTime(30000);  // Advance timer to simulate retries

        const result = await lockingPromise;
        expect(result).toBe(true);
        expect(mockApi.patchNamespacedLease).toHaveBeenCalled();
    });
});
