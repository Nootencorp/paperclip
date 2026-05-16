export {
  getServerAdapter,
  listAdapterModels,
  refreshAdapterModels,
  listServerAdapters,
  findServerAdapter,
  findActiveServerAdapter,
  detectAdapterModel,
  listAdapterModelProfiles,
  registerServerAdapter,
  unregisterServerAdapter,
  requireServerAdapter,
} from "./registry.js";
export type {
  ServerAdapterModule,
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterInvocationMeta,
  AdapterModelProfileDefinition,
  AdapterEnvironmentCheckLevel,
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestStatus,
  AdapterEnvironmentTestResult,
  AdapterEnvironmentTestContext,
  AdapterSessionCodec,
  UsageSummary,
  AdapterAgent,
  AdapterRuntime,
} from "@paperclipai/adapter-utils";
export { runningProcesses, setRunChildProcessSpawnObserver } from "./utils.js";
export type { RunChildProcessSpawnMeta, RunChildProcessSpawnObserver } from "./utils.js";
