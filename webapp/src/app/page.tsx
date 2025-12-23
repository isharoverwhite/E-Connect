import { fetchDevices } from "@/lib/api";
import { DeviceConfig } from "@/types/device";
import { RefreshCcw } from "lucide-react";

export default async function Home() {
  const devices = await fetchDevices();

  return (
    <main className="min-h-screen p-8 sm:p-12">
      <header className="mb-12 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-violet-400">
            E-Connect
          </h1>
          <p className="text-slate-400 mt-2">IoT Device Management Dashboard</p>
        </div>
        <button className="p-3 rounded-full bg-glass hover:bg-white/10 transition-colors border border-glass-border">
          <RefreshCcw className="w-5 h-5 text-slate-300" />
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {devices.length === 0 ? (
          <div className="col-span-full py-12 text-center glass-panel rounded-2xl">
            <p className="text-slate-400">No devices found. Connect a device to get started.</p>
          </div>
        ) : (
          devices.map((config) => (
            <DeviceCard key={config.device.uuid} config={config} />
          ))
        )}
      </div>
    </main>
  );
}

// Temporary inline component until we move it
function DeviceCard({ config }: { config: DeviceConfig }) {
  return (
    <div className="glass-panel rounded-2xl p-6 hover:border-blue-500/50 transition-colors group">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-xl font-semibold">{config.device.name}</h3>
          <p className="text-xs text-slate-500 font-mono mt-1">{config.device.uuid}</p>
        </div>
        <div className={`w-3 h-3 rounded-full ${config.device.is_authorized ? 'bg-green-500' : 'bg-amber-500'} shadow-[0_0_10px_currentColor]`} />
      </div>

      <div className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Board</span>
          <span>{config.device.board}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Mode</span>
          <span className="px-2 py-0.5 rounded-full bg-white/5 text-xs border border-white/10">
            {config.device.mode}
          </span>
        </div>
        <div className="pt-4 border-t border-white/5">
          <h4 className="text-xs font-semibold uppercase text-slate-500 mb-2">Controls</h4>
          <div className="grid grid-cols-2 gap-2">
            {config.hardware_config.pins.map(pin => (
              <div key={pin.pin} className="p-2 bg-white/5 rounded-lg text-center">
                <div className="text-xs text-slate-400 mb-1">{pin.label || `Pin ${pin.pin}`}</div>
                <div className="font-mono text-sm">{pin.mode}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
